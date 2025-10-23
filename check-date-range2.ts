import { db } from './server/db';
import { positions } from '@shared/schema';

async function checkDateRange() {
  const allPositions = await db.select().from(positions);
  const closedPositions = allPositions.filter(p => p.closedAt);
  const sorted = closedPositions.sort((a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime());

  console.log('📅 Closed Position Date Range:');
  console.log(`   Earliest closed: ${sorted[0]?.closedAt}`);
  console.log(`   Latest closed: ${sorted[sorted.length - 1]?.closedAt}`);
  console.log(`   Total closed positions: ${closedPositions.length}`);

  if (sorted[0]) {
    const daysSinceStart = (Date.now() - new Date(sorted[0].closedAt!).getTime()) / (1000 * 60 * 60 * 24);
    console.log(`   Days since first close: ${Math.floor(daysSinceStart)}`);
  }
}

checkDateRange().catch(console.error);
