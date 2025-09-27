import { storage } from "./storage";
import { type Liquidation, type TradingStrategy, type Position, type Portfolio } from "@shared/schema";

export interface TradingSignal {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  reason: string;
  triggeredByLiquidation?: string;
}

export interface RiskParameters {
  maxPositionSize: number;
  riskRewardRatio: number;
  volatilityThreshold: number;
  stopLossPercent: number;
  takeProfitPercent: number;
}

export class TradingEngine {
  private cascadeCooldowns: Map<string, number> = new Map();

  constructor() {
    // Initialize trading engine
  }

  /**
   * Main method to process new liquidation and generate trading signals
   */
  async processLiquidation(liquidation: Liquidation): Promise<TradingSignal[]> {
    console.log(`🔍 Processing liquidation: ${liquidation.symbol} ${liquidation.side} $${liquidation.value}`);
    
    const signals: TradingSignal[] = [];
    
    // Get all active strategies that include this symbol
    const strategies = await this.getActiveStrategiesForSymbol(liquidation.symbol);
    
    for (const strategy of strategies) {
      // Check if in cascade cooldown
      if (this.isInCascadeCooldown(liquidation.symbol, strategy.cascadeCooldownMinutes)) {
        console.log(`⏰ Symbol ${liquidation.symbol} in cascade cooldown, skipping strategy ${strategy.name}`);
        continue;
      }

      // Calculate volatility
      const volatility = await storage.calculateVolatility(liquidation.symbol, 1);
      
      // Check if volatility is above threshold
      if (volatility > parseFloat(strategy.volatilityThreshold)) {
        console.log(`⚠️ High volatility detected (${volatility.toFixed(2)}%), potential cascade risk`);
        
        if (strategy.cascadeDetectionEnabled) {
          // Set cascade cooldown
          this.setCascadeCooldown(liquidation.symbol);
          continue;
        }
      }

      // Generate counter-trading signal
      const signal = await this.generateCounterSignal(liquidation, strategy, volatility);
      if (signal) {
        signals.push(signal);
      }
    }

    return signals;
  }

  /**
   * Generate counter-trading signal based on liquidation
   */
  private async generateCounterSignal(
    liquidation: Liquidation, 
    strategy: TradingStrategy, 
    volatility: number
  ): Promise<TradingSignal | null> {
    // Counter-trade: if liquidation was long, we go short (and vice versa)
    const counterSide: 'long' | 'short' = liquidation.side === 'long' ? 'short' : 'long';
    
    const entryPrice = parseFloat(liquidation.price);
    const maxPositionSize = parseFloat(strategy.maxPositionSize);
    const riskReward = parseFloat(strategy.riskRewardRatio);
    
    // Adjust position size based on volatility
    const volatilityAdjustment = Math.max(0.1, 1 - (volatility / 100));
    const adjustedSize = maxPositionSize * volatilityAdjustment;
    
    // Calculate stop loss and take profit with volatility adjustment
    const baseStopLoss = parseFloat(strategy.stopLossPercent);
    const baseTakeProfit = parseFloat(strategy.takeProfitPercent);
    
    // Increase stop loss and take profit based on volatility
    const volatilityMultiplier = 1 + (volatility / 100);
    const adjustedStopLoss = baseStopLoss * volatilityMultiplier;
    const adjustedTakeProfit = baseTakeProfit * volatilityMultiplier;
    
    // Ensure take profit meets risk-reward ratio
    const minTakeProfit = adjustedStopLoss * riskReward;
    const finalTakeProfit = Math.max(adjustedTakeProfit, minTakeProfit);
    
    // Calculate stop loss and take profit prices
    let stopLossPrice: number;
    let takeProfitPrice: number;
    
    if (counterSide === 'long') {
      stopLossPrice = entryPrice * (1 - adjustedStopLoss / 100);
      takeProfitPrice = entryPrice * (1 + finalTakeProfit / 100);
    } else {
      stopLossPrice = entryPrice * (1 + adjustedStopLoss / 100);
      takeProfitPrice = entryPrice * (1 - finalTakeProfit / 100);
    }

    const signal: TradingSignal = {
      symbol: liquidation.symbol,
      side: counterSide,
      size: adjustedSize,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      reason: `Counter-trade liquidation: ${liquidation.side} liquidated at $${liquidation.price}`,
      triggeredByLiquidation: liquidation.id
    };

    console.log(`📊 Generated signal: ${signal.symbol} ${signal.side} size:${signal.size} entry:$${signal.entryPrice} SL:$${signal.stopLossPrice.toFixed(2)} TP:$${signal.takeProfitPrice.toFixed(2)}`);
    
    return signal;
  }

