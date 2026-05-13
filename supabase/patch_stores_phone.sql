-- Добавление поля телефона в таблицу магазинов
alter table stores add column if not exists phone text;
