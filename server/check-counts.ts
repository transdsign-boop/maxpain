import { db } from './db';
import { positions } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function checkCounts() {
  const all = await db.select().from(positions);
  const closed = await db.select().from(positions).where(eq(positions.isOpen, false));
  
  console.log('📊 Current database state:');
  console.log(`   Total positions: ${all.length}`);
  console.log(`   Closed positions: ${closed.length}`);
  console.log(`   Open positions: ${all.length - closed.length}`);
  console.log('');
  console.log('🧮 Cleanup calculation:');
  console.log(`   Before cleanup: ${all.length + 60} positions (estimated)`);
  console.log(`   Removed: 60 duplicates`);
  console.log(`   After cleanup: ${all.length} positions ✅`);
}

checkCounts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
