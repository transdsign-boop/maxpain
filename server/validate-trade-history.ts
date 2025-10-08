import { db } from './db';
import { positions, fills } from '@shared/schema';
import { sql, and, gte } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

interface HistoricalRecord {
  time: Date;
  type: 'Realized PNL' | 'Commission' | 'Funding fee';
  amount: number;
  symbol: string;
}

interface ValidationResult {
  symbol: string;
  dbPnl: number;
  filePnl: number;
  dbCommission: number;
  fileCommission: number;
  pnlMatch: boolean;
  commissionMatch: boolean;
  pnlDiff: number;
  commissionDiff: number;
}

// Parse the historical trade file
function parseTradeHistory(filePath: string): HistoricalRecord[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').slice(1); // Skip header
  
  const records: HistoricalRecord[] = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const parts = line.split('\t').map(p => p.trim());
    if (parts.length < 4) continue;
    
    const [timeStr, type, amountStr, symbol] = parts;
    
    // Parse date (format: "10/8/2025 10:27")
    const [datePart, timePart] = timeStr.split(' ');
    const [month, day, year] = datePart.split('/');
    const [hour, minute] = timePart.split(':');
    const time = new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute)
    );
    
    // Parse amount (format: "1.34984482 USDT" or "-0.00682095 USDT")
    const amount = parseFloat(amountStr.split(' ')[0]);
    
    records.push({
      time,
      type: type as any,
      amount,
      symbol
    });
  }
  
  return records;
}

