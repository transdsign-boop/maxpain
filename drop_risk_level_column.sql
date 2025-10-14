-- Drop riskLevel column from strategies table
-- This SQL script removes the Entry Selectivity system from the database
-- 
-- INSTRUCTIONS:
-- 1. Copy this entire SQL script
-- 2. Navigate to the Neon SQL Editor in your dashboard
-- 3. Paste and execute this script
-- 4. Verify the column has been removed
--
-- This change is part of the Entry Selectivity removal - the system now uses
-- fixed percentile threshold (75%) + cascade detection (50%) + portfolio limits
-- instead of variable RQ thresholds based on risk level presets.

ALTER TABLE strategies DROP COLUMN IF EXISTS risk_level;
