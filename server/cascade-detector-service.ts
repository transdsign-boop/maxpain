import { WebSocket } from 'ws';
import { CascadeDetector } from './cascade-detector';
import { storage } from './storage';

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
}

class CascadeDetectorService {
  private detectors: Map<string, CascadeDetector> = new Map();
  private symbolData: Map<string, SymbolData> = new Map();
  private clients: Set<WebSocket> | null = null;
  private isProcessing: boolean = false;
  private tickInterval: NodeJS.Timeout | null = null;
  
  private liqAccumulator: number = 0;
  private lastLiqReset: number = Date.now();

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
        lastOI: 0
      });
    }
  }

  public setClients(clients: Set<WebSocket>): void {
    this.clients = clients;
  }

  public async start(): Promise<void> {
    if (this.tickInterval) {
      return;
    }

    console.log('🚨 Cascade Detector Service starting...');
    
    // Sync symbols from active strategy before starting
    await this.syncSymbols();
    
    // Start tick interval for processing (1 second)
    // Each tick will batch fetch prices and OI
    this.tickInterval = setInterval(() => {
      this.tick();
    }, 1000);
    
    console.log('✅ Cascade Detector Service started (batch API mode - 2 calls/sec vs 38 calls/sec before)');
  }

  public stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    
    console.log('🚨 Cascade Detector Service stopped');
  }

  private async batchFetchPricesAndOI(): Promise<void> {
    const symbols = Array.from(this.detectors.keys());
    
    if (symbols.length === 0) {
      return;
    }
    
    try {
      // Batch fetch all prices (single API call)
      const priceResponse = await fetch('https://fapi.asterdex.com/fapi/v1/ticker/price');
      if (priceResponse.ok) {
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
            
            if (data.priceHistory.length > 60) {
              data.priceHistory.shift();
            }
          }
        }
      }
      
      // Batch fetch open interest for tracked symbols
      // Note: Aster DEX doesn't have batch endpoint, so we fetch individually but with Promise.all
      const oiPromises = symbols.map(async (symbol) => {
        try {
          const response = await fetch(`https://fapi.asterdex.com/fapi/v1/openInterest?symbol=${symbol}`);
          if (response.ok) {
            const data = await response.json();
            return { symbol, oi: parseFloat(data.openInterest) };
          }
        } catch (error) {
          // Silently fail for individual symbol
        }
        return null;
      });
      
      const oiResults = await Promise.all(oiPromises);
      
      for (const result of oiResults) {
        if (result) {
          const symbolData = this.symbolData.get(result.symbol);
          if (symbolData) {
            symbolData.lastOI = result.oi;
          }
        }
      }
    } catch (error) {
      console.error('❌ Error batch fetching prices/OI:', error);
    }
  }

  private async getLiqNotionalLastSec(symbol: string): Promise<LiquidationInfo> {
    const now = Date.now();
    // Look back 10 seconds instead of just 1 second to catch sparse liquidations
    const tenSecondsAgo = new Date(now - 10000);
    
    try {
      const recentLiqs = await storage.getLiquidationsSince(tenSecondsAgo, 1000);
      
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
      
      return { notional: totalNotional, dominantSide };
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

  private async tick(): Promise<void> {
    // Skip if previous tick is still processing
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      // Batch fetch prices and open interest (2 API calls total)
      await this.batchFetchPricesAndOI();
      
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
        
        // Get liquidation info for this symbol
        const liqInfo = await this.getLiqNotionalLastSec(symbol);
        
        // Calculate return and alignment for this symbol (uses batch-fetched price data)
        const { ret1s, retSideMatchesLiq } = this.getReturnAndAlignment(symbol, liqInfo.dominantSide);

        // Use open interest from batch fetch
        const oi = data.lastOI;

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
          status.rq_bucket
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
      
      console.log(`📊 Cascade detector now monitoring ${this.detectors.size} symbols via batch API (2 calls/sec)`);
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
}

export const cascadeDetectorService = new CascadeDetectorService();
