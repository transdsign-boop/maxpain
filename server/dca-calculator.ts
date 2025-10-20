import type { Strategy } from "@shared/schema";
import crypto from "crypto";

export interface DCALevel {
  level: number;
  price: number;
  quantity: number;
  cumulativeDistance: number; // ck value as percentage
  takeProfitPrice: number; // Individual TP for this layer
  stopLossPrice: number; // Individual SL for this layer
}

export interface DCAConfig {
  entryPrice: number;
  side: 'long' | 'short';
  currentBalance: number;
  leverage: number;
  atrPercent: number; // Current volatility as percentage
  minNotional?: number; // Minimum order value required by exchange (price × quantity)
}

export interface DCAResult {
  levels: DCALevel[];
  q1: number; // Base position size for level 1
  weightedAvgPrice: number; // If all levels fill
  stopLossPrice: number;
  takeProfitPrice: number;
  totalRiskDollars: number;
  maxNotional: number; // Total notional if all levels fill
  effectiveGrowthFactor: number; // Actual growth factor used (may be reduced from configured)
  growthFactorAdjusted: boolean; // True if growth factor was reduced to maintain risk cap
  configuredGrowthFactor: number; // Original configured growth factor
}

/**
 * Calculate ATR (Average True Range) as percentage for a symbol
 * ATR measures market volatility and is used to scale DCA spacing
 */
export async function calculateATRPercent(
  symbol: string, 
  periods: number = 10,
  apiKey?: string,
  secretKey?: string
): Promise<number> {
  // If no API keys, return default volatility
  if (!apiKey || !secretKey) {
    return 1.2; // Default ATR% for development
  }

  try {
    // Fetch recent klines (candlesticks) from Aster DEX
    const timestamp = Date.now();
    const params = `symbol=${symbol}&interval=15m&limit=${periods + 1}&timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(params)
      .digest('hex');

    const response = await fetch(
      `https://fapi.asterdex.com/fapi/v1/klines?${params}&signature=${signature}`,
      {
        headers: { 'X-MBX-APIKEY': apiKey },
      }
    );

    if (!response.ok) {
      console.error(`Failed to fetch klines for ${symbol}, using default ATR`);
      return 1.2;
    }

    const klines = await response.json();
    
    // Calculate True Range for each period
    // TR = max(high - low, |high - prevClose|, |low - prevClose|)
    const trueRanges: number[] = [];
    
    for (let i = 1; i < klines.length; i++) {
      const high = parseFloat(klines[i][2]);
      const low = parseFloat(klines[i][3]);
      const close = parseFloat(klines[i][4]);
      const prevClose = parseFloat(klines[i - 1][4]);
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      
      trueRanges.push(tr);
    }
    
    // Calculate ATR as average of true ranges
    const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
    
    // Convert to percentage of current price
    const currentPrice = parseFloat(klines[klines.length - 1][4]);
    const atrPercent = (atr / currentPrice) * 100;
    
    console.log(`📊 ATR for ${symbol}: ${atrPercent.toFixed(3)}% (${atr.toFixed(6)} / ${currentPrice})`);
    
    return atrPercent;
  } catch (error) {
    console.error(`Error calculating ATR for ${symbol}:`, error);
    return 1.2; // Default fallback
  }
}

export interface StrategyWithDCA extends Strategy {
  dcaStartStepPercent: string;
  dcaSpacingConvexity: string;
  dcaSizeGrowth: string;
  dcaMaxRiskPercent: string;
  dcaVolatilityRef: string;
  dcaExitCushionMultiplier: string;
  // Note: adaptiveTpEnabled, tpAtrMultiplier, etc. are already in base Strategy interface
}

/**
 * Calculate all DCA levels using the mathematical framework
 * 
 * @param strategy - The trading strategy configuration (with DCA fields)
 * @param config - DCA configuration (entry price, side, balance, etc.)
 * @returns Complete DCA calculation with levels, sizes, and risk metrics
 */
