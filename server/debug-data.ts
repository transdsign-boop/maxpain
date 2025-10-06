import { db } from './db';
import { strategies, sessions, positions, fills } from '../shared/schema';
import { desc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

async function checkData() {
  console.log('\n=== CHECKING DATABASE STATE ===\n');
  
  // Check strategies
  const allStrategies = await db.select().from(strategies).orderBy(desc(strategies.createdAt)).limit(5);
  console.log('STRATEGIES:');
  for (const s of allStrategies) {
    console.log(`- ${s.name} (${s.id})`);
    console.log(`  Mode: ${s.tradingMode}, Active: ${s.isActive}, Has Aster Creds: ${s.hasAsterApiSecret}`);
  }
  
  //Check sessions
  const allSessions = await db.select().from(sessions).orderBy(desc(sessions.createdAt)).limit(10);
  console.log('\nSESSIONS (Latest 10):');
  for (const s of allSessions) {
    console.log(`- ${s.id.substring(0, 8)}... Strategy: ${s.strategyId.substring(0, 8)}..., Mode: ${s.mode}, Active: ${s.isActive}`);
  }
  
  // Check positions count
  const positionsCount = await db.select({
    sessionId: positions.sessionId,
    count: sql<number>`count(*)::int`
  }).from(positions).groupBy(positions.sessionId);
  
  console.log('\nPOSITIONS COUNT BY SESSION:');
  for (const p of positionsCount) {
    console.log(`- Session ${p.sessionId.substring(0, 8)}...: ${p.count} positions`);
  }
  
  // Check total fills
  const fillsCount = await db.select({
    count: sql<number>`count(*)::int`
  }).from(fills);
  console.log(`\nTOTAL FILLS: ${fillsCount[0]?.count || 0}`);
  
  // Check if there's a mode mismatch
  const activeStrat = allStrategies.find(s => s.isActive);
  if (activeStrat) {
    console.log(`\n=== ACTIVE STRATEGY ANALYSIS ===`);
    console.log(`Active Strategy: ${activeStrat.name} (${activeStrat.id})`);
    console.log(`Trading Mode: ${activeStrat.tradingMode}`);
    
    const stratSessions = await db.select().from(sessions).where(eq(sessions.strategyId, activeStrat.id));
    console.log(`\nAll sessions for this strategy:`);
    for (const s of stratSessions) {
      const posCount = await db.select({ count: sql<number>`count(*)::int` }).from(positions).where(eq(positions.sessionId, s.id));
      console.log(`- ${s.id.substring(0, 8)}... Mode: ${s.mode}, Active: ${s.isActive}, Positions: ${posCount[0]?.count || 0}`);
    }
    
    const matchingSessions = stratSessions.filter(s => s.mode === activeStrat.tradingMode);
    console.log(`\nSessions matching current mode (${activeStrat.tradingMode}): ${matchingSessions.length}`);
    
    if (matchingSessions.length === 0) {
      console.log('\n⚠️  ISSUE FOUND: No sessions match the current trading mode!');
      console.log('This is why data appears empty - the mode changed but sessions still exist');
    }
  }
}

checkData().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
