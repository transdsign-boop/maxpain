import { EventEmitter } from 'events';
import { createHmac } from 'crypto';
import { storage } from './storage';
import { 
  type Liquidation, 
  type Strategy, 
  type TradeSession, 
  type Position, 
  type Order, 
  type Fill,
  type InsertTradeEntryError
} from '@shared/schema';
import { fetchActualFills, aggregateFills } from './exchange-utils';
import { orderProtectionService } from './order-protection-service';
import { cascadeDetectorService } from './cascade-detector-service';
import { calculateNextLayer, calculateATRPercent } from './dca-calculator';
import { userDataStreamManager } from './user-data-stream';
import { liveDataOrchestrator } from './live-data-orchestrator';
import { syncCompletedTrades } from './exchange-sync';
import { ProtectiveOrderRecovery } from './protective-order-recovery';
import { wsBroadcaster } from './websocket-broadcaster';

// Aster DEX fee schedule
const ASTER_MAKER_FEE_PERCENT = 0.01;  // 0.01% for limit orders (adds liquidity) 
const ASTER_TAKER_FEE_PERCENT = 0.035; // 0.035% for market orders (removes liquidity)

export interface LiquidationSignal {
  liquidation: Liquidation;
  strategy: Strategy;
  session: TradeSession;
  signalType: 'enter' | 'layer' | 'exit';
  layerNumber?: number;
  currentPrice?: number;
}

export interface PositionUpdate {
  positionId: string;
  unrealizedPnl: number;
  currentPrice: number;
  shouldExit: boolean;
}

interface SymbolPrecision {
  quantityPrecision: number;
  pricePrecision: number;
  stepSize: string;
  tickSize: string;
}

export class StrategyEngine extends EventEmitter {
  private activeStrategies: Map<string, Strategy> = new Map();
  private activeSessions: Map<string, TradeSession> = new Map();
  private liquidationHistory: Map<string, Liquidation[]> = new Map(); // symbol -> liquidations
  private priceCache: Map<string, number> = new Map(); // symbol -> latest price
  private symbolPrecisionCache: Map<string, SymbolPrecision> = new Map(); // symbol -> precision info
  private exchangeInfoFetched = false; // Track if exchange info has been fetched
  private positionCreationLocks: Map<string, Promise<void>> = new Map(); // sessionId-symbol -> lock to prevent duplicate positions
  private pendingLayerOrders: Map<string, Set<number>> = new Map(); // positionId -> Set of pending layer numbers to prevent duplicates
  private isRunning = false;
  private isCheckingLayers = false; // Re-entrancy guard for layer monitoring
  private orderMonitorInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private pollingInterval?: NodeJS.Timeout; // For preview mode polling
  private wsClients: Set<any> = new Set(); // WebSocket clients for broadcasting trade notifications
  private staleLimitOrderSeconds: number = 180; // 3 minutes default timeout for limit orders
  private recoveryAttempts: Map<string, number> = new Map(); // Track cooldown for auto-repair attempts
  private cleanupInProgress: boolean = false; // Prevent overlapping cleanup runs
  private exchangePositionMode: 'one-way' | 'dual' | null = null; // Cache exchange position mode
  private lastFillTime: Map<string, number> = new Map(); // "sessionId-symbol-side" -> timestamp of last fill
  private fillCooldownMs: number = 30000; // 30 second cooldown between layers/entries
  private leverageSetForSymbols: Map<string, number> = new Map(); // symbol -> leverage value (track actual leverage configured on exchange)
  private pendingQ1Values: Map<string, number> = new Map(); // "sessionId-symbol-side" -> q1 base layer size for position being created
  private pendingFirstLayerData: Map<string, { takeProfitPrice: number; stopLossPrice: number; entryPrice: number; quantity: number }> = new Map(); // "sessionId-symbol-side" -> first layer TP/SL data
  private protectiveOrderRecovery: ProtectiveOrderRecovery;

  constructor() {
    super();
    this.protectiveOrderRecovery = new ProtectiveOrderRecovery(this);
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Listen for position updates to check exit conditions
    this.on('positionUpdate', this.handlePositionUpdate.bind(this));
    
    // Listen for liquidation events from WebSocket
    this.on('liquidation', this.handleLiquidation.bind(this));
  }

  // Fetch exchange info to get symbol precision requirements
  private async fetchExchangeInfo() {
    if (this.exchangeInfoFetched) return;
    
    try {
      const response = await fetch('https://fapi.asterdex.com/fapi/v1/exchangeInfo');
      if (!response.ok) {
        console.error('❌ Failed to fetch exchange info:', response.statusText);
        return;
      }
      
      const data = await response.json();
      
      // Cache precision info for each symbol
      for (const symbol of data.symbols || []) {
        const lotSizeFilter = symbol.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
        const priceFilter = symbol.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
        
        if (lotSizeFilter && priceFilter) {
          this.symbolPrecisionCache.set(symbol.symbol, {
            quantityPrecision: symbol.quantityPrecision || 8,
            pricePrecision: symbol.pricePrecision || 8,
            stepSize: lotSizeFilter.stepSize || '1',
            tickSize: priceFilter.tickSize || '0.01',
          });
        }
      }
      
      this.exchangeInfoFetched = true;
      console.log(`✅ Cached precision info for ${this.symbolPrecisionCache.size} symbols`);
    } catch (error) {
      console.error('❌ Error fetching exchange info:', error);
    }
  }

  // Round quantity to match exchange precision requirements using stepSize
  private roundQuantity(symbol: string, quantity: number): number {
    const precision = this.symbolPrecisionCache.get(symbol);
    if (!precision) {
      console.warn(`⚠️ No precision info for ${symbol}, using default rounding`);
      return Math.floor(quantity * 100) / 100; // Default to 2 decimals
    }
    
    // Use stepSize for proper rounding (e.g., "1" = whole numbers, "0.1" = 1 decimal)
    const stepSize = parseFloat(precision.stepSize);
    const rounded = Math.floor(quantity / stepSize) * stepSize;
    
    // Format to correct decimal places to avoid floating point issues
    const decimals = precision.stepSize.includes('.') 
      ? precision.stepSize.split('.')[1].length 
      : 0;
    
    return parseFloat(rounded.toFixed(decimals));
  }

  // Round price to match exchange precision requirements using tickSize
  private roundPrice(symbol: string, price: number): number {
    const precision = this.symbolPrecisionCache.get(symbol);
    if (!precision) {
      console.warn(`⚠️ No precision info for ${symbol}, using default rounding`);
      return Math.floor(price * 100) / 100; // Default to 2 decimals
    }
    
    // Use tickSize for proper rounding (e.g., "0.01" = 2 decimals, "0.1" = 1 decimal)
    const tickSize = parseFloat(precision.tickSize);
    const rounded = Math.floor(price / tickSize) * tickSize;
    
    // Format to correct decimal places to avoid floating point issues
    const decimals = precision.tickSize.includes('.') 
      ? precision.tickSize.split('.')[1].length 
      : 0;
    
    return parseFloat(rounded.toFixed(decimals));
  }

  // Start the strategy engine
  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 StrategyEngine starting...');
    this.isRunning = true;
    
    // Fetch exchange info for precision requirements (for live trading)
    await this.fetchExchangeInfo();
    
    // Fetch and cache the exchange's position mode setting
    this.exchangePositionMode = await this.fetchExchangePositionMode();
    
    // Load active strategies and sessions
    await this.loadActiveStrategies();
    
    // NOTE: Removed programmatic layer monitoring - layers now use exchange orders (LIMIT TP, STOP_MARKET SL)
    // Exchange will automatically execute these orders, and we'll receive ORDER_TRADE_UPDATE events via WebSocket
    // this.startExitMonitoring(); // DISABLED - no longer needed
    
    // Start periodic cleanup of orphaned TP/SL orders (every 5 minutes)
    // NOTE: TP/SL updates are handled by updateProtectiveOrders() after each fill
    this.startCleanupMonitoring();
    
