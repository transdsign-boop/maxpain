import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL!);

async function createTransfersTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "transfers" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "user_id" varchar NOT NULL,
        "amount" numeric(18, 8) NOT NULL,
        "asset" text DEFAULT 'USDT' NOT NULL,
        "transaction_id" varchar,
        "timestamp" timestamp NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "unique_transfer_composite" UNIQUE("user_id","timestamp","amount","asset")
      )
    `;
    
    await sql`
      CREATE INDEX IF NOT EXISTS "idx_transfers_user_timestamp" ON "transfers" USING btree ("user_id","timestamp")
    `;
    
    console.log('✅ Transfers table created successfully');
  } catch (error) {
    console.error('❌ Error creating transfers table:', error);
    throw error;
  }
}

createTransfersTable()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
