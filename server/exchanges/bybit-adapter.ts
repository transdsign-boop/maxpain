/**
 * Bybit Exchange Adapter
 * 
 * Implements IExchangeAdapter for Bybit V5 API (unified futures trading).
 * Handles all REST API calls, authentication, and response normalization.
 * Uses testnet/demo trading for safe testing.
 */

import { createHmac } from 'crypto';
import {
  ExchangeType,
  ExchangeConfig,
  IExchangeAdapter,
  NormalizedAccountInfo,
  NormalizedPosition,
  NormalizedOrderParams,
  NormalizedOrderResponse,
  NormalizedTicker,
  NormalizedKline,
  NormalizedTrade,
  NormalizedExchangeInfo,
  NormalizedAssetBalance,
} from './types';

export class BybitExchangeAdapter implements IExchangeAdapter {
  readonly exchangeType: ExchangeType = 'bybit';
  readonly supportsHedgeMode: boolean = true;

  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly category: string = 'linear'; // USDT perpetual futures

  // Cache for exchange info
  private symbolPrecisionCache = new Map<string, {
    quantityPrecision: number;
    pricePrecision: number;
    stepSize: string;
    tickSize: string;
    minNotional: number;
  }>();
  private exchangeInfoFetched = false;

  constructor(config: ExchangeConfig) {
    // Use testnet/demo by default for safe testing
    this.baseURL = config.baseURL || 'https://api-testnet.bybit.com';
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;

    // Fetch exchange info on initialization
    this.fetchExchangeInfo();
  }

  // ============================================================================
  // Authentication (Bybit V5 specific)
  // ============================================================================

  generateSignature(queryString: string, timestamp: number): string {
    const recvWindow = 5000;
    // Bybit signature: timestamp + apiKey + recvWindow + queryString
    const signaturePayload = `${timestamp}${this.apiKey}${recvWindow}${queryString}`;
    
    return createHmac('sha256', this.secretKey)
      .update(signaturePayload)
      .digest('hex');
  }

  private createSignedRequest(params: Record<string, any>, method: 'GET' | 'POST' = 'GET'): { 
    queryString: string; 
    signature: string; 
    timestamp: number;
    headers: Record<string, string>;
    body?: string;
  } {
    const timestamp = Date.now();
    const recvWindow = 5000;
    
    // Bybit V5 requires parameters to be sorted alphabetically
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {} as Record<string, any>);
    
    let signature: string;
    let queryString = '';
    let body: string | undefined;
    
    if (method === 'GET') {
      // For GET requests, params go in query string
      queryString = Object.entries(sortedParams)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('&');
      signature = this.generateSignature(queryString, timestamp);
    } else {
      // For POST requests, params go in JSON body
      body = JSON.stringify(sortedParams);
      signature = this.generateSignature(body, timestamp);
    }
    
    const headers = {
      'X-BAPI-API-KEY': this.apiKey,
      'X-BAPI-TIMESTAMP': timestamp.toString(),
      'X-BAPI-SIGN': signature,
      'X-BAPI-RECV-WINDOW': recvWindow.toString(),
      'Content-Type': 'application/json',
    };
    
