CREATE TABLE IF NOT EXISTS quizzes (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  settings JSONB NOT NULL,
  questions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  pinned_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS attempts (
  id UUID PRIMARY KEY,
  quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  answers JSONB NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quizzes_created_at ON quizzes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quizzes_pinned ON quizzes(pinned, pinned_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_quiz_id ON attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_attempts_completed_at ON attempts(completed_at DESC);
