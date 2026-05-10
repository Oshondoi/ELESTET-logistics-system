-- Добавляем право "Редактирование тарифов работ" в существующие роли
-- (новые роли получат его через DEFAULT_PERMISSIONS на фронте)
update public.roles
set permissions = permissions || '{"directories_tariff_manage": false}'::jsonb
where not (permissions ? 'directories_tariff_manage');
