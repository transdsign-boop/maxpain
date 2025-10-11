import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.NEON_DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ NEON_DATABASE_URL not found');
  process.exit(1);
}

async function dropAdaptiveTpColumns() {
  const sql = neon(DATABASE_URL);
  
  console.log('🗑️  Dropping adaptive TP columns from strategies table...');
  
  try {
    // Drop the 4 leftover columns from the adaptive TP feature
    await sql`ALTER TABLE strategies DROP COLUMN IF EXISTS adaptive_tp_enabled`;
    console.log('   ✅ Dropped adaptive_tp_enabled');
    
    await sql`ALTER TABLE strategies DROP COLUMN IF EXISTS tp_atr_multiplier`;
    console.log('   ✅ Dropped tp_atr_multiplier');
    
    await sql`ALTER TABLE strategies DROP COLUMN IF EXISTS min_tp_percent`;
    console.log('   ✅ Dropped min_tp_percent');
    
    await sql`ALTER TABLE strategies DROP COLUMN IF EXISTS max_tp_percent`;
    console.log('   ✅ Dropped max_tp_percent');
    
    console.log('\n✨ Cleanup complete! Schema now matches database.');
    console.log('🔄 Restart your application to see performance improvements.');
    
  } catch (error) {
    console.error('❌ Error dropping columns:', error);
    process.exit(1);
  }
}

dropAdaptiveTpColumns();
