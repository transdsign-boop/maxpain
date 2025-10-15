-- Drop position_layers table
-- This table is no longer needed after migrating to position-level TP/SL
-- Execute this script manually in Neon SQL Editor
-- Created: October 15, 2025

DROP TABLE IF EXISTS position_layers CASCADE;