  /**
   * Execute trading signal (paper or real)
   */
  async executeSignal(signal: TradingSignal, sessionId: string, tradingMode: 'paper' | 'real'): Promise<Position | null> {
    try {
      // Get portfolio
      const portfolio = await storage.getOrCreatePortfolio(sessionId);
      
      // Get strategy (use first active strategy for the symbol as default)
      const strategies = await this.getActiveStrategiesForSymbol(signal.symbol);
      if (strategies.length === 0) {
        throw new Error('No active strategy found for symbol');
      }
      const strategy = strategies[0];

      // Check if we have sufficient balance
      const availableBalance = tradingMode === 'paper' 
        ? parseFloat(portfolio.paperBalance)
        : parseFloat(portfolio.realBalance);
      
      const requiredBalance = signal.size * signal.entryPrice;
      if (availableBalance < requiredBalance) {
        console.log(`💰 Insufficient balance: required $${requiredBalance}, available $${availableBalance}`);
        return null;
      }

      // Check for existing positions in same symbol/side to avoid over-exposure
      const existingPositions = await storage.getOpenPositionsBySymbol(portfolio.id, signal.symbol);
      const sameDirectionPositions = existingPositions.filter(p => p.side === signal.side);
      
      if (sameDirectionPositions.length > 0) {
        console.log(`⚠️ Already have ${sameDirectionPositions.length} open ${signal.side} position(s) in ${signal.symbol}`);
        return null;
      }

      // Calculate volatility at entry
      const volatilityAtEntry = await storage.calculateVolatility(signal.symbol, 1);

      // Create position
      const position = await storage.createPosition({
        strategyId: strategy.id,
        portfolioId: portfolio.id,
        symbol: signal.symbol,
        side: signal.side,
        size: signal.size.toString(),
        entryPrice: signal.entryPrice.toString(),
        currentPrice: signal.entryPrice.toString(),
        stopLossPrice: signal.stopLossPrice.toString(),
        takeProfitPrice: signal.takeProfitPrice.toString(),
        tradingMode,
        triggeredByLiquidation: signal.triggeredByLiquidation,
        volatilityAtEntry: volatilityAtEntry.toString()
      });

      // Update portfolio balance
      const newBalance = availableBalance - requiredBalance;
      if (tradingMode === 'paper') {
        await storage.updatePortfolio(portfolio.id, { paperBalance: newBalance.toString() });
      } else {
        await storage.updatePortfolio(portfolio.id, { realBalance: newBalance.toString() });
      }

      console.log(`✅ Position opened: ${position.symbol} ${position.side} size:${position.size} @ $${position.entryPrice}`);
      
      return position;
    } catch (error) {
      console.error('❌ Error executing signal:', error);
      return null;
    }
  }

  /**
   * Monitor open positions and check for stop loss/take profit triggers
   */
  async monitorPositions(sessionId: string): Promise<void> {
    const portfolio = await storage.getOrCreatePortfolio(sessionId);
    const openPositions = await storage.getOpenPositions(portfolio.id);

    for (const position of openPositions) {
      // Get current market price (simplified - in real implementation would fetch from exchange)
      const currentPrice = parseFloat(position.currentPrice);
      const entryPrice = parseFloat(position.entryPrice);
      const stopLossPrice = parseFloat(position.stopLossPrice || '0');
      const takeProfitPrice = parseFloat(position.takeProfitPrice || '0');

      let shouldClose = false;
      let exitReason = '';

      // Check stop loss
      if (position.side === 'long' && currentPrice <= stopLossPrice) {
        shouldClose = true;
        exitReason = 'stop_loss';
      } else if (position.side === 'short' && currentPrice >= stopLossPrice) {
        shouldClose = true;
        exitReason = 'stop_loss';
      }

      // Check take profit
      if (position.side === 'long' && currentPrice >= takeProfitPrice) {
        shouldClose = true;
        exitReason = 'take_profit';
      } else if (position.side === 'short' && currentPrice <= takeProfitPrice) {
        shouldClose = true;
        exitReason = 'take_profit';
      }

      if (shouldClose) {
        await this.closePosition(position.id, currentPrice, exitReason);
      }
    }
  }

  /**
   * Close a position
   */
  async closePosition(positionId: string, exitPrice: number, exitReason: string): Promise<void> {
    try {
      const trade = await storage.closePosition(positionId, exitPrice.toString(), exitReason);
      console.log(`🔒 Position closed: ${trade.symbol} ${trade.side} PnL: $${trade.realizedPnl} (${exitReason})`);
    } catch (error) {
      console.error('❌ Error closing position:', error);
    }
  }

  /**
   * Calculate cascade risk based on recent liquidation patterns
   */
  async calculateCascadeRisk(symbol: string): Promise<'low' | 'medium' | 'high'> {
    // Get liquidations from last 10 minutes
    const recentLiquidations = await storage.getLiquidationsSince(
      new Date(Date.now() - 10 * 60 * 1000),
      50
    );

    const symbolLiquidations = recentLiquidations.filter(l => l.symbol === symbol);
    
    if (symbolLiquidations.length < 3) return 'low';
    if (symbolLiquidations.length < 7) return 'medium';
    return 'high';
  }

  private async getActiveStrategiesForSymbol(symbol: string): Promise<TradingStrategy[]> {
    // This would need sessionId in real implementation - simplified for now
    // For demo, we'll get all active strategies that include this symbol
    const allStrategies = await storage.getActiveTradingStrategies('demo-session');
    return allStrategies.filter(strategy => 
      strategy.symbols.length === 0 || strategy.symbols.includes(symbol)
    );
  }

  private isInCascadeCooldown(symbol: string, cooldownMinutes: number): boolean {
    const lastCooldown = this.cascadeCooldowns.get(symbol);
    if (!lastCooldown) return false;
    
    const cooldownEnd = lastCooldown + (cooldownMinutes * 60 * 1000);
    return Date.now() < cooldownEnd;
  }

  private setCascadeCooldown(symbol: string): void {
    this.cascadeCooldowns.set(symbol, Date.now());
  }
}

export const tradingEngine = new TradingEngine();