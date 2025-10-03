import { WebSocket } from 'ws';
import { CascadeDetector } from './cascade-detector';
import { storage } from './storage';

interface PriceSnapshot {
  price: number;
  timestamp: number;
}

class CascadeDetectorService {
  private detector: CascadeDetector;
  private clients: Set<WebSocket> | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  
  private lastPrice: number = 0;
  private priceHistory: PriceSnapshot[] = [];
  private lastOI: number = 0;
  
  private liqAccumulator: number = 0;
  private lastLiqReset: number = Date.now();

  constructor() {
    this.detector = new CascadeDetector(true);
  }

  public setClients(clients: Set<WebSocket>): void {
    this.clients = clients;
  }

  public start(): void {
    if (this.intervalId) {
      return;
    }

    console.log('🚨 Cascade Detector Service started');
    
    this.intervalId = setInterval(() => {
      this.tick();
    }, 1000);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🚨 Cascade Detector Service stopped');
    }
  }

  private async getLiqNotionalLastSec(): Promise<number> {
    const now = Date.now();
    const oneSecAgo = new Date(now - 1000);
    
    try {
      const recentLiqs = await storage.getLiquidationsSince(oneSecAgo, 1000);
      const notional = recentLiqs.reduce((sum, liq) => sum + parseFloat(liq.value), 0);
      return notional;
    } catch (error) {
      console.error('Error fetching liquidations:', error);
      return 0;
    }
  }

  private async getCurrentPrice(symbol: string = 'ASTERUSDT'): Promise<number> {
    try {
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${symbol}`);
      if (!response.ok) return this.lastPrice;
      
      const data = await response.json();
      return parseFloat(data.price) || this.lastPrice;
    } catch (error) {
      return this.lastPrice;
    }
  }

  private async getOpenInterest(symbol: string = 'ASTERUSDT'): Promise<number> {
    try {
      const response = await fetch(`https://fapi.asterdex.com/fapi/v1/openInterest?symbol=${symbol}`);
      if (!response.ok) return this.lastOI;
      
      const data = await response.json();
      return parseFloat(data.openInterest) || this.lastOI;
    } catch (error) {
      return this.lastOI;
    }
  }

  private getReturnAndAlignment(): { ret1s: number; retSideMatchesLiq: boolean } {
    if (this.priceHistory.length < 2) {
      return { ret1s: 0, retSideMatchesLiq: false };
    }

    const now = this.priceHistory[this.priceHistory.length - 1];
    const prev = this.priceHistory[this.priceHistory.length - 2];
    
    const ret1s = (now.price - prev.price) / prev.price;
    
    const retSideMatchesLiq = ret1s !== 0;
    
    return { ret1s, retSideMatchesLiq };
  }

  private async tick(): Promise<void> {
    try {
      const liqNotional = await this.getLiqNotionalLastSec();
      
      const currentPrice = await this.getCurrentPrice();
      this.priceHistory.push({ price: currentPrice, timestamp: Date.now() });
      if (this.priceHistory.length > 60) {
        this.priceHistory.shift();
      }
      this.lastPrice = currentPrice;

      const { ret1s, retSideMatchesLiq } = this.getReturnAndAlignment();

      const oi = await this.getOpenInterest();
      this.lastOI = oi;

      const status = this.detector.ingestTick(liqNotional, ret1s, oi, retSideMatchesLiq);

      const csvLog = [
        new Date().toISOString(),
        status.score,
        status.LQ.toFixed(1),
        status.RET.toFixed(1),
        status.OI.toFixed(1),
        status.light,
        status.autoBlock
      ].join(',');
      
      console.log(`📊 Cascade: ${csvLog}`);

      this.broadcast(status);
    } catch (error) {
      console.error('Error in cascade detector tick:', error);
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
    this.detector.setAutoEnabled(enabled);
  }

  public getAutoEnabled(): boolean {
    return this.detector.getAutoEnabled();
  }

  public getCurrentStatus(): any {
    return this.detector.getCurrentStatus();
  }

  public isBlocking(): boolean {
    const status = this.detector.getCurrentStatus();
    return status.autoBlock;
  }
}

export const cascadeDetectorService = new CascadeDetectorService();
