-- Serialize related invite operations before taking invite/reserve row locks.
-- Locks are transaction-local: no persistent lock rows or global queue.
begin;
create or replace function public.lock_request_invite_actor() returns void
language plpgsql security definer set search_path=public as $$
declare company uuid;
begin
 if auth.uid() is null then raise exception 'Сначала войдите' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('request-user:'||auth.uid()::text,8123));
 for company in select account_id from public.account_members where user_id=auth.uid() order by account_id loop
  perform pg_advisory_xact_lock(hashtextextended('request-company:'||company::text,8123));
 end loop;
end $$;
revoke all on function public.lock_request_invite_actor() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.claim_service_request_invite(p_token uuid, p_applicant_account_id uuid DEFAULT NULL::uuid, p_replace_existing boolean DEFAULT false)
 RETURNS TABLE(id uuid, short_id integer, name text, applicant_account_id uuid, invite_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_i public.service_request_invites%rowtype;
  v_old public.service_request_invites%rowtype;
  v_account uuid:=p_applicant_account_id;
  v_count integer;
begin
  perform public.lock_request_invite_actor();
  if auth.uid() is null then raise exception 'Сначала войдите'; end if;
  select i.* into v_i from public.service_request_invites i where i.token=p_token for update;
  if not found or v_i.deleted_at is not null or v_i.revoked_at is not null
     or v_i.expires_at<=now() then raise exception 'Ссылка недействительна или истекла'; end if;
  if exists(select 1 from public.service_request_invite_reserves r
            where r.invite_id=v_i.id and r.user_id<>auth.uid()) then
    raise exception 'Ссылка уже закреплена за другим пользователем';
  end if;
  if v_i.applicant_account_id is not null then
    if not public.request_invite_user_can_view(v_i.applicant_account_id) then
      raise exception 'У вас нет доступа к данным текущей ссылки';
    end if;
    v_account:=v_i.applicant_account_id;
  else
    if v_account is null then
      select count(*),(array_agg(am.account_id order by am.account_id))[1] into v_count,v_account
      from public.account_members am where am.user_id=auth.uid();
      if v_count>1 then raise exception 'Выберите компанию-заявителя'; end if;
    end if;
    if v_account is not null and not public.request_invite_user_can_bind(v_account) then
      raise exception 'Нужны права на заявки и управление партиями выбранной компании';
    end if;
    if v_account is not null then
      update public.service_request_invites i
      set deleted_at=now(),delete_reason='expired'
      where i.applicant_account_id=v_account and i.id<>v_i.id and i.expires_at<=now()
        and i.deleted_at is null and i.revoked_at is null;
      select i.* into v_old from public.service_request_invites i
      where i.applicant_account_id=v_account and i.id<>v_i.id
        and i.deleted_at is null and i.revoked_at is null for update;
      if found and not p_replace_existing then
        raise exception 'ACTIVE_LINK_EXISTS: у компании уже есть ссылка; подтвердите замену';
      end if;
      if found then
        if not public.request_invite_recent_email_otp() then
          raise exception 'Подтвердите замену кодом из почты';
        end if;
        insert into public.service_request_invite_admin_audit(
          invite_id,token_fingerprint,action,executor_account_id,applicant_account_id,actor_id,details
        ) values(
          v_old.id,encode(extensions.digest(v_old.token::text,'sha256'),'hex'),'replaced',
          v_old.executor_account_id,v_account,auth.uid(),
          jsonb_build_object('replacement_invite_id',v_i.id)
        );
        update public.service_request_invites i
        set token=gen_random_uuid(),revoked_at=now(),deleted_at=now(),
            delete_reason='replaced_by_applicant',applicant_account_id=null
        where i.id=v_old.id;
      end if;
      update public.service_request_invites i
      set applicant_account_id=v_account,bound_at=now() where i.id=v_i.id;
    end if;
  end if;
  update public.service_request_invites i
  set claimed_by=auth.uid(),claimed_at=coalesce(i.claimed_at,now()),last_used_at=now()
  where i.id=v_i.id;
  return query select a.id,a.short_id,a.name,v_account,v_i.id
  from public.accounts a where a.id=v_i.executor_account_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.replace_service_request_invite_reserve(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new public.service_request_invites%rowtype;
  v_old public.service_request_invites%rowtype;
  v_reserve public.service_request_invite_reserves%rowtype;
begin
  perform public.lock_request_invite_actor();
  if auth.uid() is null or not public.request_invite_recent_email_otp() then
    raise exception 'Подтвердите перенос кодом из почты';
  end if;
  select * into v_new from public.service_request_invites where token=p_token for update;
  if not found or v_new.deleted_at is not null or v_new.revoked_at is not null
     or v_new.expires_at<=now() then raise exception 'Новая ссылка недействительна'; end if;
  if v_new.applicant_account_id is not null and not public.request_invite_user_can_bind(v_new.applicant_account_id) then
    raise exception 'У вас нет права привязывать резерв к компании этой ссылки' using errcode='42501';
  end if;
  select * into v_reserve from public.service_request_invite_reserves
  where user_id=auth.uid() and invite_id<>v_new.id
  order by created_at desc limit 1 for update;
  if not found then raise exception 'Прежняя ссылка не найдена'; end if;
  select * into v_old from public.service_request_invites where id=v_reserve.invite_id for update;
  if v_old.deleted_at is null and v_old.revoked_at is null then
    insert into public.service_request_invite_admin_audit(
      invite_id,token_fingerprint,action,executor_account_id,applicant_account_id,actor_id,details
    ) values(
      v_old.id,encode(extensions.digest(v_old.token::text,'sha256'),'hex'),'replaced',
      v_old.executor_account_id,v_old.applicant_account_id,auth.uid(),
      jsonb_build_object('replacement_invite_id',v_new.id)
    );
    update public.service_request_invites
    set token=gen_random_uuid(),revoked_at=now(),deleted_at=now(),delete_reason='replaced_by_applicant'
    where id=v_old.id;
  end if;
  insert into public.service_request_invite_reserves(invite_id,user_id,email,full_name,draft,expires_at)
  values(v_new.id,auth.uid(),v_reserve.email,v_reserve.full_name,'{}'::jsonb,v_new.initial_expires_at)
  on conflict(invite_id) do nothing;
  if not exists(select 1 from public.service_request_invite_reserves
                where invite_id=v_new.id and user_id=auth.uid()) then
    raise exception 'Новая ссылка уже закреплена за другим пользователем';
  end if;
  update public.service_request_invites
  set claimed_by=auth.uid(),claimed_at=coalesce(claimed_at,now()),last_used_at=now()
  where id=v_new.id;
  return jsonb_build_object('ok',true,'expires_at',v_new.initial_expires_at);
end $function$
;
CREATE OR REPLACE FUNCTION public.submit_my_request_reserve(p_invite_id uuid, p_company_name text, p_applicant_name text, p_applicant_email text, p_title text, p_comment text, p_stores jsonb, p_executor_account_id uuid, p_applicant_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reserve public.service_request_invite_reserves%rowtype;
  v_invite public.service_request_invites%rowtype;
  v_active public.service_request_invites%rowtype;
  v_account public.accounts%rowtype;
  v_request public.service_requests%rowtype;
  v_store jsonb;
  v_store_row public.stores%rowtype;
  v_store_code text;
  v_email text;
  v_memberships integer;
begin
  perform public.lock_request_invite_actor();
  if exists(select 1 from public.service_request_invite_reserves r
            where r.invite_id=p_invite_id and r.lease_device is not null
              and r.lease_last_seen>now()-interval '2 minutes')
     and current_setting('app.request_reserve_lease_verified',true) is distinct from 'on' then
    raise exception 'Черновик открыт в новом интерфейсе; обновите страницу';
  end if;
  select lower(email) into v_email from auth.users
  where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null or v_email is distinct from lower(btrim(p_applicant_email)) then
    raise exception 'Подтверждённая почта не совпадает с почтой заявителя';
  end if;
  select * into v_reserve from public.service_request_invite_reserves
  where invite_id=p_invite_id and user_id=auth.uid() for update;
  if not found then raise exception 'Черновик недоступен'; end if;
  select * into v_invite from public.service_request_invites where id=p_invite_id;
  if not found then raise exception 'Источник черновика не найден'; end if;
  select count(*) into v_memberships from public.account_members where user_id=auth.uid();
  if v_memberships>0 then
    if p_applicant_account_id is null then
      if v_memberships<>1 then raise exception 'Выберите компанию-заявителя'; end if;
      select account_id into p_applicant_account_id from public.account_members
      where user_id=auth.uid() limit 1;
    end if;
    if not public.request_user_has_permission(p_applicant_account_id,'request_create') then
      raise exception 'Нет права подавать заявку от выбранной компании';
    end if;
    select * into v_account from public.accounts where id=p_applicant_account_id and deleted_at is null;
    if not found then raise exception 'Компания-заявитель не найдена'; end if;
  else
    if p_applicant_account_id is not null then raise exception 'Компания-заявитель недоступна'; end if;
    if nullif(btrim(p_company_name),'') is null then raise exception 'Укажите компанию'; end if;
    insert into public.accounts(name) values(btrim(p_company_name)) returning * into v_account;
    insert into public.account_members(account_id,user_id,role)
    values(v_account.id,auth.uid(),'owner');
  end if;
  if nullif(btrim(p_applicant_name),'') is null then raise exception 'Укажите имя'; end if;
  if jsonb_typeof(coalesce(p_stores,'[]'::jsonb))<>'array' or
     jsonb_array_length(coalesce(p_stores,'[]'::jsonb))=0 then
    raise exception 'Добавьте магазин и товары';
  end if;
  if p_executor_account_id is null or not exists(
    select 1 from public.accounts where id=p_executor_account_id and deleted_at is null
  ) then raise exception 'Выберите исполнителя'; end if;

  insert into public.service_requests(
    applicant_account_id,applicant_company_short_id,applicant_company_name,
    executor_account_id,executor_company_short_id,executor_company_name,invite_id,
    title,applicant_name,applicant_email,comment
  ) select v_account.id,v_account.short_id,v_account.name,a.id,a.short_id,a.name,
    p_invite_id,coalesce(p_title,''),btrim(p_applicant_name),v_email,nullif(btrim(p_comment),'')
    from public.accounts a where a.id=p_executor_account_id
    returning * into v_request;

  for v_store in select value from jsonb_array_elements(p_stores) loop
    if nullif(v_store->>'store_id','') is not null then
      select * into v_store_row from public.stores
      where id=(v_store->>'store_id')::uuid and account_id=v_account.id and deleted_at is null;
      if not found then raise exception 'Выбранный магазин не принадлежит компании-заявителю'; end if;
    else
      if nullif(btrim(v_store->>'name'),'') is null then
        raise exception 'Укажите название каждого магазина';
      end if;
      loop
        v_store_code:=chr(65+floor(random()*26)::integer)||lpad(floor(random()*10000)::integer::text,4,'0');
        exit when not exists(select 1 from public.stores where store_code=v_store_code);
      end loop;
      insert into public.stores(account_id,store_code,name,marketplace)
      values(v_account.id,v_store_code,btrim(v_store->>'name'),
        lower(coalesce(nullif(btrim(v_store->>'marketplace'),''),'wildberries')))
      returning * into v_store_row;
    end if;
    insert into public.service_request_stores(
      request_id,applicant_store_id,position,delivery_mode,intake_mode,payload
    ) values(
      v_request.id,v_store_row.id,coalesce((v_store->>'position')::integer,0),
      case when v_store->>'delivery_mode'='pickup' then 'pickup' else 'self_delivery' end,
      case when v_store->>'intake_mode' in ('bulk','catalog','barcodes','boxes')
           then v_store->>'intake_mode' else 'bulk' end,
      jsonb_build_object('items',coalesce(v_store->'items','[]'::jsonb),
                         'supplies',coalesce(v_store->'supplies','[]'::jsonb))
    );
  end loop;
  perform public.submit_service_request(v_request.id);
  select i.* into v_active from public.service_request_invites i
  join public.service_request_invite_reserves r on r.invite_id=i.id
  where r.user_id=auth.uid() and i.deleted_at is null and i.revoked_at is null
    and i.expires_at>now()
  order by i.created_at desc limit 1 for update of i;
  if found and (v_active.applicant_account_id=v_account.id or
      (v_active.applicant_account_id is null and not exists(
        select 1 from public.service_request_invites other
        where other.applicant_account_id=v_account.id and other.id<>v_active.id
          and other.deleted_at is null and other.revoked_at is null
          and other.expires_at>now()
      ))) then
    update public.service_request_invites
    set applicant_account_id=v_account.id,bound_at=coalesce(bound_at,now()),
        expires_at='infinity'
    where id=v_active.id;
  end if;
  delete from public.service_request_invite_reserves where invite_id=p_invite_id;
  return jsonb_build_object('ok',true,'account_id',v_account.id,'request_id',v_request.id);
end $function$
;
CREATE OR REPLACE FUNCTION public.submit_my_request_reserve(p_invite_id uuid, p_company_name text, p_applicant_name text, p_applicant_email text, p_title text, p_comment text, p_stores jsonb, p_executor_account_id uuid, p_applicant_account_id uuid, p_device_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.lock_request_invite_actor();
  if not exists(select 1 from public.service_request_invite_reserves r
                where r.invite_id=p_invite_id and r.user_id=auth.uid()
                  and r.lease_device=p_device_id
                  and r.lease_last_seen>now()-interval '2 minutes') then
    raise exception 'Право подтверждения черновика истекло или передано другому устройству';
  end if;
  perform set_config('app.request_reserve_lease_verified','on',true);
  return public.submit_my_request_reserve(
    p_invite_id,p_company_name,p_applicant_name,p_applicant_email,
    p_title,p_comment,p_stores,p_executor_account_id,p_applicant_account_id
  );
end $function$
;
CREATE OR REPLACE FUNCTION public.reserve_service_request_invite(p_token uuid, p_full_name text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite public.service_request_invites%rowtype;
  v_reserve public.service_request_invite_reserves%rowtype;
  v_other uuid;
  v_other_token uuid;
  v_email text;
begin
  perform public.lock_request_invite_actor();
  if auth.uid() is null then raise exception 'Сначала подтвердите почту'; end if;
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null or v_email is distinct from lower(btrim(p_email)) then
    raise exception 'Подтверждённая почта не совпадает с почтой аккаунта';
  end if;
  select * into v_invite from public.service_request_invites where token=p_token for update;
  if not found or v_invite.deleted_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at<=now() then raise exception 'Ссылка недействительна или истекла'; end if;
  if v_invite.applicant_account_id is not null and not public.request_invite_user_can_bind(v_invite.applicant_account_id) then
    raise exception 'У вас нет права привязывать резерв к компании этой ссылки' using errcode='42501';
  end if;
  select * into v_reserve from public.service_request_invite_reserves where invite_id=v_invite.id for update;
  if found and v_reserve.user_id<>auth.uid() then raise exception 'Ссылка уже закреплена за другим пользователем'; end if;
  select r.invite_id,i.token into v_other,v_other_token
  from public.service_request_invite_reserves r
  join public.service_request_invites i on i.id=r.invite_id
  where r.email=v_email and r.invite_id<>v_invite.id
    and i.deleted_at is null and i.revoked_at is null and i.expires_at>now()
  order by r.created_at desc limit 1;
  if v_other is not null then
    return jsonb_build_object('ok',false,'code','EMAIL_RESERVED','invite_id',v_other,'token',v_other_token);
  end if;
  insert into public.profiles(user_id,full_name) values(auth.uid(),btrim(p_full_name))
  on conflict(user_id) do update set full_name=excluded.full_name;
  insert into public.service_request_invite_reserves(invite_id,user_id,email,full_name,expires_at)
  values(v_invite.id,auth.uid(),v_email,btrim(p_full_name),v_invite.initial_expires_at)
  on conflict(invite_id) do update set full_name=excluded.full_name,updated_at=now();
  update public.service_request_invites set claimed_by=auth.uid(),claimed_at=coalesce(claimed_at,now()),last_used_at=now()
  where id=v_invite.id;
  return jsonb_build_object('ok',true,'expires_at',v_invite.initial_expires_at);
end $function$
;
CREATE OR REPLACE FUNCTION public.submit_service_request_invite_reserve(p_token uuid, p_company_name text, p_applicant_name text, p_applicant_email text, p_title text, p_comment text, p_stores jsonb, p_executor_account_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_invite public.service_request_invites%rowtype;
begin
  perform public.lock_request_invite_actor();
  select * into v_invite from public.service_request_invites where token=p_token for update;
  if not found or v_invite.deleted_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at<=now() or v_invite.applicant_account_id is not null then
    raise exception 'Клиентская ссылка недоступна';
  end if;
  return public.submit_my_request_reserve(
    v_invite.id,p_company_name,p_applicant_name,p_applicant_email,
    p_title,p_comment,p_stores,p_executor_account_id,null
  );
end $function$
;
CREATE OR REPLACE FUNCTION public.submit_service_request_invite_reserve(p_token uuid, p_company_name text, p_applicant_name text, p_applicant_email text, p_title text, p_comment text, p_stores jsonb, p_executor_account_id uuid, p_device_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_invite_id uuid;
begin
  perform public.lock_request_invite_actor();
  select id into v_invite_id from public.service_request_invites
  where token=p_token and deleted_at is null and revoked_at is null
    and expires_at>now() and applicant_account_id is null for update;
  if v_invite_id is null then raise exception 'Клиентская ссылка недоступна'; end if;
  return public.submit_my_request_reserve(
    v_invite_id,p_company_name,p_applicant_name,p_applicant_email,
    p_title,p_comment,p_stores,p_executor_account_id,null,p_device_id
  );
end $function$
;
commit;
