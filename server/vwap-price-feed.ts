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

  // Mark price WebSocket for real-time price updates
  private markPriceWs: WebSocket | null = null;
  private markPriceReconnectTimeout: NodeJS.Timeout | null = null;
  private markPriceReconnectAttempts: number = 0;

  // Store accumulated klines for each symbol's current period
  private periodKlines: Map<string, any[]> = new Map();

  // Broadcast throttling (avoid spamming frontend)
  private lastBroadcastTime: Map<string, number> = new Map();
  private broadcastThrottleMs: number = 1000; // Broadcast at most once per second per symbol

  constructor() {
    console.log('📊 VWAP Price Feed initialized (dual-stream: klines + mark price)');
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

    // Fetch initial historical klines for each symbol, then start WebSockets
    this.initializeHistoricalKlines().then(() => {
      this.connectWebSocket();
      this.connectMarkPriceWebSocket();
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

    if (this.markPriceWs) {
      this.markPriceWs.close();
      this.markPriceWs = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.markPriceReconnectTimeout) {
      clearTimeout(this.markPriceReconnectTimeout);
      this.markPriceReconnectTimeout = null;
    }

    this.isRunning = false;
    this.symbols = [];
    this.periodKlines.clear();
    this.lastBroadcastTime.clear();
  }

  /**
   * Initialize historical klines for all symbols
   * Fetches klines from the start of the current period
   * Uses sequential fetching with rate limiter to avoid 418 errors
   */
  private async initializeHistoricalKlines(): Promise<void> {
    console.log(`📥 Fetching historical klines for ${this.symbols.length} symbols (with 250ms delays to avoid burst limit)...`);

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
        const response = await fetch(
          `https://fapi.asterdex.com/fapi/v1/klines?symbol=${symbol}&interval=1m&startTime=${periodStartTime}&limit=1000`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch klines for ${symbol}: ${response.status}`);
        }

        const klines = await response.json();

        // Store klines and calculate initial VWAP
        this.periodKlines.set(symbol, klines || []);

        if (klines && klines.length > 0) {
          filter.recalculateFromKlines(klines);
          successCount++;
        }

        // Add 250ms delay between requests to avoid burst rate limit
        // 24 symbols × 250ms = 6 seconds (well below burst threshold)
        await new Promise(resolve => setTimeout(resolve, 250));
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
   * Connect to mark price WebSocket for real-time price updates (~1s frequency)
   */
  private connectMarkPriceWebSocket(): void {
    if (this.markPriceWs) {
      this.markPriceWs.close();
    }

    // Build combined stream URL for mark price
    // Format: wss://fstream.asterdex.com/stream?streams=btcusdt@markPrice/ethusdt@markPrice/...
    const streams = this.symbols.map(s => `${s.toLowerCase()}@markPrice`).join('/');
    const wsUrl = `wss://fstream.asterdex.com/stream?streams=${streams}`;

    console.log(`🔌 Connecting to VWAP mark price streams for ${this.symbols.length} symbols...`);

    this.markPriceWs = new WebSocket(wsUrl);

    this.markPriceWs.on('open', () => {
      console.log(`✅ VWAP mark price WebSocket connected (${this.symbols.length} symbols)`);
      this.markPriceReconnectAttempts = 0;
    });

    this.markPriceWs.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // Combined stream format: { stream: "btcusdt@markPrice", data: { ... } }
        if (message.data) {
          this.handleMarkPriceUpdate(message.data);
        }
      } catch (error: any) {
        console.error('❌ Error parsing mark price message:', error.message);
      }
    });

    this.markPriceWs.on('error', (error) => {
      console.error('❌ VWAP mark price WebSocket error:', error.message);
    });

    this.markPriceWs.on('close', () => {
      console.log('🔌 VWAP mark price WebSocket disconnected');

      if (this.isRunning && this.markPriceReconnectAttempts < this.maxReconnectAttempts) {
        this.markPriceReconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.markPriceReconnectAttempts), 30000);

        console.log(`🔄 Reconnecting mark price in ${delay}ms (attempt ${this.markPriceReconnectAttempts}/${this.maxReconnectAttempts})...`);

        this.markPriceReconnectTimeout = setTimeout(() => {
          this.connectMarkPriceWebSocket();
        }, delay);
      }
    });
  }

  /**
   * Handle mark price update for real-time price tracking
   */
  private handleMarkPriceUpdate(markPriceData: any): void {
    const symbol = markPriceData.s; // Symbol (e.g., "BTCUSDT")
    const markPrice = parseFloat(markPriceData.p); // Mark price

    if (!symbol || isNaN(markPrice)) {
      return;
    }

    // Update current price in VWAP filter
    vwapFilterManager.updateCurrentPrice(symbol, markPrice);

    // Broadcast with throttling (max once per second per symbol)
    this.broadcastVWAPStatus(symbol);
  }

  /**
   * Broadcast VWAP status to frontend with throttling
   */
  private broadcastVWAPStatus(symbol: string): void {
    const now = Date.now();
    const lastBroadcast = this.lastBroadcastTime.get(symbol) || 0;

    // Only broadcast if enough time has passed since last broadcast
    if (now - lastBroadcast >= this.broadcastThrottleMs) {
      const filter = vwapFilterManager.getFilter(symbol);
      const vwapStatus = filter.getStatus();

      wsBroadcaster.broadcast({
        type: 'vwap_update',
        data: {
          symbol,
          status: vwapStatus
        },
        timestamp: now
      });

      this.lastBroadcastTime.set(symbol, now);
    }
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

      // Force immediate broadcast when candle closes (VWAP was recalculated)
      // Reset throttle timer to ensure this broadcasts
      this.lastBroadcastTime.delete(symbol);
      this.broadcastVWAPStatus(symbol);
    }
    // Note: Non-closed candles no longer need handling here - mark price stream handles real-time updates
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
