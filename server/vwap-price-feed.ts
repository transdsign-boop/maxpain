/**
 * VWAP Price Feed Service
 *
 * Manages real-time VWAP calculation for filters via WebSocket kline streams.
 * Accumulates 1-minute candles for the current period and recalculates VWAP.
 *
 * WebSocket Streams: wss://fstream.asterdex.com/stream (combined stream)
 * Stream Format: <symbol>@kline_1m (e.g., btcusdt@kline_1m)
 * VWAP Calculation: Σ(volume × typical_price) / Σ(volume) from accumulated candles
 * Typical Price: (high + low + close) / 3
 *
 * This matches TradingView's VWAP calculation methodology
 */

import WebSocket from 'ws';
import { rateLimiter } from './rate-limiter';
import { vwapFilterManager } from './vwap-direction-filter';
import { wsBroadcaster } from './websocket-broadcaster';

interface KlineData {
  symbol: string;
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  isFinal: boolean; // Whether the candle is closed
}

export class VWAPPriceFeed {
  private isRunning: boolean = false;
  private symbols: string[] = [];
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  // Store accumulated klines for each symbol's current period
  private periodKlines: Map<string, any[]> = new Map();

  constructor() {
    console.log('📊 VWAP Price Feed initialized (WebSocket kline stream mode)');
  }

  /**
   * Start real-time price feed via WebSocket kline streams
   */
  start(symbols: string[]): void {
    if (this.isRunning && JSON.stringify(this.symbols) === JSON.stringify(symbols)) {
      console.log('✅ VWAP Price Feed already running with same symbols');
      return;
    }

    this.symbols = symbols;
    console.log(`🔄 Starting VWAP Price Feed for ${symbols.length} symbols (WebSocket kline streams)`);

    // Initialize period klines storage
    for (const symbol of symbols) {
      this.periodKlines.set(symbol, []);
    }

    // Fetch initial historical klines for each symbol, then start WebSocket
    this.initializeHistoricalKlines().then(() => {
      this.connectWebSocket();
    });

    this.isRunning = true;
  }

  /**
   * Stop the price feed
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping VWAP Price Feed');

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.isRunning = false;
    this.symbols = [];
    this.periodKlines.clear();
  }

  /**
   * Initialize historical klines for all symbols
   * Fetches klines from the start of the current period
   * Uses sequential fetching with rate limiter to avoid 418 errors
   */
  private async initializeHistoricalKlines(): Promise<void> {
    console.log(`📥 Fetching historical klines for ${this.symbols.length} symbols (sequential with rate limiting)...`);

    let successCount = 0;
    let errorCount = 0;

    // Fetch one symbol at a time through the rate limiter
    for (const symbol of this.symbols) {
      try {
        const filter = vwapFilterManager.getFilter(symbol);
        const config = filter.getConfig();

        // Calculate period start time
        const periodStartTime = this.getAlignedPeriodStart(Date.now(), config.timeframeMinutes);

        // Fetch historical klines for the current period
        // Using 1-minute candles with limit=1000 (max allowed)
        const klines = await rateLimiter.enqueue(
          `vwap-init-klines-${symbol}`,
          async () => {
            const response = await fetch(
              `https://fapi.asterdex.com/fapi/v1/klines?symbol=${symbol}&interval=1m&startTime=${periodStartTime}&limit=1000`
            );

            if (!response.ok) {
              throw new Error(`Failed to fetch klines for ${symbol}: ${response.status}`);
            }

            return response.json();
          }
        );

        // Store klines and calculate initial VWAP
        this.periodKlines.set(symbol, klines || []);

        if (klines && klines.length > 0) {
          filter.recalculateFromKlines(klines);
          successCount++;
        }
      } catch (error: any) {
        errorCount++;
        // Initialize with empty klines on error
        this.periodKlines.set(symbol, []);
        console.error(`❌ Error fetching historical klines for ${symbol}:`, error.message);
      }
    }

    console.log(`✅ Historical klines initialized: ${successCount} succeeded, ${errorCount} failed`);
  }

