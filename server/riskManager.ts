import { storage } from "./storage";
import { type Position, type TradingStrategy, type Portfolio } from "@shared/schema";

export interface RiskAssessment {
  canTrade: boolean;
  risk: 'low' | 'medium' | 'high' | 'extreme';
  reasons: string[];
  recommendedPositionSize: number;
  maxExposure: number;
  portfolioExposure: number;
}

export interface PositionSizing {
  baseSize: number;
  adjustedSize: number;
  riskAdjustment: number;
  volatilityAdjustment: number;
  portfolioAdjustment: number;
}

export class RiskManager {
  constructor() {}

  /**
   * Comprehensive risk assessment for a new trade
   */
  async assessTradeRisk(
    symbol: string,
    side: 'long' | 'short',
    entryPrice: number,
    portfolioId: string,
    strategy: TradingStrategy
  ): Promise<RiskAssessment> {
    // CRITICAL FIX: Use the actual portfolioId parameter, not hardcoded 'demo-session'
    const portfolio = await storage.getOrCreatePortfolio(portfolioId);
    const openPositions = await storage.getOpenPositions(portfolioId);
    
    // Calculate portfolio exposure - use paper balance for now
    // TODO: Add real balance support when real trading is implemented
    const totalValue = parseFloat(portfolio.paperBalance);
    const currentExposure = this.calculatePortfolioExposure(openPositions);
    const portfolioExposurePercent = (currentExposure / totalValue) * 100;
    
    // Risk factors
    const reasons: string[] = [];
    let risk: 'low' | 'medium' | 'high' | 'extreme' = 'low';
    let canTrade = true;
    
    // Check portfolio exposure
    if (portfolioExposurePercent > 80) {
      risk = 'extreme';
      canTrade = false;
      reasons.push('Portfolio exposure exceeds 80%');
    } else if (portfolioExposurePercent > 60) {
      risk = 'high';
      reasons.push('High portfolio exposure (>60%)');
    } else if (portfolioExposurePercent > 40) {
      risk = 'medium';
      reasons.push('Medium portfolio exposure (>40%)');
    }
    
    // Check symbol concentration
    const symbolPositions = openPositions.filter(p => p.symbol === symbol);
    const symbolExposure = this.calculatePositionExposure(symbolPositions);
    const symbolExposurePercent = (symbolExposure / totalValue) * 100;
    
    if (symbolExposurePercent > 20) {
      risk = 'high';
      reasons.push(`High symbol concentration: ${symbolExposurePercent.toFixed(1)}% in ${symbol}`);
    }
    
    // Check directional bias (same side positions)
    const sameDirectionPositions = symbolPositions.filter(p => p.side === side);
    if (sameDirectionPositions.length >= 2) {
      risk = 'high';
      canTrade = false;
      reasons.push(`Too many ${side} positions in ${symbol}`);
    }
    
    // Calculate volatility risk
    const volatility = await storage.calculateVolatility(symbol, 1);
    if (volatility > parseFloat(strategy.volatilityThreshold)) {
      if (volatility > 20) {
        risk = 'extreme';
        canTrade = false;
        reasons.push(`Extreme volatility: ${volatility.toFixed(1)}%`);
      } else if (volatility > 15) {
        risk = 'high';
        reasons.push(`High volatility: ${volatility.toFixed(1)}%`);
      } else {
        risk = 'medium';
        reasons.push(`Elevated volatility: ${volatility.toFixed(1)}%`);
      }
    }
    
    // Calculate recommended position size
    const baseSize = parseFloat(strategy.maxPositionSize);
    const sizing = this.calculatePositionSize(
      baseSize, 
      risk, 
      volatility, 
      portfolioExposurePercent,
      totalValue
    );
    
    return {
      canTrade,
      risk,
      reasons,
      recommendedPositionSize: sizing.adjustedSize,
      maxExposure: totalValue * 0.8, // 80% max exposure
      portfolioExposure: currentExposure
    };
  }

  /**
   * Advanced position sizing with multiple risk factors
   */
  calculatePositionSize(
    baseSize: number, 
    risk: 'low' | 'medium' | 'high' | 'extreme',
    volatility: number,
    portfolioExposure: number,
    totalValue: number
  ): PositionSizing {
    let riskAdjustment = 1.0;
    let volatilityAdjustment = 1.0;
    let portfolioAdjustment = 1.0;
    
    // Risk level adjustment
    switch (risk) {
      case 'low':
        riskAdjustment = 1.0;
        break;
      case 'medium':
        riskAdjustment = 0.7;
        break;
      case 'high':
        riskAdjustment = 0.4;
        break;
      case 'extreme':
        riskAdjustment = 0.1;
        break;
    }
    
    // Volatility adjustment (reduce size for high volatility)
    if (volatility > 15) {
      volatilityAdjustment = 0.3;
    } else if (volatility > 10) {
      volatilityAdjustment = 0.5;
    } else if (volatility > 5) {
      volatilityAdjustment = 0.7;
    }
    
    // Portfolio exposure adjustment
    if (portfolioExposure > 60) {
      portfolioAdjustment = 0.2;
    } else if (portfolioExposure > 40) {
      portfolioAdjustment = 0.5;
    } else if (portfolioExposure > 20) {
      portfolioAdjustment = 0.8;
    }
    
    // Kelly Criterion inspired sizing (simplified)
    const maxPositionPercent = 0.05; // Max 5% of portfolio per trade
    const maxPositionValue = totalValue * maxPositionPercent;
    const kellySize = Math.min(baseSize, maxPositionValue);
    
    const adjustedSize = kellySize * riskAdjustment * volatilityAdjustment * portfolioAdjustment;
    
    return {
      baseSize,
      adjustedSize: Math.max(adjustedSize, 1), // Minimum position size
      riskAdjustment,
      volatilityAdjustment,
      portfolioAdjustment
    };
  }

