-- 005: Quiz groups + soft delete

CREATE TABLE quiz_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_quiz_groups_position ON quiz_groups(position);

ALTER TABLE quizzes ADD COLUMN group_id UUID REFERENCES quiz_groups(id) ON DELETE SET NULL;
CREATE INDEX idx_quizzes_group_id ON quizzes(group_id);

ALTER TABLE quizzes ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX idx_quizzes_deleted_at ON quizzes(deleted_at) WHERE deleted_at IS NULL;
