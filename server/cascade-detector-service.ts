import { WebSocket } from 'ws';
import { CascadeDetector } from './cascade-detector';
import { storage } from './storage';

/**
 * ⚠️ CRITICAL WARNING - DO NOT MODIFY POLLING ARCHITECTURE ⚠️
 * 
 * This cascade detector uses ULTRA-MINIMAL API POLLING to prevent rate limits.
 * Current configuration: ~24 API calls/minute (vs 1,620/min before optimization)
 * 
 * NEVER change the following without explicit user permission:
 * - Tick interval (default: 10 seconds)
 * - OI rotation strategy (3 symbols per tick)
 * - Batching architecture
 * 
 * Any changes to polling frequency/batching MUST be approved by user first!
 */

interface PriceSnapshot {
  price: number;
  timestamp: number;
}

interface LiquidationInfo {
  notional: number;
  dominantSide: 'long' | 'short' | 'neutral';
}

interface SymbolData {
  lastPrice: number;
  priceHistory: PriceSnapshot[];
  lastOI: number;
  lastOIUpdate: number; // Timestamp of last OI fetch for rotation
}

interface CascadeConfig {
  tickIntervalMs: number; // How often to run the tick (default: 10000ms)
  oiSymbolsPerTick: number; // How many symbols to fetch OI for per tick (default: 3)
  oiMaxAgeMs: number; // Max age of OI data before it's considered stale (default: 60000ms)
}

class CascadeDetectorService {
  private detectors: Map<string, CascadeDetector> = new Map();
  private symbolData: Map<string, SymbolData> = new Map();
  private clients: Set<WebSocket> | null = null;
  private isProcessing: boolean = false;
  private tickInterval: NodeJS.Timeout | null = null;
  
  private liqAccumulator: number = 0;
  private lastLiqReset: number = Date.now();

  // ⚠️ ULTRA-MINIMAL POLLING CONFIG - DO NOT CHANGE WITHOUT USER PERMISSION ⚠️
  private config: CascadeConfig = {
    tickIntervalMs: 10000,    // 10 second ticks (not 1 second!)
    oiSymbolsPerTick: 3,      // Only fetch 3 symbols per tick (rotate through all)
    oiMaxAgeMs: 60000         // OI data valid for 60 seconds
  };

  constructor() {
    // Symbols will be loaded from active strategy via syncSymbols()
    // Call syncSymbols() after service is constructed to load from database
  }

  private addSymbol(symbol: string): void {
    if (!this.detectors.has(symbol)) {
      this.detectors.set(symbol, new CascadeDetector(symbol, true));
      this.symbolData.set(symbol, {
        lastPrice: 0,
        priceHistory: [],
        lastOI: 0,
        lastOIUpdate: 0 // Never updated
      });
    }
  }

  public setClients(clients: Set<WebSocket>): void {
    this.clients = clients;
  }

  /**
   * Update cascade detector configuration
   * ⚠️ WARNING: Changing these values affects API call rate!
   * Only modify with explicit user permission to prevent rate limiting.
   */
  public updateConfig(newConfig: Partial<CascadeConfig>): void {
    const oldInterval = this.config.tickIntervalMs;
    this.config = { ...this.config, ...newConfig };
    
    // Restart with new interval if it changed
    if (oldInterval !== this.config.tickIntervalMs && this.tickInterval) {
      this.stop();
      this.start();
    }
    
    console.log(`⚙️ Cascade config updated:`, this.config);
  }

  public async start(): Promise<void> {
    if (this.tickInterval) {
      return;
    }

    console.log('🚨 Cascade Detector Service starting with ULTRA-MINIMAL POLLING...');
    console.log(`⚙️ Config: ${this.config.tickIntervalMs}ms tick, ${this.config.oiSymbolsPerTick} OI/tick, ${this.config.oiMaxAgeMs}ms OI cache`);
    
    // Sync symbols from active strategy before starting
    await this.syncSymbols();
    
    // Start tick interval with configured interval (default: 10 seconds)
    // ⚠️ DO NOT change back to 1 second without user permission!
    this.tickInterval = setInterval(() => {
      this.tick();
    }, this.config.tickIntervalMs);
    
    const symbolCount = this.detectors.size;
    const oiCallsPerTick = Math.min(this.config.oiSymbolsPerTick, symbolCount);
    const priceCallsPerTick = symbolCount > 0 ? 1 : 0;
    const totalCallsPerTick = priceCallsPerTick + oiCallsPerTick;
    const callsPerMinute = (totalCallsPerTick * 60000) / this.config.tickIntervalMs;
    
    console.log(`✅ Cascade Detector started: ${totalCallsPerTick} API calls per ${this.config.tickIntervalMs/1000}s = ~${Math.round(callsPerMinute)} calls/min`);
  }

