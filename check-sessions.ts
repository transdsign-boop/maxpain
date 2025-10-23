import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function checkSessions() {
  const sessions = await sql`
    SELECT id, mode, is_active, started_at, ended_at
    FROM trade_sessions
    ORDER BY started_at DESC
  `;

  console.log(`Total sessions: ${sessions.length}`);
  console.log(`Active sessions: ${sessions.filter(s => s.is_active).length}\n`);

  for (const session of sessions) {
    const positions = await sql`
      SELECT COUNT(*) as count
      FROM positions
      WHERE session_id = ${session.id} AND is_open = false AND closed_at IS NOT NULL
    `;

    const closedCount = parseInt(positions[0].count);

    console.log(`Session ${session.id.substring(0, 8)}...`);
    console.log(`  Mode: ${session.mode}`);
    console.log(`  Active: ${session.is_active}`);
    console.log(`  Started: ${session.started_at}`);
    console.log(`  Closed positions: ${closedCount}`);
    console.log();
  }
}

checkSessions().catch(console.error);
