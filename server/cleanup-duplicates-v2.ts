import { db } from './db';
import { positions, fills } from '../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

/**
 * Find and remove duplicate positions created from the same exchange trades.
 * Identifies duplicates by matching fills with identical timestamps.
 */
async function cleanupDuplicatePositions() {
  console.log('🔍 Finding duplicate positions created from same exchange trades...\n');

  // Get all fills with sync orderIds (these come from exchange sync)
  const syncFills = await db.select().from(fills)
    .where(sql`order_id LIKE 'sync-%'`);

  console.log(`📦 Found ${syncFills.length} sync fills\n`);

  // Group fills by exchange trade timestamp (extracted from orderId: sync-entry-TIMESTAMP-INDEX)
  const tradeGroups = new Map<string, typeof syncFills>();
  
  for (const fill of syncFills) {
    // Extract timestamp from orderId: sync-entry-1759639679542-0 or sync-exit-1759639679542-0
    const match = fill.orderId.match(/sync-(?:entry|exit)-(\d+)-\d+/);
    if (match) {
      const timestamp = match[1];
      if (!tradeGroups.has(timestamp)) {
        tradeGroups.set(timestamp, []);
      }
      tradeGroups.get(timestamp)!.push(fill);
    }
  }

  console.log(`📊 Grouped fills into ${tradeGroups.size} unique exchange trades\n`);

  // Find exchange trades that belong to multiple positions
  const duplicateInfo: Array<{
    timestamp: string;
    positionIds: string[];
    positions: any[];
  }> = [];

  for (const [timestamp, tradeFills] of Array.from(tradeGroups.entries())) {
    const positionIds = Array.from(new Set(tradeFills.map(f => f.positionId).filter(Boolean)));
    
    if (positionIds.length > 1) {
      // This exchange trade is linked to multiple positions - potential duplicate!
      const positionsData = await db.select().from(positions)
        .where(inArray(positions.id, positionIds as string[]));
      
      duplicateInfo.push({
        timestamp,
        positionIds: positionIds as string[],
        positions: positionsData,
      });
    }
  }

  console.log(`⚠️  Found ${duplicateInfo.length} exchange trades linked to multiple positions\n`);

  if (duplicateInfo.length === 0) {
    console.log('✅ No duplicate positions found!');
    return { removed: 0, keptPnl: 0 };
  }

  // For each duplicate group, keep the position with the earliest closedAt (or first by id)
  const positionsToDelete: string[] = [];
  let totalRemovedPnl = 0;
  let totalKeptPnl = 0;

  for (const { timestamp, positionIds, positions: posGroup } of duplicateInfo) {
    if (posGroup.length <= 1) continue;

    // Sort by closedAt (earliest first), then by id
    posGroup.sort((a, b) => {
      const timeA = a.closedAt ? new Date(a.closedAt).getTime() : 0;
      const timeB = b.closedAt ? new Date(b.closedAt).getTime() : 0;
      if (timeA !== timeB) return timeA - timeB;
      return a.id.localeCompare(b.id);
    });

    const keeper = posGroup[0];
    const duplicates = posGroup.slice(1);

    console.log(`🔁 Exchange trade ${timestamp} has ${posGroup.length} positions:`);
    console.log(`   ✅ KEEPING: ${keeper.symbol} ${keeper.side} (${keeper.id.substring(0, 12)}) - P&L: $${keeper.realizedPnl}`);
    
    for (const dup of duplicates) {
      console.log(`   ❌ REMOVING: ${dup.symbol} ${dup.side} (${dup.id.substring(0, 12)}) - P&L: $${dup.realizedPnl}`);
      positionsToDelete.push(dup.id);
      totalRemovedPnl += parseFloat(dup.realizedPnl);
    }
    totalKeptPnl += parseFloat(keeper.realizedPnl);
    console.log('');
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Found ${positionsToDelete.length} duplicate positions to remove`);
  console.log(`   Total P&L to remove: $${totalRemovedPnl.toFixed(2)}`);
  console.log(`   Total P&L to keep: $${totalKeptPnl.toFixed(2)}\n`);

  // Delete duplicate positions
  if (positionsToDelete.length > 0) {
    await db.delete(positions).where(inArray(positions.id, positionsToDelete));
    console.log(`✅ Removed ${positionsToDelete.length} duplicate positions`);
  }

  // Verify total P&L
  const remaining = await db.select().from(positions)
    .where(eq(positions.isOpen, false));
  
  const totalPnl = remaining.reduce((sum, pos) => sum + parseFloat(pos.realizedPnl), 0);
  console.log(`\n💰 Total realized P&L after cleanup: $${totalPnl.toFixed(2)}`);

  return {
    removed: positionsToDelete.length,
    keptPnl: totalPnl,
  };
}

// Import sql helper
import { sql } from 'drizzle-orm';

// Run cleanup
cleanupDuplicatePositions()
  .then((result) => {
    console.log(`\n✅ Cleanup complete!`);
    console.log(`   Removed ${result.removed} duplicate positions`);
    console.log(`   Final P&L: $${result.keptPnl.toFixed(2)}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  });
