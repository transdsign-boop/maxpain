import { wsBroadcaster } from './websocket-broadcaster';
import { db } from './db';
import { strategies, tradeSessions } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import {
  IExchangeStream,
  NormalizedAccountUpdate,
  NormalizedOrderUpdate,
  NormalizedTradeUpdate
} from './exchanges/types';
import WebSocket from 'ws';
import { vwapFilterManager } from './vwap-direction-filter';

interface LiveSnapshot {
  account: {
    feeTier: number;
    canTrade: boolean;
    canDeposit: boolean;
    canWithdraw: boolean;
    updateTime: number;
    totalWalletBalance?: string;
    totalUnrealizedProfit?: string;
    totalMarginBalance?: string;
    totalInitialMargin?: string;
    availableBalance?: string;
    usdcBalance: string;
    usdtBalance: string;
    assets: Array<{
      a: string;
      wb: string;
      cw: string;
      bc: string;
    }>;
  } | null;
  positions: any[];
  positionsSummary: {
    totalExposure: number;
    totalPnl: number;
    unrealizedPnl: number;
    realizedPnl: number;
    currentBalance: number;
    startingBalance: number;
    filledRiskDollars: number;
    filledRiskPercentage: number;
    reservedRiskDollars: number;
    reservedRiskPercentage: number;
    actualMarginUsed: number;
    actualMarginUsedPercentage: number;
  } | null;
  timestamp: number;
  error: string | null;
}

class LiveDataOrchestrator {
  private cache: Map<string, LiveSnapshot> = new Map();
  private lastAccountLogTime: number = 0;
  private lastPositionsLogTime: number = 0;
  private exchangeStreams: Map<string, IExchangeStream> = new Map();
  private cachedUsdtBalance: Map<string, number> = new Map(); // Cache USDT balance per strategy
  private cachedUsdfBalance: Map<string, number> = new Map(); // Cache USDF balance per strategy
  private cachedAvailableBalance: Map<string, number> = new Map(); // Cache exchange's calculated available balance

  // VWAP kline WebSocket stream
  private klineWs: WebSocket | null = null;
  private klineSymbols: string[] = [];
  private klineReconnectAttempts: number = 0;
  private klineReconnectTimeout: NodeJS.Timeout | null = null;
  private lastKlineLogTime: number = 0;

  constructor() {
    console.log('🎯 Live Data Orchestrator initialized - 100% WebSocket mode (NO POLLING)');
    // Periodically refresh USDT and USDF balances from REST API (every 60s)
    setInterval(() => this.refreshAllBalances(), 60000);
  }

