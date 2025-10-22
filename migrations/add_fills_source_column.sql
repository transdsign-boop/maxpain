-- Add source column to fills table to distinguish bot-initiated vs manual trades
-- Migration: add_fills_source_column.sql
-- Date: 2025-10-22

-- Add source column with default value 'bot'
-- Possible values: 'bot' (bot-initiated), 'manual' (manual trade), 'sync' (historical sync)
ALTER TABLE fills ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'bot';

-- Add check constraint to ensure only valid source values
ALTER TABLE fills ADD CONSTRAINT fills_source_check
  CHECK (source IN ('bot', 'manual', 'sync'));

-- Create index for filtering by source
CREATE INDEX IF NOT EXISTS idx_fills_source ON fills(source);

-- Update existing fills to have source='bot' (they were all bot-initiated)
UPDATE fills SET source = 'bot' WHERE source IS NULL OR source = '';
