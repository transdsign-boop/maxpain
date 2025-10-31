-- Fix baseline values that were captured AFTER deposits instead of BEFORE
-- Baseline should represent balance BEFORE the transaction

-- Fix DT's $5,000 deposit (Oct 28)
-- Current: 4213.66, but if this includes the deposit, it should be: 4213.66 - 5000 = -786.34 (impossible)
-- So this one might be correct, or the account was genuinely at $4213.66 before deposit

-- Fix K's $5,000 deposit (Oct 30)
-- Current: 14505.87 (includes the deposit)
-- Should be: 14505.87 - 5000 = 9505.87 (balance before K's deposit)
UPDATE account_ledger
SET baseline_balance = (CAST(baseline_balance AS DECIMAL) - CAST(amount AS DECIMAL))::TEXT,
    updated_at = NOW()
WHERE investor = 'K'
  AND amount = '5000.00'
  AND type = 'manual_add'
  AND baseline_balance IS NOT NULL;

-- Also check DT's $5k - if balance was indeed $9213.66 before DT's deposit,
-- then baseline should be: 9213.66 - 5000 = 4213.66 ✅ (already correct!)

SELECT
  investor,
  amount,
  baseline_balance as old_baseline,
  (CAST(baseline_balance AS DECIMAL) - CAST(amount AS DECIMAL)) as new_baseline,
  timestamp
FROM account_ledger
WHERE amount IN ('5000.00')
ORDER BY timestamp;
