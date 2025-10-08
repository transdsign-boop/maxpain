import { db } from './db';
import { positions, fills } from '@shared/schema';
import { sql } from 'drizzle-orm';

async function checkBTCPositions() {
  const oct4th2025 = new Date(2025, 9, 4, 0, 0, 0);
  
  const btcPositions = await db
    .select()
    .from(positions)
    .where(sql`${positions.symbol} = 'BTCUSDT' AND ${positions.closedAt} >= ${oct4th2025.toISOString()}`)
    .orderBy(positions.closedAt);
  
  console.log(`\n📊 BTCUSDT Positions from Oct 4th: ${btcPositions.length}\n`);
  
  let totalPnl = 0;
  for (const pos of btcPositions) {
    const pnl = parseFloat(pos.realizedPnl || '0');
    totalPnl += pnl;
    const closedTime = pos.closedAt ? new Date(pos.closedAt).toISOString().slice(0,16).replace('T', ' ') : 'NULL';
    console.log(`${closedTime} | ${pos.side.padEnd(5)} | P&L: ${pnl.toFixed(6).padStart(12)} | qty: ${pos.totalQuantity} | ID: ${pos.id.slice(0,8)}`);
  }
  
  console.log(`\n💰 Total P&L from DB positions: ${totalPnl.toFixed(6)} USDT`);
  console.log(`📄 File shows P&L: 25.579000 USDT`);
  console.log(`❌ Difference: ${(totalPnl - 25.579).toFixed(6)} USDT\n`);
  
  // Check for duplicates by time and quantity
  console.log('🔍 Checking for potential duplicates...\n');
  
  for (let i = 0; i < btcPositions.length; i++) {
    for (let j = i + 1; j < btcPositions.length; j++) {
      const pos1 = btcPositions[i];
      const pos2 = btcPositions[j];
      
      if (!pos1.closedAt || !pos2.closedAt) continue;
      
      const timeDiff = Math.abs(new Date(pos1.closedAt).getTime() - new Date(pos2.closedAt).getTime());
      const qtyDiff = Math.abs(parseFloat(pos1.totalQuantity) - parseFloat(pos2.totalQuantity));
      const pnlDiff = Math.abs(parseFloat(pos1.realizedPnl || '0') - parseFloat(pos2.realizedPnl || '0'));
      
      // Check if they closed within 10 seconds and have similar quantity
      if (timeDiff < 10000 && qtyDiff < 0.001) {
        const time1 = new Date(pos1.closedAt).toISOString().slice(0,19).replace('T', ' ');
        const time2 = new Date(pos2.closedAt).toISOString().slice(0,19).replace('T', ' ');
        console.log(`⚠️  Potential duplicate:`);
        console.log(`   Position 1: ${time1} | ${pos1.side} | qty: ${pos1.totalQuantity} | P&L: ${pos1.realizedPnl} | ID: ${pos1.id.slice(0,12)}`);
        console.log(`   Position 2: ${time2} | ${pos2.side} | qty: ${pos2.totalQuantity} | P&L: ${pos2.realizedPnl} | ID: ${pos2.id.slice(0,12)}`);
        console.log(`   Time diff: ${(timeDiff / 1000).toFixed(1)}s | Qty diff: ${qtyDiff.toFixed(6)} | P&L diff: ${pnlDiff.toFixed(6)}\n`);
      }
    }
  }
}

checkBTCPositions().catch(console.error);
