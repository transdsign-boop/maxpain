import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function dropColumns() {
  try {
    console.log('Dropping trading_mode from strategies...');
    await sql`ALTER TABLE strategies DROP COLUMN IF EXISTS trading_mode`;
    console.log('✓ Dropped trading_mode');
    
    console.log('Dropping paper_account_size from strategies...');
    await sql`ALTER TABLE strategies DROP COLUMN IF EXISTS paper_account_size`;
    console.log('✓ Dropped paper_account_size');
    
    console.log('Dropping mode from trade_sessions...');
    await sql`ALTER TABLE trade_sessions DROP COLUMN IF EXISTS mode`;
    console.log('✓ Dropped mode');
    
    console.log('\n✅ All mode columns successfully dropped from Neon database!');
  } catch (error) {
    console.error('Error dropping columns:', error);
    process.exit(1);
  }
}

dropColumns();
