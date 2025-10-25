import { db } from '../db';
import { positions, fills } from '@shared/schema';
import { like, eq } from 'drizzle-orm';

async function checkSyncPositions() {
  console.log('🔍 Checking sync-pnl positions...');
  
  // Find all fills with sync-pnl-* orderIds
  const syncFills = await db.select()
    .from(fills)
    .where(like(fills.orderId, 'sync-pnl-%'));
  
  console.log(`Found ${syncFills.length} fills from income API sync`);
  
  // Get unique position IDs
  const positionIds = [...new Set(syncFills.map(f => f.positionId))];
  
  console.log(`Found ${positionIds.length} unique positions`);
  
  // Get all these positions
  const syncPositions = await db.select()
    .from(positions)
    .where(eq(positions.sessionId, '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'));
  
  // Filter to only sync positions
  const onlySyncPositions = syncPositions.filter(p => positionIds.includes(p.id));
  
  // Check isOpen status
  const openCount = onlySyncPositions.filter(p => p.isOpen).length;
  const closedCount = onlySyncPositions.filter(p => !p.isOpen).length;
  
  console.log(`\n📊 Status breakdown for ${onlySyncPositions.length} sync positions:`);
  console.log(`   ✅ Closed (isOpen=false): ${closedCount}`);
  console.log(`   ⚠️  Open (isOpen=true): ${openCount}`);
  
  if (openCount > 0) {
    console.log(`\n⚠️  WARNING: ${openCount} sync positions are marked as OPEN!`);
    console.log(`   These won't appear in the closed positions list.`);
    
    // Show a few examples
    const openOnes = onlySyncPositions.filter(p => p.isOpen).slice(0, 5);
    console.log(`\n   Examples of open sync positions:`);
    openOnes.forEach(p => {
      console.log(`   - ${p.symbol} ${p.side}: opened=${p.openedAt}, closed=${p.closedAt}`);
    });
  }
  
  // Also check total closed positions in session
  const allClosedPositions = syncPositions.filter(p => !p.isOpen);
  console.log(`\n📈 Total closed positions in session: ${allClosedPositions.length}`);
  console.log(`   - From sync: ${closedCount}`);
  console.log(`   - From live trading: ${allClosedPositions.length - closedCount}`);
}

checkSyncPositions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
