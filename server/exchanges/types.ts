/**
 * Exchange Adapter Types
 * 
 * Defines standardized interfaces for multi-exchange support.
 * Each exchange (Aster DEX, Bybit, etc.) implements these interfaces
 * to provide a consistent API for the trading system.
 */

// ============================================================================
// Normalized Types (Exchange-Agnostic)
// ============================================================================

export type ExchangeType = 'aster' | 'bybit';

export interface NormalizedPosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: string; // Quantity
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  leverage: string;
  marginType: 'ISOLATED' | 'CROSSED';
  positionSide?: 'LONG' | 'SHORT' | 'BOTH'; // For hedge mode
}

export interface NormalizedAssetBalance {
  asset: string;
  walletBalance: string;
  availableBalance: string;
  crossMargin: string;
  isolatedMargin: string;
}

export interface NormalizedAccountInfo {
  totalBalance: string;
  availableBalance: string;
  totalMarginUsed: string;
  totalUnrealizedPnl: string;
  assets: NormalizedAssetBalance[]; // Per-asset balance breakdown
  positions: NormalizedPosition[];
}

export interface NormalizedOrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  quantity?: string; // Optional for closePosition orders
  price?: string; // Required for LIMIT orders
  stopPrice?: string; // Required for STOP/TP orders
  positionSide?: 'LONG' | 'SHORT' | 'BOTH'; // For hedge mode
  reduceOnly?: boolean; // For closing positions
  closePosition?: boolean; // Close entire position when triggered
  workingType?: 'MARK_PRICE' | 'CONTRACT_PRICE'; // Price type for stop orders
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
}

export interface NormalizedOrderResponse {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  quantity?: string;
  price?: string;
  stopPrice?: string;
  status: 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED' | 'REJECTED';
  executedQty: string;
  avgPrice?: string;
  positionSide?: 'LONG' | 'SHORT' | 'BOTH';
}

export interface NormalizedTicker {
  symbol: string;
  price: string;
  bidPrice: string;
  askPrice: string;
  volume24h: string;
}

export interface NormalizedKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
}

export interface NormalizedTrade {
  id: string;
  symbol: string;
  orderId: string;
  side: 'BUY' | 'SELL';
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  buyer: boolean;
  maker: boolean;
  positionSide?: 'LONG' | 'SHORT' | 'BOTH';
  realizedPnl?: string;
}

export interface NormalizedExchangeInfo {
  symbols: {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    pricePrecision: number;
    quantityPrecision: number;
    minNotional: string;
    minQty: string;
    maxQty: string;
    stepSize: string;
  }[];
}

// ============================================================================
// WebSocket Event Types (Normalized)
// ============================================================================

export interface NormalizedAccountUpdate {
  balances: {
    asset: string;
    walletBalance: string;
    availableBalance: string;
  }[];
  positions: NormalizedPosition[];
}

export interface NormalizedOrderUpdate {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  status: 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED' | 'REJECTED';
  quantity?: string;
  price?: string;
  stopPrice?: string;
  executedQty: string;
  avgPrice?: string;
  positionSide?: 'LONG' | 'SHORT' | 'BOTH';
  updateTime: number;
}

export interface NormalizedTradeUpdate {
  id: string;
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  positionSide?: 'LONG' | 'SHORT' | 'BOTH';
  realizedPnl?: string;
}

export interface NormalizedLiquidation {
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: string;
  price: string;
  value: string;
  timestamp: number;
  eventTimestamp?: string; // Exchange-specific event ID
}

// ============================================================================
// IExchangeAdapter - REST API Interface
// ============================================================================

export interface IExchangeAdapter {
  readonly exchangeType: ExchangeType;
  readonly supportsHedgeMode: boolean;

  // Authentication
  generateSignature(queryString: string, timestamp: number): string;

