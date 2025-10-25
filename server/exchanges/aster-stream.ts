/**
 * Aster DEX WebSocket Stream
 * 
 * Implements IExchangeStream for Aster DEX user data stream.
 * Normalizes WebSocket events to exchange-agnostic format.
 */

import WebSocket from 'ws';
import { createHmac } from 'crypto';
import {
  ExchangeType,
  ExchangeConfig,
  IExchangeStream,
  NormalizedAccountUpdate,
  NormalizedOrderUpdate,
  NormalizedTradeUpdate,
  NormalizedPosition,
  NormalizedAssetBalance,
} from './types';

export class AsterWebSocketStream implements IExchangeStream {
  readonly exchangeType: ExchangeType = 'aster';
  readonly isConnected: boolean = false;

  private ws: WebSocket | null = null;
  private listenKey: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  private readonly baseURL: string;
  private readonly wsURL: string;
  private readonly apiKey: string;
  private readonly secretKey: string;

  // Event callbacks
  private accountUpdateCallback: ((update: NormalizedAccountUpdate) => void) | null = null;
  private orderUpdateCallback: ((update: NormalizedOrderUpdate) => void) | null = null;
  private tradeUpdateCallback: ((update: NormalizedTradeUpdate) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private disconnectCallback: (() => void) | null = null;
  private reconnectCallback: (() => void) | null = null;

  constructor(config: ExchangeConfig) {
    this.baseURL = config.baseURL || 'https://fapi.asterdex.com';
    this.wsURL = config.wsURL || 'wss://fstream.asterdex.com';
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(): Promise<void> {
    try {
      // Step 1: Get listen key
      this.listenKey = await this.getListenKey();
      console.log('✅ [Aster Stream] Listen key obtained');

      // Step 2: Connect WebSocket
      const wsUrl = `${this.wsURL}/ws/${this.listenKey}`;
      this.ws = new WebSocket(wsUrl);

      // Setup event handlers
      this.ws.on('open', () => {
        (this as any).isConnected = true;
        console.log('✅ [Aster Stream] WebSocket connected');
        
        // Setup keep-alive (ping every 1 minute)
        this.setupKeepAlive();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ [Aster Stream] Error parsing message:', error);
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error('❌ [Aster Stream] WebSocket error:', error);
        if (this.errorCallback) {
          this.errorCallback(error);
        }
      });

      this.ws.on('close', () => {
        (this as any).isConnected = false;
        console.log('🔌 [Aster Stream] WebSocket disconnected');
        
        this.cleanup();
        
        if (this.disconnectCallback) {
          this.disconnectCallback();
        }

        // Auto-reconnect after 5 seconds
        setTimeout(() => this.reconnect(), 5000);
      });

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
        
        this.ws!.once('open', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        this.ws!.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (error) {
      console.error('❌ [Aster Stream] Failed to connect:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.cleanup();
      
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      // Delete listen key
      if (this.listenKey) {
        await this.deleteListenKey(this.listenKey);
        this.listenKey = null;
      }

      (this as any).isConnected = false;
      console.log('✅ [Aster Stream] Disconnected');
    } catch (error) {
      console.error('❌ [Aster Stream] Error during disconnect:', error);
    }
  }

  async reconnect(): Promise<void> {
    console.log('🔄 [Aster Stream] Reconnecting...');
    
    await this.disconnect();
    await this.connect();
    
    if (this.reconnectCallback) {
      this.reconnectCallback();
    }
  }

  // ============================================================================
  // Event Subscription
  // ============================================================================

  onAccountUpdate(callback: (update: NormalizedAccountUpdate) => void): void {
    this.accountUpdateCallback = callback;
  }

  onOrderUpdate(callback: (update: NormalizedOrderUpdate) => void): void {
    this.orderUpdateCallback = callback;
  }

  onTradeUpdate(callback: (update: NormalizedTradeUpdate) => void): void {
    this.tradeUpdateCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  onDisconnect(callback: () => void): void {
    this.disconnectCallback = callback;
  }

  onReconnect(callback: () => void): void {
    this.reconnectCallback = callback;
  }

  // ============================================================================
  // Private Methods - WebSocket Message Handling
  // ============================================================================

  private handleMessage(message: any): void {
    const eventType = message.e;

    switch (eventType) {
      case 'ACCOUNT_UPDATE':
        this.handleAccountUpdate(message);
        break;
      case 'ORDER_TRADE_UPDATE':
        this.handleOrderTradeUpdate(message);
        break;
      case 'ACCOUNT_CONFIG_UPDATE':
        console.log('⚙️ [Aster Stream] Account config update received');
        break;
      default:
        console.log('📨 [Aster Stream] Unknown event:', eventType);
    }
  }

  private handleAccountUpdate(message: any): void {
    const accountData = message.a;
    
    if (!accountData) return;

    // Normalize balances
    const balances: NormalizedAssetBalance[] = (accountData.B || []).map((b: any) => ({
      asset: b.a,
      walletBalance: b.wb,
      availableBalance: b.cw, // Cross wallet balance as available
      crossMargin: b.cw,
      isolatedMargin: '0', // Not provided in this update
    }));

    // Normalize positions
    const positions: NormalizedPosition[] = (accountData.P || [])
      .filter((p: any) => parseFloat(p.pa) !== 0)
      .map((p: any) => ({
        symbol: p.s,
        side: parseFloat(p.pa) > 0 ? 'LONG' as const : 'SHORT' as const,
        size: Math.abs(parseFloat(p.pa)).toString(),
        entryPrice: p.ep,
        markPrice: p.mp || p.ep, // Mark price from payload, fallback to entry price
        unrealizedPnl: p.up,
        leverage: p.l || '1', // Leverage from payload, fallback to 1x
        marginType: p.mt === 'cross' ? 'CROSSED' as const : 'ISOLATED' as const,
        positionSide: p.ps,
      }));

    const normalizedUpdate: NormalizedAccountUpdate = {
      balances,
      positions,
    };

    if (this.accountUpdateCallback) {
      this.accountUpdateCallback(normalizedUpdate);
    }
  }

  private handleOrderTradeUpdate(message: any): void {
    const orderData = message.o;
    
    if (!orderData) return;

    // Determine if this is a trade fill
    const isTradeFill = orderData.x === 'TRADE';

    // Normalize order update
    const normalizedOrderUpdate: NormalizedOrderUpdate = {
      orderId: orderData.i.toString(),
      clientOrderId: orderData.c,
      symbol: orderData.s,
      side: orderData.S,
      type: orderData.o,
      status: orderData.X,
      quantity: orderData.q,
      price: orderData.p,
      stopPrice: orderData.sp,
      executedQty: orderData.z,
      avgPrice: orderData.ap,
      positionSide: orderData.ps,
      updateTime: orderData.T,
    };

    if (this.orderUpdateCallback) {
      this.orderUpdateCallback(normalizedOrderUpdate);
    }

    // If this is a trade fill, also emit trade update
    if (isTradeFill && orderData.l && orderData.L) {
      const normalizedTradeUpdate: NormalizedTradeUpdate = {
        id: `${orderData.t || Date.now()}`, // Trade ID
        orderId: orderData.i.toString(),
        symbol: orderData.s,
        side: orderData.S,
        price: orderData.L, // Last filled price
        qty: orderData.l, // Last filled quantity
        commission: orderData.n, // Commission amount
        commissionAsset: orderData.N, // Commission asset
        time: orderData.T,
        positionSide: orderData.ps,
        realizedPnl: orderData.rp,
      };

      if (this.tradeUpdateCallback) {
        this.tradeUpdateCallback(normalizedTradeUpdate);
      }
    }
  }

  // ============================================================================
  // Private Methods - Listen Key Management
  // ============================================================================

  private async getListenKey(): Promise<string> {
    const response = await fetch(`${this.baseURL}/fapi/v1/listenKey`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });

    if (!response.ok) {
      throw new Error(`Failed to get listen key: ${response.statusText}`);
    }

    const data = await response.json();
    return data.listenKey;
  }

  private async keepAliveListenKey(listenKey: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/fapi/v1/listenKey?listenKey=${listenKey}`, {
      method: 'PUT',
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });

    if (!response.ok) {
      console.error('❌ [Aster Stream] Failed to keep alive listen key');
    } else {
      console.log('✅ [Aster Stream] Listen key kept alive');
    }
  }

  private async deleteListenKey(listenKey: string): Promise<void> {
    try {
      await fetch(`${this.baseURL}/fapi/v1/listenKey?listenKey=${listenKey}`, {
        method: 'DELETE',
        headers: { 'X-MBX-APIKEY': this.apiKey },
      });
      console.log('✅ [Aster Stream] Listen key deleted');
    } catch (error) {
      console.error('❌ [Aster Stream] Failed to delete listen key:', error);
    }
  }

  private setupKeepAlive(): void {
    // Keep alive every 1 minute (listen key expires after 60 minutes)
    this.keepAliveInterval = setInterval(() => {
      if (this.listenKey) {
        this.keepAliveListenKey(this.listenKey);
      }
    }, 60 * 1000);
  }

  private cleanup(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }
}
