-- Добавляем даты перехода статуса рейса
alter table public.trips
  add column if not exists arrived_at  timestamptz,
  add column if not exists finished_at timestamptz;

-- Обновляем RPC: при смене статуса проставляем даты (только если ещё не заполнены)
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
  now_ts        timestamptz := now();
begin
  select * from public.trips
   where id = p_trip_id and account_id = p_account_id
   for update
    into current_trip;

  if not found then
    raise exception 'Trip not found';
  end if;

  if p_status = 'Отправлен' and current_trip.trip_number is null then
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
       set status      = p_status,
           trip_number = next_trip_num,
           arrived_at  = case when p_status = 'Прибыл'   and arrived_at  is null then now_ts else arrived_at  end,
           finished_at = case when p_status = 'Завершён'  and finished_at is null then now_ts else finished_at end
     where id = p_trip_id
    returning * into updated_trip;
  else
    update public.trips
       set status      = p_status,
           arrived_at  = case when p_status = 'Прибыл'   and arrived_at  is null then now_ts else arrived_at  end,
           finished_at = case when p_status = 'Завершён'  and finished_at is null then now_ts else finished_at end
     where id = p_trip_id
    returning * into updated_trip;
  end if;

  return updated_trip;
end;
$$;
