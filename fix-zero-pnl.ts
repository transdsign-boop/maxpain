import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { createHmac } from 'crypto';

async function fixZeroPnlPositions() {
  console.log('🔍 Finding positions with $0 P&L...');

  // Get active strategy sessions
  const activeSessions = ['2b4478ae-09f0-446e-90b9-a22b444156e4', '715c61d4-d238-4a51-98a3-0550f1865b90', 'f4e647a5-e4eb-4cef-b01b-21ce95ebfab6', '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'];

  // Find all closed positions with $0 P&L
  const zeroPnlPositions = await db.select().from(positions)
    .where(
      and(
        inArray(positions.sessionId, activeSessions),
        eq(positions.isOpen, false),
        eq(positions.realizedPnl, '0')
      )
    );

  console.log(`📊 Found ${zeroPnlPositions.length} positions with $0 P&L`);

  if (zeroPnlPositions.length === 0) {
    console.log('✅ No positions to fix!');
    return;
  }

  // Fetch all P&L events from exchange
  console.log('📥 Fetching P&L events from exchange...');
  const apiKey = process.env.ASTER_API_KEY;
  const secretKey = process.env.ASTER_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.error('❌ API keys not configured');
    return;
  }

  const startTime = 1759276800000; // Oct 1, 2025
  const endTime = Date.now();
  const limit = 1000;

  let allEvents: any[] = [];
  let currentStartTime = startTime;

  // Paginate through all P&L events
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

    // Move to next batch
    const lastEvent = batch[batch.length - 1];
    currentStartTime = lastEvent.time + 1;
  }

  console.log(`📦 Fetched ${allEvents.length} P&L events from exchange`);

  // Match positions to P&L events
  let fixedCount = 0;
  let notFoundCount = 0;

  for (const position of zeroPnlPositions) {
    if (!position.closedAt) continue;

    const closeTime = new Date(position.closedAt).getTime();

    // Find matching P&L event (within 5 minute window)
    const matchingEvent = allEvents.find(event => {
      if (event.symbol !== position.symbol) return false;
      const timeDiff = Math.abs(event.time - closeTime);
      return timeDiff <= 300000; // 5 minutes
    });

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
  console.log(`   Not found: ${notFoundCount}`);
  console.log(`   Total: ${zeroPnlPositions.length}`);
}

fixZeroPnlPositions().catch(console.error);
