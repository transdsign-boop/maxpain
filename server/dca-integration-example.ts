/**
 * DCA Integration Example
 * 
 * This file demonstrates how to use the DCA calculator with the SQL wrapper
 * to bypass Drizzle's caching bug and enable sophisticated DCA trading.
 */

import { 
  getStrategyWithDCA, 
  updateStrategyDCAParams,
  getPositionWithDCA,
  updatePositionInitialPrice,
  getOpenPositionsWithDCA,
  type DCAStrategyParams
} from './dca-sql';
import { calculateDCALevels } from './dca-calculator';
import { exchangeApi } from './exchange-api';

/**
 * Example 1: Initialize DCA settings for a strategy
 */
export async function initializeStrategyDCA(strategyId: string) {
  const defaultParams: DCAStrategyParams = {
    dcaStartStepPercent: "0.4",     // First DCA at 0.4% from entry
    dcaSpacingConvexity: "1.2",     // Convex spacing (levels get further apart)
    dcaSizeGrowth: "1.8",            // Each level is 1.8x larger than previous
    dcaMaxRiskPercent: "1.0",        // Max 1% account risk if all levels fill
    dcaVolatilityRef: "1.0",         // Reference volatility (will be calculated from ATR)
    dcaExitCushionMultiplier: "0.6"  // Exit at 60% of DCA distance for profit
  };
  
  const updated = await updateStrategyDCAParams(strategyId, defaultParams);
  console.log("✅ DCA settings initialized:", updated);
  return updated;
}

/**
 * Example 2: Calculate and place DCA orders when opening a position
 */
export async function openPositionWithDCA(
  strategyId: string,
  symbol: string,
  side: "LONG" | "SHORT",
  initialPrice: number,
  accountBalance: number
) {
  // 1. Get strategy with DCA parameters
  const strategy = await getStrategyWithDCA(strategyId);
  if (!strategy) {
    throw new Error("Strategy not found");
  }
  
  // 2. Fetch symbol precision and current ATR
  const symbolInfo = await exchangeApi.getSymbolInfo(symbol);
  const klines = await exchangeApi.getKlines(symbol, "1h", 100);
  
  // 3. Calculate DCA levels using the sophisticated calculator
  const dcaLevels = calculateDCALevels({
    symbol,
    side,
    initialPrice,
    accountBalance,
    strategy: {
      maxLayers: strategy.max_layers,
      leverage: strategy.leverage,
      dcaStartStepPercent: parseFloat(strategy.dca_start_step_percent),
      dcaSpacingConvexity: parseFloat(strategy.dca_spacing_convexity),
      dcaSizeGrowth: parseFloat(strategy.dca_size_growth),
      dcaMaxRiskPercent: parseFloat(strategy.dca_max_risk_percent),
      dcaVolatilityRef: parseFloat(strategy.dca_volatility_ref),
      dcaExitCushionMultiplier: parseFloat(strategy.dca_exit_cushion_multiplier)
    },
    klines,
    precision: symbolInfo
  });
  
  console.log(`📊 DCA Strategy for ${symbol}:`);
  console.log(`   Initial entry: ${dcaLevels.levels[0].price.toFixed(symbolInfo.pricePrecision)}`);
  console.log(`   DCA levels: ${dcaLevels.levels.length - 1} additional orders`);
  console.log(`   Take profit: ${dcaLevels.takeProfit.toFixed(symbolInfo.pricePrecision)}`);
  console.log(`   Stop loss: ${dcaLevels.stopLoss.toFixed(symbolInfo.pricePrecision)}`);
  console.log(`   Total risk: $${dcaLevels.maxDrawdown.toFixed(2)} (${dcaLevels.effectiveRiskPercent.toFixed(2)}%)`);
  
  // 4. Place initial market order
  const initialLevel = dcaLevels.levels[0];
  const initialOrder = await exchangeApi.placeOrder({
    symbol,
    side: side === "LONG" ? "BUY" : "SELL",
    type: "MARKET",
    quantity: initialLevel.quantity,
    positionSide: "BOTH"
  });
  
  console.log(`✅ Initial order placed: ${initialOrder.orderId}`);
  
  // 5. Place DCA limit orders (layers 2+)
  const dcaOrders = [];
  for (let i = 1; i < dcaLevels.levels.length; i++) {
    const level = dcaLevels.levels[i];
    const dcaOrder = await exchangeApi.placeOrder({
      symbol,
      side: side === "LONG" ? "BUY" : "SELL",
      type: "LIMIT",
      quantity: level.quantity,
      price: level.price,
      timeInForce: "GTC",
      positionSide: "BOTH"
    });
    dcaOrders.push(dcaOrder);
    console.log(`📝 DCA Level ${i}: ${level.quantity} @ ${level.price} (Order: ${dcaOrder.orderId})`);
  }
  
  // 6. Place take profit limit order
  const tpOrder = await exchangeApi.placeOrder({
    symbol,
    side: side === "LONG" ? "SELL" : "BUY",
    type: "TAKE_PROFIT_MARKET",
    stopPrice: dcaLevels.takeProfit,
    closePosition: true,
    positionSide: "BOTH"
  });
  console.log(`🎯 Take Profit set at ${dcaLevels.takeProfit}`);
  
  // 7. Place stop loss order
  const slOrder = await exchangeApi.placeOrder({
    symbol,
    side: side === "LONG" ? "SELL" : "BUY",
    type: "STOP_MARKET",
    stopPrice: dcaLevels.stopLoss,
    closePosition: true,
    positionSide: "BOTH"
  });
  console.log(`🛡️ Stop Loss set at ${dcaLevels.stopLoss}`);
  
  return {
    initialOrder,
    dcaOrders,
    tpOrder,
    slOrder,
    dcaLevels
  };
}

