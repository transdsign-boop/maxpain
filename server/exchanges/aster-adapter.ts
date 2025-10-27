/**
 * Aster DEX Exchange Adapter
 * 
 * Implements IExchangeAdapter for Aster DEX futures trading.
 * Handles all REST API calls, authentication, and response normalization.
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
import { rateLimiter } from '../rate-limiter';

export class AsterExchangeAdapter implements IExchangeAdapter {
  readonly exchangeType: ExchangeType = 'aster';
  readonly supportsHedgeMode: boolean = true;

  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly secretKey: string;

  // Cache for exchange info
  private symbolPrecisionCache = new Map<string, {
    quantityPrecision: number;
    pricePrecision: number;
    stepSize: string;
    tickSize: string;
    minNotional: number;
  }>();
  private exchangeInfoFetched = false;
  private static exchangeInfoCache: any = null;
  private static exchangeInfoCacheTime: number = 0;
  private static readonly CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours

  constructor(config: ExchangeConfig) {
    this.baseURL = config.baseURL || 'https://fapi.asterdex.com';
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;

    // Load from cache instead of fetching immediately
    this.loadCachedExchangeInfo();
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  generateSignature(queryString: string, timestamp: number): string {
    return createHmac('sha256', this.secretKey)
      .update(queryString)
      .digest('hex');
  }

  private createSignedRequest(params: Record<string, any>): { queryString: string; signature: string } {
    const timestamp = Date.now();
    const allParams = { ...params, timestamp, recvWindow: 5000 };
    
    const queryString = Object.entries(allParams)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    
    const signature = this.generateSignature(queryString, timestamp);
    
    return { queryString, signature };
  }

  // ============================================================================
  // Account & Position Management
  // ============================================================================

  async getAccountInfo(): Promise<NormalizedAccountInfo> {
    const { queryString, signature } = this.createSignedRequest({});
    
    const response = await fetch(
      `${this.baseURL}/fapi/v2/account?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': this.apiKey } }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch account info: ${response.statusText}`);
    }

    const data = await response.json();

    // Normalize asset balances
    const assets: NormalizedAssetBalance[] = (data.assets || []).map((asset: any) => ({
      asset: asset.asset,
      walletBalance: asset.walletBalance,
      availableBalance: asset.availableBalance,
      crossMargin: asset.crossWalletBalance || '0',
      isolatedMargin: asset.marginBalance || '0',
    }));

    // Fetch positions separately
    const positions = await this.getPositions();

    return {
      totalBalance: data.totalWalletBalance || '0',
      availableBalance: data.availableBalance || '0',
      totalMarginUsed: data.totalMarginBalance || '0',
      totalUnrealizedPnl: data.totalUnrealizedProfit || '0',
      assets,
      positions,
    };
  }

  async getPositions(): Promise<NormalizedPosition[]> {
    const { queryString, signature } = this.createSignedRequest({});
    
    const response = await fetch(
      `${this.baseURL}/fapi/v2/positionRisk?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': this.apiKey } }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch positions: ${response.statusText}`);
    }

    const data = await response.json();

    return (data || [])
      .filter((pos: any) => parseFloat(pos.positionAmt) !== 0)
      .map((pos: any) => ({
        symbol: pos.symbol,
        side: parseFloat(pos.positionAmt) > 0 ? 'LONG' : 'SHORT',
        size: Math.abs(parseFloat(pos.positionAmt)).toString(),
        entryPrice: pos.entryPrice,
        markPrice: pos.markPrice,
        unrealizedPnl: pos.unRealizedProfit,
        leverage: pos.leverage,
        marginType: pos.marginType === 'cross' ? 'CROSSED' : 'ISOLATED',
        positionSide: pos.positionSide || 'BOTH',
      }));
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    // Symbol-specific leverage limits
    const symbolLeverageLimits: Record<string, number> = {
      '4USDT': 5,
      'COAIUSDT': 5,
      'AIAUSDT': 5,
      'XPLUSDT': 5,
    };

    const cappedLeverage = symbolLeverageLimits[symbol] 
      ? Math.min(leverage, symbolLeverageLimits[symbol])
      : leverage;

    if (cappedLeverage !== leverage) {
      console.log(`⚙️ Capping ${symbol} leverage from ${leverage}x to ${cappedLeverage}x (exchange limit)`);
    }

    const { queryString, signature } = this.createSignedRequest({
      symbol,
      leverage: cappedLeverage,
    });

    const response = await fetch(
      `${this.baseURL}/fapi/v1/leverage?${queryString}&signature=${signature}`,
      {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': this.apiKey },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to set leverage: ${errorText}`);
    }
  }

  async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
    const { queryString, signature } = this.createSignedRequest({
      symbol,
      marginType,
    });

    const response = await fetch(
      `${this.baseURL}/fapi/v1/marginType?${queryString}&signature=${signature}`,
      {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': this.apiKey },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      
      // Ignore error if margin type is already set correctly
      if (errorText.includes('-4046') || errorText.includes('No need to change margin type')) {
        console.log(`✅ ${symbol} margin already set to ${marginType}`);
        return;
      }
      
      throw new Error(`Failed to set margin type: ${errorText}`);
    }
  }

  async setHedgeMode(enabled: boolean): Promise<void> {
    const { queryString, signature } = this.createSignedRequest({
      dualSidePosition: enabled ? 'true' : 'false',
    });

    const response = await fetch(
      `${this.baseURL}/fapi/v1/positionSide/dual?${queryString}&signature=${signature}`,
      {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': this.apiKey },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to set hedge mode: ${errorText}`);
    }
  }

  // ============================================================================
  // Order Management
  // ============================================================================

  async placeOrder(params: NormalizedOrderParams): Promise<NormalizedOrderResponse> {
    const orderParams: Record<string, any> = {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
    };

    // Add positionSide if specified (hedge mode)
    if (params.positionSide) {
      orderParams.positionSide = params.positionSide;
    }

    // Add type-specific parameters
    if (params.type === 'LIMIT') {
      orderParams.price = this.roundPrice(params.symbol, parseFloat(params.price!));
      orderParams.quantity = this.roundQuantity(params.symbol, parseFloat(params.quantity!));
      orderParams.timeInForce = params.timeInForce || 'GTC';
    } else if (params.type === 'MARKET') {
      orderParams.quantity = this.roundQuantity(params.symbol, parseFloat(params.quantity!));
    } else if (params.type === 'STOP_MARKET' || params.type === 'TAKE_PROFIT_MARKET') {
      orderParams.stopPrice = this.roundPrice(params.symbol, parseFloat(params.stopPrice!));
      orderParams.workingType = params.workingType || 'CONTRACT_PRICE';
      
      if (params.closePosition) {
        orderParams.closePosition = 'true';
      } else if (params.quantity) {
        orderParams.quantity = this.roundQuantity(params.symbol, parseFloat(params.quantity));
      }
    }

    if (params.reduceOnly) {
      orderParams.reduceOnly = 'true';
    }

    const { queryString, signature } = this.createSignedRequest(orderParams);

    const response = await fetch(
      `${this.baseURL}/fapi/v1/order?${queryString}&signature=${signature}`,
      {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': this.apiKey },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to place order: ${errorText}`);
    }

    const data = await response.json();

    return {
      orderId: data.orderId.toString(),
      clientOrderId: data.clientOrderId,
      symbol: data.symbol,
      side: data.side,
      type: data.type,
      quantity: data.origQty,
      price: data.price,
      stopPrice: data.stopPrice,
      status: data.status,
      executedQty: data.executedQty,
      avgPrice: data.avgPrice,
      positionSide: data.positionSide,
    };
  }

  async placeBatchOrders(orders: NormalizedOrderParams[]): Promise<{
    successes: NormalizedOrderResponse[];
    failures: { index: number; error: string; params: NormalizedOrderParams }[];
  }> {
    if (orders.length === 0 || orders.length > 5) {
      throw new Error('Batch orders must contain 1-5 orders');
    }

    const batchOrders = orders.map(order => {
      const orderParams: Record<string, any> = {
        symbol: order.symbol,
        side: order.side,
        type: order.type,
      };

      if (order.positionSide) {
        orderParams.positionSide = order.positionSide;
      }

      if (order.type === 'LIMIT') {
        orderParams.price = this.roundPrice(order.symbol, parseFloat(order.price!));
        orderParams.quantity = this.roundQuantity(order.symbol, parseFloat(order.quantity!));
        orderParams.timeInForce = order.timeInForce || 'GTC';
      } else if (order.type === 'MARKET') {
        orderParams.quantity = this.roundQuantity(order.symbol, parseFloat(order.quantity!));
      } else if (order.type === 'STOP_MARKET' || order.type === 'TAKE_PROFIT_MARKET') {
        orderParams.stopPrice = this.roundPrice(order.symbol, parseFloat(order.stopPrice!));
        orderParams.workingType = order.workingType || 'CONTRACT_PRICE';
        
        if (order.closePosition) {
          orderParams.closePosition = 'true';
        } else if (order.quantity) {
          orderParams.quantity = this.roundQuantity(order.symbol, parseFloat(order.quantity));
        }
      }

      if (order.reduceOnly) {
        orderParams.reduceOnly = 'true';
      }

      return orderParams;
    });

    const timestamp = Date.now();
    const batchListParam = `[${batchOrders.map(o => JSON.stringify(o)).join(',')}]`;
    const queryParams: Record<string, any> = {
      batchOrders: batchListParam,
      timestamp,
      recvWindow: 5000,
    };

    const queryString = Object.entries(queryParams)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');

    const signature = this.generateSignature(queryString, timestamp);

    const response = await fetch(
      `${this.baseURL}/fapi/v1/batchOrders?${queryString}&signature=${signature}`,
      {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': this.apiKey },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to place batch orders: ${errorText}`);
    }

    const results = await response.json();

    const successes: NormalizedOrderResponse[] = [];
    const failures: { index: number; error: string; params: NormalizedOrderParams }[] = [];

    results.forEach((result: any, index: number) => {
      if (result.code && result.code !== 0) {
        failures.push({
          index,
          error: result.msg || result.error || 'Unknown error',
          params: orders[index],
        });
      } else {
        successes.push({
          orderId: result.orderId.toString(),
          clientOrderId: result.clientOrderId,
          symbol: result.symbol,
          side: result.side,
          type: result.type,
          quantity: result.origQty,
          price: result.price,
          stopPrice: result.stopPrice,
          status: result.status,
          executedQty: result.executedQty,
          avgPrice: result.avgPrice,
          positionSide: result.positionSide,
        });
      }
    });

    return { successes, failures };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const { queryString, signature } = this.createSignedRequest({
      symbol,
      orderId,
    });

    const response = await fetch(
      `${this.baseURL}/fapi/v1/order?${queryString}&signature=${signature}`,
      {
        method: 'DELETE',
        headers: { 'X-MBX-APIKEY': this.apiKey },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to cancel order: ${errorText}`);
    }
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const { queryString, signature } = this.createSignedRequest({ symbol });

    const response = await fetch(
      `${this.baseURL}/fapi/v1/allOpenOrders?${queryString}&signature=${signature}`,
      {
        method: 'DELETE',
        headers: { 'X-MBX-APIKEY': this.apiKey },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to cancel all orders: ${errorText}`);
    }
  }

  async getOrder(symbol: string, orderId: string): Promise<NormalizedOrderResponse> {
    const { queryString, signature } = this.createSignedRequest({
      symbol,
      orderId,
    });

    const response = await fetch(
      `${this.baseURL}/fapi/v1/order?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': this.apiKey } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get order: ${errorText}`);
    }

    const data = await response.json();

    return {
      orderId: data.orderId.toString(),
      clientOrderId: data.clientOrderId,
      symbol: data.symbol,
      side: data.side,
      type: data.type,
      quantity: data.origQty,
      price: data.price,
      stopPrice: data.stopPrice,
      status: data.status,
      executedQty: data.executedQty,
      avgPrice: data.avgPrice,
      positionSide: data.positionSide,
    };
  }

  async getOpenOrders(symbol?: string): Promise<NormalizedOrderResponse[]> {
    const params: Record<string, any> = {};
    if (symbol) {
      params.symbol = symbol;
    }

    const { queryString, signature } = this.createSignedRequest(params);

    const response = await fetch(
      `${this.baseURL}/fapi/v1/openOrders?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': this.apiKey } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get open orders: ${errorText}`);
    }

    const data = await response.json();

    return (data || []).map((order: any) => ({
      orderId: order.orderId.toString(),
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.origQty,
      price: order.price,
      stopPrice: order.stopPrice,
      status: order.status,
      executedQty: order.executedQty,
      avgPrice: order.avgPrice,
      positionSide: order.positionSide,
    }));
  }

  // ============================================================================
  // Market Data
  // ============================================================================

  async getTicker(symbol: string): Promise<NormalizedTicker> {
    const response = await fetch(
      `${this.baseURL}/fapi/v1/ticker/price?symbol=${symbol}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch ticker: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      symbol: data.symbol,
      price: data.price,
      bidPrice: data.bidPrice || data.price,
      askPrice: data.askPrice || data.price,
      volume24h: data.volume || '0',
    };
  }

  async getKlines(symbol: string, interval: string, limit: number = 500): Promise<NormalizedKline[]> {
    const response = await fetch(
      `${this.baseURL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch klines: ${response.statusText}`);
    }

    const data = await response.json();

    return data.map((kline: any[]) => ({
      openTime: kline[0],
      open: kline[1],
      high: kline[2],
      low: kline[3],
      close: kline[4],
      volume: kline[5],
      closeTime: kline[6],
    }));
  }

  async getExchangeInfo(): Promise<NormalizedExchangeInfo> {
    // Use rate limiter to prevent 429 errors
    const response = await rateLimiter.fetch(`${this.baseURL}/fapi/v1/exchangeInfo`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch exchange info: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      symbols: (data.symbols || []).map((symbol: any) => {
        const lotSizeFilter = symbol.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
        const priceFilter = symbol.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
        const minNotionalFilter = symbol.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL');

        return {
          symbol: symbol.symbol,
          baseAsset: symbol.baseAsset,
          quoteAsset: symbol.quoteAsset,
          pricePrecision: symbol.pricePrecision || 8,
          quantityPrecision: symbol.quantityPrecision || 8,
          minNotional: minNotionalFilter?.notional || '5.0',
          minQty: lotSizeFilter?.minQty || '0.001',
          maxQty: lotSizeFilter?.maxQty || '100000',
          stepSize: lotSizeFilter?.stepSize || '0.001',
        };
      }),
    };
  }

  // ============================================================================
  // Historical Data
  // ============================================================================

  async getTrades(params: {
    symbol: string;
    startTime?: number;
    endTime?: number;
    fromId?: number;
    limit?: number;
  }): Promise<NormalizedTrade[]> {
    const queryParams: Record<string, any> = {
      symbol: params.symbol,
    };

    if (params.startTime) queryParams.startTime = params.startTime;
    if (params.endTime) queryParams.endTime = params.endTime;
    if (params.fromId) queryParams.fromId = params.fromId;
    if (params.limit) queryParams.limit = params.limit;

    const { queryString, signature } = this.createSignedRequest(queryParams);

    const response = await fetch(
      `${this.baseURL}/fapi/v1/userTrades?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': this.apiKey } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch trades: ${errorText}`);
    }

    const data = await response.json();

    return (data || []).map((trade: any) => ({
      id: trade.id.toString(),
      symbol: trade.symbol,
      orderId: trade.orderId.toString(),
      side: trade.side,
      price: trade.price,
      qty: trade.qty,
      commission: trade.commission,
      commissionAsset: trade.commissionAsset,
      time: trade.time,
      buyer: trade.buyer,
      maker: trade.maker,
      positionSide: trade.positionSide,
      realizedPnl: trade.realizedPnl,
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
    const queryParams: Record<string, any> = {};

    if (params.symbol) queryParams.symbol = params.symbol;
    if (params.incomeType) queryParams.incomeType = params.incomeType;
    if (params.startTime) queryParams.startTime = params.startTime;
    if (params.endTime) queryParams.endTime = params.endTime;
    if (params.limit) queryParams.limit = params.limit;

    const { queryString, signature } = this.createSignedRequest(queryParams);

    const response = await fetch(
      `${this.baseURL}/fapi/v1/income?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': this.apiKey } }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch income: ${errorText}`);
    }

    const data = await response.json();

    return (data || []).map((income: any) => ({
      symbol: income.symbol,
      incomeType: income.incomeType,
      income: income.income,
      asset: income.asset,
      time: income.time,
      tranId: income.tranId,
      tradeId: income.tradeId,
    }));
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  async getMinNotional(symbol: string): Promise<number> {
    await this.ensureExchangeInfo();
    const info = this.symbolPrecisionCache.get(symbol);
    return info?.minNotional || 5.0;
  }

  async getPrecision(symbol: string): Promise<{ price: number; quantity: number }> {
    await this.ensureExchangeInfo();
    const info = this.symbolPrecisionCache.get(symbol);
    return {
      price: info?.pricePrecision || 8,
      quantity: info?.quantityPrecision || 8,
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async ensureExchangeInfo(): Promise<void> {
    if (this.exchangeInfoFetched) return;
    
    // Check if cache is still valid
    const cacheAge = Date.now() - AsterExchangeAdapter.exchangeInfoCacheTime;
    if (AsterExchangeAdapter.exchangeInfoCache && cacheAge < AsterExchangeAdapter.CACHE_DURATION_MS) {
      this.loadCachedExchangeInfo();
      return;
    }
    
    await this.fetchExchangeInfo();
  }

  private loadCachedExchangeInfo(): void {
    const cacheAge = Date.now() - AsterExchangeAdapter.exchangeInfoCacheTime;
    
    if (AsterExchangeAdapter.exchangeInfoCache && cacheAge < AsterExchangeAdapter.CACHE_DURATION_MS) {
      const exchangeInfo = AsterExchangeAdapter.exchangeInfoCache;
      
      for (const symbol of exchangeInfo.symbols) {
        const tickSize = '0.01';
        this.symbolPrecisionCache.set(symbol.symbol, {
          quantityPrecision: symbol.quantityPrecision,
          pricePrecision: symbol.pricePrecision,
          stepSize: symbol.stepSize,
          tickSize,
          minNotional: parseFloat(symbol.minNotional),
        });
      }
      
      this.exchangeInfoFetched = true;
      const ageMinutes = Math.floor(cacheAge / 60000);
      console.log(`✅ [Aster] Loaded precision info from cache (age: ${ageMinutes}m, ${this.symbolPrecisionCache.size} symbols)`);
    }
  }

  private async fetchExchangeInfo(): Promise<void> {
    try {
      const exchangeInfo = await this.getExchangeInfo();

      // Cache it for future instances
      AsterExchangeAdapter.exchangeInfoCache = exchangeInfo;
      AsterExchangeAdapter.exchangeInfoCacheTime = Date.now();

      for (const symbol of exchangeInfo.symbols) {
        const tickSize = '0.01';

        this.symbolPrecisionCache.set(symbol.symbol, {
          quantityPrecision: symbol.quantityPrecision,
          pricePrecision: symbol.pricePrecision,
          stepSize: symbol.stepSize,
          tickSize,
          minNotional: parseFloat(symbol.minNotional),
        });
      }

      this.exchangeInfoFetched = true;
      console.log(`✅ [Aster] Fetched and cached precision info for ${this.symbolPrecisionCache.size} symbols`);
    } catch (error) {
      console.error('❌ [Aster] Error fetching exchange info:', error);

      // CRITICAL: Set exchangeInfoFetched = true even on error to prevent retry storms
      // Use safe fallback defaults for precision (set in getPrecision/getMinNotional)
      this.exchangeInfoFetched = true;
      console.warn('⚠️ [Aster] Using fallback precision defaults due to fetch error');
    }
  }

  private roundPrice(symbol: string, price: number): number {
    const info = this.symbolPrecisionCache.get(symbol);
    if (!info) return price;

    const tickSize = parseFloat(info.tickSize);
    return Math.round(price / tickSize) * tickSize;
  }

  private roundQuantity(symbol: string, quantity: number): number {
    const info = this.symbolPrecisionCache.get(symbol);
    if (!info) return quantity;

    const stepSize = parseFloat(info.stepSize);
    return Math.floor(quantity / stepSize) * stepSize;
  }
}
