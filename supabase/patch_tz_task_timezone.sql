-- Часовой пояс браузера, из которого была создана короткая задача.
-- Старые задачи владельца относятся к Asia/Bishkek.

alter table public.tz_tasks
  add column if not exists created_timezone text not null default 'Asia/Bishkek';

alter table public.tz_tasks
  drop constraint if exists tz_tasks_created_timezone_check;

alter table public.tz_tasks
  add constraint tz_tasks_created_timezone_check
  check (char_length(btrim(created_timezone)) between 1 and 100);
