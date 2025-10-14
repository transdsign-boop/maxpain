import { createHmac } from 'crypto';
import { storage } from './storage';
import type { TradeSession } from '@shared/schema';
import { db } from './db';
import { positions, transfers } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Fetch all account trades from Aster DEX within a time range
export async function fetchAccountTrades(params: {
  symbol?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  trades?: Array<{
    symbol: string;
    id: number;
    orderId: number;
    side: 'BUY' | 'SELL';
    price: string;
    qty: string;
    realizedPnl: string;
    marginAsset: string;
    quoteQty: string;
    commission: string;
    commissionAsset: string;
    time: number;
    positionSide: 'LONG' | 'SHORT' | 'BOTH';
    maker: boolean;
    buyer: boolean;
  }>;
  error?: string;
}> {
  try {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, error: 'API keys not configured' };
    }
    
    // Build request parameters
    const timestamp = Date.now();
    const queryParams: Record<string, string | number> = {
      timestamp,
      recvWindow: 60000,
      limit: params.limit || 1000, // Max 1000 trades per request
    };
    
    if (params.symbol) {
      queryParams.symbol = params.symbol;
    }
    
    if (params.startTime) {
      queryParams.startTime = params.startTime;
    }
    
    if (params.endTime) {
      queryParams.endTime = params.endTime;
    }
    
    // Create query string (sorted alphabetically)
    const queryString = Object.entries(queryParams)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    
    // Generate signature
    const signature = createHmac('sha256', secretKey)
      .update(queryString)
      .digest('hex');
    
    const signedParams = `${queryString}&signature=${signature}`;
    
    // Fetch account trades from exchange
    const response = await fetch(`https://fapi.asterdex.com/fapi/v1/userTrades?${signedParams}`, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': apiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed to fetch account trades: ${response.status} ${errorText}`);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
    
    const trades = await response.json();
    // Reduced logging - only show count (improves performance)
    if (trades.length > 0) {
      console.log(`✅ Fetched ${trades.length} account trades from exchange`);
    } else {
      console.log('⚠️ No trades returned from exchange API');
    }
    
    return { success: true, trades };
  } catch (error) {
    console.error('❌ Error fetching account trades:', error);
    return { success: false, error: String(error) };
  }
}

