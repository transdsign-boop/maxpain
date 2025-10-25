-- Create account_ledger table for tracking capital movements
-- Run this in Neon SQL Editor

CREATE TABLE IF NOT EXISTS account_ledger (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL,
  type TEXT NOT NULL, -- 'deposit', 'withdrawal', 'manual_add', 'manual_subtract'
  amount DECIMAL(18, 2) NOT NULL,
  asset TEXT NOT NULL DEFAULT 'USDT',
  timestamp TIMESTAMP NOT NULL,

  -- Manual entry fields
  investor TEXT,
  reason TEXT,
  notes TEXT,

  -- Exchange transfer fields
  tran_id TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ledger_user_timestamp ON account_ledger(user_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_ledger_investor ON account_ledger(investor);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON account_ledger(type);

-- Verify table was created
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'account_ledger'
ORDER BY ordinal_position;
