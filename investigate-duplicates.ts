import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { positions } from '@shared/schema';

async function investigateDuplicates() {
  console.log('🔍 INVESTIGATING P&L DISCREPANCY\n');

  if (!process.env.NEON_DATABASE_URL) {
    console.error('❌ NEON_DATABASE_URL not configured');
    return;
  }

  const sql = neon(process.env.NEON_DATABASE_URL);
  const db = drizzle({ client: sql });

  const allPositions = await db.select().from(positions);

  // Check for null P&L
  const closedWithPnl = allPositions.filter(p => !p.isOpen && p.realizedPnl !== null);
  const closedNoPnl = allPositions.filter(p => !p.isOpen && p.realizedPnl === null);

  console.log('📊 CURRENT STATUS:');
  console.log(`   Total positions: ${allPositions.length}`);
  console.log(`   Closed with P&L: ${closedWithPnl.length}`);
  console.log(`   Closed WITHOUT P&L: ${closedNoPnl.length}\n`);

  // Calculate totals
  let totalPnl = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  const pnlValues: number[] = [];

  for (const pos of closedWithPnl) {
    const pnl = parseFloat(pos.realizedPnl || '0');
    totalPnl += pnl;
    pnlValues.push(pnl);
    if (pnl > 0) positiveCount++;
    else if (pnl < 0) negativeCount++;
  }

  console.log('💰 P&L SUMMARY:');
  console.log(`   Total P&L: $${totalPnl.toFixed(2)}`);
  console.log(`   Wins: ${positiveCount}, Losses: ${negativeCount}`);
  console.log(`   Average P&L per position: $${(totalPnl / closedWithPnl.length).toFixed(2)}\n`);

  // Check for suspicious outliers
  pnlValues.sort((a, b) => b - a);

  console.log('📈 TOP 10 WINS:');
  for (let i = 0; i < Math.min(10, pnlValues.length); i++) {
    if (pnlValues[i] <= 0) break;
    const pos = closedWithPnl.find(p => parseFloat(p.realizedPnl!) === pnlValues[i]);
    console.log(`   ${i+1}. $${pnlValues[i].toFixed(2)} - ${pos?.symbol} ${pos?.side} (closed: ${pos?.closedAt})`);
  }

  console.log('\n📉 TOP 10 LOSSES:');
  for (let i = pnlValues.length - 1; i >= Math.max(pnlValues.length - 10, 0); i--) {
    if (pnlValues[i] >= 0) break;
    const pos = closedWithPnl.find(p => parseFloat(p.realizedPnl!) === pnlValues[i]);
    console.log(`   ${pnlValues.length - i}. $${pnlValues[i].toFixed(2)} - ${pos?.symbol} ${pos?.side} (closed: ${pos?.closedAt})`);
  }

  // Check for potential duplicates (same symbol, side, close time)
  console.log('\n🔄 CHECKING FOR DUPLICATES...');
  const closedPositions = allPositions.filter(p => !p.isOpen);
  const groupKey = (p: any) => `${p.symbol}_${p.side}_${new Date(p.closedAt).getTime()}`;
  const grouped = new Map<string, any[]>();

  for (const pos of closedPositions) {
    if (!pos.closedAt) continue;
    const key = groupKey(pos);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(pos);
  }

  const duplicates = Array.from(grouped.entries()).filter(([_, positions]) => positions.length > 1);

  if (duplicates.length > 0) {
    console.log(`   ❌ Found ${duplicates.length} potential duplicate groups:\n`);
    for (let i = 0; i < Math.min(5, duplicates.length); i++) {
      const [key, dups] = duplicates[i];
      console.log(`   Group ${i+1}: ${key}`);
      for (const dup of dups) {
        console.log(`      - ID: ${dup.id}, P&L: $${dup.realizedPnl || 'null'}, Session: ${dup.sessionId}`);
      }
      console.log();
    }
  } else {
    console.log('   ✅ No exact duplicates found by (symbol + side + time)\n');
  }

  // Check for suspicious P&L values
  console.log('⚠️  CHECKING FOR SUSPICIOUS VALUES:');
  const suspicious = closedWithPnl.filter(p => {
    const pnl = parseFloat(p.realizedPnl!);
    return Math.abs(pnl) > 100; // P&L > $100 or < -$100
  });

  if (suspicious.length > 0) {
    console.log(`   Found ${suspicious.length} positions with P&L > $100:\n`);
    for (const pos of suspicious.slice(0, 10)) {
      const pnl = parseFloat(pos.realizedPnl!);
      console.log(`   ${pos.symbol} ${pos.side}: $${pnl.toFixed(2)} (closed: ${pos.closedAt})`);
    }
  } else {
    console.log('   ✅ No suspicious large P&L values\n');
  }
}

investigateDuplicates().catch(console.error);
