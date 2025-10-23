import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { positions } from '@shared/schema';
import { eq, inArray } from 'drizzle-orm';

async function compareDatabases() {
  const activeSessions = ['2b4478ae-09f0-446e-90b9-a22b444156e4', '715c61d4-d238-4a51-98a3-0550f1865b90', 'f4e647a5-e4eb-4cef-b01b-21ce95ebfab6', '0e2da39e-7b40-4f20-9f34-324a6bcc48f8'];

  // Check Neon database
  if (process.env.NEON_DATABASE_URL) {
    console.log('\n📊 NEON DATABASE:');
    const neonSql = neon(process.env.NEON_DATABASE_URL);
    const neonDb = drizzle({ client: neonSql });

    const neonPositions = await neonDb.select().from(positions)
      .where(inArray(positions.sessionId, activeSessions));

    const neonClosed = neonPositions.filter(p => !p.isOpen);
    const neonTotalPnl = neonClosed.reduce((sum, pos) => sum + parseFloat(pos.realizedPnl || '0'), 0);

    console.log(`   Total positions: ${neonPositions.length}`);
    console.log(`   Closed positions: ${neonClosed.length}`);
    console.log(`   Total P&L: $${neonTotalPnl.toFixed(2)}`);
  }

  // Check local database
  if (process.env.DATABASE_URL) {
    console.log('\n📊 LOCAL DATABASE (helium):');
    try {
      const localSql = neon(process.env.DATABASE_URL);
      const localDb = drizzle({ client: localSql });

      const localPositions = await localDb.select().from(positions)
        .where(inArray(positions.sessionId, activeSessions));

      const localClosed = localPositions.filter(p => !p.isOpen);
      const localTotalPnl = localClosed.reduce((sum, pos) => sum + parseFloat(pos.realizedPnl || '0'), 0);

      console.log(`   Total positions: ${localPositions.length}`);
      console.log(`   Closed positions: ${localClosed.length}`);
      console.log(`   Total P&L: $${localTotalPnl.toFixed(2)}`);
    } catch (error) {
      console.log(`   ❌ Could not connect: ${error.message}`);
    }
  }
}

compareDatabases().catch(console.error);
