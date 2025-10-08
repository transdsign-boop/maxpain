import { db } from './db';
import { fills } from '@shared/schema';
import { sql } from 'drizzle-orm';

async function checkSyncDuplicates() {
  // Get all fills with orderId starting with "sync-" (these are from exchange sync)
  const syncFills = await db
    .select()
    .from(fills)
    .where(sql`${fills.orderId} LIKE 'sync-%'`)
    .orderBy(fills.symbol, fills.filledAt);
  
  console.log(`\n📦 Total sync fills in database: ${syncFills.length}\n`);
  
  // Group by orderId to find duplicates
  const fillsByOrderId = new Map<string, typeof syncFills>();
  
  for (const fill of syncFills) {
    if (!fillsByOrderId.has(fill.orderId)) {
      fillsByOrderId.set(fill.orderId, []);
    }
    fillsByOrderId.get(fill.orderId)!.push(fill);
  }
  
  // Find duplicate orderIds
  const duplicates: string[] = [];
  for (const [orderId, fills] of fillsByOrderId) {
    if (fills.length > 1) {
      duplicates.push(orderId);
    }
  }
  
  console.log(`🔍 Unique sync orders: ${fillsByOrderId.size}`);
  console.log(`❌ Duplicate sync orders: ${duplicates.length}\n`);
  
  if (duplicates.length > 0) {
    console.log(`⚠️  FOUND ${duplicates.length} DUPLICATE SYNC ORDERS!\\n`);
    
    // Show first 10 examples
    for (let i = 0; i < Math.min(10, duplicates.length); i++) {
      const orderId = duplicates[i];
      const fills = fillsByOrderId.get(orderId)!;
      console.log(`\nDuplicate orderId: ${orderId}`);
      for (const fill of fills) {
        const time = new Date(fill.filledAt).toISOString().slice(0,19).replace('T', ' ');
        console.log(`  ${time} | ${fill.symbol} | ${fill.side} | qty: ${fill.quantity} | positionId: ${fill.positionId?.slice(0,12) || 'NULL'}`);
      }
    }
  } else {
    console.log('✅ No duplicate sync orders found - deduplication is working!');
  }
  
  // Check for duplicate positions from the same exchange trade
  console.log('\n\n🔍 Checking for positions created from the same exchange trade...\n');
  
  // Extract exchange trade ID from sync orderId (format: sync-entry-{tradeId}-{index} or sync-exit-{tradeId}-{index})
  const tradeIdToFills = new Map<string, typeof syncFills>();
  
  for (const fill of syncFills) {
    // Extract trade ID from orderId
    const match = fill.orderId.match(/sync-(?:entry|exit)-(\d+)-\d+/);
    if (match) {
      const tradeId = match[1];
      if (!tradeIdToFills.has(tradeId)) {
        tradeIdToFills.set(tradeId, []);
      }
      tradeIdToFills.get(tradeId)!.push(fill);
    }
  }
  
  console.log(`📊 Unique exchange trades: ${tradeIdToFills.size}`);
  
  // Find trades with multiple positions
  let multiPositionTrades = 0;
  for (const [tradeId, fills] of tradeIdToFills) {
    const uniquePositions = new Set(fills.map(f => f.positionId).filter(p => p));
    if (uniquePositions.size > 1) {
      multiPositionTrades++;
      if (multiPositionTrades <= 5) {
        console.log(`\n⚠️  Exchange trade ${tradeId} created ${uniquePositions.size} positions:`);
        for (const fill of fills) {
          const time = new Date(fill.filledAt).toISOString().slice(0,19).replace('T', ' ');
          console.log(`  ${time} | ${fill.symbol} | ${fill.side} | qty: ${fill.quantity} | positionId: ${fill.positionId?.slice(0,12) || 'NULL'}`);
        }
      }
    }
  }
  
  if (multiPositionTrades > 0) {
    console.log(`\n❌ Found ${multiPositionTrades} exchange trades that created multiple positions`);
    console.log('   This is EXPECTED for position flips but UNEXPECTED otherwise');
  } else {
    console.log('\n✅ Each exchange trade created exactly 1 position (or was part of position flip)');
  }
}

checkSyncDuplicates().catch(console.error);
