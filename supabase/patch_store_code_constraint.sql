-- Снимает жёсткий constraint на формат store_code
-- Позволяет хранить произвольные коды (не только формат A0000)
alter table public.stores drop constraint if exists stores_store_code_format;
