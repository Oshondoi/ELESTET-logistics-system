-- Очистка только weekly-данных WB (без удаления структуры таблиц)
-- 1) Детализация
-- 2) Список недельных отчетов

begin;

delete from public.wb_finance_weekly_report_rows;
delete from public.wb_finance_weekly_reports;

commit;
