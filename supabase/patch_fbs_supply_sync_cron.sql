-- Планировщик официальной временной шкалы FBS.
-- Перед применением в Vault должны существовать секреты:
--   fbs_project_url       = https://<project-ref>.supabase.co
--   fbs_service_role_key  = service_role key проекта

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'fbs_project_url')
    or not exists (select 1 from vault.decrypted_secrets where name = 'fbs_service_role_key') then
    raise notice 'FBS cron не создан: добавьте fbs_project_url и fbs_service_role_key в Vault';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'fbs-sync-every-2min') then
    perform cron.unschedule('fbs-sync-every-2min');
  end if;
  if exists (select 1 from cron.job where jobname = 'fbs-sync-nightly-full') then
    perform cron.unschedule('fbs-sync-nightly-full');
  end if;

  perform cron.schedule(
    'fbs-sync-every-2min',
    '*/2 * * * *',
    $cron$
      select net.http_post(
        url := (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'fbs_project_url' limit 1
        ) || '/functions/v1/wb-fbs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'fbs_service_role_key' limit 1
          ),
          'Authorization', 'Bearer ' || (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'fbs_service_role_key' limit 1
          )
        ),
        body := '{"action":"sync_all_stores","mode":"incremental"}'::jsonb,
        timeout_milliseconds := 150000
      );
    $cron$
  );

  -- 03:15 по Бишкеку (21:15 UTC): контрольная полная сверка.
  perform cron.schedule(
    'fbs-sync-nightly-full',
    '15 21 * * *',
    $cron$
      select net.http_post(
        url := (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'fbs_project_url' limit 1
        ) || '/functions/v1/wb-fbs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'fbs_service_role_key' limit 1
          ),
          'Authorization', 'Bearer ' || (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'fbs_service_role_key' limit 1
          )
        ),
        body := '{"action":"sync_all_stores","mode":"full"}'::jsonb,
        timeout_milliseconds := 150000
      );
    $cron$
  );
end;
$$;
