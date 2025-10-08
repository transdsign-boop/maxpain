import { db } from './db';
import { positions, tradeSessions } from '../shared/schema';
import { sql, eq, and, inArray } from 'drizzle-orm';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

async function matchFileTrades() {
  // Read the file
  const fileContent = fs.readFileSync(
    'attached_assets/Pasted-Time-Type-Amount-Symbol-10-8-2025-10-27-Realized-PNL-1-34984482-USDT-ETHUSDT-10-8-2025-10-27-Commi-1759952329989_1759952329989.txt',
    'utf-8'
  );

  const lines = fileContent.split('\n').filter(line => line.trim());
  
  // Parse Realized PNL entries
  interface FileTrade {
    timestamp: Date;
    pnl: number;
    symbol: string;
  }
  
  const fileTrades: FileTrade[] = [];
  
  for (const line of lines.slice(1)) { // Skip header
    if (line.includes('Realized PNL')) {
      const dateMatch = line.match(/^(\d+\/\d+\/\d+\s+\d+:\d+)/);
      const pnlMatch = line.match(/Realized PNL\s+([-\d.]+)/);
      const symbolMatch = line.match(/USDT\s+(\w+USDT)/);
      
      if (dateMatch && pnlMatch && symbolMatch) {
        fileTrades.push({
          timestamp: new Date(dateMatch[1]),
          pnl: parseFloat(pnlMatch[1]),
          symbol: symbolMatch[1]
        });
      }
    }
  }

  console.log(`📄 Parsed ${fileTrades.length} Realized PNL entries from file`);
  console.log(`   Total P&L: $${fileTrades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2)}\n`);

  // Get all closed positions from database in the date range
  const minDate = new Date(Math.min(...fileTrades.map(t => t.timestamp.getTime())));
  const maxDate = new Date(Math.max(...fileTrades.map(t => t.timestamp.getTime())));
  
  const result: any = await db.execute(
    sql`SELECT * FROM positions 
        WHERE closed_at >= ${minDate.toISOString()} 
        AND closed_at <= ${maxDate.toISOString()}
        AND is_open = false
        ORDER BY closed_at ASC`
  );

  const dbPositions = result.rows || result;
  console.log(`💾 Found ${dbPositions.length} closed positions in database\n`);
  
  // Debug: show sample positions
  console.log('🔍 Sample database positions:');
  dbPositions.slice(0, 3).forEach((p: any) => {
    console.log(`   ${new Date(p.closed_at).toLocaleString()} | ${p.symbol} | $${p.realized_pnl}`);
  });
  console.log('\n🔍 Sample file trades:');
  fileTrades.slice(0, 3).forEach(t => {
    console.log(`   ${t.timestamp.toLocaleString()} | ${t.symbol} | $${t.pnl}`);
  });
  console.log('');

  // Match file trades to database positions
  const matchedPositionIds: string[] = [];
  const unmatchedTrades: FileTrade[] = [];
  
  for (const fileTrade of fileTrades) {
    // Find matching position by symbol and P&L (more flexible matching)
    const match = dbPositions.find((p: any) => {
      const dbPnl = parseFloat(p.realized_pnl);
      // Match within $0.10 OR within 5% (whichever is larger)
      const tolerance = Math.max(0.10, Math.abs(fileTrade.pnl) * 0.05);
      const pnlMatch = Math.abs(dbPnl - fileTrade.pnl) < tolerance;
      const symbolMatch = p.symbol === fileTrade.symbol;
      const timeMatch = p.closed_at && 
        Math.abs(new Date(p.closed_at).getTime() - fileTrade.timestamp.getTime()) < 30 * 60 * 1000; // 30 min
      
      return pnlMatch && symbolMatch && timeMatch && !matchedPositionIds.includes(p.id);
    });

    if (match) {
      matchedPositionIds.push(match.id);
    } else {
      unmatchedTrades.push(fileTrade);
    }
  }

  console.log(`✅ Matched ${matchedPositionIds.length} trades`);
  console.log(`❌ Unmatched ${unmatchedTrades.length} trades from file\n`);

  if (unmatchedTrades.length > 0) {
    console.log('⚠️  Unmatched trades:');
    unmatchedTrades.slice(0, 5).forEach(t => {
      console.log(`   ${t.timestamp.toLocaleString()} | ${t.symbol} | $${t.pnl}`);
    });
    if (unmatchedTrades.length > 5) {
      console.log(`   ... and ${unmatchedTrades.length - 5} more`);
    }
    console.log('');
  }

  // Calculate total P&L of matched positions
  const matchedPnl = dbPositions
    .filter((p: any) => matchedPositionIds.includes(p.id))
    .reduce((sum: number, p: any) => sum + parseFloat(p.realized_pnl), 0);

  console.log(`💰 Total P&L of matched positions: $${matchedPnl.toFixed(2)}\n`);

  // Archive all current sessions
  console.log('📦 Archiving all current sessions...');
  await db.execute(sql`UPDATE trade_sessions SET is_active = false`);

  // Create new session with only matched positions
  const newSessionId = randomUUID();
  await db.execute(
    sql`INSERT INTO trade_sessions (id, strategy_id, starting_balance, current_balance, is_active, started_at)
        SELECT ${newSessionId}, strategy_id, starting_balance, current_balance, true, NOW()
        FROM trade_sessions 
        WHERE is_active = false 
        LIMIT 1`
  );

  // Move matched positions to new session
  if (matchedPositionIds.length > 0) {
    for (const posId of matchedPositionIds) {
      await db.execute(
        sql`UPDATE positions SET session_id = ${newSessionId} WHERE id = ${posId}`
      );
    }
  }

  console.log(`✅ Created new session with ${matchedPositionIds.length} matched positions`);
  console.log(`   Session ID: ${newSessionId}\n`);

  // Summary
  console.log('📊 Summary:');
  console.log(`   File trades: ${fileTrades.length}`);
  console.log(`   Matched positions: ${matchedPositionIds.length}`);
  console.log(`   UI will now show only these ${matchedPositionIds.length} trades`);
}

matchFileTrades()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
