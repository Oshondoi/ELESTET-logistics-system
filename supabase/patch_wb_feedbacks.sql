-- WB feedbacks cache table
CREATE TABLE IF NOT EXISTS wb_feedbacks (
  id           text PRIMARY KEY,
  store_id     uuid REFERENCES stores ON DELETE CASCADE,
  account_id   uuid REFERENCES accounts ON DELETE CASCADE,
  data         jsonb NOT NULL,
  is_answered  boolean NOT NULL DEFAULT false,
  created_date timestamptz,
  synced_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS wb_feedbacks_store_id_idx      ON wb_feedbacks (store_id);
CREATE INDEX IF NOT EXISTS wb_feedbacks_account_id_idx    ON wb_feedbacks (account_id);
CREATE INDEX IF NOT EXISTS wb_feedbacks_is_answered_idx   ON wb_feedbacks (store_id, is_answered);

-- RLS
ALTER TABLE wb_feedbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can manage their account feedbacks"
  ON wb_feedbacks
  FOR ALL
  USING (
    account_id IN (
      SELECT account_id FROM role_members WHERE user_id = auth.uid()
    )
  );
