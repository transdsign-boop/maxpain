import { storage } from "./storage";
import { type Liquidation } from "@shared/schema";

export interface CascadeAnalysis {
  riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  cascadeProbability: number;
  liquidationVelocity: number;
  volumeAcceleration: number;
  priceImpact: number;
  timeWindow: number;
  recommendations: string[];
}

export interface CascadePattern {
  symbol: string;
  timeframe: number; // minutes
  liquidationCount: number;
  totalVolume: number;
  priceRange: { min: number; max: number };
  averageSize: number;
  dominantSide: 'long' | 'short' | 'balanced';
}

export class CascadeDetector {
  private cascadeThresholds = {
    liquidationCount: {
      low: 3,
      medium: 7,
      high: 15,
      extreme: 25
    },
    velocityPerMinute: {
      low: 2,
      medium: 5,
      high: 10,
      extreme: 20
    },
    volumeThreshold: {
      low: 50000,   // $50K
      medium: 200000, // $200K
      high: 500000,   // $500K
      extreme: 1000000 // $1M
    }
  };

  /**
   * Analyze cascade risk for a specific symbol
   */
  async analyzeCascadeRisk(symbol: string, timeWindowMinutes: number = 10): Promise<CascadeAnalysis> {
    const sinceTimestamp = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
    const recentLiquidations = await storage.getLiquidationsSince(sinceTimestamp, 100);
    
    // Filter liquidations for this symbol
    const symbolLiquidations = recentLiquidations.filter(liq => liq.symbol === symbol);
    
    if (symbolLiquidations.length === 0) {
      return this.createLowRiskAnalysis(symbol, timeWindowMinutes);
    }

    // Calculate metrics
    const liquidationCount = symbolLiquidations.length;
    const totalVolume = symbolLiquidations.reduce((sum, liq) => sum + parseFloat(liq.value), 0);
    const liquidationVelocity = liquidationCount / timeWindowMinutes;
    
    // Calculate price impact and volatility
    const prices = symbolLiquidations.map(liq => parseFloat(liq.price));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceImpact = ((maxPrice - minPrice) / minPrice) * 100;
    
    // Calculate volume acceleration (comparing first half vs second half)
    const midpoint = Math.floor(symbolLiquidations.length / 2);
    const firstHalf = symbolLiquidations.slice(0, midpoint);
    const secondHalf = symbolLiquidations.slice(midpoint);
    
    const firstHalfVolume = firstHalf.reduce((sum, liq) => sum + parseFloat(liq.value), 0);
    const secondHalfVolume = secondHalf.reduce((sum, liq) => sum + parseFloat(liq.value), 0);
    
    let volumeAcceleration = 0;
    if (firstHalfVolume > 0) {
      volumeAcceleration = ((secondHalfVolume - firstHalfVolume) / firstHalfVolume) * 100;
    }

    // Determine risk level
    const riskLevel = this.calculateRiskLevel(liquidationCount, liquidationVelocity, totalVolume, priceImpact);
    
    // Calculate cascade probability
    const cascadeProbability = this.calculateCascadeProbability(
      liquidationCount, 
      liquidationVelocity, 
      volumeAcceleration, 
      priceImpact
    );

    // Generate recommendations
    const recommendations = this.generateRecommendations(riskLevel, cascadeProbability, symbol);

    return {
      riskLevel,
      cascadeProbability,
      liquidationVelocity,
      volumeAcceleration,
      priceImpact,
      timeWindow: timeWindowMinutes,
      recommendations
    };
  }

