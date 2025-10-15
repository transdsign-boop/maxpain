import { createHmac } from 'crypto';

// Fetch actual fill data from Aster DEX for a specific order
export async function fetchActualFills(params: {
  symbol: string;
  orderId: string;
}): Promise<{
  success: boolean;
  fills?: Array<{
    price: string;
    qty: string;
    commission: string;
    commissionAsset: string;
    realizedPnl: string;
    time: number;
    maker: boolean;
  }>;
  error?: string;
}> {
  try {
    const { symbol, orderId } = params;
    
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, error: 'API keys not configured' };
    }
    
    // Build request parameters
    const timestamp = Date.now();
    const queryParams: Record<string, string | number> = {
      symbol,
      orderId,
      timestamp,
      recvWindow: 5000,
    };
    
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
    
    // Fetch actual fills from exchange
    const response = await fetch(`https://fapi.asterdex.com/fapi/v1/userTrades?${signedParams}`, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': apiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed to fetch fills: ${response.status} ${errorText}`);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
    
    const fills = await response.json();
    console.log(`✅ Fetched ${fills.length} actual fill(s) from exchange for order ${orderId}`);
    
    return { success: true, fills };
  } catch (error) {
    console.error('❌ Error fetching actual fills:', error);
    return { success: false, error: String(error) };
  }
}

// Aggregate multiple fills into a single consolidated fill
export function aggregateFills(fills: Array<{
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  realizedPnl: string;
  time: number;
  maker: boolean;
}>): {
  avgPrice: number;
  totalQty: number;
  totalCommission: number;
  totalValue: number;
  isMaker: boolean;
  timestamp: number;
} {
  if (fills.length === 0) {
    throw new Error('Cannot aggregate empty fills array');
  }

  let totalQty = 0;
  let totalValue = 0;
  let totalCommission = 0;
  let makerFills = 0;
  let latestTimestamp = 0;

  for (const fill of fills) {
    const price = parseFloat(fill.price);
    const qty = parseFloat(fill.qty);
    const commission = parseFloat(fill.commission);

    totalQty += qty;
    totalValue += price * qty;
    totalCommission += commission;
    
    if (fill.maker) {
      makerFills++;
    }
    
    // Track the latest timestamp
    if (fill.time > latestTimestamp) {
      latestTimestamp = fill.time;
    }
  }

  // Calculate weighted average price
  const avgPrice = totalValue / totalQty;
  
  // Consider it a maker fill if majority are maker fills
  const isMaker = makerFills > fills.length / 2;

  console.log(`📊 Aggregated ${fills.length} fill(s): Avg Price=$${avgPrice.toFixed(6)}, Total Qty=${totalQty.toFixed(4)}, Total Commission=$${totalCommission.toFixed(4)}, Timestamp=${new Date(latestTimestamp).toISOString()}`);

  return {
    avgPrice,
    totalQty,
    totalCommission,
    totalValue,
    isMaker,
    timestamp: latestTimestamp,
  };
}

// Fetch realized P&L for a position from exchange API (with pagination)
export async function fetchPositionPnL(params: {
  symbol: string;
  side: 'long' | 'short';
  openedAt: Date;
  closedAt: Date;
}): Promise<{
  success: boolean;
  realizedPnl?: number;
  error?: string;
}> {
  try {
    const { symbol, side, openedAt, closedAt } = params;
    
    const apiKey = process.env.ASTER_API_KEY;
    const secretKey = process.env.ASTER_SECRET_KEY;
    
    if (!apiKey || !secretKey) {
      return { success: false, error: 'API keys not configured' };
    }
    
    // Fetch ALL trades using fromId pagination (cannot combine with time filters)
    const allTrades: any[] = [];
    let fromId: number | null = null;
    let batchCount = 0;
    
    while (true) {
      batchCount++;
      const timestamp = Date.now();
      
      // Build params - use fromId for pagination
      let params = `symbol=${symbol}&timestamp=${timestamp}&limit=1000&recvWindow=5000`;
      if (fromId !== null) {
        params += `&fromId=${fromId}`;
      }
      
      // Create query string (sorted alphabetically)
      const queryString = params.split('&').sort().join('&');
      
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
        console.error(`❌ Failed to fetch P&L batch ${batchCount}: ${response.status} ${errorText}`);
        break;
      }
      
      const batchTrades = await response.json();
      
      if (!Array.isArray(batchTrades) || batchTrades.length === 0) {
        break; // No more trades
      }
      
      allTrades.push(...batchTrades);
      
      // If we got less than 1000 trades, we've reached the end
      if (batchTrades.length < 1000) {
        break;
      }
      
      // Set fromId for next iteration
      const lastTrade = batchTrades[batchTrades.length - 1];
      fromId = lastTrade.id + 1;
    }
    
    if (allTrades.length === 0) {
      console.log(`ℹ️ No trades found for ${symbol} ${side} (possibly older than 7 days)`);
      return { success: false, error: 'No trades found (may be older than API retention period)' };
    }
    
    // Filter trades by time window (since we can't use time filters with fromId)
    const startTime = openedAt.getTime();
    const endTime = closedAt.getTime();
    const tradesInWindow = allTrades.filter(t => t.time >= startTime && t.time <= endTime);
    
    // Filter for CLOSING trades based on position side
    // For LONG positions: SELL trades have P&L
    // For SHORT positions: BUY trades have P&L
    const closingSide = side === 'long' ? 'SELL' : 'BUY';
    const closingTrades = tradesInWindow.filter((t: any) => t.side === closingSide);
    
    // Sum up realized P&L from closing trades
    const totalPnl = closingTrades.reduce((sum: number, trade: any) => {
      return sum + parseFloat(trade.realizedPnl || '0');
    }, 0);
    
    console.log(`✅ Fetched P&L for ${symbol} ${side}: $${totalPnl.toFixed(2)} from ${closingTrades.length} closing trades (${allTrades.length} total fetched)`);
    
    return { success: true, realizedPnl: totalPnl };
  } catch (error) {
    console.error('❌ Error fetching position P&L:', error);
    return { success: false, error: String(error) };
  }
}
