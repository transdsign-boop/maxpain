import { db } from './db';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

async function createFilePeriodSession() {
  // File date range: Oct 4-8, 2025
  const startDate = new Date('2025-10-04T00:00:00');
  const endDate = new Date('2025-10-08T23:59:59');

  console.log('📅 Creating session for file period:');
  console.log(`   From: ${startDate.toLocaleString()}`);
  console.log(`   To: ${endDate.toLocaleString()}\n`);

  // Get positions in this date range
  const result: any = await db.execute(
    sql`SELECT COUNT(*) as count, 
        SUM(CASE WHEN is_open = false THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN is_open = true THEN 1 ELSE 0 END) as open,
        SUM(CASE WHEN is_open = false THEN CAST(realized_pnl AS DECIMAL) ELSE 0 END) as total_pnl
        FROM positions 
        WHERE opened_at >= ${startDate.toISOString()} 
        AND opened_at <= ${endDate.toISOString()}`
  );

  const stats = (result.rows || result)[0];
  console.log(`📊 Positions in this period:`);
  console.log(`   Total: ${stats.count}`);
  console.log(`   Closed: ${stats.closed}`);
  console.log(`   Open: ${stats.open}`);
  console.log(`   Total P&L: $${parseFloat(stats.total_pnl || '0').toFixed(2)}\n`);

  // Archive all current sessions
  console.log('📦 Archiving all current sessions...');
  await db.execute(sql`UPDATE trade_sessions SET is_active = false`);

  // Create new session
  const newSessionId = randomUUID();
  await db.execute(
    sql`INSERT INTO trade_sessions (id, strategy_id, starting_balance, current_balance, is_active, started_at)
        SELECT ${newSessionId}, strategy_id, starting_balance, current_balance, true, NOW()
        FROM trade_sessions 
        WHERE is_active = false 
        LIMIT 1`
  );

  // Move positions in date range to new session
  const updateResult: any = await db.execute(
    sql`UPDATE positions 
        SET session_id = ${newSessionId}
        WHERE opened_at >= ${startDate.toISOString()} 
        AND opened_at <= ${endDate.toISOString()}`
  );

  console.log(`✅ Created new session: ${newSessionId}`);
  console.log(`   Moved ${stats.count} positions to this session\n`);

  console.log('📊 Summary:');
  console.log(`   UI will now show ${stats.count} positions from Oct 4-8, 2025`);
  console.log(`   This matches the date range in your exchange file`);
}

createFilePeriodSession()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
