import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { createHmac } from 'crypto';

async function fixRemainingZeroPnl() {
  console.log('🔍 Finding remaining positions with $0 P&L...');

  const activeSessions = ['2b4478ae-09f0-446e-90b9-a22b444156e4', '715c61d4-d238-4a51-98a3-0550f1865b90', 'f4e647a5-e4eb-4cef-b01b-21ce95ebfab6', '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'];

  const zeroPnlPositions = await db.select().from(positions)
    .where(
      and(
        inArray(positions.sessionId, activeSessions),
        eq(positions.isOpen, false),
        eq(positions.realizedPnl, '0')
      )
    );

  console.log(`📊 Found ${zeroPnlPositions.length} positions still with $0 P&L`);

  if (zeroPnlPositions.length === 0) {
    console.log('✅ No positions to fix!');
    return;
  }

  // Find earliest position to determine date range
  const earliestPos = zeroPnlPositions.reduce((earliest, pos) => {
    if (!pos.closedAt) return earliest;
    if (!earliest || new Date(pos.closedAt) < new Date(earliest.closedAt!)) {
      return pos;
    }
    return earliest;
  }, zeroPnlPositions[0]);

  console.log(`📅 Earliest zero P&L position: ${earliestPos.closedAt}`);

  // Fetch P&L events starting from earliest position date (with 1 day buffer)
  const apiKey = process.env.ASTER_API_KEY;
  const secretKey = process.env.ASTER_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.error('❌ API keys not configured');
    return;
  }

  const startTime = earliestPos.closedAt ? new Date(earliestPos.closedAt).getTime() - 86400000 : Date.now() - 30 * 86400000; // 1 day buffer or 30 days back
  const endTime = Date.now();
  const limit = 1000;

  console.log(`📥 Fetching P&L events from ${new Date(startTime).toISOString()}...`);

  let allEvents: any[] = [];
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
      console.error(`❌ Failed to fetch P&L events: ${response.status} ${errorText}`);
      break;
    }

    const batch = await response.json();

    if (batch.length === 0) break;

    allEvents.push(...batch);

    if (batch.length < limit) break;

    const lastEvent = batch[batch.length - 1];
    currentStartTime = lastEvent.time + 1;
  }

  console.log(`📦 Fetched ${allEvents.length} P&L events from exchange`);

  // Try matching with progressively wider time windows
  let fixedCount = 0;
  let notFoundCount = 0;
  const timeWindows = [60000, 300000, 600000, 1800000]; // 1min, 5min, 10min, 30min

  for (const position of zeroPnlPositions) {
    if (!position.closedAt) continue;

    const closeTime = new Date(position.closedAt).getTime();
    let matchingEvent = null;

    // Try progressively wider time windows
    for (const window of timeWindows) {
      matchingEvent = allEvents.find(event => {
        if (event.symbol !== position.symbol) return false;
        const timeDiff = Math.abs(event.time - closeTime);
        return timeDiff <= window;
      });

      if (matchingEvent) {
        console.log(`  ✓ Found match with ${window/1000}s window`);
        break;
      }
    }

    if (matchingEvent) {
      const pnl = parseFloat(matchingEvent.income);

      await db.update(positions)
        .set({ realizedPnl: pnl.toString() })
        .where(eq(positions.id, position.id));

      fixedCount++;
      console.log(`✅ Fixed ${position.symbol} (${new Date(closeTime).toISOString()}): $${pnl.toFixed(2)}`);
    } else {
      notFoundCount++;
      console.log(`⚠️ No match for ${position.symbol} at ${new Date(closeTime).toISOString()}`);
    }
  }

  console.log(`\n🎉 Summary:`);
  console.log(`   Fixed: ${fixedCount}`);
  console.log(`   Still not found: ${notFoundCount}`);
  console.log(`   Total: ${zeroPnlPositions.length}`);
}

fixRemainingZeroPnl().catch(console.error);