// Fetch ALL account trades with pagination (no limit)
// Note: Exchange API has 7-day max window, so we chunk requests
export async function fetchAllAccountTrades(params: {
  symbol?: string;
  startTime?: number;
  endTime?: number;
}): Promise<{
  success: boolean;
  trades: Array<{
    symbol: string;
    id: number;
    orderId: number;
    side: 'BUY' | 'SELL';
    price: string;
    qty: string;
    realizedPnl: string;
    marginAsset: string;
    quoteQty: string;
    commission: string;
    commissionAsset: string;
    time: number;
    positionSide: 'LONG' | 'SHORT' | 'BOTH';
    maker: boolean;
    buyer: boolean;
  }>;
  error?: string;
}> {
  try {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, trades: [], error: 'API keys not configured' };
    }
    
    let allTrades: any[] = [];
    const finalEndTime = params.endTime || Date.now();
    const finalStartTime = params.startTime || 0;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const limit = 1000; // Max limit per request
    
    // Chunk into 7-day windows (exchange API limit)
    let chunkEndTime = finalEndTime;
    
    while (chunkEndTime > finalStartTime) {
      const chunkStartTime = Math.max(finalStartTime, chunkEndTime - SEVEN_DAYS);
      
      // Paginate within this 7-day chunk
      let currentEndTime = chunkEndTime;
      
      while (currentEndTime > chunkStartTime) {
        const timestamp = Date.now();
        const queryParams: Record<string, string | number> = {
          timestamp,
          recvWindow: 60000,
          limit,
          startTime: chunkStartTime,
          endTime: currentEndTime,
        };
        
        if (params.symbol) {
          queryParams.symbol = params.symbol;
        }
        
        // Create query string (sorted alphabetically)
        const queryString = Object.entries(queryParams)
          .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
          .map(([k, v]) => `${k}=${v}`)
          .join('&');
        
        // Generate signature
        const signature = createHmac('sha256', secretKey)
          .update(queryString)
          .digest('hex');
        
        const signedParams = `${queryString}&signature=${signature}`;
        
        const response = await fetch(`https://fapi.asterdex.com/fapi/v1/userTrades?${signedParams}`, {
          method: 'GET',
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ Failed to fetch account trades: ${response.status} ${errorText}`);
          return { success: false, trades: [], error: `HTTP ${response.status}: ${errorText}` };
        }
        
        const batch = await response.json();
        
        if (batch.length === 0) {
          break; // No more records in this chunk
        }
        
        allTrades.push(...batch);
        
        // If we got fewer records than the limit, we've reached the end of this chunk
        if (batch.length < limit) {
          break;
        }
        
        // Move endTime to the oldest trade's timestamp minus 1ms for next batch
        currentEndTime = batch[batch.length - 1].time - 1;
        
        // Stop if we've gone past chunk start
        if (currentEndTime <= chunkStartTime) {
          break;
        }
      }
      
      // Move to the next 7-day chunk
      chunkEndTime = chunkStartTime - 1;
    }
    
    console.log(`✅ Fetched ${allTrades.length} total account trades from exchange (paginated across ${Math.ceil((finalEndTime - finalStartTime) / SEVEN_DAYS)} 7-day chunks)`);
    
    return { success: true, trades: allTrades };
  } catch (error) {
    console.error('❌ Error fetching account trades:', error);
    return { success: false, trades: [], error: String(error) };
  }
}

// Group trades into positions (entry and exit pairs)
function groupTradesIntoPositions(trades: Array<{
  symbol: string;
  side: 'BUY' | 'SELL';
  price: string;
  qty: string;
  commission: string;
  time: number;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  realizedPnl: string;
}>): Array<{
  symbol: string;
  side: 'long' | 'short';
  entryTrades: typeof trades;
  exitTrades: typeof trades;
  openedAt: Date;
  closedAt: Date;
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  realizedPnl: number;
  totalFees: number;
}> {
  const groupedPositions: Array<{
    symbol: string;
    side: 'long' | 'short';
    entryTrades: typeof trades;
    exitTrades: typeof trades;
    openedAt: Date;
    closedAt: Date;
    avgEntryPrice: number;
    avgExitPrice: number;
    totalQuantity: number;
    realizedPnl: number;
    totalFees: number;
  }> = [];
  
  // Group by symbol first, then process chronologically to determine position direction
  const bySymbol = new Map<string, typeof trades>();
  
  for (const trade of trades) {
    if (!bySymbol.has(trade.symbol)) {
      bySymbol.set(trade.symbol, []);
    }
    bySymbol.get(trade.symbol)!.push(trade);
  }
  
  // Process each symbol's trades chronologically
  for (const [symbol, symbolTrades] of Array.from(bySymbol.entries())) {
    // Sort by time
    symbolTrades.sort((a: typeof trades[0], b: typeof trades[0]) => a.time - b.time);
    
    // Track net position (positive = long, negative = short)
    let netQty = 0;
    
    const grouped = new Map<string, typeof trades>();
    
    for (const trade of symbolTrades) {
      const qty = parseFloat(trade.qty);
      let positionSide: 'long' | 'short';
      
      if (trade.positionSide === 'LONG') {
        positionSide = 'long';
        netQty += (trade.side === 'BUY' ? qty : -qty);
      } else if (trade.positionSide === 'SHORT') {
        positionSide = 'short';
        netQty += (trade.side === 'SELL' ? -qty : qty);
      } else {
        // One-way mode: Determine position side from current net position
        const oldNetQty = netQty;
        const qtyDelta = trade.side === 'BUY' ? qty : -qty;
        const newNetQty = oldNetQty + qtyDelta;
        
        // Check if position flips (crosses zero)
        if ((oldNetQty > 0 && newNetQty < 0) || (oldNetQty < 0 && newNetQty > 0)) {
          // Position flip! Split the trade into closing + opening parts
          const closingQty = Math.abs(oldNetQty);
          const openingQty = Math.abs(newNetQty);
          const totalQty = closingQty + openingQty;
          
          // Proportionally split commission only (realizedPnl already for closed portion)
          const closingCommission = (parseFloat(trade.commission) * closingQty / totalQty).toString();
          const openingCommission = (parseFloat(trade.commission) * openingQty / totalQty).toString();
          
          // First, add closing part to existing position
          // Note: trade.realizedPnl is ALREADY for the closed portion, use it fully
          positionSide = oldNetQty > 0 ? 'long' : 'short';
          const key1 = `${trade.symbol}-${positionSide}`;
          if (!grouped.has(key1)) {
            grouped.set(key1, []);
          }
          grouped.get(key1)!.push({
            ...trade,
            qty: closingQty.toString(),
            commission: closingCommission,
            realizedPnl: trade.realizedPnl, // Full PnL goes to closing leg
          });
          
          // Then, add opening part to opposite position
          positionSide = newNetQty > 0 ? 'long' : 'short';
          const key2 = `${trade.symbol}-${positionSide}`;
          if (!grouped.has(key2)) {
            grouped.set(key2, []);
          }
          grouped.get(key2)!.push({
            ...trade,
            qty: openingQty.toString(),
            commission: openingCommission,
            realizedPnl: '0', // Opening trade has no realized PnL
          });
          
          netQty = newNetQty;
          continue; // Skip the normal processing
        }
        
        // Normal case: no flip
        if (oldNetQty > 0) {
          // Currently long
          positionSide = 'long';
        } else if (oldNetQty < 0) {
          // Currently short
          positionSide = 'short';
        } else {
          // No position, trade direction determines side
          positionSide = trade.side === 'BUY' ? 'long' : 'short';
        }
        
        netQty = newNetQty;
      }
      
      const key = `${trade.symbol}-${positionSide}`;
      
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(trade);
    }
  
    // Process each group to find entry/exit pairs
    for (const [key, groupTrades] of Array.from(grouped.entries())) {
    const [symbol, sideStr] = key.split('-');
    const side = sideStr as 'long' | 'short';
    
    // Sort by time
    groupTrades.sort((a: typeof trades[0], b: typeof trades[0]) => a.time - b.time);
    
    // Reduced logging - commenting out per-symbol details (improves performance)
    // console.log(`  📋 ${key}: ${groupTrades.length} trades (${groupTrades.filter((t: typeof trades[0]) => (side === 'long' && t.side === 'BUY') || (side === 'short' && t.side === 'SELL')).length} entries, ${groupTrades.filter((t: typeof trades[0]) => (side === 'long' && t.side === 'SELL') || (side === 'short' && t.side === 'BUY')).length} exits)`);
    
    let entryTrades: typeof trades = [];
    let exitTrades: typeof trades = [];
    let netPosition = 0;
    
    for (const trade of groupTrades) {
      const qty = parseFloat(trade.qty);
      const isEntry = (side === 'long' && trade.side === 'BUY') || (side === 'short' && trade.side === 'SELL');
      
      if (isEntry) {
        entryTrades.push(trade);
        netPosition += qty;
      } else {
        exitTrades.push(trade);
        netPosition -= qty;
        
        // If net position is zero or negative, we have a complete position
        if (netPosition <= 0) {
          if (entryTrades.length > 0 && exitTrades.length > 0) {
            // Calculate averages
            let entryValue = 0;
            let entryQty = 0;
            let exitValue = 0;
            let exitQty = 0;
            let totalFees = 0;
            let totalPnl = 0;
            
            for (const et of entryTrades) {
              const price = parseFloat(et.price);
              const qty = parseFloat(et.qty);
              entryValue += price * qty;
              entryQty += qty;
              totalFees += parseFloat(et.commission);
            }
            
            for (const xt of exitTrades) {
              const price = parseFloat(xt.price);
              const qty = parseFloat(xt.qty);
              exitValue += price * qty;
              exitQty += qty;
              totalFees += parseFloat(xt.commission);
              totalPnl += parseFloat(xt.realizedPnl);
            }
            
            groupedPositions.push({
              symbol,
              side,
              entryTrades: [...entryTrades],
              exitTrades: [...exitTrades],
              openedAt: new Date(entryTrades[0].time),
              closedAt: new Date(exitTrades[exitTrades.length - 1].time),
              avgEntryPrice: entryValue / entryQty,
              avgExitPrice: exitValue / exitQty,
              totalQuantity: Math.min(entryQty, exitQty),
              realizedPnl: totalPnl - totalFees, // NET P&L (gross minus all fees)
              totalFees,
            });
          }
          
          // Reset for next position
          entryTrades = [];
          exitTrades = [];
          netPosition = 0;
        }
      }
    }
    }
  }
  
  return groupedPositions;
}

// Sync completed trades from exchange to database
export async function syncCompletedTrades(sessionId: string): Promise<{
  success: boolean;
  addedCount: number;
  error?: string;
}> {
  try {
    const session = await storage.getTradeSession(sessionId);
    if (!session) {
      return { success: false, addedCount: 0, error: 'Session not found' };
    }
    
    // Fetch ALL trades from exchange (using pagination to fetch beyond 1000 limit)
    // Note: Exchange API may only return trades for currently open positions
    // Start from October 1st, 2025
    const startTime = new Date('2025-10-01T00:00:00Z').getTime();
    const endTime = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
    
    const result = await fetchAllAccountTrades({
      startTime,
      endTime,
    });
    
    if (!result.success) {
      return { success: false, addedCount: 0, error: result.error };
    }
    
    // Use ALL trades (including entry trades with realizedPnl = 0)
    console.log(`📊 Processing ${result.trades.length} total trades from exchange`);
    
    // Group trades into positions
    const exchangePositions = groupTradesIntoPositions(result.trades);
    
    console.log(`📊 Grouped into ${exchangePositions.length} complete positions`);
    
    // Get existing positions from database
    const existingPositions = await storage.getClosedPositions(sessionId);
    
    let addedCount = 0;
    
    // Add missing positions
    for (const exPos of exchangePositions) {
      // Check if a similar position already exists (within 5 seconds of close time)
      const isDuplicate = existingPositions.some(existing => {
        if (existing.symbol !== exPos.symbol || existing.side !== exPos.side) {
          return false;
        }
        
        // Check if closed times are within 5 seconds of each other
        const existingClosedTime = existing.closedAt ? new Date(existing.closedAt).getTime() : 0;
        const exPosClosedTime = exPos.closedAt.getTime();
        const timeDiff = Math.abs(existingClosedTime - exPosClosedTime);
        
        // Check if quantities match (within 0.1% tolerance for floating point)
        const existingQty = parseFloat(existing.totalQuantity);
        const exPosQty = exPos.totalQuantity;
        const qtyDiff = Math.abs(existingQty - exPosQty) / exPosQty;
        
        return timeDiff < 5000 && qtyDiff < 0.001;
      });
      
      if (!isDuplicate) {
        // Check if fills already exist for these trades (prevents duplicate position creation)
        const entryOrderId = `sync-entry-${exPos.entryTrades[0].time}-0`;
        const existingFill = await storage.getFillsByOrder(entryOrderId);
        
        console.log(`🔍 Checking for existing fills: orderId=${entryOrderId}, found=${existingFill.length}`);
        
        if (existingFill.length > 0) {
          console.log(`⏭️ Skipping position - fills already exist for ${exPos.symbol} ${exPos.side} (orderId: ${entryOrderId})`);
          continue;
        }
        
        console.log(`➕ Adding missing position: ${exPos.symbol} ${exPos.side} closed at ${exPos.closedAt.toISOString()}`);
        
        // Create position
        const notionalValue = exPos.avgEntryPrice * exPos.totalQuantity;
        const strategy = await storage.getStrategyBySession(sessionId);
        const leverage = strategy?.leverage || 1;
        const margin = notionalValue / leverage;
        
        const position = await storage.createPosition({
          sessionId,
          symbol: exPos.symbol,
          side: exPos.side,
          totalQuantity: exPos.totalQuantity.toString(),
          avgEntryPrice: exPos.avgEntryPrice.toString(),
          totalCost: margin.toString(),
          unrealizedPnl: '0',
          realizedPnl: exPos.realizedPnl.toString(),
          layersFilled: exPos.entryTrades.length,
          maxLayers: exPos.entryTrades.length,
          leverage,
          isOpen: false,
        });
        
        // Update timestamps to match exchange data (direct DB update since these fields are omitted from InsertPosition)
        await db.update(positions)
          .set({ 
            openedAt: exPos.openedAt,
            closedAt: exPos.closedAt,
          })
          .where(eq(positions.id, position.id));
        
        // Create fills for entry trades
        for (let i = 0; i < exPos.entryTrades.length; i++) {
          const trade = exPos.entryTrades[i];
          await storage.applyFill({
            orderId: `sync-entry-${trade.time}-${i}`,
            sessionId,
            positionId: position.id,
            symbol: trade.symbol,
            side: trade.side.toLowerCase() as 'buy' | 'sell',
            quantity: trade.qty,
            price: trade.price,
            value: (parseFloat(trade.price) * parseFloat(trade.qty)).toString(),
            fee: trade.commission,
            layerNumber: i + 1,
            filledAt: new Date(trade.time),
          });
        }
        
        // Create fills for exit trades
        for (let i = 0; i < exPos.exitTrades.length; i++) {
          const trade = exPos.exitTrades[i];
          await storage.applyFill({
            orderId: `sync-exit-${trade.time}-${i}`,
            sessionId,
            positionId: position.id,
            symbol: trade.symbol,
            side: trade.side.toLowerCase() as 'buy' | 'sell',
            quantity: trade.qty,
            price: trade.price,
            value: (parseFloat(trade.price) * parseFloat(trade.qty)).toString(),
            fee: trade.commission,
            layerNumber: 0,
            filledAt: new Date(trade.time),
          });
        }
        
        addedCount++;
      }
    }
    
    console.log(`✅ Sync complete: added ${addedCount} missing positions`);
    
    return { success: true, addedCount };
  } catch (error) {
    console.error('❌ Error syncing trades:', error);
    return { success: false, addedCount: 0, error: String(error) };
  }
}

// Sync transfers from exchange income API
export async function syncTransfers(userId: string): Promise<{
  success: boolean;
  addedCount: number;
  error?: string;
}> {
  try {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, addedCount: 0, error: 'API keys not configured' };
    }
    
    // Fetch TRANSFER income from API (all historical data)
    const timestamp = Date.now();
    const queryParams = `incomeType=TRANSFER&timestamp=${timestamp}`;
    
    const signature = createHmac('sha256', secretKey)
      .update(queryParams)
      .digest('hex');

    const response = await fetch(
      `https://fapi.asterdex.com/fapi/v1/income?${queryParams}&signature=${signature}`,
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed to fetch transfers: ${response.status} ${errorText}`);
      return { success: false, addedCount: 0, error: `HTTP ${response.status}: ${errorText}` };
    }

    const transferData = await response.json();
    console.log(`📊 Fetched ${transferData.length} transfer events from exchange`);
    
    // Batch insert transfers using onConflictDoNothing for idempotency
    const insertedTransfers = await db.insert(transfers)
      .values(transferData.map((transfer: any) => ({
        userId,
        amount: transfer.income || '0',
        asset: transfer.asset || 'USDT',
        transactionId: transfer.tranId || null,
        timestamp: new Date(transfer.time),
      })))
      .onConflictDoNothing()
      .returning({ id: transfers.id });
    
    const addedCount = insertedTransfers.length;
    
    console.log(`✅ Synced ${addedCount} new transfers to database`);
    
    return { success: true, addedCount };
  } catch (error) {
    console.error('❌ Error syncing transfers:', error);
    return { success: false, addedCount: 0, error: String(error) };
  }
}

// Fetch transfers (deposits/withdrawals) from exchange with optional date range
export async function fetchTransfers(params: {
  startTime?: number;
  endTime?: number;
}): Promise<{
  success: boolean;
  records: any[];
  total: number;
  error?: string;
}> {
  try {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, records: [], total: 0, error: 'API keys not configured' };
    }
    
    let allRecords: any[] = [];
    let currentEndTime = params.endTime || Date.now();
    const startTime = params.startTime || 0;
    const limit = 1000; // Max limit per request
    
    // Paginate backwards from endTime to startTime
    while (true) {
      const timestamp = Date.now();
      const queryParams = `incomeType=TRANSFER&startTime=${startTime}&endTime=${currentEndTime}&limit=${limit}&timestamp=${timestamp}`;
      
      const signature = createHmac('sha256', secretKey)
        .update(queryParams)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/income?${queryParams}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, records: [], total: 0, error: `HTTP ${response.status}: ${errorText}` };
      }

      const batch = await response.json();
      
      if (batch.length === 0) {
        break; // No more records
      }
      
      allRecords.push(...batch);
      
      // If we got fewer records than the limit, we've reached the end
      if (batch.length < limit) {
        break;
      }
      
      // Move endTime to the oldest record's timestamp minus 1ms for next batch
      currentEndTime = batch[batch.length - 1].time - 1;
      
      // Stop if we've gone past startTime
      if (currentEndTime <= startTime) {
        break;
      }
    }

    // Calculate total of deposits (positive income values)
    const total = allRecords.reduce((sum: number, item: any) => {
      const amount = parseFloat(item.income || '0');
      return amount > 0 ? sum + amount : sum;
    }, 0);
    
    return { success: true, records: allRecords, total };
  } catch (error) {
    return { success: false, records: [], total: 0, error: String(error) };
  }
}

// Fetch commission fees from exchange with optional date range
export async function fetchCommissions(params: {
  startTime?: number;
  endTime?: number;
}): Promise<{
  success: boolean;
  records: any[];
  total: number;
  error?: string;
}> {
  try {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, records: [], total: 0, error: 'API keys not configured' };
    }
    
    let allRecords: any[] = [];
    let currentStartTime = params.startTime || 0;
    const endTime = params.endTime || Date.now();
    const limit = 1000; // Max limit per request
    
    // Paginate forwards from startTime to endTime
    // Exchange returns OLDEST 1000 events in range (ascending order)
    let batchCount = 0;
    while (true) {
      const timestamp = Date.now();
      const queryParams = `incomeType=COMMISSION&startTime=${currentStartTime}&endTime=${endTime}&limit=${limit}&timestamp=${timestamp}`;
      
      const signature = createHmac('sha256', secretKey)
        .update(queryParams)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/income?${queryParams}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, records: [], total: 0, error: `HTTP ${response.status}: ${errorText}` };
      }

      const batch = await response.json();
      batchCount++;
      
      console.log(`📥 Commission Batch ${batchCount}: Fetched ${batch.length} events (startTime=${currentStartTime}, endTime=${endTime})`);
      
      if (batch.length === 0) {
        console.log(`🛑 Stopping: Empty batch received`);
        break; // No more records
      }
      
      allRecords.push(...batch);
      
      // If we got fewer records than the limit, we've reached the end
      if (batch.length < limit) {
        console.log(`🛑 Stopping: Batch size (${batch.length}) < limit (${limit})`);
        break;
      }
      
      // Exchange returns events in ASCENDING order (oldest first in the batch)
      // To get next batch, move startTime to the newest event's timestamp + 1ms
      const newestEventInBatch = batch[batch.length - 1];
      const nextStartTime = newestEventInBatch.time + 1;
      console.log(`➡️ Next batch: Moving startTime from ${currentStartTime} to ${nextStartTime}`);
      currentStartTime = nextStartTime;
      
      // Stop if we've reached or passed endTime
      if (currentStartTime >= endTime) {
        console.log(`🛑 Stopping: currentStartTime (${currentStartTime}) >= endTime (${endTime})`);
        break;
      }
    }
    
    console.log(`✅ Fetched ${allRecords.length} commission events: Total=$${allRecords.reduce((sum: number, item: any) => sum + Math.abs(parseFloat(item.income || '0')), 0).toFixed(2)}`);

    const total = allRecords.reduce((sum: number, item: any) => sum + Math.abs(parseFloat(item.income || '0')), 0);
    
    return { success: true, records: allRecords, total };
  } catch (error) {
    return { success: false, records: [], total: 0, error: String(error) };
  }
}

// Get total commission fees (just the sum, no individual records)
// Implements pagination to fetch ALL historical data
export async function getTotalCommissions(): Promise<{
  success: boolean;
  total: number;
  error?: string;
}> {
  const result = await fetchCommissions({});
  return { success: result.success, total: result.total, error: result.error };
}

// Fetch funding fees from exchange with optional date range
export async function fetchFundingFees(params: {
  startTime?: number;
  endTime?: number;
}): Promise<{
  success: boolean;
  records: any[];
  total: number;
  error?: string;
}> {
  try {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, records: [], total: 0, error: 'API keys not configured' };
    }
    
    let allRecords: any[] = [];
    let currentStartTime = params.startTime || 0;
    const endTime = params.endTime || Date.now();
    const limit = 1000; // Max limit per request
    
    // Paginate forwards from startTime to endTime
    // Exchange returns newest 1000 events in range, so we move startTime forward after each batch
    while (true) {
      const timestamp = Date.now();
      const queryParams = `incomeType=FUNDING_FEE&startTime=${currentStartTime}&endTime=${endTime}&limit=${limit}&timestamp=${timestamp}`;
      
      const signature = createHmac('sha256', secretKey)
        .update(queryParams)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/income?${queryParams}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, records: [], total: 0, error: `HTTP ${response.status}: ${errorText}` };
      }

      const batch = await response.json();
      
      if (batch.length === 0) {
        break; // No more records
      }
      
      allRecords.push(...batch);
      
      // If we got fewer records than the limit, we've reached the end
      if (batch.length < limit) {
        break;
      }
      
      // Exchange returns events in ASCENDING order (oldest first in the batch)
      // To get next batch, move startTime to the newest event's timestamp + 1ms
      const newestEventInBatch = batch[batch.length - 1];
      const nextStartTime = newestEventInBatch.time + 1;
      currentStartTime = nextStartTime;
      
      // Stop if we've reached or passed endTime
      if (currentStartTime >= endTime) {
        break;
      }
    }

    const total = allRecords.reduce((sum: number, item: any) => sum + parseFloat(item.income || '0'), 0);
    
    return { success: true, records: allRecords, total };
  } catch (error) {
    return { success: false, records: [], total: 0, error: String(error) };
  }
}

// Get total funding fees (just the sum, no individual records)
// Implements pagination to fetch ALL historical data
export async function getTotalFundingFees(): Promise<{
  success: boolean;
  total: number;
  error?: string;
}> {
  const result = await fetchFundingFees({});
  return { success: result.success, total: result.total, error: result.error };
}

// Fetch realized P&L from exchange income API
// Uses the official REALIZED_PNL income type which matches Portfolio Overview
export async function fetchRealizedPnl(params: {
  startTime?: number;
  endTime?: number;
}): Promise<{
  success: boolean;
  total: number;
  error?: string;
}> {
  try {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, total: 0, error: 'API keys not configured' };
    }
    
    let allRecords: any[] = [];
    let currentEndTime = params.endTime || Date.now();
    const startTime = params.startTime || 0;
    const limit = 1000;
    
    // Paginate backwards from endTime to startTime
    while (true) {
      const timestamp = Date.now();
      const queryParams = `incomeType=REALIZED_PNL&startTime=${startTime}&endTime=${currentEndTime}&limit=${limit}&timestamp=${timestamp}`;
      
      const signature = createHmac('sha256', secretKey)
        .update(queryParams)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/income?${queryParams}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, total: 0, error: `HTTP ${response.status}: ${errorText}` };
      }

      const batch = await response.json();
      
      if (batch.length === 0) {
        break;
      }
      
      allRecords.push(...batch);
      
      if (batch.length < limit) {
        break;
      }
      
      // Move endTime to the oldest record's timestamp minus 1ms for next batch
      currentEndTime = batch[batch.length - 1].time - 1;
      
      if (currentEndTime <= startTime) {
        break;
      }
    }

    // Sum all realized P&L values
    const total = allRecords.reduce((sum: number, item: any) => sum + parseFloat(item.income || '0'), 0);
    
    console.log(`✅ Fetched realized P&L from income API: $${total.toFixed(2)} (${allRecords.length} records)`);
    
    // Debug: Show breakdown of P&L by symbol
    const bySymbol: Record<string, number> = {};
    allRecords.forEach(item => {
      const symbol = item.symbol || 'UNKNOWN';
      bySymbol[symbol] = (bySymbol[symbol] || 0) + parseFloat(item.income || '0');
    });
    console.log('📊 P&L breakdown by symbol:', Object.entries(bySymbol)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([sym, pnl]) => `${sym}: $${pnl.toFixed(2)}`)
      .join(', '));
    
    return { success: true, total };
  } catch (error) {
    console.error('❌ Error fetching realized P&L:', error);
    return { success: false, total: 0, error: String(error) };
  }
}

// Fetch individual realized P&L events from exchange
// Returns all P&L events with details (symbol, income, timestamp, tradeId)
export async function fetchRealizedPnlEvents(params: {
  startTime?: number;
  endTime?: number;
}): Promise<{
  success: boolean;
  events: Array<{
    symbol: string;
    income: string;
    asset: string;
    time: number;
    tradeId: string;
    incomeType: string;
  }>;
  total: number;
  count: number;
  error?: string;
}> {
  try {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, events: [], total: 0, count: 0, error: 'API keys not configured' };
    }
    
    let allRecords: any[] = [];
    let currentStartTime = params.startTime || 0;
    const endTime = params.endTime || Date.now();
    const limit = 1000;
    
    // Paginate forwards from startTime to endTime
    // Exchange returns newest 1000 events in range, so we move startTime forward after each batch
    let batchCount = 0;
    while (true) {
      const timestamp = Date.now();
      const queryParams = `incomeType=REALIZED_PNL&startTime=${currentStartTime}&endTime=${endTime}&limit=${limit}&timestamp=${timestamp}`;
      
      const signature = createHmac('sha256', secretKey)
        .update(queryParams)
        .digest('hex');

      const response = await fetch(
        `https://fapi.asterdex.com/fapi/v1/income?${queryParams}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, events: [], total: 0, count: 0, error: `HTTP ${response.status}: ${errorText}` };
      }

      const batch = await response.json();
      batchCount++;
      
      console.log(`📥 P&L Batch ${batchCount}: Fetched ${batch.length} events (startTime=${currentStartTime}, endTime=${endTime})`);
      
      if (batch.length === 0) {
        console.log(`🛑 Stopping: Empty batch received`);
        break;
      }
      
      allRecords.push(...batch);
      
      if (batch.length < limit) {
        console.log(`🛑 Stopping: Batch size (${batch.length}) < limit (${limit})`);
        break;
      }
      
      // Exchange returns events in ASCENDING order (oldest first in the batch)
      // To get next batch, move startTime to the newest event's timestamp + 1ms
      const newestEventInBatch = batch[batch.length - 1];
      const nextStartTime = newestEventInBatch.time + 1;
      console.log(`➡️ Next batch: Moving startTime from ${currentStartTime} to ${nextStartTime}`);
      currentStartTime = nextStartTime;
      
      if (currentStartTime >= endTime) {
        console.log(`🛑 Stopping: currentStartTime (${currentStartTime}) >= endTime (${endTime})`);
        break;
      }
    }

    // Sum all realized P&L values
    const total = allRecords.reduce((sum: number, item: any) => sum + parseFloat(item.income || '0'), 0);
    
    // Get date range of fetched events
    // Exchange returns events in ASCENDING order (oldest first)
    let dateRange = null;
    if (allRecords.length > 0) {
      const oldestEvent = allRecords[0]; // First item = oldest
      const newestEvent = allRecords[allRecords.length - 1]; // Last item = newest
      dateRange = {
        oldest: new Date(oldestEvent.time).toISOString(),
        newest: new Date(newestEvent.time).toISOString(),
        oldestTimestamp: oldestEvent.time,
        newestTimestamp: newestEvent.time
      };
      console.log(`📅 P&L Date Range: ${dateRange.oldest} to ${dateRange.newest}`);
      console.log(`   Oldest: ${dateRange.oldest} (timestamp: ${oldestEvent.time})`);
      console.log(`   Newest: ${dateRange.newest} (timestamp: ${newestEvent.time})`);
    }
    
    console.log(`✅ Fetched ${allRecords.length} realized P&L events from income API: Total=$${total.toFixed(2)}`);
    
    return { 
      success: true, 
      events: allRecords,
      total,
      count: allRecords.length,
      dateRange
    };
  } catch (error) {
    console.error('❌ Error fetching realized P&L events:', error);
    return { success: false, events: [], total: 0, count: 0, error: String(error) };
  }
}

