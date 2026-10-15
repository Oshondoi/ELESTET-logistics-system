begin;
CREATE OR REPLACE FUNCTION public.heartbeat_my_request_reserve(p_invite_id uuid, p_device_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.service_request_invite_reserves
  set lease_last_seen=now()
  where invite_id=p_invite_id and user_id=auth.uid() and lease_device=p_device_id
    ;
  return found;
end $function$;

CREATE OR REPLACE FUNCTION public.submit_my_request_reserve(p_invite_id uuid, p_company_name text, p_applicant_name text, p_applicant_email text, p_title text, p_comment text, p_stores jsonb, p_executor_account_id uuid, p_applicant_account_id uuid, p_device_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.lock_request_invite_actor();
  perform 1 from public.service_request_invite_reserves r
  where r.invite_id=p_invite_id and r.user_id=auth.uid()
    and r.lease_device=p_device_id for update;
  if not found then
    raise exception 'Черновик недоступен или редактируется на другом устройстве';
  end if;
  perform set_config('app.request_reserve_lease_verified','on',true);
  return public.submit_my_request_reserve(
    p_invite_id,p_company_name,p_applicant_name,p_applicant_email,
    p_title,p_comment,p_stores,p_executor_account_id,p_applicant_account_id
  );
end $function$;

CREATE OR REPLACE FUNCTION public.search_executor_accounts(p_query text)
RETURNS TABLE(id uuid, short_id integer, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 select a.id,a.short_id,a.name from public.accounts a
 where auth.uid() is not null and a.deleted_at is null
 and btrim(p_query) ~ '^[0-9]+$' and a.short_id::text=btrim(p_query)
 limit 1
$function$;
CREATE OR REPLACE FUNCTION public.list_recent_request_executors(p_applicant_account_id uuid)
RETURNS TABLE(id uuid, short_id integer, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
 if not public.request_user_has_permission(p_applicant_account_id,'request_create') then
   raise exception 'Нет права просматривать исполнителей';
 end if;
 return query
 select a.id,a.short_id,a.name from public.accounts a
 join (
   select v.snapshot->'request'->>'executor_account_id' executor_id,max(v.confirmed_at) accepted_on
   from public.service_request_versions v
   join public.service_requests r on r.id=v.request_id
   where r.applicant_account_id=p_applicant_account_id and v.event_type='accepted'
     and v.snapshot->'request'->>'applicant_account_id'=p_applicant_account_id::text
   group by v.snapshot->'request'->>'executor_account_id'
 ) recent on recent.executor_id=a.id::text
 where a.deleted_at is null
 order by recent.accepted_on desc nulls last;
end $function$;
commit;

