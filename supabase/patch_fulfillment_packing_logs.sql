-- Таблица для учёта расходников (коробов) на этапе "Короба" (формирование коробов)
-- Фиксирует: кто, сколько коробов использовал, заметки

CREATE TABLE IF NOT EXISTS fulfillment_packing_logs (
  id           uuid         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id     uuid         NOT NULL,
  account_id   uuid         NOT NULL,
  user_id      text         NOT NULL,
  user_email   text         NOT NULL,
  user_name    text,
  performer_user_id text,
  performer_name    text    NOT NULL,
  boxes_used   integer      NOT NULL DEFAULT 0,
  notes        text,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz,
  deleted_at   timestamptz
);

ALTER TABLE fulfillment_packing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_access" ON fulfillment_packing_logs
  USING (
    account_id IN (
      SELECT account_id FROM account_members WHERE user_id = auth.uid()
    )
  );
