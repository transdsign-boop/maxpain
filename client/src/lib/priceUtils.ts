// Price and quantity rounding utilities for exchange precision

interface SymbolPrecision {
  pricePrecision: number;
  quantityPrecision: number;
  filters?: Array<{
    filterType: string;
    tickSize?: string;
    stepSize?: string;
  }>;
}

// Cache for symbol precision info
const precisionCache = new Map<string, { tickSize: number; stepSize: number; decimals: number }>();

/**
 * Extract tick size from symbol info
 */
export function extractTickSize(symbol: SymbolPrecision): number {
  const priceFilter = symbol.filters?.find(f => f.filterType === 'PRICE_FILTER');
  if (priceFilter?.tickSize) {
    return parseFloat(priceFilter.tickSize);
  }
  // Fallback to precision-based calculation
  return Math.pow(10, -symbol.pricePrecision);
}

/**
 * Extract step size from symbol info
 */
export function extractStepSize(symbol: SymbolPrecision): number {
  const lotSizeFilter = symbol.filters?.find(f => f.filterType === 'LOT_SIZE');
  if (lotSizeFilter?.stepSize) {
    return parseFloat(lotSizeFilter.stepSize);
  }
  // Fallback to precision-based calculation
  return Math.pow(10, -symbol.quantityPrecision);
}

/**
 * Count decimal places in a number string
 */
function getDecimals(value: string): number {
  if (!value.includes('.')) return 0;
  return value.split('.')[1].length;
}

/**
 * Round price to exchange tick size
 */
export function roundPrice(symbol: string, price: number, symbolInfo?: SymbolPrecision): number {
  // Use cached precision if available
  let precision = precisionCache.get(symbol);
  
  // If not cached and symbolInfo provided, extract and cache it
  if (!precision && symbolInfo) {
    const tickSize = extractTickSize(symbolInfo);
    const decimals = getDecimals(tickSize.toString());
    precision = { tickSize, stepSize: extractStepSize(symbolInfo), decimals };
    precisionCache.set(symbol, precision);
  }
  
  // Fallback: use 2 decimals if no precision info
  if (!precision) {
    return Math.floor(price * 100) / 100;
  }
  
  const rounded = Math.floor(price / precision.tickSize) * precision.tickSize;
  return parseFloat(rounded.toFixed(precision.decimals));
}

/**
 * Round quantity to exchange step size
 */
export function roundQuantity(symbol: string, quantity: number, symbolInfo?: SymbolPrecision): number {
  // Use cached precision if available
  let precision = precisionCache.get(symbol);
  
  // If not cached and symbolInfo provided, extract and cache it
  if (!precision && symbolInfo) {
    const stepSize = extractStepSize(symbolInfo);
    const decimals = getDecimals(stepSize.toString());
    precision = { tickSize: extractTickSize(symbolInfo), stepSize, decimals };
    precisionCache.set(symbol, precision);
  }
  
  // Fallback: use 2 decimals if no precision info
  if (!precision) {
    return Math.floor(quantity * 100) / 100;
  }
  
  const rounded = Math.floor(quantity / precision.stepSize) * precision.stepSize;
  const stepDecimals = getDecimals(precision.stepSize.toString());
  return parseFloat(rounded.toFixed(stepDecimals));
}

/**
 * Calculate TP/SL prices with proper rounding (matches backend logic)
 */
export function calculateTPSL(
  avgEntryPrice: number,
  side: 'long' | 'short',
  tpPercent: number,
  slPercent: number,
  symbol: string,
  symbolInfo?: SymbolPrecision
): { takeProfitPrice: number; stopLossPrice: number } {
  // Calculate raw prices
  const rawTP = side === 'long'
    ? avgEntryPrice * (1 + tpPercent / 100)
    : avgEntryPrice * (1 - tpPercent / 100);
    
  const rawSL = side === 'long'
    ? avgEntryPrice * (1 - slPercent / 100)
    : avgEntryPrice * (1 + slPercent / 100);
  
  // Round to exchange precision
  const takeProfitPrice = roundPrice(symbol, rawTP, symbolInfo);
  const stopLossPrice = roundPrice(symbol, rawSL, symbolInfo);
  
  return { takeProfitPrice, stopLossPrice };
}