  // Account & Position Management
  getAccountInfo(): Promise<NormalizedAccountInfo>;
  getPositions(): Promise<NormalizedPosition[]>;
  setLeverage(symbol: string, leverage: number): Promise<void>;
  setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void>;
  setHedgeMode(enabled: boolean): Promise<void>;

  // Order Management
  placeOrder(params: NormalizedOrderParams): Promise<NormalizedOrderResponse>;
  placeBatchOrders(orders: NormalizedOrderParams[]): Promise<{
    successes: NormalizedOrderResponse[];
    failures: { index: number; error: string; params: NormalizedOrderParams }[];
  }>;
  cancelOrder(symbol: string, orderId: string): Promise<void>;
  cancelAllOrders(symbol: string): Promise<void>;
  getOrder(symbol: string, orderId: string): Promise<NormalizedOrderResponse>;
  getOpenOrders(symbol?: string): Promise<NormalizedOrderResponse[]>;

  // Market Data
  getTicker(symbol: string): Promise<NormalizedTicker>;
  getKlines(symbol: string, interval: string, limit?: number): Promise<NormalizedKline[]>;
  getExchangeInfo(): Promise<NormalizedExchangeInfo>;

  // Historical Data
  getTrades(params: {
    symbol: string;
    startTime?: number;
    endTime?: number;
    fromId?: number;
    limit?: number;
  }): Promise<NormalizedTrade[]>;

  getIncome(params: {
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
  }[]>;

  // Helper Methods
  getMinNotional(symbol: string): Promise<number>;
  getPrecision(symbol: string): Promise<{ price: number; quantity: number }>;
}

// ============================================================================
// IExchangeStream - WebSocket Interface
// ============================================================================

export interface IExchangeStream {
  readonly exchangeType: ExchangeType;
  readonly isConnected: boolean;

  // Connection Management
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;

  // Event Subscription
  onAccountUpdate(callback: (update: NormalizedAccountUpdate) => void): void;
  onOrderUpdate(callback: (update: NormalizedOrderUpdate) => void): void;
  onTradeUpdate(callback: (update: NormalizedTradeUpdate) => void): void;
  onError(callback: (error: Error) => void): void;
  onDisconnect(callback: () => void): void;
  onReconnect(callback: () => void): void;

  // Public Data Streams (optional for some exchanges)
  subscribeToLiquidations?(callback: (liquidation: NormalizedLiquidation) => void): Promise<void>;
  unsubscribeFromLiquidations?(): Promise<void>;
  subscribeToTicker?(symbol: string, callback: (ticker: NormalizedTicker) => void): Promise<void>;
  unsubscribeFromTicker?(symbol: string): Promise<void>;
  subscribeToOrderBook?(symbol: string, callback: (orderbook: any) => void): Promise<void>;
  unsubscribeFromOrderBook?(symbol: string): Promise<void>;
}

// ============================================================================
// Exchange Configuration
// ============================================================================

export interface ExchangeConfig {
  apiKey: string;
  secretKey: string;
  testnet?: boolean;
  baseURL?: string;
  wsURL?: string;
}

export interface ExchangeCredentials {
  aster?: ExchangeConfig;
  bybit?: ExchangeConfig;
}

// ============================================================================
// Factory & Registry Types
// ============================================================================

export interface IExchangeFactory {
  createAdapter(exchangeType: ExchangeType, config: ExchangeConfig): IExchangeAdapter;
  createStream(exchangeType: ExchangeType, config: ExchangeConfig): IExchangeStream;
}

export interface IExchangeRegistry {
  registerExchange(exchangeType: ExchangeType, config: ExchangeConfig): void;
  getAdapter(exchangeType: ExchangeType): IExchangeAdapter;
  getStream(exchangeType: ExchangeType): IExchangeStream;
  hasExchange(exchangeType: ExchangeType): boolean;
  getActiveExchange(): ExchangeType | null;
  setActiveExchange(exchangeType: ExchangeType): void;
}
