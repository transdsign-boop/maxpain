-- Add DCA Layer Delay column to strategies table
-- This controls the minimum time between DCA layer fills on the same symbol
-- Default: 30000ms (30 seconds), Range: 0-300000ms (0-5 minutes)

ALTER TABLE strategies 
ADD COLUMN IF NOT EXISTS dca_layer_delay_ms INTEGER NOT NULL DEFAULT 30000;

-- Update existing strategies to use the default value
UPDATE strategies 
SET dca_layer_delay_ms = 30000 
WHERE dca_layer_delay_ms IS NULL;

COMMENT ON COLUMN strategies.dca_layer_delay_ms IS 'Minimum time between DCA layer fills on same symbol (milliseconds, 0-300000ms)';
