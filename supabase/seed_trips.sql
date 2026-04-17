-- Тестовые данные: 2 рейса с поставками
-- Подтягивает первый аккаунт и первые два магазина из БД автоматически

do $$
declare
  v_account_id uuid;
  v_store_id_1 uuid;
  v_store_id_2 uuid;
  v_trip_1 public.trips;
  v_trip_2 public.trips;
begin
  -- Берём первый аккаунт
  select id into v_account_id from public.accounts limit 1;
  if v_account_id is null then
    raise exception 'Нет аккаунтов в БД';
  end if;

  -- Берём первые два магазина этого аккаунта
  select id into v_store_id_1 from public.stores where account_id = v_account_id limit 1;
  select id into v_store_id_2 from public.stores where account_id = v_account_id offset 1 limit 1;
  if v_store_id_1 is null then
    raise exception 'Нет магазинов в аккаунте';
  end if;

  -- ── Рейс 1 ──────────────────────────────────────────────
  select * into v_trip_1 from public.create_trip(
    v_account_id,
    'Asia Cargo',
    '2026-04-20',
    'Отправлен',
    'Частично оплачено',
    'Первый тестовый рейс'
  );

  -- Поставка 1 в рейсе 1
  perform public.add_trip_line(
    v_trip_1.id, v_account_id, v_store_id_1,
    'Коледино', 10, 200, 150000, 0,
    '2026-04-25', null, 'В пути', 'Основная партия'
  );

  -- Поставка 2 в рейсе 1 (второй магазин если есть, иначе первый)
  perform public.add_trip_line(
    v_trip_1.id, v_account_id, coalesce(v_store_id_2, v_store_id_1),
    'Электросталь', 5, 80, 60000, 0,
    '2026-04-26', null, 'В пути', ''
  );

  -- Поставка 3 в рейсе 1
  perform public.add_trip_line(
    v_trip_1.id, v_account_id, v_store_id_1,
    'Казань', 3, 40, 30000, 0,
    null, null, 'Ожидает отправки', ''
  );

  -- ── Рейс 2 ──────────────────────────────────────────────
  select * into v_trip_2 from public.create_trip(
    v_account_id,
    'Карго KG',
    '2026-04-28',
    'Формируется',
    'Не оплачено',
    'Второй тестовый рейс'
  );

  -- Поставка 1 в рейсе 2
  perform public.add_trip_line(
    v_trip_2.id, v_account_id, v_store_id_1,
    'Краснодар', 8, 120, 90000, 0,
    '2026-05-03', null, 'Ожидает отправки', 'Срочно'
  );

  -- Поставка 2 в рейсе 2
  perform public.add_trip_line(
    v_trip_2.id, v_account_id, coalesce(v_store_id_2, v_store_id_1),
    'Новосибирск', 6, 90, 70000, 0,
    '2026-05-04', null, 'Ожидает отправки', ''
  );

  raise notice 'Создано: Рейс #% и Рейс #%', v_trip_1.trip_number, v_trip_2.trip_number;
end;
$$;
