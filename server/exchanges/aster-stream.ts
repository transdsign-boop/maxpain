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

  // Reconnection state
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private bannedUntil: number | null = null;
  private shouldReconnect: boolean = true;

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
        
        // Setup keep-alive (ping every 30 minutes)
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

        // Schedule reconnect with exponential backoff (if enabled)
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
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
      // Disable auto-reconnect
      this.shouldReconnect = false;
      
      // Clear any pending reconnect
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      
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
    
    try {
      // Re-enable auto-reconnect for this attempt
      this.shouldReconnect = true;
      
      await this.connect();
      
      // Reset reconnection attempts on success
      this.reconnectAttempts = 0;
      this.bannedUntil = null;
      
      if (this.reconnectCallback) {
        this.reconnectCallback();
      }
    } catch (error) {
      console.error('❌ [Aster Stream] Reconnection failed:', error);
      
      // Schedule another retry if auto-reconnect is enabled
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
      
      throw error;
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
    console.log('🔑 Creating new User Data Stream listen key...');
    
    const response = await fetch(`${this.baseURL}/fapi/v1/listenKey`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });

    if (!response.ok) {
      // Check for HTTP 418 ban error
      if (response.status === 418) {
        try {
          const errorData = await response.json();
          console.error(`❌ Failed to create listen key (HTTP 418): ${JSON.stringify(errorData)}`);
          
          // Extract ban expiry timestamp from error message
          // Format: "IP(x.x.x.x) banned until 1234567890123"
          const banMatch = errorData.msg?.match(/banned until (\d+)/);
          if (banMatch) {
            this.bannedUntil = parseInt(banMatch[1], 10);
            const banExpiry = new Date(this.bannedUntil);
            const waitSeconds = Math.ceil((this.bannedUntil - Date.now()) / 1000);
            console.error(`🚫 [Aster Stream] IP BANNED until ${banExpiry.toISOString()} (${waitSeconds}s from now)`);
          }
        } catch (parseError) {
          console.error('❌ Failed to parse ban error:', parseError);
        }
      }
      
      const errorMsg = `Failed to get listen key: ${response.statusText} (${response.status})`;
      throw new Error(errorMsg);
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
    // Keep alive every 30 minutes (listen key expires after 60 minutes)
    this.keepAliveInterval = setInterval(() => {
      if (this.listenKey) {
        this.keepAliveListenKey(this.listenKey);
      }
    }, 30 * 60 * 1000);
  }

  private cleanup(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  private scheduleReconnect(): void {
    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Check if we've exceeded max attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ [Aster Stream] Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      this.shouldReconnect = false;
      return;
    }

    this.reconnectAttempts++;

    // Calculate delay with exponential backoff: 5s, 10s, 20s, 40s, 80s, ...
    // Cap at 5 minutes
    const baseDelay = 5000; // 5 seconds
    const exponentialDelay = baseDelay * Math.pow(2, this.reconnectAttempts - 1);
    const maxDelay = 5 * 60 * 1000; // 5 minutes
    let delay = Math.min(exponentialDelay, maxDelay);

    // If we're banned, wait until ban expires (plus 5 seconds buffer)
    if (this.bannedUntil) {
      const now = Date.now();
      if (now < this.bannedUntil) {
        const banDelay = this.bannedUntil - now + 5000; // Add 5s buffer
        delay = Math.max(delay, banDelay);
        
        const banExpiry = new Date(this.bannedUntil);
        const waitMinutes = Math.ceil(banDelay / 60000);
        console.log(`⏳ [Aster Stream] Waiting for ban to expire at ${banExpiry.toISOString()} (~${waitMinutes} min)`);
      } else {
        // Ban has expired
        this.bannedUntil = null;
      }
    }

    const delaySeconds = Math.ceil(delay / 1000);
    console.log(`⏱️  [Aster Stream] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delaySeconds}s`);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.reconnect();
      } catch (error) {
        console.error('❌ [Aster Stream] Reconnect attempt failed:', error);
        
        // Schedule another retry if auto-reconnect is enabled
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }
}
