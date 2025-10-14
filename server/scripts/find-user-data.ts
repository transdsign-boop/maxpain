import { db } from '../db';
import { strategies, tradeSessions, positions, fills } from '@shared/schema';
import { like, eq } from 'drizzle-orm';

async function findUserData() {
  console.log('🔍 Finding all users with data...\n');
  
  // Get all strategies (to find which user IDs exist)
  const allStrategies = await db.select().from(strategies);
  console.log(`📋 Total strategies: ${allStrategies.length}`);
  
  const userIds = [...new Set(allStrategies.map(s => s.userId))];
  console.log(`👥 Unique user IDs: ${userIds.length}`);
  
  for (const userId of userIds) {
    console.log(`\n   User: ${userId}`);
    const userStrats = allStrategies.filter(s => s.userId === userId);
    console.log(`   - Strategies: ${userStrats.length}`);
    
    for (const strat of userStrats) {
      console.log(`     • ${strat.name} (${strat.id}), Active: ${strat.isActive}`);
    }
  }
  
  // Get all sessions
  const allSessions = await db.select().from(tradeSessions);
  console.log(`\n📂 Total sessions: ${allSessions.length}`);
  
  // Get all positions
  const allPositions = await db.select().from(positions);
  console.log(`📦 Total positions: ${allPositions.length}`);
  
  // Get sync positions
  const syncFills = await db.select()
    .from(fills)
    .where(like(fills.orderId, 'sync-pnl-%'));
  
  const syncPositionIds = [...new Set(syncFills.map(f => f.positionId))];
  console.log(`📥 Sync positions (income API): ${syncPositionIds.length}`);
  
  // Calculate live positions
  const livePositions = allPositions.filter(p => !syncPositionIds.includes(p.id) && !p.isOpen);
  console.log(`🔄 Live positions (closed, not sync): ${livePositions.length}`);
  
  const openPositions = allPositions.filter(p => p.isOpen);
  console.log(`📈 Open positions: ${openPositions.length}`);
}

findUserData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
