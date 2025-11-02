-- Add adaptive position sizing columns to strategies table
-- These fields enable percentile-based position size scaling for liquidation events

-- Enable percentile-based position sizing (default: disabled)
ALTER TABLE strategies
ADD COLUMN IF NOT EXISTS adaptive_sizing_enabled BOOLEAN NOT NULL DEFAULT false;

-- Maximum size multiplier at 95th+ percentile (1.0-10.0x, default: 3.0x)
-- Linear interpolation from 1.0x at threshold to this value at 95th percentile
ALTER TABLE strategies
ADD COLUMN IF NOT EXISTS max_size_multiplier DECIMAL(5,2) NOT NULL DEFAULT 3.0;

-- Scale all DCA layers (true) or only Layer 1 (false) - default: only Layer 1
ALTER TABLE strategies
ADD COLUMN IF NOT EXISTS scale_all_layers BOOLEAN NOT NULL DEFAULT false;

-- Verify columns were added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'strategies'
  AND column_name IN ('adaptive_sizing_enabled', 'max_size_multiplier', 'scale_all_layers')
ORDER BY column_name;
