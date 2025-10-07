import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function checkAllTables() {
  console.log('📊 YOUR NEON DATABASE TABLES\n');
  console.log('='.repeat(60));
  
  // 1. Fills
  const fills = await sql`SELECT COUNT(*) as count FROM fills`;
  console.log(`\n1. ✅ FILLS: ${fills[0].count} records`);
  console.log(`   Purpose: Trade execution history (buy/sell fills)`);
  
  // 2. Liquidations
  const liq = await sql`SELECT COUNT(*) as count FROM liquidations`;
  console.log(`\n2. ✅ LIQUIDATIONS: ${liq[0].count} records`);
  console.log(`   Purpose: Market liquidation events from Aster DEX`);
  
  // 3. Orders
  const orders = await sql`SELECT COUNT(*) as count FROM orders`;
  console.log(`\n3. ✅ ORDERS: ${orders[0].count} records`);
  console.log(`   Purpose: Order history and tracking`);
  
  // 4. PnL Snapshots
  const pnl = await sql`SELECT COUNT(*) as count FROM pnl_snapshots`;
  console.log(`\n4. ✅ PNL_SNAPSHOTS: ${pnl[0].count} records`);
  console.log(`   Purpose: Periodic profit/loss snapshots for charting`);
  
  // 5. Positions
  const pos = await sql`SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE is_open = true) as open FROM positions`;
  console.log(`\n5. ✅ POSITIONS: ${pos[0].count} total (${pos[0].open} open, ${pos[0].count - pos[0].open} closed)`);
  console.log(`   Purpose: Your trading positions (both open and closed)`);
  
  // 6. Sessions (deprecated)
  const sess = await sql`SELECT COUNT(*) as count FROM sessions`;
  console.log(`\n6. ⚠️  SESSIONS: ${sess[0].count} records`);
  console.log(`   Purpose: DEPRECATED - old paper trading sessions`);
  
  // 7. Strategies
  const strat = await sql`SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE is_active = true) as active FROM strategies`;
  console.log(`\n7. ✅ STRATEGIES: ${strat[0].count} total (${strat[0].active} active)`);
  console.log(`   Purpose: Your trading strategies and settings`);
  
  // 8. Strategy Changes
  const changes = await sql`SELECT COUNT(*) as count FROM strategy_changes`;
  console.log(`\n8. ✅ STRATEGY_CHANGES: ${changes[0].count} records`);
  console.log(`   Purpose: History of strategy parameter changes`);
  
  // 9. Trade Sessions
  const tradeSess = await sql`SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE is_active = true) as active FROM trade_sessions`;
  console.log(`\n9. ✅ TRADE_SESSIONS: ${tradeSess[0].count} total (${tradeSess[0].active} active, ${tradeSess[0].count - tradeSess[0].active} archived)`);
  console.log(`   Purpose: Trading sessions tracking balance and P&L`);
  
  // 10. User Settings
  const settings = await sql`SELECT COUNT(*) as count FROM user_settings`;
  console.log(`\n10. ✅ USER_SETTINGS: ${settings[0].count} records`);
  console.log(`    Purpose: UI preferences and display settings`);
  
  // 11. Users
  const users = await sql`SELECT COUNT(*) as count FROM users`;
  console.log(`\n11. ✅ USERS: ${users[0].count} records`);
  console.log(`    Purpose: User accounts`);
  
  console.log('\n' + '='.repeat(60));
  console.log('\n📈 KEY TRADING DATA:');
  console.log(`   - ${pos[0].count - pos[0].open} completed trades preserved forever`);
  console.log(`   - ${tradeSess[0].active} active trading session`);
  console.log(`   - ${tradeSess[0].count - tradeSess[0].active} archived sessions (data preserved)`);
  console.log(`   - ${liq[0].count} liquidation events for analysis`);
}

checkAllTables();
