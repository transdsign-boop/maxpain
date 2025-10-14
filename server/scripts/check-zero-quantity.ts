import { db } from '../db';
import { positions, fills } from '@shared/schema';
import { like, eq, and } from 'drizzle-orm';

async function checkZeroQuantity() {
  const sessionId = '0e2da39e-7b40-4f20-9f34-324a6bcc48f8';
  
  console.log('🔍 Checking positions with quantity=0...\n');
  
  // Get all closed positions with quantity=0
  const allClosedPositions = await db.select()
    .from(positions)
    .where(and(
      eq(positions.sessionId, sessionId),
      eq(positions.isOpen, false)
    ));
  
  const zeroQuantityPositions = allClosedPositions.filter(p => 
    parseFloat(p.totalQuantity || '0') === 0
  );
  
  console.log(`📊 Positions with totalQuantity=0: ${zeroQuantityPositions.length}`);
  
  // Check which are actually sync positions
  const syncFills = await db.select()
    .from(fills)
    .where(like(fills.orderId, 'sync-pnl-%'));
  
  const syncPositionIds = [...new Set(syncFills.map(f => f.positionId))];
  
  const actualSyncPositions = zeroQuantityPositions.filter(p => syncPositionIds.includes(p.id));
  const notSyncPositions = zeroQuantityPositions.filter(p => !syncPositionIds.includes(p.id));
  
  console.log(`✅ Actual sync positions (have sync-pnl fills): ${actualSyncPositions.length}`);
  console.log(`⚠️  Other positions with quantity=0 (NOT sync): ${notSyncPositions.length}`);
  
  if (notSyncPositions.length > 0) {
    console.log(`\nExamples of non-sync positions with quantity=0:`);
    notSyncPositions.slice(0, 5).forEach(p => {
      console.log(`  - ${p.symbol} ${p.side}: opened=${p.openedAt}, quantity=${p.totalQuantity}`);
    });
    
    // Check their fills
    for (const p of notSyncPositions.slice(0, 3)) {
      const positionFills = await db.select()
        .from(fills)
        .where(eq(fills.positionId, p.id));
      console.log(`\n  Fills for ${p.symbol} ${p.side} (${p.id}):`);
      positionFills.forEach(f => {
        console.log(`    - orderId: ${f.orderId}, qty: ${f.quantity}`);
      });
    }
  }
}

checkZeroQuantity()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