  /**
   * Detect cascade patterns across multiple symbols
   */
  async detectSystemWideCascades(timeWindowMinutes: number = 15): Promise<CascadePattern[]> {
    const sinceTimestamp = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
    const recentLiquidations = await storage.getLiquidationsSince(sinceTimestamp, 500);
    
    // Group by symbol
    const symbolGroups: { [symbol: string]: Liquidation[] } = {};
    recentLiquidations.forEach(liq => {
      if (!symbolGroups[liq.symbol]) {
        symbolGroups[liq.symbol] = [];
      }
      symbolGroups[liq.symbol].push(liq);
    });

    const patterns: CascadePattern[] = [];

    Object.entries(symbolGroups).forEach(([symbol, liquidations]) => {
      if (liquidations.length >= 3) { // Minimum threshold for pattern analysis
        const totalVolume = liquidations.reduce((sum, liq) => sum + parseFloat(liq.value), 0);
        const prices = liquidations.map(liq => parseFloat(liq.price));
        const averageSize = liquidations.reduce((sum, liq) => sum + parseFloat(liq.size), 0) / liquidations.length;
        
        // Determine dominant side
        const longCount = liquidations.filter(liq => liq.side === 'long').length;
        const shortCount = liquidations.filter(liq => liq.side === 'short').length;
        let dominantSide: 'long' | 'short' | 'balanced';
        
        if (longCount > shortCount * 1.5) {
          dominantSide = 'long';
        } else if (shortCount > longCount * 1.5) {
          dominantSide = 'short';
        } else {
          dominantSide = 'balanced';
        }

        patterns.push({
          symbol,
          timeframe: timeWindowMinutes,
          liquidationCount: liquidations.length,
          totalVolume,
          priceRange: {
            min: Math.min(...prices),
            max: Math.max(...prices)
          },
          averageSize,
          dominantSide
        });
      }
    });

    // Sort by risk (liquidation count * volume)
    return patterns.sort((a, b) => (b.liquidationCount * b.totalVolume) - (a.liquidationCount * a.totalVolume));
  }

  /**
   * Check if we should pause trading due to cascade risk
   */
  async shouldPauseTrading(symbol: string): Promise<{ shouldPause: boolean; reason: string }> {
    const analysis = await this.analyzeCascadeRisk(symbol, 5); // 5-minute window for immediate risk
    
    if (analysis.riskLevel === 'extreme') {
      return {
        shouldPause: true,
        reason: `Extreme cascade risk detected: ${analysis.cascadeProbability.toFixed(1)}% probability, ${analysis.liquidationVelocity.toFixed(1)} liquidations/min`
      };
    }
    
    if (analysis.riskLevel === 'high' && analysis.cascadeProbability > 70) {
      return {
        shouldPause: true,
        reason: `High cascade risk with ${analysis.cascadeProbability.toFixed(1)}% probability`
      };
    }

    return { shouldPause: false, reason: '' };
  }

  /**
   * Advanced cascade prediction using multiple timeframes
   */
  async predictCascade(symbol: string): Promise<{
    shortTerm: CascadeAnalysis; // 5 minutes
    mediumTerm: CascadeAnalysis; // 15 minutes
    longTerm: CascadeAnalysis; // 30 minutes
    overallRisk: 'low' | 'medium' | 'high' | 'extreme';
    confidence: number;
  }> {
    const [shortTerm, mediumTerm, longTerm] = await Promise.all([
      this.analyzeCascadeRisk(symbol, 5),
      this.analyzeCascadeRisk(symbol, 15),
      this.analyzeCascadeRisk(symbol, 30)
    ]);

    // Weight the risk levels (short-term is most important)
    const riskScores = {
      'low': 1,
      'medium': 2,
      'high': 3,
      'extreme': 4
    };

    const weightedScore = (
      riskScores[shortTerm.riskLevel] * 0.5 +
      riskScores[mediumTerm.riskLevel] * 0.3 +
      riskScores[longTerm.riskLevel] * 0.2
    );

    let overallRisk: 'low' | 'medium' | 'high' | 'extreme';
    if (weightedScore >= 3.5) overallRisk = 'extreme';
    else if (weightedScore >= 2.5) overallRisk = 'high';
    else if (weightedScore >= 1.5) overallRisk = 'medium';
    else overallRisk = 'low';

    // Calculate confidence based on data consistency across timeframes
    const cascadeProbabilities = [shortTerm.cascadeProbability, mediumTerm.cascadeProbability, longTerm.cascadeProbability];
    const avgProbability = cascadeProbabilities.reduce((a, b) => a + b, 0) / 3;
    const variance = cascadeProbabilities.reduce((acc, prob) => acc + Math.pow(prob - avgProbability, 2), 0) / 3;
    const confidence = Math.max(0, 100 - Math.sqrt(variance));

    return {
      shortTerm,
      mediumTerm,
      longTerm,
      overallRisk,
      confidence
    };
  }

