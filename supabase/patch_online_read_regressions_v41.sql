-- Fix regressions introduced when WB keys were moved out of stores.api_key and
-- request RLS was switched to request_user_has_permission().
-- Safe to re-run after patch_integration_secret_boundary_v40.sql.

begin;

do $$
declare
  function_row record;
  old_definition text;
  new_definition text;
  changed_count integer := 0;
begin
  for function_row in
    select procedure.oid, procedure.proname
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prokind = 'f'
      and procedure.proname in (
        'get_fbs_work_contexts',
        'get_fbs_outsource_access',
        'save_fbs_outsource_access',
        'dispatch_fbs_store_syncs'
      )
  loop
    old_definition := pg_get_functiondef(function_row.oid);
    new_definition := replace(
      old_definition,
      'store.api_key is not null',
      'exists (select 1 from public.store_integration_secrets secret where secret.store_id = store.id and secret.wb_api_key_cipher is not null)'
    );

    if new_definition = old_definition then
      if old_definition not like '%store_integration_secrets%' then
        raise exception 'Function public.% does not contain the expected WB-key check', function_row.proname;
      end if;
    else
      execute new_definition;
    end if;

    changed_count := changed_count + 1;
  end loop;

  if changed_count <> 4 then
    raise exception 'Expected four FBS functions, found %', changed_count;
  end if;
end;
$$;

-- These SELECT policies execute the helper as the authenticated caller:
-- service_requests, request stores/versions/events/correction drafts and batch
-- documents. The function is SECURITY DEFINER, uses auth.uid(), returns only a
-- boolean and rejects permission names outside its fixed allow-list.
revoke all on function public.request_user_has_permission(uuid, text)
  from public, anon, authenticated;
grant execute on function public.request_user_has_permission(uuid, text)
  to authenticated, service_role;

commit;
