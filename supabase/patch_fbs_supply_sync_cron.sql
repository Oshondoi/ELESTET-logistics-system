-- Планировщик официальной временной шкалы FBS.
-- Перед применением в Vault должны существовать секреты:
--   fbs_project_url       = https://<project-ref>.supabase.co
--   fbs_service_role_key  = service_role key проекта

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Один HTTP-запрос обслуживает только один магазин. Так медленный или большой
-- магазин не блокирует остальные, а лимит времени Edge Function не делится
-- между всеми магазинами аккаунта.
create or replace function public.dispatch_fbs_store_syncs(
  p_mode text,
  p_full_batch_size integer default 3
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_project_url text;
  v_service_key text;
  v_count integer := 0;
begin
  if p_mode not in ('incremental', 'full') then
    raise exception 'Некорректный тип FBS-синхронизации';
  end if;
  if p_full_batch_size < 1 or p_full_batch_size > 12 then
    raise exception 'Размер партии должен быть от 1 до 12';
  end if;

  select decrypted_secret into v_project_url
  from vault.decrypted_secrets
  where name = 'fbs_project_url'
  limit 1;

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'fbs_service_role_key'
  limit 1;

  if coalesce(v_project_url, '') = '' or coalesce(v_service_key, '') = '' then
    raise exception 'Добавьте fbs_project_url и fbs_service_role_key в Supabase Vault';
  end if;

  perform net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/wb-fbs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_service_key,
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'action', 'sync_store_service',
      'store_id', target.store_id,
      'mode', p_mode
    ),
    timeout_milliseconds := 150000
  )
  from (
    select store.id as store_id
    from public.stores store
    left join public.fbs_sync_log sync_log on sync_log.store_id = store.id
    where store.api_key is not null
      and store.deleted_at is null
      and not exists (
        select 1
        from public.fbs_sync_jobs active_job
        where active_job.store_id = store.id
          and active_job.status in ('queued', 'running')
      )
      and not exists (
        select 1
        from (
          select previous_job.status, previous_job.error, previous_job.finished_at
          from public.fbs_sync_jobs previous_job
          where previous_job.store_id = store.id
          order by previous_job.created_at desc
          limit 1
        ) latest_job
        where latest_job.status = 'failed'
          and latest_job.error = 'no_permission'
          and latest_job.finished_at > timezone('utc', now()) - interval '1 hour'
      )
      and (
        (p_mode = 'incremental'
          and coalesce(sync_log.supply_last_synced_at, 'epoch'::timestamptz)
            < timezone('utc', now()) - interval '75 seconds')
        or (p_mode = 'full'
          and coalesce(sync_log.supply_last_full_at, 'epoch'::timestamptz)
            < (date_trunc('day', timezone('Asia/Bishkek', now())) at time zone 'Asia/Bishkek'))
      )
    order by
      case when p_mode = 'incremental'
        then coalesce(sync_log.supply_last_synced_at, 'epoch'::timestamptz) end,
      case when p_mode = 'full' then coalesce((
        select max(previous_job.created_at)
        from public.fbs_sync_jobs previous_job
        where previous_job.store_id = store.id
          and previous_job.job_type = 'full'
      ), 'epoch'::timestamptz) end,
      store.id
    limit p_full_batch_size
  ) target;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.dispatch_fbs_store_syncs(text, integer)
  from public, anon, authenticated;

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
  if exists (select 1 from cron.job where jobname = 'fbs-sync-every-30sec') then
    perform cron.unschedule('fbs-sync-every-30sec');
  end if;
  if exists (select 1 from cron.job where jobname = 'fbs-sync-nightly-full') then
    perform cron.unschedule('fbs-sync-nightly-full');
  end if;

  -- Дневного серверного автообновления нет. С 05:00 по Бишкеку запускаем
  -- ночную очередь небольшими независимыми партиями. Повторные запуски до
  -- 08:55 дают большим магазинам закончить всю историю и состав поставок.
  perform cron.schedule(
    'fbs-sync-nightly-full',
    '*/5 23,0-2 * * *',
    $cron$select public.dispatch_fbs_store_syncs('full', 3);$cron$
  );
end;
$$;
