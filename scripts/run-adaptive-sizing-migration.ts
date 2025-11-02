#!/usr/bin/env tsx
/**
 * One-time migration script for adaptive position sizing feature
 * Uses NEON_DATABASE_URL to safely execute migration against production database
 */

import { neon } from '@neondatabase/serverless';

async function runMigration() {
  const databaseUrl = process.env.NEON_DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ NEON_DATABASE_URL environment variable not found');
    process.exit(1);
  }

  console.log('🔄 Connecting to Neon database...');
  const sql = neon(databaseUrl);

  try {
    console.log('📝 Adding adaptive_sizing_enabled column...');
    await sql`
      ALTER TABLE strategies
      ADD COLUMN IF NOT EXISTS adaptive_sizing_enabled BOOLEAN NOT NULL DEFAULT false
    `;
    console.log('✅ adaptive_sizing_enabled column added');

    console.log('📝 Adding max_size_multiplier column...');
    await sql`
      ALTER TABLE strategies
      ADD COLUMN IF NOT EXISTS max_size_multiplier DECIMAL(5,2) NOT NULL DEFAULT 3.0
    `;
    console.log('✅ max_size_multiplier column added');

    console.log('📝 Adding scale_all_layers column...');
    await sql`
      ALTER TABLE strategies
      ADD COLUMN IF NOT EXISTS scale_all_layers BOOLEAN NOT NULL DEFAULT false
    `;
    console.log('✅ scale_all_layers column added');

    console.log('\n🔍 Verifying columns...');
    const verification = await sql`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'strategies'
        AND column_name IN ('adaptive_sizing_enabled', 'max_size_multiplier', 'scale_all_layers')
      ORDER BY column_name
    `;

    console.log('\n📊 Migration Results:');
    console.table(verification);

    if (verification.length === 3) {
      console.log('\n✅ Migration completed successfully!');
      console.log('✅ All 3 columns added to strategies table');
      console.log('\n🎯 Next steps:');
      console.log('   1. Refresh your browser');
      console.log('   2. Open Strategy Dialog → Global Settings');
      console.log('   3. Find "Adaptive Position Sizing" section');
      console.log('   4. Toggle it on and configure max size multiplier');
    } else {
      console.log('\n⚠️ Warning: Expected 3 columns, found', verification.length);
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    process.exit(1);
  }
}

runMigration();
