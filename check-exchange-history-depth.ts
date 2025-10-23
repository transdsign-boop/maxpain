import { createHmac } from 'crypto';

/**
 * Check how far back exchange trade history goes
 */

async function checkHistoryDepth() {
  console.log('🔍 CHECKING EXCHANGE TRADE HISTORY DEPTH\n');
  console.log('=' .repeat(70));

  const apiKey = process.env.ASTER_API_KEY;
  const secretKey = process.env.ASTER_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.error('❌ API keys not configured');
    return;
  }

  // Check realized P&L history
  console.log('\n📊 CHECKING REALIZED P&L HISTORY (/fapi/v1/income):\n');

  const startTime = new Date('2024-01-01').getTime(); // Start from Jan 1, 2024
  const endTime = Date.now();
  const timestamp = Date.now();

  const queryParams = `incomeType=REALIZED_PNL&startTime=${startTime}&endTime=${endTime}&limit=1000&timestamp=${timestamp}`;
  const signature = createHmac('sha256', secretKey).update(queryParams).digest('hex');

  const response = await fetch(
    `https://fapi.asterdex.com/fapi/v1/income?${queryParams}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': apiKey } }
  );

  if (!response.ok) {
    console.error(`❌ Failed: ${response.status} ${await response.text()}`);
  } else {
    const data = await response.json();
    if (data.length > 0) {
      const oldest = data[data.length - 1];
      const newest = data[0];
      console.log(`   Total events fetched: ${data.length}`);
      console.log(`   Oldest event: ${new Date(oldest.time).toISOString()} ($${parseFloat(oldest.income).toFixed(2)} ${oldest.symbol})`);
      console.log(`   Newest event: ${new Date(newest.time).toISOString()} ($${parseFloat(newest.income).toFixed(2)} ${newest.symbol})`);
    }
  }

  // Check user trades history
  console.log('\n📈 CHECKING USER TRADES HISTORY (/fapi/v1/userTrades):\n');

  // Try fetching trades for a symbol (we need to specify a symbol)
  const testSymbol = 'BTCUSDT';
  const tradeStartTime = new Date('2024-01-01').getTime();
  const tradeTimestamp = Date.now();

  const tradeParams = `symbol=${testSymbol}&startTime=${tradeStartTime}&limit=1000&timestamp=${tradeTimestamp}`;
  const tradeSignature = createHmac('sha256', secretKey).update(tradeParams).digest('hex');

  const tradeResponse = await fetch(
    `https://fapi.asterdex.com/fapi/v1/userTrades?${tradeParams}&signature=${tradeSignature}`,
    { headers: { 'X-MBX-APIKEY': apiKey } }
  );

  if (!tradeResponse.ok) {
    console.error(`❌ Failed: ${tradeResponse.status} ${await tradeResponse.text()}`);
  } else {
    const trades = await tradeResponse.json();
    if (trades.length > 0) {
      const oldest = trades[trades.length - 1];
      const newest = trades[0];
      console.log(`   Total ${testSymbol} trades: ${trades.length}`);
      console.log(`   Oldest trade: ${new Date(oldest.time).toISOString()}`);
      console.log(`   Newest trade: ${new Date(newest.time).toISOString()}`);
      console.log(`\n   Sample trade structure:`);
      console.log(JSON.stringify(newest, null, 2));
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('\n💡 RECOMMENDATION:\n');
  console.log('   Use /fapi/v1/userTrades to fetch ALL trade history');
  console.log('   Group trades by: symbol + side + positionSide');
  console.log('   Entry trades: realizedPnl = "0"');
  console.log('   Exit trades: realizedPnl != "0"');
  console.log('   This will give you the TRUE position structure from exchange\n');
}

checkHistoryDepth().catch(console.error);
