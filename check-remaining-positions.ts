import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function check() {
  const openPos = await sql`
    SELECT p.symbol, p.side, p.opened_at, s.id as session_id, s.is_active
    FROM positions p
    JOIN trade_sessions s ON p.session_id = s.id
    WHERE p.is_open = true
    ORDER BY p.opened_at DESC
  `;
  
  console.log(`7 Open Positions:\n`);
  openPos.forEach((p, i) => {
    console.log(`${i + 1}. ${p.symbol} ${p.side.toUpperCase()} - Session ${p.session_id.substring(0, 8)}... (${p.is_active ? 'ACTIVE' : 'INACTIVE'}) - ${new Date(p.opened_at).toLocaleString()}`);
  });
  
  // Group by session
  const bySess = openPos.reduce((acc: any, p) => {
    const key = p.session_id.substring(0, 8);
    if (!acc[key]) acc[key] = [];
    acc[key].push(`${p.symbol} ${p.side}`);
    return acc;
  }, {});
  
  console.log(`\nGrouped by session:`);
  Object.entries(bySess).forEach(([sess, positions]) => {
    console.log(`  ${sess}...: ${(positions as string[]).join(', ')}`);
  });
}

check();
