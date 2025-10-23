import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { positions, tradeSessions } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { createHmac } from 'crypto';

async function comparePnl() {
  console.log('🔍 COMPREHENSIVE P&L COMPARISON\n');
  console.log('='  .repeat(60));

  // ========== EXCHANGE API P&L ==========
  console.log('\n📥 Fetching P&L from Exchange API...');

  const apiKey = process.env.ASTER_API_KEY;
  const secretKey = process.env.ASTER_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.error('❌ API keys not configured');
    return;
  }

  // Fetch all realized P&L from exchange (since Oct 2)
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed to fetch: ${response.status} ${errorText}`);
      break;
    }

    const batch = await response.json();
    if (batch.length === 0) break;

    allExchangeEvents.push(...batch);
    if (batch.length < limit) break;

    const lastEvent = batch[batch.length - 1];
    currentStartTime = lastEvent.time + 1;
  }

  let exchangeTotalPnl = 0;
  let exchangeWins = 0;
  let exchangeLosses = 0;

  for (const event of allExchangeEvents) {
    const pnl = parseFloat(event.income);
    exchangeTotalPnl += pnl;
    if (pnl > 0) exchangeWins++;
    else if (pnl < 0) exchangeLosses++;
  }

  console.log(`✅ Fetched ${allExchangeEvents.length} P&L events from exchange`);

  // ========== DATABASE P&L ==========
  console.log('\n📊 Fetching P&L from Neon Database...');

  if (!process.env.NEON_DATABASE_URL) {
    console.error('❌ NEON_DATABASE_URL not configured');
    return;
  }

  const sql = neon(process.env.NEON_DATABASE_URL);
  const db = drizzle({ client: sql });

  // Get all sessions
  const allSessions = await db.select().from(tradeSessions);

  // Get all positions
  const allPositions = await db.select().from(positions);

  // Filter for closed positions with realized P&L
  const closedPositions = allPositions.filter(p => !p.isOpen && p.realizedPnl !== null);

  let dbTotalPnl = 0;
  let dbWins = 0;
  let dbLosses = 0;

  for (const pos of closedPositions) {
    const pnl = parseFloat(pos.realizedPnl || '0');
    dbTotalPnl += pnl;
    if (pnl > 0) dbWins++;
    else if (pnl < 0) dbLosses++;
  }

  console.log(`✅ Found ${closedPositions.length} closed positions in database`);

  // ========== COMPARISON ==========
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 COMPARISON RESULTS:\n');

  console.log('EXCHANGE API (Source of Truth):');
  console.log(`  Total Events: ${allExchangeEvents.length}`);
  console.log(`  Total P&L: $${exchangeTotalPnl.toFixed(2)}`);
  console.log(`  Wins: ${exchangeWins}, Losses: ${exchangeLosses}`);
  console.log(`  Win Rate: ${((exchangeWins / (exchangeWins + exchangeLosses)) * 100).toFixed(1)}%`);

  console.log('\nNEON DATABASE:');
  console.log(`  Total Positions: ${allPositions.length}`);
  console.log(`  Closed Positions: ${closedPositions.length}`);
  console.log(`  Total P&L: $${dbTotalPnl.toFixed(2)}`);
  console.log(`  Wins: ${dbWins}, Losses: ${dbLosses}`);
  console.log(`  Win Rate: ${((dbWins / (dbWins + dbLosses)) * 100).toFixed(1)}%`);

  console.log('\nDISCREPANCY ANALYSIS:');
  const pnlDiff = exchangeTotalPnl - dbTotalPnl;
  const eventDiff = allExchangeEvents.length - closedPositions.length;

  console.log(`  P&L Difference: $${pnlDiff.toFixed(2)} ${pnlDiff > 0 ? '(Exchange has more)' : '(Database has more)'}`);
  console.log(`  Event Count Difference: ${eventDiff} ${eventDiff > 0 ? '(Exchange has more)' : '(Database has more)'}`);

  if (Math.abs(pnlDiff) < 0.01) {
    console.log(`  ✅ P&L is in sync!`);
  } else if (Math.abs(pnlDiff) < 1) {
    console.log(`  ⚠️  Minor discrepancy (likely rounding)`);
  } else {
    console.log(`  ❌ Significant discrepancy detected`);
  }

  // Session breakdown
  console.log('\n📁 SESSION BREAKDOWN:');
  const liveSessions = allSessions.filter(s => !s.isPaperMode);
  const paperSessions = allSessions.filter(s => s.isPaperMode);

  console.log(`  Total Sessions: ${allSessions.length}`);
  console.log(`  Live Sessions: ${liveSessions.length}`);
  console.log(`  Paper Sessions: ${paperSessions.length}`);
  console.log(`  Open Positions: ${allPositions.filter(p => p.isOpen).length}`);
  console.log(`  Closed Positions: ${allPositions.filter(p => !p.isOpen).length}`);

  console.log('\n' + '='.repeat(60));
}

comparePnl().catch(console.error);
