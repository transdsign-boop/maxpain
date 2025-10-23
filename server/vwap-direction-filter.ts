/**
 * VWAP Direction Filter Service
 *
 * Calculates Volume-Weighted Average Price (VWAP) on configurable timeframes
 * and provides directional filtering with buffer zones to prevent flip-flopping.
 *
 * Features:
 * - Configurable VWAP timeframes (1h, 2h, 4h, 6h, 8h, 24h)
 * - Buffer zones to prevent noise near VWAP (configurable 0.01% - 0.2%)
 * - Direction state management (LONG_ONLY, SHORT_ONLY, BUFFER)
 * - Automatic VWAP reset at configured intervals
 * - Real-time status updates for UI display
 */

interface VWAPConfig {
  enabled: boolean;
  timeframeMinutes: number; // 60, 120, 180, 240, 360, 480, 1440
  bufferPercentage: number; // 0.0001 (0.01%) to 0.002 (0.2%)
  enableBuffer: boolean;
  startTime?: Date; // When to start VWAP calculation
}

interface PriceData {
  timestamp: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type VWAPDirection = 'LONG_ONLY' | 'SHORT_ONLY' | 'BUFFER' | 'LOADING';

interface VWAPStatus {
  direction: VWAPDirection;
  currentVWAP: number;
  currentPrice: number;
  upperBuffer: number;
  lowerBuffer: number;
  inBufferZone: boolean;
  previousDirection: VWAPDirection;
  distanceFromVWAP: number; // Percentage
  nextResetTime: number;
  timeUntilReset: number; // Milliseconds
}

export class VWAPDirectionFilter {
  private config: VWAPConfig;
  private symbol: string;

  // VWAP calculation state
  private priceVolumeSum: number = 0; // Σ(Volume × Typical Price)
  private volumeSum: number = 0; // Σ(Volume)
  private currentVWAP: number = 0;
  private sessionStartTime: number = 0;
  private nextResetTime: number = 0;

  // Direction state with buffer
  private currentDirection: VWAPDirection = 'LOADING';
  private previousDirection: VWAPDirection = 'LOADING';
  private inBufferZone: boolean = false;

  // Price tracking
  private lastPrice: number = 0;
  private priceHistory: PriceData[] = [];

  // Performance tracking
  private directonChanges: number = 0;
  private signalsBlocked: number = 0;
  private timeInBuffer: number = 0;
  private lastBufferEntry: number = 0;

  constructor(symbol: string, config: VWAPConfig) {
    this.symbol = symbol;
    this.config = config;

    // Initialize session start time
    this.sessionStartTime = config.startTime ? config.startTime.getTime() : Date.now();
    this.nextResetTime = this.sessionStartTime + (config.timeframeMinutes * 60 * 1000);

    console.log(`📊 VWAP Direction Filter initialized for ${symbol}`);
    console.log(`   Timeframe: ${config.timeframeMinutes}min, Buffer: ${(config.bufferPercentage * 100).toFixed(2)}%`);
  }

  /**
   * Update VWAP with new price data
   * Call this on every new candle or price update
   */
  updatePrice(priceData: PriceData): void {
    const now = Date.now();

    // Check if we need to reset VWAP
    if (now >= this.nextResetTime) {
      this.resetVWAP(now);
    }

    // Calculate typical price: (High + Low + Close) / 3
    const typicalPrice = (priceData.high + priceData.low + priceData.close) / 3;

    // Update VWAP accumulation
    this.priceVolumeSum += typicalPrice * priceData.volume;
    this.volumeSum += priceData.volume;

    // Calculate current VWAP
    if (this.volumeSum > 0) {
      this.currentVWAP = this.priceVolumeSum / this.volumeSum;
    }

    // Update current price
    this.lastPrice = priceData.close;

    // Store price history (keep last 100 data points for reference)
    this.priceHistory.push(priceData);
    if (this.priceHistory.length > 100) {
      this.priceHistory.shift();
    }

    // Update direction based on buffer logic
    this.updateDirection();
  }

