-- Enable FBS fast-sync v2 for every existing store and make it the default
-- for future stores. An explicit false setting can still be used as an
-- emergency per-store rollback to the legacy synchronization path.

begin;

alter table public.fbs_sync_settings
  alter column fast_sync_v2_enabled set default true;

insert into public.fbs_sync_settings (
  store_id,
  account_id,
  fast_sync_v2_enabled,
  updated_at,
  updated_by
)
select
  store.id,
  store.account_id,
  true,
  timezone('utc', now()),
  null
from public.stores store
on conflict (store_id) do update set
  account_id = excluded.account_id,
  fast_sync_v2_enabled = true,
  updated_at = excluded.updated_at,
  updated_by = null;

notify pgrst, 'reload schema';

commit;
