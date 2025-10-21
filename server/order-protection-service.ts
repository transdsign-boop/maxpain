import { createHmac } from 'crypto';
import { storage } from './storage';
import type { Position, Strategy } from '@shared/schema';
import { calculateATRPercent } from './dca-calculator';
import { getStrategyWithDCA } from './dca-sql';

interface ExchangeOrder {
  orderId: string;
  symbol: string;
  type: 'LIMIT' | 'STOP_MARKET' | 'MARKET';
  side: 'BUY' | 'SELL';
  origQty: string;
  price: string;
  stopPrice: string;
  positionSide: string;
}

interface DesiredOrder {
  type: 'LIMIT' | 'STOP_MARKET';
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  purpose: 'take_profit' | 'stop_loss';
}

interface OrderSignature {
  tp: string; // "LIMIT-price-qty"
  sl: string; // "STOP_MARKET-price-qty"
}

/**
 * OrderProtectionService - Manages TP/SL orders with atomic operations and automatic cleanup
 * 
 * Key features:
 * - Per-position locking to prevent concurrent updates
 * - Cancel-then-place pattern with rollback on failure
 * - Idempotent operations (skips work if orders already match)
 * - Automatic cleanup of orphaned orders
 */
export class OrderProtectionService {
  private updateLocks = new Map<string, Promise<void>>(); // lockKey -> promise
  private symbolPrecisionCache = new Map<string, { 
    stepSize: string; 
    tickSize: string; 
    maxQty: string;
    minQty: string;
    marketMaxQty: string;  // MARKET_LOT_SIZE maxQty for STOP_MARKET orders
    marketMinQty: string;  // MARKET_LOT_SIZE minQty for STOP_MARKET orders
  }>();
  private exchangeInfoFetched = false;

  constructor() {}

  /**
   * Get lock key for a position (symbol + side for isolation)
   */
  private getLockKey(symbol: string, side: string): string {
    return `${symbol}-${side}`;
  }

  /**
   * Acquire lock for position update - waits if another update in progress
   */
  private async acquireLock(lockKey: string): Promise<() => void> {
    // Wait for existing lock to release
    while (this.updateLocks.has(lockKey)) {
      await this.updateLocks.get(lockKey);
    }

    // Create new lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.updateLocks.set(lockKey, lockPromise);
    
    return () => {
      this.updateLocks.delete(lockKey);
      releaseLock!();
    };
  }

  /**
   * Fetch exchange precision info for rounding and quantity limits
   * CRITICAL: Fetches BOTH LOT_SIZE (LIMIT orders) and MARKET_LOT_SIZE (STOP_MARKET orders)
   * because they have different maxQty limits!
   */
  private async fetchExchangeInfo() {
    console.log('🔍 fetchExchangeInfo called, exchangeInfoFetched =', this.exchangeInfoFetched);
    if (this.exchangeInfoFetched) return;

    console.log('📡 Fetching exchange info from API...');
    try {
      const response = await fetch('https://fapi.asterdex.com/fapi/v1/exchangeInfo');
      console.log('📡 Exchange info response:', response.ok, response.status);
      if (!response.ok) return;

      const data = await response.json();

      for (const symbol of data.symbols || []) {
        const lotSizeFilter = symbol.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
        const marketLotSizeFilter = symbol.filters?.find((f: any) => f.filterType === 'MARKET_LOT_SIZE');
        const priceFilter = symbol.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');

        if (lotSizeFilter && priceFilter) {
          const limits = {
            stepSize: lotSizeFilter.stepSize || '1',
            tickSize: priceFilter.tickSize || '0.01',
            maxQty: lotSizeFilter.maxQty || '1000000',
            minQty: lotSizeFilter.minQty || '0.001',
            // MARKET_LOT_SIZE has stricter limits for MARKET/STOP_MARKET orders
            marketMaxQty: marketLotSizeFilter?.maxQty || lotSizeFilter.maxQty || '1000000',
            marketMinQty: marketLotSizeFilter?.minQty || lotSizeFilter.minQty || '0.001',
          };
          
          // Log limits for PUMP to debug the issue
          if (symbol.symbol === 'PUMPUSDT') {
            console.log(`📊 Exchange info for PUMPUSDT:`);
            console.log(`   LOT_SIZE: max=${lotSizeFilter.maxQty}, min=${lotSizeFilter.minQty}`);
            console.log(`   MARKET_LOT_SIZE: ${marketLotSizeFilter ? `max=${marketLotSizeFilter.maxQty}, min=${marketLotSizeFilter.minQty}` : 'NOT FOUND'}`);
            console.log(`   Using: marketMaxQty=${limits.marketMaxQty}, marketMinQty=${limits.marketMinQty}`);
          }
          
          this.symbolPrecisionCache.set(symbol.symbol, limits);
        }
      }

      this.exchangeInfoFetched = true;
    } catch (error) {
      console.error('❌ Error fetching exchange info:', error);
    }
  }