/**
 * Example 3: Monitor and adjust DCA orders as they fill
 */
export async function monitorDCAPosition(
  positionId: string,
  sessionId: string
) {
  // Get position with DCA data
  const position = await getPositionWithDCA(positionId);
  if (!position) {
    throw new Error("Position not found");
  }
  
  const initialPrice = parseFloat(position.initial_entry_price || position.avg_entry_price);
  const currentAvgPrice = parseFloat(position.avg_entry_price);
  const layersFilled = position.layers_filled;
  
  console.log(`📊 Position Status for ${position.symbol}:`);
  console.log(`   Initial entry: ${initialPrice}`);
  console.log(`   Current avg: ${currentAvgPrice}`);
  console.log(`   Layers filled: ${layersFilled}/${position.max_layers}`);
  
  // If more layers have filled, we might need to adjust TP
  if (layersFilled > 1) {
    console.log(`⚠️ DCA layers filled - position averaging down`);
    // Here you could recalculate TP based on new average entry
    // and cancel/replace the existing TP order
  }
}

/**
 * Example 4: Get all open positions with DCA tracking
 */
export async function getAllDCAPositions(sessionId: string) {
  const positions = await getOpenPositionsWithDCA(sessionId);
  
  console.log(`📊 Found ${positions.length} open DCA positions:`);
  for (const pos of positions) {
    const initialPrice = parseFloat(pos.initial_entry_price || pos.avg_entry_price);
    const avgPrice = parseFloat(pos.avg_entry_price);
    const priceDiff = ((avgPrice - initialPrice) / initialPrice * 100).toFixed(2);
    
    console.log(`   ${pos.symbol}: ${pos.layers_filled}/${pos.max_layers} layers, avg: ${avgPrice} (${priceDiff}% from initial)`);
  }
  
  return positions;
}

/**
 * Example 5: Update volatility reference dynamically
 * (Call this periodically to adapt to changing market conditions)
 */
export async function updateStrategyVolatility(
  strategyId: string,
  symbols: string[]
) {
  // Fetch recent ATR for all trading symbols
  const atrValues = await Promise.all(
    symbols.map(async (symbol) => {
      const klines = await exchangeApi.getKlines(symbol, "1h", 100);
      // Calculate ATR (simplified - you'd use the full calculator)
      const ranges = klines.map(k => parseFloat(k.high) - parseFloat(k.low));
      const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
      return avgRange;
    })
  );
  
  // Use median ATR as reference volatility
  const sortedATRs = atrValues.sort((a, b) => a - b);
  const medianATR = sortedATRs[Math.floor(sortedATRs.length / 2)];
  const volatilityPercent = (medianATR / 100).toFixed(4); // Convert to percentage
  
  // Update strategy with new volatility reference
  await updateStrategyDCAParams(strategyId, {
    dcaVolatilityRef: volatilityPercent
  });
  
  console.log(`📈 Updated volatility reference to ${volatilityPercent}% for ${symbols.length} symbols`);
}

/**
 * Example 6: Adjust DCA aggressiveness based on market conditions
 */
export async function adjustDCAAggressiveness(
  strategyId: string,
  mode: "conservative" | "moderate" | "aggressive"
) {
  const presets: Record<typeof mode, DCAStrategyParams> = {
    conservative: {
      dcaStartStepPercent: "0.6",      // Start further away
      dcaSpacingConvexity: "1.3",      // More spacing between levels
      dcaSizeGrowth: "1.5",             // Slower size growth
      dcaMaxRiskPercent: "0.5",         // Lower max risk
      dcaVolatilityRef: "1.0",
      dcaExitCushionMultiplier: "0.7"   // More conservative exit
    },
    moderate: {
      dcaStartStepPercent: "0.4",
      dcaSpacingConvexity: "1.2",
      dcaSizeGrowth: "1.8",
      dcaMaxRiskPercent: "1.0",
      dcaVolatilityRef: "1.0",
      dcaExitCushionMultiplier: "0.6"
    },
    aggressive: {
      dcaStartStepPercent: "0.3",      // Start closer
      dcaSpacingConvexity: "1.1",      // Tighter spacing
      dcaSizeGrowth: "2.2",             // Faster size growth
      dcaMaxRiskPercent: "2.0",         // Higher max risk
      dcaVolatilityRef: "1.0",
      dcaExitCushionMultiplier: "0.5"   // Earlier exit
    }
  };
  
  const params = presets[mode];
  await updateStrategyDCAParams(strategyId, params);
  console.log(`🎚️ Adjusted DCA to ${mode} mode`);
}
