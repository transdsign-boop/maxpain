import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function checkOpenPositions() {
  const openPositions = await sql`
    SELECT id, symbol, side, is_open, session_id, opened_at
    FROM positions 
    WHERE is_open = true
    ORDER BY opened_at DESC
  `;
  
  console.log(`Found ${openPositions.length} open positions in database:\n`);
  openPositions.forEach((p: any, i: number) => {
    console.log(`${i + 1}. ${p.symbol} ${p.side.toUpperCase()} - Session: ${p.session_id.substring(0, 8)}... - Opened: ${p.opened_at}`);
  });
  
  // Check which session is active
  const activeSessions = await sql`
    SELECT id, is_active FROM trade_sessions WHERE is_active = true
  `;
  console.log(`\nActive sessions: ${activeSessions.length}`);
  activeSessions.forEach((s: any) => {
    console.log(`  - ${s.id.substring(0, 8)}...`);
  });
}

checkOpenPositions();
