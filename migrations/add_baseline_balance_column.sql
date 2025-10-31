-- Add baseline_balance column to account_ledger table
-- This field stores the total account balance (wallet + unrealized P&L) at the moment
-- this ledger entry is created, enabling time-weighted ROI calculations.

ALTER TABLE account_ledger
ADD COLUMN baseline_balance DECIMAL(18, 2);

-- Add comment explaining the column's purpose
COMMENT ON COLUMN account_ledger.baseline_balance IS 'Total account balance (wallet + unrealized P&L) at the time this entry was created. Used for time-weighted ROI calculations - each deposit tracks performance only from its deposit time forward.';
