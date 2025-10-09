import { db } from './server/db.js';
import { strategyChanges } from './shared/schema.js';
import { desc } from 'drizzle-orm';

async function checkAllChanges() {
  try {
    const allChanges = await db.select()
      .from(strategyChanges)
      .orderBy(desc(strategyChanges.changedAt));
    
    console.log(`\n=== ALL STRATEGY CHANGES IN DATABASE ===`);
    console.log(`Total: ${allChanges.length}`);
    
    allChanges.forEach(c => {
      console.log('\nChange ID:', c.id);
      console.log('  Date:', new Date(c.changedAt).toISOString());
      console.log('  Strategy ID:', c.strategyId);
      console.log('  Session ID:', c.sessionId);
      console.log('  Fields changed:', Object.keys(c.changes).join(', '));
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAllChanges();
