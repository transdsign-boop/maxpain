import { db } from './db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CSVRow {
  time: string;
  type: string;
  amount: string;
  symbol: string;
}

interface GroupedTrade {
  timestamp: Date;
  symbol: string;
  totalPnl: number;
  totalCommission: number;
  rowCount: number;
}

async function syncFromCSV() {
  // Read CSV file
  const csvPath = path.join(__dirname, '../attached_assets/Transaction history 2025-10-08_1759962080085.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.trim().split('\n').slice(1); // Skip header

  // Parse CSV
  const rows: CSVRow[] = lines.map(line => {
    const [time, type, amount, symbol] = line.split(',');
    return { time, type, amount, symbol };
  });

  console.log(`📊 Parsed ${rows.length} CSV rows\n`);

  // Group Realized PNL and Commission by timestamp + symbol
  const tradeGroups = new Map<string, GroupedTrade>();
  const fundingFees = new Map<string, number>(); // symbol -> total funding

  for (const row of rows) {
    const timestamp = new Date(row.time);
    const amountMatch = row.amount.match(/(-?[\d.]+)\s+USDT/);
    if (!amountMatch) continue;
    
    const amount = parseFloat(amountMatch[1]);

    if (row.type === 'Realized PNL') {
      const key = `${timestamp.toISOString()}|${row.symbol}`;
      const existing = tradeGroups.get(key);
      
      if (existing) {
        existing.totalPnl += amount;
        existing.rowCount++;
      } else {
        tradeGroups.set(key, {
          timestamp,
          symbol: row.symbol,
          totalPnl: amount,
          totalCommission: 0,
          rowCount: 1
        });
      }
    } else if (row.type === 'Commission') {
      // Find matching trade within 1 second
      const tradeKey = Array.from(tradeGroups.keys()).find(k => {
        const [ts, sym] = k.split('|');
        const tradTime = new Date(ts);
        return sym === row.symbol && Math.abs(tradTime.getTime() - timestamp.getTime()) < 2000;
      });

      if (tradeKey) {
        tradeGroups.get(tradeKey)!.totalCommission += amount;
      }
    } else if (row.type === 'Funding fee') {
      const current = fundingFees.get(row.symbol) || 0;
      fundingFees.set(row.symbol, current + amount);
    }
  }

  // Convert to array and sort by timestamp
  const trades = Array.from(tradeGroups.values()).sort((a, b) => 
    a.timestamp.getTime() - b.timestamp.getTime()
  );

  console.log(`📈 Grouped into ${trades.length} unique trades\n`);

  // Show sample
  console.log('Sample trades (first 10):');
  trades.slice(0, 10).forEach((t, i) => {
    const netPnl = t.totalPnl + t.totalCommission;
    console.log(`${i + 1}. ${t.timestamp.toISOString()} | ${t.symbol} | PNL: $${t.totalPnl.toFixed(2)} | Comm: $${t.totalCommission.toFixed(2)} | Net: $${netPnl.toFixed(2)} (${t.rowCount} layers)`);
  });

  console.log('\n📊 Funding fees summary:');
  for (const [symbol, fee] of fundingFees) {
    console.log(`   ${symbol}: $${fee.toFixed(2)}`);
  }

  // Compare with database
  const dbResult: any = await db.execute(
    sql`SELECT COUNT(*) as count FROM positions 
        WHERE session_id IN (SELECT id FROM trade_sessions WHERE is_active = true)
        AND is_open = false`
  );
  
  const dbCount = (dbResult.rows || dbResult)[0].count;
  console.log(`\n📊 Database has ${dbCount} closed positions`);
  console.log(`📄 CSV has ${trades.length} unique trades`);
  console.log(`   Difference: ${Math.abs(dbCount - trades.length)}`);

  // Calculate total P&L from CSV
  const totalCsvPnl = trades.reduce((sum, t) => sum + t.totalPnl, 0);
  const totalCommission = trades.reduce((sum, t) => sum + t.totalCommission, 0);
  const totalFunding = Array.from(fundingFees.values()).reduce((sum, f) => sum + f, 0);
  
  console.log(`\n💰 CSV Total Realized P&L: $${totalCsvPnl.toFixed(2)}`);
  console.log(`💰 CSV Total Commission: $${totalCommission.toFixed(2)}`);
  console.log(`💰 CSV Total Funding Fees: $${totalFunding.toFixed(2)}`);
  console.log(`💰 CSV Net P&L: $${(totalCsvPnl + totalCommission + totalFunding).toFixed(2)}`);

  // Get DB P&L and fees
  const perfResult: any = await db.execute(
    sql`SELECT SUM(p.realized_pnl) as total_pnl
        FROM positions p
        WHERE p.session_id IN (SELECT id FROM trade_sessions WHERE is_active = true)
        AND p.is_open = false`
  );
  
  const feeResult: any = await db.execute(
    sql`SELECT SUM(f.fee) as total_fees
        FROM fills f
        WHERE f.session_id IN (SELECT id FROM trade_sessions WHERE is_active = true)`
  );
  
  const dbPnl = parseFloat((perfResult.rows || perfResult)[0].total_pnl || '0');
  const dbFees = parseFloat((feeResult.rows || feeResult)[0].total_fees || '0');
  
  console.log(`\n💰 DB Total Realized P&L: $${dbPnl.toFixed(2)}`);
  console.log(`💰 DB Total Fees: $${dbFees.toFixed(2)}`);
  console.log(`💰 DB Net P&L: $${(dbPnl + dbFees).toFixed(2)}`);
  
  const pnlDiff = totalCsvPnl - dbPnl;
  const feeDiff = totalCommission - dbFees;
  console.log(`\n⚠️  P&L Difference: $${pnlDiff.toFixed(2)}`);
  console.log(`⚠️  Fee Difference: $${feeDiff.toFixed(2)}`);
  console.log(`⚠️  Total Difference: $${(pnlDiff + feeDiff).toFixed(2)}`);
  
  // Show trades by symbol
  const bySymbol = new Map<string, { count: number; pnl: number; comm: number }>();
  for (const trade of trades) {
    const existing = bySymbol.get(trade.symbol) || { count: 0, pnl: 0, comm: 0 };
    existing.count++;
    existing.pnl += trade.totalPnl;
    existing.comm += trade.totalCommission;
    bySymbol.set(trade.symbol, existing);
  }
  
  console.log(`\n📊 Trades by symbol:`);
  for (const [symbol, data] of Array.from(bySymbol.entries()).sort((a, b) => b[1].count - a[1].count)) {
    const netPnl = data.pnl + data.comm;
    console.log(`   ${symbol}: ${data.count} trades | P&L: $${data.pnl.toFixed(2)} | Comm: $${data.comm.toFixed(2)} | Net: $${netPnl.toFixed(2)}`);
  }
}

syncFromCSV()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