  /**
   * Connect to WebSocket kline streams
   */
  private connectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
    }

    // Build combined stream URL
    // Format: wss://fstream.asterdex.com/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m/...
    const streams = this.symbols.map(s => `${s.toLowerCase()}@kline_1m`).join('/');
    const wsUrl = `wss://fstream.asterdex.com/stream?streams=${streams}`;

    console.log(`🔌 Connecting to VWAP 1-minute kline streams for ${this.symbols.length} symbols...`);

    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log(`✅ VWAP kline WebSocket connected (${this.symbols.length} symbols)`);
      this.reconnectAttempts = 0;
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // Combined stream format: { stream: "btcusdt@kline_5m", data: { ... } }
        if (message.data && message.data.k) {
          this.handleKlineUpdate(message.data);
        }
      } catch (error: any) {
        console.error('❌ Error parsing kline message:', error.message);
      }
    });

    this.ws.on('error', (error) => {
      console.error('❌ VWAP kline WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('🔌 VWAP kline WebSocket disconnected');

      if (this.isRunning && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

        console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        this.reconnectTimeout = setTimeout(() => {
          this.connectWebSocket();
        }, delay);
      }
    });
  }

  /**
   * Handle incoming kline update from WebSocket
   */
  private handleKlineUpdate(klineEvent: any): void {
    const k = klineEvent.k;
    const symbol = k.s; // Symbol
    const isFinal = k.x; // Whether the kline is closed

    const filter = vwapFilterManager.getFilter(symbol);

    if (isFinal) {
      // Process closed candles for VWAP calculation
      const kline = [
        k.t,  // openTime
        k.o,  // open
        k.h,  // high
        k.l,  // low
        k.c,  // close
        k.v,  // volume
        k.T,  // closeTime
      ];

      const config = filter.getConfig();
      const periodStartTime = this.getAlignedPeriodStart(Date.now(), config.timeframeMinutes);

      // Check if we need to reset for a new period
      const klineOpenTime = parseInt(k.t);
      if (klineOpenTime >= filter.getStatus().nextResetTime) {
        // New period started, clear old klines
        console.log(`🔄 New VWAP period started for ${symbol}`);
        this.periodKlines.set(symbol, []);
      }

      // Add closed candle to accumulated klines
      const currentKlines = this.periodKlines.get(symbol) || [];

      // Only add if it's within the current period
      if (klineOpenTime >= periodStartTime) {
        currentKlines.push(kline);
        this.periodKlines.set(symbol, currentKlines);

        // Recalculate VWAP from all accumulated klines
        filter.recalculateFromKlines(currentKlines);
      }

      // Update current price to the close of this completed candle
      vwapFilterManager.updateCurrentPrice(symbol, parseFloat(k.c));

      // Broadcast updated VWAP status to frontend (once per minute when candle closes)
      const vwapStatus = filter.getStatus();
      wsBroadcaster.broadcast({
        type: 'vwap_update',
        data: {
          symbol,
          status: vwapStatus
        },
        timestamp: Date.now()
      });
    } else {
      // For non-closed candles, update current price internally but don't broadcast
      // This keeps calculations accurate without spamming the frontend
      vwapFilterManager.updateCurrentPrice(symbol, parseFloat(k.c));
    }
  }

  /**
   * Get the start time of the current aligned period
   * For 480min (8h): aligns to 00:00, 08:00, 16:00 UTC
   */
  private getAlignedPeriodStart(timestamp: number, timeframeMinutes: number): number {
    const date = new Date(timestamp);
    const periodMs = timeframeMinutes * 60 * 1000;

    // Get milliseconds since start of day (UTC)
    const startOfDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const msSinceStartOfDay = timestamp - startOfDay.getTime();

    // Find which period we're in
    const periodIndex = Math.floor(msSinceStartOfDay / periodMs);

    return startOfDay.getTime() + (periodIndex * periodMs);
  }

  /**
   * Update the list of symbols to track
   */
  updateSymbols(symbols: string[]): void {
    if (JSON.stringify(this.symbols) === JSON.stringify(symbols)) {
      console.log('✅ VWAP symbols unchanged, no action needed');
      return;
    }

    console.log(`🔄 Updating VWAP Price Feed symbols: ${symbols.length} symbols`);

    // Restart with new symbols
    this.stop();
    this.start(symbols);
  }

  /**
   * Check if price feed is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Force refresh (re-fetches historical klines and recalculates VWAP)
   */
  async forceRefresh(): Promise<void> {
    console.log('🔄 Force refreshing VWAP data...');

    // Re-fetch historical klines for all symbols
    await this.initializeHistoricalKlines();

    // Broadcast updated status for all symbols
    for (const symbol of this.symbols) {
      const filter = vwapFilterManager.getFilter(symbol);
      const vwapStatus = filter.getStatus();
      wsBroadcaster.broadcast({
        type: 'vwap_update',
        data: {
          symbol,
          status: vwapStatus
        },
        timestamp: Date.now()
      });
    }

    console.log('✅ VWAP force refresh completed');
  }
}

// Export singleton instance
export const vwapPriceFeed = new VWAPPriceFeed();
