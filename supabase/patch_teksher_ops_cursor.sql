-- Место в ряду живых операций для обычного обновления.
-- Пустая строка значит «следующий раз с начала ряда».
alter table public.stores
  add column if not exists teksher_ops_cursor text not null default '';
