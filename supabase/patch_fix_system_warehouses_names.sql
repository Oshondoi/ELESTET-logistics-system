-- Удаляем системные склады с битыми именами (только ?-символы)
delete from public.warehouses
where is_system = true
  and name ~ '^\?[\?\ \-]*\??$';

-- Вставляем все 20 системных складов заново (ON CONFLICT пропустит уже корректные)
insert into public.warehouses (account_id, name, is_system) values
  (null, 'Коледино',           true),
  (null, 'Электросталь',       true),
  (null, 'Подольск',           true),
  (null, 'Казань',             true),
  (null, 'Краснодар',          true),
  (null, 'Екатеринбург',       true),
  (null, 'Новосибирск',        true),
  (null, 'Хабаровск',          true),
  (null, 'Санкт-Петербург',    true),
  (null, 'Пушкино',            true),
  (null, 'Белые Столбы',       true),
  (null, 'Тула',               true),
  (null, 'Домодедово',         true),
  (null, 'Вёшки',              true),
  (null, 'Брянск',             true),
  (null, 'Минск',              true),
  (null, 'Алматы',             true),
  (null, 'Астана',             true),
  (null, 'Ташкент',            true),
  (null, 'Бишкек',             true)
on conflict do nothing;