  // Fetch USDF and USDT balances from REST API and cache them
  private async refreshAllBalances(): Promise<void> {
    try {
      const { createHmac } = await import('crypto');
      const apiKey = process.env.ASTER_DEX_API_KEY;
      const secretKey = process.env.ASTER_DEX_SECRET_KEY;
      
      if (!apiKey || !secretKey) return;

      const timestamp = Date.now();
      const params = `timestamp=${timestamp}`;
      const signature = createHmac('sha256', secretKey).update(params).digest('hex');
      
      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v2/account?${params}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );
      
      if (response.ok) {
        const data = await response.json();

        // Cache exchange's calculated available balance (top-level field)
        const exchangeAvailable = parseFloat(data.availableBalance || '0');
        for (const strategyId of this.cache.keys()) {
          this.cachedAvailableBalance.set(strategyId, exchangeAvailable);
        }

        // Cache USDF balance
        const usdfAsset = data.assets?.find((a: any) => a.asset === 'USDF');
        if (usdfAsset) {
          const usdfBalance = parseFloat(usdfAsset.walletBalance || '0');
          for (const strategyId of this.cache.keys()) {
            this.cachedUsdfBalance.set(strategyId, usdfBalance);
          }
        }

        // Cache USDT balance
        const usdtAsset = data.assets?.find((a: any) => a.asset === 'USDT');
        if (usdtAsset) {
          const usdtBalance = parseFloat(usdtAsset.walletBalance || '0');
          for (const strategyId of this.cache.keys()) {
            this.cachedUsdtBalance.set(strategyId, usdtBalance);
          }
        }
      }
    } catch (error) {
      // Silently fail - not critical
    }
  }

  // Initialize USDF and USDT balances for a strategy (called on startup)
  async initializeUsdtBalance(strategyId: string): Promise<void> {
    try {
      const { createHmac } = await import('crypto');
      const apiKey = process.env.ASTER_DEX_API_KEY;
      const secretKey = process.env.ASTER_DEX_SECRET_KEY;
      
      if (!apiKey || !secretKey) return;

      const timestamp = Date.now();
      const params = `timestamp=${timestamp}`;
      const signature = createHmac('sha256', secretKey).update(params).digest('hex');
      
      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v2/account?${params}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );
      
      if (response.ok) {
        const data = await response.json();

        // Cache exchange's calculated available balance
        const exchangeAvailable = parseFloat(data.availableBalance || '0');
        this.cachedAvailableBalance.set(strategyId, exchangeAvailable);
        console.log(`💰 Cached exchange available balance: $${exchangeAvailable.toFixed(2)}`);

        // Cache USDF balance
        const usdfAsset = data.assets?.find((a: any) => a.asset === 'USDF');
        if (usdfAsset) {
          const usdfBalance = parseFloat(usdfAsset.walletBalance || '0');
          this.cachedUsdfBalance.set(strategyId, usdfBalance);
          console.log(`💵 Cached USDF balance for strategy: $${usdfBalance.toFixed(2)}`);
        }

        // Cache USDT balance
        const usdtAsset = data.assets?.find((a: any) => a.asset === 'USDT');
        if (usdtAsset) {
          const usdtBalance = parseFloat(usdtAsset.walletBalance || '0');
          this.cachedUsdtBalance.set(strategyId, usdtBalance);
          console.log(`💵 Cached USDT balance for strategy: $${usdtBalance.toFixed(2)}`);
        }
      }
    } catch (error) {
      console.error('Failed to initialize balances:', error);
    }
  }

  /**
   * Connect to an exchange stream for a strategy
   * This replaces the old user-data-stream integration
   */
  async connectExchangeStream(strategyId: string, stream: IExchangeStream): Promise<void> {
    console.log(`🔌 Connecting exchange stream for strategy ${strategyId} (${stream.exchangeType})`);
    
    // Disconnect existing stream if any
    if (this.exchangeStreams.has(strategyId)) {
      await this.disconnectExchangeStream(strategyId);
    }

    // Store stream reference
    this.exchangeStreams.set(strategyId, stream);

    // Subscribe to stream events
    stream.onAccountUpdate((update: NormalizedAccountUpdate) => {
      this.handleNormalizedAccountUpdate(strategyId, update);
    });

    stream.onOrderUpdate((update: NormalizedOrderUpdate) => {
      this.handleNormalizedOrderUpdate(strategyId, update);
    });

    stream.onTradeUpdate((update: NormalizedTradeUpdate) => {
      this.handleNormalizedTradeUpdate(strategyId, update);
    });

    stream.onError((error: Error) => {
      console.error(`❌ Exchange stream error for strategy ${strategyId}:`, error);
    });

    stream.onDisconnect(() => {
      console.log(`🔌 Exchange stream disconnected for strategy ${strategyId}`);
    });

    stream.onReconnect(() => {
      console.log(`🔄 Exchange stream reconnected for strategy ${strategyId}`);
    });

    // Connect the stream
    await stream.connect();
    console.log(`✅ Exchange stream connected for strategy ${strategyId}`);
  }

  /**
   * Disconnect exchange stream for a strategy
   */
  async disconnectExchangeStream(strategyId: string): Promise<void> {
    const stream = this.exchangeStreams.get(strategyId);
    if (stream) {
      console.log(`🔌 Disconnecting exchange stream for strategy ${strategyId}`);

      // Disconnect the stream
      await stream.disconnect();

      // Remove from orchestrator's tracking
      this.exchangeStreams.delete(strategyId);

      // CRITICAL: Also notify registry to clear cached stream to prevent listener duplication
      // Registry will remove the cached instance, forcing fresh stream on next connect
      const { exchangeRegistry } = await import('./exchanges/registry');
      await exchangeRegistry.disconnectStrategy(strategyId);
    }
  }

  /**
   * Start real-time kline (candlestick) stream for VWAP calculations
   * Uses 1-minute candles, updates on candle close
   */
  startKlineStream(symbols: string[]): void {
    if (symbols.length === 0) {
      console.log('⚠️ No symbols provided for kline stream');
      return;
    }

    // If already running with same symbols, skip
    if (this.klineWs && JSON.stringify(this.klineSymbols) === JSON.stringify(symbols)) {
      console.log('✅ Kline stream already running with same symbols');
      return;
    }

    // Stop existing stream if running
    if (this.klineWs) {
      console.log('🔄 Restarting kline stream with new symbols...');
      this.stopKlineStream();
    }

    this.klineSymbols = symbols;

    // Build stream URL with multiple symbols (1-minute candles)
    // Format: wss://fstream.asterdex.com/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m
    const streams = symbols.map(s => `${s.toLowerCase()}@kline_1m`).join('/');
    const wsUrl = `wss://fstream.asterdex.com/stream?streams=${streams}`;

    console.log(`📊 Starting kline stream for ${symbols.length} symbols (real-time VWAP)`);

    this.klineWs = new WebSocket(wsUrl);

    this.klineWs.on('open', () => {
      console.log(`✅ Kline stream connected for ${symbols.length} symbols`);
      this.klineReconnectAttempts = 0;
    });

    this.klineWs.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        // Handle both single stream and multi-stream formats
        const event = message.data || message;

        if (event.e === 'kline') {
          const kline = event.k;
          const symbol = event.s;

          if (kline.x) {
            // Process closed candles for VWAP calculation
            vwapFilterManager.updatePrice(symbol, {
              timestamp: kline.t,
              high: parseFloat(kline.h),
              low: parseFloat(kline.l),
              close: parseFloat(kline.c),
              volume: parseFloat(kline.v)
            });

            // Update current price to the close of this completed candle
            vwapFilterManager.updateCurrentPrice(symbol, parseFloat(kline.c));

            // Log occasionally to avoid spam (every 60 seconds)
            if (Date.now() - this.lastKlineLogTime > 60000) {
              console.log(`📊 VWAP updated from kline: ${symbol} @ $${parseFloat(kline.c).toFixed(2)}`);
              this.lastKlineLogTime = Date.now();
            }

            // Broadcast VWAP status update to frontend (once per minute when candle closes)
            const vwapStatus = vwapFilterManager.getFilter(symbol).getStatus();
            wsBroadcaster.broadcast({
              type: 'vwap_update',
              data: {
                symbol,
                status: vwapStatus
              },
              timestamp: Date.now()
            });
          } else {
            // For non-closed candles, update current price internally but don't broadcast
            // This keeps calculations accurate without spamming the frontend
            vwapFilterManager.updateCurrentPrice(symbol, parseFloat(kline.c));
          }
        }
      } catch (error: any) {
        console.error('❌ Error processing kline message:', error.message);
      }
    });

    this.klineWs.on('error', (error: Error) => {
      console.error('❌ Kline stream error:', error.message);
    });

    this.klineWs.on('close', () => {
      console.log('🔌 Kline stream disconnected');
      this.klineWs = null;

      // Auto-reconnect with exponential backoff
      if (this.klineSymbols.length > 0) {
        const delay = Math.min(30000, 1000 * Math.pow(2, this.klineReconnectAttempts));
        this.klineReconnectAttempts++;

        console.log(`🔄 Reconnecting kline stream in ${delay / 1000}s (attempt ${this.klineReconnectAttempts})...`);

        this.klineReconnectTimeout = setTimeout(() => {
          this.startKlineStream(this.klineSymbols);
        }, delay);
      }
    });
  }

  /**
   * Stop kline stream
   */
  stopKlineStream(): void {
    if (this.klineReconnectTimeout) {
      clearTimeout(this.klineReconnectTimeout);
      this.klineReconnectTimeout = null;
    }

    if (this.klineWs) {
      console.log('🛑 Stopping kline stream');
      this.klineSymbols = []; // Clear symbols to prevent auto-reconnect
      this.klineWs.close();
      this.klineWs = null;
    }
  }

  /**
   * Update kline stream symbols (restart stream with new symbols)
   */
  updateKlineSymbols(symbols: string[]): void {
    if (JSON.stringify(this.klineSymbols) !== JSON.stringify(symbols)) {
      console.log(`🔄 Updating kline stream symbols: ${symbols.length} symbols`);
      this.startKlineStream(symbols);
    }
  }

  /**
   * Handle normalized account update from exchange stream
   */
  private handleNormalizedAccountUpdate(strategyId: string, update: NormalizedAccountUpdate): void {
    const snapshot = this.getSnapshot(strategyId);
    
    // Find USDF balance
    const usdtBalance = update.balances.find(b => b.asset === 'USDF');
    
    if (usdtBalance) {
      const walletBalance = usdtBalance.walletBalance || '0';
      const availableBalance = usdtBalance.availableBalance || '0';
      
      snapshot.account = {
        feeTier: 0,
        canTrade: true,
        canDeposit: true,
        canWithdraw: true,
        updateTime: Date.now(),
        totalWalletBalance: walletBalance,
        totalUnrealizedProfit: '0', // Calculated from positions
        totalMarginBalance: walletBalance,
        totalInitialMargin: '0',
        availableBalance,
        usdcBalance: walletBalance,
        usdtBalance: walletBalance,
        assets: [{
          a: 'USDF',
          wb: walletBalance,
          cw: availableBalance,
          bc: '0'
        }]
      };
      
      snapshot.timestamp = Date.now();
      
      if (Date.now() - this.lastAccountLogTime > 30000) {
        console.log(`✅ Account updated from ${this.exchangeStreams.get(strategyId)?.exchangeType} stream (balance: $${parseFloat(walletBalance).toFixed(2)})`);
        this.lastAccountLogTime = Date.now();
      }
      
      this.broadcastSnapshot(strategyId);
    }

    // Update positions from normalized account update
    // CRITICAL: Always update positions, even if empty (clears stale data)
    if (update.positions.length > 0) {
      // Convert normalized positions to legacy format
      snapshot.positions = update.positions.map(p => ({
        symbol: p.symbol,
        positionAmt: p.side === 'LONG' ? p.size : `-${p.size}`,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        unRealizedProfit: p.unrealizedPnl,
        unrealizedProfit: p.unrealizedPnl,
        marginType: p.marginType === 'CROSSED' ? 'cross' : 'isolated',
        isolatedWallet: '0',
        positionSide: p.positionSide,
        leverage: p.leverage
      }));
    } else {
      // Clear positions when update reports zero positions
      snapshot.positions = [];
      snapshot.positionsSummary = null;
    }
    
    snapshot.timestamp = Date.now();
    
    if (Date.now() - this.lastPositionsLogTime > 30000) {
      console.log(`✅ Positions updated from ${this.exchangeStreams.get(strategyId)?.exchangeType} stream (${update.positions.length} positions)`);
      this.lastPositionsLogTime = Date.now();
    }
    
    this.calculatePositionSummary(strategyId);
  }

  /**
   * Handle normalized order update from exchange stream
   */
  private handleNormalizedOrderUpdate(strategyId: string, update: NormalizedOrderUpdate): void {
    // Broadcast order update to frontend
    wsBroadcaster.broadcast({
      type: 'order_update',
      data: update,
      timestamp: Date.now()
    });
  }

  /**
   * Handle normalized trade update from exchange stream
   */
  private handleNormalizedTradeUpdate(strategyId: string, update: NormalizedTradeUpdate): void {
    // Broadcast trade as order update to frontend (trade is a type of order event)
    wsBroadcaster.broadcast({
      type: 'order_update',
      data: update,
      timestamp: Date.now()
    });

    // Trigger protective order update if configured
    // This will be handled by strategy-engine callbacks
  }

  // Get current snapshot from cache (or create empty one)
  getSnapshot(strategyId: string): LiveSnapshot {
    if (!this.cache.has(strategyId)) {
      this.cache.set(strategyId, {
        account: null,
        positions: [],
        positionsSummary: null,
        timestamp: Date.now(),
        error: null
      });
    }
    return this.cache.get(strategyId)!;
  }

  // Calculate total margin used from positions
  private calculateMarginUsed(positions: any[]): number {
    let totalMarginUsed = 0;
    for (const pos of positions) {
      const posAmt = Math.abs(parseFloat(pos.positionAmt || '0'));
      const entryPrice = parseFloat(pos.entryPrice || '0');
      const leverage = parseFloat(pos.leverage || '1');
      // Margin = Position Value / Leverage
      const positionMargin = (posAmt * entryPrice) / leverage;
      totalMarginUsed += positionMargin;
    }
    return totalMarginUsed;
  }

  // Update account cache from WebSocket (called by user-data-stream)
  updateAccountFromWebSocket(strategyId: string, balances: any[]): void {
    // Find both USDF and USDT balances (user can have both)
    const usdfBalance = balances.find((b: any) => b.asset === 'USDF');
    const usdtBalance = balances.find((b: any) => b.asset === 'USDT');
    
    // At least one USD-based asset must exist
    if (usdfBalance || usdtBalance) {
      const snapshot = this.getSnapshot(strategyId);
      
      // Sum both USDF and USDT for total wallet balance
      // WebSocket may not send complete balance data, so use cached values as fallback
      let usdfWallet = parseFloat(usdfBalance?.walletBalance || '0');
      let usdtWallet = parseFloat(usdtBalance?.walletBalance || '0');
      
      // If WebSocket didn't provide USDF, use cached value from REST API
      if (!usdfBalance && this.cachedUsdfBalance.has(strategyId)) {
        usdfWallet = this.cachedUsdfBalance.get(strategyId) || 0;
      }
      
      // If WebSocket didn't provide USDT, use cached value from REST API
      if (!usdtBalance && this.cachedUsdtBalance.has(strategyId)) {
        usdtWallet = this.cachedUsdtBalance.get(strategyId) || 0;
      }
      
      const totalWallet = usdfWallet + usdtWallet;
      
      // Sum unrealized P&L from both
      const usdfUnrealized = parseFloat(usdfBalance?.unrealizedProfit || '0');
      const usdtUnrealized = parseFloat(usdtBalance?.unrealizedProfit || '0');
      const totalUnrealizedProfit = (usdfUnrealized + usdtUnrealized).toString();
      
      // Sum margin balances from both assets (wallet + unrealized PnL)
      const usdfMargin = parseFloat(usdfBalance?.marginBalance || '0');
      const usdtMargin = parseFloat(usdtBalance?.marginBalance || '0');
      const totalMarginBalance = (usdfMargin + usdtMargin || totalWallet).toString();

      // Use USDF values as primary for other fields, fallback to USDT
      const primaryBalance = usdfBalance || usdtBalance;

      // Calculate margin from current positions (exchange doesn't provide reliable totalInitialMargin)
      const openPositions = snapshot.positions.filter((pos: any) => parseFloat(pos.positionAmt || '0') !== 0);
      const marginUsed = this.calculateMarginUsed(openPositions);

      // Get exchange's available balance - prefer WebSocket data, then cache, then fallback
      let actualAvailable = totalWallet - marginUsed; // Fallback calculation

      // First priority: Use available balance from WebSocket if provided
      const usdfAvailable = parseFloat(usdfBalance?.availableBalance || '0');
      const usdtAvailable = parseFloat(usdtBalance?.availableBalance || '0');
      const websocketAvailable = usdfAvailable + usdtAvailable;

      if (websocketAvailable > 0) {
        // WebSocket provides per-asset available balance - use it directly
        actualAvailable = websocketAvailable;
      } else if (this.cachedAvailableBalance.has(strategyId)) {
        // Second priority: Use cached value from REST API
        actualAvailable = this.cachedAvailableBalance.get(strategyId) || actualAvailable;
      }
      // Otherwise use fallback calculation
      
      // Build assets array with both USDF and USDT
      const assets = [];
      if (usdfBalance) {
        assets.push({
          a: 'USDF',
          wb: usdfBalance.walletBalance,
          cw: usdfBalance.crossWalletBalance,
          bc: usdfBalance.balanceChange || '0'
        });
      }
      if (usdtBalance) {
        assets.push({
          a: 'USDT',
          wb: usdtBalance.walletBalance,
          cw: usdtBalance.crossWalletBalance,
          bc: usdtBalance.balanceChange || '0'
        });
      }
      
      // Match the HTTP API format exactly - include ALL fields the frontend expects
      snapshot.account = {
        feeTier: 0,
        canTrade: true,
        canDeposit: true,
        canWithdraw: true,
        updateTime: Date.now(),
        // Total Balance = USDF + USDT wallet balance only (NO unrealized P&L)
        totalWalletBalance: totalWallet.toString(),
        // Unrealized P&L tracked separately
        totalUnrealizedProfit,
        totalMarginBalance,
        totalInitialMargin: marginUsed.toString(),
        // Available for NEW positions = Total Wallet - Margin Already Used
        availableBalance: actualAvailable.toString(),
        // Legacy fields for compatibility
        usdcBalance: totalWallet.toString(),
        usdtBalance: totalWallet.toString(),
        assets
      };
      snapshot.timestamp = Date.now();
      // Reduced logging - only log occasionally (every 30s) to reduce log spam
      if (Date.now() - this.lastAccountLogTime > 30000) {
        console.log('✅ Updated account cache from WebSocket (balance: $' + totalWallet.toFixed(2) + ', unrealized: $' + parseFloat(totalUnrealizedProfit).toFixed(2) + ', available: $' + actualAvailable.toFixed(2) + ')');
        this.lastAccountLogTime = Date.now();
      }
      this.broadcastSnapshot(strategyId);
    }
  }

  // Update positions cache from WebSocket (called by user-data-stream)
  updatePositionsFromWebSocket(strategyId: string, positions: any[]): void {
    const snapshot = this.getSnapshot(strategyId);
    
    // Filter to keep ONLY open positions (exclude closed positions with positionAmt=0)
    const openPositions = positions.filter((pos: any) => parseFloat(pos.positionAmt || '0') !== 0);
    
    snapshot.positions = openPositions;
    snapshot.timestamp = Date.now();
    
    // Calculate margin used from positions
    const totalMarginUsed = this.calculateMarginUsed(openPositions);
    
    // Update account available balance based on calculated margin
    if (snapshot.account) {
      const totalWallet = parseFloat(snapshot.account.totalWalletBalance || '0');
      const actualAvailable = totalWallet - totalMarginUsed;
      snapshot.account.availableBalance = actualAvailable.toString();
      snapshot.account.totalInitialMargin = totalMarginUsed.toString();
    }
    
    // Reduced logging - only log occasionally (every 30s) to reduce log spam
    if (Date.now() - this.lastPositionsLogTime > 30000) {
      console.log(`✅ Updated positions cache from WebSocket (${positions.length} total, ${openPositions.length} open, margin used: $${totalMarginUsed.toFixed(2)})`);
      this.lastPositionsLogTime = Date.now();
    }
    this.calculatePositionSummary(strategyId);
  }

  // Calculate simple summary from live positions
  private async calculatePositionSummary(strategyId: string): Promise<void> {
    try {
      const snapshot = this.getSnapshot(strategyId);
      const livePositions = snapshot.positions || [];

      // Calculate simple totals from live positions
      let totalExposure = 0;
      let unrealizedPnl = 0;

      for (const livePos of livePositions) {
        const positionValue = Math.abs(parseFloat(livePos.positionAmt || '0')) * parseFloat(livePos.entryPrice || '0');
        totalExposure += positionValue;
        // API returns unRealizedProfit (capital R), not unrealizedProfit
        unrealizedPnl += parseFloat(livePos.unRealizedProfit || livePos.unrealizedProfit || '0');
      }

      // Get account balance from cache
      const currentBalance = parseFloat(snapshot.account?.totalWalletBalance || '0');
      
      // Simple calculation
      const realizedPnl = 0; // Placeholder for now
      const totalPnl = realizedPnl + unrealizedPnl;
      const startingBalance = currentBalance - totalPnl;

      // Calculate portfolio risk (both filled, reserved, and actual margin usage)
      let filledRiskDollars = 0;
      let filledRiskPercentage = 0;
      let reservedRiskDollars = 0;
      let reservedRiskPercentage = 0;
      let actualMarginUsed = 0;
      let actualMarginUsedPercentage = 0;

      try {
        // Get active strategy and active session
        const strategy = await db.query.strategies.findFirst({
          where: eq(strategies.id, strategyId)
        });

        if (strategy) {
          const session = await db.query.tradeSessions.findFirst({
            where: and(
              eq(tradeSessions.strategyId, strategyId),
              eq(tradeSessions.isActive, true)
            )
          });

          if (session) {
            // Import strategyEngine singleton to access calculatePortfolioRisk
            const { strategyEngine } = await import('./strategy-engine');
            const portfolioRisk = await strategyEngine.calculatePortfolioRisk(strategy, session);
            filledRiskDollars = portfolioRisk.filledRisk;
            filledRiskPercentage = portfolioRisk.filledRiskPercentage;
            reservedRiskDollars = portfolioRisk.reservedRisk;
            reservedRiskPercentage = portfolioRisk.reservedRiskPercentage;
            actualMarginUsed = portfolioRisk.actualMarginUsed;
            actualMarginUsedPercentage = portfolioRisk.actualMarginUsedPercentage;
          }
        }
      } catch (riskError: any) {
        console.error(`⚠️ Error calculating portfolio risk:`, riskError.message);
        // Continue with zero risk values
      }

      snapshot.positionsSummary = {
        totalExposure,
        totalPnl,
        unrealizedPnl,
        realizedPnl,
        currentBalance,
        startingBalance,
        filledRiskDollars,
        filledRiskPercentage,
        reservedRiskDollars,
        reservedRiskPercentage,
        actualMarginUsed,
        actualMarginUsedPercentage
      };
      
      // Broadcast update
      this.broadcastSnapshot(strategyId);
    } catch (error: any) {
      console.error(`❌ Error calculating position summary:`, error.message);
    }
  }

  // Broadcast snapshot to all WebSocket clients
  private broadcastSnapshot(strategyId: string): void {
    const snapshot = this.getSnapshot(strategyId);
    wsBroadcaster.broadcast({
      type: 'live_snapshot',
      data: {
        snapshot: {
          strategyId,
          ...snapshot
        }
      },
      timestamp: Date.now()
    });
  }

  // Initialize for a strategy (no polling, just cache setup)
  start(strategyId: string): void {
    console.log(`✅ Live data cache ready for strategy ${strategyId} - data will arrive via WebSocket`);
    // Create empty snapshot - will be populated by WebSocket events
    this.getSnapshot(strategyId);
  }

  // Stop and clear cache for a strategy
  async stop(strategyId: string): Promise<void> {
    console.log(`🛑 Stopping live data for strategy ${strategyId}`);
    
    // Disconnect exchange stream
    await this.disconnectExchangeStream(strategyId);
    
    // Clear cache
    this.cache.delete(strategyId);
  }

  // Stop all and clear all caches
  async stopAll(): Promise<void> {
    console.log('🛑 Stopping all live data');

    // Stop kline stream
    this.stopKlineStream();

    // Disconnect all exchange streams
    const disconnectPromises = Array.from(this.exchangeStreams.keys()).map(strategyId =>
      this.disconnectExchangeStream(strategyId)
    );
    await Promise.all(disconnectPromises);

    // Clear all caches
    this.cache.clear();
  }
}

// Singleton instance
export const liveDataOrchestrator = new LiveDataOrchestrator();
