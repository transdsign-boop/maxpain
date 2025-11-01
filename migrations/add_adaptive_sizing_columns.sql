-- Add Adaptive Position Sizing (Percentile-Based) columns to strategies table
-- These columns enable dynamic position sizing based on liquidation event magnitude

-- Enable percentile-based position sizing
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS adaptive_sizing_enabled BOOLEAN NOT NULL DEFAULT false;

-- Maximum size multiplier at 95th+ percentile (1.0-10.0x)
-- Default 3.0x means positions at 95th+ percentile will be 3x the base size
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS max_size_multiplier NUMERIC(5, 2) NOT NULL DEFAULT 3.0;

-- Scale all DCA layers (true) or only Layer 1 (false)
-- Default false means only Layer 1 gets scaled by percentile
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS scale_all_layers BOOLEAN NOT NULL DEFAULT false;

-- Validation check: max_size_multiplier should be between 1.0 and 10.0
ALTER TABLE strategies ADD CONSTRAINT check_max_size_multiplier
  CHECK (max_size_multiplier >= 1.0 AND max_size_multiplier <= 10.0);
