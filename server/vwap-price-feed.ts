/**
 * VWAP Price Feed Service
 *
 * Fetches real-time price data from the exchange and feeds it to VWAP filters.
 * Updates every 1 minute to ensure VWAP calculations stay current.
 */

import { vwapFilterManager } from './vwap-direction-filter';

interface TickerData {
  symbol: string;
  lastPrice: string;
  volume: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
}

export class VWAPPriceFeed {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private updateIntervalMs: number = 60000; // 1 minute
  private symbols: string[] = [];

  constructor() {
    console.log('📊 VWAP Price Feed initialized');
  }

  /**
   * Start feeding price data to VWAP filters
   */
  start(symbols: string[]): void {
    if (this.isRunning) {
      console.log('⚠️ VWAP Price Feed already running, restarting with new symbols...');
      this.stop();
    }

    this.symbols = symbols;
    console.log(`🔄 Starting VWAP Price Feed for ${symbols.length} symbols`);

    // Fetch immediately on start
    this.fetchAndUpdatePrices();

    // Then fetch every minute
    this.intervalId = setInterval(() => {
      this.fetchAndUpdatePrices();
    }, this.updateIntervalMs);

    this.isRunning = true;
  }

  /**
   * Stop the price feed
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('🛑 VWAP Price Feed stopped');
  }

  /**
   * Fetch 24h ticker data from exchange and update VWAP filters
   */
  private async fetchAndUpdatePrices(): Promise<void> {
    if (this.symbols.length === 0) {
      return;
    }

    try {
      // Fetch 24h ticker data for all symbols
      const response = await fetch('https://fapi.asterdex.com/fapi/v1/ticker/24hr');

      if (!response.ok) {
        console.error(`❌ Failed to fetch ticker data: ${response.status} ${response.statusText}`);
        return;
      }

      const tickers: TickerData[] = await response.json();

      // Filter to only our tracked symbols
      const relevantTickers = tickers.filter(t => this.symbols.includes(t.symbol));

      let updatedCount = 0;

      // Update each VWAP filter with current price data
      for (const ticker of relevantTickers) {
        // Create price data point from ticker
        // Since we don't have individual candle volume, use the 24h volume divided by ~1440 (minutes in a day)
        // This is an approximation but will give us directional VWAP
        const volumePerMinute = parseFloat(ticker.volume) / 1440;

        // Use the manager's updatePrice method which will create filter if needed
        vwapFilterManager.updatePrice(ticker.symbol, {
          timestamp: Date.now(),
          high: parseFloat(ticker.highPrice),
          low: parseFloat(ticker.lowPrice),
          close: parseFloat(ticker.lastPrice),
          volume: volumePerMinute,
        });

        updatedCount++;
      }

      if (updatedCount > 0) {
        console.log(`✅ Updated ${updatedCount} VWAP filters with price data`);
      }

    } catch (error) {
      console.error('❌ Error fetching price data for VWAP:', error);
    }
  }

  /**
   * Update the list of symbols to track
   */
  updateSymbols(symbols: string[]): void {
    this.symbols = symbols;
    console.log(`🔄 Updated VWAP Price Feed symbols: ${symbols.length} symbols`);
  }

  /**
   * Check if price feed is running
   */
  get running(): boolean {
    return this.isRunning;
  }
}

// Export singleton instance
export const vwapPriceFeed = new VWAPPriceFeed();
