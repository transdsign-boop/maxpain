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
} {
  if (fills.length === 0) {
    throw new Error('Cannot aggregate empty fills array');
  }

  let totalQty = 0;
  let totalValue = 0;
  let totalCommission = 0;
  let makerFills = 0;

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
  }

  // Calculate weighted average price
  const avgPrice = totalValue / totalQty;
  
  // Consider it a maker fill if majority are maker fills
  const isMaker = makerFills > fills.length / 2;

  console.log(`📊 Aggregated ${fills.length} fill(s): Avg Price=$${avgPrice.toFixed(6)}, Total Qty=${totalQty.toFixed(4)}, Total Commission=$${totalCommission.toFixed(4)}`);

  return {
    avgPrice,
    totalQty,
    totalCommission,
    totalValue,
    isMaker,
  };
}
