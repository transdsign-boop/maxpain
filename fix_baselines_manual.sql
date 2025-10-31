-- Manually fix all baselines to correct values
-- Based on actual account balance history

-- R's $1,300 deposit (came after K's first $1,300)
UPDATE account_ledger
SET baseline_balance = '1300.00',
    updated_at = NOW()
WHERE investor = 'R'
  AND amount = '1300.00'
  AND timestamp = '2025-10-16T17:09:00.000Z';

-- DT's $1,300 deposit (came after K + R = $2,600)
UPDATE account_ledger
SET baseline_balance = '2600.00',
    updated_at = NOW()
WHERE investor = 'DT'
  AND amount = '1300.00'
  AND timestamp = '2025-10-16T17:19:00.000Z';

-- DT's $5,000 deposit (balance was $4,200 before)
UPDATE account_ledger
SET baseline_balance = '4200.00',
    updated_at = NOW()
WHERE investor = 'DT'
  AND amount = '5000.00'
  AND timestamp = '2025-10-28T18:14:09.119Z';

-- K's $5,000 deposit (balance was $9,505.87 before)
UPDATE account_ledger
SET baseline_balance = '9505.87',
    updated_at = NOW()
WHERE investor = 'K'
  AND amount = '5000.00'
  AND timestamp = '2025-10-30T06:05:49.936Z';

-- Verify the fix
SELECT
  investor,
  amount,
  baseline_balance,
  TO_CHAR(timestamp, 'YYYY-MM-DD HH24:MI:SS') as deposit_time
FROM account_ledger
ORDER BY timestamp;
