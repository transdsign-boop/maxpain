-- Add manual financial adjustment fields to strategies table
-- These fields correct for exchange API limitations (missing historical data)

ALTER TABLE strategies 
ADD COLUMN manual_commission_adjustment DECIMAL(18, 8) NOT NULL DEFAULT 0.0;

ALTER TABLE strategies 
ADD COLUMN manual_funding_adjustment DECIMAL(18, 8) NOT NULL DEFAULT 0.0;

-- Set the manual adjustments for the first strategy
-- Commission: +15.05 (missing Oct 2-5 data from exchange API)
-- Funding: Calculate adjustment to reach desired total of -4.03
--
-- STEP 1: Check current funding total from exchange API
-- Visit: http://localhost:5000/api/funding-fees in your browser
-- Note the "apiTotal" value (let's call it X)
--
-- STEP 2: Calculate the adjustment needed
-- manual_funding_adjustment = -4.03 - X
-- For example: if apiTotal is -3.50, then adjustment = -4.03 - (-3.50) = -0.53
--
-- STEP 3: Update the strategy with the adjustments
-- Replace 0.0 below with your calculated funding adjustment from STEP 2
UPDATE strategies 
SET manual_commission_adjustment = 15.05,
    manual_funding_adjustment = 0.0  -- REPLACE THIS with: -4.03 - (apiTotal from Step 1)
WHERE id = (SELECT id FROM strategies ORDER BY created_at ASC LIMIT 1);
