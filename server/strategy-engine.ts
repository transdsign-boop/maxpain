import { EventEmitter } from 'events';
import { storage } from './storage';
import { 
  type Liquidation, 
  type Strategy, 
  type TradeSession, 
  type Position, 
  type Order, 
  type Fill 
} from '@shared/schema';

// Fixed liquidation monitoring window - always 60 seconds regardless of strategy settings
const LIQUIDATION_WINDOW_SECONDS = 60;

// Aster DEX taker fee (0.035% per trade) - applied to paper trading only for realistic simulation
const ASTER_TAKER_FEE_PERCENT = 0.035;

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
  private isRunning = false;
  private orderMonitorInterval?: NodeJS.Timeout;

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
    console.log('✅ StrategyEngine stopped');
  }

  // Get current market price for a symbol
  getCurrentPrice(symbol: string): number | undefined {
    return this.priceCache.get(symbol);
  }

  // Load all active strategies from database
  private async loadActiveStrategies() {
    try {
      console.log('📚 Loading active strategies from database...');
      const activeStrategies = await storage.getAllActiveStrategies();
      
      for (const strategy of activeStrategies) {
        await this.registerStrategy(strategy);
      }
      
      console.log(`✅ Loaded ${activeStrategies.length} active strategies`);
    } catch (error) {
      console.error('❌ Error loading active strategies:', error);
    }
  }

  // Register a new strategy to monitor
  async registerStrategy(strategy: Strategy) {
    console.log(`📝 Registering strategy: ${strategy.name} (${strategy.id})`);
    this.activeStrategies.set(strategy.id, strategy);
    
    // Create or get active session for this strategy
    let session = await storage.getActiveTradeSession(strategy.id);
    if (!session) {
      session = await storage.createTradeSession({
        strategyId: strategy.id,
        mode: strategy.tradingMode || 'paper',
        currentBalance: '10000.0', // Default starting balance
      });
    } else {
      // Update session mode if strategy trading mode has changed
      if (session.mode !== strategy.tradingMode) {
        await storage.updateTradeSession(session.id, {
          mode: strategy.tradingMode || 'paper',
        });
        session.mode = strategy.tradingMode || 'paper';
        console.log(`🔄 Updated session mode to: ${session.mode}`);
      }
    }
    
    this.activeSessions.set(strategy.id, session);
    console.log(`✅ Strategy registered with session: ${session.id} (mode: ${session.mode})`);
  }

  // Unregister a strategy
  async unregisterStrategy(strategyId: string) {
    console.log(`📤 Unregistering strategy: ${strategyId}`);
    this.activeStrategies.delete(strategyId);
    
    // Note: We do NOT end the trade session here to preserve open positions
    // The session stays active so positions remain visible when strategy is restarted
    this.activeSessions.delete(strategyId);
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

    // Check all active strategies for this symbol
    this.activeStrategies.forEach(async (strategy, strategyId) => {
      if (strategy.selectedAssets.includes(liquidation.symbol)) {
        await this.evaluateStrategySignal(strategy, liquidation);
      }
    });
  }

  // Evaluate if a liquidation triggers a trading signal for a strategy
  private async evaluateStrategySignal(strategy: Strategy, liquidation: Liquidation) {
    const session = this.activeSessions.get(strategy.id);
    if (!session || !session.isActive) return;

    console.log(`🎯 Evaluating strategy "${strategy.name}" for ${liquidation.symbol}`);

    // Check if liquidation meets threshold criteria (fixed 60-second window)
    const recentLiquidations = this.getRecentLiquidations(
      liquidation.symbol, 
      LIQUIDATION_WINDOW_SECONDS
    );

    console.log(`📈 Found ${recentLiquidations.length} liquidations in last ${LIQUIDATION_WINDOW_SECONDS}s for ${liquidation.symbol}`);

    if (recentLiquidations.length === 0) return;

    // First check if we already have an open position for this symbol
    const existingPosition = await storage.getPositionBySymbol(session.id, liquidation.symbol);
    
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
    
    // Get all liquidation values within the 60-second window and sort them
    const liquidationValues = recentLiquidations.map(liq => parseFloat(liq.value)).sort((a, b) => a - b);
    
    // Calculate the percentile position for the threshold
    const percentileIndex = Math.floor((strategy.percentileThreshold / 100) * liquidationValues.length);
    const percentileValue = liquidationValues[Math.min(percentileIndex, liquidationValues.length - 1)];
    
    console.log(`📊 Percentile Analysis: Current liquidation $${currentLiquidationValue.toFixed(2)} vs ${strategy.percentileThreshold}% threshold $${percentileValue.toFixed(2)} (${liquidationValues.length} liquidations in 60s window)`);
    
    // Only enter if current liquidation exceeds the percentile threshold
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

    // First check percentile threshold - same as entry logic
    const recentLiquidations = this.getRecentLiquidations(liquidation.symbol, LIQUIDATION_WINDOW_SECONDS);
    if (recentLiquidations.length === 0) return false;

    const currentLiquidationValue = parseFloat(liquidation.value);
    const liquidationValues = recentLiquidations.map(liq => parseFloat(liq.value)).sort((a, b) => a - b);
    const percentileIndex = Math.floor((strategy.percentileThreshold / 100) * liquidationValues.length);
    const percentileValue = liquidationValues[Math.min(percentileIndex, liquidationValues.length - 1)];

    // Only proceed with layering if liquidation exceeds percentile threshold
    if (currentLiquidationValue < percentileValue) {
      console.log(`📊 Layer blocked: Liquidation $${currentLiquidationValue.toFixed(2)} below ${strategy.percentileThreshold}% threshold $${percentileValue.toFixed(2)}`);
      return false;
    }

    // Layer is allowed - liquidation exceeds the percentile threshold
    console.log(`📊 Layer approved: Liquidation $${currentLiquidationValue.toFixed(2)} exceeds ${strategy.percentileThreshold}% threshold $${percentileValue.toFixed(2)}`);
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

  // Execute live order on Aster DEX
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
      
      if (!apiKey || !secretKey) {
        console.error('❌ Aster DEX API keys not configured');
        return { success: false, error: 'API keys not configured' };
      }
      
      // Prepare order parameters for Aster DEX API
      const timestamp = Date.now();
      const orderParams = {
        symbol,
        side: side.toUpperCase(),
        type: orderType.toUpperCase(),
        quantity: quantity.toString(),
        price: orderType === 'limit' ? price.toString() : undefined,
        timestamp,
      };
      
      // Create signature (implementation depends on Aster DEX API requirements)
      // This is a placeholder - you'll need to implement the actual signature logic
      const queryString = Object.entries(orderParams)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
      
      console.log(`🔴 LIVE ORDER: Executing ${side} ${quantity} ${symbol} at $${price}`);
      console.log(`📡 Order params: ${queryString}`);
      
      // Execute the live order on Aster DEX
      const response = await fetch('https://fapi.asterdex.com/fapi/v1/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ASTER-APIKEY': apiKey,
        },
        body: JSON.stringify(orderParams),
      });
      
      if (!response.ok) {
        const errorData = await response.text();
        console.error(`❌ Live order failed: ${errorData}`);
        return { success: false, error: errorData };
      }
      
      const result = await response.json();
      console.log(`✅ Live order executed: ${result.orderId || 'success'}`);
      
      return { success: true, orderId: result.orderId };
    } catch (error) {
      console.error('❌ Error executing live order:', error);
      return { success: false, error: String(error) };
    }
  }

  // Fill a paper order and create fill record
  private async fillPaperOrder(order: Order, fillPrice: number, fillQuantity: number) {
    // Update order status
    await storage.updateOrderStatus(order.id, 'filled', new Date());

    // Create fill record with Aster DEX taker fee
    const fillValue = fillPrice * fillQuantity;
    const fee = (fillValue * ASTER_TAKER_FEE_PERCENT) / 100; // 0.035% taker fee
    
    await storage.applyFill({
      orderId: order.id,
      sessionId: order.sessionId,
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

    // Create or update position
    await this.createOrUpdatePosition(order, fillPrice, fillQuantity);
  }

  // Create new position or update existing one after fill
  private async createOrUpdatePosition(order: Order, fillPrice: number, fillQuantity: number) {
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
    }
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

    // Check if profit target is reached
    if (unrealizedPnl >= profitTargetPercent) {
      await this.closePosition(position, currentPrice, unrealizedPnl);
      return;
    }

    // Check if stop loss is triggered (negative P&L exceeds threshold)
    const stopLossPercent = parseFloat(strategy.stopLossPercent);
    if (unrealizedPnl <= -stopLossPercent) {
      console.log(`🛑 Stop loss triggered for ${position.symbol}: ${unrealizedPnl.toFixed(2)}% loss exceeds -${stopLossPercent}% threshold`);
      await this.closePosition(position, currentPrice, unrealizedPnl);
      return;
    }
  }

  // Close a position at current market price
  private async closePosition(position: Position, exitPrice: number, realizedPnlPercent: number) {
    try {
      // Calculate dollar P&L from percentage
      const totalCost = parseFloat(position.totalCost);
      const dollarPnl = (realizedPnlPercent / 100) * totalCost;
      
      console.log(`🎯 Closing position ${position.symbol} at $${exitPrice} with ${realizedPnlPercent.toFixed(2)}% profit ($${dollarPnl.toFixed(2)})`);

      // Get session to check if it's paper trading
      const session = this.activeSessions.get(position.sessionId);
      const isPaperTrading = session?.mode === 'paper';
      
      // Calculate exit fee for paper trading (Aster DEX taker fee: 0.035%)
      const quantity = parseFloat(position.totalQuantity);
      const exitValue = exitPrice * quantity;
      const exitFee = isPaperTrading ? (exitValue * ASTER_TAKER_FEE_PERCENT) / 100 : 0;
      
      // Create exit fill record
      await storage.applyFill({
        orderId: `exit-${position.id}`, // Synthetic order ID for exit
        sessionId: position.sessionId,
        symbol: position.symbol,
        side: position.side === 'long' ? 'sell' : 'buy', // Opposite side to close
        quantity: position.totalQuantity,
        price: exitPrice.toString(),
        value: exitValue.toString(),
        fee: exitFee.toString(),
        layerNumber: 0, // Exit trades don't have layers
      });

      // Close position in database
      await storage.closePosition(position.id, new Date(), realizedPnlPercent);

      // Update session statistics and balance
      if (session) {
        const newTotalTrades = session.totalTrades + 1;
        const oldTotalPnl = parseFloat(session.totalPnl);
        
        // Subtract exit fee from realized P&L for paper trading
        const netDollarPnl = isPaperTrading ? dollarPnl - exitFee : dollarPnl;
        const newTotalPnl = oldTotalPnl + netDollarPnl;
        
        // Update current balance with net realized P&L
        const oldBalance = parseFloat(session.currentBalance);
        const newBalance = oldBalance + netDollarPnl;
        
        await storage.updateTradeSession(session.id, {
          totalTrades: newTotalTrades,
          totalPnl: newTotalPnl.toString(),
          currentBalance: newBalance.toString(),
        });
        
        // Update local session cache
        session.totalTrades = newTotalTrades;
        session.totalPnl = newTotalPnl.toString();
        session.currentBalance = newBalance.toString();
        
        if (isPaperTrading) {
          console.log(`💸 Exit fee applied: $${exitFee.toFixed(4)} (${ASTER_TAKER_FEE_PERCENT}% of $${exitValue.toFixed(2)})`);
          console.log(`💰 Balance updated: $${oldBalance.toFixed(2)} → $${newBalance.toFixed(2)} (P&L: $${dollarPnl.toFixed(2)}, Fee: -$${exitFee.toFixed(4)}, Net: $${netDollarPnl.toFixed(2)})`);
        } else {
          console.log(`💰 Balance updated: $${oldBalance.toFixed(2)} → $${newBalance.toFixed(2)} (${dollarPnl >= 0 ? '+' : ''}$${dollarPnl.toFixed(2)})`);
        }
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
}

// Export singleton instance
export const strategyEngine = new StrategyEngine();