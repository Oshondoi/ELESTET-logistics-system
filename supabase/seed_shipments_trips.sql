-- Seed: 9 поставок (shipments) + 3 рейса (trips) с trip_lines
-- Использует реальные account_id и store_id из БД
-- trip_number — text формата A1, A2, ...

DO $$
DECLARE
  v_account_id uuid;
  stores       uuid[];
  s1 uuid; s2 uuid; s3 uuid;
  trip1 uuid; trip2 uuid; trip3 uuid;
  last_trip    text;
  prefix       text;
  seq          integer;
  tn1 text; tn2 text; tn3 text;
  next_tracking integer;
BEGIN
  -- Берём первый аккаунт
  SELECT id INTO v_account_id FROM public.accounts ORDER BY created_at ASC LIMIT 1;
  IF v_account_id IS NULL THEN RAISE EXCEPTION 'Нет аккаунтов в БД'; END IF;

  -- Берём store_id-ы этого аккаунта (минимум 3)
  SELECT ARRAY(SELECT id FROM public.stores WHERE account_id = v_account_id ORDER BY created_at ASC LIMIT 3)
    INTO stores;
  IF array_length(stores, 1) IS NULL OR array_length(stores, 1) < 3 THEN
    RAISE EXCEPTION 'Нужно минимум 3 магазина в аккаунте, найдено: %', COALESCE(array_length(stores, 1), 0);
  END IF;
  s1 := stores[1]; s2 := stores[2]; s3 := stores[3];

  -- Вычисляем следующий trip_number (text формата A1, A2 ...)
  SELECT trip_number INTO last_trip
    FROM public.trips WHERE account_id = v_account_id
    ORDER BY created_at DESC LIMIT 1;

  IF last_trip IS NULL THEN
    tn1 := 'A1'; tn2 := 'A2'; tn3 := 'A3';
  ELSE
    prefix := regexp_replace(last_trip, '[0-9]+$', '');
    seq    := substring(last_trip FROM length(prefix) + 1)::integer;
    tn1 := prefix || (seq + 1)::text;
    tn2 := prefix || (seq + 2)::text;
    tn3 := prefix || (seq + 3)::text;
  END IF;

  -- Следующий tracking_number
  SELECT COALESCE(MAX(tracking_number), 1000) + 1 INTO next_tracking
    FROM public.shipments WHERE account_id = v_account_id;

  -- ─── 3 рейса ───────────────────────────────────────────────
  INSERT INTO public.trips (id, account_id, trip_number, carrier, departure_date, status, payment_status, comment)
  VALUES (gen_random_uuid(), v_account_id, tn1, 'Деловые Линии', '2026-04-28', 'Формируется',  'Не оплачено',       'Первый тестовый рейс')
  RETURNING id INTO trip1;

  INSERT INTO public.trips (id, account_id, trip_number, carrier, departure_date, status, payment_status, comment)
  VALUES (gen_random_uuid(), v_account_id, tn2, 'СДЭК',          '2026-04-30', 'Отправлен',    'Частично оплачено', 'Второй тестовый рейс')
  RETURNING id INTO trip2;

  INSERT INTO public.trips (id, account_id, trip_number, carrier, departure_date, status, payment_status, comment)
  VALUES (gen_random_uuid(), v_account_id, tn3, 'ПЭК',           '2026-05-05', 'Прибыл',       'Оплачено',          'Третий тестовый рейс')
  RETURNING id INTO trip3;

  -- ─── 9 поставок (shipments) ────────────────────────────────
  INSERT INTO public.shipments
    (account_id, store_id, tracking_number, carrier, destination_warehouse, box_qty, units_qty, units_total, arrived_box_qty, planned_marketplace_delivery_date, status, payment_status, comment)
  VALUES
    (v_account_id, s1, next_tracking,     'Деловые Линии', 'Коледино',    5, 120, 45000, 0, '2026-05-02', 'Ожидает отправки', 'Не оплачено',       ''),
    (v_account_id, s2, next_tracking + 1, 'Деловые Линии', 'Подольск',    3,  80, 28000, 0, '2026-05-02', 'Ожидает отправки', 'Не оплачено',       ''),
    (v_account_id, s3, next_tracking + 2, 'Деловые Линии', 'Электросталь',2,  40, 15000, 0, '2026-05-02', 'Ожидает отправки', 'Не оплачено',       ''),
    (v_account_id, s1, next_tracking + 3, 'СДЭК',          'Коледино',    8, 200, 72000, 0, '2026-05-05', 'В пути',           'Частично оплачено', 'Срочная'),
    (v_account_id, s2, next_tracking + 4, 'СДЭК',          'Тула',        4, 100, 38000, 0, '2026-05-05', 'В пути',           'Не оплачено',       ''),
    (v_account_id, s3, next_tracking + 5, 'СДЭК',          'Казань',      6, 150, 55000, 0, '2026-05-05', 'В пути',           'Не оплачено',       ''),
    (v_account_id, s1, next_tracking + 6, 'ПЭК',           'Коледино',   10, 300, 98000, 10, '2026-04-25', 'Прибыл',          'Оплачено',          'Прибыл вовремя'),
    (v_account_id, s2, next_tracking + 7, 'ПЭК',           'Краснодар',   7, 175, 63000,  7, '2026-04-25', 'Отгружен',        'Оплачено',          ''),
    (v_account_id, s3, next_tracking + 8, 'ПЭК',           'Новосибирск', 5, 130, 47000,  5, '2026-04-25', 'Отгружен',        'Оплачено',          '');

  -- ─── trip_lines ────────────────────────────────────────────
  INSERT INTO public.trip_lines
    (trip_id, account_id, store_id, shipment_number, destination_warehouse, box_qty, units_qty, units_total, arrived_box_qty, planned_marketplace_delivery_date, status, comment)
  VALUES
    (trip1, v_account_id, s1, next_tracking,     'Коледино',    5, 120, 45000, 0, '2026-05-02', 'Ожидает отправки', ''),
    (trip1, v_account_id, s2, next_tracking + 1, 'Подольск',    3,  80, 28000, 0, '2026-05-02', 'Ожидает отправки', ''),
    (trip1, v_account_id, s3, next_tracking + 2, 'Электросталь',2,  40, 15000, 0, '2026-05-02', 'Ожидает отправки', ''),
    (trip2, v_account_id, s1, next_tracking + 3, 'Коледино',    8, 200, 72000, 0, '2026-05-05', 'В пути', 'Срочная'),
    (trip2, v_account_id, s2, next_tracking + 4, 'Тула',        4, 100, 38000, 0, '2026-05-05', 'В пути', ''),
    (trip2, v_account_id, s3, next_tracking + 5, 'Казань',      6, 150, 55000, 0, '2026-05-05', 'В пути', ''),
    (trip3, v_account_id, s1, next_tracking + 6, 'Коледино',   10, 300, 98000, 10, '2026-04-25', 'Прибыл',  'Прибыл вовремя'),
    (trip3, v_account_id, s2, next_tracking + 7, 'Краснодар',   7, 175, 63000,  7, '2026-04-25', 'Отгружен', ''),
    (trip3, v_account_id, s3, next_tracking + 8, 'Новосибирск', 5, 130, 47000,  5, '2026-04-25', 'Отгружен', '');

  RAISE NOTICE 'Готово: 3 рейса (%, %, %), 9 поставок. Account: %', tn1, tn2, tn3, v_account_id;
END $$;
