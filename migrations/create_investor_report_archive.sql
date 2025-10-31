-- Create investor_report_archive table to store daily snapshots of investor reports
CREATE TABLE IF NOT EXISTS investor_report_archive (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR(255) NOT NULL,
  report_date TIMESTAMP NOT NULL,

  -- Snapshot data (JSON format for flexibility)
  report_data JSONB NOT NULL,

  -- Metadata
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Index for faster queries by user and date
  UNIQUE(user_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_investor_report_archive_user_date
  ON investor_report_archive(user_id, report_date DESC);

COMMENT ON TABLE investor_report_archive IS 'Daily snapshots of investor performance reports';
COMMENT ON COLUMN investor_report_archive.report_data IS 'Full report JSON including investors, periods, deposits, and P&L';
COMMENT ON COLUMN investor_report_archive.report_date IS 'The date this report snapshot represents (midnight UTC)';
