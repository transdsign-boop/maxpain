import { storage } from "./storage";
import { riskManager } from "./riskManager";
import { cascadeDetector } from "./cascadeDetector";
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

      // Enhanced cascade detection
      if (strategy.cascadeDetectionEnabled) {
        const cascadeRisk = await cascadeDetector.shouldPauseTrading(liquidation.symbol);
        if (cascadeRisk.shouldPause) {
          console.log(`🚨 Cascade risk detected for ${liquidation.symbol}: ${cascadeRisk.reason}`);
          this.setCascadeCooldown(liquidation.symbol);
          continue;
        }

        // Advanced cascade analysis
        const cascadeAnalysis = await cascadeDetector.analyzeCascadeRisk(liquidation.symbol, 10);
        if (cascadeAnalysis.riskLevel === 'high' || cascadeAnalysis.riskLevel === 'extreme') {
          console.log(`📊 High cascade risk: ${cascadeAnalysis.cascadeProbability.toFixed(1)}% probability, ${cascadeAnalysis.liquidationVelocity.toFixed(1)} liq/min`);
          this.setCascadeCooldown(liquidation.symbol);
          continue;
        }
      }

      // Check liquidation threshold percentile
      const liquidationValue = parseFloat(liquidation.value);
      const thresholdPercentile = parseFloat(strategy.liquidationThresholdPercentile);
      
      if (thresholdPercentile > 0) {
        // Get recent liquidation percentiles (last 24 hours)
        const sinceTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentLiquidations = await storage.getLiquidationAnalytics(liquidation.symbol, sinceTimestamp);
        
        if (recentLiquidations.length > 0) {
          // Calculate the specified percentile value
          const values = recentLiquidations.map(liq => parseFloat(liq.value)).sort((a, b) => a - b);
          const index = (thresholdPercentile / 100) * (values.length - 1);
          const lower = Math.floor(index);
          const upper = Math.ceil(index);
          
          let percentileValue: number;
          if (lower === upper || values.length === 1) {
            percentileValue = values[lower];
          } else {
            // Linear interpolation
            const weight = index - lower;
            percentileValue = values[lower] * (1 - weight) + values[upper] * weight;
          }
          
          // Only proceed if liquidation value is above the threshold percentile
          if (liquidationValue < percentileValue) {
            console.log(`📊 Liquidation $${liquidationValue.toFixed(2)} below ${thresholdPercentile}th percentile ($${percentileValue.toFixed(2)}), skipping`);
            continue;
          } else {
            console.log(`✅ Liquidation $${liquidationValue.toFixed(2)} above ${thresholdPercentile}th percentile ($${percentileValue.toFixed(2)}), proceeding`);
          }
        }
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
   * Generate counter-trading signal based on liquidation with proper risk management
   */
  private async generateCounterSignal(
    liquidation: Liquidation, 
    strategy: TradingStrategy, 
    volatility: number
  ): Promise<TradingSignal | null> {
    // Counter-trade: if liquidation was long, we go short (and vice versa)
    const counterSide: 'long' | 'short' = liquidation.side === 'long' ? 'short' : 'long';
    
    const entryPrice = parseFloat(liquidation.price);
    const portfolio = await storage.getOrCreatePortfolio('demo-session'); // TODO: Use dynamic portfolioId
    
    // CRITICAL FIX: Calculate position size in USD, not in units
    const availableBalance = parseFloat(portfolio.paperBalance);
    const maxRiskPerTrade = 0.02; // 2% risk per trade
    const maxPositionValue = availableBalance * maxRiskPerTrade;
    
    // Calculate position size in units based on USD value
    const positionSizeInUnits = maxPositionValue / entryPrice;
    
    // Apply volatility adjustment
    const volatilityAdjustment = Math.max(0.1, 1 - (volatility / 50)); // More conservative
    const adjustedSize = positionSizeInUnits * volatilityAdjustment;
    
    // Use risk manager for dynamic stop loss and take profit
    const dynamicStopLoss = riskManager.calculateDynamicStopLoss(
      entryPrice,
      counterSide,
      volatility,
      parseFloat(strategy.stopLossPercent),
      liquidation.symbol
    );
    
    const dynamicTakeProfit = riskManager.calculateDynamicTakeProfit(
      entryPrice,
      dynamicStopLoss.stopLossPrice,
      counterSide,
      parseFloat(strategy.riskRewardRatio),
      volatility
    );

    const signal: TradingSignal = {
      symbol: liquidation.symbol,
      side: counterSide,
      size: adjustedSize,
      entryPrice,
      stopLossPrice: dynamicStopLoss.stopLossPrice,
      takeProfitPrice: dynamicTakeProfit.takeProfitPrice,
      reason: `Counter-trade liquidation: ${liquidation.side} liquidated at $${liquidation.price} (2% risk)`,
      triggeredByLiquidation: liquidation.id
    };

    const positionValue = signal.size * signal.entryPrice;
    console.log(`📊 Generated signal: ${signal.symbol} ${signal.side} size:${signal.size.toFixed(6)} entry:$${signal.entryPrice} value:$${positionValue.toFixed(2)} SL:$${signal.stopLossPrice.toFixed(2)} TP:$${signal.takeProfitPrice.toFixed(2)}`);
    
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

      // Check for existing positions in same symbol/side
      const existingPositions = await storage.getOpenPositionsBySymbol(portfolio.id, signal.symbol);
      const sameDirectionPositions = existingPositions.filter(p => p.side === signal.side);
      
      // Handle DCA (Dollar Cost Averaging) if enabled
      if (sameDirectionPositions.length > 0) {
        if (strategy.dcaEnabled && sameDirectionPositions.length === 1) {
          // DCA is enabled and we have exactly one existing position - add to it
          console.log(`📈 DCA enabled: Adding to existing ${signal.side} position in ${signal.symbol}`);
          return await this.addToPosition(sameDirectionPositions[0], signal, tradingMode);
        } else {
          // Either DCA is disabled or we already have multiple positions
          console.log(`⚠️ Already have ${sameDirectionPositions.length} open ${signal.side} position(s) in ${signal.symbol}`);
          return null;
        }
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
   * Add to existing position (DCA - Dollar Cost Averaging)
   */
  private async addToPosition(
    existingPosition: Position, 
    signal: TradingSignal, 
    tradingMode: 'paper' | 'real'
  ): Promise<Position | null> {
    try {
      // Calculate new position values
      const currentSize = parseFloat(existingPosition.size);
      const currentEntryPrice = parseFloat(existingPosition.entryPrice);
      const newSize = signal.size;
      const newEntryPrice = signal.entryPrice;

      // Calculate weighted average entry price
      const totalValue = (currentSize * currentEntryPrice) + (newSize * newEntryPrice);
      const totalSize = currentSize + newSize;
      const avgEntryPrice = totalValue / totalSize;

      // Get strategy for recalculating stop loss and take profit
      const strategies = await this.getActiveStrategiesForSymbol(signal.symbol);
      const strategy = strategies[0];

      // Calculate volatility for dynamic stop loss/take profit
      const volatility = await storage.calculateVolatility(signal.symbol, 1);

      // Recalculate stop loss and take profit based on new average entry price
      const dynamicStopLoss = riskManager.calculateDynamicStopLoss(
        avgEntryPrice,
        signal.side,
        volatility,
        parseFloat(strategy.stopLossPercent),
        signal.symbol
      );

      const dynamicTakeProfit = riskManager.calculateDynamicTakeProfit(
        avgEntryPrice,
        dynamicStopLoss.stopLossPrice,
        signal.side,
        parseFloat(strategy.riskRewardRatio),
        volatility
      );

      // Update the position
      const updatedPosition = await storage.updatePosition(existingPosition.id, {
        size: totalSize.toString(),
        entryPrice: avgEntryPrice.toString(),
        stopLossPrice: dynamicStopLoss.stopLossPrice.toString(),
        takeProfitPrice: dynamicTakeProfit.takeProfitPrice.toString(),
        triggeredByLiquidation: signal.triggeredByLiquidation || existingPosition.triggeredByLiquidation
      });

      // Update portfolio balance (subtract the cost of additional position)
      const additionalCost = newSize * newEntryPrice;
      const portfolio = await storage.getOrCreatePortfolio('demo-session'); // TODO: Use dynamic sessionId
      const currentBalance = tradingMode === 'paper' 
        ? parseFloat(portfolio.paperBalance)
        : parseFloat(portfolio.realBalance);
      
      const newBalance = currentBalance - additionalCost;
      if (tradingMode === 'paper') {
        await storage.updatePortfolio(portfolio.id, { paperBalance: newBalance.toString() });
      } else {
        await storage.updatePortfolio(portfolio.id, { realBalance: newBalance.toString() });
      }

      const totalPositionValue = totalSize * avgEntryPrice;
      console.log(`📈 DCA executed: ${signal.symbol} ${signal.side} added ${newSize.toFixed(6)} @ $${newEntryPrice.toFixed(2)}`);
      console.log(`📊 New average: size:${totalSize.toFixed(6)} entry:$${avgEntryPrice.toFixed(4)} value:$${totalPositionValue.toFixed(2)} SL:$${dynamicStopLoss.stopLossPrice.toFixed(2)} TP:$${dynamicTakeProfit.takeProfitPrice.toFixed(2)}`);

      return updatedPosition;
    } catch (error) {
      console.error('❌ Error adding to position (DCA):', error);
      return null;
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