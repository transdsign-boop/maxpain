import { RestClientV5 } from 'bybit-api';

/**
 * Bybit API Client
 * 
 * Wrapper for Bybit API with HMAC-SHA256 authentication.
 * Supports both Demo Trading (api-demo.bybit.com) and Testnet (api-testnet.bybit.com).
 */
export class BybitClient {
  private client: RestClientV5;
  private apiKey: string;
  private apiSecret: string;
  private endpoint: 'demo' | 'testnet';

  constructor(apiKey: string, apiSecret: string, endpoint: 'demo' | 'testnet' = 'demo') {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.endpoint = endpoint;

    // Initialize REST client
    // Note: The bybit-api library uses 'testnet: true' for testnet.bybit.com
    // For demo.bybit.com, we need to use 'demoTrading: true'
    if (endpoint === 'demo') {
      this.client = new RestClientV5({
        key: apiKey,
        secret: apiSecret,
        testnet: false,
        demoTrading: true, // Use demo trading environment
      });
    } else {
      this.client = new RestClientV5({
        key: apiKey,
        secret: apiSecret,
        testnet: true, // Use testnet environment
      });
    }
  }

  /**
   * Test connection and get account info
   * Returns wallet balance for USDT
   */
  async testConnection(): Promise<{ success: boolean; balance?: string; error?: string }> {
    try {
      const response = await this.client.getWalletBalance({
        accountType: 'UNIFIED', // Unified trading account
      });

      if (response.retCode !== 0) {
        return {
          success: false,
          error: response.retMsg || 'Failed to connect to Bybit',
        };
      }

      // Extract USDT balance
      const usdtCoin = response.result?.list?.[0]?.coin?.find(c => c.coin === 'USDT');
      const balance = usdtCoin?.walletBalance || '0';

      return {
        success: true,
        balance,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Connection test failed',
      };
    }
  }

  /**
   * Get wallet balance for USDT
   */
  async getBalance(): Promise<{ balance: string; availableBalance: string }> {
    const response = await this.client.getWalletBalance({
      accountType: 'UNIFIED',
    });

    if (response.retCode !== 0) {
      throw new Error(response.retMsg || 'Failed to get balance');
    }

    const usdtCoin = response.result?.list?.[0]?.coin?.find(c => c.coin === 'USDT');
    
    return {
      balance: usdtCoin?.walletBalance || '0',
      availableBalance: usdtCoin?.availableToWithdraw || '0',
    };
  }

