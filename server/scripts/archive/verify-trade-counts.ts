import { db } from '../db';
import { positions, fills } from '@shared/schema';
import { like, eq, and } from 'drizzle-orm';

async function verifyTradeCounts() {
  const sessionId = '0e2da39e-7b40-4f20-9f34-324a6bcc48f8';
  
  console.log('🔍 Verifying trade counts...\n');
  
  // Get all closed positions
  const allClosedPositions = await db.select()
    .from(positions)
    .where(and(
      eq(positions.sessionId, sessionId),
      eq(positions.isOpen, false)
    ));
  
  console.log(`📊 Total closed positions in DB: ${allClosedPositions.length}`);
  
  // Find sync positions (have sync-pnl fills)
  const syncFills = await db.select()
    .from(fills)
    .where(like(fills.orderId, 'sync-pnl-%'));
  
  const syncPositionIds = [...new Set(syncFills.map(f => f.positionId))];
  const syncPositions = allClosedPositions.filter(p => syncPositionIds.includes(p.id));
  
  console.log(`📥 Sync positions (from income API): ${syncPositions.length}`);
  
  // Find live positions (have entry/exit fills)
  const livePositions = allClosedPositions.filter(p => !syncPositionIds.includes(p.id));
  
  console.log(`🔄 Live positions (from trading): ${livePositions.length}`);
  
  // Check for duplicates or issues
  console.log(`\n✅ Total should be: ${syncPositions.length + livePositions.length}`);
  console.log(`📈 Actual total: ${allClosedPositions.length}`);
  
  if (allClosedPositions.length !== syncPositions.length + livePositions.length) {
    console.log('⚠️  MISMATCH DETECTED!');
  }
  
  // Check API endpoint
  const response = await fetch('http://localhost:5000/api/strategies/f181e3c8-8605-499a-a528-1f1fc478c30c/positions/closed');
  const apiPositions = await response.json();
  
  console.log(`\n🌐 API returns: ${apiPositions.length} positions`);
  console.log(`\n❓ User expects: 1139 trades (matching income API P&L events)`);
  console.log(`❓ API is showing: ${apiPositions.length} trades`);
  console.log(`❓ Difference: ${apiPositions.length - 1139} extra trades`);
}

verifyTradeCounts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