// Sync open positions from exchange to database (orphan position detection)
// This ensures all exchange positions are tracked in DB and receive protective orders
export async function syncOpenPositions(sessionId: string): Promise<{
  success: boolean;
  addedCount: number;
  error?: string;
}> {
  try {
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, addedCount: 0, error: 'API keys not configured' };
    }

    // Fetch all open positions from exchange
    const timestamp = Date.now();
    const queryParams = `timestamp=${timestamp}`;
    const signature = createHmac('sha256', secretKey)
      .update(queryParams)
      .digest('hex');

    const response = await fetch(
      `https://fapi.asterdex.com/fapi/v2/positionRisk?${queryParams}&signature=${signature}`,
      {
        headers: {
          'X-MBX-APIKEY': apiKey,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, addedCount: 0, error: `HTTP ${response.status}: ${errorText}` };
    }

    const exchangePositions = await response.json();
    
    // Filter to only non-zero positions (open positions)
    const openExchangePositions = exchangePositions.filter((pos: any) => 
      parseFloat(pos.positionAmt || '0') !== 0
    );

    if (openExchangePositions.length === 0) {
      return { success: true, addedCount: 0 };
    }

    // Get existing open positions from database
    const dbPositions = await storage.getOpenPositions(sessionId);
    const dbPositionKeys = new Set(
      dbPositions.map(p => `${p.symbol}-${p.side}`)
    );

    let addedCount = 0;

    // Check each exchange position
    for (const exPos of openExchangePositions) {
      const positionAmt = parseFloat(exPos.positionAmt || '0');
      const symbol = exPos.symbol;
      
      // Determine side from position amount and positionSide
      let side: 'long' | 'short';
      if (exPos.positionSide === 'LONG') {
        side = 'long';
      } else if (exPos.positionSide === 'SHORT') {
        side = 'short';
      } else {
        // One-way mode: use positionAmt sign
        side = positionAmt > 0 ? 'long' : 'short';
      }

      const positionKey = `${symbol}-${side}`;

      // Skip if already in database
      if (dbPositionKeys.has(positionKey)) {
        continue;
      }

      // Orphan position detected! Add to database
      console.log(`🔍 Orphan position detected: ${symbol} ${side} (qty=${Math.abs(positionAmt)})`);

      const entryPrice = parseFloat(exPos.entryPrice || '0');
      const quantity = Math.abs(positionAmt);
      const leverage = parseFloat(exPos.leverage || '1');
      const notionalValue = entryPrice * quantity;
      const margin = notionalValue / leverage;

      // Get strategy for session
      const strategy = await storage.getStrategyBySession(sessionId);

      // Create orphan position in database
      const position = await storage.createPosition({
        sessionId,
        symbol,
        side,
        totalQuantity: quantity.toString(),
        avgEntryPrice: entryPrice.toString(),
        totalCost: margin.toString(),
        unrealizedPnl: exPos.unRealizedProfit || '0',
        realizedPnl: '0',
        layersFilled: 1,
        maxLayers: strategy?.maxLayers || 1,
        leverage,
        isOpen: true,
      });

      // Create synthetic fill for the orphan position
      // Use current timestamp since we don't know exact entry time
      const now = new Date();
      await storage.applyFill({
        orderId: `orphan-${symbol}-${side}-${now.getTime()}`,
        sessionId,
        positionId: position.id,
        symbol,
        side: side === 'long' ? 'buy' : 'sell',
        quantity: quantity.toString(),
        price: entryPrice.toString(),
        value: notionalValue.toString(),
        fee: '0', // Unknown - set to 0 for orphan positions
        layerNumber: 1,
        filledAt: now,
      });

      // Update position timestamp to now (since it's an orphan we just discovered)
      await db.update(positions)
        .set({ openedAt: now })
        .where(eq(positions.id, position.id));

      console.log(`✅ Added orphan position to database: ${symbol} ${side}`);
      addedCount++;
    }

    if (addedCount > 0) {
      console.log(`✅ Synced ${addedCount} orphan positions from exchange`);
    }

    return { success: true, addedCount };
  } catch (error) {
    console.error('❌ Error syncing open positions:', error);
    return { success: false, addedCount: 0, error: String(error) };
  }
}
