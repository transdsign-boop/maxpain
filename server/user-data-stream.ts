import WebSocket from 'ws';
import { wsBroadcaster } from './websocket-broadcaster';

interface UserDataStreamConfig {
  apiKey: string;
  onAccountUpdate?: (data: any) => void;
  onPositionUpdate?: (data: any) => void;
  onOrderUpdate?: (data: any) => void;
}

class UserDataStreamManager {
  private ws: WebSocket | null = null;
  private listenKey: string | null = null;
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private config: UserDataStreamConfig | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  async start(config: UserDataStreamConfig): Promise<void> {
    this.config = config;
    
    try {
      // Create listen key
      const listenKeyResponse = await fetch(
        'https://fapi.asterdex.com/fapi/v1/listenKey',
        {
          method: 'POST',
          headers: {
            'X-MBX-APIKEY': config.apiKey,
          },
        }
      );

      if (!listenKeyResponse.ok) {
        throw new Error(`Failed to create listen key: ${await listenKeyResponse.text()}`);
      }

      const { listenKey } = await listenKeyResponse.json();
      this.listenKey = listenKey;

      console.log('✅ Created listen key for user data stream');

      // Connect to WebSocket
      await this.connect();

      // Start keepalive (every 30 minutes)
      this.startKeepalive();
    } catch (error) {
      console.error('❌ Failed to start user data stream:', error);
      throw error;
    }
  }

  private async connect(): Promise<void> {
    if (!this.listenKey) {
      throw new Error('Listen key not available');
    }

    return new Promise((resolve, reject) => {
      const wsUrl = `wss://fstream.asterdex.com/ws/${this.listenKey}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('🔌 Connected to Aster DEX user data stream');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ Error parsing user data message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('❌ WebSocket user data stream error:', error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('🔌 User data stream disconnected');
        this.isConnected = false;
        this.handleDisconnect();
      });

      this.ws.on('ping', () => {
        this.ws?.pong();
      });
    });
  }

  private handleMessage(message: any): void {
    const eventType = message.e;

    switch (eventType) {
      case 'ACCOUNT_UPDATE':
        console.log('📊 Account update received');
        this.handleAccountUpdate(message);
        break;
      case 'ORDER_TRADE_UPDATE':
        console.log('📦 Order update received');
        this.handleOrderUpdate(message);
        break;
      case 'ACCOUNT_CONFIG_UPDATE':
        console.log('⚙️ Account config update received');
        break;
      default:
        console.log('📨 User data event:', eventType);
    }
  }

  private handleAccountUpdate(message: any): void {
    // Extract account balance and position updates
    const accountData = message.a;
    
    if (accountData) {
      // Balance updates
      if (accountData.B) {
        const balances = accountData.B.map((b: any) => ({
          asset: b.a,
          walletBalance: b.wb,
          crossWalletBalance: b.cw,
        }));
        
        // Broadcast balance update
        wsBroadcaster.broadcast({
          type: 'account_updated',
          data: balances,
          timestamp: Date.now()
        });

        if (this.config?.onAccountUpdate) {
          this.config.onAccountUpdate(balances);
        }
      }

      // Position updates
      if (accountData.P) {
        const positions = accountData.P.map((p: any) => ({
          symbol: p.s,
          positionAmt: p.pa,
          entryPrice: p.ep,
          unrealizedProfit: p.up,
          marginType: p.mt,
          isolatedWallet: p.iw,
          positionSide: p.ps,
        }));

        // Broadcast position update
        wsBroadcaster.broadcast({
          type: 'position_updated',
          data: positions,
          timestamp: Date.now()
        });

        if (this.config?.onPositionUpdate) {
          this.config.onPositionUpdate(positions);
        }
      }
    }
  }

  private handleOrderUpdate(message: any): void {
    const orderData = message.o;
    
    if (orderData) {
      const order = {
        symbol: orderData.s,
        clientOrderId: orderData.c,
        side: orderData.S,
        orderType: orderData.o,
        timeInForce: orderData.f,
        originalQuantity: orderData.q,
        originalPrice: orderData.p,
        averagePrice: orderData.ap,
        stopPrice: orderData.sp,
        executionType: orderData.x,
        orderStatus: orderData.X,
        orderId: orderData.i,
        lastFilledQuantity: orderData.l,
        cumulativeFilledQuantity: orderData.z,
        lastFilledPrice: orderData.L,
        commissionAsset: orderData.N,
        commission: orderData.n,
        orderTradeTime: orderData.T,
        tradeId: orderData.t,
        isOnBook: orderData.w,
        isMaker: orderData.m,
        isReduceOnly: orderData.R,
        workingType: orderData.wt,
        originalOrderType: orderData.ot,
        positionSide: orderData.ps,
        closeAll: orderData.cp,
        activationPrice: orderData.AP,
        callbackRate: orderData.cr,
        realizedProfit: orderData.rp,
      };

      // Broadcast order update
      wsBroadcaster.broadcast({
        type: 'order_update',
        data: order,
        timestamp: Date.now()
      });

      if (this.config?.onOrderUpdate) {
        this.config.onOrderUpdate(order);
      }
    }
  }

  private startKeepalive(): void {
    // Send keepalive every 30 minutes
    this.keepaliveInterval = setInterval(async () => {
      if (!this.config) return;

      try {
        const response = await fetch(
          'https://fapi.asterdex.com/fapi/v1/listenKey',
          {
            method: 'PUT',
            headers: {
              'X-MBX-APIKEY': this.config.apiKey,
            },
          }
        );

        if (response.ok) {
          console.log('🔄 User data stream keepalive sent');
        } else {
          console.error('⚠️ Keepalive failed:', await response.text());
        }
      } catch (error) {
        console.error('❌ Error sending keepalive:', error);
      }
    }, 30 * 60 * 1000); // 30 minutes
  }

  private handleDisconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnect attempts reached. Stopping user data stream.');
      this.stop();
      return;
    }

    // Exponential backoff: 5s, 10s, 20s, 40s, 80s
    const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 80000);
    this.reconnectAttempts++;

    console.log(`🔄 Attempting to reconnect in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(async () => {
      if (this.config) {
        try {
          await this.connect();
        } catch (error) {
          console.error('❌ Reconnection failed:', error);
          this.handleDisconnect();
        }
      }
    }, delay);
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping user data stream...');

    // Clear intervals and timeouts
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Delete listen key
    if (this.listenKey && this.config) {
      try {
        const response = await fetch(
          'https://fapi.asterdex.com/fapi/v1/listenKey',
          {
            method: 'DELETE',
            headers: {
              'X-MBX-APIKEY': this.config.apiKey,
            },
          }
        );

        if (response.ok) {
          console.log('🔚 Listen key deleted');
        }
      } catch (error) {
        console.error('❌ Error deleting listen key:', error);
      }
    }

    this.listenKey = null;
    this.config = null;
    this.isConnected = false;
  }

  getStatus(): { connected: boolean; reconnectAttempts: number } {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

export const userDataStreamManager = new UserDataStreamManager();