  /**
   * Round quantity to exchange step size and clamp to min/max limits
   * CRITICAL FIX: Ensures quantities respect exchange MAX_QTY to prevent "Quantity greater than max quantity" errors
   * @param symbol Trading pair symbol
   * @param quantity Raw quantity value
   * @param orderType Order type (LIMIT uses LOT_SIZE, MARKET/STOP_MARKET uses MARKET_LOT_SIZE)
   */
  private roundQuantity(symbol: string, quantity: number, orderType: 'LIMIT' | 'MARKET' | 'STOP_MARKET' | 'STOP' = 'LIMIT'): number {
    const precision = this.symbolPrecisionCache.get(symbol);
    if (!precision) return Math.floor(quantity * 100) / 100;

    const stepSize = parseFloat(precision.stepSize);
    
    // CRITICAL: STOP_MARKET orders use MARKET_LOT_SIZE limits (usually more restrictive!)
    const isMarketType = orderType === 'STOP_MARKET' || orderType === 'MARKET' || orderType === 'STOP';
    const maxQty = parseFloat(isMarketType ? precision.marketMaxQty : precision.maxQty);
    const minQty = parseFloat(isMarketType ? precision.marketMinQty : precision.minQty);
    
    // Clamp to exchange limits FIRST
    let clampedQty = quantity;
    if (quantity > maxQty) {
      console.warn(`⚠️ Quantity ${quantity} exceeds ${isMarketType ? 'MARKET_' : ''}MAX_QTY ${maxQty} for ${symbol} (${orderType}), clamping to max`);
      clampedQty = maxQty;
    } else if (quantity < minQty) {
      console.warn(`⚠️ Quantity ${quantity} below ${isMarketType ? 'MARKET_' : ''}MIN_QTY ${minQty} for ${symbol} (${orderType}), clamping to min`);
      clampedQty = minQty;
    }
    
    // Then round to step size
    const rounded = Math.floor(clampedQty / stepSize) * stepSize;
    const decimals = precision.stepSize.includes('.') ? precision.stepSize.split('.')[1].length : 0;

    return parseFloat(rounded.toFixed(decimals));
  }

  /**
   * Round price to exchange tick size
   */
  private roundPrice(symbol: string, price: number): number {
    const precision = this.symbolPrecisionCache.get(symbol);
    if (!precision) return Math.floor(price * 100) / 100;

    const tickSize = parseFloat(precision.tickSize);
    const rounded = Math.floor(price / tickSize) * tickSize;
    const decimals = precision.tickSize.includes('.') ? precision.tickSize.split('.')[1].length : 0;

    return parseFloat(rounded.toFixed(decimals));
  }

  /**
   * Calculate ATR-based take profit price with optional adaptive envelope
   * Priority: Adaptive TP > Exit Cushion Multiplier > Fixed Percentage
   */
  private async calculateATRBasedTP(
    strategy: Strategy,
    symbol: string,
    avgEntryPrice: number,
    side: 'long' | 'short'
  ): Promise<number> {
    try {
      // Get DCA parameters from strategy
      const strategyWithDCA = await getStrategyWithDCA(strategy.id);
      
      // Calculate ATR percentage
      const atrPercent = await calculateATRPercent(
        symbol,
        10,
        process.env.ASTER_API_KEY,
        process.env.ASTER_SECRET_KEY
      );

      // PRIORITY 1: Adaptive TP (Auto Envelope) - if enabled
      if (strategyWithDCA && strategyWithDCA.adaptive_tp_enabled) {
        const atrMultiplier = parseFloat(String(strategyWithDCA.tp_atr_multiplier || 1.5));
        const minTpPercent = parseFloat(String(strategyWithDCA.min_tp_percent || 0.5));
        const maxTpPercent = parseFloat(String(strategyWithDCA.max_tp_percent || 5.0));
        
        // Calculate TP as ATR × multiplier, clamped between min and max
        const rawTpPercent = atrPercent * atrMultiplier;
        const clampedTpPercent = Math.max(minTpPercent, Math.min(maxTpPercent, rawTpPercent));
        
        const tpPrice = side === 'long'
          ? avgEntryPrice * (1 + clampedTpPercent / 100)
          : avgEntryPrice * (1 - clampedTpPercent / 100);
        
        console.log(`🎯 Adaptive TP: ATR=${atrPercent.toFixed(2)}% × ${atrMultiplier} = ${rawTpPercent.toFixed(2)}% → clamped to ${clampedTpPercent.toFixed(2)}%`);
        return tpPrice;
      }

      // PRIORITY 2: Fixed percentage (when adaptive is disabled)
      const profitTargetPercent = parseFloat(strategy.profitTargetPercent);
      return side === 'long' 
        ? avgEntryPrice * (1 + profitTargetPercent / 100)
        : avgEntryPrice * (1 - profitTargetPercent / 100);

    } catch (error) {
      // Fallback to fixed percentage
      const profitTargetPercent = parseFloat(strategy.profitTargetPercent);
      return side === 'long' 
        ? avgEntryPrice * (1 + profitTargetPercent / 100)
        : avgEntryPrice * (1 - profitTargetPercent / 100);
    }
  }

