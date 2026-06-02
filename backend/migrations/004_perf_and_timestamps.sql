-- Index for share_id lookups on attempts (M-11)
CREATE INDEX IF NOT EXISTS idx_attempts_share_id ON attempts(share_id);

-- submitted_at: server-recorded timestamp (H-6)
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
-- Backfill existing rows with completed_at as approximation
UPDATE attempts SET submitted_at = completed_at WHERE submitted_at IS NULL;
