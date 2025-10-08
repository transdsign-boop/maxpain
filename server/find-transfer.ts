import { createHmac } from 'crypto';

async function findTransfer() {
  const apiKey = process.env.ASTER_API_KEY;
  const secretKey = process.env.ASTER_SECRET_KEY;
  
  if (!apiKey || !secretKey) {
    console.error('Missing API keys');
    return;
  }

  // Fetch income history (transfers, funding, etc)
  const timestamp = Date.now();
  const queryParams: Record<string, string | number> = {
    timestamp,
    recvWindow: 60000,
    limit: 1000,
    startTime: new Date('2025-10-03T00:00:00Z').getTime(),
    endTime: new Date('2025-10-04T00:00:00Z').getTime(),
  };

  const queryString = Object.entries(queryParams)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const signature = createHmac('sha256', secretKey)
    .update(queryString)
    .digest('hex');

  const response = await fetch(`https://fapi.asterdex.com/fapi/v1/income?${queryString}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': apiKey },
  });

  if (!response.ok) {
    console.error('Failed to fetch income:', await response.text());
    return;
  }

  const income = await response.json();
  
  // Find transfer around $289
  const transfers = income.filter((i: any) => 
    i.incomeType === 'TRANSFER' && 
    Math.abs(parseFloat(i.income) - 289.30) < 1
  );

  console.log('💸 Transfers around $289.30 on Oct 3, 2025:');
  for (const t of transfers) {
    const time = new Date(t.time);
    const pacific = new Date(time.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    console.log(`   ${time.toISOString()} (UTC)`);
    console.log(`   ${pacific.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} (Pacific)`);
    console.log(`   Amount: $${t.income}`);
    console.log(`   Asset: ${t.asset}`);
    console.log('');
  }

  // Show all transfers on Oct 3
  console.log('💸 All transfers on Oct 3, 2025:');
  const allTransfers = income.filter((i: any) => i.incomeType === 'TRANSFER');
  for (const t of allTransfers) {
    const time = new Date(t.time);
    console.log(`   ${time.toISOString()} - $${t.income} ${t.asset}`);
  }
}

findTransfer().catch(console.error);