    console.log(`✅ StrategyEngine started with ${this.activeStrategies.size} active strategies`);
  }

  // Stop the strategy engine
  stop() {
    console.log('🛑 StrategyEngine stopping...');
    this.isRunning = false;
    
    // Clear all monitoring intervals
    if (this.orderMonitorInterval) {
      clearInterval(this.orderMonitorInterval);
      this.orderMonitorInterval = undefined;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    
    this.activeStrategies.clear();
    this.pendingLayerOrders.clear();
    this.activeSessions.clear();
    this.liquidationHistory.clear();
    this.positionCreationLocks.clear();
    console.log('✅ StrategyEngine stopped');
  }

  // Get current market price for a symbol (with exchange API fallback)
  async getCurrentPrice(symbol: string): Promise<number | undefined> {
    // Check cache first
    const cachedPrice = this.priceCache.get(symbol);
    if (cachedPrice) {
      return cachedPrice;
    }

    // Fallback: fetch from exchange ticker API
    try {
      const tickerUrl = `https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${symbol}`;
      const response = await fetch(tickerUrl);
      
      if (!response.ok) {
        console.log(`⚠️ Failed to fetch ticker for ${symbol}: ${response.status}`);
        return undefined;
      }

      const data = await response.json();
      const price = parseFloat(data.price);
      
      // Cache the fetched price for future use
      this.priceCache.set(symbol, price);
      console.log(`💰 Fetched and cached current price for ${symbol}: $${price.toFixed(6)}`);
      
      return price;
    } catch (error) {
      console.error(`❌ Error fetching ticker for ${symbol}:`, error);
      return undefined;
    }
  }

  // Set WebSocket clients for broadcasting trade notifications
  setWebSocketClients(clients: Set<any>) {
    this.wsClients = clients;
  }

  // Broadcast trade notification to all connected clients
  private broadcastTradeNotification(data: {
    symbol: string;
    side: 'long' | 'short';
    tradeType: 'entry' | 'layer' | 'stop_loss' | 'take_profit';
    layerNumber?: number;
    price: number;
    quantity: number;
    value: number;
  }) {
    const message = JSON.stringify({
      type: 'trade_notification',
      data
    });

    this.wsClients.forEach((client: any) => {
      if (client.readyState === 1) { // WebSocket.OPEN = 1
        client.send(message);
      }
    });
  }

  // Load the default strategy for the user (singleton pattern)
  private async loadActiveStrategies() {
    try {
      const DEFAULT_USER_ID = "personal_user";
      console.log('📚 Loading default trading strategy...');
      
      // Get or create the single default strategy for this user
      const strategy = await storage.getOrCreateDefaultStrategy(DEFAULT_USER_ID);
      
      if (strategy.isActive) {
        await this.registerStrategy(strategy);
        console.log(`✅ Loaded default strategy: ${strategy.name}`);
      } else {
        console.log(`⏸️ Default strategy is inactive, not registering`);
      }
    } catch (error) {
      console.error('❌ Error loading default strategy:', error);
    }
  }

  // Register a new strategy to monitor
  async registerStrategy(strategy: Strategy) {
    console.log(`📝 Registering strategy: ${strategy.name} (${strategy.id})`);
    this.activeStrategies.set(strategy.id, strategy);
    
    // Get or create the singleton session for this user
    // This ensures there's always exactly one persistent session
    const session = await storage.getOrCreateActiveSession(strategy.userId);
    
    // Store by both strategy ID and session ID for easy lookup
    this.activeSessions.set(strategy.id, session);
    this.activeSessions.set(session.id, session);
    console.log(`✅ Strategy registered with session: ${session.id}`);
    
    // Sync cascade detector with strategy's selected assets
    await cascadeDetectorService.syncSymbols();
    
    // Start WebSocket user data stream for real-time account/position updates
    // IMPORTANT: Only run in deployed environment to avoid listen key conflicts
    // Aster DEX only allows ONE active user data stream per API key
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    const isDeployed = process.env.REPLIT_DEPLOYMENT === '1';
    
    if (apiKey && isDeployed) {
      try {
        await userDataStreamManager.start({
          apiKey,
          onAccountUpdate: (data) => {
            console.log('💰 Account balance updated via WebSocket');
          },
          onPositionUpdate: (data) => {
            console.log('📈 Position updated via WebSocket');
          },
          onOrderUpdate: (data) => {
            console.log('📦 Order updated via WebSocket');
          },
          onTradeFill: async (order) => {
            // CRITICAL: Immediately update protective orders when position changes from trade fill
            console.log(`🚨 TRADE FILL detected for ${order.symbol} ${order.positionSide} - triggering immediate protective order update`);
            try {
              const session = this.activeSessions.get(activeStrategy!.id);
              if (!session) {
                console.log('⏭️ No active session, skipping protective order update');
                return;
              }

              // Find the specific position that just filled
              const positionSide = order.positionSide === 'LONG' ? 'long' : 'short';
              const position = await storage.getPositionBySymbolAndSide(
                session.id,
                order.symbol,
                positionSide
              );

              if (position && position.isOpen) {
                // Update protective orders ONLY for the position that just filled
                await orderProtectionService.updateProtectiveOrders(position, activeStrategy!);
                console.log(`✅ Protective orders updated immediately for ${order.symbol} ${positionSide}`);
              } else {
                console.log(`⏭️ No open ${order.symbol} ${positionSide} position found`);
              }
            } catch (error) {
              console.error('❌ Failed to update protective orders after fill:', error);
            }
          }
        });
        console.log('✅ User data stream started for real-time updates (deployed mode)');
      } catch (error) {
        console.error('⚠️ Failed to start user data stream:', error);
      }
    } else if (apiKey && secretKey && !isDeployed) {
      // Preview mode: Use polling instead of WebSocket (5-second intervals)
      console.log('🔄 Starting polling mode for preview (5-second intervals)');
      console.log('   📱 Deployed version uses WebSocket for real-time updates');
      
      // Poll account and positions every 5 seconds
      this.pollingInterval = setInterval(async () => {
        try {
          const timestamp = Date.now();
          
          // Fetch account data
          const accountParams = `timestamp=${timestamp}`;
          const accountSignature = createHmac('sha256', secretKey)
            .update(accountParams)
            .digest('hex');
          
          const accountResponse = await fetch(
            `https://fapi.asterdex.com/fapi/v2/account?${accountParams}&signature=${accountSignature}`,
            { headers: { 'X-MBX-APIKEY': apiKey } }
          );
          
          if (accountResponse.ok) {
            const accountData = await accountResponse.json();
            liveDataOrchestrator.updateAccountFromWebSocket(strategy.id, accountData.assets || []);
          }
          
          // Fetch position data
          const positionParams = `timestamp=${timestamp}`;
          const positionSignature = createHmac('sha256', secretKey)
            .update(positionParams)
            .digest('hex');
          
          const positionResponse = await fetch(
            `https://fapi.asterdex.com/fapi/v2/positionRisk?${positionParams}&signature=${positionSignature}`,
            { headers: { 'X-MBX-APIKEY': apiKey } }
          );
          
          if (positionResponse.ok) {
            const positionData = await positionResponse.json();
            liveDataOrchestrator.updatePositionsFromWebSocket(strategy.id, positionData);
          }
        } catch (error) {
          console.error('⚠️ Polling error:', error);
        }
      }, 5000); // 5 seconds
      
      console.log('✅ Polling started for account/position updates (preview mode)');
    }
  }

  // Unregister a strategy
  async unregisterStrategy(strategyId: string) {
    console.log(`📤 Unregistering strategy: ${strategyId}`);
    
    // Stop WebSocket user data stream
    try {
      await userDataStreamManager.stop();
      console.log('✅ User data stream stopped');
    } catch (error) {
      console.error('⚠️ Error stopping user data stream:', error);
    }
    
    // Stop polling interval if running (preview mode)
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
      console.log('✅ Polling stopped');
    }
    
    // CRITICAL: Capture session BEFORE removing from maps
    const session = this.activeSessions.get(strategyId);
    
    // CRITICAL: Remove from maps IMMEDIATELY to prevent race condition
    // This makes the strategy invisible to handleLiquidation before any awaits
    this.activeStrategies.delete(strategyId);
    if (session) {
      this.activeSessions.delete(session.id);
    }
    this.activeSessions.delete(strategyId);
    
    
    // Note: We do NOT end the trade session here to preserve open positions
    // The session stays active so positions remain visible when strategy is restarted
  }

  // Handle incoming liquidation event
  private async handleLiquidation(liquidation: Liquidation) {
    if (!this.isRunning) return;

    console.log(`📊 Strategy Engine received liquidation: ${liquidation.symbol} ${liquidation.side} $${parseFloat(liquidation.value).toFixed(2)}`);

    // Update price cache
    this.priceCache.set(liquidation.symbol, parseFloat(liquidation.price));
    
    // Add to liquidation history for threshold checking
    if (!this.liquidationHistory.has(liquidation.symbol)) {
      this.liquidationHistory.set(liquidation.symbol, []);
    }
    
    const history = this.liquidationHistory.get(liquidation.symbol)!;
    history.push(liquidation);
    
    // Keep only last 100 liquidations per symbol for memory efficiency
    if (history.length > 100) {
      history.shift();
    }

    // Check all active strategies for this symbol (sequentially to avoid race conditions)
    for (const [strategyId, strategy] of Array.from(this.activeStrategies.entries())) {
      if (strategy.selectedAssets.includes(liquidation.symbol)) {
        await this.evaluateStrategySignal(strategy, liquidation);
      }
    }
  }

  // Evaluate if a liquidation triggers a trading signal for a strategy
  private async evaluateStrategySignal(strategy: Strategy, liquidation: Liquidation) {
    // Double-check strategy is still active (prevents race condition during unregister)
    if (!this.activeStrategies.has(strategy.id)) return;
    
    // Check if strategy is paused
    if (strategy.paused) {
      console.log(`⏸️ Strategy "${strategy.name}" is paused, skipping liquidation processing`);
      return;
    }
    
    const session = this.activeSessions.get(strategy.id);
    if (!session || !session.isActive) return;

    console.log(`🎯 Evaluating strategy "${strategy.name}" for ${liquidation.symbol}`);

    // CASCADE AUTO-BLOCKING: Check if cascade detector is blocking all trades
    const aggregateStatus = cascadeDetectorService.getAggregateStatus();
    if (aggregateStatus.blockAll) {
      console.log(`🚫 CASCADE AUTO-BLOCK: ${aggregateStatus.reason}`);
      // Broadcast block status to frontend
      wsBroadcaster.broadcastTradeBlock({
        blocked: true,
        reason: aggregateStatus.reason || 'Cascade auto-blocking active',
        type: 'cascade_auto_block'
      });
      return;
    }

    // Use configurable lookback window from strategy settings (convert hours to seconds)
    const lookbackSeconds = strategy.liquidationLookbackHours * 3600;
    const recentLiquidations = this.getRecentLiquidations(
      liquidation.symbol, 
      lookbackSeconds
    );

    console.log(`📈 Found ${recentLiquidations.length} liquidations in last ${strategy.liquidationLookbackHours}h for ${liquidation.symbol}`);

    if (recentLiquidations.length === 0) return;

    // Determine position side (SAME as liquidation side) for counter-trading
    // When longs liquidated → go LONG (buy the dip), when shorts liquidated → go SHORT (sell the rally)
    const positionSide = liquidation.side === "long" ? "long" : "short";

    // Create lock key for this session + symbol (+ side if hedge mode enabled) to prevent duplicate positions
    // In hedge mode, we allow both long and short positions on the same symbol, so include side in lock key
    const lockKey = strategy.hedgeMode 
      ? `${session.id}-${liquidation.symbol}-${positionSide}`
      : `${session.id}-${liquidation.symbol}`;
    
    // ATOMIC check-and-lock: Check if another liquidation is already processing this symbol/side
    const existingLock = this.positionCreationLocks.get(lockKey);
    if (existingLock) {
      console.log(`🔄 Waiting for concurrent position processing: ${liquidation.symbol} ${strategy.hedgeMode ? positionSide : ''}`);
      await existingLock; // Wait for it to finish
      // After waiting, re-check if position was created
      const positionAfterWait = strategy.hedgeMode
        ? await storage.getPositionBySymbolAndSide(session.id, liquidation.symbol, positionSide)
        : await storage.getPositionBySymbol(session.id, liquidation.symbol);
      if (positionAfterWait && positionAfterWait.isOpen) {
        // CRITICAL: Verify position direction matches liquidation direction
        if (positionAfterWait.side === positionSide) {
          // Position was created by the concurrent process, check if we should layer
          const shouldLayer = await this.shouldAddLayer(strategy, positionAfterWait, liquidation);
          if (shouldLayer) {
            // NOTE: executeLayer() atomically checks and sets cooldown at the start
            await this.executeLayer(strategy, session, positionAfterWait, liquidation, positionSide);
          }
        } else {
          console.log(`⏭️ Skipping layer (concurrent): Existing ${positionAfterWait.side} position doesn't match ${positionSide} liquidation signal`);
        }
      }
      return;
    }
    
    // Create a lock promise for this symbol/side
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.positionCreationLocks.set(lockKey, lockPromise);
    
    try {
      // Now we have the lock, check if we have an open position for this symbol (and side if hedge mode)
      const existingPosition = strategy.hedgeMode
        ? await storage.getPositionBySymbolAndSide(session.id, liquidation.symbol, positionSide)
        : await storage.getPositionBySymbol(session.id, liquidation.symbol);
      
      if (existingPosition && existingPosition.isOpen) {
        // CRITICAL: Verify position direction matches liquidation direction
        // Only add layers if position side matches the intended positionSide from liquidation
        if (existingPosition.side === positionSide) {
          // We have an open position in the CORRECT direction - check if we should add a layer
          const shouldLayer = await this.shouldAddLayer(strategy, existingPosition, liquidation);
          if (shouldLayer) {
            // NOTE: executeLayer() atomically checks and sets cooldown at the start
            await this.executeLayer(strategy, session, existingPosition, liquidation, positionSide);
          }
        } else {
          console.log(`⏭️ Skipping layer: Existing ${existingPosition.side} position doesn't match ${positionSide} liquidation signal`);
        }
      } else {
        // No open position - check if we should enter a new position
        // NOTE: shouldEnterPosition() atomically sets cooldown if it returns true
        const shouldEnter = await this.shouldEnterPosition(strategy, liquidation, recentLiquidations, session, positionSide);
        if (shouldEnter) {
          await this.executeEntry(strategy, session, liquidation, positionSide);
        }
      }
    } finally {
      // ALWAYS release the lock and clean up
      releaseLock!();
      // Clean up after a short delay to allow waiting processes to finish
      setTimeout(() => this.positionCreationLocks.delete(lockKey), 100);
    }
  }

  // Get recent liquidations within threshold window
  private getRecentLiquidations(symbol: string, thresholdSeconds: number): Liquidation[] {
    const history = this.liquidationHistory.get(symbol);
    if (!history) return [];

    const cutoffTime = new Date(Date.now() - thresholdSeconds * 1000);
    return history.filter(liq => liq.timestamp >= cutoffTime);
  }

  // Determine if we should enter a new position based on percentile threshold
  // ATOMIC OPERATION: This function checks conditions AND sets cooldown if passing
  private async shouldEnterPosition(
    strategy: Strategy, 
    liquidation: Liquidation, 
    recentLiquidations: Liquidation[],
    session: TradeSession,
    positionSide: string
  ): Promise<boolean> {
    // ATOMIC COOLDOWN CHECK: Must be first check to prevent race conditions
    const cooldownKey = `${session.id}-${liquidation.symbol}-${positionSide}`;
    const lastFill = this.lastFillTime.get(cooldownKey);
    if (lastFill) {
      const timeSinceLastFill = Date.now() - lastFill;
      if (timeSinceLastFill < this.fillCooldownMs) {
        const waitTime = ((this.fillCooldownMs - timeSinceLastFill) / 1000).toFixed(1);
        console.log(`⏸️ Entry cooldown active for ${liquidation.symbol} ${positionSide} - wait ${waitTime}s before new entry`);
        // Note: Cooldown is per-symbol/side filter, NOT a system-wide block
        return false;
      }
    }
    
    // PORTFOLIO RISK LIMITS CHECK: Block new entries if they WOULD exceed limits
    const portfolioRisk = await this.calculatePortfolioRisk(strategy, session);
    
    // Check max open positions limit (0 = unlimited)
    // Must check if adding ONE MORE position would exceed the limit
    if (strategy.maxOpenPositions > 0 && portfolioRisk.openPositionCount + 1 > strategy.maxOpenPositions) {
      console.log(`🚫 PORTFOLIO LIMIT: Opening new position would exceed limit (${portfolioRisk.openPositionCount + 1} > ${strategy.maxOpenPositions})`);
      wsBroadcaster.broadcastTradeBlock({
        blocked: true,
        reason: `Portfolio limit: ${portfolioRisk.openPositionCount + 1} > ${strategy.maxOpenPositions} positions`,
        type: 'portfolio_limit'
      });
      return false;
    }
    
    // Calculate ACTUAL projected risk using DCA calculator
    let riskCheckPassed = false;
    try {
      const price = parseFloat(liquidation.price);
      let currentBalance = parseFloat(session.currentBalance);
      const exchangeBalance = await this.getExchangeAvailableBalance(strategy);
      if (exchangeBalance !== null) {
        currentBalance = exchangeBalance;
      }
      
      const maxRiskPercent = parseFloat(strategy.maxPortfolioRiskPercent);
      const remainingRiskPercent = maxRiskPercent - portfolioRisk.riskPercentage;
      
      // Check if there's any remaining risk budget (with 0.05% minimum threshold)
      if (remainingRiskPercent < 0.05) {
        console.log(`🚫 PORTFOLIO RISK LIMIT: No remaining risk budget (current: ${portfolioRisk.riskPercentage.toFixed(1)}%, max: ${maxRiskPercent}%, remaining: ${remainingRiskPercent.toFixed(2)}%)`);
        wsBroadcaster.broadcastTradeBlock({
          blocked: true,
          reason: `Risk limit: ${portfolioRisk.riskPercentage.toFixed(1)}% of ${maxRiskPercent}% used`,
          type: 'risk_limit'
        });
        return false;
      }
      
      // Import DCA functions
      const { calculateDCALevels, calculateATRPercent } = await import('./dca-calculator');
      const { getStrategyWithDCA } = await import('./dca-sql');
      
      // Fetch DCA parameters
      const strategyWithDCA = await getStrategyWithDCA(strategy.id);
      if (!strategyWithDCA || strategyWithDCA.dca_start_step_percent == null) {
        // Missing DCA parameters - trigger fallback
        throw new Error('DCA parameters not configured');
      }
      
      // Build full strategy with DCA params and adaptive TP/SL settings
      const fullStrategy = {
        ...strategy,
        dcaStartStepPercent: String(strategyWithDCA.dca_start_step_percent),
        dcaSpacingConvexity: String(strategyWithDCA.dca_spacing_convexity),
        dcaSizeGrowth: String(strategyWithDCA.dca_size_growth),
        dcaMaxRiskPercent: String(strategyWithDCA.dca_max_risk_percent),
        dcaVolatilityRef: String(strategyWithDCA.dca_volatility_ref),
        dcaExitCushionMultiplier: String(strategyWithDCA.dca_exit_cushion_multiplier),
      };
      
      const atrPercent = await calculateATRPercent(liquidation.symbol, 10, process.env.ASTER_API_KEY, process.env.ASTER_SECRET_KEY);
      
      // Determine effective max risk: use remaining budget if less than strategy setting
      const strategyMaxRisk = parseFloat(fullStrategy.dcaMaxRiskPercent);
      const effectiveMaxRisk = Math.min(strategyMaxRisk, remainingRiskPercent);
      
      console.log(`💰 Risk Budget: current=${portfolioRisk.riskPercentage.toFixed(1)}%, max=${maxRiskPercent}%, remaining=${remainingRiskPercent.toFixed(1)}%, effective=${effectiveMaxRisk.toFixed(1)}% (${effectiveMaxRisk < strategyMaxRisk ? 'SCALED DOWN' : 'normal'})`);
      
      // Calculate DCA levels for prospective entry with risk override if needed
      const dcaResult = calculateDCALevels(fullStrategy, {
        entryPrice: price,
        side: positionSide as 'long' | 'short',
        currentBalance,
        leverage: strategy.leverage,
        atrPercent,
      }, effectiveMaxRisk < strategyMaxRisk ? effectiveMaxRisk : undefined);
      
      // Get total risk from DCA calculation (this is the max risk across all layers)
      const newPositionRiskDollars = dcaResult.totalRiskDollars;
      const newPositionRiskPercent = (newPositionRiskDollars / currentBalance) * 100;
      const projectedRiskPercentage = portfolioRisk.riskPercentage + newPositionRiskPercent;
      
      // CRITICAL: Validate that calculations produced finite numbers (not NaN or Infinity)
      if (!Number.isFinite(newPositionRiskPercent) || !Number.isFinite(projectedRiskPercentage)) {
        throw new Error(`Invalid risk calculation: newRisk=${newPositionRiskPercent}, projected=${projectedRiskPercentage}`);
      }
      
      // Final safety check: ensure projected risk doesn't exceed max (account for float precision)
      if (projectedRiskPercentage > maxRiskPercent + 0.01) { // Allow 0.01% tolerance for float precision
        console.log(`🚫 PORTFOLIO RISK LIMIT: Projected risk still exceeds max after scaling (projected: ${projectedRiskPercentage.toFixed(1)}% > max: ${maxRiskPercent}%)`);
        
        wsBroadcaster.broadcastTradeBlock({
          blocked: true,
          reason: `Risk limit: Projected ${projectedRiskPercentage.toFixed(1)}% > max ${maxRiskPercent}%`,
          type: 'risk_limit'
        });
        
        // Log error to database for audit trail
        await this.logTradeEntryError({
          strategy,
          symbol: liquidation.symbol,
          side: positionSide,
          attemptType: 'entry',
          reason: 'risk_limit_exceeded',
          errorDetails: `Projected risk ${projectedRiskPercentage.toFixed(1)}% exceeds max ${maxRiskPercent}%`,
          liquidationValue: parseFloat(liquidation.value),
        });
        
        return false;
      }
      
      console.log(`✅ Risk check passed: projected=${projectedRiskPercentage.toFixed(1)}% ≤ max=${maxRiskPercent}%`);
      riskCheckPassed = true;
    } catch (error) {
      console.error('⚠️ Error calculating projected risk, using conservative fallback:', error);
      // MANDATORY fallback check - always enforce risk limit even if DCA calculation fails
      const maxRiskPercent = parseFloat(strategy.maxPortfolioRiskPercent);
      const remainingRiskPercent = maxRiskPercent - portfolioRisk.riskPercentage;
      
      if (remainingRiskPercent < 0.05) {
        console.log(`🚫 PORTFOLIO RISK LIMIT (Fallback): No remaining risk budget (remaining: ${remainingRiskPercent.toFixed(2)}%)`);
        
        wsBroadcaster.broadcastTradeBlock({
          blocked: true,
          reason: `Risk limit: No remaining budget (${remainingRiskPercent.toFixed(2)}%)`,
          type: 'risk_limit'
        });
        
        // Log error to database for audit trail
        await this.logTradeEntryError({
          strategy,
          symbol: liquidation.symbol,
          side: positionSide,
          attemptType: 'entry',
          reason: 'risk_limit_exceeded',
          errorDetails: `No remaining risk budget (fallback check): ${remainingRiskPercent.toFixed(2)}%`,
          liquidationValue: parseFloat(liquidation.value),
        });
        
        return false;
      }
      
      console.log(`✅ Risk check passed (Fallback): remaining budget ${remainingRiskPercent.toFixed(1)}% available`);
      riskCheckPassed = true; // Fallback check passed
    }
    
    // Ensure risk check was performed
    if (!riskCheckPassed) {
      console.error('❌ CRITICAL: Risk check bypassed - blocking entry for safety');
      return false;
    }
    
    // CASCADE DETECTOR: Get metrics for informational logging (RQ is informational only, not used for gating)
    const aggregateStatus = cascadeDetectorService.getAggregateStatus();
    
    // Log aggregate metrics for information (reversal quality does not gate trades)
    console.log(`📊 Cascade Metrics [${liquidation.symbol}]: RQ ${aggregateStatus.avgReversalQuality.toFixed(1)}/${aggregateStatus.avgRqThreshold.toFixed(1)}, Volatility: ${aggregateStatus.volatilityRegime} (RET: ${aggregateStatus.avgVolatilityRET.toFixed(1)}), Score: ${aggregateStatus.avgScore.toFixed(1)}, Symbols: ${aggregateStatus.symbolCount}`);
    
    // Calculate percentile threshold using ALL symbol history (same as UI badge)
    // This ensures bot entry logic matches what user sees in the UI
    const currentLiquidationValue = parseFloat(liquidation.value);
    
    // Query database for ALL historical liquidations for this symbol (matching UI's approach)
    // Frontend fetches limit=10000, so we do the same for consistent percentile calculations
    const symbolHistory = await storage.getLiquidationsBySymbol([liquidation.symbol], 10000);
    if (!symbolHistory || symbolHistory.length === 0) {
      console.log(`❌ No historical liquidations found for ${liquidation.symbol} - entry filtered`);
      // Note: No historical data is per-symbol filter, NOT a system-wide block
      return false;
    }
    
    // Sort all historical values to calculate percentile (same as UI)
    const allHistoricalValues = symbolHistory.map(liq => parseFloat(liq.value)).sort((a, b) => a - b);
    
    // Calculate current liquidation's percentile rank (same algorithm as UI)
    // Binary search to find how many liquidations are strictly below current value
    let left = 0, right = allHistoricalValues.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (allHistoricalValues[mid] <= currentLiquidationValue) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    const belowCount = left;
    const currentPercentile = allHistoricalValues.length > 1
      ? Math.round((belowCount / allHistoricalValues.length) * 100)
      : 100;
    
    // Check if current percentile meets or exceeds threshold
    // Example: 60% threshold means only enter if at 60th percentile or higher (top 40%)
    const shouldEnter = currentPercentile >= strategy.percentileThreshold;
    
    if (shouldEnter) {
      console.log(`✅ Percentile PASSED: $${currentLiquidationValue.toFixed(2)} is at ${currentPercentile}th percentile (≥ ${strategy.percentileThreshold}% threshold)`);
      console.log(`   📊 Compared against ${allHistoricalValues.length} historical ${liquidation.symbol} liquidations: range $${allHistoricalValues[0].toFixed(2)}-$${allHistoricalValues[allHistoricalValues.length-1].toFixed(2)}`);
      console.log(`   ✨ Entering top ${100 - strategy.percentileThreshold}% of liquidations (${strategy.percentileThreshold}th percentile and above)`);
      
      // ATOMICALLY set cooldown IMMEDIATELY when decision is made (before returning)
      // This prevents race condition where two threads both pass the check before either sets cooldown
      this.lastFillTime.set(cooldownKey, Date.now());
      console.log(`🔒 Entry cooldown locked ATOMICALLY for ${liquidation.symbol} ${positionSide} (${this.fillCooldownMs / 1000}s)`);
    } else {
      console.log(`❌ Percentile FILTERED: $${currentLiquidationValue.toFixed(2)} is at ${currentPercentile}th percentile (< ${strategy.percentileThreshold}% threshold)`);
      console.log(`   📊 Need at least ${strategy.percentileThreshold}th percentile to enter (currently in bottom ${strategy.percentileThreshold}%)`);
      // Note: Percentile is a per-liquidation filter, NOT a system-wide block
      // So we don't broadcast trade_block for percentile failures
    }
    
    return shouldEnter;
  }

  // Determine if we should add a layer to existing position
  private async shouldAddLayer(
    strategy: Strategy, 
    position: Position, 
    liquidation: Liquidation
  ): Promise<boolean> {
    // Check if we haven't exceeded max layers (including pending orders)
    const pendingLayers = this.pendingLayerOrders.get(position.id);
    const pendingCount = pendingLayers ? pendingLayers.size : 0;
    const totalLayers = position.layersFilled + pendingCount;
    
    if (totalLayers >= strategy.maxLayers) {
      console.log(`🚫 Max layers reached: ${position.layersFilled} filled + ${pendingCount} pending = ${totalLayers}/${strategy.maxLayers}`);
      return false;
    }

    // PORTFOLIO RISK LIMITS CHECK: Block new layers if they WOULD exceed risk limit
    // Note: Position count limit doesn't apply to layers (we're adding to existing position)
    let layerRiskCheckPassed = false;
    try {
      const session = await storage.getTradeSession(position.sessionId);
      if (!session) {
        throw new Error('Session not found for risk check');
      }
      
      const portfolioRisk = await this.calculatePortfolioRisk(strategy, session);
      
      // Calculate ACTUAL projected risk using DCA calculator
      let currentBalance = parseFloat(session.currentBalance);
      const exchangeBalance = await this.getExchangeAvailableBalance(strategy);
      if (exchangeBalance !== null) {
        currentBalance = exchangeBalance;
      }
      
      const maxRiskPercent = parseFloat(strategy.maxPortfolioRiskPercent);
      const remainingRiskPercent = maxRiskPercent - portfolioRisk.riskPercentage;
      
      // Check if there's any remaining risk budget (with 0.05% minimum threshold)
      if (remainingRiskPercent < 0.05) {
        console.log(`🚫 PORTFOLIO RISK LIMIT (Layer): No remaining risk budget (current: ${portfolioRisk.riskPercentage.toFixed(1)}%, max: ${maxRiskPercent}%, remaining: ${remainingRiskPercent.toFixed(2)}%)`);
        return false;
      }
      
      // Import DCA function
      const { calculateNextLayer } = await import('./dca-calculator');
      const { getStrategyWithDCA } = await import('./dca-sql');
      
      // Fetch DCA parameters to get strategy's max layer risk
      const strategyWithDCA = await getStrategyWithDCA(strategy.id);
      const strategyMaxLayerRisk = strategyWithDCA?.dca_max_risk_percent ? parseFloat(String(strategyWithDCA.dca_max_risk_percent)) : 10.0;
      
      // Determine effective max risk for this layer
      const effectiveMaxRisk = Math.min(strategyMaxLayerRisk, remainingRiskPercent);
      
      console.log(`💰 Layer Risk Budget: current=${portfolioRisk.riskPercentage.toFixed(1)}%, max=${maxRiskPercent}%, remaining=${remainingRiskPercent.toFixed(1)}%, effective=${effectiveMaxRisk.toFixed(1)}% (${effectiveMaxRisk < strategyMaxLayerRisk ? 'SCALED DOWN' : 'normal'})`);
      
      // Calculate the next layer parameters with risk override if needed
      const nextLayerResult = await calculateNextLayer(
        strategy,
        currentBalance,
        position.leverage,
        position.symbol,
        position.side as 'long' | 'short',
        position.layersFilled,
        parseFloat(position.initialEntryPrice || position.avgEntryPrice),
        position.dcaBaseSize ? parseFloat(position.dcaBaseSize) : null,
        process.env.ASTER_API_KEY,
        process.env.ASTER_SECRET_KEY,
        effectiveMaxRisk < strategyMaxLayerRisk ? effectiveMaxRisk : undefined
      );
      
      if (!nextLayerResult) {
        throw new Error('DCA calculator could not calculate next layer');
      }
      
      const { price: nextLayerPrice, quantity: nextLayerQuantity, takeProfitPrice, stopLossPrice } = nextLayerResult;
      
      // Calculate dollar risk for this layer
      const lossPerUnit = position.side === 'long'
        ? nextLayerPrice - stopLossPrice
        : stopLossPrice - nextLayerPrice;
      
      const layerRiskDollars = lossPerUnit * nextLayerQuantity;
      const layerRiskPercent = (layerRiskDollars / currentBalance) * 100;
      const projectedRiskPercentage = portfolioRisk.riskPercentage + layerRiskPercent;
      
      // CRITICAL: Validate that calculations produced finite numbers (not NaN or Infinity)
      if (!Number.isFinite(layerRiskPercent) || !Number.isFinite(projectedRiskPercentage)) {
        throw new Error(`Invalid layer risk calculation: layerRisk=${layerRiskPercent}, projected=${projectedRiskPercentage}`);
      }
      
      // Final safety check: ensure projected risk doesn't exceed max (account for float precision)
      if (projectedRiskPercentage > maxRiskPercent + 0.01) { // Allow 0.01% tolerance for float precision
        console.log(`🚫 PORTFOLIO RISK LIMIT (Layer): Projected risk still exceeds max after scaling (projected: ${projectedRiskPercentage.toFixed(1)}% > max: ${maxRiskPercent}%)`);
        
        // Log error to database for audit trail
        await this.logTradeEntryError({
          strategy,
          symbol: liquidation.symbol,
          side: position.side,
          attemptType: 'layer',
          reason: 'risk_limit_exceeded',
          errorDetails: `Projected risk ${projectedRiskPercentage.toFixed(1)}% exceeds max ${maxRiskPercent}%`,
          liquidationValue: parseFloat(liquidation.value),
        });
        
        return false;
      }
      
      console.log(`✅ Layer risk check passed: projected=${projectedRiskPercentage.toFixed(1)}% ≤ max=${maxRiskPercent}%`);
      
      layerRiskCheckPassed = true;
    } catch (error) {
      console.error('⚠️ Error calculating layer risk, using conservative fallback:', error);
      // MANDATORY fallback check - always enforce risk limit even if DCA calculation fails
      try {
        const session = await storage.getTradeSession(position.sessionId);
        if (session) {
          const portfolioRisk = await this.calculatePortfolioRisk(strategy, session);
          const maxRiskPercent = parseFloat(strategy.maxPortfolioRiskPercent);
          const remainingRiskPercent = maxRiskPercent - portfolioRisk.riskPercentage;
          
          if (remainingRiskPercent < 0.05) {
            console.log(`🚫 PORTFOLIO RISK LIMIT (Layer/Fallback): No remaining risk budget (remaining: ${remainingRiskPercent.toFixed(2)}%)`);
            
            // Log error to database for audit trail
            await this.logTradeEntryError({
              strategy,
              symbol: liquidation.symbol,
              side: position.side,
              attemptType: 'layer',
              reason: 'risk_limit_exceeded',
              errorDetails: `No remaining risk budget (fallback check): ${remainingRiskPercent.toFixed(2)}%`,
              liquidationValue: parseFloat(liquidation.value),
            });
            
            return false;
          }
          
          console.log(`✅ Layer risk check passed (Fallback): remaining budget ${remainingRiskPercent.toFixed(1)}% available`);
          layerRiskCheckPassed = true; // Fallback check passed
        }
      } catch (fallbackError) {
        console.error('❌ CRITICAL: Fallback risk check failed for layer:', fallbackError);
      }
    }
    
    // Ensure risk check was performed
    if (!layerRiskCheckPassed) {
      console.error('❌ CRITICAL: Layer risk check bypassed - blocking layer for safety');
      return false;
    }

    // CASCADE DETECTOR: Get metrics for informational logging (RQ is informational only, not used for gating)
    const aggregateStatus = cascadeDetectorService.getAggregateStatus();
    
    // Log aggregate metrics for information (reversal quality does not gate layers)
    console.log(`📊 Cascade Metrics (Layer) [${liquidation.symbol}]: RQ ${aggregateStatus.avgReversalQuality.toFixed(1)}/${aggregateStatus.avgRqThreshold.toFixed(1)}, Volatility: ${aggregateStatus.volatilityRegime} (RET: ${aggregateStatus.avgVolatilityRET.toFixed(1)}), Score: ${aggregateStatus.avgScore.toFixed(1)}, Symbols: ${aggregateStatus.symbolCount}`);

    // Calculate percentile using ALL symbol history (same as entry and UI badge)
    const currentLiquidationValue = parseFloat(liquidation.value);
    
    // Query database for ALL historical liquidations for this symbol (matching UI's approach)
    // Frontend fetches limit=10000, so we do the same for consistent percentile calculations
    const symbolHistory = await storage.getLiquidationsBySymbol([liquidation.symbol], 10000);
    if (!symbolHistory || symbolHistory.length === 0) {
      console.log(`❌ No historical liquidations found for ${liquidation.symbol} - layer blocked`);
      return false;
    }
    
    // Sort all historical values to calculate percentile (same as UI)
    const allHistoricalValues = symbolHistory.map(liq => parseFloat(liq.value)).sort((a, b) => a - b);
    
    // Calculate current liquidation's percentile rank (same algorithm as UI and entry)
    let left = 0, right = allHistoricalValues.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (allHistoricalValues[mid] <= currentLiquidationValue) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    const belowCount = left;
    const currentPercentile = allHistoricalValues.length > 1
      ? Math.round((belowCount / allHistoricalValues.length) * 100)
      : 100;
    
    // Check if current percentile meets or exceeds threshold
    const shouldAddLayer = currentPercentile >= strategy.percentileThreshold;
    
    if (shouldAddLayer) {
      console.log(`✅ Layer APPROVED: $${currentLiquidationValue.toFixed(2)} is at ${currentPercentile}th percentile (≥ ${strategy.percentileThreshold}% threshold)`);
    } else {
      console.log(`❌ Layer BLOCKED: $${currentLiquidationValue.toFixed(2)} is at ${currentPercentile}th percentile (< ${strategy.percentileThreshold}% threshold)`);
    }
    
    return shouldAddLayer;
  }

  // Fetch available balance from exchange (for live trading)
  private async getExchangeAvailableBalance(strategy: Strategy): Promise<number | null> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        console.error('❌ Aster DEX API keys not configured');
        return null;
      }

      const timestamp = Date.now();
      const params = `timestamp=${timestamp}`;
      const signature = createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/account?${params}&signature=${signature}`,
        {
          headers: { 'X-MBX-APIKEY': apiKey },
        }
      );

      if (!response.ok) {
        let errorMessage = '';
        try {
          const errorText = await response.text();
          errorMessage = errorText || response.statusText;
        } catch {
          errorMessage = response.statusText;
        }
        
        if (response.status === 429) {
          console.error('⚠️ Rate limit exceeded for Aster DEX account endpoint');
        } else if (response.status === 401 || response.status === 403) {
          console.error('🔑 Authentication failed for Aster DEX - check API keys:', errorMessage);
        } else {
          console.error(`❌ Failed to fetch exchange account (${response.status}):`, errorMessage);
        }
        return null;
      }

      const data = await response.json();
      // CRITICAL: Use totalWalletBalance (total account equity) NOT availableBalance
      // Risk must be calculated on total account value, not just leftover funds after positions are open
      const totalWalletBalance = parseFloat(data.totalWalletBalance || '0');
      console.log(`💰 Exchange total wallet balance (for risk calc): $${totalWalletBalance.toFixed(2)}`);
      return totalWalletBalance;
    } catch (error) {
      console.error('❌ Error fetching exchange balance:', error);
      return null;
    }
  }

  // Reconcile stale positions: close database positions that are already closed on the exchange
  private async reconcileStalePositions(sessionId: string, strategy: Strategy): Promise<void> {
    try {
      console.log('🔄 Starting stale position reconciliation...');
      
      // Get live positions from exchange
      const livePositions = await this.getExchangePositions();
      if (!livePositions) {
        console.log('⏭️ Skipping position reconciliation - could not fetch live positions');
        return;
      }
      
      console.log(`📊 Found ${livePositions.length} live positions on exchange`);
      
      // Get open positions from database
      const dbPositions = await storage.getOpenPositions(sessionId);
      console.log(`📊 Found ${dbPositions.length} open positions in database`);
      
      if (dbPositions.length === 0) {
        console.log('✅ No database positions to reconcile');
        return; // No positions to reconcile
      }
      
      // Create a map of live positions by symbol+side for quick lookup
      const livePositionMap = new Map<string, any>();
      for (const livePos of livePositions) {
        if (Math.abs(parseFloat(livePos.positionAmt)) > 0) {
          const side = parseFloat(livePos.positionAmt) > 0 ? 'long' : 'short';
          const key = `${livePos.symbol}-${side}`;
          livePositionMap.set(key, livePos);
        }
      }
      
      // Check each database position against live positions
      let closedCount = 0;
      for (const dbPos of dbPositions) {
        const key = `${dbPos.symbol}-${dbPos.side}`;
        const livePos = livePositionMap.get(key);
        
        // If position exists in DB but not on exchange (or has zero quantity), it's stale
        if (!livePos) {
          console.log(`🧹 Auto-closing stale position: ${dbPos.symbol} ${dbPos.side} (closed on exchange but open in DB)`);
          
          // Close the position in the database
          await storage.updatePosition(dbPos.id, {
            isOpen: false,
            closedAt: new Date(),
            unrealizedPnl: '0', // Already realized on exchange
          });
          
          closedCount++;
        }
      }
      
      if (closedCount > 0) {
        console.log(`✅ Reconciliation complete: auto-closed ${closedCount} stale position(s)`);
      }
    } catch (error) {
      console.error('⚠️ Error reconciling stale positions:', error);
      // Don't throw - allow portfolio calculation to continue
    }
  }

  // Calculate current portfolio risk metrics for gating decisions
  private async calculatePortfolioRisk(strategy: Strategy, session: TradeSession): Promise<{ openPositionCount: number; riskPercentage: number; totalRisk: number }> {
    try {
      // AUTOMATIC POSITION RECONCILIATION: Close stale database positions before calculating risk
      // This prevents ghost positions (closed on exchange but open in DB) from blocking trades
      await this.reconcileStalePositions(session.id, strategy);
      
      // Get all open positions for this session
      const openPositions = await storage.getOpenPositions(session.id);
      
      // CRITICAL: Count UNIQUE symbol/side combinations to handle potential duplicate records
      // Use a Map to deduplicate and aggregate position data by symbol+side
      const uniquePositions = new Map<string, Position>();
      
      for (const pos of openPositions) {
        const key = `${pos.symbol}-${pos.side}`;
        const existing = uniquePositions.get(key);
        
        // Keep the position with the most recent update (or higher quantity if same time)
        if (!existing || pos.updatedAt > existing.updatedAt || 
            (pos.updatedAt === existing.updatedAt && parseFloat(pos.totalQuantity) > parseFloat(existing.totalQuantity))) {
          uniquePositions.set(key, pos);
        }
      }
      
      // Count UNIQUE positions (deduped by symbol+side)
      const openPositionCount = uniquePositions.size;
      const deduplicatedPositions = Array.from(uniquePositions.values());
      
      // Log what positions we're calculating risk for
      console.log(`🔍 Portfolio Risk Calculation: Found ${openPositions.length} records (${openPositionCount} unique positions)`);
      deduplicatedPositions.forEach(pos => {
        console.log(`   - ${pos.symbol} ${pos.side}: qty=${pos.totalQuantity}, avgPrice=${pos.avgEntryPrice}, id=${pos.id}`);
      });
      
      // Warn if duplicates detected
      if (openPositions.length > openPositionCount) {
        console.warn(`⚠️ DUPLICATE POSITIONS DETECTED: ${openPositions.length} records but only ${openPositionCount} unique symbol/side combinations`);
      }
      
      // If no positions, return zero risk
      if (openPositionCount === 0) {
        return { openPositionCount: 0, riskPercentage: 0, totalRisk: 0 };
      }
      
      // Get current account balance (use exchange balance for accuracy)
      let currentBalance = parseFloat(session.currentBalance);
      const exchangeBalance = await this.getExchangeAvailableBalance(strategy);
      if (exchangeBalance !== null) {
        currentBalance = exchangeBalance;
      }
      
      if (currentBalance <= 0) {
        console.warn('⚠️ Invalid account balance for risk calculation');
        return { openPositionCount, riskPercentage: 0, totalRisk: 0 };
      }
      
      console.log(`   Balance: $${currentBalance.toFixed(2)}, SL%: ${strategy.stopLossPercent}%`);
      
      // Calculate stop loss percentage from strategy
      const stopLossPercent = parseFloat(strategy.stopLossPercent);
      
      // Calculate total potential loss across all UNIQUE positions (use deduplicated array)
      const totalPotentialLoss = deduplicatedPositions.reduce((sum, position) => {
        const entryPrice = parseFloat(position.avgEntryPrice);
        const quantity = Math.abs(parseFloat(position.totalQuantity));
        const isLong = position.side === 'long';
        
        // Calculate stop loss price based on entry price and strategy SL%
        const stopLossPrice = isLong 
          ? entryPrice * (1 - stopLossPercent / 100)
          : entryPrice * (1 + stopLossPercent / 100);
        
        // Calculate loss per unit
        const lossPerUnit = isLong 
          ? entryPrice - stopLossPrice
          : stopLossPrice - entryPrice;
        
        // Calculate total position loss
        const positionLoss = lossPerUnit * quantity;
        console.log(`   ${position.symbol}: lossPerUnit=$${lossPerUnit.toFixed(4)}, totalLoss=$${positionLoss.toFixed(2)}`);
        return sum + positionLoss;
      }, 0);
      
      // Calculate risk as percentage of account balance
      const riskPercentage = (totalPotentialLoss / currentBalance) * 100;
      console.log(`   💰 Total Risk: $${totalPotentialLoss.toFixed(2)} = ${riskPercentage.toFixed(1)}% of balance`);
      
      return { 
        openPositionCount, 
        riskPercentage, 
        totalRisk: totalPotentialLoss 
      };
    } catch (error) {
      console.error('❌ Error calculating portfolio risk:', error);
      return { openPositionCount: 0, riskPercentage: 0, totalRisk: 0 };
    }
  }

  // Execute initial position entry with smart order placement
  private async executeEntry(strategy: Strategy, session: TradeSession, liquidation: Liquidation, positionSide: string) {
    try {
      // Counter-trade: if LONG liquidated → go LONG (buy the dip), if SHORT liquidated → go SHORT (sell the rally)
      const side = liquidation.side === 'long' ? 'buy' : 'sell';
      const orderSide = liquidation.side === 'long' ? 'long' : 'short';
      const price = parseFloat(liquidation.price);
      
      // Calculate available capital based on account usage percentage
      // ALWAYS use actual exchange balance for both paper and live modes
      // This ensures paper trading mirrors live trading exactly
      let currentBalance = parseFloat(session.currentBalance);
      const exchangeBalance = await this.getExchangeAvailableBalance(strategy);
      if (exchangeBalance !== null) {
        currentBalance = exchangeBalance;
        console.log(`📊 Using exchange balance: $${currentBalance.toFixed(2)}`);
      } else {
        console.warn('⚠️ Failed to fetch exchange balance, falling back to session balance');
      }
      
      const marginPercent = parseFloat(strategy.marginAmount);
      const availableCapital = (marginPercent / 100) * currentBalance;
      
      // Use DCA calculator to determine optimal position sizing for Layer 1
      const leverage = strategy.leverage;
      const atrPercent = await calculateATRPercent(liquidation.symbol, 10, process.env.ASTER_API_KEY, process.env.ASTER_SECRET_KEY);
      
      // Import DCA calculator
      const { calculateDCALevels } = await import('./dca-calculator');
      const { getStrategyWithDCA } = await import('./dca-sql');
      
      // Fetch DCA parameters
      const strategyWithDCA = await getStrategyWithDCA(strategy.id);
      if (!strategyWithDCA) {
        console.error(`⚠️  Strategy ${strategy.id} missing DCA parameters, skipping entry`);
        return;
      }
      
      // SAFETY CHECK: Validate all DCA parameters are configured (not null)
      if (
        strategyWithDCA.dca_start_step_percent == null ||
        strategyWithDCA.dca_spacing_convexity == null ||
        strategyWithDCA.dca_size_growth == null ||
        strategyWithDCA.dca_max_risk_percent == null ||
        strategyWithDCA.dca_volatility_ref == null ||
        strategyWithDCA.dca_exit_cushion_multiplier == null
      ) {
        console.error(`❌ DCA parameters NOT configured for strategy ${strategy.id}`);
        console.error(`   Values: startStep=${strategyWithDCA.dca_start_step_percent}, convexity=${strategyWithDCA.dca_spacing_convexity}, growth=${strategyWithDCA.dca_size_growth}`);
        console.error(`   Risk: maxRisk=${strategyWithDCA.dca_max_risk_percent}, volatility=${strategyWithDCA.dca_volatility_ref}, cushion=${strategyWithDCA.dca_exit_cushion_multiplier}`);
        console.error(`   ⚠️  SKIPPING TRADE - Configure DCA settings in Global Settings to enable trading`);
        return;
      }
      
      // Build full strategy with DCA params and adaptive TP/SL settings
      const fullStrategy = {
        ...strategy,
        dcaStartStepPercent: String(strategyWithDCA.dca_start_step_percent),
        dcaSpacingConvexity: String(strategyWithDCA.dca_spacing_convexity),
        dcaSizeGrowth: String(strategyWithDCA.dca_size_growth),
        dcaMaxRiskPercent: String(strategyWithDCA.dca_max_risk_percent),
        dcaVolatilityRef: String(strategyWithDCA.dca_volatility_ref),
        dcaExitCushionMultiplier: String(strategyWithDCA.dca_exit_cushion_multiplier),
      };
      
      // Calculate all DCA levels - we'll use Level 1 for initial entry
      const dcaResult = calculateDCALevels(fullStrategy, {
        entryPrice: price,
        side: positionSide as 'long' | 'short',
        currentBalance,
        leverage,
        atrPercent,
      });
      
      const firstLevel = dcaResult.levels[0];
      if (!firstLevel) {
        console.error(`⚠️  DCA calculator failed to generate Level 1, skipping entry`);
        return;
      }
      
      const quantity = firstLevel.quantity;
      
      // Store q1 (base layer size) for this position to ensure consistent sizing across all layers
      const q1Key = `${session.id}-${liquidation.symbol}-${positionSide}`;
      this.pendingQ1Values.set(q1Key, dcaResult.q1);
      console.log(`💾 Stored q1=${dcaResult.q1.toFixed(6)} for ${q1Key}`);
      
      // Store first layer TP/SL data for position layer creation
      this.pendingFirstLayerData.set(q1Key, {
        takeProfitPrice: firstLevel.takeProfitPrice,
        stopLossPrice: firstLevel.stopLossPrice,
        entryPrice: firstLevel.price,
        quantity: firstLevel.quantity
      });
      console.log(`💾 Stored Layer 1 TP/SL: TP=$${firstLevel.takeProfitPrice.toFixed(6)}, SL=$${firstLevel.stopLossPrice.toFixed(6)}`);

      // CRITICAL SAFETY CHECK: Validate position size is valid
      if (!Number.isFinite(quantity) || isNaN(quantity) || quantity <= 0) {
        console.error(`❌ INVALID POSITION SIZE calculated: ${quantity}`);
        console.error(`   This indicates a problem with DCA parameters or calculations`);
        console.error(`   ⚠️  ABORTING TRADE - Will not execute order with invalid size`);
        return;
      }
      
      // SAFETY CHECK: Ensure position size is reasonable (not accidentally huge)
      const notionalValue = quantity * price * leverage;
      const percentOfBalance = (notionalValue / leverage / currentBalance) * 100;
      if (percentOfBalance > 50) {
        console.error(`❌ POSITION SIZE TOO LARGE: ${quantity} units = $${notionalValue.toFixed(2)} notional (${percentOfBalance.toFixed(1)}% of balance)`);
        console.error(`   Expected starting size should be < 5% of balance`);
        console.error(`   ⚠️  ABORTING TRADE - Position size exceeds safety threshold`);
        return;
      }

      console.log(`🎯 Entering ${orderSide} position for ${liquidation.symbol} at $${price} using DCA Layer 1 (qty: ${quantity.toFixed(6)} units)`);

      // Set leverage on exchange if leverage has changed
      const currentLeverage = this.leverageSetForSymbols.get(liquidation.symbol);
      if (currentLeverage !== leverage) {
        console.log(`⚙️ Setting ${liquidation.symbol} leverage to ${leverage}x on exchange...`);
        const leverageSet = await this.setLeverage(liquidation.symbol, leverage);
        if (leverageSet) {
          this.leverageSetForSymbols.set(liquidation.symbol, leverage);
        } else {
          console.error(`❌ Failed to set leverage for ${liquidation.symbol}, aborting order to prevent trading with wrong leverage`);
          
          // Log error to database for audit trail
          await this.logTradeEntryError({
            strategy,
            symbol: liquidation.symbol,
            side: positionSide,
            attemptType: 'entry',
            reason: 'leverage_set_failed',
            errorDetails: `Failed to configure ${leverage}x leverage on exchange`,
            liquidationValue: parseFloat(liquidation.value),
          });
          
          throw new Error(`Failed to set leverage for ${liquidation.symbol}`);
        }
      }

      // Apply order delay for smart placement
      if (strategy.orderDelayMs > 0) {
        console.log(`⏱️ Applying ${strategy.orderDelayMs}ms order delay...`);
        await new Promise(resolve => setTimeout(resolve, strategy.orderDelayMs));
      }

      // Place order with price chasing
      // Only pass positionSide if the EXCHANGE is in dual mode (not based on strategy settings)
      await this.placeOrderWithRetry({
        strategy,
        session,
        symbol: liquidation.symbol,
        side,
        orderSide,
        quantity,
        targetPrice: price,
        triggerLiquidationId: liquidation.id,
        layerNumber: 1,
        positionSide: this.exchangePositionMode === 'dual' ? positionSide : undefined, // Only include if EXCHANGE is in dual mode
      });

    } catch (error) {
      console.error('❌ Error executing entry:', error);
    }
  }

  // Execute position layer
  private async executeLayer(
    strategy: Strategy, 
    session: TradeSession, 
    position: Position, 
    liquidation: Liquidation,
    positionSide: string
  ) {
    try {
      // ATOMIC COOLDOWN CHECK: Must be FIRST to prevent race conditions
      // Check cooldown and set it atomically if passing
      const cooldownKey = `${session.id}-${liquidation.symbol}-${positionSide}`;
      const lastFill = this.lastFillTime.get(cooldownKey);
      if (lastFill) {
        const timeSinceLastFill = Date.now() - lastFill;
        if (timeSinceLastFill < this.fillCooldownMs) {
          const waitTime = ((this.fillCooldownMs - timeSinceLastFill) / 1000).toFixed(1);
          console.log(`⏸️ Layer cooldown active for ${liquidation.symbol} ${positionSide} - wait ${waitTime}s before next layer`);
          return;
        }
      }
      
      // ATOMICALLY set cooldown IMMEDIATELY after passing check
      // This prevents race condition where two threads both pass the check before either sets cooldown
      this.lastFillTime.set(cooldownKey, Date.now());
      console.log(`🔒 Layer cooldown locked ATOMICALLY for ${liquidation.symbol} ${positionSide} (${this.fillCooldownMs / 1000}s)`);
      
      const side = position.side === 'long' ? 'buy' : 'sell';
      const nextLayer = position.layersFilled + 1;
      
      // Check if we already have a pending order for this layer
      const pendingLayers = this.pendingLayerOrders.get(position.id);
      if (pendingLayers && pendingLayers.has(nextLayer)) {
        console.log(`⏭️ Skipping layer ${nextLayer} for ${liquidation.symbol} - already pending`);
        return;
      }
      
      // Mark this layer as pending
      if (!this.pendingLayerOrders.has(position.id)) {
        this.pendingLayerOrders.set(position.id, new Set());
      }
      this.pendingLayerOrders.get(position.id)!.add(nextLayer);
      
      // Get current balance for DCA calculations
      let currentBalance = parseFloat(session.currentBalance);
      const exchangeBalance = await this.getExchangeAvailableBalance(strategy);
      if (exchangeBalance !== null) {
        currentBalance = exchangeBalance;
        console.log(`📊 Using exchange balance (layer ${nextLayer}): $${currentBalance.toFixed(2)}`);
      } else {
        console.warn('⚠️ Failed to fetch exchange balance for layer, falling back to session balance');
      }
      
      // Get initial entry price (P0) for DCA calculations
      // This is the price of the first entry, used as anchor for all DCA levels
      const initialEntryPrice = position.initialEntryPrice 
        ? parseFloat(position.initialEntryPrice)
        : parseFloat(position.avgEntryPrice); // Fallback for existing positions without initialEntryPrice
      
      // Get stored q1 (base layer size) for consistent exponential sizing
      const storedQ1 = position.dcaBaseSize ? parseFloat(position.dcaBaseSize) : null;
      if (storedQ1) {
        console.log(`💾 Position has stored q1=${storedQ1.toFixed(6)} - will use for consistent layer sizing`);
      } else {
        console.warn(`⚠️ Position missing dcaBaseSize - will recalculate (may cause inconsistent sizing)`);
      }
      
      // Calculate next DCA layer using mathematical framework
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      console.log(`🔍 DCA DIRECTION DEBUG: symbol=${liquidation.symbol}, position.side=${position.side}, liquidation.side=${liquidation.side}, initialEntryPrice=$${initialEntryPrice.toFixed(6)}`);
      
      const nextLayerCalc = await calculateNextLayer(
        strategy,
        currentBalance,
        strategy.leverage,
        liquidation.symbol,
        position.side as 'long' | 'short',
        position.layersFilled,
        initialEntryPrice,
        storedQ1, // Pass stored q1 for consistent exponential sizing
        apiKey,
        secretKey
      );
      
      if (!nextLayerCalc) {
        console.log(`⚠️ Cannot calculate next layer for ${liquidation.symbol} - max layers reached or calculation failed`);
        // Remove pending marker
        const layers = this.pendingLayerOrders.get(position.id);
        if (layers) {
          layers.delete(nextLayer);
          if (layers.size === 0) {
            this.pendingLayerOrders.delete(position.id);
          }
        }
        return;
      }
      
      const { price, quantity, takeProfitPrice, stopLossPrice, level } = nextLayerCalc;
      
      console.log(`📐 DCA Layer ${nextLayer} for ${liquidation.symbol}: Price=$${price.toFixed(6)}, Qty=${quantity.toFixed(6)} (P0=$${initialEntryPrice.toFixed(6)})`);
      
      // Store layer TP/SL data for position layer creation after fill
      const layerKey = `${position.id}-${nextLayer}`;
      this.pendingFirstLayerData.set(layerKey, {
        takeProfitPrice,
        stopLossPrice,
        entryPrice: price,
        quantity
      });
      console.log(`💾 Stored Layer ${nextLayer} TP/SL: TP=$${takeProfitPrice.toFixed(6)}, SL=$${stopLossPrice.toFixed(6)}`);

      // SAFETY CHECK: Ensure new layer is at a better price than the last layer
      if (position.lastLayerPrice) {
        const lastPrice = parseFloat(position.lastLayerPrice);
        const isWorsePriceLong = position.side === 'long' && price >= lastPrice;
        const isWorsePriceShort = position.side === 'short' && price <= lastPrice;
        
        if (isWorsePriceLong || isWorsePriceShort) {
          console.log(`🚫 DCA SAFETY BLOCK: Layer ${nextLayer} rejected - price $${price.toFixed(6)} is worse than last layer $${lastPrice.toFixed(6)} for ${position.side.toUpperCase()} position`);
          
          // Remove pending marker
          const layers = this.pendingLayerOrders.get(position.id);
          if (layers) {
            layers.delete(nextLayer);
            if (layers.size === 0) {
              this.pendingLayerOrders.delete(position.id);
            }
          }
          return;
        }
        
        console.log(`✅ DCA Price Check: $${price.toFixed(6)} is better than last $${lastPrice.toFixed(6)} for ${position.side.toUpperCase()}`);
      }

      // Apply order delay for smart placement
      if (strategy.orderDelayMs > 0) {
        console.log(`⏱️ Applying ${strategy.orderDelayMs}ms order delay for layer ${nextLayer}...`);
        await new Promise(resolve => setTimeout(resolve, strategy.orderDelayMs));
      }

      try {
        // Place layer order with price chasing
        // Only pass positionSide if the EXCHANGE is in dual mode (not based on strategy settings)
        await this.placeOrderWithRetry({
          strategy,
          session,
          symbol: liquidation.symbol,
          side,
          orderSide: position.side,
          quantity,
          targetPrice: price,
          triggerLiquidationId: liquidation.id,
          layerNumber: nextLayer,
          positionId: position.id,
          positionSide: this.exchangePositionMode === 'dual' ? positionSide : undefined, // Only include if EXCHANGE is in dual mode
        });

        console.log(`✅ Layer ${nextLayer} completed for ${liquidation.symbol}`);
      } finally {
        // Remove the pending layer marker regardless of success/failure
        const layers = this.pendingLayerOrders.get(position.id);
        if (layers) {
          layers.delete(nextLayer);
          if (layers.size === 0) {
            this.pendingLayerOrders.delete(position.id);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error executing layer:', error);
    }
  }

  // Smart order placement with price chasing retry logic
  private async placeOrderWithRetry(params: {
    strategy: Strategy;
    session: TradeSession;
    symbol: string;
    side: string;
    orderSide: string;
    quantity: number;
    targetPrice: number;
    triggerLiquidationId: string;
    layerNumber: number;
    positionId?: string;
    positionSide?: string; // 'long' or 'short' for hedge mode
  }) {
    const { strategy, session, symbol, side, orderSide, quantity, targetPrice, triggerLiquidationId, layerNumber, positionId, positionSide } = params;
    const maxRetryDuration = strategy.maxRetryDurationMs;
    const slippageTolerance = parseFloat(strategy.slippageTolerancePercent) / 100;
    const startTime = Date.now();
    
    console.log(`🎯 Starting smart order placement: ${quantity.toFixed(4)} ${symbol} at $${targetPrice} (max retry: ${maxRetryDuration}ms, slippage: ${(slippageTolerance * 100).toFixed(2)}%)`);

    while (Date.now() - startTime < maxRetryDuration) {
      try {
        // Fetch real-time current price from Aster DEX API
        let currentPrice = targetPrice; // fallback to target price
        try {
          const asterApiUrl = `https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${symbol}`;
          const priceResponse = await fetch(asterApiUrl);
          
          if (priceResponse.ok) {
            const priceData = await priceResponse.json();
            currentPrice = parseFloat(priceData.price);
          }
        } catch (apiError) {
          console.log(`⚠️ Using target price as fallback (API unavailable)`);
        }
        
        // Check if current price is within slippage tolerance
        const priceDeviation = Math.abs(currentPrice - targetPrice) / targetPrice;
        
        // Price chase mode: automatically update target price to chase market during liquidation events
        let effectiveTargetPrice = targetPrice;
        if (strategy.priceChaseMode && priceDeviation > slippageTolerance) {
          effectiveTargetPrice = currentPrice;
          console.log(`🏃 Price chase: updating limit from $${targetPrice.toFixed(6)} to $${currentPrice.toFixed(6)} (deviation: ${(priceDeviation * 100).toFixed(2)}%)`);
        }
        
        const orderPrice = strategy.orderType === 'market' ? currentPrice : effectiveTargetPrice;
        const finalDeviation = Math.abs(currentPrice - effectiveTargetPrice) / effectiveTargetPrice;
        
        if (finalDeviation <= slippageTolerance) {
          console.log(`✅ Price acceptable: $${currentPrice} (deviation: ${(finalDeviation * 100).toFixed(2)}%)`);
          
          // Execute live order on Aster DEX
          // Only pass positionSide if the EXCHANGE is in dual mode (not based on strategy settings)
          const liveOrderResult = await this.executeLiveOrder({
            symbol,
            side,
            orderType: strategy.orderType,
            quantity,
            price: orderPrice,
            // Only include positionSide if the EXCHANGE is in dual mode
            positionSide: this.exchangePositionMode === 'dual' ? positionSide : undefined,
          });
          
          if (!liveOrderResult.success) {
            console.error(`❌ Live order failed: ${liveOrderResult.error}`);
            
            // Log error to database for audit trail
            await this.logTradeEntryError({
              strategy,
              symbol: liquidation.symbol,
              side: positionSide,
              attemptType: layerNumber !== undefined ? 'layer' : 'entry',
              reason: 'order_placement_failed',
              errorDetails: `API error: ${liveOrderResult.error}`,
              liquidationValue: parseFloat(liquidation.value),
            });
            
            return;
          }
          
          console.log(`✅ LIVE ORDER EXECUTED on Aster DEX: ${quantity.toFixed(4)} ${symbol} at $${orderPrice}`);
          console.log(`📝 Order ID: ${liveOrderResult.orderId || 'N/A'}`);
          
          // Track live order execution locally for position management
          const order = await storage.placePaperOrder({
            sessionId: session.id,
            symbol,
            side,
            orderType: strategy.orderType,
            quantity: quantity.toString(),
            price: orderPrice.toString(),
            triggerLiquidationId,
            layerNumber,
          });
          
          // Fetch actual fill data from exchange (with retry logic for fill propagation delay)
          let actualFillsData: any[] | null = null;
          let retryCount = 0;
          const maxRetries = 3;
          
          while (retryCount < maxRetries && liveOrderResult.orderId) {
            // Small delay to allow exchange to process the fill
            if (retryCount > 0) {
              await new Promise(resolve => setTimeout(resolve, 500)); // 500ms between retries
            }
            
            const fillResult = await fetchActualFills({
              symbol,
              orderId: liveOrderResult.orderId,
            });
            
            if (fillResult.success && fillResult.fills && fillResult.fills.length > 0) {
              actualFillsData = fillResult.fills; // Store ALL fills for aggregation
              break;
            }
            
            retryCount++;
          }
          
          if (actualFillsData && actualFillsData.length > 0) {
            // Aggregate multiple fills (handles partial fills correctly)
            const aggregated = aggregateFills(actualFillsData);
            
            console.log(`💎 Using REAL exchange data (${actualFillsData.length} fill(s)) - Price: $${aggregated.avgPrice.toFixed(6)}, Qty: ${aggregated.totalQty.toFixed(4)}, Fee: $${aggregated.totalCommission.toFixed(4)}`);
            console.log(`📊 Fill type: ${aggregated.isMaker ? 'MAKER' : 'TAKER'}`);
            
            // Record fill with AGGREGATED exchange data (weighted avg price, total qty, total commission, timestamp)
            await this.fillLiveOrder(order, aggregated.avgPrice, aggregated.totalQty, aggregated.totalCommission, aggregated.timestamp);
          } else {
            console.warn(`⚠️ Could not fetch actual fill data after ${maxRetries} attempts, using order price as fallback`);
            // Fallback to order price if we couldn't fetch actual fill
            await this.fillPaperOrder(order, orderPrice, quantity);
          }
          
          return;
        } else {
          const timeRemaining = maxRetryDuration - (Date.now() - startTime);
          console.log(`⚠️ Price deviation too high: ${(priceDeviation * 100).toFixed(2)}% (${timeRemaining}ms remaining)`);
          
          if (timeRemaining <= 0) break;
          
          // Wait before retrying (shorter intervals for more responsive chasing)
          await new Promise(resolve => setTimeout(resolve, Math.min(1000, timeRemaining)));
        }
      } catch (error) {
        console.error('❌ Error in price chasing retry:', error);
        break;
      }
    }
    
    console.log(`❌ Order retry timeout: Failed to place order within ${maxRetryDuration}ms due to price movement`);
  }

  // Execute batch orders on Aster DEX (more efficient, reduces API calls)
  private async executeBatchOrders(orders: Array<{
    symbol: string;
    side: string;
    orderType: string;
    quantity: number;
    price: number;
    positionSide?: string;
  }>): Promise<{ success: boolean; results?: any[]; error?: string }> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        console.error('❌ Aster DEX API keys not configured');
        return { success: false, error: 'API keys not configured' };
      }
      
      if (orders.length === 0 || orders.length > 5) {
        console.error('❌ Batch orders must contain 1-5 orders');
        return { success: false, error: 'Invalid batch size (must be 1-5)' };
      }
      
      // Build batch orders array
      const batchOrders = orders.map(order => {
        const roundedQuantity = this.roundQuantity(order.symbol, order.quantity);
        const roundedPrice = this.roundPrice(order.symbol, order.price);
        
        const orderParams: Record<string, string | number | boolean> = {
          symbol: order.symbol,
          side: order.side.toUpperCase(),
          type: order.orderType.toUpperCase(),
        };
        
        // Add positionSide if in dual mode
        if (this.exchangePositionMode === 'dual' && order.positionSide) {
          orderParams.positionSide = order.positionSide.toUpperCase();
        }
        
        // Add price/stopPrice based on order type
        // CRITICAL: Use closePosition='true' to close entire position (simpler than reduceOnly + quantity)
        if (order.orderType.toLowerCase() === 'take_profit_market') {
          orderParams.stopPrice = roundedPrice;
          orderParams.closePosition = 'true'; // Close entire position when triggered
          orderParams.workingType = 'CONTRACT_PRICE'; // Use contract price, not mark price
        } else if (order.orderType.toLowerCase() === 'stop_market') {
          orderParams.stopPrice = roundedPrice;
          orderParams.closePosition = 'true'; // Close entire position when triggered
          orderParams.workingType = 'CONTRACT_PRICE'; // Use contract price, not mark price
        } else if (order.orderType.toLowerCase() === 'limit') {
          orderParams.price = roundedPrice;
          orderParams.quantity = roundedQuantity;
          orderParams.timeInForce = 'GTC';
          // HEDGE MODE FIX: Do NOT set reduceOnly for LIMIT orders
          // When positionSide is set, reduceOnly is automatically implied
          // Setting it explicitly causes "ReduceOnly Order is rejected" error
        }
        
        return orderParams;
      });
      
      const timestamp = Date.now();
      
      // CRITICAL FIX: Build query string manually to avoid double-encoding JSON
      // The batchOrders parameter needs special handling - it's already a JSON string
      const batchOrdersJson = JSON.stringify(batchOrders);
      
      // Build params object without the batchOrders first
      const params: Record<string, string | number> = {
        timestamp,
        recvWindow: 5000,
      };
      
      // Create query string for signature
      // Sort all params alphabetically, then manually add batchOrders
      const sortedParams = Object.entries(params)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      
      // Add batchOrders with proper encoding (only encode special chars, not the whole JSON)
      const queryString = `batchOrders=${encodeURIComponent(batchOrdersJson)}&${sortedParams}`;
      
      // Generate signature
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const signedParams = `${queryString}&signature=${signature}`;
      
      console.log(`🔴 BATCH ORDER: Placing ${orders.length} orders in one API call`);
      console.log(`📦 FULL batch payload:`, JSON.stringify(batchOrders, null, 2));
      console.log(`📝 Full query string (first 500 chars):`, queryString.substring(0, 500));
      console.log(`⚠️ REAL MONEY: This will place ${orders.length} LIVE orders on Aster DEX`);
      
      // Execute with retry logic
      let retryAttempt = 0;
      const maxRetries = 3;
      let response: Response | null = null;
      let responseText = '';
      
      while (retryAttempt <= maxRetries) {
        response = await fetch('https://fapi.asterdex.com/fapi/v1/batchOrders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-MBX-APIKEY': apiKey,
          },
          body: signedParams,
        });
        
        responseText = await response.text();
        
        if (response.status === 429) {
          retryAttempt++;
          if (retryAttempt <= maxRetries) {
            const backoffDelay = Math.min(1000 * Math.pow(2, retryAttempt), 10000);
            console.log(`⏱️ Rate limited. Retrying in ${backoffDelay}ms (attempt ${retryAttempt}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            continue;
          } else {
            console.error(`❌ Rate limited after ${maxRetries} retries`);
            return { success: false, error: `Rate limited (429) after ${maxRetries} retries` };
          }
        }
        
        break;
      }
      
      if (!response.ok) {
        console.error(`❌ Batch order failed (${response.status})`);
        console.error(`📄 Full response body:`, responseText);
        console.error(`📋 Response headers:`, JSON.stringify(Object.fromEntries(response.headers.entries())));
        try {
          const errorData = JSON.parse(responseText);
          console.error(`🔍 Parsed error:`, JSON.stringify(errorData, null, 2));
          return { 
            success: false, 
            error: `API Error ${errorData.code || response.status}: ${errorData.msg || responseText}` 
          };
        } catch (parseError) {
          console.error(`⚠️ Could not parse response as JSON:`, parseError);
          return { success: false, error: `HTTP ${response.status}: ${responseText}` };
        }
      }
      
      // Log full successful response
      console.log(`✅ Batch API returned HTTP 200`);
      console.log(`📦 Full response body:`, responseText);
      
      const results = JSON.parse(responseText);
      console.log(`📋 Parsed results:`, JSON.stringify(results, null, 2));
      
      // Validate each order in the batch result
      // Binance/Aster batch API returns array where each item can be:
      // - Success: { orderId: 123, ... }
      // - Error: { code: -4003, msg: "..." }
      const failures: any[] = [];
      const successes: any[] = [];
      
      if (Array.isArray(results)) {
        results.forEach((result, index) => {
          // CRITICAL FIX: Error codes can be POSITIVE (like 400) or NEGATIVE (like -4003)
          // Check for orderId first to identify success, then treat everything else as error
          if (result.orderId) {
            // Success response - has orderId
            successes.push(result);
            console.log(`✅ Batch order ${index + 1} placed: Order ID ${result.orderId}`);
          } else if (result.code) {
            // Error response - has code but no orderId (catches both positive and negative codes)
            failures.push({ index, code: result.code, msg: result.msg || 'No error message' });
            console.error(`❌ Batch order ${index + 1} failed: Code ${result.code} - ${result.msg || 'No error message'}`);
            console.error(`   Full error object:`, JSON.stringify(result, null, 2));
          } else {
            // Unknown response format - no orderId and no code
            failures.push({ index, error: 'Unknown response format', data: result });
            console.error(`❌ Batch order ${index + 1} unknown response:`, result);
          }
        });
      } else {
        console.error(`❌ Unexpected batch response format (not an array):`, results);
        return { success: false, error: 'Unexpected response format' };
      }
      
      if (failures.length > 0) {
        console.error(`❌ Batch order partially failed: ${successes.length} succeeded, ${failures.length} failed`);
        return { 
          success: false, 
          error: `${failures.length} order(s) failed: ${failures.map(f => f.msg || f.error).join('; ')}`,
          results: { successes, failures }
        };
      }
      
      console.log(`✅ Batch order executed successfully: ${successes.length} orders placed`);
      return { success: true, results: successes };
    } catch (error) {
      console.error('❌ Error executing batch order:', error);
      return { success: false, error: String(error) };
    }
  }

  // Execute live order on Aster DEX with proper HMAC-SHA256 signature
  private async executeLiveOrder(params: {
    symbol: string;
    side: string; // 'buy' or 'sell'
    orderType: string;
    quantity: number;
    price: number;
    positionSide?: string; // 'LONG' or 'SHORT' for hedge mode
  }): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      const { symbol, side, orderType, quantity, price, positionSide } = params;
      
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      // Safety check: Verify API credentials exist
      if (!apiKey || !secretKey) {
        console.error('❌ Aster DEX API keys not configured');
        return { success: false, error: 'API keys not configured' };
      }
      
      // Safety check: Validate order parameters
      if (quantity <= 0) {
        console.error('❌ Invalid quantity:', quantity);
        return { success: false, error: 'Invalid quantity' };
      }
      
      if (orderType === 'limit' && price <= 0) {
        console.error('❌ Invalid price for limit order:', price);
        return { success: false, error: 'Invalid price' };
      }
      
      // Round quantity and price to exchange precision requirements
      const precisionInfo = this.symbolPrecisionCache.get(symbol);
      console.log(`🔧 Precision for ${symbol}:`, precisionInfo ? `stepSize=${precisionInfo.stepSize}, tickSize=${precisionInfo.tickSize}` : 'NOT FOUND');
      console.log(`🔢 Raw values: quantity=${quantity}, price=${price}`);
      
      const roundedQuantity = this.roundQuantity(symbol, quantity);
      const roundedPrice = this.roundPrice(symbol, price);
      
      console.log(`🔢 Rounded values: quantity=${roundedQuantity}, price=${roundedPrice}`);
      
      // Prepare order parameters for Aster DEX API (Binance-style)
      const timestamp = Date.now();
      const orderParams: Record<string, string | number> = {
        symbol,
        side: side.toUpperCase(),
        type: orderType.toUpperCase(),
        quantity: roundedQuantity,
        timestamp,
        recvWindow: 5000, // 5 second receive window for clock sync tolerance
      };
      
      // Add positionSide ONLY if the exchange is in dual position mode
      // The exchange requires positionSide in dual mode and rejects it in one-way mode
      if (this.exchangePositionMode === 'dual' && positionSide) {
        orderParams.positionSide = positionSide.toUpperCase();
      }
      
      // Add price/stopPrice for different order types
      if (orderType.toLowerCase() === 'limit') {
        orderParams.price = roundedPrice;
        orderParams.timeInForce = 'GTC'; // Good Till Cancel
        // NO reduceOnly - LIMIT orders with opposite side naturally close positions
        // reduceOnly causes exchange to auto-cancel orders when position size changes
      } else if (orderType.toLowerCase() === 'stop_market') {
        orderParams.stopPrice = roundedPrice; // Trigger price for stop market orders
        orderParams.workingType = 'CONTRACT_PRICE'; // Use contract price, not mark price
        // Hedge mode (dual): Use closePosition='true' to avoid reduceOnly API error
        // One-way mode: Use reduceOnly to prevent reverse positions
        if (this.exchangePositionMode === 'dual') {
          orderParams.closePosition = 'true'; // Close the position when triggered
        } else {
          orderParams.quantity = roundedQuantity;
          orderParams.reduceOnly = 'true'; // Prevent reverse positions in one-way mode
        }
      } else if (orderType.toLowerCase() === 'take_profit_market') {
        orderParams.stopPrice = roundedPrice; // Trigger price for TP market orders
        orderParams.reduceOnly = 'true'; // TP orders can only reduce positions
        orderParams.workingType = 'CONTRACT_PRICE'; // Use contract price, not mark price
      }
      
      // Create query string for signature (sorted alphabetically for consistency)
      const queryString = Object.entries(orderParams)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      
      // Generate HMAC-SHA256 signature
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      // Add signature to parameters
      const signedParams = `${queryString}&signature=${signature}`;
      
      console.log(`🔴 LIVE ORDER: Executing ${side} ${roundedQuantity} ${symbol} at $${roundedPrice}`);
      console.log(`📡 Order type: ${orderType.toUpperCase()}`);
      console.log(`🔐 Signed request length: ${signedParams.length} chars`);
      
      // Safety check: Log intent before execution
      console.log(`⚠️ REAL MONEY: This will place a LIVE order on Aster DEX`);
      
      // Execute the live order on Aster DEX
      // Implement exponential backoff for rate limiting
      let retryAttempt = 0;
      const maxRetries = 3;
      let response: Response | null = null;
      let responseText = '';
      
      while (retryAttempt <= maxRetries) {
        response = await fetch('https://fapi.asterdex.com/fapi/v1/order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-MBX-APIKEY': apiKey,
          },
          body: signedParams,
        });
        
        responseText = await response.text();
        
        // Check for rate limiting
        if (response.status === 429) {
          retryAttempt++;
          if (retryAttempt <= maxRetries) {
            const backoffDelay = Math.min(1000 * Math.pow(2, retryAttempt), 10000); // Exponential backoff, max 10s
            console.log(`⏱️ Rate limited. Retrying in ${backoffDelay}ms (attempt ${retryAttempt}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            continue;
          } else {
            console.error(`❌ Rate limited after ${maxRetries} retries`);
            return { success: false, error: `Rate limited (429) after ${maxRetries} retries` };
          }
        }
        
        break; // Exit loop if not rate limited
      }
      
      if (!response.ok) {
        console.error(`❌ Live order failed (${response.status}): ${responseText}`);
        
        // Parse error if JSON
        try {
          const errorData = JSON.parse(responseText);
          return { 
            success: false, 
            error: `API Error ${errorData.code || response.status}: ${errorData.msg || responseText}` 
          };
        } catch {
          return { success: false, error: `HTTP ${response.status}: ${responseText}` };
        }
      }
      
      const result = JSON.parse(responseText);
      console.log(`✅ Live order executed successfully`);
      console.log(`📝 Order ID: ${result.orderId || 'N/A'}`);
      console.log(`💰 Order details:`, JSON.stringify(result, null, 2));
      
      return { success: true, orderId: result.orderId };
    } catch (error) {
      console.error('❌ Error executing live order:', error);
      return { success: false, error: String(error) };
    }
  }

  // Place LIMIT TP and STOP_MARKET SL orders on the exchange order book for a layer
  private async placeLayerProtectiveOrders(params: {
    position: Position;
    layer: any; // PositionLayer
    strategy: Strategy;
  }): Promise<{ tpOrderId?: string; slOrderId?: string; success: boolean; error?: string }> {
    try {
      const { position, layer, strategy } = params;
      const { symbol, side } = position;
      const layerQty = parseFloat(layer.quantity);
      const tpPrice = parseFloat(layer.takeProfitPrice);
      const slPrice = parseFloat(layer.stopLossPrice);
      
      console.log(`🛡️ Placing protective orders for Layer ${layer.layerNumber}: TP=$${tpPrice.toFixed(6)}, SL=$${slPrice.toFixed(6)}`);
      
      // Determine order sides based on position direction
      const tpSide = side === 'long' ? 'sell' : 'buy'; // TP closes position
      const slSide = side === 'long' ? 'sell' : 'buy'; // SL closes position
      
      // Place LIMIT TP order
      const tpResult = await this.executeLiveOrder({
        symbol,
        side: tpSide,
        orderType: 'limit',
        quantity: layerQty,
        price: tpPrice,
        positionSide: this.exchangePositionMode === 'dual' ? side : undefined,
      });
      
      if (!tpResult.success) {
        console.error(`❌ Failed to place TP order for Layer ${layer.layerNumber}:`, tpResult.error);
        return { success: false, error: `TP order failed: ${tpResult.error}` };
      }
      
      console.log(`✅ TP LIMIT order placed: ${tpResult.orderId} at $${tpPrice.toFixed(6)}`);
      
      // Place STOP_MARKET SL order
      const slResult = await this.executeLiveOrder({
        symbol,
        side: slSide,
        orderType: 'stop_market',
        quantity: layerQty,
        price: slPrice,
        positionSide: this.exchangePositionMode === 'dual' ? side : undefined,
      });
      
      if (!slResult.success) {
        console.error(`❌ Failed to place SL order for Layer ${layer.layerNumber}:`, slResult.error);
        // Cancel the TP order since SL failed
        console.log(`🔄 Cancelling TP order ${tpResult.orderId} due to SL placement failure`);
        // TODO: Implement order cancellation if needed
        return { success: false, error: `SL order failed: ${slResult.error}` };
      }
      
      console.log(`✅ SL STOP_MARKET order placed: ${slResult.orderId} at $${slPrice.toFixed(6)}`);
      
      return {
        success: true,
        tpOrderId: tpResult.orderId,
        slOrderId: slResult.orderId,
      };
    } catch (error) {
      console.error('❌ Error placing layer protective orders:', error);
      return { success: false, error: String(error) };
    }
  }

  // Get the exchange's position mode (one-way or dual)
  private async fetchExchangePositionMode(): Promise<'one-way' | 'dual'> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        console.error('❌ Cannot determine position mode: API keys not configured');
        return 'one-way'; // Default to one-way mode
      }
      
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&recvWindow=5000`;
      
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const signedParams = `${queryString}&signature=${signature}`;
      
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/positionSide/dual?${signedParams}`, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to fetch position mode: ${response.status} ${errorText}`);
        return 'one-way'; // Default to one-way mode on error
      }
      
      const data = await response.json();
      const isDualMode = data.dualSidePosition === true;
      
      console.log(`📊 Exchange position mode: ${isDualMode ? 'dual' : 'one-way'}`);
      return isDualMode ? 'dual' : 'one-way';
    } catch (error) {
      console.error('❌ Error fetching position mode:', error);
      return 'one-way'; // Default to one-way mode on error
    }
  }

  // Get all exchange positions from Aster DEX
  private async getExchangePositions(): Promise<any[]> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        console.error('❌ Aster DEX API keys not configured');
        return [];
      }
      
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&recvWindow=5000`;
      
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const signedParams = `${queryString}&signature=${signature}`;
      
      // Implement exponential backoff for rate limiting
      let retryAttempt = 0;
      const maxRetries = 3;
      let response: Response | null = null;
      
      while (retryAttempt <= maxRetries) {
        response = await fetch(`https://fapi.asterdex.com/fapi/v2/positionRisk?${signedParams}`, {
          method: 'GET',
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        });
        
        // Check for rate limiting
        if (response.status === 429) {
          retryAttempt++;
          if (retryAttempt <= maxRetries) {
            const backoffDelay = Math.min(1000 * Math.pow(2, retryAttempt), 10000); // Exponential backoff, max 10s
            console.log(`⏱️ Rate limited on position fetch. Retrying in ${backoffDelay}ms (attempt ${retryAttempt}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            continue;
          } else {
            console.error(`❌ Rate limited after ${maxRetries} retries`);
            return [];
          }
        }
        
        break; // Exit loop if not rate limited
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to fetch exchange positions: ${response.status} ${errorText}`);
        return [];
      }
      
      const positions = await response.json();
      return positions;
    } catch (error) {
      console.error('❌ Error fetching exchange positions:', error);
      return [];
    }
  }

  // Cancel an order on Aster DEX
  private async cancelExchangeOrder(symbol: string, orderId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        console.error('❌ Aster DEX API keys not configured');
        return { success: false, error: 'API keys not configured' };
      }
      
      const timestamp = Date.now();
      const orderParams: Record<string, string | number> = {
        symbol,
        orderId,
        timestamp,
        recvWindow: 5000,
      };
      
      const queryString = Object.entries(orderParams)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const signedParams = `${queryString}&signature=${signature}`;
      
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/order?${signedParams}`, {
        method: 'DELETE',
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to cancel order ${orderId}: ${response.status} ${errorText}`);
        return { success: false, error: errorText };
      }
      
      console.log(`✅ Canceled order ${orderId} for ${symbol}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error canceling order:', error);
      return { success: false, error: String(error) };
    }
  }

  // Get all open orders from Aster DEX
  private async getOpenOrders(): Promise<any[]> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        console.error('❌ Aster DEX API keys not configured');
        return [];
      }
      
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&recvWindow=5000`;
      
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const signedParams = `${queryString}&signature=${signature}`;
      
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/openOrders?${signedParams}`, {
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to fetch open orders: ${response.status} ${errorText}`);
        return [];
      }
      
      const orders = await response.json();
      return orders;
    } catch (error) {
      console.error('❌ Error fetching open orders:', error);
      return [];
    }
  }

  // Log trade entry error to database for debugging
  private async logTradeEntryError(params: {
    strategy: Strategy;
    symbol: string;
    side: 'long' | 'short';
    attemptType: 'entry' | 'layer';
    reason: string;
    errorDetails?: string;
    liquidationValue?: number;
  }): Promise<void> {
    try {
      const errorRecord: InsertTradeEntryError = {
        userId: params.strategy.userId,
        strategyId: params.strategy.id,
        symbol: params.symbol,
        side: params.side,
        attemptType: params.attemptType,
        reason: params.reason,
        errorDetails: params.errorDetails || null,
        liquidationValue: params.liquidationValue?.toString() || null,
        strategySettings: {
          leverage: params.strategy.leverage,
          maxPortfolioRiskPercent: params.strategy.maxPortfolioRiskPercent,
          maxOpenPositions: params.strategy.maxOpenPositions,
          riskLevel: params.strategy.riskLevel,
          isActive: params.strategy.isActive,
        },
      };
      
      await storage.createTradeEntryError(errorRecord);
    } catch (error) {
      console.error('❌ Failed to log trade entry error:', error);
    }
  }

  // Set leverage for a symbol on Aster DEX using fixed global settings
  private async setLeverage(symbol: string, requestedLeverage: number): Promise<boolean> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        console.error('❌ Aster DEX API keys not configured');
        return false;
      }
      
      // Use the exact leverage from global settings (no auto-adjustment)
      const leverage = requestedLeverage;
      
      const timestamp = Date.now();
      const leverageParams: Record<string, string | number> = {
        symbol,
        leverage,
        timestamp,
        recvWindow: 5000,
      };
      
      const queryString = Object.entries(leverageParams)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const signedParams = `${queryString}&signature=${signature}`;
      
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/leverage?${signedParams}`, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to set leverage for ${symbol}: ${response.status} ${errorText}`);
        return false;
      }
      
      const result = await response.json();
      console.log(`✅ Set ${symbol} leverage to ${leverage}x:`, result);
      return true;
    } catch (error) {
      console.error('❌ Error setting leverage:', error);
      return false;
    }
  }

  // Cancel an order on Aster DEX
  private async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        console.error('❌ Aster DEX API keys not configured');
        return false;
      }
      
      const timestamp = Date.now();
      const orderParams: Record<string, string | number> = {
        symbol,
        orderId,
        timestamp,
        recvWindow: 5000,
      };
      
      const queryString = Object.entries(orderParams)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const signedParams = `${queryString}&signature=${signature}`;
      
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/order?${signedParams}`, {
        method: 'DELETE',
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to cancel order ${orderId}: ${response.status} ${errorText}`);
        return false;
      }
      
      console.log(`✅ Canceled order ${orderId} for ${symbol}`);
      return true;
    } catch (error) {
      console.error('❌ Error canceling order:', error);
      return false;
    }
  }

  // Clean up orphaned TP/SL orders on Aster DEX
  async cleanupOrphanedTPSL(): Promise<number> {
    try {
      console.log('🧹 Starting orphaned TP/SL order cleanup...');
      
      // Get all active sessions
      const activeSessions = Array.from(this.activeSessions.values());
      if (activeSessions.length === 0) {
        console.log('⏭️ No active trading sessions, skipping cleanup');
        return 0;
      }

      // Get all open orders from Aster DEX
      const allOrders = await this.getOpenOrders();
      if (allOrders.length === 0) {
        console.log('✅ No open orders found on exchange');
        return 0;
      }

      console.log(`📋 Found ${allOrders.length} open orders on exchange`);
      
      let canceledCount = 0;
      const currentTime = Date.now();

      // Get all active positions for all sessions
      const positionsMap = new Map<string, Map<string, Position>>();
      for (const session of activeSessions) {
        const positions = await storage.getOpenPositions(session.id);
        const sessionPositions = new Map<string, Position>();
        
        for (const position of positions) {
          // Find strategy for this session to check hedge mode
          let hedgeMode = false;
          this.activeStrategies.forEach((strategy) => {
            if (strategy.id === session.strategyId) {
              hedgeMode = strategy.hedgeMode;
            }
          });

          // Create key for position lookup
          const key = hedgeMode 
            ? `${position.symbol}_${position.side.toUpperCase()}`
            : position.symbol;
          
          sessionPositions.set(key, position);
        }
        
        positionsMap.set(session.id, sessionPositions);
      }

      // Check each order
      for (const order of allOrders) {
        const orderType = order.type || '';
        const symbol = order.symbol;
        const orderId = String(order.orderId);
        const positionSide = order.positionSide || 'BOTH';
        const orderTime = order.time || 0;
        const orderAgeSeconds = (currentTime - orderTime) / 1000;

        // Check if this is a TP/SL order
        const isTPSL = [
          'TAKE_PROFIT_MARKET',
          'STOP_MARKET',
          'TAKE_PROFIT',
          'STOP',
          'STOP_LOSS'
        ].includes(orderType);

        if (!isTPSL) continue;

        // Don't cancel orders younger than 60 seconds (prevents race conditions)
        if (orderAgeSeconds < 60) {
          console.log(`⏰ Skipping young TP/SL order ${orderId} (${orderAgeSeconds.toFixed(0)}s old)`);
          continue;
        }

        // Check if matching position exists across all live sessions
        let shouldCancel = true;
        
        for (const [sessionId, sessionPositions] of Array.from(positionsMap.entries())) {
          // Find strategy for this session to check hedge mode
          let hedgeMode = false;
          this.activeStrategies.forEach((strategy) => {
            const session = this.activeSessions.get(strategy.id);
            if (session && session.id === sessionId) {
              hedgeMode = strategy.hedgeMode;
            }
          });

          if (hedgeMode) {
            // Hedge mode: check position side
            const sideKey = `${symbol}_${positionSide}`;
            const position = sessionPositions.get(sideKey);
            
            if (position && position.isOpen) {
              shouldCancel = false;
              break;
            }
          } else {
            // One-way mode: check symbol only
            const position = sessionPositions.get(symbol);
            
            if (position && position.isOpen) {
              shouldCancel = false;
              break;
            }
          }
        }

        if (!shouldCancel) continue;

        console.log(`⚠️ Found orphaned ${orderType} order ${orderId} for ${symbol} ${positionSide}`);

        // Safety check: don't cancel if recent fills exist in database (last 5 minutes)
        const fiveMinutesAgo = new Date(currentTime - 5 * 60 * 1000);
        const recentFills = await storage.getRecentFills(symbol, fiveMinutesAgo);
        
        if (recentFills.length > 0) {
          console.log(`🛡️ Skipping cancellation - ${recentFills.length} recent fills exist for ${symbol}`);
          continue;
        }

        // Cancel the orphaned order
        const canceled = await this.cancelOrder(symbol, orderId);
        if (canceled) {
          canceledCount++;
        }
      }

      if (canceledCount > 0) {
        console.log(`✅ Cleanup complete: Canceled ${canceledCount} orphaned TP/SL orders`);
      } else {
        console.log(`✅ Cleanup complete: No orphaned orders found`);
      }

      return canceledCount;
    } catch (error) {
      console.error('❌ Error in orphaned order cleanup:', error);
      return 0;
    }
  }

  // Clean up stale limit orders (older than configured timeout)
  async cleanupStaleLimitOrders(): Promise<number> {
    try {
      let canceledCount = 0;
      const activeSessions = Array.from(this.activeSessions.values());
      
      if (activeSessions.length === 0) {
        return 0;
      }

      const allOrders = await this.getOpenOrders();
      if (allOrders.length === 0) {
        return 0;
      }

      const currentTime = Date.now();

      for (const order of allOrders) {
        const orderType = order.type || '';
        const symbol = order.symbol;
        const orderId = String(order.orderId);
        
        // Only check LIMIT orders
        if (orderType === 'LIMIT') {
          const orderTime = order.time || 0;
          const ageSeconds = (currentTime - orderTime) / 1000;
          
          // Check if older than timeout
          if (ageSeconds > this.staleLimitOrderSeconds) {
            // Skip if it's a tracked TP/SL order (has positionSide set)
            const positionSide = order.positionSide;
            if (positionSide && positionSide !== 'BOTH') {
              console.log(`⏭️ Skipping tracked TP/SL limit order ${orderId}`);
              continue;
            }
            
            console.log(`⚠️ Found stale limit order ${orderId}, age: ${ageSeconds.toFixed(0)}s`);
            
            const canceled = await this.cancelOrder(symbol, orderId);
            if (canceled) {
              canceledCount++;
            }
          }
        }
      }

      if (canceledCount > 0) {
        console.log(`✅ Stale cleanup: Canceled ${canceledCount} old limit orders`);
      }

      return canceledCount;
    } catch (error) {
      console.error('❌ Error in stale limit order cleanup:', error);
      return 0;
    }
  }

  /**
   * Calculate ATR-based take profit price
   * Uses the same logic as DCA calculator to ensure consistency
   */
  private async calculateATRBasedTP(
    strategy: Strategy,
    symbol: string,
    avgEntryPrice: number,
    side: 'long' | 'short'
  ): Promise<number> {
    try {
      // Get DCA parameters from strategy
      const strategyWithDCA = await storage.getStrategyWithDCA(strategy.id);
      if (!strategyWithDCA || strategyWithDCA.dca_exit_cushion_multiplier == null) {
        // Fallback to fixed percentage if DCA not configured
        const profitTargetPercent = parseFloat(strategy.profitTargetPercent);
        return side === 'long' 
          ? avgEntryPrice * (1 + profitTargetPercent / 100)
          : avgEntryPrice * (1 - profitTargetPercent / 100);
      }

      // Calculate ATR percentage
      const atrPercent = await calculateATRPercent(
        symbol,
        10,
        process.env.ASTER_API_KEY,
        process.env.ASTER_SECRET_KEY
      );

      // Get exit cushion multiplier
      const exitCushion = parseFloat(String(strategyWithDCA.dca_exit_cushion_multiplier));
      
      // Calculate TP distance using ATR-based formula
      // TP = avgEntryPrice +/- (cushion * ATR% * avgEntryPrice)
      const tpDistance = exitCushion * (atrPercent / 100) * avgEntryPrice;
      const tpPrice = side === 'long' 
        ? avgEntryPrice + tpDistance
        : avgEntryPrice - tpDistance;

      return tpPrice;
    } catch (error) {
      console.error(`⚠️ Error calculating ATR-based TP for ${symbol}, using fallback:`, error);
      // Fallback to fixed percentage
      const profitTargetPercent = parseFloat(strategy.profitTargetPercent);
      return side === 'long' 
        ? avgEntryPrice * (1 + profitTargetPercent / 100)
        : avgEntryPrice * (1 - profitTargetPercent / 100);
    }
  }

  // Auto-repair missing TP/SL orders for exchange positions
  async autoRepairMissingTPSL(): Promise<number> {
    try {
      let repairedCount = 0;
      const activeSessions = Array.from(this.activeSessions.values());
      
      if (activeSessions.length === 0) {
        return 0;
      }

      // Get all exchange positions
      const exchangePositions = await this.getExchangePositions();
      if (exchangePositions.length === 0) {
        return 0;
      }

      // Get all open orders
      const allOrders = await this.getOpenOrders();
      
      // Process each position
      for (const exchangePos of exchangePositions) {
        const symbol = exchangePos.symbol;
        const positionAmt = parseFloat(exchangePos.positionAmt);
        
        if (positionAmt === 0) continue;
        
        // Derive side from positionSide (dual mode) or positionAmt sign (one-way mode)
        let side: string;
        if (exchangePos.positionSide === 'LONG') {
          side = 'long';
        } else if (exchangePos.positionSide === 'SHORT') {
          side = 'short';
        } else {
          // One-way mode: derive from positionAmt sign
          side = positionAmt > 0 ? 'long' : 'short';
        }
        
        const cooldownKey = `${symbol}-${side}`;
        const lastAttempt = this.recoveryAttempts.get(cooldownKey) || 0;
        const now = Date.now();
        
        // 2 minute cooldown between repair attempts
        if (now - lastAttempt < 2 * 60 * 1000) {
          continue;
        }
        
        // Find corresponding database position and strategy
        let dbPosition: Position | undefined;
        let strategy: Strategy | undefined;
        
        for (const session of activeSessions) {
          const positions = await storage.getOpenPositions(session.id);
          dbPosition = positions.find(p => 
            p.symbol === symbol && 
            p.side && side && p.side.toLowerCase() === side.toLowerCase() && 
            p.isOpen
          );
          if (dbPosition) {
            // Get strategy from session
            for (const [stratId, sess] of Array.from(this.activeSessions.entries())) {
              if (sess.id === session.id) {
                strategy = this.activeStrategies.get(stratId);
                if (strategy) break;
              }
            }
            break;
          }
        }
        
        if (!dbPosition) {
          console.log(`⚠️ No database position found for ${symbol} ${side}`);
          continue;
        }
        
        if (!strategy) continue;
        
        // CRITICAL FIX: Use DATABASE position's entry price, NOT exchange position's entry price
        // The exchange position may have stale/incorrect entry price after layers
        // Database tracks the true weighted average entry price from all fills
        const entryPrice = parseFloat(dbPosition.avgEntryPrice);
        
        const stopLossPercent = parseFloat(strategy.stopLossPercent);
        
        // Calculate ATR-based TP price using database entry price
        const tpPrice = await this.calculateATRBasedTP(
          strategy,
          symbol,
          entryPrice,
          side === 'LONG' ? 'long' : 'short'
        );
        
        const slPrice = side === 'LONG'
          ? entryPrice * (1 - stopLossPercent / 100)
          : entryPrice * (1 + stopLossPercent / 100);
        
        // Check if TP and SL orders exist
        const hasTPOrder = allOrders.some(o => 
          o.symbol === symbol && 
          o.positionSide === side &&
          (o.type === 'TAKE_PROFIT_MARKET' || 
           (o.type === 'LIMIT' && Math.abs(parseFloat(o.price || '0') - tpPrice) < 1))
        );
        
        const hasSLOrder = allOrders.some(o => 
          o.symbol === symbol && 
          o.positionSide === side &&
          o.type === 'STOP_MARKET'
        );
        
        // CRITICAL FIX: Don't close positions just because price moved past TP
        // If TP order is missing, it's because batch API failed - place it now!
        // The TP order was never there to catch the price, so we shouldn't assume it filled
        
        // Place missing TP order (LIMIT order)
        if (!hasTPOrder) {
          console.log(`🔧 Placing missing TP order for ${symbol} ${side} at ${tpPrice}`);
          const tpResult = await this.placeExitOrder(
            dbPosition,
            'LIMIT',
            tpPrice,
            Math.abs(positionAmt),
            'take_profit'
          );
          
          if (tpResult.success) {
            repairedCount++;
          }
        }
        
        // Place missing SL order (STOP_MARKET order)
        if (!hasSLOrder) {
          console.log(`🔧 Placing missing SL order for ${symbol} ${side} at ${slPrice}`);
          const slResult = await this.placeExitOrder(
            dbPosition,
            'STOP_MARKET',
            slPrice,
            Math.abs(positionAmt),
            'stop_loss'
          );
          
          if (slResult.success) {
            repairedCount++;
          }
        }
        
        // Update cooldown
        if (repairedCount > 0) {
          this.recoveryAttempts.set(cooldownKey, now);
        }
      }

      if (repairedCount > 0) {
        console.log(`✅ Auto-repair: Placed ${repairedCount} missing TP/SL orders`);
      }

      return repairedCount;
    } catch (error) {
      console.error('❌ Error in auto-repair missing TP/SL:', error);
      return 0;
    }
  }

  // Scan for missing TP/SL orders without auto-repair (reporting only)
  async scanMissingTPSL(): Promise<Array<{
    symbol: string;
    side: string;
    positionSize: number;
    entryPrice: number;
    missingTP: boolean;
    missingSL: boolean;
    tpPrice?: number;
    slPrice?: number;
  }>> {
    try {
      const results: Array<{
        symbol: string;
        side: string;
        positionSize: number;
        entryPrice: number;
        missingTP: boolean;
        missingSL: boolean;
        tpPrice?: number;
        slPrice?: number;
      }> = [];
      
      const activeSessions = Array.from(this.activeSessions.values());
      
      if (activeSessions.length === 0) {
        return results;
      }

      // Get all exchange positions
      const exchangePositions = await this.getExchangePositions();
      if (exchangePositions.length === 0) {
        return results;
      }

      // Get all open orders
      const allOrders = await this.getOpenOrders();
      
      // Process each position
      for (const exchangePos of exchangePositions) {
        const symbol = exchangePos.symbol;
        const positionAmt = parseFloat(exchangePos.positionAmt);
        
        if (positionAmt === 0) continue;
        
        // Derive side from positionSide (dual mode) or positionAmt sign (one-way mode)
        let side: string;
        if (exchangePos.positionSide === 'LONG') {
          side = 'long';
        } else if (exchangePos.positionSide === 'SHORT') {
          side = 'short';
        } else {
          // One-way mode: derive from positionAmt sign
          side = positionAmt > 0 ? 'long' : 'short';
        }
        
        const entryPrice = parseFloat(exchangePos.entryPrice);
        
        // Find corresponding database position and strategy
        let dbPosition: Position | undefined;
        let strategy: Strategy | undefined;
        
        for (const session of activeSessions) {
          const positions = await storage.getOpenPositions(session.id);
          dbPosition = positions.find(p => 
            p.symbol === symbol && 
            p.side && side && p.side.toLowerCase() === side.toLowerCase() && 
            p.isOpen
          );
          if (dbPosition) {
            // Get strategy from session
            for (const [stratId, sess] of Array.from(this.activeSessions.entries())) {
              if (sess.id === session.id) {
                strategy = this.activeStrategies.get(stratId);
                if (strategy) break;
              }
            }
            break;
          }
        }
        
        if (!dbPosition || !strategy) continue;
        
        const stopLossPercent = parseFloat(strategy.stopLossPercent);
        
        // Calculate ATR-based TP price
        const tpPrice = await this.calculateATRBasedTP(
          strategy,
          symbol,
          entryPrice,
          side === 'LONG' ? 'long' : 'short'
        );
        
        const slPrice = side === 'LONG'
          ? entryPrice * (1 - stopLossPercent / 100)
          : entryPrice * (1 + stopLossPercent / 100);
        
        // Check if TP and SL orders exist
        const hasTPOrder = allOrders.some(o => 
          o.symbol === symbol && 
          o.positionSide === side &&
          (o.type === 'TAKE_PROFIT_MARKET' || 
           (o.type === 'LIMIT' && Math.abs(parseFloat(o.price || '0') - tpPrice) < 1))
        );
        
        const hasSLOrder = allOrders.some(o => 
          o.symbol === symbol && 
          o.positionSide === side &&
          o.type === 'STOP_MARKET'
        );
        
        // If either TP or SL is missing, add to results
        if (!hasTPOrder || !hasSLOrder) {
          results.push({
            symbol,
            side: side.toUpperCase(),
            positionSize: Math.abs(positionAmt),
            entryPrice,
            missingTP: !hasTPOrder,
            missingSL: !hasSLOrder,
            tpPrice,
            slPrice
          });
        }
      }

      return results;
    } catch (error) {
      console.error('❌ Error scanning for missing TP/SL:', error);
      return [];
    }
  }

  // Fix incorrect stop-loss orders (where stopPrice doesn't match calculated SL)
  private async fixIncorrectStopLossOrders(): Promise<number> {
    try {
      // Get all active sessions
      const activeSessions = Array.from(this.activeSessions.values());
      if (activeSessions.length === 0) {
        return 0;
      }

      let fixedCount = 0;

      // Get all exchange positions
      const exchangePositions = await this.getExchangePositions();
      if (exchangePositions.length === 0) {
        return 0;
      }

      // Get all open orders
      const allOrders = await this.getOpenOrders();
      
      // Process each position
      for (const exchangePos of exchangePositions) {
        const symbol = exchangePos.symbol;
        const positionAmt = parseFloat(exchangePos.positionAmt);
        
        if (positionAmt === 0) continue;
        
        // Derive side from positionSide (dual mode) or positionAmt sign (one-way mode)
        let side: string;
        if (exchangePos.positionSide === 'LONG') {
          side = 'long';
        } else if (exchangePos.positionSide === 'SHORT') {
          side = 'short';
        } else {
          // One-way mode: derive from positionAmt sign
          side = positionAmt > 0 ? 'long' : 'short';
        }
        
        const entryPrice = parseFloat(exchangePos.entryPrice);
        
        // Find corresponding database position and strategy
        let dbPosition: Position | undefined;
        let strategy: Strategy | undefined;
        
        for (const session of activeSessions) {
          const positions = await storage.getOpenPositions(session.id);
          dbPosition = positions.find(p => 
            p.symbol === symbol && 
            p.side && side && p.side.toLowerCase() === side.toLowerCase() && 
            p.isOpen
          );
          if (dbPosition) {
            // Get strategy from session
            for (const [stratId, sess] of Array.from(this.activeSessions.entries())) {
              if (sess.id === session.id) {
                strategy = this.activeStrategies.get(stratId);
                if (strategy) break;
              }
            }
            break;
          }
        }
        
        if (!dbPosition) {
          console.log(`⚠️ No database position found for ${symbol} ${side} (exchange has position but no DB entry)`);
          continue;
        }
        
        if (!strategy) continue;
        
        const stopLossPercent = parseFloat(strategy.stopLossPercent);
        
        // Calculate CORRECT stop-loss price (without leverage multiplication!)
        const correctSlPrice = side === 'LONG'
          ? entryPrice * (1 - stopLossPercent / 100)
          : entryPrice * (1 + stopLossPercent / 100);
        
        // Find existing SL order
        const existingSlOrder = allOrders.find(o => 
          o.symbol === symbol && 
          o.positionSide === side &&
          o.type === 'STOP_MARKET'
        );
        
        if (!existingSlOrder) continue;
        
        const currentSlPrice = parseFloat(existingSlOrder.stopPrice || '0');
        
        // Check if the current SL price is significantly wrong (>10% deviation)
        const priceDifference = Math.abs(currentSlPrice - correctSlPrice);
        const percentDifference = (priceDifference / correctSlPrice) * 100;
        
        if (percentDifference > 10) {
          console.log(`🔧 Incorrect SL detected for ${symbol} ${side}:`);
          console.log(`   Current SL: $${currentSlPrice.toFixed(2)}, Correct SL: $${correctSlPrice.toFixed(2)} (${percentDifference.toFixed(1)}% off)`);
          console.log(`   Entry: $${entryPrice.toFixed(2)}, Stop-loss: ${stopLossPercent}%, Leverage: ${strategy.leverage}x`);
          
          // Cancel the incorrect order
          const cancelResult = await this.cancelExchangeOrder(symbol, existingSlOrder.orderId);
          if (cancelResult.success) {
            console.log(`   ✓ Canceled incorrect SL order`);
            
            // Place new correct order
            const placeResult = await this.placeExitOrder(
              dbPosition,
              'STOP_MARKET',
              correctSlPrice,
              Math.abs(positionAmt),
              'stop_loss'
            );
            
            if (placeResult.success) {
              console.log(`   ✓ Placed correct SL order at $${correctSlPrice.toFixed(2)}`);
              fixedCount++;
            } else {
              console.error(`   ✗ Failed to place correct SL order: ${placeResult.error}`);
            }
          } else {
            console.error(`   ✗ Failed to cancel incorrect SL order: ${cancelResult.error}`);
          }
        }
      }

      if (fixedCount > 0) {
        console.log(`✅ Fixed ${fixedCount} incorrect stop-loss orders`);
      }

      return fixedCount;
    } catch (error) {
      console.error('❌ Error fixing incorrect stop-loss orders:', error);
      return 0;
    }
  }

  // Fill a paper order and create fill record
  private async fillPaperOrder(order: Order, fillPrice: number, fillQuantity: number, tradeType: 'entry' | 'layer' | 'stop_loss' | 'take_profit' = 'entry') {
    // Update order status
    await storage.updateOrderStatus(order.id, 'filled', new Date());

    // FIRST: Ensure position exists and get its ID
    const position = await this.ensurePositionForFill(order, fillPrice, fillQuantity);

    // Create fill record with Aster DEX taker fee AND position_id
    const fillValue = fillPrice * fillQuantity;
    const fee = (fillValue * ASTER_TAKER_FEE_PERCENT) / 100; // 0.035% taker fee
    
    await storage.applyFill({
      orderId: order.id,
      sessionId: order.sessionId,
      positionId: position.id, // Link fill to position
      symbol: order.symbol,
      side: order.side,
      quantity: fillQuantity.toString(),
      price: fillPrice.toString(),
      value: fillValue.toString(),
      fee: fee.toString(),
      layerNumber: order.layerNumber,
    });

    // Deduct entry fee from session balance
    const session = this.activeSessions.get(order.sessionId);
    if (session) {
      const currentBalance = parseFloat(session.currentBalance);
      const newBalance = currentBalance - fee;
      
      await storage.updateTradeSession(session.id, {
        currentBalance: newBalance.toString(),
      });
      
      session.currentBalance = newBalance.toString();
      console.log(`💸 Entry fee applied: $${fee.toFixed(4)} (${ASTER_TAKER_FEE_PERCENT}% of $${fillValue.toFixed(2)})`);
    }

    // Broadcast trade notification to connected clients
    this.broadcastTradeNotification({
      symbol: order.symbol,
      side: position.side as 'long' | 'short',
      tradeType: order.layerNumber === 1 ? 'entry' : 'layer',
      layerNumber: order.layerNumber,
      price: fillPrice,
      quantity: fillQuantity,
      value: fillValue
    });
    
    // NOTE: Cooldown is already set in executeLayer/executeEntry when the order is PLACED
    // Do NOT reset it here on fill, as that would allow duplicate orders to slip through
    // The cooldown protects against rapid order PLACEMENT, not fills
  }

  // Fill a live order using ACTUAL exchange data (price, qty, commission, timestamp)
  private async fillLiveOrder(order: Order, actualFillPrice: number, actualFillQty: number, actualCommission: number, actualTimestamp?: number) {
    // Update order status
    await storage.updateOrderStatus(order.id, 'filled', new Date());

    // FIRST: Ensure position exists and get its ID
    const position = await this.ensurePositionForFill(order, actualFillPrice, actualFillQty);

    // Create fill record with ACTUAL exchange data
    const fillValue = actualFillPrice * actualFillQty;
    
    await storage.applyFill({
      orderId: order.id,
      sessionId: order.sessionId,
      positionId: position.id, // Link fill to position
      symbol: order.symbol,
      side: order.side,
      quantity: actualFillQty.toString(),
      price: actualFillPrice.toString(),
      value: fillValue.toString(),
      fee: actualCommission.toString(), // ✅ ACTUAL commission from exchange
      layerNumber: order.layerNumber,
      filledAt: actualTimestamp ? new Date(actualTimestamp) : undefined, // ✅ Use exchange timestamp
    });

    // Deduct ACTUAL entry fee from session balance
    const session = this.activeSessions.get(order.sessionId);
    if (session) {
      const currentBalance = parseFloat(session.currentBalance);
      const newBalance = currentBalance - actualCommission; // Use actual commission
      
      await storage.updateTradeSession(session.id, {
        currentBalance: newBalance.toString(),
      });
      
      session.currentBalance = newBalance.toString();
      const feePercent = (actualCommission / fillValue) * 100;
      console.log(`💸 REAL entry fee applied: $${actualCommission.toFixed(4)} (${feePercent.toFixed(3)}% of $${fillValue.toFixed(2)}) - from exchange`);
    }

    // Broadcast trade notification to connected clients
    this.broadcastTradeNotification({
      symbol: order.symbol,
      side: position.side as 'long' | 'short',
      tradeType: order.layerNumber === 1 ? 'entry' : 'layer',
      layerNumber: order.layerNumber,
      price: actualFillPrice,
      quantity: actualFillQty,
      value: fillValue
    });
    
    // NOTE: Cooldown is already set in executeLayer/executeEntry when the order is PLACED
    // Do NOT reset it here on fill, as that would allow duplicate orders to slip through
    // The cooldown protects against rapid order PLACEMENT, not fills
    
    // AUTOMATICALLY update TP/SL orders for live mode (all layers)
    await this.updateProtectiveOrders(position, order.sessionId);
  }

  // Ensure position exists and return it (create or update as needed)
  // This must be called BEFORE creating fills so we have the position ID
  private async ensurePositionForFill(order: Order, fillPrice: number, fillQuantity: number): Promise<Position> {
    // CRITICAL: Must check BOTH symbol AND side for hedge mode compatibility
    const positionSide = order.side === 'buy' ? 'long' : 'short';
    let position = await storage.getPositionBySymbolAndSide(order.sessionId, order.symbol, positionSide);
    
    if (!position) {
      // Find the strategy to get maxLayers and leverage settings
      let maxLayers = 5; // Default fallback
      let leverage = 1; // Default fallback
      this.activeStrategies.forEach((strategy) => {
        const session = this.activeSessions.get(strategy.id);
        if (session && session.id === order.sessionId) {
          maxLayers = strategy.maxLayers;
          leverage = strategy.leverage;
        }
      });

      // Calculate actual margin used (totalCost = notional value / leverage)
      const notionalValue = fillPrice * fillQuantity;
      const actualMargin = notionalValue / leverage;
      
      // Retrieve q1 (base layer size) for consistent exponential sizing across all layers
      const q1Key = `${order.sessionId}-${order.symbol}-${positionSide}`;
      const dcaBaseSize = this.pendingQ1Values.get(q1Key);
      const firstLayerData = this.pendingFirstLayerData.get(q1Key);
      
      if (dcaBaseSize) {
        console.log(`✅ Retrieved q1=${dcaBaseSize.toFixed(6)} for ${order.symbol} ${positionSide}`);
        // Clean up after retrieval
        this.pendingQ1Values.delete(q1Key);
      } else {
        console.warn(`⚠️ No q1 found for ${q1Key}, DCA sizing may be inconsistent`);
      }

      console.log(`🔍 POSITION CREATE DEBUG: order.side=${order.side}, derived positionSide=${positionSide}`);
      
      try {
        // Create new position
        position = await storage.createPosition({
          sessionId: order.sessionId,
          symbol: order.symbol,
          side: positionSide,
          totalQuantity: fillQuantity.toString(),
          avgEntryPrice: fillPrice.toString(),
          initialEntryPrice: fillPrice.toString(), // P0: Store initial entry price for DCA calculations
          dcaBaseSize: dcaBaseSize?.toString(), // q1: Base layer size for exponential growth
          totalCost: actualMargin.toString(), // Actual margin = notional / leverage
          layersFilled: 1,
          maxLayers,
          leverage,
          lastLayerPrice: fillPrice.toString(),
        });
        
        // Create position layer record for Layer 1
        if (firstLayerData) {
          const layer = await storage.createPositionLayer({
            positionId: position.id,
            layerNumber: 1,
            entryPrice: firstLayerData.entryPrice.toString(),
            quantity: firstLayerData.quantity.toString(),
            cost: actualMargin.toString(),
            takeProfitPrice: firstLayerData.takeProfitPrice.toString(),
            stopLossPrice: firstLayerData.stopLossPrice.toString(),
          });
          console.log(`📊 Created Layer 1 record: Entry=$${firstLayerData.entryPrice.toFixed(6)}, TP=$${firstLayerData.takeProfitPrice.toFixed(6)}, SL=$${firstLayerData.stopLossPrice.toFixed(6)}`);
          
          // SIMPLIFIED: No longer placing individual layer TP/SL orders
          // Position-level TP/SL will be managed by OrderProtectionService based on average entry
          console.log(`📊 Position-level protective orders will be managed by OrderProtectionService`);
          
          // Clean up only after successful layer creation
          this.pendingFirstLayerData.delete(q1Key);
        } else {
          console.warn(`⚠️ No first layer TP/SL data found for ${q1Key}, position layer not created`);
        }
      } catch (positionError) {
        console.error(`❌ Failed to create position:`, positionError);
        // Don't clean up data on position creation failure - we might retry
        throw positionError;
      }
    } else {
      // Update existing position with new layer
      await this.updatePositionAfterFill(position, fillPrice, fillQuantity);
      // Fetch the updated position to return
      const updatedPosition = await storage.getPosition(position.id);
      if (updatedPosition) {
        position = updatedPosition;
      }
    }
    
    return position;
  }

  // Update position after adding a layer
  private async updatePositionAfterFill(position: Position, fillPrice: number, fillQuantity: number) {
    const currentQuantity = parseFloat(position.totalQuantity);
    const currentCost = parseFloat(position.totalCost);
    const currentAvgPrice = parseFloat(position.avgEntryPrice);
    const leverage = position.leverage || 1; // Use position's leverage

    // Validate current values - if NaN, reset to safe defaults
    const safeCurrentQuantity = isNaN(currentQuantity) ? 0 : currentQuantity;
    const safeCurrentCost = isNaN(currentCost) ? 0 : currentCost;
    const safeCurrentAvgPrice = isNaN(currentAvgPrice) ? 0 : currentAvgPrice;

    const newQuantity = safeCurrentQuantity + fillQuantity;
    
    // Calculate new average entry price using notional values (price-based, not margin-based)
    // If position was corrupted (qty=0, price=NaN), reset to current fill price
    const newAvgPrice = safeCurrentQuantity > 0 
      ? ((safeCurrentAvgPrice * safeCurrentQuantity) + (fillPrice * fillQuantity)) / newQuantity
      : fillPrice;
    
    // Add actual margin for new layer (notional / leverage)
    const newLayerMargin = (fillPrice * fillQuantity) / leverage;
    const newCost = safeCurrentCost + newLayerMargin;

    // Final validation - ensure no NaN values are saved
    if (isNaN(newQuantity) || isNaN(newAvgPrice) || isNaN(newCost)) {
      console.error(`❌ NaN detected in position update for ${position.symbol}:`, {
        newQuantity,
        newAvgPrice,
        newCost,
        fillPrice,
        fillQuantity,
        currentQuantity: safeCurrentQuantity,
        currentAvgPrice: safeCurrentAvgPrice,
        currentCost: safeCurrentCost
      });
      // Don't update if values are invalid
      return;
    }

    const nextLayerNumber = position.layersFilled + 1;
    
    await storage.updatePosition(position.id, {
      totalQuantity: newQuantity.toString(),
      avgEntryPrice: newAvgPrice.toString(), // Weighted average of entry prices
      totalCost: newCost.toString(), // Actual total margin used
      layersFilled: nextLayerNumber,
      lastLayerPrice: fillPrice.toString(),
    });
    
    // Create position layer record if we have the TP/SL data
    const layerKey = `${position.id}-${nextLayerNumber}`;
    const layerData = this.pendingFirstLayerData.get(layerKey);
    
    if (layerData) {
      const layer = await storage.createPositionLayer({
        positionId: position.id,
        layerNumber: nextLayerNumber,
        entryPrice: layerData.entryPrice.toString(),
        quantity: layerData.quantity.toString(),
        cost: newLayerMargin.toString(),
        takeProfitPrice: layerData.takeProfitPrice.toString(),
        stopLossPrice: layerData.stopLossPrice.toString(),
      });
      console.log(`📊 Created Layer ${nextLayerNumber} record: Entry=$${layerData.entryPrice.toFixed(6)}, TP=$${layerData.takeProfitPrice.toFixed(6)}, SL=$${layerData.stopLossPrice.toFixed(6)}`);
      
      // SIMPLIFIED: No longer placing individual layer TP/SL orders
      // Position-level TP/SL will be managed by OrderProtectionService based on average entry
      console.log(`📊 Position-level protective orders will be managed by OrderProtectionService`);
      
      // Clean up after use
      this.pendingFirstLayerData.delete(layerKey);
    } else {
      console.warn(`⚠️ No layer TP/SL data found for ${layerKey}, position layer not created`);
    }
  }

  // SIMPLIFIED: Progressive layer monitoring disabled - using position-level TP/SL only
  private startExitMonitoring() {
    console.log(`📊 Progressive layer monitoring disabled - using position-level TP/SL managed by OrderProtectionService`);
    // No monitoring needed - TP/SL orders are on the exchange order book
  }

  // Check individual layers for progressive TP/SL exits
  private async checkLayersForExit(position: Position) {
    try {
      // Get all open layers for this position
      const openLayers = await storage.getOpenPositionLayers(position.id);
      
      if (openLayers.length === 0) {
        return; // No layers to monitor
      }

      // Get current market price
      const currentPrice = await this.fetchCurrentMarketPrice(position.symbol);
      if (!currentPrice) {
        return;
      }

      // Check each layer for TP/SL hits
      for (const layer of openLayers) {
        const entryPrice = parseFloat(layer.entryPrice);
        const takeProfitPrice = parseFloat(layer.takeProfitPrice);
        const stopLossPrice = parseFloat(layer.stopLossPrice);
        
        let shouldClose = false;
        let reason = '';

        if (position.side === 'long') {
          // Long: close if price >= TP or price <= SL
          if (currentPrice >= takeProfitPrice) {
            shouldClose = true;
            reason = 'TP Hit';
          } else if (currentPrice <= stopLossPrice) {
            shouldClose = true;
            reason = 'SL Hit';
          }
        } else {
          // Short: close if price <= TP or price >= SL
          if (currentPrice <= takeProfitPrice) {
            shouldClose = true;
            reason = 'TP Hit';
          } else if (currentPrice >= stopLossPrice) {
            shouldClose = true;
            reason = 'SL Hit';
          }
        }

        if (shouldClose) {
          console.log(`🎯 Layer ${layer.layerNumber} ${reason}: ${position.symbol} ${position.side}`);
          console.log(`   Entry: $${entryPrice.toFixed(6)}, Current: $${currentPrice.toFixed(6)}, TP: $${takeProfitPrice.toFixed(6)}, SL: $${stopLossPrice.toFixed(6)}`);
          
          await this.closeIndividualLayer(position, layer, currentPrice, reason);
        }
      }
    } catch (error) {
      console.error(`❌ Error checking layers for ${position.symbol}:`, error);
    }
  }

  // Close an individual layer when it hits TP/SL
  private async closeIndividualLayer(position: Position, layer: any, currentPrice: number, reason: string) {
    try {
      const layerQty = parseFloat(layer.quantity);
      const entryPrice = parseFloat(layer.entryPrice);

      // Calculate P&L for this layer
      const pnlPercent = position.side === 'long'
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - currentPrice) / entryPrice) * 100;

      const realizedPnlDollar = (currentPrice - entryPrice) * layerQty * (position.side === 'long' ? 1 : -1);

      console.log(`💰 Closing Layer ${layer.layerNumber}: Qty=${layerQty}, P&L=${pnlPercent.toFixed(2)}% ($${realizedPnlDollar.toFixed(2)})`);

      // Execute market order to close this layer
      const orderSide = position.side === 'long' ? 'sell' : 'buy';
      
      const closeResult = await this.executeLiveOrder({
        symbol: position.symbol,
        side: orderSide,
        orderType: 'market',
        quantity: layerQty,
        price: currentPrice,
        positionSide: this.exchangePositionMode === 'dual' ? position.side : undefined,
      });

      if (!closeResult.success) {
        console.error(`❌ Failed to close layer ${layer.layerNumber}: ${closeResult.error}`);
        return;
      }

      console.log(`✅ Layer ${layer.layerNumber} closed: Order #${closeResult.orderId}`);

      // Mark layer as closed in database
      await storage.closePositionLayer(layer.id, realizedPnlDollar);

      // Update position: reduce quantity and recalculate
      await this.updatePositionAfterLayerClose(position, layer, currentPrice);

    } catch (error) {
      console.error(`❌ Failed to close layer ${layer.layerNumber}:`, error);
    }
  }

  // Update position after closing a layer
  private async updatePositionAfterLayerClose(position: Position, closedLayer: any, closePrice: number) {
    try {
      const closedQty = parseFloat(closedLayer.quantity);
      const currentTotalQty = parseFloat(position.totalQuantity);
      const newTotalQty = currentTotalQty - closedQty;

      // Get all remaining open layers to recalculate avg entry
      const remainingLayers = await storage.getOpenPositionLayers(position.id);
      
      let newAvgEntry = parseFloat(position.avgEntryPrice); // Start with current value as fallback
      let newTotalCost = 0;

      if (remainingLayers.length > 0) {
        // Recalculate weighted average entry from remaining layers
        let totalNotional = 0;
        let totalQty = 0;

        for (const layer of remainingLayers) {
          const qty = parseFloat(layer.quantity);
          const entry = parseFloat(layer.entryPrice);
          totalNotional += qty * entry;
          totalQty += qty;
          newTotalCost += parseFloat(layer.cost);
        }

        newAvgEntry = totalQty > 0 ? totalNotional / totalQty : newAvgEntry;
      } else if (newTotalQty > 0.000001) {
        // CRITICAL FIX: No layers found but position still open - fetch from exchange
        console.warn(`⚠️ No layers found for ${position.symbol} ${position.side}, fetching live exchange position...`);
        
        try {
          const apiKey = process.env.ASTER_API_KEY;
          const secretKey = process.env.ASTER_SECRET_KEY;
          
          if (apiKey && secretKey) {
            const timestamp = Date.now();
            const queryString = `timestamp=${timestamp}`;
            const signature = createHmac('sha256', secretKey)
              .update(queryString)
              .digest('hex');
            
            const response = await fetch(
              `https://fapi.asterdex.com/fapi/v2/positionRisk?${queryString}&signature=${signature}`,
              {
                headers: { 'X-MBX-APIKEY': apiKey }
              }
            );
            
            if (response.ok) {
              const positions = await response.json();
              const livePosition = positions.find((p: any) => {
                if (p.symbol !== position.symbol || parseFloat(p.positionAmt) === 0) return false;
                const isShort = parseFloat(p.positionAmt) < 0;
                return (position.side === 'short' && isShort) || (position.side === 'long' && !isShort);
              });
              
              if (livePosition && parseFloat(livePosition.entryPrice) > 0) {
                newAvgEntry = parseFloat(livePosition.entryPrice);
                console.log(`✅ Retrieved live exchange avgEntry: $${newAvgEntry.toFixed(6)} for ${position.symbol} ${position.side}`);
              }
            }
          }
        } catch (error) {
          console.error(`❌ Failed to fetch live exchange position:`, error);
        }
      }
      
      // SAFEGUARD: Never allow avgEntryPrice to be set to 0
      if (newAvgEntry === 0 || isNaN(newAvgEntry)) {
        const currentAvg = parseFloat(position.avgEntryPrice);
        if (currentAvg > 0) {
          console.warn(`🛡️ Preventing avgEntryPrice corruption: keeping current value $${currentAvg.toFixed(6)}`);
          newAvgEntry = currentAvg;
        } else {
          console.error(`❌ CRITICAL: Cannot determine valid avgEntryPrice for ${position.symbol} ${position.side}`);
          return; // Abort update to prevent corruption
        }
      }

      // Calculate realized P&L for closed layer
      const closedLayerEntry = parseFloat(closedLayer.entryPrice);
      const pnlPercent = position.side === 'long'
        ? ((closePrice - closedLayerEntry) / closedLayerEntry) * 100
        : ((closedLayerEntry - closePrice) / closedLayerEntry) * 100;

      const realizedPnlDollar = (closePrice - closedLayerEntry) * closedQty * (position.side === 'long' ? 1 : -1);

      if (newTotalQty <= 0.000001) {
        // Position fully closed - all layers taken profit/stopped out
        console.log(`📊 Position fully closed: All ${position.symbol} ${position.side} layers exited`);
        await storage.closePosition(position.id, new Date(), realizedPnlDollar, pnlPercent);
        
        // Note: Orphaned TP/SL orders will be cleaned up by the reconciliation service
      } else {
        // Position partially closed - update remaining size
        console.log(`📊 Position reduced: ${currentTotalQty.toFixed(4)} → ${newTotalQty.toFixed(4)} (-${closedQty.toFixed(4)})`);
        
        // Update position in database
        const updatedPosition = await storage.updatePosition(position.id, {
          totalQuantity: newTotalQty.toString(),
          avgEntryPrice: newAvgEntry.toString(),
          totalCost: newTotalCost.toString(),
        });

        // Update TP/SL orders to match new position size
        const session = Array.from(this.activeSessions.values()).find(s => s.id === position.sessionId);
        if (session) {
          const strategy = this.activeStrategies.get(session.strategyId);
          if (strategy && updatedPosition) {
            await orderProtectionService.updateProtectiveOrders(updatedPosition, strategy);
          }
        }
      }

    } catch (error) {
      console.error(`❌ Failed to update position after layer close:`, error);
    }
  }

  // Fetch current market price from exchange API
  private async fetchCurrentMarketPrice(symbol: string): Promise<number | null> {
    try {
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${symbol}`);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return parseFloat(data.price);
    } catch (error) {
      return null;
    }
  }

  // Check if position should be closed
  private async checkExitCondition(strategy: Strategy, position: Position) {
    // Fetch real-time current price from Aster DEX API (no cache)
    let currentPrice: number | null = null;
    try {
      const asterApiUrl = `https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${position.symbol}`;
      const priceResponse = await fetch(asterApiUrl);
      
      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        currentPrice = parseFloat(priceData.price);
      }
    } catch (error) {
      console.error(`Failed to fetch real-time price for ${position.symbol}:`, error);
      return;
    }
    
    if (!currentPrice) return;

    const avgEntryPrice = parseFloat(position.avgEntryPrice);
    const profitTargetPercent = parseFloat(strategy.profitTargetPercent);
    
    let unrealizedPnl = 0;
    if (position.side === 'long') {
      unrealizedPnl = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;
    } else {
      unrealizedPnl = ((avgEntryPrice - currentPrice) / avgEntryPrice) * 100;
    }

    // Update position with latest unrealized PnL (based on real-time price)
    await storage.updatePosition(position.id, {
      unrealizedPnl: unrealizedPnl.toString(),
    });

    // Check if profit target is reached (exit with limit order - 0.01% maker fee)
    if (unrealizedPnl >= profitTargetPercent) {
      await this.closePosition(position, currentPrice, unrealizedPnl, 'take_profit');
      return;
    }

    // Check if stop loss is triggered (exit with stop market order - 0.035% taker fee)
    const stopLossPercent = parseFloat(strategy.stopLossPercent);
    if (unrealizedPnl <= -stopLossPercent) {
      console.log(`🛑 Stop loss triggered for ${position.symbol}: ${unrealizedPnl.toFixed(2)}% loss exceeds -${stopLossPercent}% threshold`);
      await this.closePosition(position, currentPrice, unrealizedPnl, 'stop_loss');
      return;
    }
  }

  // Close a position at current market price
  private async closePosition(
    position: Position, 
    exitPrice: number, 
    realizedPnlPercent: number,
    exitType: 'take_profit' | 'stop_loss' = 'take_profit'
  ) {
    try {
      // Guard: Check if position is already closed (prevent duplicate exit fills)
      if (!position.isOpen) {
        console.log(`⚠️ Position ${position.symbol} already closed, skipping...`);
        return;
      }

      // Calculate dollar P&L from percentage
      // CRITICAL: totalCost stores MARGIN, multiply by leverage to get notional value
      const totalCost = parseFloat(position.totalCost);
      const leverage = (position as any).leverage || 1;
      const notionalValue = totalCost * leverage;
      const dollarPnl = (realizedPnlPercent / 100) * notionalValue;
      
      // Determine exit order type and fee
      const orderType = exitType === 'take_profit' ? 'limit' : 'stop_market';
      const feePercent = exitType === 'take_profit' ? ASTER_MAKER_FEE_PERCENT : ASTER_TAKER_FEE_PERCENT;
      const exitReason = exitType === 'take_profit' ? 'take profit' : 'stop loss';
      
      console.log(`🎯 Closing position ${position.symbol} at $${exitPrice} via ${orderType.toUpperCase()} (${exitReason}) with ${realizedPnlPercent.toFixed(2)}% P&L ($${dollarPnl.toFixed(2)})`);

      // Get session
      const session = this.activeSessions.get(position.sessionId);
      
      // Calculate exit fee based on order type
      // Take profit = limit order (0.01% maker fee)
      // Stop loss = stop market order (0.035% taker fee)
      const quantity = parseFloat(position.totalQuantity);
      const exitValue = exitPrice * quantity;
      const exitFee = (exitValue * feePercent) / 100;
      
      // Variables to store actual or calculated fill data
      let actualExitPrice = exitPrice;
      let actualExitQty = quantity;
      let actualExitFee = exitFee;
      
      // Place the actual exit order on Aster DEX
      {
        const exitSide = position.side === 'long' ? 'sell' : 'buy';
        const liveOrderResult = await this.executeLiveOrder({
          symbol: position.symbol,
          side: exitSide,
          orderType,
          quantity,
          price: exitPrice,
          positionSide: position.side, // Position side for hedge mode
        });
        
        if (!liveOrderResult.success) {
          console.error(`❌ Failed to place live exit order: ${liveOrderResult.error}`);
          // Don't close position if live order failed
          return;
        }
        
        console.log(`✅ Live exit order placed: ${orderType.toUpperCase()} ${exitSide} ${quantity.toFixed(4)} ${position.symbol} at $${exitPrice}`);
        
        // Fetch actual fill data from exchange (with retry logic for fill propagation delay)
        let actualFillsData: any[] | null = null;
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries && liveOrderResult.orderId) {
          // Small delay to allow exchange to process the fill
          if (retryCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 500)); // 500ms between retries
          }
          
          const fillResult = await fetchActualFills({
            symbol: position.symbol,
            orderId: liveOrderResult.orderId,
          });
          
          if (fillResult.success && fillResult.fills && fillResult.fills.length > 0) {
            actualFillsData = fillResult.fills; // Store ALL fills for aggregation
            break;
          }
          
          retryCount++;
        }
        
        let actualExitTimestamp: number | undefined;
        
        if (actualFillsData && actualFillsData.length > 0) {
          // Aggregate multiple fills (handles partial fills correctly)
          const aggregated = aggregateFills(actualFillsData);
          
          actualExitPrice = aggregated.avgPrice;
          actualExitQty = aggregated.totalQty;
          actualExitFee = aggregated.totalCommission;
          actualExitTimestamp = aggregated.timestamp;
          
          console.log(`💎 Using REAL exchange EXIT data (${actualFillsData.length} fill(s)) - Price: $${actualExitPrice.toFixed(6)}, Qty: ${actualExitQty.toFixed(4)}, Fee: $${actualExitFee.toFixed(4)}`);
          console.log(`📊 Exit fill type: ${aggregated.isMaker ? 'MAKER' : 'TAKER'}`);
        } else {
          console.warn(`⚠️ Could not fetch actual exit fill data after ${maxRetries} attempts, using calculated values`);
        }
      }
      
      // Recalculate values based on actual fill data (for live) or calculated data (for paper)
      const actualExitValue = actualExitPrice * actualExitQty;
      
      // Create exit fill record with ACTUAL data
      await storage.applyFill({
        orderId: `exit-${position.id}`, // Synthetic order ID for exit
        sessionId: position.sessionId,
        positionId: position.id, // Link exit fill to position
        symbol: position.symbol,
        side: position.side === 'long' ? 'sell' : 'buy', // Opposite side to close
        quantity: actualExitQty.toString(), // ✅ Use actual quantity
        price: actualExitPrice.toString(), // ✅ Use actual price
        value: actualExitValue.toString(), // ✅ Use actual value
        fee: actualExitFee.toString(), // ✅ Use actual fee
        layerNumber: 0, // Exit trades don't have layers
        filledAt: actualExitTimestamp ? new Date(actualExitTimestamp) : undefined, // ✅ Use exchange timestamp
      });

      // Broadcast trade notification for exit with ACTUAL data
      this.broadcastTradeNotification({
        symbol: position.symbol,
        side: position.side as 'long' | 'short',
        tradeType: exitType,
        price: actualExitPrice, // ✅ Use actual price
        quantity: actualExitQty, // ✅ Use actual quantity
        value: actualExitValue // ✅ Use actual value
      });

      // Close position in database with dollar P&L and percentage (preserve percentage for display)
      // Use exchange timestamp if available, otherwise use current time
      const closedAtTimestamp = actualExitTimestamp ? new Date(actualExitTimestamp) : new Date();
      await storage.closePosition(position.id, closedAtTimestamp, dollarPnl, realizedPnlPercent);

      // Always fetch latest session from database (not memory) to update stats
      const latestSession = await storage.getTradeSession(position.sessionId);
      if (latestSession) {
        const newTotalTrades = latestSession.totalTrades + 1;
        const oldTotalPnl = parseFloat(latestSession.totalPnl);
        
        // Subtract ACTUAL exit fee from realized P&L (uses real exchange data in live mode)
        const netDollarPnl = dollarPnl - actualExitFee; // ✅ Use actual fee
        const newTotalPnl = oldTotalPnl + netDollarPnl;
        
        // Update current balance with net realized P&L
        const oldBalance = parseFloat(latestSession.currentBalance);
        const newBalance = oldBalance + netDollarPnl;
        
        await storage.updateTradeSession(latestSession.id, {
          totalTrades: newTotalTrades,
          totalPnl: newTotalPnl.toString(),
          currentBalance: newBalance.toString(),
        });
        
        // Update local session cache if it exists
        if (session) {
          session.totalTrades = newTotalTrades;
          session.totalPnl = newTotalPnl.toString();
          session.currentBalance = newBalance.toString();
        }
        
        // Show detailed fee breakdown using ACTUAL data
        const actualFeePercent = (actualExitFee / actualExitValue) * 100;
        console.log(`💸 Exit fee applied: $${actualExitFee.toFixed(4)} (${actualFeePercent.toFixed(3)}% ${orderType === 'limit' ? 'maker' : 'taker'} fee - $${actualExitValue.toFixed(2)} value - from exchange)`);
        console.log(`💰 Balance updated: $${oldBalance.toFixed(2)} → $${newBalance.toFixed(2)} (P&L: $${dollarPnl.toFixed(2)}, Fee: -$${actualExitFee.toFixed(4)}, Net: $${netDollarPnl.toFixed(2)})`);
      } else {
        console.warn(`⚠️ Could not update session stats - session ${position.sessionId} not found in database`);
      }

      console.log(`✅ Position closed: ${position.symbol} - P&L: ${realizedPnlPercent.toFixed(2)}% ($${dollarPnl.toFixed(2)}, Fee: $${actualExitFee.toFixed(4)})`);
    } catch (error) {
      console.error('❌ Error closing position:', error);
    }
  }

  // Lock map to prevent concurrent TP/SL updates for the same position
  private tpslUpdateLocks = new Map<string, Promise<void>>();
  
  // Update protective orders (TP/SL) using the new OrderProtectionService
  // This function is called after entry AND after each layer to update orders for the new position size
  private async updateProtectiveOrders(position: Position, sessionId: string) {
    try {
      // Find the strategy to get TP/SL percentages
      let strategy: Strategy | undefined;
      for (const [stratId, sess] of Array.from(this.activeSessions.entries())) {
        if (sess.id === sessionId) {
          strategy = this.activeStrategies.get(stratId);
          if (strategy) break;
        }
      }
      
      if (!strategy) {
        console.warn(`⚠️ Could not find strategy for session ${sessionId}, skipping TP/SL update`);
        return;
      }
      
      // OrderProtectionService will fetch live exchange position for accurate TP/SL
      // (Database position may be stale due to async fill processing)
      await orderProtectionService.updateProtectiveOrders(position, strategy);
      
    } catch (error) {
      console.error('❌ Error updating protective orders:', error);
    }
  }
  
  // Fetch all open orders for a symbol from the exchange
  private async fetchExchangeOrders(symbol: string): Promise<Array<{ 
    symbol: string; 
    type: string; 
    positionSide: string;
    price?: string;
    stopPrice?: string;
  }>> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        return [];
      }
      
      const timestamp = Date.now();
      const params: Record<string, string | number> = {
        symbol,
        timestamp,
        recvWindow: 5000,
      };
      
      const queryString = Object.entries(params)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
      
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const signedParams = `${queryString}&signature=${signature}`;
      
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/openOrders?${signedParams}`, {
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      });
      
      if (!response.ok) {
        return [];
      }
      
      const orders = await response.json();
      
      return orders.map((order: any) => ({
        symbol: order.symbol,
        type: order.type,
        positionSide: (order.positionSide || '').toLowerCase(),
        price: order.price,
        stopPrice: order.stopPrice,
      }));
    } catch (error) {
      console.error(`❌ Error fetching exchange orders for ${symbol}:`, error);
      return [];
    }
  }

  // Get active TP/SL orders for a specific position (symbol + side) from the exchange
  private async getActiveTPSLOrders(symbol: string, positionSide: string): Promise<Array<{ orderId: string; type: string }>> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        return [];
      }
      
      const timestamp = Date.now();
      const params: Record<string, string | number> = {
        symbol,
        timestamp,
        recvWindow: 5000,
      };
      
      const queryString = Object.entries(params)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
      
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const signedParams = `${queryString}&signature=${signature}`;
      
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/openOrders?${signedParams}`, {
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      });
      
      if (!response.ok) {
        return [];
      }
      
      const orders = await response.json();
      
      // Filter for TP/SL orders matching this position
      return orders
        .filter((order: any) => {
          // Must be TP or SL order type
          if (order.type !== 'TAKE_PROFIT_MARKET' && order.type !== 'STOP_MARKET') {
            return false;
          }
          
          // In dual mode, filter by positionSide
          if (this.exchangePositionMode === 'dual') {
            const orderPositionSide = (order.positionSide || '').toLowerCase();
            return orderPositionSide === positionSide.toLowerCase();
          }
          
          // In one-way mode, all TP/SL orders for this symbol belong to the same position
          return true;
        })
        .map((order: any) => ({
          orderId: order.orderId.toString(),
          type: order.type === 'TAKE_PROFIT_MARKET' ? 'TP' : 'SL',
        }));
    } catch (error) {
      console.error('❌ Error fetching active TP/SL orders:', error);
      return [];
    }
  }

  // Place an exit order (TP/SL) on the exchange
  private async placeExitOrder(
    position: Position,
    orderType: 'LIMIT' | 'STOP_MARKET' | 'MARKET',
    price: number,
    quantity: number,
    exitType: 'take_profit' | 'stop_loss'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Determine the exit side (opposite of position side)
      const exitSide = position.side === 'long' ? 'sell' : 'buy';
      
      // Get the strategy from session
      let strategy: Strategy | undefined;
      for (const [stratId, sess] of Array.from(this.activeSessions.entries())) {
        if (sess.id === position.sessionId) {
          strategy = this.activeStrategies.get(stratId);
          if (strategy) break;
        }
      }
      
      // Place the live order on Aster DEX with automatic precision rounding
      // Only pass positionSide if the EXCHANGE is in dual mode (not based on strategy settings)
      const liveOrderResult = await this.executeLiveOrder({
        symbol: position.symbol,
        side: exitSide,
        orderType: orderType.toLowerCase(),
        quantity,
        price,
        // Only include positionSide if the EXCHANGE is in dual mode
        positionSide: this.exchangePositionMode === 'dual' ? position.side : undefined,
      });
      
      if (!liveOrderResult.success) {
        console.error(`❌ Failed to place ${orderType} exit order: ${liveOrderResult.error}`);
        return { success: false, error: liveOrderResult.error };
      }
      
      console.log(`✅ ${orderType} exit order placed: ${exitSide} ${quantity.toFixed(4)} ${position.symbol} at $${price.toFixed(2)}`);
      return { success: true };
    } catch (error) {
      console.error('❌ Error placing exit order:', error);
      return { success: false, error: String(error) };
    }
  }

  // Handle position update events
  private async handlePositionUpdate(update: PositionUpdate) {
    if (update.shouldExit) {
      const position = await storage.getPosition(update.positionId);
      if (position && position.isOpen) {
        await this.closePosition(position, update.currentPrice, update.unrealizedPnl);
      }
    }
  }

  // Public method to process liquidation (called from WebSocket handler)
  processLiquidation(liquidation: Liquidation) {
    this.emit('liquidation', liquidation);
  }

  // Get the currently running strategy (in-memory)
  getRunningStrategy(): Strategy | undefined {
    const strategies = Array.from(this.activeStrategies.values());
    return strategies.length > 0 ? strategies[0] : undefined;
  }

  // Reload a strategy when settings are updated
  async reloadStrategy(strategyId: string) {
    try {
      const updatedStrategy = await storage.getStrategy(strategyId);
      if (!updatedStrategy) {
        console.log(`⚠️ Cannot reload strategy ${strategyId}: not found`);
        return;
      }

      // CRITICAL: Only update if strategy is still registered (active)
      // This prevents stopped strategies from being reactivated by settings updates
      if (!this.activeStrategies.has(strategyId)) {
        console.log(`⏸️ Strategy ${strategyId} is not active, skipping reload`);
        return;
      }

      // Update the strategy in memory
      this.activeStrategies.set(strategyId, updatedStrategy);
      console.log(`🔄 Reloaded strategy: ${updatedStrategy.name} (${strategyId})`);
    } catch (error) {
      console.error(`❌ Error reloading strategy ${strategyId}:`, error);
    }
  }

  // NOTE: TP/SL monitoring is handled by updateProtectiveOrders() which is called after each fill
  // No need for separate monitoring - the system already updates TP/SL after every entry/layer

  // Start periodic cleanup and auto-repair monitoring
  private startCleanupMonitoring() {
    // Run reconciliation every 1 minute
    this.cleanupInterval = setInterval(async () => {
      if (!this.isRunning) return;
      
      // Prevent overlapping cleanup runs
      if (this.cleanupInProgress) {
        console.log('⏭️ Skipping reconciliation - previous run still in progress');
        return;
      }
      
      this.cleanupInProgress = true;
      
      try {
        console.log('🔄 Starting order reconciliation...');
        
        // Get active session and strategy
        const DEFAULT_USER_ID = "personal_user";
        const strategy = await storage.getOrCreateDefaultStrategy(DEFAULT_USER_ID);
        const session = await storage.getOrCreateActiveSession(DEFAULT_USER_ID);
        
        // 1. Sync orphan positions from exchange (positions not in DB)
        const { syncOpenPositions } = await import('./exchange-sync');
        const orphanSyncResult = await syncOpenPositions(session.id);
        if (orphanSyncResult.success && orphanSyncResult.addedCount > 0) {
          console.log(`  ✓ Synced ${orphanSyncResult.addedCount} orphan positions from exchange`);
        }
        
        // 2. Clean up orphaned orders (orders for closed positions)
        const orphanedCount = await orderProtectionService.reconcileOrphanedOrders(session.id);
        
        // 3. Verify all open positions have correct TP/SL orders (self-healing)
        await orderProtectionService.verifyAllPositions(session.id, strategy);
        
        // 3.5. Check for and place missing DCA layer protective orders
        await this.protectiveOrderRecovery.checkAndPlaceMissingOrders();
        
        // 4. Sync completed trades from exchange (automatic reconciliation)
        const syncResult = await syncCompletedTrades(session.id);
        if (syncResult.success && syncResult.addedCount > 0) {
          console.log(`  ✓ Synced ${syncResult.addedCount} completed trades from exchange`);
        }
        
        // 5. Keep data retention active (delete old liquidations)
        const deletedCount = await storage.deleteOldLiquidations(30);
        if (deletedCount > 0) {
          console.log(`  ✓ Deleted ${deletedCount} liquidations older than 30 days`);
        }
        
        console.log(`✅ Reconciliation complete: ${orphanedCount} orphaned orders cleaned`);
      } catch (error) {
        console.error('❌ Error in reconciliation:', error);
      } finally {
        this.cleanupInProgress = false;
      }
    }, 10 * 1000); // 10 seconds (aggressive protective order safety - always ensure TP/SL exist)
    
    console.log('🔄 Order reconciliation started: Orphan cleanup + Position verification (10s intervals)');
  }

  // Manual cleanup trigger - run all cleanup tasks immediately
  async runManualCleanup(): Promise<{
    orphanedOrders: number;
    staleOrders: number;
    repairedOrders: number;
    fixedOrders: number;
    deletedLiquidations: number;
    totalActions: number;
  }> {
    console.log('🧹 Manual cleanup triggered...');
    
    // Prevent overlapping cleanup
    if (this.cleanupInProgress) {
      throw new Error('Cleanup already in progress');
    }
    
    this.cleanupInProgress = true;
    
    try {
      // 1. Clean up orphaned TP/SL orders
      const orphanedCount = await this.cleanupOrphanedTPSL();
      if (orphanedCount > 0) {
        console.log(`  ✓ Removed ${orphanedCount} orphaned TP/SL orders`);
      }
      
      // 2. Clean up stale limit orders
      const staleCount = await this.cleanupStaleLimitOrders();
      if (staleCount > 0) {
        console.log(`  ✓ Canceled ${staleCount} stale limit orders`);
      }
      
      // 3. Auto-repair missing TP/SL orders
      const repairedCount = await this.autoRepairMissingTPSL();
      if (repairedCount > 0) {
        console.log(`  ✓ Placed ${repairedCount} missing TP/SL orders`);
      }
      
      // 4. Fix incorrect stop-loss orders
      const fixedCount = await this.fixIncorrectStopLossOrders();
      if (fixedCount > 0) {
        console.log(`  ✓ Fixed ${fixedCount} incorrect stop-loss orders`);
      }
      
      // 5. Delete old liquidations
      const deletedCount = await storage.deleteOldLiquidations(30);
      if (deletedCount > 0) {
        console.log(`  ✓ Deleted ${deletedCount} liquidations older than 30 days`);
      }
      
      const totalActions = orphanedCount + staleCount + repairedCount + fixedCount + deletedCount;
      console.log(`🧹 Manual cleanup complete: ${totalActions} total actions taken`);
      
      return {
        orphanedOrders: orphanedCount,
        staleOrders: staleCount,
        repairedOrders: repairedCount,
        fixedOrders: fixedCount,
        deletedLiquidations: deletedCount,
        totalActions
      };
    } finally {
      this.cleanupInProgress = false;
    }
  }
}

// Export singleton instance
export const strategyEngine = new StrategyEngine();