import { createHmac } from 'crypto';

async function getAllExchangePnl() {
  console.log('📥 Fetching ALL P&L from exchange since Oct 2...');

  const apiKey = process.env.ASTER_API_KEY;
  const secretKey = process.env.ASTER_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.error('❌ API keys not configured');
    return;
  }

  // Start from Oct 2, 2025
  const startTime = new Date('2025-10-02').getTime();
  const endTime = Date.now();
  const limit = 1000;

  let allEvents: any[] = [];
  let currentStartTime = startTime;

  // Paginate through ALL events
  while (true) {
    const timestamp = Date.now();
    const queryParams = `incomeType=REALIZED_PNL&startTime=${currentStartTime}&endTime=${endTime}&limit=${limit}&timestamp=${timestamp}`;

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
      console.error(`❌ Failed to fetch: ${response.status} ${errorText}`);
      break;
    }

    const batch = await response.json();
    console.log(`   Fetched batch of ${batch.length} events...`);

    if (batch.length === 0) break;

    allEvents.push(...batch);

    if (batch.length < limit) break;

    // Move to next batch
    const lastEvent = batch[batch.length - 1];
    currentStartTime = lastEvent.time + 1;
  }

  console.log(`\n📊 COMPLETE EXCHANGE P&L (since Oct 2):`);
  console.log(`   Total events: ${allEvents.length}`);

  let totalPnl = 0;
  let wins = 0;
  let losses = 0;

  for (const event of allEvents) {
    const pnl = parseFloat(event.income);
    totalPnl += pnl;
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
  }

  console.log(`   Total P&L: $${totalPnl.toFixed(2)}`);
  console.log(`   Wins: ${wins}, Losses: ${losses}`);
  console.log(`   Win Rate: ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
}

getAllExchangePnl().catch(console.error);
