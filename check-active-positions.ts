import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function check() {
  // Get active session ID
  const activeSessions = await sql`
    SELECT id FROM trade_sessions WHERE is_active = true ORDER BY created_at DESC LIMIT 1
  `;
  
  const activeSessionId = activeSessions[0]?.id;
  console.log(`Active session: ${activeSessionId}\n`);
  
  // Get positions in active session
  const activeOpenPositions = await sql`
    SELECT symbol, side FROM positions 
    WHERE session_id = ${activeSessionId} AND is_open = true
  `;
  
  console.log(`Open positions in ACTIVE session (${activeOpenPositions.length}):`);
  activeOpenPositions.forEach(p => console.log(`  - ${p.symbol} ${p.side.toUpperCase()}`));
  
  // Get positions in INACTIVE sessions
  const inactiveOpenPositions = await sql`
    SELECT symbol, side, session_id FROM positions 
    WHERE session_id != ${activeSessionId} AND is_open = true
    LIMIT 10
  `;
  
  console.log(`\nOpen positions in INACTIVE sessions (showing 10 of many):`);
  inactiveOpenPositions.forEach(p => console.log(`  - ${p.symbol} ${p.side.toUpperCase()} (session: ${p.session_id.substring(0, 8)}...)`));
}

check();
