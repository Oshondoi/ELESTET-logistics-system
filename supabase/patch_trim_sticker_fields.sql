-- Чистим все текстовые поля стикеров: убираем пробелы и дефисы по краям
UPDATE public.sticker_templates
SET
  article          = NULLIF(TRIM(BOTH ' -' FROM COALESCE(article, '')),          ''),
  brand            = NULLIF(TRIM(BOTH ' -' FROM COALESCE(brand, '')),            ''),
  composition      = NULLIF(TRIM(BOTH ' -' FROM COALESCE(composition, '')),      ''),
  size             = NULLIF(TRIM(BOTH ' -' FROM COALESCE(size, '')),             ''),
  color            = NULLIF(TRIM(BOTH ' -' FROM COALESCE(color, '')),            ''),
  supplier         = NULLIF(TRIM(BOTH ' -' FROM COALESCE(supplier, '')),         ''),
  supplier_address = NULLIF(TRIM(BOTH ' -' FROM COALESCE(supplier_address, '')), ''),
  production_date  = NULLIF(TRIM(BOTH ' -' FROM COALESCE(production_date, '')),  '');
