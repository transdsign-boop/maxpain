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
  private symbolPrecisionCache = new Map<string, { stepSize: string; tickSize: string }>();
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
   * Fetch exchange precision info for rounding
   */
  private async fetchExchangeInfo() {
    if (this.exchangeInfoFetched) return;

    try {
      const response = await fetch('https://fapi.asterdex.com/fapi/v1/exchangeInfo');
      if (!response.ok) return;

      const data = await response.json();

      for (const symbol of data.symbols || []) {
        const lotSizeFilter = symbol.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
        const priceFilter = symbol.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');

        if (lotSizeFilter && priceFilter) {
          this.symbolPrecisionCache.set(symbol.symbol, {
            stepSize: lotSizeFilter.stepSize || '1',
            tickSize: priceFilter.tickSize || '0.01',
          });
        }
      }

      this.exchangeInfoFetched = true;
    } catch (error) {
      console.error('❌ Error fetching exchange info:', error);
    }
  }

  /**
   * Round quantity to exchange step size
   */
  private roundQuantity(symbol: string, quantity: number): number {
    const precision = this.symbolPrecisionCache.get(symbol);
    if (!precision) return Math.floor(quantity * 100) / 100;

    const stepSize = parseFloat(precision.stepSize);
    const rounded = Math.floor(quantity / stepSize) * stepSize;
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

    const roundedQty = this.roundQuantity(position.symbol, quantity);

    return [
      {
        type: 'LIMIT',
        price: tpPrice,
        quantity: roundedQty,
        side: tpSide,
        purpose: 'take_profit'
      },
      {
        type: 'STOP_MARKET',
        price: slPrice,
        quantity: roundedQty,
        side: slSide,
        purpose: 'stop_loss'
      }
    ];
  }

  /**
   * Generate order signature for comparison
   */
  private getOrderSignature(orders: DesiredOrder[]): OrderSignature {
    const tpOrder = orders.find(o => o.purpose === 'take_profit')!;
    const slOrder = orders.find(o => o.purpose === 'stop_loss')!;

    return {
      tp: `${tpOrder.type}-${tpOrder.price}-${tpOrder.quantity}`,
      sl: `${slOrder.type}-${slOrder.price}-${slOrder.quantity}`
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
   * Returns true ONLY if there's EXACTLY 1 TP and 1 SL that match perfectly
   */
  private ordersMatchDesired(
    existingOrders: ExchangeOrder[],
    desiredOrders: DesiredOrder[]
  ): boolean {
    const tpOrder = desiredOrders.find(o => o.purpose === 'take_profit');
    const slOrder = desiredOrders.find(o => o.purpose === 'stop_loss');

    const tpOrders = existingOrders.filter(o => o.type === 'LIMIT');
    const slOrders = existingOrders.filter(o => o.type === 'STOP_MARKET');

    // Must have EXACTLY 1 TP and 1 SL (no duplicates!)
    if (tpOrders.length !== 1 || slOrders.length !== 1) return false;

    const existingTP = tpOrders[0];
    const existingSL = slOrders[0];

    const tpMatches = 
      parseFloat(existingTP.price) === tpOrder!.price &&
      parseFloat(existingTP.origQty) === tpOrder!.quantity;

    const slMatches = 
      parseFloat(existingSL.stopPrice) === slOrder!.price &&
      parseFloat(existingSL.origQty) === slOrder!.quantity;

    return tpMatches && slMatches;
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
    price: number
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      const apiKey = process.env.ASTER_API_KEY;
      const secretKey = process.env.ASTER_SECRET_KEY;

      if (!apiKey || !secretKey) {
        return { success: false, error: 'Missing API credentials' };
      }

      await this.fetchExchangeInfo();

      const roundedQty = this.roundQuantity(symbol, quantity);
      const roundedPrice = this.roundPrice(symbol, price);

      const timestamp = Date.now();
      const params: Record<string, string | number> = {
        symbol,
        side,
        type,
        quantity: roundedQty.toString(),
        timestamp,
        recvWindow: 5000,
      };

      if (type === 'LIMIT') {
        params.price = roundedPrice.toString();
        params.timeInForce = 'GTC';
        params.reduceOnly = 'true'; // TP limit orders must reduce only to prevent position flip
      } else if (type === 'STOP_MARKET') {
        params.stopPrice = roundedPrice.toString();
        params.reduceOnly = 'true';
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
   * Main method: Update protective orders with atomic cancel-then-place
   */
  async updateProtectiveOrders(
    position: Position,
    strategy: Strategy
  ): Promise<{ success: boolean; error?: string }> {
    const lockKey = this.getLockKey(position.symbol, position.side);
    const releaseLock = await this.acquireLock(lockKey);

    try {
      // Check if position has active DCA layers
      const { db } = await import('./db');
      const { positionLayers } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      
      const layers = await db.select()
        .from(positionLayers)
        .where(and(
          eq(positionLayers.positionId, position.id),
          eq(positionLayers.isOpen, true)
        ));
      
      // If DCA layers exist, cancel any position-level protective orders and skip creating new ones
      if (layers.length > 0) {
        console.log(`⏭️ Skipping position-level protective orders for ${position.symbol} ${position.side} - ${layers.length} active DCA layer(s) managing TP/SL individually`);
        
        // Cancel any existing position-level TP/SL orders to prevent stale orders
        const existingOrders = await this.fetchExchangeOrders(position.symbol, position.side);
        const tpslOrders = existingOrders.filter(
          o => o.type === 'LIMIT' || o.type === 'STOP_MARKET'
        );
        
        if (tpslOrders.length > 0) {
          console.log(`   Cancelling ${tpslOrders.length} stale position-level TP/SL order(s)...`);
          for (const order of tpslOrders) {
            await this.cancelOrder(position.symbol, order.orderId);
          }
        }
        
        releaseLock();
        return { success: true };
      }
      
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

      // FORCE CLEANUP: If there are duplicate/fragmented orders (multiple TPs or SLs), cancel ALL
      const tpOrders = tpslOrders.filter(o => o.type === 'LIMIT');
      const slOrders = tpslOrders.filter(o => o.type === 'STOP_MARKET');
      
      if (tpOrders.length > 1 || slOrders.length > 1) {
        console.log(`⚠️ Found fragmented orders for ${position.symbol} ${position.side}: ${tpOrders.length} TPs, ${slOrders.length} SLs - forcing cleanup`);
        // Don't skip - proceed to cancel all and recreate
      } else if (this.ordersMatchDesired(tpslOrders, desiredOrders)) {
        // IDEMPOTENCY: Skip if orders already match desired state
        console.log(`✅ TP/SL orders already correct for ${position.symbol} ${position.side}, skipping update`);
        return { success: true };
      }

      console.log(`🔄 Updating protective orders for ${position.symbol} ${position.side}`);
      console.log(`   Desired: TP=${desiredSignature.tp}, SL=${desiredSignature.sl}`);

      // STEP 1: Cancel all existing TP/SL orders
      const cancelledOrders: ExchangeOrder[] = [];
      if (tpslOrders.length > 0) {
        console.log(`   Cancelling ${tpslOrders.length} existing orders...`);
        
        for (const order of tpslOrders) {
          const cancelled = await this.cancelExchangeOrder(position.symbol, order.orderId);
          if (cancelled) {
            cancelledOrders.push(order);
            console.log(`   ✅ Cancelled ${order.type} #${order.orderId}`);
          } else {
            // ABORT: Cancellation failed - restore already-cancelled orders
            console.error(`   ❌ Failed to cancel ${order.type} #${order.orderId}`);
            console.log(`   🔄 Restoring ${cancelledOrders.length} already-cancelled orders...`);
            
            for (const oldOrder of cancelledOrders) {
              const restoreResult = await this.placeExchangeOrder(
                position.symbol,
                oldOrder.type,
                oldOrder.side,
                parseFloat(oldOrder.origQty),
                parseFloat(oldOrder.type === 'LIMIT' ? oldOrder.price : oldOrder.stopPrice)
              );
              
              if (restoreResult.success) {
                console.log(`   ✅ Restored ${oldOrder.type} order`);
              } else {
                console.warn(`   ⚠️ Failed to restore ${oldOrder.type} order`);
              }
            }
            
            return { success: false, error: `Failed to cancel order #${order.orderId}` };
          }
        }
      }

      // STEP 2: Place new TP order
      const tpOrder = desiredOrders.find(o => o.purpose === 'take_profit')!;
      const tpResult = await this.placeExchangeOrder(
        position.symbol,
        tpOrder.type,
        tpOrder.side,
        tpOrder.quantity,
        tpOrder.price
      );

      if (!tpResult.success) {
        // ROLLBACK: Restore ONLY the orders we successfully cancelled
        console.error(`❌ Failed to place TP order: ${tpResult.error}`);
        console.log(`🔄 Attempting rollback - restoring ${cancelledOrders.length} cancelled orders...`);
        
        for (const oldOrder of cancelledOrders) {
          const restoreResult = await this.placeExchangeOrder(
            position.symbol,
            oldOrder.type,
            oldOrder.side,
            parseFloat(oldOrder.origQty),
            parseFloat(oldOrder.type === 'LIMIT' ? oldOrder.price : oldOrder.stopPrice)
          );
          
          if (restoreResult.success) {
            console.log(`   ✅ Restored ${oldOrder.type} order`);
          } else {
            console.warn(`   ⚠️ Failed to restore ${oldOrder.type} order`);
          }
        }
        
        return { success: false, error: `TP order failed: ${tpResult.error}` };
      }

      console.log(`   ✅ Placed TP order #${tpResult.orderId}`);

      // STEP 3: Place new SL order
      const slOrder = desiredOrders.find(o => o.purpose === 'stop_loss')!;
      const slResult = await this.placeExchangeOrder(
        position.symbol,
        slOrder.type,
        slOrder.side,
        slOrder.quantity,
        slOrder.price
      );

      if (!slResult.success) {
        // ROLLBACK: Cancel the TP order we just placed and restore ONLY cancelled orders
        console.error(`❌ Failed to place SL order: ${slResult.error}`);
        console.log(`🔄 Attempting rollback...`);
        
        // Cancel the TP we just placed
        if (tpResult.orderId) {
          console.log(`   Cancelling TP order #${tpResult.orderId}`);
          await this.cancelExchangeOrder(position.symbol, tpResult.orderId);
        }
        
        // Restore ONLY the orders we successfully cancelled
        console.log(`   Restoring ${cancelledOrders.length} cancelled orders...`);
        for (const oldOrder of cancelledOrders) {
          const restoreResult = await this.placeExchangeOrder(
            position.symbol,
            oldOrder.type,
            oldOrder.side,
            parseFloat(oldOrder.origQty),
            parseFloat(oldOrder.type === 'LIMIT' ? oldOrder.price : oldOrder.stopPrice)
          );
          
          if (restoreResult.success) {
            console.log(`   ✅ Restored ${oldOrder.type} order`);
          } else {
            console.warn(`   ⚠️ Failed to restore ${oldOrder.type} order`);
          }
        }
        
        return { success: false, error: `SL order failed: ${slResult.error}` };
      }

      console.log(`   ✅ Placed SL order #${slResult.orderId}`);
      console.log(`✅ Protective orders updated successfully for ${position.symbol} ${position.side}`);

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
