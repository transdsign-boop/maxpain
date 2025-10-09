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
  private maxReconnectAttempts = 10;
  private listenKeyRetryAttempts = 0;
  private maxListenKeyRetries = 10;

  async start(config: UserDataStreamConfig): Promise<void> {
    this.config = config;
    await this.startWithRetry();
  }

  private async startWithRetry(): Promise<void> {
    if (!this.config) return;

    try {
      // Create listen key with retry logic for rate limits
      await this.createListenKey();

      // Connect to WebSocket
      await this.connect();

      // Start keepalive (every 30 minutes)
      this.startKeepalive();

      // Reset retry counters on success
      this.listenKeyRetryAttempts = 0;
    } catch (error) {
      console.error('❌ Failed to start user data stream:', error);

      // Check if it's a rate limit error (429)
      const isRateLimit = error instanceof Error && 
        (error.message.includes('429') || error.message.includes('Too Many Requests'));

      if (isRateLimit && this.listenKeyRetryAttempts < this.maxListenKeyRetries) {
        // Exponential backoff for rate limits: 5s, 10s, 20s, 40s, 80s, etc.
        const delay = Math.min(5000 * Math.pow(2, this.listenKeyRetryAttempts), 300000);
        this.listenKeyRetryAttempts++;
        
        console.log(`⏳ Rate limit hit. Retrying listen key creation in ${delay/1000}s (attempt ${this.listenKeyRetryAttempts}/${this.maxListenKeyRetries})`);
        
        this.reconnectTimeout = setTimeout(() => {
          this.startWithRetry();
        }, delay);
      } else {
        console.error(`❌ Failed to start user data stream after ${this.listenKeyRetryAttempts} attempts`);
      }
    }
  }

  private async createListenKey(): Promise<void> {
    if (!this.config) throw new Error('Config not set');

    const response = await fetch(
      'https://fapi.asterdex.com/fapi/v1/listenKey',
      {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': this.config.apiKey,
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create listen key (${response.status}): ${text}`);
    }

    const { listenKey } = await response.json();
    this.listenKey = listenKey;
    console.log('✅ Created listen key for user data stream');
  }

  private async connect(): Promise<void> {
    if (!this.listenKey) {
      throw new Error('Listen key not available');
    }

    return new Promise((resolve, reject) => {
      const wsUrl = `wss://fstream.asterdex.com/ws/${this.listenKey}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', async () => {
        console.log('🔌 Connected to Aster DEX user data stream');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Fetch initial account and position data to populate cache
        // Add 3-second initial delay to allow Express server to start
        setTimeout(() => {
          this.fetchInitialData().catch(err => {
            console.error('Failed to fetch initial data:', err);
          });
        }, 3000);
        
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

  private async fetchInitialData(retries = 7, delayMs = 1500): Promise<void> {
    if (!this.config) return;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`🔄 Fetching initial account/position data via backend (attempt ${attempt}/${retries})...`);
        
        // Construct base URL for server-to-server communication
        // Use environment variable or default to localhost for development
        const isDeployed = process.env.REPLIT_DEPLOYMENT === '1';
        const deployedDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
        const baseUrl = isDeployed && deployedDomain
          ? `https://${deployedDomain}`
          : 'http://localhost:5000';
        
        // Fetch account balance via backend
        const accountResponse = await fetch(`${baseUrl}/api/live/account`);
        
        if (!accountResponse.ok) {
          throw new Error(`Account fetch failed: ${accountResponse.status} ${accountResponse.statusText}`);
        }
        
        const accountData = await accountResponse.json();
        
        if (accountData && accountData.totalWalletBalance !== undefined) {
          // Convert to balance format expected by orchestrator - include ALL fields
          const balance = parseFloat(accountData.totalWalletBalance);
          const available = parseFloat(accountData.availableBalance);
          const unrealized = parseFloat(accountData.totalUnrealizedProfit || '0');
          const marginBalance = parseFloat(accountData.totalMarginBalance || '0');
          const initialMargin = parseFloat(accountData.totalInitialMargin || '0');
          
          const balances = [{
            asset: 'USDT',
            walletBalance: balance.toString(),
            crossWalletBalance: available.toString(),
            unrealizedProfit: unrealized.toString(),
            marginBalance: marginBalance.toString(),
            initialMargin: initialMargin.toString(),
          }];
          
          const { db } = await import('./db');
          const { strategies } = await import('@shared/schema');
          const { eq } = await import('drizzle-orm');
          const activeStrategy = (await db.select().from(strategies).where(eq(strategies.isActive, true)).limit(1))[0];
          
          if (activeStrategy) {
            const { liveDataOrchestrator } = await import('./live-data-orchestrator');
            liveDataOrchestrator.updateAccountFromWebSocket(activeStrategy.id, balances);
            console.log(`✅ Initial account data loaded ($${balance.toFixed(2)})`);
          }
        }

        // Fetch positions via backend
        const positionsResponse = await fetch(`${baseUrl}/api/live/positions`);
        
        if (!positionsResponse.ok) {
          throw new Error(`Positions fetch failed: ${positionsResponse.status} ${positionsResponse.statusText}`);
        }
        
        const positions = await positionsResponse.json();
        
        const { db } = await import('./db');
        const { strategies } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const activeStrategy = (await db.select().from(strategies).where(eq(strategies.isActive, true)).limit(1))[0];
        
        if (activeStrategy && positions && positions.length > 0) {
          const { liveDataOrchestrator } = await import('./live-data-orchestrator');
          // Filter to only non-zero positions
          const nonZeroPositions = positions.filter((p: any) => parseFloat(p.positionAmt) !== 0);
          liveDataOrchestrator.updatePositionsFromWebSocket(activeStrategy.id, nonZeroPositions);
          console.log(`✅ Initial position data loaded (${nonZeroPositions.length} non-zero positions)`);
        }
        
        // Success! Exit retry loop
        return;
        
      } catch (error: any) {
        const isLastAttempt = attempt === retries;
        if (isLastAttempt) {
          console.error(`❌ Failed to fetch initial data after ${retries} attempts:`, error?.message || error);
        } else {
          console.log(`⚠️ Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
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

  private async handleAccountUpdate(message: any): Promise<void> {
    // Extract account balance and position updates
    const accountData = message.a;
    
    if (accountData) {
      // Get active strategy for cache updates
      const { db } = await import('./db');
      const { strategies } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const { liveDataOrchestrator } = await import('./live-data-orchestrator');
      
      const activeStrategy = await db.query.strategies.findFirst({
        where: eq(strategies.isActive, true)
      });

      // Balance updates
      if (accountData.B) {
        const balances = accountData.B.map((b: any) => ({
          asset: b.a,
          walletBalance: b.wb,
          crossWalletBalance: b.cw,
        }));
        
        // Update orchestrator cache from WebSocket
        if (activeStrategy) {
          liveDataOrchestrator.updateAccountFromWebSocket(activeStrategy.id, balances);
        }
        
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

        // Update orchestrator cache from WebSocket
        if (activeStrategy) {
          liveDataOrchestrator.updatePositionsFromWebSocket(activeStrategy.id, positions);
        }

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
        } else if (response.status >= 400 && response.status < 500) {
          // 4xx error means the listen key is invalid - recreate it
          console.error('⚠️ Keepalive failed with 4xx error - recreating listen key');
          await this.recreateConnection();
        } else {
          console.error('⚠️ Keepalive failed:', await response.text());
        }
      } catch (error) {
        console.error('❌ Error sending keepalive:', error);
      }
    }, 30 * 60 * 1000); // 30 minutes
  }

  private async recreateConnection(): Promise<void> {
    console.log('🔄 Recreating user data stream connection...');
    
    // Close existing connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Clear the old listen key
    this.listenKey = null;

    // Reset reconnect attempts
    this.reconnectAttempts = 0;

    // Create new listen key and reconnect
    try {
      await this.createListenKey();
      await this.connect();
      console.log('✅ Successfully recreated user data stream connection');
    } catch (error) {
      console.error('❌ Failed to recreate connection:', error);
      this.handleDisconnect();
    }
  }

  private handleDisconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnect attempts reached. Recreating listen key...');
      // Try to recreate the connection instead of giving up
      this.recreateConnection().catch((error) => {
        console.error('❌ Failed to recreate connection after max attempts:', error);
      });
      return;
    }

    // Exponential backoff: 5s, 10s, 20s, 40s, 80s
    const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 80000);
    this.reconnectAttempts++;

    console.log(`🔄 Attempting to reconnect in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(async () => {
      if (this.config) {
        try {
          // First try to reconnect with existing listen key
          await this.connect();
        } catch (error) {
          console.error('❌ Reconnection failed:', error);
          // If reconnect fails after several attempts, recreate the listen key
          if (this.reconnectAttempts >= Math.floor(this.maxReconnectAttempts / 2)) {
            console.log('🔄 Multiple reconnect failures - attempting to recreate listen key');
            await this.recreateConnection();
          } else {
            this.handleDisconnect();
          }
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
