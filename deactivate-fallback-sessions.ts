import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function deactivateFallbacks() {
  // Keep only session 001e49f1 active, deactivate others
  const result = await sql`
    UPDATE trade_sessions 
    SET is_active = false, ended_at = NOW()
    WHERE is_active = true 
    AND id != '001e49f1-faee-4949-8ff0-583bc3130433'
  `;
  
  console.log('✅ Deactivated fallback sessions');
  
  // Verify
  const active = await sql`SELECT id FROM trade_sessions WHERE is_active = true`;
  console.log(`\nActive sessions remaining: ${active.length}`);
  active.forEach(s => console.log(`  - ${s.id}`));
}

deactivateFallbacks();
