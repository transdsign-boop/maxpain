-- Add excluded column to transfers table
-- This allows excluding specific deposits from account size calculations
-- without permanently deleting them

ALTER TABLE transfers 
ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT false;

-- Mark the two specific deposits as excluded
-- Oct 17, 2025 13:04 PT: $3011.14 USDF (tranId: 43375032)
-- Oct 17, 2025 13:22 PT: $655.67 USDF (tranId: 43376508)

UPDATE transfers
SET excluded = true
WHERE transaction_id IN ('43375032', '43376508')
  AND amount IN ('3011.14000000', '655.67000000')
  AND asset = 'USDF';
