import { createHmac } from 'crypto';

async function checkExchangePnl() {
  console.log('📥 Fetching actual P&L from exchange API...');

  const apiKey = process.env.ASTER_API_KEY;
  const secretKey = process.env.ASTER_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.error('❌ API keys not configured');
    return;
  }

  // Fetch realized P&L from exchange (last 30 days)
  const startTime = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const endTime = Date.now();
  const timestamp = Date.now();

  const queryParams = `incomeType=REALIZED_PNL&startTime=${startTime}&endTime=${endTime}&limit=1000&timestamp=${timestamp}`;

  const signature = createHmac('sha256', secretKey)
    .update(queryParams)
    .digest('hex');

  const response = await fetch(
    `https://fapi.asterdex.com/fapi/v1/income?${queryParams}&signature=${signature}`,
    {
      headers: { 'X-MBX-APIKEY': apiKey },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Failed to fetch P&L: ${response.status} ${errorText}`);
    return;
  }

  const pnlEvents = await response.json();

  console.log(`\n📊 Fetched ${pnlEvents.length} P&L events from exchange (last 30 days)`);

  // Calculate total
  let totalPnl = 0;
  let positiveCount = 0;
  let negativeCount = 0;

  for (const event of pnlEvents) {
    const pnl = parseFloat(event.income);
    totalPnl += pnl;

    if (pnl > 0) positiveCount++;
    else if (pnl < 0) negativeCount++;
  }

  console.log(`\n💰 Exchange P&L Summary (Last 30 Days):`);
  console.log(`   Total P&L Events: ${pnlEvents.length}`);
  console.log(`   Total Realized P&L: $${totalPnl.toFixed(2)}`);
  console.log(`   Positive P&L events: ${positiveCount}`);
  console.log(`   Negative P&L events: ${negativeCount}`);

  // Show largest wins/losses
  const sorted = [...pnlEvents].sort((a, b) => parseFloat(b.income) - parseFloat(a.income));

  console.log(`\n📈 Top 10 Wins:`);
  for (let i = 0; i < Math.min(10, sorted.length); i++) {
    const event = sorted[i];
    const pnl = parseFloat(event.income);
    if (pnl <= 0) break;
    console.log(`   ${event.symbol}: $${pnl.toFixed(2)} at ${new Date(event.time).toISOString()}`);
  }

  console.log(`\n📉 Top 10 Losses:`);
  for (let i = sorted.length - 1; i >= Math.max(sorted.length - 10, 0); i--) {
    const event = sorted[i];
    const pnl = parseFloat(event.income);
    if (pnl >= 0) break;
    console.log(`   ${event.symbol}: $${pnl.toFixed(2)} at ${new Date(event.time).toISOString()}`);
  }
}

checkExchangePnl().catch(console.error);