  /**
   * Place a futures order on Bybit testnet
   * @param params Order parameters
   */
  async placeOrder(params: {
    symbol: string; // e.g., "BTCUSDT" (no dash)
    side: 'Buy' | 'Sell'; // Capitalized
    orderType: 'Market' | 'Limit';
    qty: string;
    price?: string; // Required for limit orders
    leverage?: number;
    reduceOnly?: boolean;
    positionIdx?: 0 | 1 | 2; // 0=one-way, 1=buy hedge, 2=sell hedge
  }) {
    try {
      const orderParams: any = {
        category: 'linear', // USDT perpetuals
        symbol: params.symbol,
        side: params.side,
        orderType: params.orderType,
        qty: params.qty,
        positionIdx: params.positionIdx ?? 0, // Default to one-way mode
      };

      // Add price for limit orders
      if (params.orderType === 'Limit' && params.price) {
        orderParams.price = params.price;
        orderParams.timeInForce = 'GTC'; // Good till cancelled
      }

      // Add reduce-only flag if specified
      if (params.reduceOnly) {
        orderParams.reduceOnly = true;
      }

      const response = await this.client.submitOrder(orderParams);

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Order placement failed');
      }

      return {
        orderId: response.result?.orderId,
        orderLinkId: response.result?.orderLinkId,
      };
    } catch (error: any) {
      throw new Error(`Bybit order failed: ${error.message}`);
    }
  }

  /**
   * Set leverage for a symbol
   */
  async setLeverage(symbol: string, leverage: number) {
    try {
      const response = await this.client.setLeverage({
        category: 'linear',
        symbol,
        buyLeverage: leverage.toString(),
        sellLeverage: leverage.toString(),
      });

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to set leverage');
      }

      return true;
    } catch (error: any) {
      throw new Error(`Failed to set leverage: ${error.message}`);
    }
  }

  /**
   * Set take profit and stop loss for a position
   */
  async setTradingStop(params: {
    symbol: string;
    side: 'long' | 'short';
    takeProfit?: string;
    stopLoss?: string;
    positionIdx?: 0 | 1 | 2;
  }) {
    try {
      const tpslParams: any = {
        category: 'linear',
        symbol: params.symbol,
        positionIdx: params.positionIdx ?? 0,
      };

      if (params.takeProfit) {
        tpslParams.takeProfit = params.takeProfit;
      }

      if (params.stopLoss) {
        tpslParams.stopLoss = params.stopLoss;
      }

      const response = await this.client.setTradingStop(tpslParams);

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to set TP/SL');
      }

      return true;
    } catch (error: any) {
      throw new Error(`Failed to set TP/SL: ${error.message}`);
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(symbol: string, orderId: string) {
    try {
      const response = await this.client.cancelOrder({
        category: 'linear',
        symbol,
        orderId,
      });

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to cancel order');
      }

      return true;
    } catch (error: any) {
      throw new Error(`Failed to cancel order: ${error.message}`);
    }
  }

  /**
   * Get all open positions
   */
  async getPositions(settleCoin: string = 'USDT') {
    try {
      const response = await this.client.getPositionInfo({
        category: 'linear',
        settleCoin,
      });

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to get positions');
      }

      return response.result?.list || [];
    } catch (error: any) {
      throw new Error(`Failed to get positions: ${error.message}`);
    }
  }

  /**
   * Get fills/executions for an order or recent history
   */
  async getFills(params?: { symbol?: string; orderId?: string }) {
    try {
      const response = await this.client.getHistoricOrders({
        category: 'linear',
        symbol: params?.symbol,
        orderId: params?.orderId,
        limit: 50,
      });

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to get fills');
      }

      return response.result?.list || [];
    } catch (error: any) {
      throw new Error(`Failed to get fills: ${error.message}`);
    }
  }

  /**
   * Get current market price for a symbol
   */
  async getTicker(symbol: string) {
    try {
      const response = await this.client.getTickers({
        category: 'linear',
        symbol,
      });

      if (response.retCode !== 0) {
        throw new Error(response.retMsg || 'Failed to get ticker');
      }

      const ticker = response.result?.list?.[0];
      return {
        symbol: ticker?.symbol,
        lastPrice: ticker?.lastPrice,
        bid1Price: ticker?.bid1Price,
        ask1Price: ticker?.ask1Price,
      };
    } catch (error: any) {
      throw new Error(`Failed to get ticker: ${error.message}`);
    }
  }

}

/**
 * Helper function to convert Aster DEX symbol format to Bybit format
 * @param asterSymbol Symbol from Aster (e.g., "BTC-USDT")
 * @returns Bybit symbol (e.g., "BTCUSDT")
 */
export function asterToBybitSymbol(asterSymbol: string): string {
  return asterSymbol.replace('-', '');
}

/**
 * Helper function to convert Bybit symbol format to Aster format
 * @param bybitSymbol Symbol from Bybit (e.g., "BTCUSDT")
 * @returns Aster symbol (e.g., "BTC-USDT")
 */
export function bybitToAsterSymbol(bybitSymbol: string): string {
  // Insert dash before USDT
  return bybitSymbol.replace('USDT', '-USDT');
}

/**
 * Helper function to convert side format
 * @param asterSide "long" or "short"
 * @returns "Buy" or "Sell" for Bybit
 */
export function asterToBybitSide(asterSide: 'long' | 'short'): 'Buy' | 'Sell' {
  return asterSide === 'long' ? 'Buy' : 'Sell';
}

/**
 * Helper function to convert Bybit side to Aster format
 * @param bybitSide "Buy" or "Sell"
 * @returns "long" or "short"
 */
export function bybitToAsterSide(bybitSide: 'Buy' | 'Sell'): 'long' | 'short' {
  return bybitSide === 'Buy' ? 'long' : 'short';
}

// Export singleton instance for convenience
export const bybitClient = new BybitClient();
