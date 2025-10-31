import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.NEON_DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: NEON_DATABASE_URL environment variable not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function fixBaselines() {
  console.log('🔧 Fixing baseline balances in account ledger...\n');

  // Get all ledger entries ordered by timestamp
  const entries = await sql`
    SELECT id, investor, type, amount, timestamp, baseline_balance
    FROM account_ledger
    WHERE user_id = 'personal_user'
    ORDER BY timestamp ASC
  `;

  console.log(`Found ${entries.length} ledger entries\n`);

  // Based on the investor report data, here are the correct baselines:
  const baselines = [
    // October 16 - Initial deposits (account started at $0)
    { investor: 'K', amount: '1300', date: '2025-10-16', baseline: '0' },
    { investor: 'R', amount: '1300', date: '2025-10-16', baseline: '0' },
    { investor: 'DT', amount: '1300', date: '2025-10-16', baseline: '0' },

    // October 28 - DT's additional deposit (account had grown to $4,200)
    { investor: 'DT', amount: '5000', date: '2025-10-28', baseline: '4200' },

    // October 30 - K's additional deposit (account had grown to $9,505.87)
    { investor: 'K', amount: '5000', date: '2025-10-30', baseline: '9505.87' },
  ];

  console.log('Updating baseline balances:\n');

  for (const fix of baselines) {
    // Find matching entry
    const matching = entries.find((e: any) => {
      const entryDate = new Date(e.timestamp).toISOString().split('T')[0];
      const entryAmount = parseFloat(e.amount);
      const fixAmount = parseFloat(fix.amount);

      return e.investor === fix.investor &&
             entryDate === fix.date &&
             Math.abs(entryAmount - fixAmount) < 0.01;
    });

    if (matching) {
      console.log(`  ${fix.investor}: $${fix.amount} on ${fix.date} → baseline: $${fix.baseline}`);

      await sql`
        UPDATE account_ledger
        SET baseline_balance = ${fix.baseline},
            updated_at = NOW()
        WHERE id = ${matching.id}
      `;
    } else {
      console.log(`  ⚠️  No match found for ${fix.investor} $${fix.amount} on ${fix.date}`);
    }
  }

  console.log('\n✅ Baseline balances updated successfully!');
  console.log('\nVerifying updates...\n');

  const updated = await sql`
    SELECT investor, amount, timestamp, baseline_balance
    FROM account_ledger
    WHERE user_id = 'personal_user' AND baseline_balance IS NOT NULL
    ORDER BY timestamp ASC
  `;

  updated.forEach((e: any) => {
    const date = new Date(e.timestamp).toISOString().split('T')[0];
    console.log(`  ${e.investor.padEnd(3)}: $${e.amount.toString().padStart(7)} on ${date} | baseline: $${e.baseline_balance}`);
  });

  console.log('\n🎉 Done! The investor report should now work correctly.');
}

fixBaselines().catch(console.error);
