import { db } from './server/db';
import { positions } from '@shared/schema';

async function checkDateRange() {
  const allPositions = await db.select().from(positions);
  const sorted = allPositions.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  console.log('📅 Trading Date Range:');
  console.log(`   Earliest position: ${sorted[0]?.createdAt}`);
  console.log(`   Latest position: ${sorted[sorted.length - 1]?.createdAt}`);
  console.log(`   Total positions: ${allPositions.length}`);

  const daysSinceStart = (Date.now() - new Date(sorted[0]?.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  console.log(`   Days since start: ${Math.floor(daysSinceStart)}`);
}

checkDateRange().catch(console.error);
