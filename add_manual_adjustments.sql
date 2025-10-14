-- Add manual financial adjustment fields to strategies table
-- These fields correct for exchange API limitations (missing historical data)

ALTER TABLE strategies 
ADD COLUMN manual_commission_adjustment DECIMAL(18, 8) NOT NULL DEFAULT 0.0;

ALTER TABLE strategies 
ADD COLUMN manual_funding_adjustment DECIMAL(18, 8) NOT NULL DEFAULT 0.0;

-- Set the manual adjustments for the first strategy
-- Commission: +15.05 (missing Oct 2-5 data from exchange API)
-- Funding: Will be calculated based on current API total to reach -4.03
UPDATE strategies 
SET manual_commission_adjustment = 15.05,
    manual_funding_adjustment = 0.0  -- Will update this value after checking current funding total
WHERE id = (SELECT id FROM strategies LIMIT 1);