    return { queryString, signature, timestamp, headers, body };
  }

  // ============================================================================
  // Account & Position Management
  // ============================================================================

  async getAccountInfo(): Promise<NormalizedAccountInfo> {
    const { headers, queryString } = this.createSignedRequest({ accountType: 'UNIFIED' });
    
    const response = await fetch(
      `${this.baseURL}/v5/account/wallet-balance?${queryString}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch account info: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    const accountData = data.result?.list?.[0] || {};
    
    // Normalize asset balances
    const assets: NormalizedAssetBalance[] = (accountData.coin || []).map((coin: any) => ({
      asset: coin.coin,
      walletBalance: coin.walletBalance || '0',
      availableBalance: coin.availableToWithdraw || '0',
      crossMargin: coin.equity || '0',
      isolatedMargin: '0', // Bybit doesn't separate this in CONTRACT account
    }));

    // Fetch positions separately
    const positions = await this.getPositions();

    return {
      totalBalance: accountData.totalEquity || '0',
      availableBalance: accountData.totalAvailableBalance || '0',
      totalMarginUsed: accountData.totalMarginBalance || '0',
      totalUnrealizedPnl: accountData.totalPerpUPL || '0',
      assets,
      positions,
    };
  }

  async getPositions(symbol?: string): Promise<NormalizedPosition[]> {
    const params: Record<string, any> = { 
      category: this.category,
      settleCoin: 'USDT' 
    };
    
    if (symbol) {
      params.symbol = symbol;
    }

    const { queryString, headers } = this.createSignedRequest(params);
    
    const response = await fetch(
      `${this.baseURL}/v5/position/list?${queryString}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch positions: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    const positions: NormalizedPosition[] = (data.result?.list || [])
      .filter((pos: any) => parseFloat(pos.size) !== 0)
      .map((pos: any) => ({
        symbol: pos.symbol,
        side: pos.side === 'Buy' ? 'LONG' as const : 'SHORT' as const,
        size: pos.size.toString(),
        entryPrice: pos.avgPrice.toString(),
        markPrice: pos.markPrice.toString(),
        unrealizedPnl: (pos.unrealisedPnl || '0').toString(),
        leverage: pos.leverage.toString(),
        marginType: pos.tradeMode === 0 ? 'CROSSED' as const : 'ISOLATED' as const,
        positionSide: pos.side === 'Buy' ? 'LONG' as const : 'SHORT' as const,
      }));

    return positions;
  }

  async setLeverage(symbol: string, leverage: number, marginType?: 'isolated' | 'cross'): Promise<void> {
    const params = {
      category: this.category,
      symbol,
      buyLeverage: leverage.toString(),
      sellLeverage: leverage.toString(),
    };

    const { headers, body } = this.createSignedRequest(params, 'POST');
    
    const response = await fetch(
      `${this.baseURL}/v5/position/set-leverage`,
      {
        method: 'POST',
        headers,
        body,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to set leverage: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }
  }

  async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
    const params = {
      category: this.category,
      symbol,
      tradeMode: marginType === 'CROSSED' ? 0 : 1, // 0=cross, 1=isolated
      buyLeverage: '10',  // Required parameters
      sellLeverage: '10',
    };

    const { headers, body } = this.createSignedRequest(params, 'POST');
    
    const response = await fetch(
      `${this.baseURL}/v5/position/switch-mode`,
      {
        method: 'POST',
        headers,
        body,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to set margin type: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }
  }

  async setHedgeMode(enabled: boolean): Promise<void> {
    const params = {
      category: this.category,
      mode: enabled ? 3 : 0, // 0=one-way, 3=hedge
    };

    const { headers, body } = this.createSignedRequest(params, 'POST');
    
    const response = await fetch(
      `${this.baseURL}/v5/position/switch-mode`,
      {
        method: 'POST',
        headers,
        body,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to set hedge mode: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }
  }

  // ============================================================================
  // Order Management
  // ============================================================================

  async placeOrder(params: NormalizedOrderParams): Promise<NormalizedOrderResponse> {
    const orderParams: Record<string, any> = {
      category: this.category,
      symbol: params.symbol,
      side: params.side === 'BUY' ? 'Buy' : 'Sell',
      orderType: params.type === 'LIMIT' ? 'Limit' : 'Market',
      qty: (params.quantity || 0).toString(),
      timeInForce: params.timeInForce || 'GTC',
    };

    // Add price for limit orders
    if (params.type === 'LIMIT' && params.price) {
      orderParams.price = params.price.toString();
    }

    // Add position side for hedge mode
    if (params.positionSide) {
      // Bybit uses positionIdx: 0=one-way, 1=hedge Buy, 2=hedge Sell
      orderParams.positionIdx = params.positionSide === 'LONG' ? 1 : 2;
    }

    // Add reduce-only flag
    if (params.reduceOnly) {
      orderParams.reduceOnly = true;
    }

    const { headers, body } = this.createSignedRequest(orderParams, 'POST');
    
    const response = await fetch(
      `${this.baseURL}/v5/order/create`,
      {
        method: 'POST',
        headers,
        body,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to place order: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    const result = data.result;

    return {
      orderId: result.orderId,
      clientOrderId: result.orderLinkId || undefined,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      status: 'NEW',
      executedQty: '0',
      avgPrice: '0',
    };
  }

  async placeBatchOrders(orders: NormalizedOrderParams[]): Promise<{
    successes: NormalizedOrderResponse[];
    failures: { index: number; error: string; params: NormalizedOrderParams }[];
  }> {
    const successes: NormalizedOrderResponse[] = [];
    const failures: { index: number; error: string; params: NormalizedOrderParams }[] = [];

    // Bybit V5 supports batch orders
    const orderRequests = orders.map((params, index) => ({
      category: this.category,
      symbol: params.symbol,
      side: params.side === 'BUY' ? 'Buy' : 'Sell',
      orderType: params.type === 'LIMIT' ? 'Limit' : 'Market',
      qty: (params.quantity || '0'),
      price: params.price,
      timeInForce: params.timeInForce || 'GTC',
      positionIdx: params.positionSide === 'LONG' ? 1 : params.positionSide === 'SHORT' ? 2 : 0,
    }));

    const params = {
      category: this.category,
      request: orderRequests,
    };

    const { headers, body } = this.createSignedRequest(params, 'POST');
    
    const response = await fetch(
      `${this.baseURL}/v5/order/create-batch`,
      {
        method: 'POST',
        headers,
        body,
      }
    );

    if (!response.ok) {
      // All failed
      orders.forEach((order, index) => {
        failures.push({ index, error: response.statusText, params: order });
      });
      return { successes, failures };
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      orders.forEach((order, index) => {
        failures.push({ index, error: data.retMsg, params: order });
      });
      return { successes, failures };
    }

    // Process individual results
    (data.result?.list || []).forEach((result: any, index: number) => {
      const orderParams = orders[index];
      
      if (result.orderId) {
        successes.push({
          orderId: result.orderId,
          clientOrderId: result.orderLinkId,
          symbol: orderParams.symbol,
          side: orderParams.side,
          type: orderParams.type,
          status: 'NEW',
          executedQty: '0',
        });
      } else {
        failures.push({
          index,
          error: result.retMsg || 'Unknown error',
          params: orderParams,
        });
      }
    });

    return { successes, failures };
  }

  async getOrder(symbol: string, orderId: string): Promise<NormalizedOrderResponse> {
    const params = {
      category: this.category,
      symbol,
      orderId,
    };

    const { queryString, headers } = this.createSignedRequest(params);
    
    const response = await fetch(
      `${this.baseURL}/v5/order/realtime?${queryString}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch order: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    const order = data.result?.list?.[0];
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    return {
      orderId: order.orderId,
      clientOrderId: order.orderLinkId,
      symbol: order.symbol,
      side: order.side === 'Buy' ? 'BUY' : 'SELL',
      type: order.orderType === 'Limit' ? 'LIMIT' : 'MARKET',
      quantity: order.qty,
      price: order.price,
      status: this.mapOrderStatus(order.orderStatus),
      executedQty: order.cumExecQty || '0',
      avgPrice: order.avgPrice,
    };
  }

  private mapOrderStatus(bybitStatus: string): 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED' | 'REJECTED' {
    const statusMap: Record<string, 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED' | 'REJECTED'> = {
      'New': 'NEW',
      'PartiallyFilled': 'PARTIALLY_FILLED',
      'Filled': 'FILLED',
      'Cancelled': 'CANCELED',
      'Rejected': 'REJECTED',
    };
    return statusMap[bybitStatus] || 'NEW';
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const params = {
      category: this.category,
      symbol,
      orderId,
    };

    const { headers, body } = this.createSignedRequest(params, 'POST');
    
    const response = await fetch(
      `${this.baseURL}/v5/order/cancel`,
      {
        method: 'POST',
        headers,
        body,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to cancel order: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }
  }

  async cancelAllOrders(symbol?: string): Promise<void> {
    const params: Record<string, any> = {
      category: this.category,
    };

    if (symbol) {
      params.symbol = symbol;
    } else {
      params.settleCoin = 'USDT'; // Cancel all USDT futures orders
    }

    const { headers, body } = this.createSignedRequest(params, 'POST');
    
    const response = await fetch(
      `${this.baseURL}/v5/order/cancel-all`,
      {
        method: 'POST',
        headers,
        body,
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to cancel all orders: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }
  }

  async getOpenOrders(symbol?: string): Promise<any[]> {
    const params: Record<string, any> = {
      category: this.category,
    };

    if (symbol) {
      params.symbol = symbol;
    }

    const { queryString, headers } = this.createSignedRequest(params);
    
    const response = await fetch(
      `${this.baseURL}/v5/order/realtime?${queryString}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch open orders: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    return data.result?.list || [];
  }

  // ============================================================================
  // Market Data
  // ============================================================================

  async getTicker(symbol: string): Promise<NormalizedTicker> {
    const response = await fetch(
      `${this.baseURL}/v5/market/tickers?category=${this.category}&symbol=${symbol}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch ticker: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    const ticker = data.result?.list?.[0];
    if (!ticker) {
      throw new Error(`No ticker data for ${symbol}`);
    }

    return {
      symbol: ticker.symbol,
      price: ticker.lastPrice,
      bidPrice: ticker.bid1Price,
      askPrice: ticker.ask1Price,
      volume24h: ticker.volume24h,
    };
  }

  async getKlines(symbol: string, interval: string, limit: number = 500): Promise<NormalizedKline[]> {
    const response = await fetch(
      `${this.baseURL}/v5/market/kline?category=${this.category}&symbol=${symbol}&interval=${interval}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch klines: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    return (data.result?.list || []).map((k: any) => ({
      openTime: parseInt(k[0]),
      open: k[1],
      high: k[2],
      low: k[3],
      close: k[4],
      volume: k[5],
      closeTime: parseInt(k[0]) + this.getIntervalMs(interval),
    }));
  }

  async getTrades(params: {
    symbol: string;
    startTime?: number;
    endTime?: number;
    fromId?: number;
    limit?: number;
  }): Promise<NormalizedTrade[]> {
    const requestParams: Record<string, any> = {
      category: this.category,
      symbol: params.symbol,
      limit: params.limit || 500,
    };

    if (params.startTime) requestParams.startTime = params.startTime;
    if (params.endTime) requestParams.endTime = params.endTime;

    const { queryString, headers } = this.createSignedRequest(requestParams);
    
    const response = await fetch(
      `${this.baseURL}/v5/execution/list?${queryString}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch trades: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    return (data.result?.list || []).map((t: any) => ({
      id: t.execId,
      symbol: t.symbol,
      orderId: t.orderId,
      side: t.side === 'Buy' ? 'BUY' as const : 'SELL' as const,
      price: t.execPrice,
      qty: t.execQty,
      commission: t.execFee,
      commissionAsset: 'USDT',
      time: parseInt(t.execTime),
      buyer: t.side === 'Buy',
      maker: t.isMaker,
      positionSide: t.positionIdx === 1 ? 'LONG' : t.positionIdx === 2 ? 'SHORT' : 'BOTH',
      realizedPnl: t.closedSize ? t.closedPnl : undefined,
    }));
  }

  async getIncome(params: {
    symbol?: string;
    incomeType?: 'COMMISSION' | 'FUNDING_FEE' | 'REALIZED_PNL' | 'TRANSFER';
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<{
    symbol: string;
    incomeType: string;
    income: string;
    asset: string;
    time: number;
    tranId: string;
    tradeId?: string;
  }[]> {
    // Map income types to Bybit types
    const typeMap: Record<string, string> = {
      'COMMISSION': 'TradingFee',
      'FUNDING_FEE': 'Funding',
      'REALIZED_PNL': 'RealisedPNL',
      'TRANSFER': 'Transfer',
    };

    const requestParams: Record<string, any> = {
      accountType: 'UNIFIED',
      category: this.category,
      limit: params.limit || 50,
    };

    if (params.symbol) requestParams.symbol = params.symbol;
    if (params.incomeType) requestParams.type = typeMap[params.incomeType];
    if (params.startTime) requestParams.startTime = params.startTime;
    if (params.endTime) requestParams.endTime = params.endTime;

    const { queryString, headers } = this.createSignedRequest(requestParams);
    
    const response = await fetch(
      `${this.baseURL}/v5/account/transaction-log?${queryString}`,
      { headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch income: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    return (data.result?.list || []).map((item: any) => ({
      symbol: item.symbol || '',
      incomeType: item.type,
      income: item.cashFlow,
      asset: item.coin,
      time: parseInt(item.createdTime),
      tranId: item.transactionLogId || item.id || '',
      tradeId: item.tradeId,
    }));
  }

  async getExchangeInfo(): Promise<NormalizedExchangeInfo> {
    const response = await fetch(
      `${this.baseURL}/v5/market/instruments-info?category=${this.category}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch exchange info: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    const symbols = (data.result?.list || []).map((s: any) => {
      const lotSizeFilter = s.lotSizeFilter || {};
      const priceFilter = s.priceFilter || {};

      return {
        symbol: s.symbol,
        baseAsset: s.baseCoin,
        quoteAsset: s.quoteCoin,
        pricePrecision: this.getPrecisionFromTickSize(priceFilter.tickSize || '0.01'),
        quantityPrecision: this.getPrecisionFromTickSize(lotSizeFilter.qtyStep || '0.001'),
        minNotional: (parseFloat(lotSizeFilter.minOrderQty || '0.001') * parseFloat(priceFilter.tickSize || '0.01')).toString(),
        minQty: lotSizeFilter.minOrderQty || '0.001',
        maxQty: lotSizeFilter.maxOrderQty || '1000000',
        stepSize: lotSizeFilter.qtyStep || '0.001',
      };
    });

    return { symbols };
  }

  // ============================================================================
  // Exchange Info Caching
  // ============================================================================

  async fetchExchangeInfo(): Promise<void> {
    if (this.exchangeInfoFetched) return;

    try {
      const info = await this.getExchangeInfo();
      
      info.symbols.forEach(symbol => {
        this.symbolPrecisionCache.set(symbol.symbol, {
          quantityPrecision: symbol.quantityPrecision,
          pricePrecision: symbol.pricePrecision,
          stepSize: symbol.stepSize,
          tickSize: this.getTickSizeFromPrecision(symbol.pricePrecision),
          minNotional: parseFloat(symbol.minNotional),
        });
      });

      this.exchangeInfoFetched = true;
      console.log(`✅ Bybit exchange info cached for ${info.symbols.length} symbols`);
    } catch (error) {
      console.error('⚠️ Failed to fetch Bybit exchange info:', error);
    }
  }

  async getPrecision(symbol: string): Promise<{ quantity: number; price: number }> {
    const cached = this.symbolPrecisionCache.get(symbol);
    if (!cached) {
      // If not cached, fetch exchange info and try again
      await this.fetchExchangeInfo();
      const retried = this.symbolPrecisionCache.get(symbol);
      if (!retried) {
        throw new Error(`Symbol ${symbol} not found in exchange info`);
      }
      return {
        quantity: retried.quantityPrecision,
        price: retried.pricePrecision,
      };
    }

    return {
      quantity: cached.quantityPrecision,
      price: cached.pricePrecision,
    };
  }

  async getMinNotional(symbol: string): Promise<number> {
    const cached = this.symbolPrecisionCache.get(symbol);
    if (!cached) {
      await this.fetchExchangeInfo();
      const retried = this.symbolPrecisionCache.get(symbol);
      return retried?.minNotional || 10; // Bybit default ~$10
    }
    return cached.minNotional;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private getPrecisionFromTickSize(tickSize: string): number {
    const decimals = tickSize.split('.')[1];
    return decimals ? decimals.length : 0;
  }

  private getTickSizeFromPrecision(precision: number): string {
    if (precision === 0) return '1';
    return '0.' + '0'.repeat(precision - 1) + '1';
  }

  private getIntervalMs(interval: string): number {
    const intervals: Record<string, number> = {
      '1': 60000,
      '3': 180000,
      '5': 300000,
      '15': 900000,
      '30': 1800000,
      '60': 3600000,
      '120': 7200000,
      '240': 14400000,
      '360': 21600000,
      '720': 43200000,
      'D': 86400000,
      'W': 604800000,
    };

    return intervals[interval] || 60000;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/v5/market/time`);
      const data = await response.json();
      return data.retCode === 0;
    } catch {
      return false;
    }
  }
}
