/**
 * Bybit WebSocket Stream
 * 
 * Implements IExchangeStream for Bybit V5 private user data stream.
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

export class BybitWebSocketStream implements IExchangeStream {
  readonly exchangeType: ExchangeType = 'bybit';
  readonly isConnected: boolean = false;

  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

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
    this.wsURL = config.wsURL || 'wss://stream.bybit.com/v5/private';
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(): Promise<void> {
    try {
      console.log('🔌 [Bybit Stream] Connecting to WebSocket...');

      this.ws = new WebSocket(this.wsURL);

      // Setup event handlers
      this.ws.on('open', () => {
        console.log('✅ [Bybit Stream] WebSocket connected');
        
        // Authenticate
        this.authenticate();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ [Bybit Stream] Error parsing message:', error);
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error('❌ [Bybit Stream] WebSocket error:', error);
        if (this.errorCallback) {
          this.errorCallback(error);
        }
      });

      this.ws.on('close', () => {
        (this as any).isConnected = false;
        console.log('🔌 [Bybit Stream] WebSocket disconnected');
        
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
      console.error('❌ [Bybit Stream] Failed to connect:', error);
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

      (this as any).isConnected = false;
      console.log('✅ [Bybit Stream] Disconnected');
    } catch (error) {
      console.error('❌ [Bybit Stream] Error during disconnect:', error);
    }
  }

  async reconnect(): Promise<void> {
    console.log('🔄 [Bybit Stream] Reconnecting...');
    
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
  // Private Methods - Authentication
  // ============================================================================

  private authenticate(): void {
    const expires = Date.now() + 10000; // 10 seconds from now
    
    const signature = createHmac('sha256', this.secretKey)
      .update(`GET/realtime${expires}`)
      .digest('hex');

    const authMessage = {
      op: 'auth',
      args: [this.apiKey, expires, signature],
    };

    console.log('🔐 [Bybit Stream] Sending authentication...');
    this.ws!.send(JSON.stringify(authMessage));
  }

  private handleAuthResponse(message: any): void {
    if (message.success) {
      console.log('✅ [Bybit Stream] Authenticated successfully');
      (this as any).isConnected = true;
      
      // Subscribe to private topics
      this.subscribe();
      
      // Setup ping/pong keep-alive
      this.setupPingPong();
    } else {
      const error = new Error(`Authentication failed: ${message.ret_msg}`);
      console.error('❌ [Bybit Stream] Authentication failed:', message.ret_msg);
      if (this.errorCallback) {
        this.errorCallback(error);
      }
    }
  }

  private subscribe(): void {
    const subscribeMessage = {
      op: 'subscribe',
      args: ['position', 'order', 'execution', 'wallet'],
    };

    console.log('📡 [Bybit Stream] Subscribing to topics...');
    this.ws!.send(JSON.stringify(subscribeMessage));
  }

  // ============================================================================
  // Private Methods - WebSocket Message Handling
  // ============================================================================

  private handleMessage(message: any): void {
    // Handle operation responses
    if (message.op) {
      switch (message.op) {
        case 'auth':
          this.handleAuthResponse(message);
          break;
        case 'subscribe':
          if (message.success) {
            console.log('✅ [Bybit Stream] Subscribed successfully');
          } else {
            console.error('❌ [Bybit Stream] Subscription failed:', message.ret_msg);
          }
          break;
        case 'ping':
          // Server-initiated ping - respond with pong
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ op: 'pong' }));
          }
          break;
        case 'pong':
          // Pong received from server (response to our ping)
          break;
        default:
          console.log('📨 [Bybit Stream] Unknown operation:', message.op);
      }
      return;
    }

    // Handle topic data
    if (message.topic) {
      switch (message.topic) {
        case 'position':
          this.handlePositionUpdate(message);
          break;
        case 'order':
          this.handleOrderUpdate(message);
          break;
        case 'execution':
          this.handleExecutionUpdate(message);
          break;
        case 'wallet':
          this.handleWalletUpdate(message);
          break;
        default:
          console.log('📨 [Bybit Stream] Unknown topic:', message.topic);
      }
    }
  }

  private handlePositionUpdate(message: any): void {
    const data = message.data || [];
    
    if (!Array.isArray(data) || data.length === 0) return;

    // Normalize positions
    const positions: NormalizedPosition[] = data
      .filter((p: any) => parseFloat(p.size) !== 0)
      .map((p: any) => ({
        symbol: p.symbol,
        side: p.side === 'Buy' ? 'LONG' as const : 'SHORT' as const,
        size: p.size,
        entryPrice: p.avgPrice,
        markPrice: p.markPrice || p.avgPrice,
        unrealizedPnl: p.unrealisedPnl || '0',
        leverage: p.leverage,
        marginType: p.tradeMode === 0 ? 'CROSSED' as const : 'ISOLATED' as const,
        positionSide: p.side === 'Buy' ? 'LONG' as const : 'SHORT' as const,
      }));

    const normalizedUpdate: NormalizedAccountUpdate = {
      balances: [], // Position updates don't include balance data
      positions,
    };

    if (this.accountUpdateCallback) {
      this.accountUpdateCallback(normalizedUpdate);
    }
  }

  private handleWalletUpdate(message: any): void {
    const data = message.data || [];
    
    if (!Array.isArray(data) || data.length === 0) return;

    // Normalize balances
    const balances: NormalizedAssetBalance[] = data
      .filter((w: any) => w.coin)
      .map((w: any) => ({
        asset: w.coin,
        walletBalance: w.walletBalance || '0',
        availableBalance: w.availableToWithdraw || '0',
        crossMargin: w.cumRealisedPnl || '0',
        isolatedMargin: '0',
      }));

    const normalizedUpdate: NormalizedAccountUpdate = {
      balances,
      positions: [], // Wallet updates don't include position data
    };

    if (this.accountUpdateCallback) {
      this.accountUpdateCallback(normalizedUpdate);
    }
  }

  private handleOrderUpdate(message: any): void {
    const data = message.data || [];
    
    if (!Array.isArray(data) || data.length === 0) return;

    data.forEach((order: any) => {
      const normalizedOrderUpdate: NormalizedOrderUpdate = {
        orderId: order.orderId,
        clientOrderId: order.orderLinkId || undefined,
        symbol: order.symbol,
        side: order.side === 'Buy' ? 'BUY' : 'SELL',
        type: this.normalizeOrderType(order.orderType),
        status: this.normalizeOrderStatus(order.orderStatus),
        quantity: order.qty,
        price: order.price,
        stopPrice: order.stopOrderType ? order.triggerPrice : undefined,
        executedQty: order.cumExecQty || '0',
        avgPrice: order.avgPrice || undefined,
        positionSide: this.normalizePositionSide(order.positionIdx),
        updateTime: order.updatedTime || Date.now(),
      };

      if (this.orderUpdateCallback) {
        this.orderUpdateCallback(normalizedOrderUpdate);
      }
    });
  }

  private handleExecutionUpdate(message: any): void {
    const data = message.data || [];
    
    if (!Array.isArray(data) || data.length === 0) return;

    data.forEach((exec: any) => {
      const normalizedTradeUpdate: NormalizedTradeUpdate = {
        id: exec.execId,
        orderId: exec.orderId,
        symbol: exec.symbol,
        side: exec.side === 'Buy' ? 'BUY' : 'SELL',
        price: exec.execPrice,
        qty: exec.execQty,
        commission: exec.execFee || '0',
        commissionAsset: exec.feeRate ? 'USDT' : 'USDT', // Bybit uses quote currency
        time: exec.execTime || Date.now(),
        positionSide: this.normalizePositionSide(exec.positionIdx),
        realizedPnl: exec.closedPnl || undefined,
      };

      if (this.tradeUpdateCallback) {
        this.tradeUpdateCallback(normalizedTradeUpdate);
      }
    });
  }

  // ============================================================================
  // Private Methods - Normalization Helpers
  // ============================================================================

  private normalizeOrderType(bybitType: string): 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET' {
    switch (bybitType) {
      case 'Market':
        return 'MARKET';
      case 'Limit':
        return 'LIMIT';
      default:
        return 'MARKET';
    }
  }

  private normalizeOrderStatus(bybitStatus: string): 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED' | 'REJECTED' {
    switch (bybitStatus) {
      case 'New':
      case 'Created':
        return 'NEW';
      case 'Filled':
        return 'FILLED';
      case 'PartiallyFilled':
        return 'PARTIALLY_FILLED';
      case 'Cancelled':
        return 'CANCELED';
      case 'Rejected':
        return 'REJECTED';
      default:
        return 'NEW';
    }
  }

  private normalizePositionSide(positionIdx?: number): 'LONG' | 'SHORT' | 'BOTH' | undefined {
    if (positionIdx === undefined || positionIdx === null) return undefined;
    
    switch (positionIdx) {
      case 0:
        return 'BOTH'; // One-way mode
      case 1:
        return 'LONG'; // Hedge mode long
      case 2:
        return 'SHORT'; // Hedge mode short
      default:
        return undefined;
    }
  }

  // ============================================================================
  // Private Methods - Keep-Alive (Ping/Pong)
  // ============================================================================

  private setupPingPong(): void {
    // Send ping every 20 seconds to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, 20 * 1000);
  }

  private cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
