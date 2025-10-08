import { db } from './db';
import { positions, fills } from '../shared/schema';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';

async function filterTradesToMatchFile() {
  // Read the file
  const fileContent = fs.readFileSync(
    'attached_assets/Pasted-Time-Type-Amount-Symbol-10-8-2025-10-27-Realized-PNL-1-34984482-USDT-ETHUSDT-10-8-2025-10-27-Commi-1759952329989_1759952329989.txt',
    'utf-8'
  );

  const lines = fileContent.split('\n').filter(line => line.trim());
  
  // Parse dates from file
  const dates: Date[] = [];
  for (const line of lines.slice(1)) { // Skip header
    const match = line.match(/^(\d+\/\d+\/\d+\s+\d+:\d+)/);
    if (match) {
      const dateStr = match[1];
      const date = new Date(dateStr);
      dates.push(date);
    }
  }

  if (dates.length === 0) {
    console.log('No dates found in file');
    return;
  }

  // Find min and max dates
  const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

  console.log('📅 File date range:');
  console.log(`   From: ${minDate.toLocaleString()}`);
  console.log(`   To: ${maxDate.toLocaleString()}`);
  console.log('');

  // Get positions within this date range using raw SQL
  const result: any = await db.execute(
    sql`SELECT * FROM positions 
        WHERE opened_at >= ${minDate.toISOString()} 
        AND opened_at <= ${maxDate.toISOString()}`
  );

  const filteredPositions = result.rows || result;
  console.log(`📊 Positions in this date range: ${filteredPositions.length}`);
  
  const closedInRange = filteredPositions.filter((p: any) => !p.is_open);
  const totalPnl = closedInRange.reduce((sum: number, p: any) => sum + parseFloat(p.realized_pnl || '0'), 0);
  
  console.log(`   Closed: ${closedInRange.length}`);
  console.log(`   Open: ${filteredPositions.length - closedInRange.length}`);
  console.log(`   Total P&L: $${totalPnl.toFixed(2)}`);
  console.log('');

  // Check Realized PNL entries in file
  const realizedPnlLines = lines.filter(l => l.includes('Realized PNL'));
  console.log(`📄 File has ${realizedPnlLines.length} Realized PNL entries`);
  
  // Sum P&L from file
  let filePnl = 0;
  for (const line of realizedPnlLines) {
    const match = line.match(/Realized PNL\s+([-\d.]+)/);
    if (match) {
      filePnl += parseFloat(match[1]);
    }
  }
  console.log(`   File total P&L: $${filePnl.toFixed(2)}`);
  console.log('');
  
  console.log('💡 To show only these trades in the UI:');
  console.log('   Option 1: Filter positions by date range');
  console.log('   Option 2: Create a new session with only these positions');
  console.log('   Option 3: Archive other sessions and keep only this date range active');
}

filterTradesToMatchFile()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
