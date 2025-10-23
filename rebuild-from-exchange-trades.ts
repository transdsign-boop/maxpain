import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { positions, tradeSessions } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { createHmac } from 'crypto';
import * as fs from 'fs';

/**
 * COMPLETE DATABASE REBUILD FROM EXCHANGE TRADES
 *
 * This script:
 * 1. Fetches ALL trade history from exchange (all symbols)
 * 2. Groups trades into positions using exchange logic:
 *    - Entry: realizedPnl = "0"
 *    - Exit: realizedPnl != "0"
 * 3. Clears and rebuilds positions table to match exchange exactly
 */

interface ExchangeTrade {
  id: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: string;
  qty: string;
  realizedPnl: string;
  commission: string;
  commissionAsset: string;
  time: number;
  positionSide: string;
  buyer: boolean;
  maker: boolean;
}

interface Position {
  symbol: string;
  side: 'long' | 'short';
  entryTrades: ExchangeTrade[];
  exitTrades: ExchangeTrade[];
  openedAt: Date;
  closedAt: Date | null;
  avgEntryPrice: number;
  totalQuantity: number;
  realizedPnl: number;
  commission: number;
}

async function fetchAllTradesForSymbol(
  symbol: string,
  apiKey: string,
  secretKey: string
): Promise<ExchangeTrade[]> {
  const allTrades: ExchangeTrade[] = [];
  let fromId = 0;
  const limit = 1000;

  while (true) {
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&limit=${limit}${fromId > 0 ? `&fromId=${fromId}` : ''}&timestamp=${timestamp}`;

    const signature = createHmac('sha256', secretKey)
      .update(queryString)
      .digest('hex');

    const response = await fetch(
      `https://fapi.asterdex.com/fapi/v1/userTrades?${queryString}&signature=${signature}`,
      {
        headers: { 'X-MBX-APIKEY': apiKey },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`   ❌ ${symbol}: ${response.status} ${errorText}`);
      break;
    }

    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    allTrades.push(...batch);

    if (batch.length < limit) break;

    fromId = batch[batch.length - 1].id + 1;
  }

  return allTrades;
}

function groupTradesIntoPositions(trades: ExchangeTrade[]): Position[] {
  const positions: Position[] = [];

  // Sort trades by time
  const sortedTrades = [...trades].sort((a, b) => a.time - b.time);

  // Group by symbol and positionSide
  const bySymbolSide = new Map<string, ExchangeTrade[]>();

  for (const trade of sortedTrades) {
    const key = `${trade.symbol}_${trade.positionSide}`;
    if (!bySymbolSide.has(key)) {
      bySymbolSide.set(key, []);
    }
    bySymbolSide.get(key)!.push(trade);
  }

  // For each symbol+side, group into positions
  for (const [key, symbolTrades] of bySymbolSide.entries()) {
    const [symbol, positionSide] = key.split('_');

    // Determine if this is LONG or SHORT
    const side: 'long' | 'short' = positionSide === 'LONG' ? 'long' : 'short';

    let currentPosition: Position | null = null;

    for (const trade of symbolTrades) {
      const pnl = parseFloat(trade.realizedPnl);
      const isEntry = pnl === 0;
      const isExit = pnl !== 0;

      if (isEntry) {
        // Entry trade
        if (!currentPosition) {
          // Start new position
          currentPosition = {
            symbol,
            side,
            entryTrades: [trade],
            exitTrades: [],
            openedAt: new Date(trade.time),
            closedAt: null,
            avgEntryPrice: parseFloat(trade.price),
            totalQuantity: parseFloat(trade.qty),
            realizedPnl: 0,
            commission: Math.abs(parseFloat(trade.commission)),
          };
        } else {
          // Add to existing position (DCA layer)
          currentPosition.entryTrades.push(trade);
          const totalNotional = currentPosition.avgEntryPrice * currentPosition.totalQuantity +
            parseFloat(trade.price) * parseFloat(trade.qty);
          currentPosition.totalQuantity += parseFloat(trade.qty);
          currentPosition.avgEntryPrice = totalNotional / currentPosition.totalQuantity;
          currentPosition.commission += Math.abs(parseFloat(trade.commission));
        }
      } else if (isExit) {
        // Exit trade
        if (currentPosition) {
          currentPosition.exitTrades.push(trade);
          currentPosition.realizedPnl += pnl;
          currentPosition.commission += Math.abs(parseFloat(trade.commission));

          // Check if position is fully closed
          const exitQty = currentPosition.exitTrades.reduce((sum, t) => sum + parseFloat(t.qty), 0);

          if (exitQty >= currentPosition.totalQuantity * 0.999) { // Allow small rounding
            // Position closed
            currentPosition.closedAt = new Date(trade.time);
            positions.push(currentPosition);
            currentPosition = null;
          }
        }
      }
    }

    // If there's an unclosed position, add it as open
    if (currentPosition) {
      positions.push(currentPosition);
    }
  }

  return positions;
}