  /**
   * Calculate ATR-based stop loss price with optional adaptive envelope
   * Priority: Adaptive SL > Fixed Percentage
   */
  private async calculateATRBasedSL(
    strategy: Strategy,
    symbol: string,
    avgEntryPrice: number,
    side: 'long' | 'short'
  ): Promise<number> {
    try {
      const { getStrategyWithDCA } = await import('./dca-sql');
      const strategyWithDCA = await getStrategyWithDCA(strategy.id);
      
      const atrPercent = await calculateATRPercent(
        symbol,
        10,
        process.env.ASTER_API_KEY,
        process.env.ASTER_SECRET_KEY
      );

      // PRIORITY 1: Adaptive SL (Auto Envelope) - if enabled
      if (strategyWithDCA && strategyWithDCA.adaptive_sl_enabled) {
        const atrMultiplier = parseFloat(String(strategyWithDCA.sl_atr_multiplier || 2.0));
        const minSlPercent = parseFloat(String(strategyWithDCA.min_sl_percent || 1.0));
        const maxSlPercent = parseFloat(String(strategyWithDCA.max_sl_percent || 5.0));
        
        // Calculate SL as ATR × multiplier, clamped between min and max
        const rawSlPercent = atrPercent * atrMultiplier;
        const clampedSlPercent = Math.max(minSlPercent, Math.min(maxSlPercent, rawSlPercent));
        
        const slPrice = side === 'long'
          ? avgEntryPrice * (1 - clampedSlPercent / 100)
          : avgEntryPrice * (1 + clampedSlPercent / 100);
        
        console.log(`🛡️ Adaptive SL: ATR=${atrPercent.toFixed(2)}% × ${atrMultiplier} = ${rawSlPercent.toFixed(2)}% → clamped to ${clampedSlPercent.toFixed(2)}%`);
        return slPrice;
      }

      // PRIORITY 2: Fixed percentage fallback
      const stopLossPercent = parseFloat(strategy.stopLossPercent);
      return side === 'long' 
        ? avgEntryPrice * (1 - stopLossPercent / 100)
        : avgEntryPrice * (1 + stopLossPercent / 100);

    } catch (error) {
      // Fallback to fixed percentage
      const stopLossPercent = parseFloat(strategy.stopLossPercent);
      return side === 'long' 
        ? avgEntryPrice * (1 - stopLossPercent / 100)
        : avgEntryPrice * (1 + stopLossPercent / 100);
    }
  }

  /**
   * Calculate desired TP/SL orders based on position
   * CRITICAL: Handles positions that exceed exchange max quantity by splitting into multiple orders
   */
  private async calculateDesiredOrders(position: Position, strategy: Strategy): Promise<DesiredOrder[]> {
    const entryPrice = parseFloat(position.avgEntryPrice);
    const quantity = parseFloat(position.totalQuantity);

    // Calculate ATR-based TP and SL prices
    const rawTpPrice = await this.calculateATRBasedTP(
      strategy,
      position.symbol,
      entryPrice,
      position.side as 'long' | 'short'
    );

    const rawSlPrice = await this.calculateATRBasedSL(
      strategy,
      position.symbol,
      entryPrice,
      position.side as 'long' | 'short'
    );

    let tpPrice: number;
    let slPrice: number;
    let tpSide: 'BUY' | 'SELL';
    let slSide: 'BUY' | 'SELL';

    if (position.side === 'long') {
      tpPrice = this.roundPrice(position.symbol, rawTpPrice);
      slPrice = this.roundPrice(position.symbol, rawSlPrice);
      tpSide = 'SELL';
      slSide = 'SELL';
    } else {
      tpPrice = this.roundPrice(position.symbol, rawTpPrice);
      slPrice = this.roundPrice(position.symbol, rawSlPrice);
      tpSide = 'BUY';
      slSide = 'BUY';
    }

    // Get max quantities for each order type
    const precision = this.symbolPrecisionCache.get(position.symbol);
    const tpMaxQty = precision ? parseFloat(precision.maxQty) : Infinity;
    const slMaxQty = precision ? parseFloat(precision.marketMaxQty) : Infinity;

    const orders: DesiredOrder[] = [];

    // Split TP orders if quantity exceeds LIMIT max
    if (quantity > tpMaxQty) {
      console.log(`⚠️ Position quantity ${quantity} exceeds TP max ${tpMaxQty} for ${position.symbol}, splitting into multiple orders`);
      let remaining = quantity;
      let orderNum = 1;
      
      while (remaining > 0) {
        const orderQty = Math.min(remaining, tpMaxQty);
        const roundedQty = this.roundQuantity(position.symbol, orderQty, 'LIMIT');
        
        orders.push({
          type: 'LIMIT',
          price: tpPrice,
          quantity: roundedQty,
          side: tpSide,
          purpose: 'take_profit',
          orderNumber: orderNum
        } as any);
        
        remaining -= roundedQty;
        orderNum++;
        
        if (orderNum > 10) { // Safety limit
          console.error(`❌ Too many TP orders needed for ${position.symbol}, aborting split`);
          break;
        }
      }
    } else {
      const tpRoundedQty = this.roundQuantity(position.symbol, quantity, 'LIMIT');
      orders.push({
        type: 'LIMIT',
        price: tpPrice,
        quantity: tpRoundedQty,
        side: tpSide,
        purpose: 'take_profit'
      });
    }

    // Split SL orders if quantity exceeds STOP_MARKET max
    if (quantity > slMaxQty) {
      console.log(`⚠️ Position quantity ${quantity} exceeds SL max ${slMaxQty} for ${position.symbol}, splitting into multiple orders`);
      let remaining = quantity;
      let orderNum = 1;
      
      while (remaining > 0) {
        const orderQty = Math.min(remaining, slMaxQty);
        const roundedQty = this.roundQuantity(position.symbol, orderQty, 'STOP_MARKET');
        
        orders.push({
          type: 'STOP_MARKET',
          price: slPrice,
          quantity: roundedQty,
          side: slSide,
          purpose: 'stop_loss',
          orderNumber: orderNum
        } as any);
        
        remaining -= roundedQty;
        orderNum++;
        
        if (orderNum > 10) { // Safety limit
          console.error(`❌ Too many SL orders needed for ${position.symbol}, aborting split`);
          break;
        }
      }
    } else {
      const slRoundedQty = this.roundQuantity(position.symbol, quantity, 'STOP_MARKET');
      orders.push({
        type: 'STOP_MARKET',
        price: slPrice,
        quantity: slRoundedQty,
        side: slSide,
        purpose: 'stop_loss'
      });
    }

    return orders;
  }

