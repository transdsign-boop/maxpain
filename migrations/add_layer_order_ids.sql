-- Add TP and SL order ID tracking to position_layers table
-- Execute this in Neon SQL Editor

ALTER TABLE position_layers 
ADD COLUMN IF NOT EXISTS tp_order_id VARCHAR,
ADD COLUMN IF NOT EXISTS sl_order_id VARCHAR;

-- Add comments for documentation
COMMENT ON COLUMN position_layers.tp_order_id IS 'Exchange order ID for layer TP LIMIT order';
COMMENT ON COLUMN position_layers.sl_order_id IS 'Exchange order ID for layer SL STOP_MARKET order';
