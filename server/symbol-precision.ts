/**
 * Symbol Precision Manager
 *
 * Handles fetching and caching exchange symbol precision information
 * including stepSize, tickSize, minNotional, and minQty requirements.
 */

export interface SymbolPrecision {
  quantityPrecision: number;
  pricePrecision: number;
  stepSize: string;
  tickSize: string;
  minNotional: number; // Minimum order value (price × quantity) in USD
  minQty: number; // Minimum order quantity in base asset (e.g., 0.001 BTC)
}

export class SymbolPrecisionManager {
  private symbolPrecisionCache: Map<string, SymbolPrecision> = new Map();
  private exchangeInfoFetched = false;

  // Static cache shared across all instances (6 hour TTL)
  private static exchangeInfoCache: any = null;
  private static exchangeInfoCacheTime: number = 0;
  private static readonly CACHE_DURATION_MS = 6 * 60 * 60 * 1000;

  /**
   * Fetch exchange info to get symbol precision requirements
   * Uses static cache to avoid redundant API calls
   */
  async fetchExchangeInfo(): Promise<void> {
    if (this.exchangeInfoFetched) return;

    // Try to load from cache first
    const cacheAge = Date.now() - SymbolPrecisionManager.exchangeInfoCacheTime;
    if (SymbolPrecisionManager.exchangeInfoCache && cacheAge < SymbolPrecisionManager.CACHE_DURATION_MS) {
      const data = SymbolPrecisionManager.exchangeInfoCache;

      for (const symbol of data.symbols || []) {
        const lotSizeFilter = symbol.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
        const priceFilter = symbol.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
        const minNotionalFilter = symbol.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL');
        const parsedMinNotional = minNotionalFilter?.notional ? parseFloat(minNotionalFilter.notional) : 5.0;

        this.symbolPrecisionCache.set(symbol.symbol, {
          quantityPrecision: symbol.quantityPrecision || 8,
          pricePrecision: symbol.pricePrecision || 8,
          stepSize: lotSizeFilter?.stepSize || '1',
          tickSize: priceFilter?.tickSize || '0.01',
          minNotional: parsedMinNotional,
          minQty: parseFloat(lotSizeFilter?.minQty || '0'),
        });
      }

      this.exchangeInfoFetched = true;
      const ageMinutes = Math.floor(cacheAge / 60000);
      console.log(`✅ Loaded precision info from cache (age: ${ageMinutes}m, ${this.symbolPrecisionCache.size} symbols)`);
      return;
    }

    // Cache miss - fetch from exchange
    try {
      const response = await fetch('https://fapi.asterdex.com/fapi/v1/exchangeInfo');
      if (!response.ok) {
        console.error('❌ Failed to fetch exchange info:', response.statusText);
        return;
      }

      const data = await response.json();

      // Store in static cache
      SymbolPrecisionManager.exchangeInfoCache = data;
      SymbolPrecisionManager.exchangeInfoCacheTime = Date.now();

      // Cache precision info for each symbol
      for (const symbol of data.symbols || []) {
        const lotSizeFilter = symbol.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
        const priceFilter = symbol.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
        const minNotionalFilter = symbol.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL');
        const parsedMinNotional = minNotionalFilter?.notional ? parseFloat(minNotionalFilter.notional) : 5.0;

        if (!lotSizeFilter || !priceFilter) {
          console.log(`⚠️ ${symbol.symbol} missing filters:`, {
            hasLotSize: !!lotSizeFilter,
            hasPriceFilter: !!priceFilter,
            hasMinNotional: !!minNotionalFilter
          });
        }

        this.symbolPrecisionCache.set(symbol.symbol, {
          quantityPrecision: symbol.quantityPrecision || 8,
          pricePrecision: symbol.pricePrecision || 8,
          stepSize: lotSizeFilter?.stepSize || '1',
          tickSize: priceFilter?.tickSize || '0.01',
          minNotional: parsedMinNotional,
          minQty: parseFloat(lotSizeFilter?.minQty || '0'),
        });
      }

      this.exchangeInfoFetched = true;
      console.log(`✅ Fetched and cached precision info for ${this.symbolPrecisionCache.size} symbols`);
    } catch (error) {
      console.error('❌ Error fetching exchange info:', error);
    }
  }

  /**
   * Get precision info for a symbol
   */
  getPrecision(symbol: string): SymbolPrecision | undefined {
    return this.symbolPrecisionCache.get(symbol);
  }

  /**
   * Round quantity to match exchange precision requirements using stepSize
   */
  roundQuantity(symbol: string, quantity: number): number {
    const precision = this.symbolPrecisionCache.get(symbol);
    if (!precision) {
      console.warn(`⚠️ No precision info for ${symbol}, using default rounding`);
      return Math.floor(quantity * 100) / 100; // Default to 2 decimals
    }

    // Use stepSize for proper rounding (e.g., "1" = whole numbers, "0.1" = 1 decimal)
    const stepSize = parseFloat(precision.stepSize);
    const rounded = Math.floor(quantity / stepSize) * stepSize;

    // Format to correct decimal places to avoid floating point issues
    const decimals = precision.stepSize.includes('.')
      ? precision.stepSize.split('.')[1].length
      : 0;

    return parseFloat(rounded.toFixed(decimals));
  }

  /**
   * Round price to match exchange precision requirements using tickSize
   */
  roundPrice(symbol: string, price: number): number {
    const precision = this.symbolPrecisionCache.get(symbol);
    if (!precision) {
      console.warn(`⚠️ No precision info for ${symbol}, using default rounding`);
      return Math.floor(price * 100) / 100; // Default to 2 decimals
    }

    // Use tickSize for proper rounding (e.g., "0.01" = 2 decimals, "0.1" = 1 decimal)
    const tickSize = parseFloat(precision.tickSize);
    const rounded = Math.floor(price / tickSize) * tickSize;

    // Format to correct decimal places to avoid floating point issues
    const decimals = precision.tickSize.includes('.')
      ? precision.tickSize.split('.')[1].length
      : 0;

    return parseFloat(rounded.toFixed(decimals));
  }

  /**
   * Get all cached symbols
   */
  getAllSymbols(): string[] {
    return Array.from(this.symbolPrecisionCache.keys());
  }

  /**
   * Check if symbol exists in cache
   */
  hasSymbol(symbol: string): boolean {
    return this.symbolPrecisionCache.has(symbol);
  }
}

// Export singleton instance
export const symbolPrecisionManager = new SymbolPrecisionManager();
