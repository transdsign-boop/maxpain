import { db } from '../db';
import { positions, fills } from '@shared/schema';
import { inArray, like, and, eq } from 'drizzle-orm';

async function cleanupOldSyncPositions() {
  console.log('🧹 Cleaning up old sync positions (sync-trade-*)...');
  
  // Find all fills with sync-trade-* orderIds
  const oldFills = await db.select()
    .from(fills)
    .where(like(fills.orderId, 'sync-trade-%'));
  
  console.log(`Found ${oldFills.length} fills from old sync (sync-trade-*)`);
  
  // Get unique position IDs from these fills
  const oldPositionIds = [...new Set(oldFills.map(f => f.positionId))];
  
  console.log(`Found ${oldPositionIds.length} positions to delete`);
  
  if (oldPositionIds.length === 0) {
    console.log('✅ No old positions to clean up');
    return;
  }
  
  // Delete fills first
  console.log('Deleting old fills...');
  await db.delete(fills)
    .where(like(fills.orderId, 'sync-trade-%'));
  
  // Delete positions
  console.log('Deleting old positions...');
  await db.delete(positions)
    .where(inArray(positions.id, oldPositionIds));
  
  console.log(`✅ Cleanup complete: Deleted ${oldPositionIds.length} old positions and ${oldFills.length} fills`);
  
  // Verify final count
  const remainingPositions = await db.select()
    .from(positions)
    .where(eq(positions.sessionId, '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'));
  
  console.log(`✅ Final position count: ${remainingPositions.length}`);
  
  // Show breakdown by fill orderId pattern
  const pnlFills = await db.select()
    .from(fills)
    .where(like(fills.orderId, 'sync-pnl-%'));
  
  const pnlPositionIds = [...new Set(pnlFills.map(f => f.positionId))];
  
  console.log(`📊 Breakdown:`);
  console.log(`   - Positions from income API (sync-pnl-*): ${pnlPositionIds.length}`);
  console.log(`   - Other positions (live trading, etc.): ${remainingPositions.length - pnlPositionIds.length}`);
}

cleanupOldSyncPositions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
