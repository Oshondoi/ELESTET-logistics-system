-- Добавляем subgroup_id и teksher_id в tnved_codes (если нет)
ALTER TABLE tnved_codes ADD COLUMN IF NOT EXISTS subgroup_id integer;
ALTER TABLE tnved_codes ADD COLUMN IF NOT EXISTS subgroup_name text;
ALTER TABLE tnved_codes ADD COLUMN IF NOT EXISTS teksher_id integer;

-- Таблица для кэша шаблонов атрибутов по подгруппам
CREATE TABLE IF NOT EXISTS attribute_templates (
  subgroup_id   integer PRIMARY KEY,
  subgroup_name text,
  templates     jsonb NOT NULL DEFAULT '[]',
  synced_at     timestamptz DEFAULT now()
);

-- Индекс для быстрого поиска tnved_codes по subgroup_id
CREATE INDEX IF NOT EXISTS idx_tnved_codes_subgroup_id ON tnved_codes(subgroup_id);
