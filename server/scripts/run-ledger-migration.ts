#!/usr/bin/env tsx

/**
 * Run account ledger migration
 * This script creates the account_ledger table in Neon database
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

async function runMigration() {
  console.log('🔄 Running account_ledger migration...');

  try {
    // Create table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS account_ledger (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL,
        type TEXT NOT NULL,
        amount DECIMAL(18, 2) NOT NULL,
        asset TEXT NOT NULL DEFAULT 'USDT',
        timestamp TIMESTAMP NOT NULL,
        investor TEXT,
        reason TEXT,
        notes TEXT,
        tran_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    console.log('✅ Table created');

    // Create indexes
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ledger_user_timestamp ON account_ledger(user_id, timestamp)
    `);
    console.log('✅ Index idx_ledger_user_timestamp created');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ledger_investor ON account_ledger(investor)
    `);
    console.log('✅ Index idx_ledger_investor created');

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ledger_type ON account_ledger(type)
    `);
    console.log('✅ Index idx_ledger_type created');

    // Verify table
    const result = await db.execute(sql`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'account_ledger'
      ORDER BY ordinal_position
    `);

    console.log('✅ Migration completed successfully');
    console.log(`📊 Table has ${result.rows.length} columns`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
