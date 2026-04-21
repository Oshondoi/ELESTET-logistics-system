-- Сид 3 тестовых стикеров.
-- Подставь свой account_id вместо <YOUR_ACCOUNT_ID>
-- Узнать можно: select id, name from public.accounts;

do $$
declare
  acc uuid := (select id from public.accounts order by created_at limit 1);
begin

  insert into public.sticker_templates
    (account_id, barcode, name, composition, article, brand, size, color,
     supplier, supplier_address, production_date, country, copies,
     icon_wash, icon_iron, icon_no_bleach, icon_no_tumble_dry, icon_eac)
  values
    (acc, '4607148762300', 'Джинсы классические',
     '100% хлопок', 'JNS-001', 'DENIM CO', '32/32', 'Синий',
     'ИП Иванов А.В.', 'г. Бишкек, ул. Ленина 10', '01.01.26',
     'Кыргызстан', 2, true, true, true, true, true),

    (acc, '4607148762317', 'Футболка оверсайз',
     '95% хлопок, 5% эластан', 'TS-002', 'URBAN STYLE', 'M', 'Белый',
     'ИП Петров С.К.', 'г. Бишкек, ул. Манаса 5', '15.02.26',
     'Кыргызстан', 3, true, false, true, true, true),

    (acc, '4607148762324', 'Худи с принтом',
     '80% хлопок, 20% полиэстер', 'HD-003', 'STREET WEAR', 'L', 'Чёрный',
     'ИП Сидорова М.П.', 'г. Ош, ул. Курманжан Датки 22', '10.03.26',
     'Кыргызстан', 1, true, true, true, false, true);

end $$;