  /**
   * Dynamic stop loss calculation based on market conditions
   */
  calculateDynamicStopLoss(
    entryPrice: number,
    side: 'long' | 'short',
    volatility: number,
    baseStopLossPercent: number,
    symbol: string
  ): { stopLossPrice: number; stopLossPercent: number } {
    // ATR-based stop loss adjustment
    let volatilityMultiplier = 1.0;
    
    if (volatility > 15) {
      volatilityMultiplier = 2.0; // Wider stops for high volatility
    } else if (volatility > 10) {
      volatilityMultiplier = 1.5;
    } else if (volatility > 5) {
      volatilityMultiplier = 1.2;
    }
    
    // Time-based adjustment (wider stops for longer timeframes)
    const timeMultiplier = 1.0; // Could be enhanced with time-based logic
    
    const adjustedStopLossPercent = baseStopLossPercent * volatilityMultiplier * timeMultiplier;
    
    let stopLossPrice: number;
    if (side === 'long') {
      stopLossPrice = entryPrice * (1 - adjustedStopLossPercent / 100);
    } else {
      stopLossPrice = entryPrice * (1 + adjustedStopLossPercent / 100);
    }
    
    return {
      stopLossPrice,
      stopLossPercent: adjustedStopLossPercent
    };
  }

  /**
   * Dynamic take profit calculation based on market conditions and RR ratio
   */
  calculateDynamicTakeProfit(
    entryPrice: number,
    stopLossPrice: number,
    side: 'long' | 'short',
    riskRewardRatio: number,
    volatility: number
  ): { takeProfitPrice: number; takeProfitPercent: number } {
    const stopLossDistance = Math.abs(entryPrice - stopLossPrice);
    const takeProfitDistance = stopLossDistance * riskRewardRatio;
    
    // Volatility adjustment for take profit
    let volatilityBonus = 1.0;
    if (volatility > 10) {
      volatilityBonus = 1.3; // Larger targets in volatile markets
    } else if (volatility > 5) {
      volatilityBonus = 1.1;
    }
    
    const adjustedTakeProfitDistance = takeProfitDistance * volatilityBonus;
    
    let takeProfitPrice: number;
    if (side === 'long') {
      takeProfitPrice = entryPrice + adjustedTakeProfitDistance;
    } else {
      takeProfitPrice = entryPrice - adjustedTakeProfitDistance;
    }
    
    const takeProfitPercent = (adjustedTakeProfitDistance / entryPrice) * 100;
    
    return {
      takeProfitPrice,
      takeProfitPercent
    };
  }

  /**
   * Correlation analysis to prevent correlated positions
   */
  async analyzeCorrelationRisk(symbol: string, portfolioId: string): Promise<{
    correlatedPositions: Position[];
    correlationRisk: 'low' | 'medium' | 'high';
  }> {
    const openPositions = await storage.getOpenPositions(portfolioId);
    
    // Simplified correlation analysis
    // In real implementation, this would use actual price correlation data
    const correlatedSymbols = this.getCorrelatedSymbols(symbol);
    const correlatedPositions = openPositions.filter(pos => 
      correlatedSymbols.includes(pos.symbol)
    );
    
    let correlationRisk: 'low' | 'medium' | 'high' = 'low';
    if (correlatedPositions.length >= 3) {
      correlationRisk = 'high';
    } else if (correlatedPositions.length >= 2) {
      correlationRisk = 'medium';
    }
    
    return {
      correlatedPositions,
      correlationRisk
    };
  }

  private calculatePortfolioExposure(positions: Position[]): number {
    return positions.reduce((total, pos) => {
      const positionValue = parseFloat(pos.size) * parseFloat(pos.currentPrice);
      return total + positionValue;
    }, 0);
  }

  private calculatePositionExposure(positions: Position[]): number {
    return positions.reduce((total, pos) => {
      const positionValue = parseFloat(pos.size) * parseFloat(pos.currentPrice);
      return total + positionValue;
    }, 0);
  }

  private getCorrelatedSymbols(symbol: string): string[] {
    // Simplified correlation mapping
    const correlationMap: { [key: string]: string[] } = {
      'BTCUSDT': ['ETHUSDT', 'ADAUSDT', 'DOTUSDT'],
      'ETHUSDT': ['BTCUSDT', 'ADAUSDT', 'LINKUSDT'],
      'ASTERUSDT': ['BTCUSDT', 'ETHUSDT'], // Assuming crypto correlation
    };
    
    return correlationMap[symbol] || [];
  }
}

export const riskManager = new RiskManager();