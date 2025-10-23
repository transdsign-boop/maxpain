const fs = require('fs');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.NEON_DATABASE_URL);

async function runMigration() {
  console.log('🔄 Running VWAP Direction Filter migration...\n');

  try {
    // Add vwap_filter_enabled column
    console.log('Adding vwap_filter_enabled column...');
    await sql`
      ALTER TABLE strategies
      ADD COLUMN IF NOT EXISTS vwap_filter_enabled BOOLEAN NOT NULL DEFAULT FALSE
    `;
    console.log('✅ vwap_filter_enabled added\n');

    // Add vwap_timeframe_minutes column
    console.log('Adding vwap_timeframe_minutes column...');
    await sql`
      ALTER TABLE strategies
      ADD COLUMN IF NOT EXISTS vwap_timeframe_minutes INTEGER NOT NULL DEFAULT 240
    `;
    console.log('✅ vwap_timeframe_minutes added\n');

    // Add vwap_buffer_percentage column
    console.log('Adding vwap_buffer_percentage column...');
    await sql`
      ALTER TABLE strategies
      ADD COLUMN IF NOT EXISTS vwap_buffer_percentage DECIMAL(6,4) NOT NULL DEFAULT 0.0005
    `;
    console.log('✅ vwap_buffer_percentage added\n');

    // Add vwap_enable_buffer column
    console.log('Adding vwap_enable_buffer column...');
    await sql`
      ALTER TABLE strategies
      ADD COLUMN IF NOT EXISTS vwap_enable_buffer BOOLEAN NOT NULL DEFAULT TRUE
    `;
    console.log('✅ vwap_enable_buffer added\n');

    // Verify the columns were added
    console.log('Verifying columns...');
    const result = await sql`
      SELECT
        column_name,
        data_type,
        column_default,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = 'strategies'
        AND column_name LIKE 'vwap%'
      ORDER BY ordinal_position
    `;

    console.log('\n📊 VWAP columns in strategies table:');
    console.table(result);

    console.log('\n✅ Migration completed successfully!');
    console.log('   - vwap_filter_enabled: Enable/disable VWAP filter');
    console.log('   - vwap_timeframe_minutes: VWAP calculation period (default: 240 = 4h)');
    console.log('   - vwap_buffer_percentage: Buffer zone size (default: 0.0005 = 0.05%)');
    console.log('   - vwap_enable_buffer: Toggle buffer zone (default: true)');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

runMigration().catch(err => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
