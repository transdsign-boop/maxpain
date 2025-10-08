import { db } from './db';
import { tradeSessions, positions } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function checkSessions() {
  const allSessions = await db.select().from(tradeSessions);
  
  console.log('📊 Session Summary:');
  console.log(`   Total sessions: ${allSessions.length}`);
  
  for (const session of allSessions) {
    const sessionPositions = await db.select().from(positions)
      .where(eq(positions.sessionId, session.id));
    
    const status = session.isActive ? '✅ ACTIVE' : '📦 ARCHIVED';
    console.log(`\n${status} Session ${session.id.substring(0, 8)}:`);
    console.log(`   Created: ${new Date(session.createdAt).toLocaleString()}`);
    console.log(`   Positions: ${sessionPositions.length}`);
    console.log(`   Closed: ${sessionPositions.filter(p => !p.isOpen).length}`);
    console.log(`   Open: ${sessionPositions.filter(p => p.isOpen).length}`);
  }
  
  console.log('\n🔍 This explains the discrepancy:');
  console.log('   - API shows only ACTIVE session positions');
  console.log('   - Database has ALL positions (active + archived)');
}

checkSessions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
