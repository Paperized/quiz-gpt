CREATE TABLE IF NOT EXISTS quiz_shares (
  id UUID PRIMARY KEY,
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  guest_name TEXT NOT NULL,
  max_attempts INT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_shares_token ON quiz_shares(token);
CREATE INDEX IF NOT EXISTS idx_quiz_shares_quiz_id ON quiz_shares(quiz_id);

ALTER TABLE attempts ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS share_id UUID REFERENCES quiz_shares(id) ON DELETE SET NULL;
