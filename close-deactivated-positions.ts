import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function closeDeactivated() {
  const result = await sql`
    UPDATE positions 
    SET is_open = false, closed_at = NOW()
    WHERE is_open = true 
    AND session_id IN (
      SELECT id FROM trade_sessions WHERE is_active = false
    )
  `;
  
  console.log('✅ Closed positions from newly deactivated sessions');
  
  // Check what's left
  const remaining = await sql`
    SELECT p.symbol, p.side 
    FROM positions p
    JOIN trade_sessions s ON p.session_id = s.id
    WHERE p.is_open = true AND s.is_active = true
  `;
  
  console.log(`\nRemaining open positions in ACTIVE session: ${remaining.length}`);
  remaining.forEach(p => console.log(`  - ${p.symbol} ${p.side.toUpperCase()}`));
}

closeDeactivated();
