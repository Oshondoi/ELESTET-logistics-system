-- =============================================================
-- Патч: добавить draft_number, сделать trip_number nullable
-- Черновик получает draft_number при создании.
-- trip_number присваивается только при переходе на "Отправлен".
-- =============================================================

-- 1. Сделать trip_number nullable
alter table public.trips
  alter column trip_number drop not null;

-- 2. Добавить draft_number (авто-счётчик черновиков внутри аккаунта)
alter table public.trips
  add column if not exists draft_number integer;

-- 3. Проставить draft_number существующим рейсам (у них уже есть trip_number)
--    Нумеруем по порядку created_at внутри аккаунта
update public.trips t
set draft_number = sub.rn
from (
  select id,
         row_number() over (partition by account_id order by created_at) as rn
  from public.trips
) sub
where t.id = sub.id
  and t.draft_number is null;

-- =============================================================
-- 4. Обновить create_trip: назначать draft_number, не trip_number
-- =============================================================
create or replace function public.create_trip(
  p_account_id uuid,
  p_carrier text,
  p_departure_date date default null,
  p_status text default 'Формируется',
  p_payment_status text default 'Не оплачено',
  p_comment text default ''
)
returns public.trips
language plpgsql
security definer
as $$
declare
  next_draft_number integer;
  created_trip      public.trips;
begin
  select coalesce(max(draft_number), 0) + 1
    from public.trips
   where account_id = p_account_id
    into next_draft_number;

  insert into public.trips (
    account_id, draft_number, trip_number, carrier, departure_date,
    status, payment_status, comment
  )
  values (
    p_account_id, next_draft_number, null, p_carrier, p_departure_date,
    p_status, p_payment_status, coalesce(p_comment, '')
  )
  returning * into created_trip;

  return created_trip;
end;
$$;

-- =============================================================
-- 5. RPC update_trip_status:
--    при переходе на "Отправлен" — присваивает trip_number
-- =============================================================
create or replace function public.update_trip_status(
  p_account_id uuid,
  p_trip_id    uuid,
  p_status     text
)
returns public.trips
language plpgsql
security definer
as $$
declare
  current_trip  public.trips;
  last_trip_num text;
  prefix        text;
  seq           integer;
  next_trip_num text;
  updated_trip  public.trips;
begin
  -- Блокируем строку для конкурентных запросов
  select * from public.trips
   where id = p_trip_id and account_id = p_account_id
   for update
    into current_trip;

  if not found then
    raise exception 'Trip not found';
  end if;

  -- Если переход на "Отправлен" и номер ещё не присвоен
  if p_status = 'Отправлен' and current_trip.trip_number is null then
    -- Находим последний присвоенный trip_number в аккаунте
    select trip_number
      from public.trips
     where account_id = p_account_id
       and trip_number is not null
     order by
       length(regexp_replace(trip_number, '[0-9]+$', '')) desc,
       regexp_replace(trip_number, '[0-9]+$', '') desc,
       (substring(trip_number from '(\d+)$'))::integer desc
     limit 1
      into last_trip_num;

    if last_trip_num is null then
      next_trip_num := 'A1';
    else
      prefix := regexp_replace(last_trip_num, '[0-9]+$', '');
      seq    := (substring(last_trip_num from '(\d+)$'))::integer;

      if seq < 9999 then
        next_trip_num := prefix || (seq + 1)::text;
      else
        next_trip_num := public.increment_trip_prefix(prefix) || '1';
      end if;
    end if;

    update public.trips
       set status = p_status, trip_number = next_trip_num
     where id = p_trip_id
    returning * into updated_trip;
  else
    update public.trips
       set status = p_status
     where id = p_trip_id
    returning * into updated_trip;
  end if;

  return updated_trip;
end;
$$;
