import type { Strategy } from "@shared/schema";
import crypto from "crypto";

export interface DCALevel {
  level: number;
  price: number;
  quantity: number;
  cumulativeDistance: number; // ck value as percentage
}

export interface DCAConfig {
  entryPrice: number;
  side: 'long' | 'short';
  currentBalance: number;
  leverage: number;
  atrPercent: number; // Current volatility as percentage
}

export interface DCAResult {
  levels: DCALevel[];
  q1: number; // Base position size for level 1
  weightedAvgPrice: number; // If all levels fill
  stopLossPrice: number;
  takeProfitPrice: number;
  totalRiskDollars: number;
  maxNotional: number; // Total notional if all levels fill
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

/**
 * Calculate all DCA levels using the mathematical framework
 * 
 * @param strategy - The trading strategy configuration
 * @param config - DCA configuration (entry price, side, balance, etc.)
 * @returns Complete DCA calculation with levels, sizes, and risk metrics
 */
export function calculateDCALevels(
  strategy: Strategy,
  config: DCAConfig
): DCAResult {
  const { entryPrice, side, currentBalance, leverage, atrPercent } = config;
  
  // Extract DCA parameters from strategy
  const delta1 = parseFloat(strategy.dcaStartStepPercent.toString()); // Δ1: Starting step %
  const p = parseFloat(strategy.dcaSpacingConvexity.toString()); // p: Spacing convexity
  const g = parseFloat(strategy.dcaSizeGrowth.toString()); // g: Size growth ratio
  const Rmax = parseFloat(strategy.dcaMaxRiskPercent.toString()); // Rmax: Max risk %
  const Vref = parseFloat(strategy.dcaVolatilityRef.toString()); // Vref: Reference volatility %
  const N = strategy.maxLayers; // Number of layers
  const stopLossPercent = parseFloat(strategy.stopLossPercent.toString());
  
  console.log(`\n📐 Calculating DCA levels for ${side.toUpperCase()} at $${entryPrice}`);
  console.log(`   Parameters: Δ1=${delta1}%, p=${p}, g=${g}, Rmax=${Rmax}%, N=${N}`);
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
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  
  console.log(`   Size weights:`, weights.map((w, i) => `L${i+1}=${w.toFixed(2)}`).join(', '));
  console.log(`   Total weight: ${totalWeight.toFixed(2)}`);
  
  // Step 4: Calculate weighted average entry price if all levels fill
  // Pavg = Σ[wk · Pk] / Σ[wk]
  let weightedSum = 0;
  for (let i = 0; i < levelPrices.length; i++) {
    weightedSum += weights[i] * levelPrices[i].price;
  }
  const avgEntryPrice = weightedSum / totalWeight;
  
  console.log(`   Weighted avg entry: $${avgEntryPrice.toFixed(4)}`);
  
  // Step 5: Calculate stop loss price
  // For long: Ps = P0 · (1 - S/100)
  // For short: Ps = P0 · (1 + S/100)
  const stopPrice = entryPrice * (1 + priceMultiplier * stopLossPercent / 100);
  
  console.log(`   Stop loss: $${stopPrice.toFixed(4)} (${stopLossPercent}%)`);
  
  // Step 6: Solve for q1 (base position size) from max risk
  // L ≈ Σ[qk] · |Pavg - Ps|
  // q1 = (Rmax · Equity) / (|Pavg - Ps| · Σ[wk])
  
  // Calculate available capital for DCA
  const marginPercent = parseFloat(strategy.marginAmount.toString());
  const availableCapital = (marginPercent / 100) * currentBalance;
  const maxRiskDollars = (Rmax / 100) * currentBalance; // Risk on entire account, not just available margin
  
  // Dollar loss per unit size at stop
  const lossPerUnit = Math.abs(avgEntryPrice - stopPrice);
  
  // Solve for q1 in base currency (not notional)
  // We need to account for leverage: notional = baseSize * price * leverage
  // Loss = totalQuantity * |avgPrice - stopPrice|
  // totalQuantity = Σ[qk] = q1 * Σ[wk]
  const q1 = maxRiskDollars / (lossPerUnit * totalWeight);
  
  console.log(`   Available capital: $${availableCapital.toFixed(2)}`);
  console.log(`   Max risk: $${maxRiskDollars.toFixed(2)} (${Rmax}% of account)`);
  console.log(`   Loss per unit at stop: $${lossPerUnit.toFixed(4)}`);
  console.log(`   Solved q1: ${q1.toFixed(6)} units`);
  
  // Step 7: Calculate position sizes for each level
  // qk = q1 · g^(k-1)
  const dcaLevels: DCALevel[] = levelPrices.map(({ level, ck, price }, i) => ({
    level,
    price,
    quantity: q1 * weights[i],
    cumulativeDistance: ck,
  }));
  
  // Calculate total notional value if all levels fill
  const totalQuantity = dcaLevels.reduce((sum, l) => sum + l.quantity, 0);
  const totalNotional = totalQuantity * avgEntryPrice * leverage;
  
  console.log(`   Total quantity if all fill: ${totalQuantity.toFixed(6)} units`);
  console.log(`   Total notional: $${totalNotional.toFixed(2)} (${leverage}x leverage)`);
  
  // Step 8: Calculate take profit price
  // TP = avgEntryPrice + (cushion * ATR% * avgEntryPrice)
  const exitCushion = parseFloat(strategy.dcaExitCushionMultiplier.toString());
  const tpDistance = exitCushion * (atrPercent / 100) * avgEntryPrice;
  const takeProfitPrice = side === 'long' 
    ? avgEntryPrice + tpDistance
    : avgEntryPrice - tpDistance;
  
  console.log(`   Take profit: $${takeProfitPrice.toFixed(4)} (${exitCushion}x ATR cushion)`);
  console.log(`   TP distance: $${tpDistance.toFixed(4)} (${(tpDistance/avgEntryPrice*100).toFixed(2)}%)\n`);
  
  return {
    levels: dcaLevels,
    q1,
    weightedAvgPrice: avgEntryPrice,
    stopLossPrice: stopPrice,
    takeProfitPrice,
    totalRiskDollars: maxRiskDollars,
    maxNotional: totalNotional,
  };
}

/**
 * Calculate the next layer for an existing position
 * This recalculates DCA levels dynamically based on current position state
 * 
 * @param strategy - The trading strategy
 * @param currentBalance - Current account balance
 * @param leverage - Position leverage
 * @param symbol - Trading symbol
 * @param side - Position side (long/short)
 * @param currentLayer - Current layer number
 * @param initialEntryPrice - Original entry price (P0)
 * @param apiKey - Aster DEX API key (optional for ATR calculation)
 * @param secretKey - Aster DEX secret key (optional for ATR calculation)
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
  apiKey?: string,
  secretKey?: string
): Promise<{ price: number; quantity: number; level: number } | null> {
  // Check if we've reached max layers
  if (currentLayer >= strategy.maxLayers) {
    console.log(`⚠️  Max layers reached (${strategy.maxLayers}), no more layers`);
    return null;
  }
  
  const nextLayer = currentLayer + 1;
  
  // Calculate current ATR for volatility scaling
  const atrPercent = await calculateATRPercent(symbol, 10, apiKey, secretKey);
  
  // Calculate all DCA levels
  const dcaResult = calculateDCALevels(strategy, {
    entryPrice: initialEntryPrice,
    side,
    currentBalance,
    leverage,
    atrPercent,
  });
  
  // Get the next level's price and quantity
  const nextLevel = dcaResult.levels[nextLayer - 1];
  if (!nextLevel) {
    console.log(`⚠️  Level ${nextLayer} not found in DCA calculation`);
    return null;
  }
  
  return {
    price: nextLevel.price,
    quantity: nextLevel.quantity,
    level: nextLayer,
  };
}
