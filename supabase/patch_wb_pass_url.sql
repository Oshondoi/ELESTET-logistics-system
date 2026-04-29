-- Добавляем поле для хранения URL пропуска WB
ALTER TABLE trip_lines ADD COLUMN IF NOT EXISTS wb_pass_url text DEFAULT NULL;
