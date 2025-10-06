import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function addBybitEndpoint() {
  try {
    // Add the bybitEndpoint column with a default value
    await sql`ALTER TABLE strategies ADD COLUMN IF NOT EXISTS bybit_endpoint varchar DEFAULT 'demo'`;
    console.log('✅ Added bybit_endpoint column');
    
    // Also handle the position_size_percent issue - make it nullable if it exists
    await sql`ALTER TABLE strategies ALTER COLUMN position_size_percent DROP NOT NULL`;
    console.log('✅ Made position_size_percent nullable');
  } catch (error: any) {
    console.error('Error:', error?.message || error);
    process.exit(1);
  }
}

addBybitEndpoint();
