import { db } from '../db';
import { positions, fills, tradeSessions, strategies } from '@shared/schema';
import { like, eq, and } from 'drizzle-orm';

const DEFAULT_USER_ID = 'default-user';

async function countAllPositions() {
  console.log('🔍 Counting all positions across all sessions...\n');
  
  // Get all strategies for the user
  const userStrategies = await db.select()
    .from(strategies)
    .where(eq(strategies.userId, DEFAULT_USER_ID));
  
  console.log(`📋 Found ${userStrategies.length} strateg(ies) for user ${DEFAULT_USER_ID}\n`);
  
  // Get all sessions for all strategies
  let allSessions: any[] = [];
  for (const strategy of userStrategies) {
    const sessions = await db.select()
      .from(tradeSessions)
      .where(eq(tradeSessions.strategyId, strategy.id));
    allSessions = [...allSessions, ...sessions];
  }
  
  console.log(`📂 Total sessions across all strategies: ${allSessions.length}`);
  console.log(`   - Active: ${allSessions.filter(s => s.isActive).length}`);
  console.log(`   - Archived: ${allSessions.filter(s => !s.isActive).length}\n`);
  
  // Get all sync fills to identify sync positions
  const syncFills = await db.select()
    .from(fills)
    .where(like(fills.orderId, 'sync-pnl-%'));
  
  const syncPositionIds = [...new Set(syncFills.map(f => f.positionId))];
  console.log(`📥 Sync position IDs (from income API): ${syncPositionIds.length}\n`);
  
  // Count positions across all sessions
  let totalPositions = 0;
  let totalSyncPositions = 0;
  let totalLivePositions = 0;
  let totalOpenPositions = 0;
  
  const sessionDetails: Array<{
    sessionId: string;
    isActive: boolean;
    total: number;
    sync: number;
    live: number;
    open: number;
  }> = [];
  
  for (const session of allSessions) {
    const sessionPositions = await db.select()
      .from(positions)
      .where(eq(positions.sessionId, session.id));
    
    const syncCount = sessionPositions.filter(p => syncPositionIds.includes(p.id)).length;
    const liveCount = sessionPositions.filter(p => !syncPositionIds.includes(p.id) && !p.isOpen).length;
    const openCount = sessionPositions.filter(p => p.isOpen).length;
    
    totalPositions += sessionPositions.length;
    totalSyncPositions += syncCount;
    totalLivePositions += liveCount;
    totalOpenPositions += openCount;
    
    sessionDetails.push({
      sessionId: session.id,
      isActive: session.isActive,
      total: sessionPositions.length,
      sync: syncCount,
      live: liveCount,
      open: openCount,
    });
  }
  
  console.log('📊 TOTAL POSITION SUMMARY:');
  console.log(`   - Total positions (all sessions): ${totalPositions}`);
  console.log(`   - Sync positions (income API): ${totalSyncPositions}`);
  console.log(`   - Live positions (closed): ${totalLivePositions}`);
  console.log(`   - Open positions: ${totalOpenPositions}\n`);
  
  console.log('📋 PER-SESSION BREAKDOWN:');
  console.log('─'.repeat(90));
  console.log(`${'Session ID'.padEnd(38)} ${'Status'.padEnd(10)} ${'Total'.padEnd(8)} ${'Sync'.padEnd(8)} ${'Live'.padEnd(8)} ${'Open'.padEnd(8)}`);
  console.log('─'.repeat(90));
  
  for (const detail of sessionDetails) {
    if (detail.total > 0) {
      const status = detail.isActive ? 'Active' : 'Archived';
      console.log(
        `${detail.sessionId.padEnd(38)} ${status.padEnd(10)} ${String(detail.total).padEnd(8)} ${String(detail.sync).padEnd(8)} ${String(detail.live).padEnd(8)} ${String(detail.open).padEnd(8)}`
      );
    }
  }
  console.log('─'.repeat(90));
  
  // Verify math
  console.log('\n✅ VERIFICATION:');
  console.log(`   Sync (${totalSyncPositions}) + Live (${totalLivePositions}) + Open (${totalOpenPositions}) = ${totalSyncPositions + totalLivePositions + totalOpenPositions}`);
  console.log(`   Should equal total: ${totalPositions}`);
  
  if (totalSyncPositions + totalLivePositions + totalOpenPositions === totalPositions) {
    console.log('   ✅ Math checks out!');
  } else {
    console.log('   ❌ MISMATCH DETECTED!');
  }
}

countAllPositions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