  private calculateRiskLevel(
    liquidationCount: number, 
    velocity: number, 
    volume: number, 
    priceImpact: number
  ): 'low' | 'medium' | 'high' | 'extreme' {
    const thresholds = this.cascadeThresholds;
    
    let score = 0;
    
    // Liquidation count scoring
    if (liquidationCount >= thresholds.liquidationCount.extreme) score += 4;
    else if (liquidationCount >= thresholds.liquidationCount.high) score += 3;
    else if (liquidationCount >= thresholds.liquidationCount.medium) score += 2;
    else if (liquidationCount >= thresholds.liquidationCount.low) score += 1;
    
    // Velocity scoring
    if (velocity >= thresholds.velocityPerMinute.extreme) score += 4;
    else if (velocity >= thresholds.velocityPerMinute.high) score += 3;
    else if (velocity >= thresholds.velocityPerMinute.medium) score += 2;
    else if (velocity >= thresholds.velocityPerMinute.low) score += 1;
    
    // Volume scoring
    if (volume >= thresholds.volumeThreshold.extreme) score += 4;
    else if (volume >= thresholds.volumeThreshold.high) score += 3;
    else if (volume >= thresholds.volumeThreshold.medium) score += 2;
    else if (volume >= thresholds.volumeThreshold.low) score += 1;
    
    // Price impact scoring
    if (priceImpact > 5) score += 4;
    else if (priceImpact > 3) score += 3;
    else if (priceImpact > 1.5) score += 2;
    else if (priceImpact > 0.5) score += 1;
    
    // Normalize score (max possible is 16)
    const normalizedScore = score / 16;
    
    if (normalizedScore >= 0.75) return 'extreme';
    if (normalizedScore >= 0.5) return 'high';
    if (normalizedScore >= 0.25) return 'medium';
    return 'low';
  }

  private calculateCascadeProbability(
    liquidationCount: number, 
    velocity: number, 
    volumeAcceleration: number, 
    priceImpact: number
  ): number {
    // Base probability from liquidation count
    let probability = Math.min(liquidationCount * 3, 40);
    
    // Velocity multiplier
    probability += velocity * 5;
    
    // Volume acceleration bonus
    if (volumeAcceleration > 50) probability += 20;
    else if (volumeAcceleration > 25) probability += 10;
    else if (volumeAcceleration > 0) probability += 5;
    
    // Price impact bonus
    probability += priceImpact * 2;
    
    return Math.min(probability, 99);
  }

  private generateRecommendations(
    riskLevel: 'low' | 'medium' | 'high' | 'extreme', 
    cascadeProbability: number, 
    symbol: string
  ): string[] {
    const recommendations: string[] = [];
    
    switch (riskLevel) {
      case 'extreme':
        recommendations.push(`HALT all trading in ${symbol}`);
        recommendations.push('Wait for market stabilization');
        recommendations.push('Monitor for at least 30 minutes after last liquidation');
        break;
        
      case 'high':
        recommendations.push(`Reduce position sizes by 75% for ${symbol}`);
        recommendations.push('Widen stop losses significantly');
        recommendations.push('Avoid new positions until volatility decreases');
        break;
        
      case 'medium':
        recommendations.push(`Reduce position sizes by 50% for ${symbol}`);
        recommendations.push('Use tighter risk management');
        recommendations.push('Monitor closely for escalation');
        break;
        
      case 'low':
        recommendations.push('Normal trading conditions');
        recommendations.push('Standard risk management applies');
        break;
    }
    
    if (cascadeProbability > 80) {
      recommendations.push('Very high cascade probability - extreme caution advised');
    }
    
    return recommendations;
  }

  private createLowRiskAnalysis(symbol: string, timeWindow: number): CascadeAnalysis {
    return {
      riskLevel: 'low',
      cascadeProbability: 5,
      liquidationVelocity: 0,
      volumeAcceleration: 0,
      priceImpact: 0,
      timeWindow,
      recommendations: ['Normal trading conditions', 'Standard risk management applies']
    };
  }
}

export const cascadeDetector = new CascadeDetector();