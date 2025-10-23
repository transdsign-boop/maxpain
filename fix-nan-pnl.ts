import { db } from './server/db';
import { positions } from '@shared/schema';
import { eq } from 'drizzle-orm';

async function fixNanPnl() {
  console.log('🔧 Fixing position with NaN P&L...');

  const positionId = '09c817d6-7d1b-44a7-ae16-af8f98ebbe50';

  await db.update(positions)
    .set({ realizedPnl: '0' })
    .where(eq(positions.id, positionId));

  console.log('✅ Fixed position 09c817d6-7d1b-44a7-ae16-af8f98ebbe50: NaN → $0');
}

fixNanPnl().catch(console.error);