  /**
   * Generate order signature for comparison
   * Handles multiple TP/SL orders by concatenating their quantities
   */
  private getOrderSignature(orders: DesiredOrder[]): OrderSignature {
    const tpOrders = orders.filter(o => o.purpose === 'take_profit');
    const slOrders = orders.filter(o => o.purpose === 'stop_loss');

    const tpTotalQty = tpOrders.reduce((sum, o) => sum + o.quantity, 0);
    const slTotalQty = slOrders.reduce((sum, o) => sum + o.quantity, 0);
    
    const tpPrice = tpOrders[0]?.price || 0;
    const slPrice = slOrders[0]?.price || 0;

    return {
      tp: `${tpOrders[0]?.type}-${tpPrice}-${tpTotalQty}x${tpOrders.length}`,
      sl: `${slOrders[0]?.type}-${slPrice}-${slTotalQty}x${slOrders.length}`
    };
  }

  /**
   * Fetch live position from exchange for accurate quantity/entry price
   * Filters by position side to support hedge mode correctly
   */
  private async fetchLiveExchangePosition(symbol: string, side: 'long' | 'short'): Promise<{ quantity: string; entryPrice: string } | null> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;
      
      if (!apiKey || !secretKey) {
        return null;
      }
      
      const timestamp = Date.now();
      const params = `timestamp=${timestamp}`;
      const signature = createHmac('sha256', secretKey)
        .update(params)
        .digest('hex');
      
      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v2/positionRisk?${params}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );
      
      if (!response.ok) {
        return null;
      }
      
      const positions = await response.json();
      
      // Filter by symbol AND side (critical for hedge mode)
      const position = positions.find((p: any) => {
        if (p.symbol !== symbol || parseFloat(p.positionAmt) === 0) return false;
        
        // Match side: negative positionAmt = short, positive = long
        const isShort = parseFloat(p.positionAmt) < 0;
        return (side === 'short' && isShort) || (side === 'long' && !isShort);
      });
      
      if (!position) {
        return null;
      }
      
      return {
        quantity: Math.abs(parseFloat(position.positionAmt)).toString(),
        entryPrice: position.entryPrice
      };
    } catch (error) {
      console.error(`❌ Error fetching live exchange position for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Check if existing exchange orders match desired state (idempotency check)
   * Handles multiple TP/SL orders when position exceeds exchange max quantity
   * Uses price/quantity tolerance to prevent churn from minor ATR fluctuations
   */
  private ordersMatchDesired(
    existingOrders: ExchangeOrder[],
    desiredOrders: DesiredOrder[]
  ): boolean {
    const desiredTpOrders = desiredOrders.filter(o => o.purpose === 'take_profit');
    const desiredSlOrders = desiredOrders.filter(o => o.purpose === 'stop_loss');

    const existingTpOrders = existingOrders.filter(o => o.type === 'LIMIT');
    const existingSlOrders = existingOrders.filter(o => o.type === 'STOP_MARKET');

    // Must have matching counts
    if (existingTpOrders.length !== desiredTpOrders.length || 
        existingSlOrders.length !== desiredSlOrders.length) {
      console.log(`📊 Order count mismatch: TP ${existingTpOrders.length} vs ${desiredTpOrders.length}, SL ${existingSlOrders.length} vs ${desiredSlOrders.length}`);
      return false;
    }

    // Use tolerance to prevent churn from minor ATR drift
    const PRICE_TOLERANCE_PERCENT = 0.002; // 0.2%
    const QTY_TOLERANCE_PERCENT = 0.001;   // 0.1%

    // Check total quantities match (for split orders)
    const existingTpTotalQty = existingTpOrders.reduce((sum, o) => sum + parseFloat(o.origQty), 0);
    const desiredTpTotalQty = desiredTpOrders.reduce((sum, o) => sum + o.quantity, 0);
    const tpQtyDiff = Math.abs(existingTpTotalQty - desiredTpTotalQty);
    const tpQtyTolerance = desiredTpTotalQty * QTY_TOLERANCE_PERCENT;
    const tpQtyMatches = tpQtyDiff <= tpQtyTolerance;

    const existingSlTotalQty = existingSlOrders.reduce((sum, o) => sum + parseFloat(o.origQty), 0);
    const desiredSlTotalQty = desiredSlOrders.reduce((sum, o) => sum + o.quantity, 0);
    const slQtyDiff = Math.abs(existingSlTotalQty - desiredSlTotalQty);
    const slQtyTolerance = desiredSlTotalQty * QTY_TOLERANCE_PERCENT;
    const slQtyMatches = slQtyDiff <= slQtyTolerance;

    // Check prices match (all orders should have same price)
    let tpPriceMatches = true;
    if (desiredTpOrders.length > 0 && existingTpOrders.length > 0) {
      const desiredTpPrice = desiredTpOrders[0].price;
      const tpPriceTolerance = Math.max(
        desiredTpPrice * PRICE_TOLERANCE_PERCENT,
        this.getTickSize(existingTpOrders[0].symbol) * 2
      );
      
      tpPriceMatches = existingTpOrders.every(o => {
        const priceDiff = Math.abs(parseFloat(o.price) - desiredTpPrice);
        return priceDiff <= tpPriceTolerance;
      });
    }

    let slPriceMatches = true;
    if (desiredSlOrders.length > 0 && existingSlOrders.length > 0) {
      const desiredSlPrice = desiredSlOrders[0].price;
      const slPriceTolerance = Math.max(
        desiredSlPrice * PRICE_TOLERANCE_PERCENT,
        this.getTickSize(existingSlOrders[0].symbol) * 2
      );
      
      slPriceMatches = existingSlOrders.every(o => {
        const priceDiff = Math.abs(parseFloat(o.stopPrice) - desiredSlPrice);
        return priceDiff <= slPriceTolerance;
      });
    }

    const allMatch = tpPriceMatches && tpQtyMatches && slPriceMatches && slQtyMatches;
    
    if (!allMatch) {
      console.log(`📊 Order mismatch detected:`);
      console.log(`   TP: price ${tpPriceMatches ? '✅' : '❌'}, qty ${tpQtyMatches ? '✅' : '❌'} (${tpQtyDiff.toFixed(2)} vs ${tpQtyTolerance.toFixed(2)})`);
      console.log(`   SL: price ${slPriceMatches ? '✅' : '❌'}, qty ${slQtyMatches ? '✅' : '❌'} (${slQtyDiff.toFixed(2)} vs ${slQtyTolerance.toFixed(2)})`);
    }

    return allMatch;
  }

  /**
   * Get tick size for a symbol (used for price tolerance)
   */
  private getTickSize(symbol: string): number {
    const precision = this.symbolPrecisionCache.get(symbol);
    if (!precision) return 0.001; // Default 0.001 if not found
    return parseFloat(precision.tickSize);
  }

  /**
   * Fetch all open orders for a symbol from exchange
   */
  private async fetchExchangeOrders(symbol: string, side?: string): Promise<ExchangeOrder[]> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) return [];

      const timestamp = Date.now();
      const params: Record<string, string | number> = {
        symbol,
        timestamp,
        recvWindow: 5000,
      };

      const queryString = Object.entries(params)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');

      const signature = createHmac('sha256', secretKey).update(queryString).digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/openOrders?${queryString}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );

      if (!response.ok) return [];

      const orders = await response.json();

      // Filter by side AND positionSide if specified (critical for hedge mode)
      let filteredOrders = orders;
      if (side) {
        filteredOrders = orders.filter((o: any) => {
          // TP/SL orders have opposite side to position
          const orderSide = side === 'long' ? 'SELL' : 'BUY';
          
          // Also filter by positionSide in hedge mode
          // Exchange uses uppercase: 'LONG', 'SHORT', or 'BOTH'
          const expectedPositionSide = side.toUpperCase();
          const orderPositionSide = o.positionSide || 'BOTH';
          
          return o.side === orderSide && 
                 (orderPositionSide === expectedPositionSide || orderPositionSide === 'BOTH');
        });
      }

      return filteredOrders.map((o: any) => ({
        orderId: o.orderId.toString(),
        symbol: o.symbol,
        type: o.type,
        side: o.side,
        origQty: o.origQty,
        price: o.price || '0',
        stopPrice: o.stopPrice || '0',
        positionSide: (o.positionSide || 'BOTH').toLowerCase()
      }));
    } catch (error) {
      console.error(`❌ Error fetching orders for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Cancel an order on the exchange
   */
  private async cancelExchangeOrder(symbol: string, orderId: string): Promise<boolean> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) return false;

      const timestamp = Date.now();
      const params: Record<string, string | number> = {
        symbol,
        orderId,
        timestamp,
        recvWindow: 5000,
      };

      const queryString = Object.entries(params)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');

      const signature = createHmac('sha256', secretKey).update(queryString).digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/order?${queryString}&signature=${signature}`,
        { method: 'DELETE', headers: { 'X-MBX-APIKEY': apiKey } }
      );

      return response.ok;
    } catch (error) {
      console.error(`❌ Error cancelling order ${orderId}:`, error);
      return false;
    }
  }

  /**
   * Place an order on the exchange
   */
  private async placeExchangeOrder(
    symbol: string,
    type: 'LIMIT' | 'STOP_MARKET',
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number,
    positionSide: 'LONG' | 'SHORT'
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return { success: false, error: 'Missing API credentials' };
      }

      await this.fetchExchangeInfo();

      const roundedQty = this.roundQuantity(symbol, quantity, type);
      const roundedPrice = this.roundPrice(symbol, price);

      const timestamp = Date.now();
      const params: Record<string, string | number> = {
        symbol,
        side,
        type,
        positionSide, // CRITICAL: Must specify position side for hedge mode
        quantity: roundedQty.toString(),
        timestamp,
        recvWindow: 5000,
      };

      if (type === 'LIMIT') {
        params.price = roundedPrice.toString();
        params.timeInForce = 'GTC';
        // Note: reduceOnly is implied when positionSide is set in hedge mode
        // params.reduceOnly = 'true';
      } else if (type === 'STOP_MARKET') {
        params.stopPrice = roundedPrice.toString();
        // Note: reduceOnly is implied when positionSide is set in hedge mode
        // params.reduceOnly = 'true';
      }

      const queryString = Object.entries(params)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');

      const signature = createHmac('sha256', secretKey).update(queryString).digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/order?${queryString}&signature=${signature}`,
        { method: 'POST', headers: { 'X-MBX-APIKEY': apiKey } }
      );

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.msg || 'Order placement failed' };
      }

      return { success: true, orderId: data.orderId?.toString() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Main method: Update protective orders with PLACE-THEN-CANCEL pattern
   * SAFETY FIX: Places new orders BEFORE canceling old ones to eliminate protective order gaps
   */
  async updateProtectiveOrders(
    position: Position,
    strategy: Strategy
  ): Promise<{ success: boolean; error?: string }> {
    const lockKey = this.getLockKey(position.symbol, position.side);
    const releaseLock = await this.acquireLock(lockKey);

    try {
      // SIMPLIFIED APPROACH: Always use position-level protective orders
      // Position TP/SL based on average entry price and total quantity
      
      // Ensure exchange info is fetched
      await this.fetchExchangeInfo();

      // CRITICAL FIX: Fetch live exchange position for accurate quantity/entry price
      // Database position may be stale due to async fill processing
      // IMPORTANT: Filter by side to support hedge mode correctly
      const livePosition = await this.fetchLiveExchangePosition(position.symbol, position.side as 'long' | 'short');
      
      let positionToUse = position;
      if (livePosition) {
        // Use live exchange data for TP/SL calculation
        positionToUse = {
          ...position,
          totalQuantity: livePosition.quantity,
          avgEntryPrice: livePosition.entryPrice
        };
        console.log(`🔄 Using live exchange position for ${position.symbol} ${position.side}: qty=${livePosition.quantity}, avgEntry=${livePosition.entryPrice}`);
      } else {
        console.warn(`⚠️ Could not fetch live position for ${position.symbol} ${position.side}, using database position as fallback`);
      }

      // Calculate desired order state using live position data
      const desiredOrders = await this.calculateDesiredOrders(positionToUse, strategy);
      const desiredSignature = this.getOrderSignature(desiredOrders);

      // Fetch existing orders
      const existingOrders = await this.fetchExchangeOrders(position.symbol, position.side);
      const tpslOrders = existingOrders.filter(
        o => o.type === 'LIMIT' || o.type === 'STOP_MARKET'
      );

      // Check if existing orders match desired state
      if (this.ordersMatchDesired(tpslOrders, desiredOrders)) {
        // IDEMPOTENCY: Skip if orders already match desired state
        console.log(`✅ TP/SL orders already correct for ${position.symbol} ${position.side}, skipping update`);
        return { success: true };
      }

      console.log(`🔄 Updating protective orders for ${position.symbol} ${position.side}`);
      console.log(`   Desired: TP=${desiredSignature.tp}, SL=${desiredSignature.sl}`);

      // STEP 1: Place ALL new orders (TP and SL, possibly multiple of each)
      const newOrderIds: string[] = [];
      let placementFailed = false;
      let failureError = '';

      for (const order of desiredOrders) {
        const result = await this.placeExchangeOrder(
          position.symbol,
          order.type,
          order.side,
          order.quantity,
          order.price,
          position.side.toUpperCase() as 'LONG' | 'SHORT'
        );

        if (!result.success) {
          console.error(`❌ Failed to place ${order.purpose} order: ${result.error}`);
          
          // ISOLATED MARGIN FIX: If we get "ReduceOnly Order is rejected", force cleanup and retry
          if (result.error && result.error.includes('ReduceOnly')) {
            console.log(`🔧 Detected ReduceOnly conflict - force canceling all existing orders and retrying...`);
            
            // Cancel ALL existing TP/SL orders
            for (const existingOrder of tpslOrders) {
              await this.cancelExchangeOrder(position.symbol, existingOrder.orderId);
              console.log(`   🗑️ Cancelled old ${existingOrder.type} #${existingOrder.orderId}`);
            }
            
            // Cancel any new orders we just placed
            for (const orderId of newOrderIds) {
              await this.cancelExchangeOrder(position.symbol, orderId);
            }
            newOrderIds.length = 0;
            
            // Retry placing ALL orders
            for (const retryOrder of desiredOrders) {
              const retryResult = await this.placeExchangeOrder(
                position.symbol,
                retryOrder.type,
                retryOrder.side,
                retryOrder.quantity,
                retryOrder.price,
                position.side.toUpperCase() as 'LONG' | 'SHORT'
              );
              
              if (!retryResult.success) {
                console.error(`❌ ${retryOrder.purpose} retry failed: ${retryResult.error}`);
                // Cancel any successful retries
                for (const orderId of newOrderIds) {
                  await this.cancelExchangeOrder(position.symbol, orderId);
                }
                return { success: false, error: `${retryOrder.purpose} order failed after cleanup: ${retryResult.error}` };
              }
              
              newOrderIds.push(retryResult.orderId!);
              console.log(`   ✅ Placed ${retryOrder.purpose} order #${retryResult.orderId} (qty: ${retryOrder.quantity})`);
            }
            
            console.log(`✅ Protective orders updated safely for ${position.symbol} ${position.side} (forced cleanup + retry)`);
            return { success: true };
          }
          
          placementFailed = true;
          failureError = result.error || 'Unknown error';
          break;
        }

        newOrderIds.push(result.orderId!);
        console.log(`   ✅ Placed ${order.purpose} order #${result.orderId} (qty: ${order.quantity})`);
      }

      // If any order failed, rollback
      if (placementFailed) {
        console.log(`🔄 Rolling back ${newOrderIds.length} successfully placed orders...`);
        for (const orderId of newOrderIds) {
          await this.cancelExchangeOrder(position.symbol, orderId);
        }
        return { success: false, error: failureError };
      }

      // STEP 2: NOW cancel old orders (new protective orders are already active!)
      const newOrderIdSet = new Set(newOrderIds);
      const ordersToCancel = tpslOrders.filter(o => !newOrderIdSet.has(o.orderId));
      
      if (ordersToCancel.length > 0) {
        console.log(`   Cancelling ${ordersToCancel.length} old orders (new orders already active)...`);
        
        for (const order of ordersToCancel) {
          const cancelled = await this.cancelExchangeOrder(position.symbol, order.orderId);
          if (cancelled) {
            console.log(`   ✅ Cancelled old ${order.type} #${order.orderId}`);
          } else {
            // Not critical - new orders are already active
            console.warn(`   ⚠️ Failed to cancel old ${order.type} #${order.orderId} (not critical - new orders active)`);
          }
        }
      }

      console.log(`✅ Protective orders updated safely for ${position.symbol} ${position.side} (zero-gap transition)`);

      return { success: true };

    } catch (error: any) {
      console.error(`❌ Error in updateProtectiveOrders for ${position.symbol}:`, error);
      return { success: false, error: error.message };
    } finally {
      releaseLock();
    }
  }

  /**
   * Reconcile orphaned orders - cancel orders for symbols with no open position
   * Fetches ALL open orders from exchange to catch orphans for fully closed symbols
   * Only cancels orders for symbols we actively manage (have fills in database)
   */
  async reconcileOrphanedOrders(sessionId: string): Promise<number> {
    try {
      console.log(`🔍 Reconciling orphaned orders for session ${sessionId}...`);

      // Get all open positions for this session
      const positions = await storage.getOpenPositions(sessionId);
      const openSymbols = new Set(
        positions.map(p => `${p.symbol}-${p.side}`)
      );

      // Get all symbols we've ever traded (to distinguish our orders from manual/other system orders)
      const managedSymbols = await this.getManagedSymbols(sessionId);

      let totalCancelled = 0;

      // Fetch ALL open orders from exchange (not filtered by symbol)
      // This ensures we catch orphaned orders for fully closed positions
      const allOrders = await this.fetchAllExchangeOrders();
      
      // Group orders by symbol for efficient processing
      const ordersBySymbol = new Map<string, ExchangeOrder[]>();
      for (const order of allOrders) {
        if (!ordersBySymbol.has(order.symbol)) {
          ordersBySymbol.set(order.symbol, []);
        }
        ordersBySymbol.get(order.symbol)!.push(order);
      }

      // Check each symbol's orders
      for (const [symbol, orders] of ordersBySymbol) {
        // SAFETY: Only manage symbols we've actively traded
        // This prevents canceling manual orders or orders from other systems
        if (!managedSymbols.has(symbol)) {
          continue;
        }

        for (const order of orders) {
          // Only check TP/SL orders (LIMIT and STOP_MARKET)
          // Note: This system uses MARKET orders for entries, so all LIMIT/STOP_MARKET are protective
          if (order.type !== 'LIMIT' && order.type !== 'STOP_MARKET') continue;

          // Determine position side from order
          const orderSide = order.side === 'BUY' ? 'short' : 'long'; // TP/SL have opposite side
          const positionKey = `${symbol}-${orderSide}`;

          // If no open position for this symbol-side, order is orphaned
          if (!openSymbols.has(positionKey)) {
            console.log(`🗑️ Orphaned order found: ${symbol} ${order.type} #${order.orderId} (no ${orderSide} position)`);
            const cancelled = await this.cancelExchangeOrder(symbol, order.orderId);
            if (cancelled) {
              totalCancelled++;
              console.log(`   ✅ Cancelled orphaned order #${order.orderId}`);
            }
          }
        }
      }

      if (totalCancelled > 0) {
        console.log(`✅ Reconciliation complete: ${totalCancelled} orphaned orders cancelled`);
      } else {
        console.log(`✅ Reconciliation complete: no orphaned orders found`);
      }

      return totalCancelled;
    } catch (error) {
      console.error('❌ Error in reconcileOrphanedOrders:', error);
      return 0;
    }
  }

  /**
   * Get all symbols we're actively managing (have current/recent positions)
   * Only includes symbols with open positions OR positions closed in last 24 hours
   * This prevents canceling manual orders on old symbols we haven't traded recently
   */
  private async getManagedSymbols(sessionId: string): Promise<Set<string>> {
    try {
      // Get currently open positions
      const openPositions = await storage.getOpenPositions(sessionId);
      const symbols = new Set(openPositions.map(p => p.symbol));

      // Also get recently closed positions (last 24 hours)
      const allPositions = await storage.getPositionsBySession(sessionId);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      allPositions.forEach(pos => {
        // Include if closed in last 24 hours
        if (pos.closedAt && pos.closedAt > oneDayAgo) {
          symbols.add(pos.symbol);
        }
      });

      return symbols;
    } catch (error) {
      console.error('❌ Error getting managed symbols:', error);
      return new Set();
    }
  }

  /**
   * Fetch ALL open orders from exchange (all symbols)
   */
  private async fetchAllExchangeOrders(): Promise<ExchangeOrder[]> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) return [];

      const timestamp = Date.now();
      const params: Record<string, string | number> = {
        timestamp,
        recvWindow: 5000,
      };

      const queryString = Object.entries(params)
        .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');

      const signature = createHmac('sha256', secretKey).update(queryString).digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/openOrders?${queryString}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } }
      );

      if (!response.ok) return [];

      const orders = await response.json();

      return orders.map((o: any) => ({
        orderId: o.orderId.toString(),
        symbol: o.symbol,
        type: o.type,
        side: o.side,
        origQty: o.origQty,
        price: o.price || '0',
        stopPrice: o.stopPrice || '0',
        positionSide: (o.positionSide || 'BOTH').toLowerCase()
      }));
    } catch (error) {
      console.error('❌ Error fetching all exchange orders:', error);
      return [];
    }
  }

  /**
   * Verify all positions have correct TP/SL orders (self-healing)
   */
  async verifyAllPositions(sessionId: string, strategy: Strategy): Promise<void> {
    try {
      const positions = await storage.getOpenPositions(sessionId);
      
      for (const position of positions) {
        await this.updateProtectiveOrders(position, strategy);
      }
    } catch (error) {
      console.error('❌ Error in verifyAllPositions:', error);
    }
  }
}

// Singleton instance
export const orderProtectionService = new OrderProtectionService();