async function validateTradeHistory() {
  console.log('🔍 Starting trade history validation...\n');
  
  // Parse historical file
  const filePath = path.join(process.cwd(), 'attached_assets', 
    'Pasted-Time-Type-Amount-Symbol-10-8-2025-10-27-Realized-PNL-1-34984482-USDT-ETHUSDT-10-8-2025-10-27-Commi-1759952329989_1759952329989.txt');
  
  const historicalRecords = parseTradeHistory(filePath);
  
  // Filter from Oct 4th onwards
  const oct4th2025 = new Date(2025, 9, 4, 0, 0, 0); // Month is 0-indexed
  const filteredRecords = historicalRecords.filter(r => r.time >= oct4th2025);
  
  console.log(`📊 Total records in file: ${historicalRecords.length}`);
  console.log(`📅 Records from Oct 4th onwards: ${filteredRecords.length}\n`);
  
  // Aggregate by symbol and type
  const fileData = new Map<string, { pnl: number; commission: number; funding: number }>();
  
  for (const record of filteredRecords) {
    if (!fileData.has(record.symbol)) {
      fileData.set(record.symbol, { pnl: 0, commission: 0, funding: 0 });
    }
    
    const data = fileData.get(record.symbol)!;
    
    if (record.type === 'Realized PNL') {
      data.pnl += record.amount;
    } else if (record.type === 'Commission') {
      data.commission += Math.abs(record.amount); // Commissions are negative in file
    } else if (record.type === 'Funding fee') {
      data.funding += record.amount;
    }
  }
  
  // Query database positions from Oct 4th onwards
  const dbPositions = await db
    .select()
    .from(positions)
    .where(sql`${positions.closedAt} >= ${oct4th2025.toISOString()}`)
    .orderBy(positions.closedAt);
  
  console.log(`💾 Database positions from Oct 4th: ${dbPositions.length}\n`);
  
  // Get fills for those positions to calculate commission
  const positionIds = dbPositions.map(p => p.id);
  let dbFills: any[] = [];
  
  if (positionIds.length > 0) {
    dbFills = await db
      .select()
      .from(fills)
      .where(sql`${fills.positionId} = ANY(ARRAY[${sql.join(positionIds.map(id => sql`${id}`), sql`, `)}]::text[])`);
  }
  
  console.log(`💾 Database fills for positions: ${dbFills.length}\n`);
  
  // Aggregate database data by symbol
  const dbData = new Map<string, { pnl: number; commission: number }>();
  
  for (const pos of dbPositions) {
    if (!dbData.has(pos.symbol)) {
      dbData.set(pos.symbol, { pnl: 0, commission: 0 });
    }
    
    const data = dbData.get(pos.symbol)!;
    data.pnl += parseFloat(pos.realizedPnl || '0');
  }
  
  // Add commission from fills
  for (const fill of dbFills) {
    if (!dbData.has(fill.symbol)) {
      dbData.set(fill.symbol, { pnl: 0, commission: 0 });
    }
    
    const data = dbData.get(fill.symbol)!;
    data.commission += parseFloat(fill.fee || '0');
  }
  
  // Compare results
  const allSymbols = Array.from(new Set([...Array.from(fileData.keys()), ...Array.from(dbData.keys())]));
  const results: ValidationResult[] = [];
  
  console.log('=' .repeat(120));
  console.log('SYMBOL'.padEnd(20) + 
    'DB P&L'.padEnd(15) + 
    'FILE P&L'.padEnd(15) + 
    'DB COMM'.padEnd(15) + 
    'FILE COMM'.padEnd(15) + 
    'P&L DIFF'.padEnd(15) + 
    'COMM DIFF'.padEnd(15) +
    'STATUS');
  console.log('=' .repeat(120));
  
  for (const symbol of allSymbols.sort()) {
    const db = dbData.get(symbol) || { pnl: 0, commission: 0 };
    const file = fileData.get(symbol) || { pnl: 0, commission: 0, funding: 0 };
    
    const pnlDiff = Math.abs(db.pnl - file.pnl);
    const commissionDiff = Math.abs(db.commission - file.commission);
    
    // Allow small rounding differences (0.01 USDT)
    const pnlMatch = pnlDiff < 0.01;
    const commissionMatch = commissionDiff < 0.01;
    
    const result: ValidationResult = {
      symbol,
      dbPnl: db.pnl,
      filePnl: file.pnl,
      dbCommission: db.commission,
      fileCommission: file.commission,
      pnlMatch,
      commissionMatch,
      pnlDiff,
      commissionDiff
    };
    
    results.push(result);
    
    const status = pnlMatch && commissionMatch ? '✅ MATCH' : '❌ MISMATCH';
    
    console.log(
      symbol.padEnd(20) +
      db.pnl.toFixed(4).padEnd(15) +
      file.pnl.toFixed(4).padEnd(15) +
      db.commission.toFixed(4).padEnd(15) +
      file.commission.toFixed(4).padEnd(15) +
      pnlDiff.toFixed(4).padEnd(15) +
      commissionDiff.toFixed(4).padEnd(15) +
      status
    );
  }
  
  console.log('=' .repeat(120));
  
  // Summary
  const totalMatches = results.filter(r => r.pnlMatch && r.commissionMatch).length;
  const pnlMismatches = results.filter(r => !r.pnlMatch).length;
  const commissionMismatches = results.filter(r => !r.commissionMatch).length;
  
  console.log('\n📊 SUMMARY:');
  console.log(`   Total symbols: ${results.length}`);
  console.log(`   ✅ Perfect matches: ${totalMatches}`);
  console.log(`   ❌ P&L mismatches: ${pnlMismatches}`);
  console.log(`   ❌ Commission mismatches: ${commissionMismatches}`);
  
  // Calculate totals
  const totalDbPnl = results.reduce((sum, r) => sum + r.dbPnl, 0);
  const totalFilePnl = results.reduce((sum, r) => sum + r.filePnl, 0);
  const totalDbCommission = results.reduce((sum, r) => sum + r.dbCommission, 0);
  const totalFileCommission = results.reduce((sum, r) => sum + r.fileCommission, 0);
  
  console.log('\n💰 TOTALS:');
  console.log(`   Database P&L: ${totalDbPnl.toFixed(4)} USDT`);
  console.log(`   File P&L: ${totalFilePnl.toFixed(4)} USDT`);
  console.log(`   Difference: ${(totalDbPnl - totalFilePnl).toFixed(4)} USDT`);
  console.log(`   Database Commission: ${totalDbCommission.toFixed(4)} USDT`);
  console.log(`   File Commission: ${totalFileCommission.toFixed(4)} USDT`);
  console.log(`   Difference: ${(totalDbCommission - totalFileCommission).toFixed(4)} USDT`);
  
  // Funding fees note
  const totalFunding = Array.from(fileData.values()).reduce((sum, d) => sum + d.funding, 0);
  console.log('\n⚠️  NOTE: Funding fees are NOT tracked in database');
  console.log(`   Total funding fees in file: ${totalFunding.toFixed(4)} USDT`);
  console.log('   (This is expected and not included in P&L comparison)');
  
  // Show detailed mismatches
  const mismatches = results.filter(r => !r.pnlMatch || !r.commissionMatch);
  if (mismatches.length > 0) {
    console.log('\n🔍 DETAILED MISMATCHES:');
    for (const m of mismatches) {
      if (!m.pnlMatch) {
        console.log(`   ${m.symbol}: P&L diff = ${m.pnlDiff.toFixed(6)} USDT (DB: ${m.dbPnl.toFixed(6)}, File: ${m.filePnl.toFixed(6)})`);
      }
      if (!m.commissionMatch) {
        console.log(`   ${m.symbol}: Commission diff = ${m.commissionDiff.toFixed(6)} USDT (DB: ${m.dbCommission.toFixed(6)}, File: ${m.fileCommission.toFixed(6)})`);
      }
    }
  }
  
  console.log('\n✅ Validation complete!');
}

// Run validation
validateTradeHistory().catch(console.error);
