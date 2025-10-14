import { db } from '../db';
import { positions, fills, tradeSessions, strategies } from '@shared/schema';
import { like, eq, and } from 'drizzle-orm';

const USER_ID = 'personal_user';

async function analyzeLivePositions() {
  console.log('🔍 Analyzing live trading positions...\n');
  
  // Get user's strategy
  const userStrategies = await db.select()
    .from(strategies)
    .where(eq(strategies.userId, USER_ID));
  
  const strategy = userStrategies[0];
  console.log(`📋 Strategy: ${strategy.name} (${strategy.id})\n`);
  
  // Get all sessions for this strategy
  const allSessions = await db.select()
    .from(tradeSessions)
    .where(eq(tradeSessions.strategyId, strategy.id));
  
  console.log(`📂 Total sessions: ${allSessions.length}`);
  console.log(`   - Active: ${allSessions.filter(s => s.isActive).length}`);
  console.log(`   - Archived: ${allSessions.filter(s => !s.isActive).length}\n`);
  
  // Get all sync fills to identify sync positions
  const syncFills = await db.select()
    .from(fills)
    .where(like(fills.orderId, 'sync-pnl-%'));
  
  const syncPositionIds = [...new Set(syncFills.map(f => f.positionId))];
  
  // Count positions across all sessions
  let totalPositions = 0;
  let totalSyncPositions = 0;
  let totalLivePositions = 0;
  let totalOpenPositions = 0;
  
  const sessionDetails: Array<{
    sessionId: string;
    isActive: boolean;
    createdAt: Date;
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
      createdAt: session.startedAt,
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
  console.log('─'.repeat(100));
  console.log(`${'Created At'.padEnd(22)} ${'Status'.padEnd(10)} ${'Total'.padEnd(8)} ${'Sync'.padEnd(8)} ${'Live'.padEnd(8)} ${'Open'.padEnd(8)} ${'Session ID'.padEnd(38)}`);
  console.log('─'.repeat(100));
  
  // Sort by creation date (newest first)
  sessionDetails.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  
  for (const detail of sessionDetails) {
    if (detail.total > 0) {
      const status = detail.isActive ? 'Active' : 'Archived';
      const createdAt = detail.createdAt.toISOString().slice(0, 19).replace('T', ' ');
      console.log(
        `${createdAt.padEnd(22)} ${status.padEnd(10)} ${String(detail.total).padEnd(8)} ${String(detail.sync).padEnd(8)} ${String(detail.live).padEnd(8)} ${String(detail.open).padEnd(8)} ${detail.sessionId}`
      );
    }
  }
  console.log('─'.repeat(100));
  
  // Show some sample live positions
  console.log('\n📈 Sample Live Positions (first 5):');
  const sampleLive = await db.select()
    .from(positions)
    .where(eq(positions.isOpen, false))
    .limit(5);
  
  for (const pos of sampleLive) {
    if (!syncPositionIds.includes(pos.id)) {
      console.log(`   ${pos.symbol} ${pos.side} - Layers: ${pos.layersFilled}, Session: ${pos.sessionId.slice(0, 8)}...`);
    }
  }
  
  // Verify math
  console.log('\n✅ VERIFICATION:');
  console.log(`   Sync (${totalSyncPositions}) + Live (${totalLivePositions}) + Open (${totalOpenPositions}) = ${totalSyncPositions + totalLivePositions + totalOpenPositions}`);
  console.log(`   Should equal total: ${totalPositions}`);
  
  if (totalSyncPositions + totalLivePositions + totalOpenPositions === totalPositions) {
    console.log('   ✅ Math checks out!');
  } else {
    console.log('   ❌ MISMATCH DETECTED!');
  }
  
  console.log(`\n💡 ANSWER: There are ${totalLivePositions} live trading positions across ${sessionDetails.filter(s => s.live > 0).length} session(s)`);
}

analyzeLivePositions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