  public stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    
    console.log('🚨 Cascade Detector Service stopped');
  }

  /**
   * Batch fetch all prices in a single API call
   * This is the most efficient way - gets ALL exchange prices at once
   */
  private async batchFetchPrices(): Promise<void> {
    const symbols = Array.from(this.detectors.keys());
    
    if (symbols.length === 0) {
      return;
    }
    
    try {
      // Single API call gets ALL prices
      const priceResponse = await fetch('https://fapi.asterdex.com/fapi/v1/ticker/price');
      if (!priceResponse.ok) {
        console.error(`❌ Price fetch failed: ${priceResponse.status}`);
        return;
      }
      
      const allPrices = await priceResponse.json();
      const priceMap = new Map<string, number>();
      
      for (const item of allPrices) {
        priceMap.set(item.symbol, parseFloat(item.price));
      }
      
      // Update prices for tracked symbols
      for (const symbol of symbols) {
        const price = priceMap.get(symbol);
        if (price) {
          const data = this.symbolData.get(symbol)!;
          data.lastPrice = price;
          data.priceHistory.push({ price, timestamp: Date.now() });
          
          // Keep last 60 price snapshots (for return calculations)
          if (data.priceHistory.length > 60) {
            data.priceHistory.shift();
          }
        }
      }
    } catch (error) {
      console.error('❌ Error batch fetching prices:', error);
    }
  }

  /**
   * ⚠️ ULTRA-MINIMAL OI FETCHING - ROTATION STRATEGY ⚠️
   * 
   * Instead of fetching OI for ALL symbols every tick (causing rate limits),
   * we rotate through symbols fetching only N per tick.
   * 
   * Example: 26 symbols, 3 per tick @ 10s interval = 90s to refresh all
   * Result: 3 OI calls per 10s = 18 calls/min (vs 1,560/min before!)
   */
  private async rotatingOIFetch(): Promise<void> {
    const symbols = Array.from(this.detectors.keys());
    
    if (symbols.length === 0) {
      return;
    }

    const now = Date.now();
    
    // Sort symbols by last update time (oldest first)
    const symbolsByAge = symbols
      .map(symbol => ({
        symbol,
        data: this.symbolData.get(symbol)!,
        age: now - this.symbolData.get(symbol)!.lastOIUpdate
      }))
      .sort((a, b) => b.age - a.age); // Oldest first
    
    // Fetch OI for the N oldest symbols
    const toFetch = symbolsByAge.slice(0, this.config.oiSymbolsPerTick);
    
    // Fetch in parallel (but only N symbols, not all)
    const oiPromises = toFetch.map(async ({ symbol }) => {
      try {
        const response = await fetch(`https://fapi.asterdex.com/fapi/v1/openInterest?symbol=${symbol}`);
        if (response.ok) {
          const data = await response.json();
          return { symbol, oi: parseFloat(data.openInterest), timestamp: now };
        }
      } catch (error) {
        // Silently fail for individual symbol
      }
      return null;
    });
    
    const oiResults = await Promise.all(oiPromises);
    
    // Update OI data and timestamp
    for (const result of oiResults) {
      if (result) {
        const symbolData = this.symbolData.get(result.symbol);
        if (symbolData) {
          symbolData.lastOI = result.oi;
          symbolData.lastOIUpdate = result.timestamp;
        }
      }
    }
  }

  private async getLiqNotionalLastSec(symbol: string): Promise<LiquidationInfo> {
    const now = Date.now();
    // Look back 60 seconds to ensure proper capture of all recent liquidation activity
    // (10s tick interval means we need broader window to avoid missing liquidations between ticks)
    const sixtySecondsAgo = new Date(now - 60000);
    
    try {
      const recentLiqs = await storage.getLiquidationsSince(sixtySecondsAgo, 1000);
      
      let longNotional = 0;
      let shortNotional = 0;
      
      for (const liq of recentLiqs) {
        // Filter by symbol
        if (liq.symbol !== symbol) continue;
        
        const value = parseFloat(liq.value);
        if (liq.side === 'long') {
          longNotional += value;
        } else if (liq.side === 'short') {
          shortNotional += value;
        }
      }
      
      const totalNotional = longNotional + shortNotional;
      
      let dominantSide: 'long' | 'short' | 'neutral' = 'neutral';
      if (totalNotional > 0) {
        const longRatio = longNotional / totalNotional;
        if (longRatio > 0.6) {
          dominantSide = 'long';
        } else if (longRatio < 0.4) {
          dominantSide = 'short';
        }
      }
      
      // Return same-side notional (dominant side only, not total)
      const sameSideNotional = dominantSide === 'long' ? longNotional : 
                                dominantSide === 'short' ? shortNotional : 0;
      
      return { notional: sameSideNotional, dominantSide };
    } catch (error) {
      console.error('Error fetching liquidations:', error);
      return { notional: 0, dominantSide: 'neutral' };
    }
  }

  private getReturnAndAlignment(symbol: string, dominantSide: 'long' | 'short' | 'neutral'): { ret1s: number; retSideMatchesLiq: boolean } {
    const data = this.symbolData.get(symbol);
    if (!data || data.priceHistory.length < 2) {
      return { ret1s: 0, retSideMatchesLiq: false };
    }

    const now = data.priceHistory[data.priceHistory.length - 1];
    const prev = data.priceHistory[data.priceHistory.length - 2];
    
    const ret1s = (now.price - prev.price) / prev.price;
    
    let retSideMatchesLiq = false;
    
    if (dominantSide === 'long' && ret1s < 0) {
      retSideMatchesLiq = true;
    } else if (dominantSide === 'short' && ret1s > 0) {
      retSideMatchesLiq = true;
    }
    
    return { ret1s, retSideMatchesLiq };
  }

  /**
   * Main tick function - runs at configured interval (default: 10 seconds)
   * 
   * ⚠️ ULTRA-MINIMAL API USAGE:
   * - 1 batch price call (all symbols)
   * - N rotating OI calls (default: 3 symbols)
   * - Total: 4 API calls per 10s = 24 calls/min
   */
  private async tick(): Promise<void> {
    // Skip if previous tick is still processing
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Batch fetch all prices (1 API call)
      await this.batchFetchPrices();
      
      // Rotating OI fetch (N API calls where N = oiSymbolsPerTick)
      await this.rotatingOIFetch();
      
      // Get RET thresholds and risk level from active strategy (same for all symbols)
      const strategies = await storage.getAllActiveStrategies();
      const activeStrategy = strategies[0];
      const retHighThreshold = activeStrategy ? parseFloat(activeStrategy.retHighThreshold) : 35;
      const retMediumThreshold = activeStrategy ? parseFloat(activeStrategy.retMediumThreshold) : 25;
      const riskLevel = activeStrategy?.riskLevel ?? 3; // Default to balanced

      const allStatuses = [];

      // Process each tracked symbol
      for (const [symbol, detector] of Array.from(this.detectors)) {
        const data = this.symbolData.get(symbol)!;
        
        // Get liquidation info for this symbol (from database, not API)
        const liqInfo = await this.getLiqNotionalLastSec(symbol);
        
        // Calculate return and alignment for this symbol (uses batch-fetched price data)
        const { ret1s, retSideMatchesLiq } = this.getReturnAndAlignment(symbol, liqInfo.dominantSide);

        // Use cached OI (may be up to oiMaxAgeMs old, but that's fine)
        const oi = data.lastOI;
        const oiAge = Date.now() - data.lastOIUpdate;

        // Update detector for this symbol (with risk level)
        const status = detector.ingestTick(liqInfo.notional, ret1s, oi, retSideMatchesLiq, retHighThreshold, retMediumThreshold, riskLevel);

        allStatuses.push(status);

        const csvLog = [
          new Date().toISOString(),
          symbol,
          status.score,
          status.LQ.toFixed(1),
          status.RET.toFixed(1),
          status.OI.toFixed(1),
          status.light,
          status.autoBlock,
          status.dOI_1m.toFixed(2),
          status.dOI_3m.toFixed(2),
          status.reversal_quality,
          status.rq_bucket,
          `(OI age: ${Math.round(oiAge/1000)}s)`
        ].join(',');
        
        console.log(`📊 Cascade [${symbol}]: ${csvLog}`);
      }

      // Broadcast all statuses
      this.broadcast(allStatuses);
    } catch (error) {
      console.error('Error in cascade detector tick:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private broadcast(status: any): void {
    if (!this.clients) return;

    const message = JSON.stringify({
      type: 'cascade_status',
      data: status
    });

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  public setAutoEnabled(enabled: boolean): void {
    // Set auto-enabled for all detectors
    this.detectors.forEach(detector => detector.setAutoEnabled(enabled));
  }

  public getAutoEnabled(): boolean {
    // Return auto-enabled status from first detector (all should be same)
    const first = this.detectors.values().next().value;
    return first ? first.getAutoEnabled() : true;
  }

  public async syncSymbols(): Promise<void> {
    try {
      // Get active strategy from database
      const strategies = await storage.getAllActiveStrategies();
      const activeStrategy = strategies[0];
      
      if (!activeStrategy) {
        // Clear all detectors when no active strategy
        this.detectors.clear();
        this.symbolData.clear();
        console.log('⚠️ No active strategy found, cleared all cascade detectors');
        return;
      }
      
      const selectedAssets = activeStrategy.selectedAssets || [];
      
      if (selectedAssets.length === 0) {
        // Clear all detectors when no assets selected
        this.detectors.clear();
        this.symbolData.clear();
        console.log('⚠️ No assets selected in strategy, cleared all cascade detectors');
        return;
      }
      
      // Convert to Set for efficient lookups
      const selectedSet = new Set(selectedAssets);
      
      // Remove detectors for symbols no longer selected
      const currentSymbols = Array.from(this.detectors.keys());
      for (const symbol of currentSymbols) {
        if (!selectedSet.has(symbol)) {
          this.detectors.delete(symbol);
          this.symbolData.delete(symbol);
          console.log(`🗑️ Removed cascade detector for ${symbol} (no longer selected)`);
        }
      }
      
      // Add detectors for newly selected symbols
      for (const symbol of selectedAssets) {
        if (!this.detectors.has(symbol)) {
          this.addSymbol(symbol);
          console.log(`✅ Added cascade detector for ${symbol}`);
        }
      }
      
      const symbolCount = this.detectors.size;
      const oiCallsPerTick = Math.min(this.config.oiSymbolsPerTick, symbolCount);
      const refreshCycleSeconds = symbolCount > 0 ? (symbolCount / oiCallsPerTick) * (this.config.tickIntervalMs / 1000) : 0;
      
      console.log(`📊 Cascade detector monitoring ${symbolCount} symbols`);
      console.log(`   🔄 OI refresh cycle: ${Math.round(refreshCycleSeconds)}s (${oiCallsPerTick} symbols per ${this.config.tickIntervalMs/1000}s tick)`);
    } catch (error) {
      console.error('❌ Error syncing cascade detector symbols:', error);
    }
  }

  public getStatus(symbol: string): any {
    const detector = this.detectors.get(symbol);
    if (!detector) {
      // If symbol not tracked, add it and return initial status
      this.addSymbol(symbol);
      return this.detectors.get(symbol)!.getCurrentStatus();
    }
    return detector.getCurrentStatus();
  }

  public getAllStatuses(): any[] {
    const statuses = [];
    for (const detector of Array.from(this.detectors.values())) {
      statuses.push(detector.getCurrentStatus());
    }
    return statuses;
  }

  public isBlocking(symbol: string): boolean {
    const status = this.getStatus(symbol);
    return status.autoBlock;
  }

  /**
   * Get current configuration (for debugging/monitoring)
   */
  public getConfig(): CascadeConfig {
    return { ...this.config };
  }
}

export const cascadeDetectorService = new CascadeDetectorService();
