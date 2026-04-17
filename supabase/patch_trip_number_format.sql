-- =============================================================
-- Патч: изменить trip_number с integer на text формата A1..A9999, B1..
-- =============================================================

-- 1. Снять уникальное ограничение (оно будет пересоздано для text)
alter table public.trips drop constraint if exists trips_account_id_trip_number_key;

-- 2. Конвертировать существующие значения (1 → 'A1', 2 → 'A2', …)
--    и изменить тип колонки
alter table public.trips
  alter column trip_number type text
  using 'A' || trip_number::text;

-- 3. Вернуть уникальность
alter table public.trips
  add constraint trips_account_id_trip_number_key
  unique (account_id, trip_number);

-- =============================================================
-- 4. Вспомогательная функция: инкремент буквенного префикса
--    A→B, Z→AA, AZ→BA, ZZ→AAA, AAZ→ABA и т.д.
-- =============================================================
create or replace function public.increment_trip_prefix(prefix text)
returns text
language plpgsql
immutable
as $$
declare
  new_prefix text    := prefix;
  pos        integer := length(prefix);
  carry      boolean := true;
begin
  while carry and pos >= 1 loop
    if substring(new_prefix from pos for 1) < 'Z' then
      -- просто инкрементируем символ в позиции pos
      new_prefix :=
        left(new_prefix, pos - 1)
        || chr(ascii(substring(new_prefix from pos for 1)) + 1)
        || right(new_prefix, -(pos));
      carry := false;
    else
      -- символ = 'Z', сбрасываем в 'A' и переходим на позицию левее
      new_prefix :=
        left(new_prefix, pos - 1)
        || 'A'
        || right(new_prefix, -(pos));
      pos := pos - 1;
    end if;
  end loop;

  if carry then
    -- все символы были 'Z' → добавляем 'A' в начало: ZZ → AAA
    new_prefix := 'A' || new_prefix;
  end if;

  return new_prefix;
end;
$$;

-- =============================================================
-- 5. Новая логика create_trip: A1…A9999, B1…Z9999, AA1…AA9999…
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
  last_trip_num text;
  prefix        text;
  seq           integer;
  next_trip_num text;
  created_trip  public.trips;
begin
  -- Последний рейс аккаунта (по дате создания, не по trip_number)
  select trip_number
    from public.trips
   where account_id = p_account_id
   order by created_at desc
   limit 1
    into last_trip_num;

  if last_trip_num is null then
    next_trip_num := 'A1';
  else
    -- Разбиваем «ABC123» → prefix='ABC', seq=123
    prefix := regexp_replace(last_trip_num, '[0-9]+$', '');
    seq    := substring(last_trip_num from length(prefix) + 1)::integer;

    if seq < 9999 then
      next_trip_num := prefix || (seq + 1)::text;
    else
      -- Числа исчерпаны → инкрементируем буквенный префикс
      next_trip_num := public.increment_trip_prefix(prefix) || '1';
    end if;
  end if;

  insert into public.trips (
    account_id, trip_number, carrier, departure_date,
    status, payment_status, comment
  )
  values (
    p_account_id, next_trip_num, p_carrier, p_departure_date,
    p_status, p_payment_status, coalesce(p_comment, '')
  )
  returning * into created_trip;

  return created_trip;
end;
$$;
