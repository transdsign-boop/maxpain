/**
 * Position Sizing Service
 * Centralizes ATR calculation and DCA level computation
 * Eliminates 10+ instances of duplicated sizing logic across the codebase
 */

import { calculateATRPercent, calculateDCALevels } from '../dca-calculator';
import { getStrategyWithDCA } from '../dca-sql';
import type { Strategy } from '@shared/schema';

export interface PositionSizingParams {
  strategy: Strategy;
  symbol: string;
  entryPrice: number;
  side: 'long' | 'short';
  currentBalance: number;
  apiKey: string;
  secretKey: string;
}

export interface PositionSizingResult {
  atrPercent: number;
  dcaResult: {
    q1: number; // Base layer size
    levels: Array<{
      layerNumber: number;
      price: number;
      quantity: number;
      totalQuantity: number;
      avgEntryPrice: number;
      takeProfitPrice: number;
      stopLossPrice: number;
    }>;
    effectiveGrowthFactor: number;
    totalWeight: number;
    reservedRisk: {
      dollars: number;
      percent: number;
    };
  };
  strategyWithDCA: any; // Strategy with DCA parameters
}

/**
 * Calculate complete position sizing including ATR and DCA levels
 *
 * @param params Position sizing parameters
 * @returns Complete sizing result with ATR, DCA levels, and risk metrics
 * @throws Error if DCA parameters not configured or validation fails
 */
export async function calculatePositionSizing(
  params: PositionSizingParams
): Promise<PositionSizingResult> {
  const {
    strategy,
    symbol,
    entryPrice,
    side,
    currentBalance,
    apiKey,
    secretKey
  } = params;

  // 1. Fetch ATR for volatility-based spacing
  const atrPercent = await calculateATRPercent(
    symbol,
    10, // 10-period ATR
    apiKey,
    secretKey
  );

  console.log(`📊 ATR for ${symbol}: ${atrPercent.toFixed(4)}%`);

  // 2. Get strategy with DCA parameters from database
  const strategyWithDCA = await getStrategyWithDCA(strategy.id);

  if (!strategyWithDCA?.dcaParams) {
    throw new Error(
      `DCA parameters not configured for strategy "${strategy.name}" (ID: ${strategy.id}). ` +
      'Please configure DCA settings in the strategy dialog.'
    );
  }

  // 3. Validate DCA configuration
  const dcaParams = strategyWithDCA.dcaParams;

  if (!dcaParams.numLayers || dcaParams.numLayers < 1) {
    throw new Error('Invalid DCA configuration: numLayers must be >= 1');
  }

  if (!dcaParams.growthFactor || dcaParams.growthFactor <= 0) {
    throw new Error('Invalid DCA configuration: growthFactor must be > 0');
  }

  console.log(`🎯 DCA Config: ${dcaParams.numLayers} layers, growth ${dcaParams.growthFactor}x`);

  // 4. Calculate DCA levels
  const dcaResult = calculateDCALevels(strategyWithDCA, {
    entryPrice,
    side,
    accountBalance: currentBalance,
    atrPercent
  });

  console.log(`💰 Position sizing: q1=${dcaResult.q1.toFixed(8)}, reserved risk=${dcaResult.reservedRisk.percent.toFixed(2)}%`);

  return {
    atrPercent,
    dcaResult,
    strategyWithDCA
  };
}

/**
 * Calculate just the ATR for a symbol (lightweight version)
 * Use when you only need volatility data without full DCA calculation
 */
export async function getSymbolATR(
  symbol: string,
  apiKey: string,
  secretKey: string,
  periods: number = 10
): Promise<number> {
  return calculateATRPercent(symbol, periods, apiKey, secretKey);
}

/**
 * Validate position sizing result against strategy risk limits
 *
 * @param result Position sizing result to validate
 * @param maxPortfolioRisk Maximum allowed portfolio risk percentage
 * @returns true if valid, throws error with details if invalid
 */
export function validatePositionSizing(
  result: PositionSizingResult,
  maxPortfolioRisk: number
): boolean {
  const { dcaResult } = result;

  // Check if reserved risk exceeds maximum
  if (dcaResult.reservedRisk.percent > maxPortfolioRisk) {
    throw new Error(
      `Reserved risk ${dcaResult.reservedRisk.percent.toFixed(2)}% exceeds ` +
      `maximum ${maxPortfolioRisk.toFixed(2)}%. Reduce position size or increase max risk.`
    );
  }

  // Check if q1 (base layer) is valid
  if (!dcaResult.q1 || dcaResult.q1 <= 0) {
    throw new Error('Invalid position sizing: base layer size (q1) must be > 0');
  }

  // Check if levels are valid
  if (!dcaResult.levels || dcaResult.levels.length === 0) {
    throw new Error('Invalid position sizing: no DCA levels generated');
  }

  return true;
}

/**
 * Calculate layer-specific sizing for DCA additions
 * Use when adding layers to existing positions
 */
export async function calculateLayerSizing(
  params: PositionSizingParams,
  existingLayers: number
): Promise<{
  layerQuantity: number;
  layerPrice: number;
  newAvgEntry: number;
}> {
  const result = await calculatePositionSizing(params);

  // Find the next layer after existing ones
  const nextLayerIndex = existingLayers; // 0-indexed
  const nextLayer = result.dcaResult.levels[nextLayerIndex];

  if (!nextLayer) {
    throw new Error(
      `No DCA layer ${existingLayers + 1} configured. ` +
      `Strategy only has ${result.dcaResult.levels.length} layers.`
    );
  }

  return {
    layerQuantity: nextLayer.quantity,
    layerPrice: nextLayer.price,
    newAvgEntry: nextLayer.avgEntryPrice
  };
}