  /**
   * Reset VWAP calculation at the configured interval
   */
  private resetVWAP(currentTime: number): void {
    console.log(`🔄 Resetting VWAP for ${this.symbol} (${this.config.timeframeMinutes}min interval)`);

    // Reset accumulators
    this.priceVolumeSum = 0;
    this.volumeSum = 0;
    this.currentVWAP = 0;

    // Update session times
    this.sessionStartTime = currentTime;
    this.nextResetTime = currentTime + (this.config.timeframeMinutes * 60 * 1000);

    // Clear price history for new session
    this.priceHistory = [];

    // Keep direction state across resets for continuity
    // This prevents sudden direction changes just because VWAP reset
  }

  /**
   * Update trading direction based on price vs VWAP with buffer logic
   */
  private updateDirection(): void {
    if (!this.config.enabled || this.currentVWAP === 0) {
      this.currentDirection = 'LOADING';
      return;
    }

    // Calculate buffer zone boundaries
    const bufferAmount = this.config.enableBuffer
      ? this.currentVWAP * this.config.bufferPercentage
      : 0;

    const upperBuffer = this.currentVWAP + bufferAmount;
    const lowerBuffer = this.currentVWAP - bufferAmount;

    // Determine if price is in buffer zone
    const wasInBuffer = this.inBufferZone;
    this.inBufferZone = this.lastPrice >= lowerBuffer && this.lastPrice <= upperBuffer;

    // Track time spent in buffer
    if (this.inBufferZone && !wasInBuffer) {
      this.lastBufferEntry = Date.now();
    } else if (!this.inBufferZone && wasInBuffer && this.lastBufferEntry > 0) {
      this.timeInBuffer += Date.now() - this.lastBufferEntry;
    }

    // Update direction with buffer logic
    if (this.lastPrice > upperBuffer) {
      // Price clearly above VWAP - shorts only
      if (this.currentDirection !== 'SHORT_ONLY') {
        this.previousDirection = this.currentDirection;
        this.currentDirection = 'SHORT_ONLY';
        this.directonChanges++;
        console.log(`📉 ${this.symbol} Direction: SHORT_ONLY (price above VWAP)`);
      }
    } else if (this.lastPrice < lowerBuffer) {
      // Price clearly below VWAP - longs only
      if (this.currentDirection !== 'LONG_ONLY') {
        this.previousDirection = this.currentDirection;
        this.currentDirection = 'LONG_ONLY';
        this.directonChanges++;
        console.log(`📈 ${this.symbol} Direction: LONG_ONLY (price below VWAP)`);
      }
    } else {
      // Price in buffer zone - maintain previous direction
      if (this.currentDirection !== 'BUFFER') {
        this.previousDirection = this.currentDirection;
        this.currentDirection = 'BUFFER';
        console.log(`🟡 ${this.symbol} Direction: BUFFER (maintaining ${this.previousDirection})`);
      }
    }
  }

  /**
   * Check if a long trade is allowed based on current VWAP direction
   */
  canTakeLong(): boolean {
    if (!this.config.enabled) return true; // Filter disabled, allow all

    const allowed = this.currentDirection === 'LONG_ONLY' ||
                   (this.currentDirection === 'BUFFER' && this.previousDirection === 'LONG_ONLY');

    if (!allowed) {
      this.signalsBlocked++;
      console.log(`🚫 ${this.symbol} Long signal blocked - Direction: ${this.currentDirection}`);
    }

    return allowed;
  }

  /**
   * Check if a short trade is allowed based on current VWAP direction
   */
  canTakeShort(): boolean {
    if (!this.config.enabled) return true; // Filter disabled, allow all

    const allowed = this.currentDirection === 'SHORT_ONLY' ||
                   (this.currentDirection === 'BUFFER' && this.previousDirection === 'SHORT_ONLY');

    if (!allowed) {
      this.signalsBlocked++;
      console.log(`🚫 ${this.symbol} Short signal blocked - Direction: ${this.currentDirection}`);
    }

    return allowed;
  }

