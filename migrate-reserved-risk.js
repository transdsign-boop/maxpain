import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL);

async function migrate() {
  try {
    console.log('🔄 Adding reserved_risk columns to positions table...');
    
    await sql`
      ALTER TABLE positions 
      ADD COLUMN IF NOT EXISTS reserved_risk_dollars NUMERIC(18, 8),
      ADD COLUMN IF NOT EXISTS reserved_risk_percent NUMERIC(5, 2);
    `;
    
    console.log('✅ Migration completed successfully!');
    console.log('   - reserved_risk_dollars (NUMERIC 18,8) added');
    console.log('   - reserved_risk_percent (NUMERIC 5,2) added');
    
    // Verify columns exist
    const result = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'positions' 
      AND column_name IN ('reserved_risk_dollars', 'reserved_risk_percent');
    `;
    
    console.log('\n📊 Verified columns:');
    result.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type}`);
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();
