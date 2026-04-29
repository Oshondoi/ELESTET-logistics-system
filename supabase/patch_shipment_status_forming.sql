-- Добавляет статус 'Формируется' как первый статус поставок (trip_lines)
-- и поле waiting_at (дата перехода в 'Ожидает отправки')

-- 1. Добавляем поле waiting_at
ALTER TABLE trip_lines
  ADD COLUMN IF NOT EXISTS waiting_at date;

-- 2. Обновляем CHECK-ограничение на статус
ALTER TABLE trip_lines
  DROP CONSTRAINT IF EXISTS trip_lines_status_check;

ALTER TABLE trip_lines
  ADD CONSTRAINT trip_lines_status_check
    CHECK (status IN (
      'Формируется',
      'Ожидает отправки',
      'В пути',
      'Прибыл',
      'Отгружен'
    ));

-- 3. Меняем дефолтный статус на 'Формируется'
ALTER TABLE trip_lines
  ALTER COLUMN status SET DEFAULT 'Формируется';
