-- Add reserved risk tracking columns to positions table
-- Execute this in Neon SQL Editor

ALTER TABLE positions 
ADD COLUMN IF NOT EXISTS reserved_risk_dollars NUMERIC(18, 8),
ADD COLUMN IF NOT EXISTS reserved_risk_percent NUMERIC(5, 2);

-- Add comments for documentation
COMMENT ON COLUMN positions.reserved_risk_dollars IS 'Total risk reserved for full DCA schedule (calculated at position open)';
COMMENT ON COLUMN positions.reserved_risk_percent IS 'Reserved risk as % of account balance';