export function calculateDCALevels(
  strategy: StrategyWithDCA,
  config: DCAConfig
): DCAResult {
  const { entryPrice, side, currentBalance, leverage, atrPercent } = config;
  
  // Extract DCA parameters from strategy
  const delta1 = parseFloat(strategy.dcaStartStepPercent.toString()); // Δ1: Start Step % (Layer 1 size)
  const p = parseFloat(strategy.dcaSpacingConvexity.toString()); // p: Spacing convexity
  const g = parseFloat(strategy.dcaSizeGrowth.toString()); // g: Size growth ratio
  const Vref = parseFloat(strategy.dcaVolatilityRef.toString()); // Vref: Reference volatility %
  const N = strategy.maxLayers; // Number of layers
  const stopLossPercent = parseFloat(strategy.stopLossPercent.toString());
  
  console.log(`\n📐 Calculating DCA levels for ${side.toUpperCase()} at $${entryPrice}`);
  console.log(`   Parameters: Δ1=${delta1}% (Layer 1 size), p=${p}, g=${g}, N=${N}`);
  console.log(`   Volatility: ATR=${atrPercent.toFixed(2)}%, Vref=${Vref}%`);
  
  // Step 1: Calculate volatility-scaled, widening level distances
  // ck = Δ1 · k^p · max(1, V / Vref)
  const volatilityMultiplier = Math.max(1, atrPercent / Vref);
  const levels: Array<{ level: number; ck: number }> = [];
  
  for (let k = 1; k <= N; k++) {
    const ck = delta1 * Math.pow(k, p) * volatilityMultiplier;
    levels.push({ level: k, ck });
  }
  
  console.log(`   Cumulative distances (ck):`, levels.map(l => `L${l.level}=${l.ck.toFixed(2)}%`).join(', '));
  
  // Step 2: Calculate target price at each level
  // For long: Pk = P0 · (1 - ck/100)
  // For short: Pk = P0 · (1 + ck/100)
  const priceMultiplier = side === 'long' ? -1 : 1;
  const levelPrices = levels.map(({ level, ck }) => ({
    level,
    ck,
    price: entryPrice * (1 + priceMultiplier * ck / 100),
  }));
  
  console.log(`   Level prices:`, levelPrices.map(l => `L${l.level}=$${l.price.toFixed(4)}`).join(', '));
  
  // Step 3: Calculate geometric size weights
  // wk = g^(k-1)
  const weights = levels.map(({ level }) => Math.pow(g, level - 1));
  let totalWeight = weights.reduce((sum, w) => sum + w, 0);
  
  console.log(`   Size weights:`, weights.map((w, i) => `L${i+1}=${w.toFixed(2)}`).join(', '));
  console.log(`   Total weight: ${totalWeight.toFixed(2)}`);
  
  // Step 4: Calculate weighted average entry price if all levels fill
  // Pavg = Σ[wk · Pk] / Σ[wk]
  let weightedSum = 0;
  for (let i = 0; i < levelPrices.length; i++) {
    weightedSum += weights[i] * levelPrices[i].price;
  }
  let avgEntryPrice = weightedSum / totalWeight;
  
  console.log(`   Weighted avg entry: $${avgEntryPrice.toFixed(4)}`);
  
  // Step 5: Calculate stop loss price using adaptive SL if enabled
  // For long: Ps = P0 · (1 - S/100)
  // For short: Ps = P0 · (1 + S/100)
  let effectiveSlPercent = stopLossPercent; // Default to fixed SL
  
  if (strategy.adaptiveSlEnabled) {
    // Adaptive SL: ATR × multiplier, clamped to min/max
    const slAtrMultiplier = parseFloat(strategy.slAtrMultiplier?.toString() || '2.0');
    const minSlPercent = parseFloat(strategy.minSlPercent?.toString() || '1.0');
    const maxSlPercent = parseFloat(strategy.maxSlPercent?.toString() || '15.0');
    
    const rawSlPercent = atrPercent * slAtrMultiplier;
    effectiveSlPercent = Math.max(minSlPercent, Math.min(maxSlPercent, rawSlPercent));
    
    console.log(`   🛡️ Adaptive SL: ATR=${atrPercent.toFixed(2)}% × ${slAtrMultiplier} = ${rawSlPercent.toFixed(2)}% → clamped to ${effectiveSlPercent.toFixed(2)}%`);
  }
  
  const stopPrice = entryPrice * (1 + priceMultiplier * effectiveSlPercent / 100);
  
  console.log(`   Stop loss: $${stopPrice.toFixed(4)} (${effectiveSlPercent.toFixed(2)}%)`);
  
  // Step 6: Calculate q1 (base position size) from Start Step %
  // Layer 1 size = (Balance × Margin% × StartStep%) × Leverage / EntryPrice
  // This ensures consistent position sizing based on Start Step %, not max risk
  
  const marginPercent = parseFloat(strategy.marginAmount.toString());
  const marginToUse = (currentBalance * marginPercent / 100) * (delta1 / 100); // Start Step % of margin
  const notionalValue = marginToUse * leverage; // Apply leverage for notional
  let q1 = notionalValue / entryPrice; // Convert to quantity
  
  console.log(`   💵 Layer 1 sizing: margin=$${marginToUse.toFixed(2)} (${delta1}% of ${marginPercent}% margin), leveraged=$${notionalValue.toFixed(2)}, q1=${q1.toFixed(6)} units`);
  
  // Calculate risk metrics (for reporting, not for sizing)
  const lossPerUnit = Math.abs(avgEntryPrice - stopPrice);
  const totalPositionRisk = q1 * totalWeight * lossPerUnit; // Actual risk dollars for this position
  const riskPercent = (totalPositionRisk / currentBalance) * 100; // Risk as % of account
  
  console.log(`   📊 Position risk: $${totalPositionRisk.toFixed(2)} (${riskPercent.toFixed(2)}% of account)`);
  
  // CRITICAL: Ensure Layer 1 meets exchange minimum notional
  // If q1 needs to be scaled up, we must reduce growth factor to maintain risk cap
  const MIN_NOTIONAL = config.minNotional ?? 5.0; // Fallback should never be used
  const layer1Notional = q1 * entryPrice;
  
  console.log(`   🔍 MIN_NOTIONAL check: received=${config.minNotional}, using=${MIN_NOTIONAL}, layer1Notional=${layer1Notional.toFixed(2)}`);
  
  let effectiveG = g; // Start with configured growth factor
  let growthFactorAdjusted = false;
  
  if (layer1Notional < MIN_NOTIONAL) {
    const oldQ1 = q1;
    q1 = MIN_NOTIONAL / entryPrice; // Scale up to meet minimum
    
    // Now solve for new growth factor that maintains the same total risk
    // Original: totalRisk = q1_old * totalWeight_old * lossPerUnit = maxRiskDollars
    // New: totalRisk = q1_new * totalWeight_new * lossPerUnit = maxRiskDollars
    // Therefore: totalWeight_new = (q1_old * totalWeight_old) / q1_new
    
    const targetTotalWeight = (oldQ1 * totalWeight) / q1;
    
    // Solve for g: Σ[g^(k-1)] = targetTotalWeight for k=1 to N
    // This is geometric series: sum = (1 - g^N) / (1 - g) for g≠1, or N for g=1
    // We'll use binary search to find the right g
    
    let gLow = 1.0;
    let gHigh = g; // Start from configured value
    let newG = 1.0;
    
    for (let iter = 0; iter < 50; iter++) {
      const gMid = (gLow + gHigh) / 2;
      let sumWeights = 0;
      for (let k = 1; k <= N; k++) {
        sumWeights += Math.pow(gMid, k - 1);
      }
      
      if (Math.abs(sumWeights - targetTotalWeight) < 0.001) {
        newG = gMid;
        break;
      }
      
      if (sumWeights < targetTotalWeight) {
        gLow = gMid;
      } else {
        gHigh = gMid;
      }
      newG = gMid;
    }
    
    effectiveG = newG;
    growthFactorAdjusted = true;
    
    console.log(`   ⚠️ Layer 1 notional $${layer1Notional.toFixed(2)} < $${MIN_NOTIONAL} minimum (exchange requirement)`);
    console.log(`   📈 Adjusted q1: ${oldQ1.toFixed(6)} → ${q1.toFixed(6)} units to meet minimum`);
    console.log(`   📉 Reduced growth factor: ${g.toFixed(3)}x → ${effectiveG.toFixed(3)}x to maintain position safety`);
    console.log(`   ✅ Total weight adjusted: ${totalWeight.toFixed(2)} → ${targetTotalWeight.toFixed(2)}`);
    
    // Recalculate weights and total weight with new growth factor
    weights.length = 0; // Clear array
    let newTotalWeight = 0;
    for (let k = 1; k <= N; k++) {
      const weight = Math.pow(effectiveG, k - 1);
      weights.push(weight);
      newTotalWeight += weight;
    }
    
    console.log(`   🔄 Updated weights:`, weights.map((w, i) => `L${i+1}=${w.toFixed(2)}`).join(', '));
    
    // Recalculate weighted average entry price with new weights
    let newWeightedSum = 0;
    for (let i = 0; i < levelPrices.length; i++) {
      newWeightedSum += weights[i] * levelPrices[i].price;
    }
    const newAvgEntryPrice = newWeightedSum / newTotalWeight;
    
    console.log(`   🔄 Recalculated weighted avg entry: $${newAvgEntryPrice.toFixed(4)} (was $${avgEntryPrice.toFixed(4)})`);
    
    // CRITICAL: Assign recalculated values back to main variables for downstream calculations
    totalWeight = newTotalWeight;
    avgEntryPrice = newAvgEntryPrice;
    
    // Recalculate risk metrics with new values
    const newLossPerUnit = Math.abs(avgEntryPrice - stopPrice);
    const newTotalRisk = q1 * totalWeight * newLossPerUnit;
    const newRiskPercent = (newTotalRisk / currentBalance) * 100;
    
    console.log(`   🔄 Recalculated position risk: $${newTotalRisk.toFixed(2)} (${newRiskPercent.toFixed(2)}% of account)`);
  }
  
  // Step 7: Calculate position sizes for each level with individual TP/SL
  // qk = q1 · g^(k-1)
  // Each layer gets its own TP/SL based on ITS entry price for progressive profit-taking
  
  const dcaLevels: DCALevel[] = levelPrices.map(({ level, ck, price }, i) => {
    // Calculate adaptive TP for this layer
    let layerTpPrice: number;
    
    if (strategy.adaptiveTpEnabled) {
      // Adaptive TP: ATR × multiplier, clamped to min/max
      const tpAtrMultiplier = parseFloat(strategy.tpAtrMultiplier?.toString() || '1.5');
      const minTpPercent = parseFloat(strategy.minTpPercent?.toString() || '0.5');
      const maxTpPercent = parseFloat(strategy.maxTpPercent?.toString() || '5.0');
      
      const rawTpPercent = atrPercent * tpAtrMultiplier;
      const clampedTpPercent = Math.max(minTpPercent, Math.min(maxTpPercent, rawTpPercent));
      
      layerTpPrice = side === 'long'
        ? price * (1 + clampedTpPercent / 100)
        : price * (1 - clampedTpPercent / 100);
      
      if (level === 1) {
        console.log(`   🎯 Adaptive Layer TP: ATR=${atrPercent.toFixed(2)}% × ${tpAtrMultiplier} = ${rawTpPercent.toFixed(2)}% → clamped to ${clampedTpPercent.toFixed(2)}%`);
      }
    } else {
      // Fallback: Use exitCushion multiplier (legacy behavior)
      const exitCushion = parseFloat(strategy.dcaExitCushionMultiplier.toString());
      const layerTpDistance = exitCushion * (atrPercent / 100) * price;
      layerTpPrice = side === 'long' 
        ? price + layerTpDistance
        : price - layerTpDistance;
    }
    
    // Calculate adaptive SL for this layer
    let layerSlPrice: number;
    
    if (strategy.adaptiveSlEnabled) {
      // Adaptive SL: ATR × multiplier, clamped to min/max
      const slAtrMultiplier = parseFloat(strategy.slAtrMultiplier?.toString() || '2.0');
      const minSlPercent = parseFloat(strategy.minSlPercent?.toString() || '1.0');
      const maxSlPercent = parseFloat(strategy.maxSlPercent?.toString() || '5.0');
      
      const rawSlPercent = atrPercent * slAtrMultiplier;
      const clampedSlPercent = Math.max(minSlPercent, Math.min(maxSlPercent, rawSlPercent));
      
      layerSlPrice = side === 'long'
        ? price * (1 - clampedSlPercent / 100)
        : price * (1 + clampedSlPercent / 100);
      
      if (level === 1) {
        console.log(`   🛡️ Adaptive Layer SL: ATR=${atrPercent.toFixed(2)}% × ${slAtrMultiplier} = ${rawSlPercent.toFixed(2)}% → clamped to ${clampedSlPercent.toFixed(2)}%`);
      }
    } else {
      // Fallback: Use fixed stopLossPercent
      layerSlPrice = side === 'long'
        ? price * (1 - stopLossPercent / 100)
        : price * (1 + stopLossPercent / 100);
    }
    
    return {
      level,
      price,
      quantity: q1 * weights[i],
      cumulativeDistance: ck,
      takeProfitPrice: layerTpPrice,
      stopLossPrice: layerSlPrice,
    };
  });
  
  // Calculate total notional value if all levels fill
  const totalQuantity = dcaLevels.reduce((sum, l) => sum + l.quantity, 0);
  const totalNotional = totalQuantity * avgEntryPrice * leverage;
  
  console.log(`   Total quantity if all fill: ${totalQuantity.toFixed(6)} units`);
  console.log(`   Total notional: $${totalNotional.toFixed(2)} (${leverage}x leverage)`);
  
  // Step 8: Calculate reference take profit price (weighted average TP for reference only)
  // This is now calculated using adaptive TP if enabled
  let takeProfitPrice: number;
  
  if (strategy.adaptiveTpEnabled) {
    const tpAtrMultiplier = parseFloat(strategy.tpAtrMultiplier?.toString() || '1.5');
    const minTpPercent = parseFloat(strategy.minTpPercent?.toString() || '0.5');
    const maxTpPercent = parseFloat(strategy.maxTpPercent?.toString() || '5.0');
    
    const rawTpPercent = atrPercent * tpAtrMultiplier;
    const clampedTpPercent = Math.max(minTpPercent, Math.min(maxTpPercent, rawTpPercent));
    
    takeProfitPrice = side === 'long'
      ? avgEntryPrice * (1 + clampedTpPercent / 100)
      : avgEntryPrice * (1 - clampedTpPercent / 100);
    
    const tpDistance = Math.abs(takeProfitPrice - avgEntryPrice);
    console.log(`   Take profit: $${takeProfitPrice.toFixed(4)} (adaptive ${clampedTpPercent.toFixed(2)}%)`);
    console.log(`   TP distance: $${tpDistance.toFixed(4)} (${(tpDistance/avgEntryPrice*100).toFixed(2)}%)\n`);
  } else {
    // Fallback: Use exitCushion multiplier
    const exitCushion = parseFloat(strategy.dcaExitCushionMultiplier.toString());
    const tpDistance = exitCushion * (atrPercent / 100) * avgEntryPrice;
    takeProfitPrice = side === 'long' 
      ? avgEntryPrice + tpDistance
      : avgEntryPrice - tpDistance;
    
    console.log(`   Take profit: $${takeProfitPrice.toFixed(4)} (${exitCushion}x ATR cushion)`);
    console.log(`   TP distance: $${tpDistance.toFixed(4)} (${(tpDistance/avgEntryPrice*100).toFixed(2)}%)\n`);
  }
  
  // Calculate final position risk for reporting
  const finalLossPerUnit = Math.abs(avgEntryPrice - stopPrice);
  const finalTotalRisk = q1 * totalWeight * finalLossPerUnit;
  
  return {
    levels: dcaLevels,
    q1,
    weightedAvgPrice: avgEntryPrice,
    stopLossPrice: stopPrice,
    takeProfitPrice,
    totalRiskDollars: finalTotalRisk, // Actual position risk, not max risk budget
    maxNotional: totalNotional,
    effectiveGrowthFactor: effectiveG,
    growthFactorAdjusted,
    configuredGrowthFactor: g,
  };
}

