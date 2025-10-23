import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { positions } from '@shared/schema';
import { createHmac } from 'crypto';

async function analyzeGroupingMismatch() {
  console.log('🔍 ANALYZING EXCHANGE vs DATABASE GROUPING\n');

  // Fetch exchange data
  const apiKey = process.env.ASTER_API_KEY;
  const secretKey = process.env.ASTER_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.error('❌ API keys not configured');
    return;
  }

  console.log('📥 Fetching exchange P&L events...');
  const startTime = new Date('2025-10-02').getTime();
  const endTime = Date.now();
  const limit = 1000;

  let allExchangeEvents: any[] = [];
  let currentStartTime = startTime;

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

    if (!response.ok) break;

    const batch = await response.json();
    if (batch.length === 0) break;

    allExchangeEvents.push(...batch);
    if (batch.length < limit) break;

    currentStartTime = batch[batch.length - 1].time + 1;
  }

  // Fetch database positions
  console.log('📊 Fetching database positions...');
  if (!process.env.NEON_DATABASE_URL) {
    console.error('❌ NEON_DATABASE_URL not configured');
    return;
  }

  const sql = neon(process.env.NEON_DATABASE_URL);
  const db = drizzle({ client: sql });
  const allPositions = await db.select().from(positions);
  const closedWithPnl = allPositions.filter(p => !p.isOpen && p.realizedPnl !== null);

  console.log(`\n✅ Exchange: ${allExchangeEvents.length} P&L events`);
  console.log(`✅ Database: ${closedWithPnl.length} closed positions\n`);

  // Group exchange events by symbol
  const exchangeBySymbol = new Map<string, number>();
  let exchangeTotal = 0;

  for (const event of allExchangeEvents) {
    const symbol = event.symbol;
    const pnl = parseFloat(event.income);
    exchangeBySymbol.set(symbol, (exchangeBySymbol.get(symbol) || 0) + pnl);
    exchangeTotal += pnl;
  }

  // Group database positions by symbol
  const dbBySymbol = new Map<string, number>();
  let dbTotal = 0;

  for (const pos of closedWithPnl) {
    const symbol = pos.symbol;
    const pnl = parseFloat(pos.realizedPnl!);
    dbBySymbol.set(symbol, (dbBySymbol.get(symbol) || 0) + pnl);
    dbTotal += pnl;
  }

  console.log('=' .repeat(60));
  console.log('\n📊 P&L BY SYMBOL COMPARISON:\n');

  // Get all unique symbols
  const allSymbols = new Set([...exchangeBySymbol.keys(), ...dbBySymbol.keys()]);
  const sortedSymbols = Array.from(allSymbols).sort((a, b) => {
    const diffA = Math.abs((dbBySymbol.get(a) || 0) - (exchangeBySymbol.get(a) || 0));
    const diffB = Math.abs((dbBySymbol.get(b) || 0) - (exchangeBySymbol.get(b) || 0));
    return diffB - diffA;
  });

  console.log('Top 15 symbols with biggest discrepancies:\n');
  for (let i = 0; i < Math.min(15, sortedSymbols.length); i++) {
    const symbol = sortedSymbols[i];
    const exchangePnl = exchangeBySymbol.get(symbol) || 0;
    const dbPnl = dbBySymbol.get(symbol) || 0;
    const diff = dbPnl - exchangePnl;

    console.log(`${symbol}:`);
    console.log(`   Exchange: $${exchangePnl.toFixed(2)}`);
    console.log(`   Database: $${dbPnl.toFixed(2)}`);
    console.log(`   Difference: $${diff.toFixed(2)} ${diff > 0 ? '(DB higher ⚠️)' : '(Exchange higher)'}\n`);
  }

  console.log('=' .repeat(60));
  console.log('\n💰 OVERALL TOTALS:\n');
  console.log(`Exchange Total: $${exchangeTotal.toFixed(2)}`);
  console.log(`Database Total: $${dbTotal.toFixed(2)}`);
  console.log(`Difference: $${(dbTotal - exchangeTotal).toFixed(2)}\n`);

  // Hypothesis: Check if DB positions have DCA layers that might be inflating P&L
  console.log('🔬 HYPOTHESIS CHECK: DCA Layer Inflation\n');

  const positionsWithLayers = closedWithPnl.filter(p => p.dcaLayerNumber && p.dcaLayerNumber > 1);
  console.log(`Positions that are DCA layers (layer > 1): ${positionsWithLayers.length}`);

  if (positionsWithLayers.length > 0) {
    const dcaLayerPnl = positionsWithLayers.reduce((sum, p) => sum + parseFloat(p.realizedPnl!), 0);
    console.log(`P&L from DCA layers: $${dcaLayerPnl.toFixed(2)}`);
    console.log(`\n⚠️  This might explain the discrepancy if DCA layers are counted`);
    console.log(`    separately in DB but combined in exchange API.\n`);
  }
}

analyzeGroupingMismatch().catch(console.error);
