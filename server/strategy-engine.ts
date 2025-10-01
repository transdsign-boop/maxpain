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

export class StrategyEngine extends EventEmitter {
  private activeStrategies: Map<string, Strategy> = new Map();
  private activeSessions: Map<string, TradeSession> = new Map();
  private liquidationHistory: Map<string, Liquidation[]> = new Map(); // symbol -> liquidations
  private priceCache: Map<string, number> = new Map(); // symbol -> latest price
  private pendingPaperOrders: Map<string, {
    order: Order;
    strategy: Strategy;
    targetPrice: number;
    startTime: number;
    maxRetryDuration: number;
    slippageTolerance: number;
  }> = new Map(); // Track pending paper orders for limit order simulation
  private positionCreationLocks: Map<string, Promise<void>> = new Map(); // sessionId-symbol -> lock to prevent duplicate positions
  private isRunning = false;
  private orderMonitorInterval?: NodeJS.Timeout;
  private wsClients: Set<any> = new Set(); // WebSocket clients for broadcasting trade notifications

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

  // Start the strategy engine
  async start() {
    if (this.isRunning) return;
    
    console.log('🚀 StrategyEngine starting...');
    this.isRunning = true;
    
    // Load active strategies and sessions
    await this.loadActiveStrategies();
    
    // Start periodic checks for exit conditions
    this.startExitMonitoring();
    
    // Start monitoring pending paper orders for limit order simulation
    this.startPaperOrderMonitoring();
    
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
    
    this.activeStrategies.clear();
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

    // Determine position side (opposite of liquidation side) for counter-trading
    const positionSide = liquidation.side === "long" ? "short" : "long";

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
          await this.executeLayer(strategy, session, positionAfterWait, liquidation);
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
          await this.executeLayer(strategy, session, existingPosition, liquidation);
        }
      } else {
        // No open position - check if we should enter a new position
        const shouldEnter = await this.shouldEnterPosition(strategy, liquidation, recentLiquidations);
        if (shouldEnter) {
          await this.executeEntry(strategy, session, liquidation);
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
  private async shouldEnterPosition(
    strategy: Strategy, 
    liquidation: Liquidation, 
    recentLiquidations: Liquidation[]
  ): Promise<boolean> {
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
    
    // Only enter if current liquidation equals or exceeds the percentile threshold
    return currentLiquidationValue >= percentileValue;
  }

  // Determine if we should add a layer to existing position
  private async shouldAddLayer(
    strategy: Strategy, 
    position: Position, 
    liquidation: Liquidation
  ): Promise<boolean> {
    // Check if we haven't exceeded max layers
    if (position.layersFilled >= strategy.maxLayers) {
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

  // Execute initial position entry with smart order placement
  private async executeEntry(strategy: Strategy, session: TradeSession, liquidation: Liquidation) {
    try {
      const side = liquidation.side === 'long' ? 'buy' : 'sell'; // Counter-trade
      const orderSide = liquidation.side === 'long' ? 'long' : 'short';
      const price = parseFloat(liquidation.price);
      
      // Calculate available capital based on account usage percentage
      const currentBalance = parseFloat(session.currentBalance);
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
    liquidation: Liquidation
  ) {
    try {
      const side = position.side === 'long' ? 'buy' : 'sell';
      const price = parseFloat(liquidation.price);
      
      // Calculate available capital based on account usage percentage
      const currentBalance = parseFloat(session.currentBalance);
      const marginPercent = parseFloat(strategy.marginAmount);
      const availableCapital = (marginPercent / 100) * currentBalance;
      
      // Calculate position size as percentage of available capital with leverage
      const positionSizePercent = parseFloat(strategy.positionSizePercent);
      const leverage = strategy.leverage;
      const basePositionValue = (positionSizePercent / 100) * availableCapital;
      const positionValue = basePositionValue * leverage;
      const quantity = positionValue / price;
      const nextLayer = position.layersFilled + 1;

      console.log(`📈 Adding layer ${nextLayer} for ${liquidation.symbol} at $${price} (Position: ${positionSizePercent}% of $${availableCapital} = $${basePositionValue}, Leverage: ${leverage}x = $${positionValue})`);

      // Apply order delay for smart placement
      if (strategy.orderDelayMs > 0) {
        console.log(`⏱️ Applying ${strategy.orderDelayMs}ms order delay for layer ${nextLayer}...`);
        await new Promise(resolve => setTimeout(resolve, strategy.orderDelayMs));
      }

      // Place layer order with price chasing
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
      });

      console.log(`✅ Layer ${nextLayer} completed for ${liquidation.symbol}`);
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
  }) {
    const { strategy, session, symbol, side, orderSide, quantity, targetPrice, triggerLiquidationId, layerNumber } = params;
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
            const liveOrderResult = await this.executeLiveOrder({
              symbol,
              side,
              orderType: strategy.orderType,
              quantity,
              price: orderPrice,
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
            
            // Record the fill locally for position tracking
            // Note: In production, you'd sync fills from Aster DEX API
            await this.fillPaperOrder(order, orderPrice, quantity);
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

  // Execute live order on Aster DEX with proper HMAC-SHA256 signature
  private async executeLiveOrder(params: {
    symbol: string;
    side: string; // 'buy' or 'sell'
    orderType: string;
    quantity: number;
    price: number;
  }): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      const { symbol, side, orderType, quantity, price } = params;
      
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
      
      // Prepare order parameters for Aster DEX API (Binance-style)
      const timestamp = Date.now();
      const orderParams: Record<string, string | number> = {
        symbol,
        side: side.toUpperCase(),
        type: orderType.toUpperCase(),
        quantity: quantity.toFixed(8),
        timestamp,
        recvWindow: 5000, // 5 second receive window for clock sync tolerance
      };
      
      // Add price for limit orders, timeInForce for all orders
      if (orderType.toLowerCase() === 'limit') {
        orderParams.price = price.toFixed(8);
        orderParams.timeInForce = 'GTC'; // Good Till Cancel
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
      
      console.log(`🔴 LIVE ORDER: Executing ${side} ${quantity.toFixed(4)} ${symbol} at $${price}`);
      console.log(`📡 Order type: ${orderType.toUpperCase()}`);
      console.log(`🔐 Signed request length: ${signedParams.length} chars`);
      
      // Safety check: Log intent before execution
      console.log(`⚠️ REAL MONEY: This will place a LIVE order on Aster DEX`);
      
      // Execute the live order on Aster DEX
      const response = await fetch('https://fapi.asterdex.com/fapi/v1/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-MBX-APIKEY': apiKey,
        },
        body: signedParams,
      });
      
      const responseText = await response.text();
      
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
  }

  // Ensure position exists and return it (create or update as needed)
  // This must be called BEFORE creating fills so we have the position ID
  private async ensurePositionForFill(order: Order, fillPrice: number, fillQuantity: number): Promise<Position> {
    let position = await storage.getPositionBySymbol(order.sessionId, order.symbol);
    
    if (!position) {
      // Find the strategy to get maxLayers setting
      let maxLayers = 5; // Default fallback
      this.activeStrategies.forEach((strategy) => {
        const session = this.activeSessions.get(strategy.id);
        if (session && session.id === order.sessionId) {
          maxLayers = strategy.maxLayers;
        }
      });

      // Create new position
      position = await storage.createPosition({
        sessionId: order.sessionId,
        symbol: order.symbol,
        side: order.side === 'buy' ? 'long' : 'short',
        totalQuantity: fillQuantity.toString(),
        avgEntryPrice: fillPrice.toString(),
        totalCost: (fillPrice * fillQuantity).toString(),
        layersFilled: 1,
        maxLayers,
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

    const newQuantity = currentQuantity + fillQuantity;
    const newCost = currentCost + (fillPrice * fillQuantity);
    const newAvgPrice = newCost / newQuantity;

    await storage.updatePosition(position.id, {
      totalQuantity: newQuantity.toString(),
      avgEntryPrice: newAvgPrice.toString(),
      totalCost: newCost.toString(),
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
      const totalCost = parseFloat(position.totalCost);
      const dollarPnl = (realizedPnlPercent / 100) * totalCost;
      
      // Determine exit order type and fee
      const orderType = exitType === 'take_profit' ? 'limit' : 'stop_market';
      const feePercent = exitType === 'take_profit' ? ASTER_MAKER_FEE_PERCENT : ASTER_TAKER_FEE_PERCENT;
      const exitReason = exitType === 'take_profit' ? 'take profit' : 'stop loss';
      
      console.log(`🎯 Closing position ${position.symbol} at $${exitPrice} via ${orderType.toUpperCase()} (${exitReason}) with ${realizedPnlPercent.toFixed(2)}% P&L ($${dollarPnl.toFixed(2)})`);

      // Get session to check if it's paper trading
      const session = this.activeSessions.get(position.sessionId);
      const isPaperTrading = session?.mode === 'paper';
      
      // Calculate exit fee based on order type
      // Take profit = limit order (0.01% maker fee)
      // Stop loss = stop market order (0.035% taker fee)
      const quantity = parseFloat(position.totalQuantity);
      const exitValue = exitPrice * quantity;
      const exitFee = isPaperTrading ? (exitValue * feePercent) / 100 : 0;
      
      // For live trading, place the actual exit order on Aster DEX
      if (!isPaperTrading) {
        const exitSide = position.side === 'long' ? 'sell' : 'buy';
        const liveOrderResult = await this.executeLiveOrder({
          symbol: position.symbol,
          side: exitSide,
          orderType,
          quantity,
          price: exitPrice,
        });
        
        if (!liveOrderResult.success) {
          console.error(`❌ Failed to place live exit order: ${liveOrderResult.error}`);
          // Don't close position if live order failed
          return;
        }
        
        console.log(`✅ Live exit order placed: ${orderType.toUpperCase()} ${exitSide} ${quantity.toFixed(4)} ${position.symbol} at $${exitPrice}`);
      }
      
      // Create exit fill record
      await storage.applyFill({
        orderId: `exit-${position.id}`, // Synthetic order ID for exit
        sessionId: position.sessionId,
        positionId: position.id, // Link exit fill to position
        symbol: position.symbol,
        side: position.side === 'long' ? 'sell' : 'buy', // Opposite side to close
        quantity: position.totalQuantity,
        price: exitPrice.toString(),
        value: exitValue.toString(),
        fee: exitFee.toString(),
        layerNumber: 0, // Exit trades don't have layers
      });

      // Broadcast trade notification for exit
      this.broadcastTradeNotification({
        symbol: position.symbol,
        side: position.side as 'long' | 'short',
        tradeType: exitType,
        price: exitPrice,
        quantity,
        value: exitValue
      });

      // Close position in database
      await storage.closePosition(position.id, new Date(), realizedPnlPercent);

      // Always fetch latest session from database (not memory) to update stats
      const latestSession = await storage.getTradeSession(position.sessionId);
      if (latestSession) {
        const newTotalTrades = latestSession.totalTrades + 1;
        const oldTotalPnl = parseFloat(latestSession.totalPnl);
        
        // Subtract exit fee from realized P&L for paper trading
        const netDollarPnl = isPaperTrading ? dollarPnl - exitFee : dollarPnl;
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
        
        if (isPaperTrading) {
          console.log(`💸 Exit fee applied: $${exitFee.toFixed(4)} (${feePercent}% ${orderType === 'limit' ? 'maker' : 'taker'} fee - ${exitValue.toFixed(2)} value)`);
          console.log(`💰 Balance updated: $${oldBalance.toFixed(2)} → $${newBalance.toFixed(2)} (P&L: $${dollarPnl.toFixed(2)}, Fee: -$${exitFee.toFixed(4)}, Net: $${netDollarPnl.toFixed(2)})`);
        } else {
          console.log(`💰 Balance updated: $${oldBalance.toFixed(2)} → $${newBalance.toFixed(2)} (${dollarPnl >= 0 ? '+' : ''}$${dollarPnl.toFixed(2)})`);
        }
      } else {
        console.warn(`⚠️ Could not update session stats - session ${position.sessionId} not found in database`);
      }

      console.log(`✅ Position closed: ${position.symbol} - P&L: ${realizedPnlPercent.toFixed(2)}% ($${dollarPnl.toFixed(2)}${isPaperTrading ? `, Fee: $${exitFee.toFixed(4)}` : ''})`);
    } catch (error) {
      console.error('❌ Error closing position:', error);
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
    } catch (error) {
      console.error(`❌ Error reloading strategy ${strategyId}:`, error);
    }
  }

  // Remove a pending paper order from tracking
  removePendingOrder(orderId: string) {
    this.pendingPaperOrders.delete(orderId);
  }
}

// Export singleton instance
export const strategyEngine = new StrategyEngine();