/**
 * Calculate the next layer for an existing position
 * Uses stored DCA schedule if available, otherwise recalculates
 * 
 * @param strategy - The trading strategy
 * @param currentBalance - Current account balance
 * @param leverage - Position leverage
 * @param symbol - Trading symbol
 * @param side - Position side (long/short)
 * @param currentLayer - Current layer number (layers PLACED, not filled)
 * @param initialEntryPrice - Original entry price (P0)
 * @param storedQ1 - q1 from initial calculation (for fallback)
 * @param dcaSchedule - Stored DCA schedule from position (prevents recalculation)
 * @param apiKey - Aster DEX API key (optional for ATR calculation)
 * @param secretKey - Aster DEX secret key (optional for ATR calculation)
 * @param maxRiskOverride - Optional override for max risk %
 * @returns Next layer price and quantity, or null if no more layers
 */
export async function calculateNextLayer(
  strategy: Strategy,
  currentBalance: number,
  leverage: number,
  symbol: string,
  side: 'long' | 'short',
  currentLayer: number,
  initialEntryPrice: number,
  storedQ1: number | null,
  dcaSchedule: { levels: any[]; effectiveGrowthFactor: number; q1: number } | null,
  apiKey?: string,
  secretKey?: string,
  maxRiskOverride?: number
): Promise<{ price: number; quantity: number; level: number; takeProfitPrice: number; stopLossPrice: number } | null> {
  // Check if we've reached max layers
  if (currentLayer >= strategy.maxLayers) {
    console.log(`⚠️  Max layers reached (${strategy.maxLayers}), no more layers`);
    return null;
  }
  
  const nextLayer = currentLayer + 1;
  
  // PRIORITY 1: Use stored DCA schedule if available (no recalculation needed)
  if (dcaSchedule && dcaSchedule.levels && dcaSchedule.levels.length > 0) {
    const nextLevelIndex = nextLayer - 1; // Levels are 0-indexed
    const nextLevel = dcaSchedule.levels[nextLevelIndex];
    
    if (nextLevel) {
      console.log(`✅ Using stored DCA schedule for Layer ${nextLayer}`);
      console.log(`   Level ${nextLayer}: price=$${nextLevel.price.toFixed(4)}, qty=${nextLevel.quantity.toFixed(6)}, TP=$${nextLevel.takeProfitPrice.toFixed(4)}, SL=$${nextLevel.stopLossPrice.toFixed(4)}`);
      
      return {
        price: nextLevel.price,
        quantity: nextLevel.quantity,
        level: nextLayer,
        takeProfitPrice: nextLevel.takeProfitPrice,
        stopLossPrice: nextLevel.stopLossPrice,
      };
    } else {
      console.warn(`⚠️ Layer ${nextLayer} not found in stored schedule (has ${dcaSchedule.levels.length} levels)`);
    }
  } else {
    console.warn(`⚠️ No DCA schedule stored, will recalculate (may cause sizing inconsistency)`);
  }
  
  // Calculate current ATR for volatility scaling (needed for recalculation fallback)
  const atrPercent = await calculateATRPercent(symbol, 10, apiKey, secretKey);
  
  // Fetch DCA parameters from SQL wrapper (bypasses Drizzle cache)
  const { getStrategyWithDCA } = await import('./dca-sql');
  const strategyWithDCA = await getStrategyWithDCA(strategy.id);
  
  if (!strategyWithDCA) {
    console.error(`⚠️  Strategy ${strategy.id} not found or missing DCA parameters`);
    return null;
  }
  
  // Build StrategyWithDCA object by merging strategy data with DCA params
  const fullStrategy: StrategyWithDCA = {
    ...strategy,
    dcaStartStepPercent: String(strategyWithDCA.dca_start_step_percent),
    dcaSpacingConvexity: String(strategyWithDCA.dca_spacing_convexity),
    dcaSizeGrowth: String(strategyWithDCA.dca_size_growth),
    dcaMaxRiskPercent: String(strategyWithDCA.dca_max_risk_percent),
    dcaVolatilityRef: String(strategyWithDCA.dca_volatility_ref),
    dcaExitCushionMultiplier: String(strategyWithDCA.dca_exit_cushion_multiplier),
    adaptiveTpEnabled: Boolean(strategyWithDCA.adaptive_tp_enabled),
    tpAtrMultiplier: String(strategyWithDCA.tp_atr_multiplier ?? '1.5'),
    minTpPercent: String(strategyWithDCA.min_tp_percent ?? '0.5'),
    maxTpPercent: String(strategyWithDCA.max_tp_percent ?? '5.0'),
    adaptiveSlEnabled: Boolean(strategyWithDCA.adaptive_sl_enabled),
    slAtrMultiplier: String(strategyWithDCA.sl_atr_multiplier ?? '2.0'),
    minSlPercent: String(strategyWithDCA.min_sl_percent ?? '1.0'),
    maxSlPercent: String(strategyWithDCA.max_sl_percent ?? '5.0'),
  };
  
  // If we have stored q1, use it directly for exponential sizing (avoids recalculation bug)
  // Otherwise fall back to recalculating (for backwards compatibility with old positions)
  if (storedQ1 && storedQ1 > 0) {
    console.log(`✅ Using stored q1=${storedQ1.toFixed(6)} for consistent exponential sizing`);
    
    // Calculate spacing for this layer
    const g = parseFloat(fullStrategy.dcaSizeGrowth);
    const delta1 = parseFloat(fullStrategy.dcaStartStepPercent);
    const p = parseFloat(fullStrategy.dcaSpacingConvexity);
    const Vref = parseFloat(fullStrategy.dcaVolatilityRef);
    const exitCushion = parseFloat(fullStrategy.dcaExitCushionMultiplier);
    const stopLossPercent = parseFloat(strategy.stopLossPercent);
    
    const volatilityMultiplier = Math.max(1, atrPercent / Vref);
    const ck = delta1 * Math.pow(nextLayer, p) * volatilityMultiplier;
    
    // Calculate price distance from initial entry
    const priceDistance = (ck / 100) * initialEntryPrice;
    const nextPrice = side === 'long' 
      ? initialEntryPrice - priceDistance
      : initialEntryPrice + priceDistance;
    
    console.log(`🔍 DCA PRICE CALC: side=${side}, P0=$${initialEntryPrice.toFixed(6)}, distance=$${priceDistance.toFixed(6)}, nextPrice=$${nextPrice.toFixed(6)} (${side === 'long' ? 'LOWER' : 'HIGHER'})`);
    
    // Calculate quantity using exponential growth: qk = q1 * g^(k-1)
    const nextQuantity = storedQ1 * Math.pow(g, nextLayer - 1);
    
    // Calculate adaptive TP for this layer
    let layerTpPrice: number;
    
    if (fullStrategy.adaptiveTpEnabled) {
      const tpAtrMultiplier = parseFloat(fullStrategy.tpAtrMultiplier?.toString() || '1.5');
      const minTpPercent = parseFloat(fullStrategy.minTpPercent?.toString() || '0.5');
      const maxTpPercent = parseFloat(fullStrategy.maxTpPercent?.toString() || '5.0');
      
      const rawTpPercent = atrPercent * tpAtrMultiplier;
      const clampedTpPercent = Math.max(minTpPercent, Math.min(maxTpPercent, rawTpPercent));
      
      layerTpPrice = side === 'long'
        ? nextPrice * (1 + clampedTpPercent / 100)
        : nextPrice * (1 - clampedTpPercent / 100);
    } else {
      // Fallback: Use exitCushion multiplier
      const layerTpDistance = exitCushion * (atrPercent / 100) * nextPrice;
      layerTpPrice = side === 'long' 
        ? nextPrice + layerTpDistance
        : nextPrice - layerTpDistance;
    }
    
    // Calculate adaptive SL for this layer
    let layerSlPrice: number;
    
    if (fullStrategy.adaptiveSlEnabled) {
      const slAtrMultiplier = parseFloat(fullStrategy.slAtrMultiplier?.toString() || '2.0');
      const minSlPercent = parseFloat(fullStrategy.minSlPercent?.toString() || '1.0');
      const maxSlPercent = parseFloat(fullStrategy.maxSlPercent?.toString() || '5.0');
      
      const rawSlPercent = atrPercent * slAtrMultiplier;
      const clampedSlPercent = Math.max(minSlPercent, Math.min(maxSlPercent, rawSlPercent));
      
      layerSlPrice = side === 'long'
        ? nextPrice * (1 - clampedSlPercent / 100)
        : nextPrice * (1 + clampedSlPercent / 100);
    } else {
      // Fallback: Use fixed stopLossPercent
      layerSlPrice = side === 'long'
        ? nextPrice * (1 - stopLossPercent / 100)
        : nextPrice * (1 + stopLossPercent / 100);
    }
    
    console.log(`   Layer ${nextLayer}: price=$${nextPrice.toFixed(4)}, qty=${nextQuantity.toFixed(6)} (q1 × ${g}^${nextLayer-1}), TP=$${layerTpPrice.toFixed(4)}, SL=$${layerSlPrice.toFixed(4)}`);
    
    return {
      price: nextPrice,
      quantity: nextQuantity,
      level: nextLayer,
      takeProfitPrice: layerTpPrice,
      stopLossPrice: layerSlPrice,
    };
  }
  
  // Fallback: Recalculate all levels (for old positions without stored q1)
  console.warn(`⚠️ No stored q1 found, recalculating (may cause inconsistent sizing)`);
  const dcaResult = calculateDCALevels(fullStrategy, {
    entryPrice: initialEntryPrice,
    side,
    currentBalance,
    leverage,
    atrPercent,
  });
  
  // Get the next level's price, quantity, and TP/SL
  const nextLevel = dcaResult.levels[nextLayer - 1];
  if (!nextLevel) {
    console.log(`⚠️  Level ${nextLayer} not found in DCA calculation`);
    return null;
  }
  
  return {
    price: nextLevel.price,
    quantity: nextLevel.quantity,
    level: nextLayer,
    takeProfitPrice: nextLevel.takeProfitPrice,
    stopLossPrice: nextLevel.stopLossPrice,
  };
}

