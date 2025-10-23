import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.NEON_DATABASE_URL!);

async function debugPositions() {
  console.log("Querying all positions from database...\n");

  const positions = await sql`
    SELECT
      id,
      symbol,
      side,
      avg_entry_price,
      total_quantity,
      is_open,
      opened_at,
      closed_at,
      realized_pnl,
      session_id
    FROM positions
    ORDER BY closed_at DESC NULLS LAST
  `;

  console.log(`Total positions: ${positions.length}`);
  console.log(`Open positions: ${positions.filter(p => p.is_open).length}`);
  console.log(`Closed positions: ${positions.filter(p => !p.is_open).length}\n`);

  console.log("Closed positions with details:");
  positions
    .filter(p => !p.is_open && p.closed_at)
    .forEach((p, i) => {
      console.log(`\n${i + 1}. ${p.symbol} ${p.side.toUpperCase()}`);
      console.log(`   Position ID: ${p.id}`);
      console.log(`   Session ID: ${p.session_id}`);
      console.log(`   Opened: ${p.opened_at}`);
      console.log(`   Closed: ${p.closed_at}`);
      console.log(`   Entry: $${p.avg_entry_price}`);
      console.log(`   Quantity: ${p.total_quantity}`);
      console.log(`   Realized P&L: ${p.realized_pnl === null ? 'NULL' : `$${p.realized_pnl}`}`);
    });

  console.log("\n\nSession summary:");
  const sessionIds = [...new Set(positions.map(p => p.session_id))];
  for (const sessionId of sessionIds) {
    const sessionPositions = positions.filter(p => p.session_id === sessionId);
    const closedCount = sessionPositions.filter(p => !p.is_open && p.closed_at).length;
    console.log(`Session ${sessionId}: ${sessionPositions.length} total, ${closedCount} closed`);
  }
}

debugPositions().catch(console.error);
