import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function closeOrphanedPositions() {
  // Close all positions in INACTIVE sessions
  const result = await sql`
    UPDATE positions 
    SET is_open = false, closed_at = NOW()
    WHERE is_open = true 
    AND session_id IN (
      SELECT id FROM trade_sessions WHERE is_active = false
    )
  `;
  
  console.log(`✅ Closed ${result.count} orphaned positions from inactive sessions`);
  
  // Verify what's left
  const remaining = await sql`
    SELECT COUNT(*) as count FROM positions WHERE is_open = true
  `;
  console.log(`\nRemaining open positions: ${remaining[0].count}`);
}

closeOrphanedPositions();
