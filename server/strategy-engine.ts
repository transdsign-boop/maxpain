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
  private isRunning = false;

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
    
    console.log(`✅ StrategyEngine started with ${this.activeStrategies.size} active strategies`);
  }

  // Stop the strategy engine
  stop() {
    console.log('🛑 StrategyEngine stopping...');
    this.isRunning = false;
    this.activeStrategies.clear();
    this.activeSessions.clear();
    this.liquidationHistory.clear();
    console.log('✅ StrategyEngine stopped');
  }

  // Load all active strategies from database
  private async loadActiveStrategies() {
    try {
      // For simplicity, we'll load strategies by session ID patterns
      // In a real implementation, you'd have a better way to track active strategies
      console.log('📚 Loading active strategies...');
      // Note: This is a simplified implementation. In practice, you'd track active strategies better.
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
        mode: 'paper',
        currentBalance: '10000.0', // Default starting balance
      });
    }
    
    this.activeSessions.set(strategy.id, session);
    console.log(`✅ Strategy registered with session: ${session.id}`);
  }

  // Unregister a strategy
  async unregisterStrategy(strategyId: string) {
    console.log(`📤 Unregistering strategy: ${strategyId}`);
    this.activeStrategies.delete(strategyId);
    
    const session = this.activeSessions.get(strategyId);
    if (session) {
      await storage.endTradeSession(session.id);
      this.activeSessions.delete(strategyId);
    }
  }

  // Handle incoming liquidation event
  private async handleLiquidation(liquidation: Liquidation) {
    if (!this.isRunning) return;

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

    // Check if liquidation meets threshold criteria (fixed 60-second window)
    const recentLiquidations = this.getRecentLiquidations(
      liquidation.symbol, 
      LIQUIDATION_WINDOW_SECONDS
    );

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

    // Check price spacing for layering
    const currentPrice = parseFloat(liquidation.price);
    const lastLayerPrice = parseFloat(position.lastLayerPrice || position.avgEntryPrice);
    const spacingPercent = parseFloat(strategy.layerSpacingPercent);
    
    // Calculate required price movement for next layer
    const requiredSpacing = lastLayerPrice * (spacingPercent / 100);
    
    if (position.side === 'long') {
      // For long positions, add layers when price drops further
      return currentPrice <= (lastLayerPrice - requiredSpacing);
    } else {
      // For short positions, add layers when price rises further
      return currentPrice >= (lastLayerPrice + requiredSpacing);
    }
  }

  // Execute initial position entry
  private async executeEntry(strategy: Strategy, session: TradeSession, liquidation: Liquidation) {
    try {
      const side = liquidation.side === 'long' ? 'buy' : 'sell'; // Counter-trade
      const orderSide = liquidation.side === 'long' ? 'long' : 'short';
      const price = parseFloat(liquidation.price);
      const positionSizePercent = parseFloat(strategy.positionSizePercent);
      const quantity = (positionSizePercent / 100) * session.currentBalance / price; // Position sizing as % of portfolio

      console.log(`🎯 Entering ${orderSide} position for ${liquidation.symbol} at $${price}`);

      // Place paper order
      const order = await storage.placePaperOrder({
        sessionId: session.id,
        symbol: liquidation.symbol,
        side,
        orderType: 'market',
        quantity: quantity.toString(),
        price: price.toString(),
        triggerLiquidationId: liquidation.id,
        layerNumber: 1,
      });

      // Immediately fill the paper order
      await this.fillPaperOrder(order, price, quantity);

      console.log(`✅ Entry order filled: ${quantity.toFixed(4)} ${liquidation.symbol} at $${price}`);
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
      const positionSizePercent = parseFloat(strategy.positionSizePercent);
      const quantity = (positionSizePercent / 100) * session.currentBalance / price;
      const nextLayer = position.layersFilled + 1;

      console.log(`📈 Adding layer ${nextLayer} for ${liquidation.symbol} at $${price}`);

      // Place layer order
      const order = await storage.placePaperOrder({
        sessionId: session.id,
        symbol: liquidation.symbol,
        side,
        orderType: 'market',
        quantity: quantity.toString(),
        price: price.toString(),
        triggerLiquidationId: liquidation.id,
        layerNumber: nextLayer,
      });

      // Fill the paper order (this already updates the position)
      await this.fillPaperOrder(order, price, quantity);

      console.log(`✅ Layer ${nextLayer} filled for ${liquidation.symbol}`);
    } catch (error) {
      console.error('❌ Error executing layer:', error);
    }
  }

  // Fill a paper order and create fill record
  private async fillPaperOrder(order: Order, fillPrice: number, fillQuantity: number) {
    // Update order status
    await storage.updateOrderStatus(order.id, 'filled', new Date());

    // Create fill record
    const fillValue = fillPrice * fillQuantity;
    await storage.applyFill({
      orderId: order.id,
      sessionId: order.sessionId,
      symbol: order.symbol,
      side: order.side,
      quantity: fillQuantity.toString(),
      price: fillPrice.toString(),
      value: fillValue.toString(),
      fee: '0.0', // No fees for paper trading
      layerNumber: order.layerNumber,
    });

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
    }, 5000); // Check every 5 seconds
  }

  // Check if position should be closed
  private async checkExitCondition(strategy: Strategy, position: Position) {
    const currentPrice = this.priceCache.get(position.symbol);
    if (!currentPrice) return;

    const avgEntryPrice = parseFloat(position.avgEntryPrice);
    const profitTargetPercent = parseFloat(strategy.profitTargetPercent);
    
    let unrealizedPnl = 0;
    if (position.side === 'long') {
      unrealizedPnl = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;
    } else {
      unrealizedPnl = ((avgEntryPrice - currentPrice) / avgEntryPrice) * 100;
    }

    // Update position with latest unrealized PnL
    await storage.updatePosition(position.id, {
      unrealizedPnl: unrealizedPnl.toString(),
    });

    // Check if profit target is reached
    if (unrealizedPnl >= profitTargetPercent) {
      await this.closePosition(position, currentPrice, unrealizedPnl);
    }
  }

  // Close a position at current market price
  private async closePosition(position: Position, exitPrice: number, realizedPnl: number) {
    try {
      console.log(`🎯 Closing position ${position.symbol} at $${exitPrice} with ${realizedPnl.toFixed(2)}% profit`);

      // Close position in database
      await storage.closePosition(position.id, new Date(), realizedPnl);

      // Update session statistics
      const session = this.activeSessions.get(position.sessionId);
      if (session) {
        const newTotalTrades = session.totalTrades + 1;
        const newTotalPnl = parseFloat(session.totalPnl) + realizedPnl;
        
        await storage.updateTradeSession(session.id, {
          totalTrades: newTotalTrades,
          totalPnl: newTotalPnl.toString(),
        });
      }

      console.log(`✅ Position closed: ${position.symbol} - P&L: ${realizedPnl.toFixed(2)}%`);
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