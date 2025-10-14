import { db } from '../db';
import { positions, fills } from '@shared/schema';
import { asc, desc, like, and, eq } from 'drizzle-orm';

async function checkPositionDates() {
  console.log('🔍 Checking position creation dates...\n');
  
  // Get sync fills to identify sync positions
  const syncFills = await db.select()
    .from(fills)
    .where(like(fills.orderId, 'sync-pnl-%'));
  
  const syncPositionIds = [...new Set(syncFills.map(f => f.positionId))];
  
  // Get all positions
  const allPositions = await db.select().from(positions);
  
  // Separate sync and live positions
  const syncPositions = allPositions.filter(p => syncPositionIds.includes(p.id));
  const livePositions = allPositions.filter(p => !syncPositionIds.includes(p.id) && !p.isOpen);
  
  console.log('📥 SYNC POSITIONS (from income API):');
  if (syncPositions.length > 0) {
    const earliestSync = syncPositions.reduce((min, p) => p.openedAt < min.openedAt ? p : min);
    const latestSync = syncPositions.reduce((max, p) => p.openedAt > max.openedAt ? p : max);
    
    console.log(`   Total: ${syncPositions.length}`);
    console.log(`   Earliest: ${earliestSync.openedAt.toISOString()}`);
    console.log(`   Latest:   ${latestSync.openedAt.toISOString()}\n`);
  }
  
  console.log('🔄 LIVE POSITIONS (from trading):');
  if (livePositions.length > 0) {
    const earliestLive = livePositions.reduce((min, p) => p.openedAt < min.openedAt ? p : min);
    const latestLive = livePositions.reduce((max, p) => p.openedAt > max.openedAt ? p : max);
    
    console.log(`   Total: ${livePositions.length}`);
    console.log(`   Earliest: ${earliestLive.openedAt.toISOString()}`);
    console.log(`   Latest:   ${latestLive.openedAt.toISOString()}\n`);
    
    // Check if live positions have layer data
    const livePositionIds = livePositions.map(p => p.id);
    const { positionLayers } = await import('@shared/schema');
    const layersForLive = await db.select()
      .from(positionLayers)
      .where(
        and(
          ...livePositionIds.slice(0, 10).map(id => 
            eq(positionLayers.positionId, id)
          )
        )
      )
      .limit(50);
    
    console.log(`📊 Layer Data Check:`);
    console.log(`   Checking first 10 live positions for layer records...`);
    console.log(`   Found: ${layersForLive.length} layer records\n`);
  }
  
  // Check fills table for early data
  console.log('📋 FILLS TABLE:');
  const earliestFill = await db.select()
    .from(fills)
    .orderBy(asc(fills.timestamp))
    .limit(1);
  
  const latestFill = await db.select()
    .from(fills)
    .orderBy(desc(fills.timestamp))
    .limit(1);
  
  if (earliestFill.length > 0) {
    console.log(`   Earliest fill: ${earliestFill[0].timestamp.toISOString()}`);
    console.log(`   Latest fill:   ${latestFill[0].timestamp.toISOString()}`);
  }
}

checkPositionDates()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