/**
 * Recalculate reserved risk for all open positions in a session
 * Used when max layers or other DCA parameters change
 */
export async function recalculateReservedRiskForSession(
  sessionId: string,
  strategy: Strategy,
  currentBalance: number,
  apiKey: string,
  secretKey: string,
  getSymbolMinNotional?: (symbol: string) => number | undefined
): Promise<void> {
  const { storage } = await import('./storage');
  
  console.log(`♻️ Recalculating reserved risk for all open positions in session ${sessionId}...`);
  
  const openPositions = await storage.getOpenPositions(sessionId);
  console.log(`📊 Found ${openPositions.length} open positions to update`);
  
  for (const position of openPositions) {
    try {
      // Calculate current ATR for the symbol
      const atrPercent = await calculateATRPercent(
        position.symbol,
        parseFloat(strategy.atrPeriod),
        apiKey,
        secretKey
      );
      
      // Get symbol-specific minNotional (fallback to 5.0 if not available)
      const minNotional = getSymbolMinNotional?.(position.symbol) ?? 5.0;
      
      // Calculate full DCA potential with current strategy settings
      const dcaResult = calculateDCALevels(strategy, {
        entryPrice: parseFloat(position.avgEntryPrice),
        side: position.side as 'long' | 'short',
        currentBalance,
        leverage: parseFloat(strategy.leverage),
        atrPercent,
        minNotional,
      });
      
      const reservedRiskDollars = dcaResult.totalRiskDollars;
      const reservedRiskPercent = (reservedRiskDollars / currentBalance) * 100;
      
      console.log(`   ✅ ${position.symbol} ${position.side}: Reserved risk $${reservedRiskDollars.toFixed(2)} (${reservedRiskPercent.toFixed(1)}%)`);
      
      // Update position with new reserved risk values
      await storage.updatePosition(position.id, {
        reservedRiskDollars: reservedRiskDollars.toString(),
        reservedRiskPercent: reservedRiskPercent.toString(),
      });
    } catch (error) {
      console.error(`❌ Failed to recalculate reserved risk for position ${position.id}:`, error);
    }
  }
  
  console.log(`✅ Reserved risk recalculation complete for session ${sessionId}`);
}
