import { EventEmitter } from 'events';
import { createHmac } from 'crypto';
import { storage } from './storage';
import { 
  type Liquidation, 
  type Strategy, 
  type TradeSession, 
  type Position, 
  type Order, 
  type Fill 
} from '@shared/schema';
import { fetchActualFills, aggregateFills } from './exchange-utils';

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
  private pendingPaperOrders: Map<string, {
    order: Order;
    strategy: Strategy;
    targetPrice: number;
    startTime: number;
    maxRetryDuration: number;
    slippageTolerance: number;
  }> = new Map(); // Track pending paper orders for limit order simulation
  private positionCreationLocks: Map<string, Promise<void>> = new Map(); // sessionId-symbol -> lock to prevent duplicate positions
  private pendingLayerOrders: Map<string, Set<number>> = new Map(); // positionId -> Set of pending layer numbers to prevent duplicates
  private isRunning = false;
  private orderMonitorInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private wsClients: Set<any> = new Set(); // WebSocket clients for broadcasting trade notifications
  private staleLimitOrderSeconds: number = 180; // 3 minutes default timeout for limit orders
  private recoveryAttempts: Map<string, number> = new Map(); // Track cooldown for auto-repair attempts
  private cleanupInProgress: boolean = false; // Prevent overlapping cleanup runs
  private exchangePositionMode: 'one-way' | 'dual' | null = null; // Cache exchange position mode
  private lastFillTime: Map<string, number> = new Map(); // "sessionId-symbol-side" -> timestamp of last fill
  private fillCooldownMs: number = 30000; // 30 second cooldown between layers/entries

  constructor() {
    super();
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
    
    // Start periodic checks for exit conditions
    this.startExitMonitoring();
    
    // Start monitoring pending paper orders for limit order simulation
    this.startPaperOrderMonitoring();
    
    // Start periodic cleanup of orphaned TP/SL orders (every 5 minutes)
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
    this.pendingPaperOrders.clear();
    this.positionCreationLocks.clear();
    console.log('✅ StrategyEngine stopped');
  }

  // Get current market price for a symbol
  getCurrentPrice(symbol: string): number | undefined {
    return this.priceCache.get(symbol);
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
    
    // Update session mode if strategy trading mode has changed
    if (session.mode !== strategy.tradingMode) {
      await storage.updateTradeSession(session.id, {
        mode: strategy.tradingMode || 'paper',
      });
      session.mode = strategy.tradingMode || 'paper';
      console.log(`🔄 Updated session mode to: ${session.mode}`);
    }
    
    // Store by both strategy ID and session ID for easy lookup
    this.activeSessions.set(strategy.id, session);
    this.activeSessions.set(session.id, session);
    console.log(`✅ Strategy registered with session: ${session.id} (mode: ${session.mode})`);
  }

  // Unregister a strategy
  async unregisterStrategy(strategyId: string) {
    console.log(`📤 Unregistering strategy: ${strategyId}`);
    
    // CRITICAL: Capture session BEFORE removing from maps
    const session = this.activeSessions.get(strategyId);
    
    // CRITICAL: Remove from maps IMMEDIATELY to prevent race condition
    // This makes the strategy invisible to handleLiquidation before any awaits
    this.activeStrategies.delete(strategyId);
    if (session) {
      this.activeSessions.delete(session.id);
    }
    this.activeSessions.delete(strategyId);
    
    // Now safe to cancel pending orders using captured session - strategy is already invisible
    if (session) {
      const ordersToCancel: string[] = [];
      const pendingEntries = Array.from(this.pendingPaperOrders.entries());
      for (const [orderId, orderData] of pendingEntries) {
        if (orderData.order.sessionId === session.id) {
          ordersToCancel.push(orderId);
        }
      }
      
      if (ordersToCancel.length > 0) {
        console.log(`🚫 Cancelling ${ordersToCancel.length} pending orders for session ${session.id}`);
        for (const orderId of ordersToCancel) {
          // CRITICAL: Delete from map FIRST (synchronous) to prevent order monitor from filling
          // the order in the window between this and the DB update
          this.pendingPaperOrders.delete(orderId);
          await storage.updateOrderStatus(orderId, 'cancelled');
        }
      }
    }
    
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

    // Use configurable lookback window from strategy settings (convert hours to seconds)
    const lookbackSeconds = strategy.liquidationLookbackHours * 3600;
    const recentLiquidations = this.getRecentLiquidations(
      liquidation.symbol, 
      lookbackSeconds
    );

    console.log(`📈 Found ${recentLiquidations.length} liquidations in last ${strategy.liquidationLookbackHours}h for ${liquidation.symbol}`);

    if (recentLiquidations.length === 0) return;

    // Determine position side (SAME as liquidation side) for counter-trading
    // When longs liquidated → buy the dip (go long), when shorts liquidated → sell the rally (go short)
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
        // Position was created by the concurrent process, check if we should layer
        const shouldLayer = await this.shouldAddLayer(strategy, positionAfterWait, liquidation);
        if (shouldLayer) {
          // NOTE: executeLayer() atomically checks and sets cooldown at the start
          await this.executeLayer(strategy, session, positionAfterWait, liquidation, positionSide);
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
        // We have an open position - check if we should add a layer
        const shouldLayer = await this.shouldAddLayer(strategy, existingPosition, liquidation);
        if (shouldLayer) {
          // NOTE: executeLayer() atomically checks and sets cooldown at the start
          await this.executeLayer(strategy, session, existingPosition, liquidation, positionSide);
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
        return false;
      }
    }
    
    // Calculate percentile threshold: current liquidation must exceed specified percentile
    const currentLiquidationValue = parseFloat(liquidation.value);
    
    if (recentLiquidations.length === 0) return false;
    
    // Get all liquidation values within the lookback window and sort them
    const liquidationValues = recentLiquidations.map(liq => parseFloat(liq.value)).sort((a, b) => a - b);
    
    // Calculate the percentile value: find the value such that X% of liquidations are below it
    // For 51% threshold with 10 liquidations, we want the value at position ceil(0.51 * 10) = 6
    // This means 5 liquidations (50%) are strictly below it
    const percentilePosition = Math.ceil((strategy.percentileThreshold / 100) * liquidationValues.length);
    const percentileIndex = Math.max(0, percentilePosition - 1); // Convert to 0-based index
    const percentileValue = liquidationValues[Math.min(percentileIndex, liquidationValues.length - 1)];
    
    console.log(`📊 Percentile Analysis: Current liquidation $${currentLiquidationValue.toFixed(2)} vs ${strategy.percentileThreshold}% threshold $${percentileValue.toFixed(2)} (${liquidationValues.length} liquidations in ${strategy.liquidationLookbackHours}h window)`);
    
    // Check if we should enter based on percentile
    const shouldEnter = currentLiquidationValue >= percentileValue;
    
    if (shouldEnter) {
      // ATOMICALLY set cooldown IMMEDIATELY when decision is made (before returning)
      // This prevents race condition where two threads both pass the check before either sets cooldown
      this.lastFillTime.set(cooldownKey, Date.now());
      console.log(`🔒 Entry cooldown locked ATOMICALLY for ${liquidation.symbol} ${positionSide} (${this.fillCooldownMs / 1000}s)`);
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

    // Use configurable lookback window from strategy settings (convert hours to seconds)
    const lookbackSeconds = strategy.liquidationLookbackHours * 3600;
    const recentLiquidations = this.getRecentLiquidations(liquidation.symbol, lookbackSeconds);
    
    if (recentLiquidations.length === 0) return false;

    const currentLiquidationValue = parseFloat(liquidation.value);
    const liquidationValues = recentLiquidations.map(liq => parseFloat(liq.value)).sort((a, b) => a - b);
    
    // Calculate percentile using same logic as entry
    const percentilePosition = Math.ceil((strategy.percentileThreshold / 100) * liquidationValues.length);
    const percentileIndex = Math.max(0, percentilePosition - 1);
    const percentileValue = liquidationValues[Math.min(percentileIndex, liquidationValues.length - 1)];

    // Only proceed with layering if liquidation equals or exceeds percentile threshold
    if (currentLiquidationValue < percentileValue) {
      console.log(`📊 Layer blocked: Liquidation $${currentLiquidationValue.toFixed(2)} is below ${strategy.percentileThreshold}% threshold $${percentileValue.toFixed(2)}`);
      return false;
    }

    // Layer is allowed - liquidation equals or exceeds the percentile threshold
    console.log(`📊 Layer approved: Liquidation $${currentLiquidationValue.toFixed(2)} meets/exceeds ${strategy.percentileThreshold}% threshold $${percentileValue.toFixed(2)}`);
    return true;
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
        const errorText = await response.text();
        console.error('❌ Failed to fetch exchange account:', errorText);
        return null;
      }

      const data = await response.json();
      const availableBalance = parseFloat(data.availableBalance || '0');
      console.log(`💰 Exchange available balance: $${availableBalance.toFixed(2)}`);
      return availableBalance;
    } catch (error) {
      console.error('❌ Error fetching exchange balance:', error);
      return null;
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
        console.log(`📊 Using exchange balance for ${session.mode} mode: $${currentBalance.toFixed(2)}`);
      } else {
        console.warn('⚠️ Failed to fetch exchange balance, falling back to session balance');
      }
      
      const marginPercent = parseFloat(strategy.marginAmount);
      const availableCapital = (marginPercent / 100) * currentBalance;
      
      // Calculate position size as percentage of available capital with leverage
      const positionSizePercent = parseFloat(strategy.positionSizePercent);
      const leverage = strategy.leverage;
      const basePositionValue = (positionSizePercent / 100) * availableCapital;
      const positionValue = basePositionValue * leverage;
      const quantity = positionValue / price;

      console.log(`🎯 Entering ${orderSide} position for ${liquidation.symbol} at $${price} (Capital: ${marginPercent}% of $${currentBalance} = $${availableCapital}, Position: ${positionSizePercent}% = $${basePositionValue}, Leverage: ${leverage}x = $${positionValue})`);

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
      const price = parseFloat(liquidation.price);
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
      
      // Calculate available capital based on account usage percentage
      // ALWAYS use actual exchange balance for both paper and live modes
      // This ensures paper trading mirrors live trading exactly
      let currentBalance = parseFloat(session.currentBalance);
      const exchangeBalance = await this.getExchangeAvailableBalance(strategy);
      if (exchangeBalance !== null) {
        currentBalance = exchangeBalance;
        console.log(`📊 Using exchange balance for ${session.mode} mode (layer ${nextLayer}): $${currentBalance.toFixed(2)}`);
      } else {
        console.warn('⚠️ Failed to fetch exchange balance for layer, falling back to session balance');
      }
      
      const marginPercent = parseFloat(strategy.marginAmount);
      const availableCapital = (marginPercent / 100) * currentBalance;
      
      // Calculate position size as percentage of available capital with leverage
      const positionSizePercent = parseFloat(strategy.positionSizePercent);
      const leverage = strategy.leverage;
      const basePositionValue = (positionSizePercent / 100) * availableCapital;
      const positionValue = basePositionValue * leverage;
      const quantity = positionValue / price;

      console.log(`📈 Adding layer ${nextLayer} for ${liquidation.symbol} at $${price} (Position: ${positionSizePercent}% of $${availableCapital} = $${basePositionValue}, Leverage: ${leverage}x = $${positionValue})`);

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
        const orderPrice = strategy.orderType === 'market' ? currentPrice : targetPrice;
        
        if (priceDeviation <= slippageTolerance) {
          console.log(`✅ Price acceptable: $${currentPrice} (deviation: ${(priceDeviation * 100).toFixed(2)}%)`);
          
          // Check if this is live or paper trading
          if (session.mode === 'live') {
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
              
              // Record fill with AGGREGATED exchange data (weighted avg price, total qty, total commission)
              await this.fillLiveOrder(order, aggregated.avgPrice, aggregated.totalQty, aggregated.totalCommission);
            } else {
              console.warn(`⚠️ Could not fetch actual fill data after ${maxRetries} attempts, using order price as fallback`);
              // Fallback to order price if we couldn't fetch actual fill
              await this.fillPaperOrder(order, orderPrice, quantity);
            }
          } else {
            // Paper trading mode - simulate the order locally
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

            if (strategy.orderType === 'market') {
              // Market orders fill immediately at current price
              await this.fillPaperOrder(order, currentPrice, quantity);
              console.log(`✅ Paper market order filled: ${quantity.toFixed(4)} ${symbol} at $${currentPrice}`);
            } else {
              // Limit orders go into pending state for realistic simulation
              this.pendingPaperOrders.set(order.id, {
                order,
                strategy,
                targetPrice,
                startTime: Date.now(),
                maxRetryDuration,
                slippageTolerance,
              });
              console.log(`📋 Paper limit order placed: ${quantity.toFixed(4)} ${symbol} at $${orderPrice} (pending fill)`);
            }
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
        
        const orderParams: Record<string, string | number> = {
          symbol: order.symbol,
          side: order.side.toUpperCase(),
          type: order.orderType.toUpperCase(),
          quantity: roundedQuantity,
        };
        
        // Add positionSide if in dual mode
        if (this.exchangePositionMode === 'dual' && order.positionSide) {
          orderParams.positionSide = order.positionSide.toUpperCase();
        }
        
        // Add price/stopPrice based on order type
        if (order.orderType.toLowerCase() === 'limit') {
          orderParams.price = roundedPrice;
          orderParams.timeInForce = 'GTC';
          orderParams.reduceOnly = 'true';
        } else if (order.orderType.toLowerCase() === 'stop_market') {
          orderParams.stopPrice = roundedPrice;
          orderParams.reduceOnly = 'true';
        }
        
        return orderParams;
      });
      
      const timestamp = Date.now();
      const params: Record<string, string | number> = {
        batchOrders: JSON.stringify(batchOrders),
        timestamp,
        recvWindow: 5000,
      };
      
      // Create query string for signature
      const queryString = Object.entries(params)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
      
      // Generate signature
      const signature = createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');
      
      const signedParams = `${queryString}&signature=${signature}`;
      
      console.log(`🔴 BATCH ORDER: Placing ${orders.length} orders in one API call`);
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
        console.error(`❌ Batch order failed (${response.status}): ${responseText}`);
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
      
      const results = JSON.parse(responseText);
      console.log(`✅ Batch order executed successfully: ${orders.length} orders placed`);
      
      return { success: true, results };
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
        orderParams.reduceOnly = 'true'; // TP orders can only reduce positions
      } else if (orderType.toLowerCase() === 'stop_market') {
        orderParams.stopPrice = roundedPrice; // Trigger price for stop market orders
        orderParams.reduceOnly = 'true'; // SL orders can only reduce positions
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
      
      // Only run cleanup for live trading sessions
      const liveSessions = Array.from(this.activeSessions.values()).filter(s => s.mode === 'live');
      if (liveSessions.length === 0) {
        console.log('⏭️ No active live trading sessions, skipping cleanup');
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

      // Get all active positions for all live sessions
      const positionsMap = new Map<string, Map<string, Position>>();
      for (const session of liveSessions) {
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
      const liveSessions = Array.from(this.activeSessions.values()).filter(s => s.mode === 'live');
      
      if (liveSessions.length === 0) {
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

  // Auto-repair missing TP/SL orders for exchange positions
  async autoRepairMissingTPSL(): Promise<number> {
    try {
      let repairedCount = 0;
      const liveSessions = Array.from(this.activeSessions.values()).filter(s => s.mode === 'live');
      
      if (liveSessions.length === 0) {
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
        const side = exchangePos.side;
        const entryPrice = parseFloat(exchangePos.entryPrice);
        const positionAmt = parseFloat(exchangePos.positionAmt);
        
        if (positionAmt === 0) continue;
        
        const cooldownKey = `${symbol}-${side}`;
        const lastAttempt = this.recoveryAttempts.get(cooldownKey) || 0;
        const now = Date.now();
        
        // 5 minute cooldown between repair attempts
        if (now - lastAttempt < 5 * 60 * 1000) {
          continue;
        }
        
        // Find corresponding database position and strategy
        let dbPosition: Position | undefined;
        let strategy: Strategy | undefined;
        
        for (const session of liveSessions) {
          const positions = await storage.getOpenPositions(session.id);
          dbPosition = positions.find(p => 
            p.symbol === symbol && 
            p.side && p.side.toLowerCase() === side.toLowerCase() && 
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
        
        const stopLossPercent = parseFloat(strategy.stopLossPercent);
        const profitTargetPercent = parseFloat(strategy.profitTargetPercent);
        
        // Calculate TP and SL prices
        const tpPrice = side === 'LONG' 
          ? entryPrice * (1 + profitTargetPercent / 100)
          : entryPrice * (1 - profitTargetPercent / 100);
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
        
        // Get current price
        const currentPrice = this.priceCache.get(symbol) || entryPrice;
        
        // Check if price already exceeded TP
        const tpExceeded = side === 'LONG' 
          ? currentPrice >= tpPrice 
          : currentPrice <= tpPrice;
        
        if (tpExceeded && !hasTPOrder) {
          console.log(`🚨 TP already hit for ${symbol} ${side}, closing immediately with market order`);
          
          // Close position immediately with market order
          const closeResult = await this.placeExitOrder(
            dbPosition,
            'MARKET',
            currentPrice,
            Math.abs(positionAmt),
            'take_profit'
          );
          
          if (closeResult.success) {
            repairedCount++;
            this.recoveryAttempts.set(cooldownKey, now);
          }
          continue;
        }
        
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

  // Fix incorrect stop-loss orders (where stopPrice doesn't match calculated SL)
  private async fixIncorrectStopLossOrders(): Promise<number> {
    try {
      // Only run for live sessions
      const liveSessions = Array.from(this.activeSessions.values()).filter(s => s.mode === 'live');
      if (liveSessions.length === 0) {
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
        const side = exchangePos.side;
        const entryPrice = parseFloat(exchangePos.entryPrice);
        const positionAmt = parseFloat(exchangePos.positionAmt);
        
        if (positionAmt === 0) continue;
        
        // Find corresponding database position and strategy
        let dbPosition: Position | undefined;
        let strategy: Strategy | undefined;
        
        for (const session of liveSessions) {
          const positions = await storage.getOpenPositions(session.id);
          dbPosition = positions.find(p => 
            p.symbol === symbol && 
            p.side && p.side.toLowerCase() === side.toLowerCase() && 
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
    
    // Update cooldown timestamp to prevent rapid-fire entries
    const cooldownKey = `${order.sessionId}-${order.symbol}-${position.side}`;
    this.lastFillTime.set(cooldownKey, Date.now());
    console.log(`⏰ Fill cooldown started for ${position.symbol} ${position.side} (${this.fillCooldownMs / 1000}s)`);
  }

  // Fill a live order using ACTUAL exchange data (price, qty, commission)
  private async fillLiveOrder(order: Order, actualFillPrice: number, actualFillQty: number, actualCommission: number) {
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
    
    // Update cooldown timestamp to prevent rapid-fire entries
    const cooldownKey = `${order.sessionId}-${order.symbol}-${position.side}`;
    this.lastFillTime.set(cooldownKey, Date.now());
    console.log(`⏰ Fill cooldown started for ${position.symbol} ${position.side} (${this.fillCooldownMs / 1000}s)`);
    
    // AUTOMATICALLY place TP/SL orders for live mode entry orders (Layer 1 only)
    if (order.layerNumber === 1) {
      await this.placeTPSLOrdersForPosition(position, order.sessionId);
    }
  }

  // Ensure position exists and return it (create or update as needed)
  // This must be called BEFORE creating fills so we have the position ID
  private async ensurePositionForFill(order: Order, fillPrice: number, fillQuantity: number): Promise<Position> {
    let position = await storage.getPositionBySymbol(order.sessionId, order.symbol);
    
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

      // Create new position
      position = await storage.createPosition({
        sessionId: order.sessionId,
        symbol: order.symbol,
        side: order.side === 'buy' ? 'long' : 'short',
        totalQuantity: fillQuantity.toString(),
        avgEntryPrice: fillPrice.toString(),
        totalCost: actualMargin.toString(), // Actual margin = notional / leverage
        layersFilled: 1,
        maxLayers,
        leverage,
        lastLayerPrice: fillPrice.toString(),
      });
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

    await storage.updatePosition(position.id, {
      totalQuantity: newQuantity.toString(),
      avgEntryPrice: newAvgPrice.toString(), // Weighted average of entry prices
      totalCost: newCost.toString(), // Actual total margin used
      layersFilled: position.layersFilled + 1,
      lastLayerPrice: fillPrice.toString(),
    });
  }

  // Start monitoring positions for exit conditions
  private startExitMonitoring() {
    setInterval(async () => {
      if (!this.isRunning) return;
      
      // Check all open positions for exit conditions
      this.activeSessions.forEach(async (session, strategyId) => {
        const strategy = this.activeStrategies.get(strategyId);
        if (!strategy) return;

        const openPositions = await storage.getOpenPositions(session.id);
        for (const position of openPositions) {
          await this.checkExitCondition(strategy, position);
        }
      });
    }, 1000); // Check every 1 second for real-time updates
  }

  // Start monitoring pending paper orders for limit order simulation
  private startPaperOrderMonitoring() {
    this.orderMonitorInterval = setInterval(async () => {
      if (!this.isRunning) return;
      
      // Check each pending paper order
      const pendingOrders = Array.from(this.pendingPaperOrders.entries());
      for (const [orderId, orderData] of pendingOrders) {
        await this.checkPaperOrderFill(orderId, orderData);
      }
    }, 500); // Check every 500ms for responsive limit order fills
  }

  // Check if a pending paper order should fill or timeout
  private async checkPaperOrderFill(
    orderId: string,
    orderData: {
      order: Order;
      strategy: Strategy;
      targetPrice: number;
      startTime: number;
      maxRetryDuration: number;
      slippageTolerance: number;
    }
  ) {
    try {
      const { order, strategy, targetPrice, startTime, maxRetryDuration, slippageTolerance } = orderData;
      const elapsedTime = Date.now() - startTime;
      
      // Check for timeout
      if (elapsedTime >= maxRetryDuration) {
        console.log(`⏰ Paper order ${order.symbol} timed out after ${maxRetryDuration}ms - cancelling`);
        await storage.updateOrderStatus(order.id, 'cancelled');
        this.pendingPaperOrders.delete(orderId);
        return;
      }
      
      // Fetch current market price
      let currentPrice: number | null = null;
      try {
        const asterApiUrl = `https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${order.symbol}`;
        const priceResponse = await fetch(asterApiUrl);
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          currentPrice = parseFloat(priceData.price);
        }
      } catch (error) {
        // Skip this check if price fetch fails
        return;
      }
      
      if (!currentPrice) return;
      
      const orderPrice = parseFloat(order.price || '0');
      const quantity = parseFloat(order.quantity);
      
      // Check if limit order should fill (market price crossed limit price)
      let shouldFill = false;
      if (order.side === 'buy') {
        // Buy limit fills when market price drops to or below limit price
        shouldFill = currentPrice <= orderPrice;
      } else {
        // Sell limit fills when market price rises to or above limit price
        shouldFill = currentPrice >= orderPrice;
      }
      
      if (shouldFill) {
        // Fill the order at the limit price
        console.log(`✅ Paper limit order filled: ${order.symbol} ${order.side} at $${orderPrice} (market: $${currentPrice})`);
        await this.fillPaperOrder(order, orderPrice, quantity);
        this.pendingPaperOrders.delete(orderId);
        return;
      }
      
      // Check if we should chase the price (update limit if market moved too far)
      const priceDeviation = Math.abs(currentPrice - targetPrice) / targetPrice;
      if (priceDeviation > slippageTolerance) {
        // Update the limit price to chase the market
        const newLimitPrice = currentPrice;
        console.log(`🏃 Chasing price for ${order.symbol}: updating limit from $${orderPrice} to $${newLimitPrice} (deviation: ${(priceDeviation * 100).toFixed(2)}%)`);
        
        await storage.updateOrderStatus(order.id, 'pending', undefined, newLimitPrice.toString());
        
        // Update order in tracking
        orderData.order.price = newLimitPrice.toString();
      }
      
    } catch (error) {
      console.error(`Error checking paper order ${orderId}:`, error);
      // Clean up failed order
      this.pendingPaperOrders.delete(orderId);
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

      // Get session to check if it's paper trading
      const session = this.activeSessions.get(position.sessionId);
      const isPaperTrading = session?.mode === 'paper';
      
      // Calculate exit fee based on order type (SAME FOR BOTH PAPER AND LIVE)
      // Take profit = limit order (0.01% maker fee)
      // Stop loss = stop market order (0.035% taker fee)
      const quantity = parseFloat(position.totalQuantity);
      const exitValue = exitPrice * quantity;
      const exitFee = (exitValue * feePercent) / 100; // Apply fee for BOTH paper and live
      
      // Variables to store actual or calculated fill data
      let actualExitPrice = exitPrice;
      let actualExitQty = quantity;
      let actualExitFee = exitFee;
      
      // For live trading, place the actual exit order on Aster DEX
      if (!isPaperTrading) {
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
        
        if (actualFillsData && actualFillsData.length > 0) {
          // Aggregate multiple fills (handles partial fills correctly)
          const aggregated = aggregateFills(actualFillsData);
          
          actualExitPrice = aggregated.avgPrice;
          actualExitQty = aggregated.totalQty;
          actualExitFee = aggregated.totalCommission;
          
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

      // Close position in database with dollar P&L
      await storage.closePosition(position.id, new Date(), dollarPnl);

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
        const feeSource = isPaperTrading ? 'calculated' : 'from exchange';
        console.log(`💸 Exit fee applied: $${actualExitFee.toFixed(4)} (${actualFeePercent.toFixed(3)}% ${orderType === 'limit' ? 'maker' : 'taker'} fee - $${actualExitValue.toFixed(2)} value - ${feeSource})`);
        console.log(`💰 Balance updated: $${oldBalance.toFixed(2)} → $${newBalance.toFixed(2)} (P&L: $${dollarPnl.toFixed(2)}, Fee: -$${actualExitFee.toFixed(4)}, Net: $${netDollarPnl.toFixed(2)})`);
      } else {
        console.warn(`⚠️ Could not update session stats - session ${position.sessionId} not found in database`);
      }

      console.log(`✅ Position closed: ${position.symbol} - P&L: ${realizedPnlPercent.toFixed(2)}% ($${dollarPnl.toFixed(2)}, Fee: $${actualExitFee.toFixed(4)})`);
    } catch (error) {
      console.error('❌ Error closing position:', error);
    }
  }

  // Automatically place TP/SL orders immediately after position opens (live mode only)
  private async placeTPSLOrdersForPosition(position: Position, sessionId: string) {
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
        console.warn(`⚠️ Could not find strategy for session ${sessionId}, skipping TP/SL placement`);
        return;
      }
      
      // Only place TP/SL for live trading mode
      if (strategy.tradingMode !== 'live') {
        console.log(`📝 Paper mode detected, skipping automatic TP/SL placement for ${position.symbol}`);
        return;
      }
      
      const entryPrice = parseFloat(position.avgEntryPrice);
      const quantity = parseFloat(position.totalQuantity);
      const tpPercent = parseFloat(strategy.profitTargetPercent);
      const slPercent = parseFloat(strategy.stopLossPercent);
      
      // Calculate TP and SL prices
      let tpPrice: number;
      let slPrice: number;
      
      if (position.side === 'long') {
        // Long position: TP above entry, SL below entry
        tpPrice = entryPrice * (1 + tpPercent / 100);
        slPrice = entryPrice * (1 - slPercent / 100);
      } else {
        // Short position: TP below entry, SL above entry
        tpPrice = entryPrice * (1 - tpPercent / 100);
        slPrice = entryPrice * (1 + slPercent / 100);
      }
      
      console.log(`🎯 Placing automatic TP/SL orders for ${position.symbol} ${position.side}:`);
      console.log(`   Entry: $${entryPrice.toFixed(2)} | TP: $${tpPrice.toFixed(2)} (+${tpPercent}%) | SL: $${slPrice.toFixed(2)} (-${slPercent}%)`);
      
      // Determine exit side (opposite of position side)
      const exitSide = position.side === 'long' ? 'sell' : 'buy';
      
      // Place TP and SL orders in a SINGLE batch API call (more efficient!)
      const batchOrders = [
        {
          symbol: position.symbol,
          side: exitSide,
          orderType: 'LIMIT', // TP uses LIMIT order with reduceOnly
          quantity,
          price: tpPrice,
          positionSide: this.exchangePositionMode === 'dual' ? position.side : undefined,
        },
        {
          symbol: position.symbol,
          side: exitSide,
          orderType: 'STOP_MARKET', // SL uses STOP_MARKET with reduceOnly
          quantity,
          price: slPrice,
          positionSide: this.exchangePositionMode === 'dual' ? position.side : undefined,
        }
      ];
      
      const batchResult = await this.executeBatchOrders(batchOrders);
      
      if (batchResult.success) {
        console.log(`✅ TP/SL orders placed automatically for ${position.symbol} (batch: 2 orders in 1 API call)`);
      } else {
        console.error(`❌ Failed to place automatic TP/SL orders: ${batchResult.error}`);
      }
      
    } catch (error) {
      console.error('❌ Error placing automatic TP/SL orders:', error);
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

  // Get strategy performance summary
  async getStrategyPerformance(strategyId: string) {
    const session = this.activeSessions.get(strategyId);
    if (!session) return null;

    const openPositions = await storage.getOpenPositions(session.id);
    const pnlSnapshots = await storage.getPnlSnapshots(session.id, 10);
    const recentFills = await storage.getFillsBySession(session.id);

    return {
      session,
      openPositions,
      pnlSnapshots,
      recentFills: recentFills.slice(0, 10),
    };
  }

  // Reload a strategy when settings are updated
  async reloadStrategy(strategyId: string) {
    try {
      const updatedStrategy = await storage.getStrategy(strategyId);
      if (!updatedStrategy) {
        console.log(`⚠️ Cannot reload strategy ${strategyId}: not found`);
        return;
      }

      // Update the strategy in memory
      this.activeStrategies.set(strategyId, updatedStrategy);
      console.log(`🔄 Reloaded strategy: ${updatedStrategy.name} (${strategyId})`);
      
      // CRITICAL: Also update session mode if trading mode has changed
      // This ensures live/paper trades execute correctly after mode toggle
      const session = this.activeSessions.get(strategyId);
      if (session && session.mode !== updatedStrategy.tradingMode) {
        await storage.updateTradeSession(session.id, {
          mode: updatedStrategy.tradingMode || 'paper',
        });
        session.mode = updatedStrategy.tradingMode || 'paper';
        console.log(`🔄 Updated session mode to: ${session.mode}`);
      }
    } catch (error) {
      console.error(`❌ Error reloading strategy ${strategyId}:`, error);
    }
  }

  // Start periodic cleanup and auto-repair monitoring
  private startCleanupMonitoring() {
    // Run all cleanup tasks every 5 minutes
    this.cleanupInterval = setInterval(async () => {
      if (!this.isRunning) return;
      
      // Prevent overlapping cleanup runs
      if (this.cleanupInProgress) {
        console.log('⏭️ Skipping cleanup - previous run still in progress');
        return;
      }
      
      this.cleanupInProgress = true;
      
      try {
        console.log('🧹 Starting periodic cleanup and auto-repair...');
        
        // 1. Clean up orphaned TP/SL orders (missing parent positions)
        const orphanedCount = await this.cleanupOrphanedTPSL();
        if (orphanedCount > 0) {
          console.log(`  ✓ Removed ${orphanedCount} orphaned TP/SL orders`);
        }
        
        // 2. Clean up stale limit orders (older than 3 minutes)
        const staleCount = await this.cleanupStaleLimitOrders();
        if (staleCount > 0) {
          console.log(`  ✓ Canceled ${staleCount} stale limit orders`);
        }
        
        // 3. Auto-repair missing TP/SL orders for open positions
        const repairedCount = await this.autoRepairMissingTPSL();
        if (repairedCount > 0) {
          console.log(`  ✓ Placed ${repairedCount} missing TP/SL orders`);
        }
        
        // 4. Fix incorrect stop-loss orders (wrong stop price calculations)
        const fixedCount = await this.fixIncorrectStopLossOrders();
        if (fixedCount > 0) {
          console.log(`  ✓ Fixed ${fixedCount} incorrect stop-loss orders`);
        }
        
        // 5. Delete liquidations older than 5 days
        const deletedCount = await storage.deleteOldLiquidations(5);
        if (deletedCount > 0) {
          console.log(`  ✓ Deleted ${deletedCount} liquidations older than 5 days`);
        }
        
        const totalActions = orphanedCount + staleCount + repairedCount + fixedCount + deletedCount;
        if (totalActions === 0) {
          console.log('  ✓ All systems healthy, no cleanup needed');
        } else {
          console.log(`🧹 Cleanup complete: ${totalActions} total actions taken`);
        }
      } catch (error) {
        console.error('❌ Error in cleanup monitoring:', error);
      } finally {
        this.cleanupInProgress = false;
      }
    }, 5 * 60 * 1000); // 5 minutes
    
    console.log('🧹 Safety monitoring started: Orphaned cleanup + Stale orders + Auto-repair + Data retention (5 min intervals)');
  }

  // Remove a pending paper order from tracking
  removePendingOrder(orderId: string) {
    this.pendingPaperOrders.delete(orderId);
  }
}

// Export singleton instance
export const strategyEngine = new StrategyEngine();