import { db } from './db';
import { positions, fills } from '../shared/schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Find and remove duplicate positions that share the same fills.
 * Keeps the first created position and removes duplicates.
 */
async function cleanupDuplicatePositions() {
  console.log('🔍 Finding duplicate positions...\n');

  // Get all closed positions
  const allPositions = await db.select().from(positions)
    .where(eq(positions.isOpen, false));

  console.log(`📊 Found ${allPositions.length} closed positions\n`);

  // Get all fills
  const allFills = await db.select().from(fills);
  
  // Map fills to positions
  const fillsByPosition = new Map<string, typeof allFills>();
  for (const fill of allFills) {
    if (fill.positionId) {
      if (!fillsByPosition.has(fill.positionId)) {
        fillsByPosition.set(fill.positionId, []);
      }
      fillsByPosition.get(fill.positionId)!.push(fill);
    }
  }

  // Find positions that share the same fills (via orderId)
  const orderIdToPositions = new Map<string, typeof allPositions>();
  
  for (const pos of allPositions) {
    const posFills = fillsByPosition.get(pos.id) || [];
    if (posFills.length === 0) continue;
    
    // Use first fill's orderId as the key
    const firstFillOrderId = posFills[0].orderId;
    
    if (!orderIdToPositions.has(firstFillOrderId)) {
      orderIdToPositions.set(firstFillOrderId, []);
    }
    orderIdToPositions.get(firstFillOrderId)!.push(pos);
  }

  // Find duplicates
  let duplicateCount = 0;
  const positionsToDelete: string[] = [];
  
  for (const [orderId, positions] of Array.from(orderIdToPositions.entries())) {
    if (positions.length > 1) {
      // Keep the first position, mark others for deletion
      const keeper = positions[0];
      const duplicates = positions.slice(1);
      
      console.log(`🔁 Found ${positions.length} positions sharing orderId ${orderId}:`);
      console.log(`   ✅ KEEPING: ${keeper.symbol} ${keeper.side} (${keeper.id}) - P&L: $${keeper.realizedPnl}`);
      
      for (const dup of duplicates) {
        console.log(`   ❌ REMOVING: ${dup.symbol} ${dup.side} (${dup.id}) - P&L: $${dup.realizedPnl}`);
        positionsToDelete.push(dup.id);
        duplicateCount++;
      }
      console.log('');
    }
  }

  if (duplicateCount === 0) {
    console.log('✅ No duplicate positions found!');
    return;
  }

  console.log(`\n📊 Summary: Found ${duplicateCount} duplicate positions to remove`);
  console.log(`   ${positionsToDelete.length} positions will be deleted\n`);

  // Delete duplicate positions
  for (const posId of positionsToDelete) {
    await db.delete(positions).where(eq(positions.id, posId));
  }

  console.log(`✅ Cleanup complete! Removed ${duplicateCount} duplicate positions`);

  // Verify P&L
  const remaining = await db.select().from(positions)
    .where(eq(positions.isOpen, false));
  
  const totalPnl = remaining.reduce((sum, pos) => sum + parseFloat(pos.realizedPnl), 0);
  console.log(`\n💰 Total realized P&L after cleanup: $${totalPnl.toFixed(2)}`);
}

// Run cleanup
cleanupDuplicatePositions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  });
