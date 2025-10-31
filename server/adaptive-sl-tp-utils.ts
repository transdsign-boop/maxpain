/**
 * Adaptive Stop Loss and Take Profit Utilities
 *
 * Centralized functions to calculate SL/TP prices that respect:
 * - Adaptive SL/TP settings (ATR-based with min/max bounds)
 * - Fixed SL/TP percentages (when adaptive is disabled)
 *
 * Usage: Import these functions anywhere you need to calculate SL or TP prices
 */

import type { Strategy } from '@shared/schema';
import { calculateATRPercent } from './dca-calculator';
import { getStrategyWithDCA } from './dca-sql';

/**
 * Calculate the appropriate stop loss price for a position
 * Respects adaptive SL if enabled, otherwise uses fixed percentage
 */
export async function calculateStopLossPrice(
  strategy: Strategy,
  symbol: string,
  entryPrice: number,
  side: 'long' | 'short'
): Promise<{ price: number; percent: number }> {
  try {
    const strategyWithDCA = await getStrategyWithDCA(strategy.id);

    // Check if adaptive SL is enabled
    if (strategyWithDCA?.adaptive_sl_enabled) {
      const atrPercent = await calculateATRPercent(
        symbol,
        10,
        process.env.ASTER_API_KEY,
        process.env.ASTER_SECRET_KEY
      );

      const atrMultiplier = parseFloat(String(strategyWithDCA.sl_atr_multiplier || 3.0));
      const minSlPercent = parseFloat(String(strategyWithDCA.min_sl_percent || 15.0));
      const maxSlPercent = parseFloat(String(strategyWithDCA.max_sl_percent || 20.0));

      // Calculate SL as ATR × multiplier, clamped between min and max
      const rawSlPercent = atrPercent * atrMultiplier;
      const clampedSlPercent = Math.max(minSlPercent, Math.min(maxSlPercent, rawSlPercent));

      const slPrice = side === 'long'
        ? entryPrice * (1 - clampedSlPercent / 100)
        : entryPrice * (1 + clampedSlPercent / 100);

      return { price: slPrice, percent: clampedSlPercent };
    }

    // Fixed SL percentage
    const stopLossPercent = parseFloat(strategy.stopLossPercent);
    const slPrice = side === 'long'
      ? entryPrice * (1 - stopLossPercent / 100)
      : entryPrice * (1 + stopLossPercent / 100);

    return { price: slPrice, percent: stopLossPercent };

  } catch (error) {
    console.error(`Error calculating stop loss for ${symbol}:`, error);
    // Fallback to fixed percentage
    const stopLossPercent = parseFloat(strategy.stopLossPercent);
    const slPrice = side === 'long'
      ? entryPrice * (1 - stopLossPercent / 100)
      : entryPrice * (1 + stopLossPercent / 100);

    return { price: slPrice, percent: stopLossPercent };
  }
}

/**
 * Calculate the appropriate take profit price for a position
 * Respects adaptive TP if enabled, otherwise uses fixed percentage
 */
export async function calculateTakeProfitPrice(
  strategy: Strategy,
  symbol: string,
  entryPrice: number,
  side: 'long' | 'short'
): Promise<{ price: number; percent: number }> {
  try {
    const strategyWithDCA = await getStrategyWithDCA(strategy.id);

    // Check if adaptive TP is enabled
    if (strategyWithDCA?.adaptive_tp_enabled) {
      const atrPercent = await calculateATRPercent(
        symbol,
        10,
        process.env.ASTER_API_KEY,
        process.env.ASTER_SECRET_KEY
      );

      const atrMultiplier = parseFloat(String(strategyWithDCA.tp_atr_multiplier || 2.5));
      const minTpPercent = parseFloat(String(strategyWithDCA.min_tp_percent || 0.5));
      const maxTpPercent = parseFloat(String(strategyWithDCA.max_tp_percent || 3.0));

      // Calculate TP as ATR × multiplier, clamped between min and max
      const rawTpPercent = atrPercent * atrMultiplier;
      const clampedTpPercent = Math.max(minTpPercent, Math.min(maxTpPercent, rawTpPercent));

      const tpPrice = side === 'long'
        ? entryPrice * (1 + clampedTpPercent / 100)
        : entryPrice * (1 - clampedTpPercent / 100);

      return { price: tpPrice, percent: clampedTpPercent };
    }

    // Fixed TP percentage
    const profitTargetPercent = parseFloat(strategy.profitTargetPercent);
    const tpPrice = side === 'long'
      ? entryPrice * (1 + profitTargetPercent / 100)
      : entryPrice * (1 - profitTargetPercent / 100);

    return { price: tpPrice, percent: profitTargetPercent };

  } catch (error) {
    console.error(`Error calculating take profit for ${symbol}:`, error);
    // Fallback to fixed percentage
    const profitTargetPercent = parseFloat(strategy.profitTargetPercent);
    const tpPrice = side === 'long'
      ? entryPrice * (1 + profitTargetPercent / 100)
      : entryPrice * (1 - profitTargetPercent / 100);

    return { price: tpPrice, percent: profitTargetPercent };
  }
}

/**
 * Get the stop loss percentage for a symbol
 * Useful for calculations that only need the percentage, not the price
 */
export async function getStopLossPercent(
  strategy: Strategy,
  symbol: string
): Promise<number> {
  try {
    const strategyWithDCA = await getStrategyWithDCA(strategy.id);

    if (strategyWithDCA?.adaptive_sl_enabled) {
      const atrPercent = await calculateATRPercent(
        symbol,
        10,
        process.env.ASTER_API_KEY,
        process.env.ASTER_SECRET_KEY
      );

      const atrMultiplier = parseFloat(String(strategyWithDCA.sl_atr_multiplier || 3.0));
      const minSlPercent = parseFloat(String(strategyWithDCA.min_sl_percent || 15.0));
      const maxSlPercent = parseFloat(String(strategyWithDCA.max_sl_percent || 20.0));

      const rawSlPercent = atrPercent * atrMultiplier;
      return Math.max(minSlPercent, Math.min(maxSlPercent, rawSlPercent));
    }

    return parseFloat(strategy.stopLossPercent);
  } catch (error) {
    return parseFloat(strategy.stopLossPercent);
  }
}

/**
 * Get the take profit percentage for a symbol
 * Useful for calculations that only need the percentage, not the price
 */
export async function getTakeProfitPercent(
  strategy: Strategy,
  symbol: string
): Promise<number> {
  try {
    const strategyWithDCA = await getStrategyWithDCA(strategy.id);

    if (strategyWithDCA?.adaptive_tp_enabled) {
      const atrPercent = await calculateATRPercent(
        symbol,
        10,
        process.env.ASTER_API_KEY,
        process.env.ASTER_SECRET_KEY
      );

      const atrMultiplier = parseFloat(String(strategyWithDCA.tp_atr_multiplier || 2.5));
      const minTpPercent = parseFloat(String(strategyWithDCA.min_tp_percent || 0.5));
      const maxTpPercent = parseFloat(String(strategyWithDCA.max_tp_percent || 3.0));

      const rawTpPercent = atrPercent * atrMultiplier;
      return Math.max(minTpPercent, Math.min(maxTpPercent, rawTpPercent));
    }

    return parseFloat(strategy.profitTargetPercent);
  } catch (error) {
    return parseFloat(strategy.profitTargetPercent);
  }
}