async function rebuildFromExchangeTrades() {
  console.log('🔄 REBUILDING DATABASE FROM EXCHANGE TRADE HISTORY\n');
  console.log('=' .repeat(70));

  if (!process.env.NEON_DATABASE_URL) {
    console.error('❌ NEON_DATABASE_URL not configured');
    return;
  }

  const apiKey = process.env.ASTER_API_KEY;
  const secretKey = process.env.ASTER_SECRET_KEY;

  if (!apiKey || !secretKey) {
    console.error('❌ API keys not configured');
    return;
  }

  const sql = neon(process.env.NEON_DATABASE_URL);
  const db = drizzle({ client: sql });

  // ========== STEP 1: BACKUP ==========
  console.log('\n📦 STEP 1: Creating backup...\n');

  const allPositions = await db.select().from(positions);
  const backupFilename = `full-backup-${Date.now()}.json`;
  fs.writeFileSync(backupFilename, JSON.stringify({
    timestamp: new Date().toISOString(),
    positions: allPositions,
  }, null, 2));

  console.log(`✅ Backup saved: ${backupFilename}`);
  console.log(`   ${allPositions.length} positions backed up\n`);

  // ========== STEP 2: FETCH ALL TRADE HISTORY ==========
  console.log('📥 STEP 2: Fetching ALL trade history from exchange...\n');

  // Get list of symbols from strategy
  const strategies = await db.select().from(tradeSessions).limit(1);
  const symbols = [
    'BTCUSDT', 'ASTERUSDT', 'AIAUSDT', 'HYPEUSDT', 'STBLUSDT', 'BNBUSDT',
    'FARTCOINUSDT', 'AVNTUSDT', 'XRPUSDT', 'DOGEUSDT', 'SUIUSDT', 'HEMIUSDT',
    'ENAUSDT', 'WLFIUSDT', 'PUMPUSDT', 'SOLUSDT', 'CAKEUSDT', 'XPLUSDT',
    '4USDT', 'COAIUSDT', 'ETHUSDT', 'AVAXUSDT', 'ZECUSDT', 'LINKUSDT', 'LINEAUSDT'
  ];

  let allTrades: ExchangeTrade[] = [];

  for (const symbol of symbols) {
    process.stdout.write(`   Fetching ${symbol}...`);
    const trades = await fetchAllTradesForSymbol(symbol, apiKey, secretKey);
    allTrades.push(...trades);
    console.log(` ${trades.length} trades`);
  }

  console.log(`\n✅ Fetched ${allTrades.length} total trades across ${symbols.length} symbols\n`);

  // ========== STEP 3: GROUP INTO POSITIONS ==========
  console.log('🔨 STEP 3: Grouping trades into positions...\n');

  const exchangePositions = groupTradesIntoPositions(allTrades);

  const openPositions = exchangePositions.filter(p => !p.closedAt);
  const closedPositions = exchangePositions.filter(p => p.closedAt);
  const totalPnl = closedPositions.reduce((sum, p) => sum + p.realizedPnl, 0);

  console.log(`✅ Grouped into ${exchangePositions.length} positions:`);
  console.log(`   Open: ${openPositions.length}`);
  console.log(`   Closed: ${closedPositions.length}`);
  console.log(`   Total P&L: $${totalPnl.toFixed(2)}\n`);

  // ========== STEP 4: CLEAR DATABASE ==========
  console.log('🗑️  STEP 4: Clearing existing positions...\n');

  await sql`DELETE FROM positions`;
  console.log(`✅ Cleared all positions from database\n`);

  // ========== STEP 5: INSERT NEW POSITIONS ==========
  console.log('💾 STEP 5: Inserting exchange positions into database...\n');

  // Get or create a session for these positions
  const sessions = await db.select().from(tradeSessions)
    .where(eq(tradeSessions.isActive, true))
    .limit(1);

  let sessionId: string;
  if (sessions.length > 0) {
    sessionId = sessions[0].id;
    console.log(`   Using existing session: ${sessionId}\n`);
  } else {
    console.error(`❌ No active session found. Please create a session first.`);
    return;
  }

  let insertCount = 0;

  for (const pos of exchangePositions) {
    const positionId = crypto.randomUUID();

    await sql`
      INSERT INTO positions (
        id,
        session_id,
        symbol,
        side,
        avg_entry_price,
        total_quantity,
        total_cost,
        realized_pnl,
        is_open,
        max_layers,
        layers_filled,
        layers_placed,
        leverage,
        opened_at,
        closed_at,
        updated_at
      ) VALUES (
        ${positionId},
        ${sessionId},
        ${pos.symbol},
        ${pos.side},
        ${pos.avgEntryPrice.toString()},
        ${pos.totalQuantity.toString()},
        ${(pos.avgEntryPrice * pos.totalQuantity / 10).toString()},
        ${pos.closedAt ? pos.realizedPnl.toString() : null},
        ${!pos.closedAt},
        ${pos.entryTrades.length},
        ${pos.entryTrades.length},
        ${pos.entryTrades.length},
        10,
        ${pos.openedAt},
        ${pos.closedAt},
        NOW()
      )
    `;

    insertCount++;

    if (insertCount % 100 === 0) {
      console.log(`   Inserted ${insertCount} positions...`);
    }
  }

  console.log(`\n✅ Inserted ${insertCount} positions\n`);

  // ========== STEP 6: VERIFY ==========
  console.log('✅ STEP 6: Verification...\n');

  const dbPositions = await db.select().from(positions);
  const dbClosed = dbPositions.filter(p => !p.isOpen && p.realizedPnl !== null);
  const dbTotal = dbClosed.reduce((sum, p) => sum + parseFloat(p.realizedPnl!), 0);

  console.log('=' .repeat(70));
  console.log('\n📊 FINAL RESULTS:\n');

  console.log('EXCHANGE TRADE HISTORY:');
  console.log(`  Total Trades: ${allTrades.length}`);
  console.log(`  Grouped into Positions: ${exchangePositions.length}`);
  console.log(`  Closed: ${closedPositions.length}`);
  console.log(`  Total P&L: $${totalPnl.toFixed(2)}\n`);

  console.log('DATABASE (AFTER REBUILD):');
  console.log(`  Total Positions: ${dbPositions.length}`);
  console.log(`  Closed: ${dbClosed.length}`);
  console.log(`  Total P&L: $${dbTotal.toFixed(2)}\n`);

  console.log('VERIFICATION:');
  const diff = Math.abs(dbTotal - totalPnl);
  if (diff < 0.01) {
    console.log(`  ✅ PERFECT MATCH! Database now exactly matches exchange.\n`);
  } else {
    console.log(`  ⚠️  Difference: $${diff.toFixed(2)}\n`);
  }

  console.log('=' .repeat(70));
  console.log(`\n✅ Rebuild complete! Backup: ${backupFilename}\n`);
}

rebuildFromExchangeTrades().catch(console.error);
