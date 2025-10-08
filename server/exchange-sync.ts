import { createHmac } from 'crypto';
import { storage } from './storage';
import type { TradeSession } from '@shared/schema';
import { db } from './db';
import { positions, transfers, commissions, fundingFees } from '@shared/schema';
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
    console.log(`✅ Fetched ${trades.length} account trades from exchange`);
    
    return { success: true, trades };
  } catch (error) {
    console.error('❌ Error fetching account trades:', error);
    return { success: false, error: String(error) };
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
    
    console.log(`  📋 ${key}: ${groupTrades.length} trades (${groupTrades.filter((t: typeof trades[0]) => (side === 'long' && t.side === 'BUY') || (side === 'short' && t.side === 'SELL')).length} entries, ${groupTrades.filter((t: typeof trades[0]) => (side === 'long' && t.side === 'SELL') || (side === 'short' && t.side === 'BUY')).length} exits)`);
    
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
              realizedPnl: totalPnl,
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
    
    // Fetch trades from when the session started
    const startTime = new Date(session.startedAt).getTime();
    const endTime = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
    
    const result = await fetchAccountTrades({
      startTime,
      endTime,
      limit: 1000,
    });
    
    if (!result.success || !result.trades) {
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
    const queryParams = `incomeType=TRANSFER&limit=10000&timestamp=${timestamp}`;
    
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

// Sync commissions from exchange income API
export async function syncCommissions(userId: string): Promise<{
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
    
    // Fetch COMMISSION income from API (all historical data)
    const timestamp = Date.now();
    const queryParams = `incomeType=COMMISSION&limit=10000&timestamp=${timestamp}`;
    
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
      console.error(`❌ Failed to fetch commissions: ${response.status} ${errorText}`);
      return { success: false, addedCount: 0, error: `HTTP ${response.status}: ${errorText}` };
    }

    const commissionData = await response.json();
    console.log(`📊 Fetched ${commissionData.length} commission events from exchange`);
    
    // Batch insert commissions using onConflictDoNothing for idempotency
    const insertedCommissions = await db.insert(commissions)
      .values(commissionData.map((comm: any) => ({
        userId,
        symbol: comm.symbol || '',
        amount: comm.income || '0',
        asset: comm.asset || 'USDT',
        tradeId: comm.tradeId || null,
        timestamp: new Date(comm.time),
      })))
      .onConflictDoNothing()
      .returning({ id: commissions.id });
    
    const addedCount = insertedCommissions.length;
    
    console.log(`✅ Synced ${addedCount} new commissions to database`);
    
    return { success: true, addedCount };
  } catch (error) {
    console.error('❌ Error syncing commissions:', error);
    return { success: false, addedCount: 0, error: String(error) };
  }
}

// Sync funding fees from exchange income API
export async function syncFundingFees(userId: string): Promise<{
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
    
    // Fetch FUNDING_FEE income from API (all historical data)
    const timestamp = Date.now();
    const queryParams = `incomeType=FUNDING_FEE&limit=10000&timestamp=${timestamp}`;
    
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
      console.error(`❌ Failed to fetch funding fees: ${response.status} ${errorText}`);
      return { success: false, addedCount: 0, error: `HTTP ${response.status}: ${errorText}` };
    }

    const fundingData = await response.json();
    console.log(`📊 Fetched ${fundingData.length} funding fee events from exchange`);
    
    // Batch insert funding fees using onConflictDoNothing for idempotency
    const insertedFundingFees = await db.insert(fundingFees)
      .values(fundingData.map((funding: any) => ({
        userId,
        symbol: funding.symbol || '',
        amount: funding.income || '0',
        asset: funding.asset || 'USDT',
        timestamp: new Date(funding.time),
      })))
      .onConflictDoNothing()
      .returning({ id: fundingFees.id });
    
    const addedCount = insertedFundingFees.length;
    
    console.log(`✅ Synced ${addedCount} new funding fees to database`);
    
    return { success: true, addedCount };
  } catch (error) {
    console.error('❌ Error syncing funding fees:', error);
    return { success: false, addedCount: 0, error: String(error) };
  }
}