  /**
   * Get current VWAP status for UI display
   */
  getStatus(): VWAPStatus {
    const bufferAmount = this.config.enableBuffer
      ? this.currentVWAP * this.config.bufferPercentage
      : 0;

    const distanceFromVWAP = this.currentVWAP > 0
      ? ((this.lastPrice - this.currentVWAP) / this.currentVWAP) * 100
      : 0;

    const now = Date.now();
    const timeUntilReset = Math.max(0, this.nextResetTime - now);

    return {
      direction: this.currentDirection,
      currentVWAP: this.currentVWAP,
      currentPrice: this.lastPrice,
      upperBuffer: this.currentVWAP + bufferAmount,
      lowerBuffer: this.currentVWAP - bufferAmount,
      inBufferZone: this.inBufferZone,
      previousDirection: this.previousDirection,
      distanceFromVWAP,
      nextResetTime: this.nextResetTime,
      timeUntilReset,
    };
  }

  /**
   * Get performance statistics
   */
  getStatistics() {
    return {
      directionChanges: this.directonChanges,
      signalsBlocked: this.signalsBlocked,
      timeInBufferMs: this.timeInBuffer,
      sessionStartTime: this.sessionStartTime,
      dataPoints: this.priceHistory.length,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<VWAPConfig>): void {
    const oldTimeframe = this.config.timeframeMinutes;

    this.config = { ...this.config, ...newConfig };

    // If timeframe changed, reset VWAP
    if (newConfig.timeframeMinutes && newConfig.timeframeMinutes !== oldTimeframe) {
      console.log(`⚙️ VWAP timeframe changed: ${oldTimeframe}min → ${newConfig.timeframeMinutes}min`);
      this.resetVWAP(Date.now());
    }

    console.log(`⚙️ VWAP config updated for ${this.symbol}:`, this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): VWAPConfig {
    return { ...this.config };
  }
}

/**
 * VWAP Filter Manager
 * Manages VWAP filters for multiple symbols
 */
export class VWAPFilterManager {
  private filters: Map<string, VWAPDirectionFilter> = new Map();
  private defaultConfig: VWAPConfig = {
    enabled: false,
    timeframeMinutes: 240, // 4 hours default
    bufferPercentage: 0.0005, // 0.05% default
    enableBuffer: true,
  };

  /**
   * Get or create VWAP filter for a symbol
   */
  getFilter(symbol: string, config?: VWAPConfig): VWAPDirectionFilter {
    if (!this.filters.has(symbol)) {
      const filterConfig = config || this.defaultConfig;
      this.filters.set(symbol, new VWAPDirectionFilter(symbol, filterConfig));
    }
    return this.filters.get(symbol)!;
  }

  /**
   * Update price for a symbol
   */
  updatePrice(symbol: string, priceData: PriceData): void {
    const filter = this.getFilter(symbol);
    filter.updatePrice(priceData);
  }

  /**
   * Check if long is allowed for symbol
   */
  canTakeLong(symbol: string): boolean {
    const filter = this.filters.get(symbol);
    return filter ? filter.canTakeLong() : true;
  }

  /**
   * Check if short is allowed for symbol
   */
  canTakeShort(symbol: string): boolean {
    const filter = this.filters.get(symbol);
    return filter ? filter.canTakeShort() : true;
  }

  /**
   * Get status for all symbols
   */
  getAllStatus(): Map<string, VWAPStatus> {
    const statuses = new Map<string, VWAPStatus>();
    for (const [symbol, filter] of this.filters) {
      statuses.set(symbol, filter.getStatus());
    }
    return statuses;
  }

  /**
   * Update global configuration for all filters
   */
  updateGlobalConfig(config: Partial<VWAPConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };
    for (const filter of this.filters.values()) {
      filter.updateConfig(config);
    }
  }
}

// Export singleton instance
export const vwapFilterManager = new VWAPFilterManager();
