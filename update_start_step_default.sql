-- Update default Start Step % from 0.4% to 0.1%
-- This sets Layer 1 position size to meet $5 minimum notional at 10x leverage
-- Run this in your Neon SQL Editor

ALTER TABLE strategies 
ALTER COLUMN dca_start_step_percent SET DEFAULT 0.1;

-- Update existing strategy to use new default
UPDATE strategies 
SET dca_start_step_percent = 0.1 
WHERE dca_start_step_percent = 0.4;

-- Verify the change
SELECT id, name, dca_start_step_percent, dca_size_growth, max_portfolio_risk_percent 
FROM strategies;
