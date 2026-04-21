-- Исправляет контрольные цифры EAN13 у тестовых стикеров из seed_stickers.sql
-- Правильные значения вычислены по стандарту EAN13.

update public.sticker_templates set barcode = '4607148762300' where barcode = '4607148762301';
update public.sticker_templates set barcode = '4607148762317' where barcode = '4607148762318';
update public.sticker_templates set barcode = '4607148762324' where barcode = '4607148762325';
