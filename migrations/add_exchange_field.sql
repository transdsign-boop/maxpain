-- Migration: Add exchange field to support multi-exchange trading
-- Date: 2025-10-16
-- Description: Adds 'exchange' column to all trading-related tables and backfills with 'aster' for existing data

-- IMPORTANT: Execute this script in the Neon SQL Editor
-- DO NOT use drizzle-kit push - this requires manual SQL execution

-- Step 1: Add exchange column to liquidations table
ALTER TABLE liquidations 
ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'aster';

-- Step 2: Add exchange column to strategies table
ALTER TABLE strategies 
ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'aster';

-- Step 3: Add exchange column to trade_sessions table
ALTER TABLE trade_sessions 
ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'aster';

-- Step 4: Add exchange column to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'aster';

-- Step 5: Add exchange column to fills table
ALTER TABLE fills 
ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'aster';

-- Step 6: Add exchange column to positions table
ALTER TABLE positions 
ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'aster';

-- Step 7: Add exchange column to transfers table
ALTER TABLE transfers 
ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'aster';

-- Step 8: Add exchange column to commissions table
ALTER TABLE commissions 
ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'aster';

-- Step 9: Add exchange column to funding_fees table
ALTER TABLE funding_fees 
ADD COLUMN IF NOT EXISTS exchange TEXT NOT NULL DEFAULT 'aster';

-- Step 10: Backfill existing data with 'aster' (idempotent - safe to run multiple times)
UPDATE liquidations SET exchange = 'aster' WHERE exchange IS NULL OR exchange = '';
UPDATE strategies SET exchange = 'aster' WHERE exchange IS NULL OR exchange = '';
UPDATE trade_sessions SET exchange = 'aster' WHERE exchange IS NULL OR exchange = '';
UPDATE orders SET exchange = 'aster' WHERE exchange IS NULL OR exchange = '';
UPDATE fills SET exchange = 'aster' WHERE exchange IS NULL OR exchange = '';
UPDATE positions SET exchange = 'aster' WHERE exchange IS NULL OR exchange = '';
UPDATE transfers SET exchange = 'aster' WHERE exchange IS NULL OR exchange = '';
UPDATE commissions SET exchange = 'aster' WHERE exchange IS NULL OR exchange = '';
UPDATE funding_fees SET exchange = 'aster' WHERE exchange IS NULL OR exchange = '';

-- Step 11: Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_liquidations_exchange ON liquidations(exchange);
CREATE INDEX IF NOT EXISTS idx_strategies_exchange ON strategies(exchange);
CREATE INDEX IF NOT EXISTS idx_trade_sessions_exchange ON trade_sessions(exchange);
CREATE INDEX IF NOT EXISTS idx_positions_exchange ON positions(exchange);
CREATE INDEX IF NOT EXISTS idx_fills_exchange ON fills(exchange);
CREATE INDEX IF NOT EXISTS idx_orders_exchange ON orders(exchange);

-- Verification queries (optional - run these to verify migration)
-- SELECT exchange, COUNT(*) FROM liquidations GROUP BY exchange;
-- SELECT exchange, COUNT(*) FROM strategies GROUP BY exchange;
-- SELECT exchange, COUNT(*) FROM trade_sessions GROUP BY exchange;
-- SELECT exchange, COUNT(*) FROM positions GROUP BY exchange;
-- SELECT exchange, COUNT(*) FROM fills GROUP BY exchange;
-- SELECT exchange, COUNT(*) FROM orders GROUP BY exchange;
-- SELECT exchange, COUNT(*) FROM transfers GROUP BY exchange;
-- SELECT exchange, COUNT(*) FROM commissions GROUP BY exchange;
-- SELECT exchange, COUNT(*) FROM funding_fees GROUP BY exchange;

-- Migration complete!
-- All existing data is now marked as 'aster' exchange
-- New records will default to 'aster' unless explicitly specified
