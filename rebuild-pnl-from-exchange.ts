import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { positions } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { createHmac } from 'crypto';
import * as fs from 'fs';

/**
 * REBUILD P&L FROM EXCHANGE - COMPREHENSIVE VERSION
 *
 * This script completely rebuilds P&L data from the exchange API.
 * The exchange is the single source of truth.
 *
 * Steps:
 * 1. Backup current state
 * 2. Clear all realizedPnl values
 * 3. Fetch complete P&L history from exchange
 * 4. Match and update positions with correct P&L
 * 5. Verify against exchange total
 */

async function rebuildPnlFromExchange() {
  console.log('🔄 REBUILDING P&L FROM EXCHANGE API\n');
  console.log('=' .repeat(70));

  if (!process.env.NEON_DATABASE_URL) {
    console.error('❌ NEON_DATABASE_URL not configured');
    return;
  }

  const apiKey = process.env.ASTER_API_KEY;
  const secretKey = process.env.ASTER_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.error('❌ API keys not configured');
    return;
  }

  const sql = neon(process.env.NEON_DATABASE_URL);
  const db = drizzle({ client: sql });

  // ========== STEP 1: BACKUP CURRENT STATE ==========
  console.log('\n📦 STEP 1: Creating backup of current state...\n');

  const allPositions = await db.select().from(positions);
  const backupData = {
    timestamp: new Date().toISOString(),
    totalPositions: allPositions.length,
    positions: allPositions,
  };

  const backupFilename = `pnl-backup-${Date.now()}.json`;
  fs.writeFileSync(backupFilename, JSON.stringify(backupData, null, 2));
  console.log(`✅ Backup saved to: ${backupFilename}`);
  console.log(`   Total positions backed up: ${allPositions.length}`);

  const closedBefore = allPositions.filter(p => !p.isOpen && p.realizedPnl !== null);
  const totalPnlBefore = closedBefore.reduce((sum, p) => sum + parseFloat(p.realizedPnl!), 0);
  console.log(`   Positions with P&L: ${closedBefore.length}`);
  console.log(`   Current Total P&L: $${totalPnlBefore.toFixed(2)}\n`);

  // ========== STEP 2: CLEAR ALL REALIZED P&L ==========
  console.log('🗑️  STEP 2: Clearing all realizedPnl values...\n');

  const closedPositions = allPositions.filter(p => !p.isOpen);
  console.log(`   Found ${closedPositions.length} closed positions to clear`);

  // Use raw SQL for bulk update - much faster than individual updates
  await sql`
    UPDATE positions
    SET realized_pnl = NULL, updated_at = NOW()
    WHERE is_open = false
  `;

  console.log(`✅ Cleared realizedPnl from ${closedPositions.length} positions\n`);

  // ========== STEP 3: FETCH EXCHANGE P&L DATA ==========
  console.log('📥 STEP 3: Fetching P&L events from exchange API...\n');

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
    console.log(`   Fetched batch of ${batch.length} events... (total: ${allExchangeEvents.length})`);

    if (batch.length < limit) break;

    currentStartTime = batch[batch.length - 1].time + 1;
  }

  const exchangeTotalPnl = allExchangeEvents.reduce((sum, e) => sum + parseFloat(e.income), 0);
  console.log(`\n✅ Fetched ${allExchangeEvents.length} P&L events from exchange`);
  console.log(`   Exchange Total P&L: $${exchangeTotalPnl.toFixed(2)}\n`);

  // ========== STEP 4: MATCH AND UPDATE POSITIONS ==========
  console.log('🔨 STEP 4: Matching positions to exchange events...\n');

  // Group exchange events by symbol for faster lookup
  const eventsBySymbol = new Map<string, any[]>();
  for (const event of allExchangeEvents) {
    if (!eventsBySymbol.has(event.symbol)) {
      eventsBySymbol.set(event.symbol, []);
    }
    eventsBySymbol.get(event.symbol)!.push(event);
  }

  // Sort each symbol's events by time
  for (const [symbol, events] of eventsBySymbol.entries()) {
    events.sort((a, b) => a.time - b.time);
  }

  let matchedCount = 0;
  let unmatchedCount = 0;
  const usedEventIndexes = new Map<string, Set<number>>();

  // Match each position to closest exchange event
  for (const position of closedPositions) {
    if (!position.closedAt) continue;

    const positionCloseTime = new Date(position.closedAt).getTime();
    const symbolEvents = eventsBySymbol.get(position.symbol) || [];

    if (!usedEventIndexes.has(position.symbol)) {
      usedEventIndexes.set(position.symbol, new Set());
    }
    const usedIndexes = usedEventIndexes.get(position.symbol)!;

    // Find closest unused event within 5 minute window
    const timeWindow = 300000; // 5 minutes
    let closestEvent = null;
    let closestDiff = Infinity;
    let closestIndex = -1;

    for (let i = 0; i < symbolEvents.length; i++) {
      if (usedIndexes.has(i)) continue; // Skip already used events

      const event = symbolEvents[i];
      const timeDiff = Math.abs(event.time - positionCloseTime);

      if (timeDiff < timeWindow && timeDiff < closestDiff) {
        closestEvent = event;
        closestDiff = timeDiff;
        closestIndex = i;
      }
    }

    if (closestEvent && closestIndex >= 0) {
      const pnl = parseFloat(closestEvent.income);

      // Use raw SQL for faster updates
      await sql`
        UPDATE positions
        SET realized_pnl = ${pnl.toString()}, updated_at = NOW()
        WHERE id = ${position.id}
      `;

      usedIndexes.add(closestIndex);
      matchedCount++;

      if (matchedCount <= 10 || matchedCount % 100 === 0) {
        console.log(`   ✓ Matched ${matchedCount}: ${position.symbol} ${position.side} = $${pnl.toFixed(2)}`);
      }
    } else {
      unmatchedCount++;
    }
  }

  console.log(`\n✅ Matching complete:`);
  console.log(`   Matched: ${matchedCount} positions`);
  console.log(`   Unmatched: ${unmatchedCount} positions (will remain NULL)\n`);

  // ========== STEP 5: VERIFY RESULTS ==========
  console.log('✅ STEP 5: Verifying results...\n');

  const updatedPositions = await db.select().from(positions);
  const closedWithPnl = updatedPositions.filter(p => !p.isOpen && p.realizedPnl !== null);
  const closedWithoutPnl = updatedPositions.filter(p => !p.isOpen && p.realizedPnl === null);

  const dbTotalPnl = closedWithPnl.reduce((sum, p) => sum + parseFloat(p.realizedPnl!), 0);
  const wins = closedWithPnl.filter(p => parseFloat(p.realizedPnl!) > 0).length;
  const losses = closedWithPnl.filter(p => parseFloat(p.realizedPnl!) < 0).length;

  console.log('=' .repeat(70));
  console.log('\n📊 FINAL RESULTS:\n');

  console.log('BEFORE REBUILD:');
  console.log(`  Positions with P&L: ${closedBefore.length}`);
  console.log(`  Total P&L: $${totalPnlBefore.toFixed(2)}\n`);

  console.log('AFTER REBUILD:');
  console.log(`  Total closed positions: ${closedPositions.length}`);
  console.log(`  Matched with P&L: ${closedWithPnl.length}`);
  console.log(`  Unmatched (NULL): ${closedWithoutPnl.length}`);
  console.log(`  Total P&L: $${dbTotalPnl.toFixed(2)}`);
  console.log(`  Wins: ${wins}, Losses: ${losses}`);
  console.log(`  Win Rate: ${((wins / (wins + losses)) * 100).toFixed(1)}%\n`);

  console.log('EXCHANGE (SOURCE OF TRUTH):');
  console.log(`  Total Events: ${allExchangeEvents.length}`);
  console.log(`  Total P&L: $${exchangeTotalPnl.toFixed(2)}\n`);

  console.log('COMPARISON:');
  const diff = dbTotalPnl - exchangeTotalPnl;
  const percentDiff = (Math.abs(diff) / Math.abs(exchangeTotalPnl)) * 100;
  console.log(`  Database vs Exchange: $${diff.toFixed(2)} (${percentDiff.toFixed(2)}% difference)`);

  if (Math.abs(diff) < 1) {
    console.log(`  ✅ P&L is now in sync! (within $1.00)\n`);
  } else if (Math.abs(diff) < 10) {
    console.log(`  ⚠️  Minor discrepancy of $${Math.abs(diff).toFixed(2)}\n`);
  } else {
    console.log(`  ❌ Significant discrepancy of $${Math.abs(diff).toFixed(2)}`);
    console.log(`     This is likely due to structural differences in how positions are grouped\n`);
  }

  console.log('=' .repeat(70));
  console.log(`\n✅ Rebuild complete! Backup saved to: ${backupFilename}\n`);
}

rebuildPnlFromExchange().catch(console.error);
