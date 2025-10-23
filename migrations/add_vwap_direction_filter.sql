-- Migration: Add VWAP Direction Filter Configuration
-- Date: 2025-10-23
-- Description: Adds VWAP direction filter settings to strategies table

-- Add VWAP filter configuration columns
ALTER TABLE strategies
ADD COLUMN IF NOT EXISTS vwap_filter_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS vwap_timeframe_minutes INTEGER NOT NULL DEFAULT 240,
ADD COLUMN IF NOT EXISTS vwap_buffer_percentage DECIMAL(6,4) NOT NULL DEFAULT 0.0005,
ADD COLUMN IF NOT EXISTS vwap_enable_buffer BOOLEAN NOT NULL DEFAULT TRUE;

-- Add comments for documentation
COMMENT ON COLUMN strategies.vwap_filter_enabled IS 'Enable VWAP direction filtering (longs below VWAP, shorts above VWAP)';
COMMENT ON COLUMN strategies.vwap_timeframe_minutes IS 'VWAP calculation timeframe in minutes (60, 120, 180, 240, 360, 480, 1440)';
COMMENT ON COLUMN strategies.vwap_buffer_percentage IS 'Buffer zone size to prevent flip-flopping (0.0001 = 0.01%, 0.002 = 0.2%)';
COMMENT ON COLUMN strategies.vwap_enable_buffer IS 'Enable buffer zone to maintain direction when price near VWAP';

-- Verify the migration
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'strategies'
  AND column_name LIKE 'vwap%'
ORDER BY ordinal_position;
