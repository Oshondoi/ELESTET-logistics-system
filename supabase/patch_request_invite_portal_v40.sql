-- Target model: public request link lifecycle, reserve, company binding and admin controls.
-- Discussion public-request-invite-auth-20260926, revision 40.

alter table public.service_request_invites
  add column if not exists applicant_account_id uuid references public.accounts(id) on delete restrict,
  add column if not exists bound_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists delete_reason text,
  add column if not exists initial_expires_at timestamptz,
  add column if not exists last_used_at timestamptz;

alter table public.service_requests
  add column if not exists responsible_user_id uuid references auth.users(id) on delete set null,
  add column if not exists work_started_at timestamptz;

alter table public.batch_notifications
  add column if not exists source_request_id uuid references public.service_requests(id) on delete cascade;
create index if not exists batch_notifications_source_request_idx
  on public.batch_notifications(source_request_id) where source_request_id is not null;

update public.service_request_invites
set initial_expires_at = expires_at
where initial_expires_at is null;

alter table public.service_request_invites
  alter column initial_expires_at set default (now() + interval '30 days');

create unique index if not exists service_request_invites_one_active_company_uidx
  on public.service_request_invites(applicant_account_id)
  where applicant_account_id is not null and deleted_at is null and revoked_at is null;

create table if not exists public.service_request_invite_reserves (
  invite_id uuid primary key references public.service_request_invites(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  draft jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(email)
);

create table if not exists public.service_request_invite_admin_audit (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid,
  token_fingerprint text not null,
  action text not null check (action in ('detach_link','delete_link_data','expired_cleanup','replaced')),
  executor_account_id uuid,
  applicant_account_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.service_request_invite_reserves enable row level security;
alter table public.service_request_invite_admin_audit enable row level security;

update public.roles set permissions='{"request_view":false,"request_create":false,"request_manage":false,"request_assign":false,"request_start_work":false,"request_history_view":false,"client_portal_access_manage":false}'::jsonb||permissions;

create or replace function public.request_user_has_permission(p_account_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select p_permission in ('request_view','request_create','request_manage','request_assign','request_start_work','request_history_view','client_portal_access_manage','fulfillment_view','fulfillment_manage','stores_manage')
    and (
      exists(select 1 from public.account_members where account_id=p_account_id and user_id=auth.uid() and role in ('owner','admin'))
      or exists(
        select 1 from public.role_assignments ra join public.roles r on r.id=ra.role_id and r.account_id=ra.account_id
        join public.account_members am on am.account_id=ra.account_id and am.user_id=ra.user_id
        where ra.account_id=p_account_id and ra.user_id=auth.uid()
          and coalesce((r.permissions->>p_permission)::boolean,false)
      )
    )
$$;

create or replace function public.request_invite_user_can_bind(p_account_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.request_user_has_permission(p_account_id,'request_create')
    and public.request_user_has_permission(p_account_id,'fulfillment_manage')
$$;

create or replace function public.request_invite_user_can_view(p_account_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.request_user_has_permission(p_account_id,'request_view')
$$;

create or replace function public.list_request_invite_bindable_accounts()
returns table(account_id uuid) language sql stable security definer set search_path=public as $$
  select distinct am.account_id from public.account_members am
  where am.user_id=auth.uid() and public.request_invite_user_can_bind(am.account_id)
$$;

create or replace function public.is_platform_superadmin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where user_id=auth.uid() and platform_role='superadmin')
$$;

drop policy if exists invite_reserve_owner on public.service_request_invite_reserves;
create policy invite_reserve_owner on public.service_request_invite_reserves
for select using (user_id=auth.uid() or public.is_platform_superadmin());
drop policy if exists invite_admin_audit_superadmin on public.service_request_invite_admin_audit;
create policy invite_admin_audit_superadmin on public.service_request_invite_admin_audit
for select using (public.is_platform_superadmin());

create or replace function public.create_service_request_invite(p_executor_account_id uuid)
returns public.service_request_invites language plpgsql security definer set search_path=public as $$
declare v_row public.service_request_invites%rowtype;
begin
  if not public.request_user_has_permission(p_executor_account_id,'client_portal_access_manage') then raise exception 'Нет права создавать клиентские ссылки'; end if;
  insert into public.service_request_invites(executor_account_id,created_by,expires_at,initial_expires_at)
  values(p_executor_account_id,auth.uid(),now()+interval '30 days',now()+interval '30 days') returning * into v_row;
  return v_row;
end $$;

drop function if exists public.get_service_request_invite(uuid);
create function public.get_service_request_invite(p_token uuid)
returns table(
  invite_id uuid, executor_account_id uuid, executor_short_id integer, executor_name text,
  applicant_account_id uuid, applicant_short_id integer, applicant_name text,
  expires_at timestamptz, is_available boolean, state text, unavailable_reason text,
  reserved_email text, reserved_name text, email_confirmed boolean, reserve_draft jsonb
) language sql stable security definer set search_path=public as $$
  select i.id,i.executor_account_id,e.short_id,e.name,
    i.applicant_account_id,a.short_id,a.name,i.expires_at,
    i.deleted_at is null and i.revoked_at is null and (i.applicant_account_id is not null or i.expires_at>now()),
    case when i.deleted_at is not null then 'deleted'
         when i.revoked_at is not null then 'replaced'
         when i.applicant_account_id is not null then 'bound'
         when r.invite_id is not null then 'reserved'
         when i.expires_at<=now() then 'expired' else 'active' end,
    case when i.deleted_at is not null then 'Ссылка удалена'
         when i.revoked_at is not null then 'Ссылка недействительна'
         when i.applicant_account_id is null and i.expires_at<=now() then 'Срок действия ссылки истёк' end,
    coalesce(r.email,owner_user.email::text),
    coalesce(r.full_name,owner_profile.full_name),
    coalesce(u.email_confirmed_at,owner_user.email_confirmed_at) is not null,
    case when r.user_id=auth.uid() then r.draft end
  from public.service_request_invites i
  join public.accounts e on e.id=i.executor_account_id
  left join public.accounts a on a.id=i.applicant_account_id
  left join public.service_request_invite_reserves r on r.invite_id=i.id
  left join auth.users u on u.id=r.user_id
  left join lateral (select am.user_id from public.account_members am where am.account_id=i.applicant_account_id and am.role='owner' order by am.created_at limit 1) owner_member on true
  left join auth.users owner_user on owner_user.id=owner_member.user_id
  left join public.profiles owner_profile on owner_profile.user_id=owner_member.user_id
  where i.token=p_token
$$;

create or replace function public.reserve_service_request_invite(p_token uuid,p_full_name text,p_email text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_invite public.service_request_invites%rowtype; v_email text:=lower(btrim(p_email)); v_other uuid; v_other_token uuid; v_other_user uuid;
begin
  if auth.uid() is null then raise exception 'Сначала войдите или зарегистрируйтесь'; end if;
  select * into v_invite from public.service_request_invites where token=p_token for update;
  if not found or v_invite.deleted_at is not null or v_invite.revoked_at is not null or (v_invite.applicant_account_id is null and v_invite.expires_at<=now()) then raise exception 'Ссылка недействительна или истекла'; end if;
  select r.invite_id,r.user_id,i.token into v_other,v_other_user,v_other_token from public.service_request_invite_reserves r join public.service_request_invites i on i.id=r.invite_id where r.email=v_email and r.invite_id<>v_invite.id;
  if v_other is not null then return jsonb_build_object('ok',false,'code','EMAIL_RESERVED','invite_id',v_other,'token',case when v_other_user=auth.uid() then v_other_token else null end); end if;
  insert into public.profiles(user_id,full_name) values(auth.uid(),btrim(p_full_name))
  on conflict(user_id) do update set full_name=excluded.full_name;
  insert into public.service_request_invite_reserves(invite_id,user_id,email,full_name,expires_at)
  values(v_invite.id,auth.uid(),v_email,btrim(p_full_name),v_invite.initial_expires_at)
  on conflict(invite_id) do update set user_id=excluded.user_id,email=excluded.email,full_name=excluded.full_name,updated_at=now();
  update public.service_request_invites set claimed_by=auth.uid(),claimed_at=coalesce(claimed_at,now()),last_used_at=now() where id=v_invite.id;
  return jsonb_build_object('ok',true,'expires_at',v_invite.initial_expires_at);
end $$;

create or replace function public.replace_service_request_invite_reserve(p_token uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_new public.service_request_invites%rowtype; v_old public.service_request_invites%rowtype; v_reserve public.service_request_invite_reserves%rowtype;
begin
  if auth.uid() is null then raise exception 'Сначала войдите'; end if;
  select * into v_new from public.service_request_invites where token=p_token for update;
  if not found or v_new.deleted_at is not null or v_new.revoked_at is not null or v_new.applicant_account_id is not null or v_new.expires_at<=now() then
    raise exception 'Новая ссылка недействительна или уже занята';
  end if;
  select * into v_reserve from public.service_request_invite_reserves where user_id=auth.uid() and invite_id<>v_new.id for update;
  if not found then raise exception 'Переносимый резерв не найден'; end if;
  select * into v_old from public.service_request_invites where id=v_reserve.invite_id for update;
  insert into public.service_request_invite_admin_audit(invite_id,token_fingerprint,action,executor_account_id,applicant_account_id,actor_id,details)
  values(v_old.id,encode(extensions.digest(v_old.token::text,'sha256'),'hex'),'replaced',v_old.executor_account_id,null,auth.uid(),jsonb_build_object('replacement_invite_id',v_new.id));
  update public.service_request_invites set token=gen_random_uuid(),revoked_at=now(),deleted_at=now(),delete_reason='replaced_by_applicant'
  where id=v_old.id;
  update public.service_request_invite_reserves set invite_id=v_new.id,updated_at=now() where invite_id=v_old.id;
  update public.service_request_invites set claimed_by=auth.uid(),claimed_at=coalesce(claimed_at,now()),last_used_at=now() where id=v_new.id;
  return jsonb_build_object('ok',true,'expires_at',v_reserve.expires_at);
end $$;

create or replace function public.account_has_active_request_invite(p_account_id uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_account_member(p_account_id) then raise exception 'Нет доступа'; end if;
  return exists(select 1 from public.service_request_invites where applicant_account_id=p_account_id and deleted_at is null and revoked_at is null);
end $$;

create or replace function public.save_service_request_invite_reserve(p_token uuid,p_draft jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  update public.service_request_invite_reserves r set draft=coalesce(p_draft,'{}'::jsonb),updated_at=now()
  from public.service_request_invites i where i.id=r.invite_id and i.token=p_token and r.user_id=auth.uid();
  if not found then raise exception 'Резерв ссылки недоступен'; end if;
  return jsonb_build_object('ok',true);
end $$;

-- The first confirmed request materialises the reserved data atomically. Until
-- this function succeeds there is no ELESTET company, store, R or P entity.
drop function if exists public.submit_service_request_invite_reserve(uuid,text,text,text,text,text,jsonb);
create or replace function public.submit_service_request_invite_reserve(
  p_token uuid,
  p_company_name text,
  p_applicant_name text,
  p_applicant_email text,
  p_title text,
  p_comment text,
  p_stores jsonb,
  p_executor_account_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_invite public.service_request_invites%rowtype;
  v_reserve public.service_request_invite_reserves%rowtype;
  v_account public.accounts%rowtype;
  v_request public.service_requests%rowtype;
  v_store jsonb;
  v_store_row public.stores%rowtype;
  v_store_code text;
  v_executor_account_id uuid;
begin
  if auth.uid() is null then raise exception 'Сначала войдите или зарегистрируйтесь'; end if;
  select * into v_invite from public.service_request_invites where token=p_token for update;
  if not found or v_invite.deleted_at is not null or v_invite.revoked_at is not null
     or v_invite.applicant_account_id is not null or v_invite.expires_at<=now() then
    raise exception 'Ссылка недействительна, уже привязана или срок её действия истёк';
  end if;
  select * into v_reserve from public.service_request_invite_reserves
  where invite_id=v_invite.id and user_id=auth.uid() for update;
  if not found then raise exception 'Резерв ссылки недоступен'; end if;
  if nullif(btrim(p_company_name),'') is null then raise exception 'Укажите название компании'; end if;
  if nullif(btrim(p_applicant_name),'') is null or nullif(btrim(p_applicant_email),'') is null then
    raise exception 'Укажите имя и почту заявителя';
  end if;
  if jsonb_typeof(coalesce(p_stores,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_stores,'[]'::jsonb))=0 then
    raise exception 'Добавьте хотя бы один магазин';
  end if;
  if exists(select 1 from public.account_members where user_id=auth.uid()) then
    raise exception 'Для существующего аккаунта сначала выберите компанию';
  end if;
  v_executor_account_id:=coalesce(p_executor_account_id,v_invite.executor_account_id);
  if not exists(select 1 from public.accounts where id=v_executor_account_id and deleted_at is null) then raise exception 'Выбранная компания-исполнитель не найдена'; end if;

  insert into public.accounts(name) values(btrim(p_company_name)) returning * into v_account;
  insert into public.account_members(account_id,user_id,role) values(v_account.id,auth.uid(),'owner');
  insert into public.service_requests(
    applicant_account_id,applicant_company_short_id,applicant_company_name,
    executor_account_id,executor_company_short_id,executor_company_name,invite_id,
    title,applicant_name,applicant_email,comment
  ) select v_account.id,v_account.short_id,v_account.name,a.id,a.short_id,a.name,v_invite.id,
      coalesce(p_title,''),btrim(p_applicant_name),lower(btrim(p_applicant_email)),nullif(btrim(p_comment),'')
    from public.accounts a where a.id=v_executor_account_id
    returning * into v_request;

  for v_store in select value from jsonb_array_elements(p_stores) loop
    if nullif(btrim(v_store->>'name'),'') is null then raise exception 'Укажите название каждого магазина'; end if;
    loop
      v_store_code := chr(65+floor(random()*26)::integer)||lpad(floor(random()*10000)::integer::text,4,'0');
      exit when not exists(select 1 from public.stores where store_code=v_store_code);
    end loop;
    insert into public.stores(account_id,store_code,name,marketplace)
    values(v_account.id,v_store_code,btrim(v_store->>'name'),coalesce(nullif(btrim(v_store->>'marketplace'),''),'Wildberries'))
    returning * into v_store_row;
    insert into public.service_request_stores(request_id,applicant_store_id,position,delivery_mode,intake_mode,payload)
    values(v_request.id,v_store_row.id,coalesce((v_store->>'position')::integer,0),
      case when v_store->>'delivery_mode'='pickup' then 'pickup' else 'self_delivery' end,
      case when v_store->>'intake_mode' in ('bulk','catalog','barcodes','boxes') then v_store->>'intake_mode' else 'bulk' end,
      jsonb_build_object('items',coalesce(v_store->'items','[]'::jsonb)));
  end loop;

  update public.service_request_invites set applicant_account_id=v_account.id,bound_at=now(),
    expires_at='infinity',claimed_by=auth.uid(),claimed_at=coalesce(claimed_at,now()),last_used_at=now()
  where id=v_invite.id;
  delete from public.service_request_invite_reserves where invite_id=v_invite.id;
  perform public.submit_service_request(v_request.id);
  return jsonb_build_object('ok',true,'account_id',v_account.id,'request_id',v_request.id);
end $$;

drop function if exists public.claim_service_request_invite(uuid);
drop function if exists public.claim_service_request_invite(uuid,uuid);
create or replace function public.claim_service_request_invite(p_token uuid,p_applicant_account_id uuid default null,p_replace_existing boolean default false)
returns table(id uuid,short_id integer,name text,applicant_account_id uuid,invite_id uuid)
language plpgsql security definer set search_path=public as $$
declare v_i public.service_request_invites%rowtype; v_old public.service_request_invites%rowtype; v_account uuid:=p_applicant_account_id; v_count integer;
begin
  if auth.uid() is null then raise exception 'Сначала войдите или зарегистрируйтесь'; end if;
  select * into v_i from public.service_request_invites where token=p_token for update;
  if not found or v_i.deleted_at is not null or v_i.revoked_at is not null or (v_i.applicant_account_id is null and v_i.expires_at<=now()) then raise exception 'Ссылка недействительна или истекла'; end if;
  if v_i.applicant_account_id is not null then
    if not public.request_invite_user_can_view(v_i.applicant_account_id) then raise exception 'У вас нет доступа к данным текущей ссылки'; end if;
    v_account:=v_i.applicant_account_id;
  else
    if v_account is null then
      select count(*),min(account_id) into v_count,v_account from public.account_members where user_id=auth.uid();
      if v_count>1 then raise exception 'Выберите компанию, от имени которой открыть ссылку'; end if;
    end if;
    if v_account is not null and not public.request_invite_user_can_bind(v_account) then raise exception 'Нужны права на заявки и управление партиями выбранной компании'; end if;
    if v_account is not null then
      select * into v_old from public.service_request_invites where applicant_account_id=v_account and deleted_at is null and revoked_at is null and id<>v_i.id for update;
      if found and not p_replace_existing then raise exception 'ACTIVE_LINK_EXISTS: у компании уже есть ссылка; подтвердите замену'; end if;
      if found then
        insert into public.service_request_invite_admin_audit(invite_id,token_fingerprint,action,executor_account_id,applicant_account_id,actor_id,details)
        values(v_old.id,encode(extensions.digest(v_old.token::text,'sha256'),'hex'),'replaced',v_old.executor_account_id,v_account,auth.uid(),jsonb_build_object('replacement_invite_id',v_i.id));
        update public.service_request_invites set token=gen_random_uuid(),revoked_at=now(),deleted_at=now(),delete_reason='replaced_by_applicant',applicant_account_id=null where id=v_old.id;
      end if;
    end if;
    if v_account is not null then update public.service_request_invites set applicant_account_id=v_account,bound_at=now(),expires_at='infinity' where id=v_i.id; end if;
  end if;
  update public.service_request_invites set claimed_by=auth.uid(),claimed_at=coalesce(claimed_at,now()),last_used_at=now() where id=v_i.id;
  return query select a.id,a.short_id,a.name,v_account,v_i.id from public.accounts a where a.id=v_i.executor_account_id;
end $$;

drop function if exists public.admin_list_service_request_invites();
create function public.admin_list_service_request_invites()
returns table(id uuid,token uuid,state text,created_at timestamptz,expires_at timestamptz,creator_email text,executor_id uuid,executor_name text,applicant_id uuid,applicant_short_id integer,applicant_name text,reserved_email text,reserved_name text,email_confirmed boolean,request_count bigint,batch_count bigint)
language plpgsql security definer set search_path=public as $$
begin
  if not public.is_platform_superadmin() then raise exception 'Недостаточно прав'; end if;
  return query select i.id,i.token,
    case when i.deleted_at is not null then 'deleted' when i.revoked_at is not null then 'replaced' when i.applicant_account_id is not null then 'bound' when r.invite_id is not null then 'reserved' when i.expires_at<=now() then 'expired' else 'active' end,
    i.created_at,i.expires_at,creator.email::text,i.executor_account_id,e.name,i.applicant_account_id,a.short_id,a.name,r.email,r.full_name,(u.email_confirmed_at is not null),
    count(distinct sr.id),count(distinct fb.id)
  from public.service_request_invites i join public.accounts e on e.id=i.executor_account_id left join public.accounts a on a.id=i.applicant_account_id
  left join auth.users creator on creator.id=i.created_by
  left join public.service_request_invite_reserves r on r.invite_id=i.id left join auth.users u on u.id=r.user_id
  left join public.service_requests sr on sr.invite_id=i.id and sr.deleted_at is null left join public.fulfillment_batches fb on fb.source_request_id=sr.id and fb.deleted_at is null
  group by i.id,creator.email,e.name,a.short_id,a.name,r.email,r.full_name,u.email_confirmed_at order by i.created_at desc;
end $$;

create or replace function public.admin_detach_service_request_invite(p_invite_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.service_request_invites%rowtype;
begin
  if not public.is_platform_superadmin() then raise exception 'Недостаточно прав'; end if;
  select * into v from public.service_request_invites where id=p_invite_id for update;
  if not found then raise exception 'Ссылка не найдена'; end if;
  insert into public.service_request_invite_admin_audit(invite_id,token_fingerprint,action,executor_account_id,applicant_account_id,actor_id)
  values(v.id,encode(extensions.digest(v.token::text,'sha256'),'hex'),'detach_link',v.executor_account_id,v.applicant_account_id,auth.uid());
  update public.service_request_invites set token=gen_random_uuid(),deleted_at=now(),delete_reason='detached_by_superadmin',applicant_account_id=null where id=v.id;
  return jsonb_build_object('ok',true);
end $$;

-- Pipeline batches are normally immutable. The administrative link-data reset
-- is the only server-side path allowed to archive a batch created by the link.
create or replace function public.prevent_pipeline_batch_deletion()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('app.pipeline_internal',true)='on' then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if exists(select 1 from public.batch_pipeline_stages stage where stage.batch_id=old.id) then
    if tg_op='DELETE' or (old.deleted_at is null and new.deleted_at is not null) then
      raise exception 'Партию с пайплайном нельзя удалить';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.admin_delete_service_request_invite_data(p_invite_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v public.service_request_invites%rowtype;
  v_has_request boolean;
  v_user uuid;
  v_request_count integer;
  v_batch_count integer;
  v_request_ids uuid[];
  v_batch_ids uuid[];
begin
  if not public.is_platform_superadmin() then raise exception 'Недостаточно прав'; end if;
  select * into v from public.service_request_invites where id=p_invite_id for update;
  if not found then raise exception 'Ссылка не найдена'; end if;
  select exists(select 1 from public.service_requests where invite_id=v.id and current_version>0) into v_has_request;
  select count(*) into v_request_count from public.service_requests where invite_id=v.id and deleted_at is null;
  select count(*) into v_batch_count from public.fulfillment_batches where source_request_id in(select id from public.service_requests where invite_id=v.id) and deleted_at is null;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_request_ids from public.service_requests where invite_id=v.id;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_batch_ids from public.fulfillment_batches where source_request_id=any(v_request_ids);
  select user_id into v_user from public.service_request_invite_reserves where invite_id=v.id limit 1;
  perform set_config('app.pipeline_internal','on',true);
  delete from public.batch_notifications where batch_id=any(v_batch_ids) or source_request_id=any(v_request_ids);
  delete from public.fulfillment_batch_documents where batch_id=any(v_batch_ids);
  delete from public.fulfillment_reception_history where batch_id=any(v_batch_ids);
  delete from public.fulfillment_stage_stock where batch_id=any(v_batch_ids);
  delete from public.fulfillment_stage_warehouse_history where batch_id=any(v_batch_ids);
  update public.fulfillment_batches set source_request_store_id=null where id=any(v_batch_ids);
  delete from public.service_request_stores where request_id=any(v_request_ids);
  delete from public.fulfillment_batches where id=any(v_batch_ids);
  delete from public.service_request_correction_drafts where request_id=any(v_request_ids);
  delete from public.service_request_events where request_id=any(v_request_ids);
  delete from public.service_request_versions where request_id=any(v_request_ids);
  delete from public.service_requests where id=any(v_request_ids);
  perform set_config('app.pipeline_internal','off',true);
  delete from public.service_request_invite_reserves where invite_id=v.id;
  insert into public.service_request_invite_admin_audit(invite_id,token_fingerprint,action,executor_account_id,applicant_account_id,actor_id,details)
  values(v.id,encode(extensions.digest(v.token::text,'sha256'),'hex'),'delete_link_data',v.executor_account_id,v.applicant_account_id,auth.uid(),jsonb_build_object('had_confirmed_request',v_has_request,'requests_deleted',v_request_count,'batches_deleted',v_batch_count,'auth_user_deleted',not v_has_request and v_user is not null));
  update public.service_request_invites set token=gen_random_uuid(),deleted_at=now(),delete_reason='data_deleted_by_superadmin',applicant_account_id=null where id=v.id;
  if not v_has_request and v_user is not null then delete from auth.users where id=v_user; end if;
  return jsonb_build_object('ok',true,'deleted_auth_user',not v_has_request and v_user is not null);
end $$;

create or replace function public.cleanup_expired_service_request_invite_reserves()
returns integer language plpgsql security definer set search_path=public as $$
declare n integer:=0; v record;
begin
  for v in
    delete from public.service_request_invite_reserves r where r.expires_at<=now()
    returning r.invite_id,r.user_id
  loop
    n:=n+1;
    insert into public.service_request_invite_admin_audit(invite_id,token_fingerprint,action,executor_account_id,actor_id,details)
    select i.id,encode(extensions.digest(i.token::text,'sha256'),'hex'),'expired_cleanup',i.executor_account_id,null,
      jsonb_build_object('reserved_user_id',v.user_id) from public.service_request_invites i where i.id=v.invite_id;
    if not exists(select 1 from public.account_members where user_id=v.user_id) then
      delete from auth.users where id=v.user_id;
    end if;
  end loop;
  update public.service_request_invites set deleted_at=coalesce(deleted_at,now()),delete_reason=coalesce(delete_reason,'expired') where applicant_account_id is null and initial_expires_at<=now();
  return n;
end $$;

do $$
declare v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname='cleanup-request-invite-reserves' loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule('cleanup-request-invite-reserves','17 3 * * *',
    'select public.cleanup_expired_service_request_invite_reserves()');
end $$;

-- New trials are manual and last 10 days. Existing trial_ends_at values are untouched.
insert into public.system_settings(key,value) values('trial_days_default','10') on conflict(key) do update set value='10';
create or replace function public.set_trial_on_account_create() returns trigger language plpgsql set search_path=public as $$
begin new.trial_ends_at:=null; return new; end $$;
create or replace function public.activate_my_trial(p_account_id uuid)
returns timestamptz language plpgsql security definer set search_path=public as $$
declare v_end timestamptz;
begin
  if not public.is_account_member(p_account_id) then raise exception 'Нет доступа'; end if;
  update public.accounts set trial_ends_at=now()+interval '10 days'
  where id=p_account_id and trial_ends_at is null and plan_until is null returning trial_ends_at into v_end;
  if v_end is null then raise exception 'Пробный период уже активирован или недоступен'; end if;
  return v_end;
end $$;

create or replace function public.get_customer_company_request_links(p_executor_account_id uuid)
returns table(customer_account_id uuid,token uuid)
language sql stable security definer set search_path=public as $$
  select distinct s.customer_account_id,i.token
  from public.stores s
  join public.service_request_invites i on i.applicant_account_id=s.customer_account_id
    and i.deleted_at is null and i.revoked_at is null
  where s.account_id=p_executor_account_id and s.deleted_at is null
    and public.is_account_member(p_executor_account_id)
$$;

create or replace function public.admin_preview_service_request_invite(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.is_platform_superadmin() then raise exception 'Недостаточно прав'; end if;
  select jsonb_build_object(
    'invite_id',i.id,'state',case when i.deleted_at is not null then 'deleted' when i.revoked_at is not null then 'replaced'
      when i.applicant_account_id is not null then 'bound' when r.invite_id is not null then 'reserved'
      when i.expires_at<=now() then 'expired' else 'active' end,
    'executor',jsonb_build_object('id',e.id,'short_id',e.short_id,'name',e.name),
    'applicant',case when a.id is null then null else jsonb_build_object('id',a.id,'short_id',a.short_id,'name',a.name) end,
    'reserve',case when r.invite_id is null then null else jsonb_build_object('email',r.email,'full_name',r.full_name,'draft',r.draft,'expires_at',r.expires_at) end,
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',sr.id,'short_id',sr.short_id,'status',sr.status,'title',sr.title,'current_version',sr.current_version) order by sr.created_at)
      from public.service_requests sr where sr.invite_id=i.id and sr.deleted_at is null),'[]'::jsonb)
  ) into v_result
  from public.service_request_invites i join public.accounts e on e.id=i.executor_account_id
  left join public.accounts a on a.id=i.applicant_account_id
  left join public.service_request_invite_reserves r on r.invite_id=i.id
  where i.token=p_token;
  if v_result is null then raise exception 'Ссылка не найдена'; end if;
  return v_result;
end $$;

-- Keep the mature request implementation intact, but put explicit request
-- permissions in front of every mutating entry point.
do $$ begin
  if to_regprocedure('public.create_service_request_draft_impl(uuid,uuid,text)') is null then alter function public.create_service_request_draft(uuid,uuid,text) rename to create_service_request_draft_impl; end if;
  if to_regprocedure('public.save_service_request_draft_impl(uuid,text,uuid,text,text,text,jsonb)') is null then alter function public.save_service_request_draft(uuid,text,uuid,text,text,text,jsonb) rename to save_service_request_draft_impl; end if;
  if to_regprocedure('public.submit_service_request_impl(uuid)') is null then alter function public.submit_service_request(uuid) rename to submit_service_request_impl; end if;
  if to_regprocedure('public.accept_service_request_impl(uuid)') is null then alter function public.accept_service_request(uuid) rename to accept_service_request_impl; end if;
  if to_regprocedure('public.reject_service_request_impl(uuid,text)') is null then alter function public.reject_service_request(uuid,text) rename to reject_service_request_impl; end if;
  if to_regprocedure('public.copy_service_request_impl(uuid)') is null then alter function public.copy_service_request(uuid) rename to copy_service_request_impl; end if;
end $$;

create or replace function public.create_service_request_draft(p_applicant_account_id uuid,p_executor_account_id uuid default null,p_title text default '')
returns public.service_requests language plpgsql security definer set search_path=public as $$
begin
  if not public.request_user_has_permission(p_applicant_account_id,'request_create') then raise exception 'Нет права создавать заявки'; end if;
  return public.create_service_request_draft_impl(p_applicant_account_id,p_executor_account_id,p_title);
end $$;

create or replace function public.save_service_request_draft(p_request_id uuid,p_title text,p_executor_account_id uuid,p_applicant_name text,p_applicant_email text,p_comment text,p_stores jsonb)
returns public.service_requests language plpgsql security definer set search_path=public as $$
declare v public.service_requests%rowtype;
begin
  select * into v from public.service_requests where id=p_request_id;
  if not found or not public.request_user_has_permission(v.applicant_account_id,'request_create') then raise exception 'Нет права редактировать заявку'; end if;
  return public.save_service_request_draft_impl(p_request_id,p_title,p_executor_account_id,p_applicant_name,p_applicant_email,p_comment,p_stores);
end $$;

create or replace function public.assign_service_request_responsible(p_request_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v public.service_requests%rowtype; v_name text;
begin
  select * into v from public.service_requests where id=p_request_id and deleted_at is null for update;
  if not found or v.executor_account_id is null then raise exception 'Заявка не найдена'; end if;
  if not public.request_user_has_permission(v.executor_account_id,'request_assign') then raise exception 'Нет права назначать ответственного'; end if;
  if p_user_id is not null and not exists(select 1 from public.account_members where account_id=v.executor_account_id and user_id=p_user_id) then raise exception 'Ответственный не состоит в компании-исполнителе'; end if;
  update public.service_requests set responsible_user_id=p_user_id,updated_at=now() where id=p_request_id;
  insert into public.service_request_events(request_id,event_type,details,actor_id)
  values(p_request_id,'responsible_assigned',jsonb_build_object('responsible_user_id',p_user_id),auth.uid());
  if p_user_id is not null then
    select coalesce(full_name,'Сотрудник') into v_name from public.profiles where user_id=p_user_id;
    insert into public.batch_notifications(account_id,recipient_user_id,type,title,body,source_request_id)
    values(v.executor_account_id,p_user_id,'request_assigned','Вам назначена заявка R-'||v.short_id,coalesce(v.title,''),p_request_id);
  end if;
  return true;
end $$;

create or replace function public.start_service_request_work(p_request_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v public.service_requests%rowtype;
begin
  select * into v from public.service_requests where id=p_request_id and deleted_at is null for update;
  if not found or v.executor_account_id is null then raise exception 'Заявка не найдена'; end if;
  if not public.request_user_has_permission(v.executor_account_id,'request_start_work') then raise exception 'Нет права начинать работу'; end if;
  if v.status<>'accepted' then raise exception 'Сначала примите заявку'; end if;
  update public.service_requests set work_started_at=coalesce(work_started_at,now()),updated_at=now() where id=p_request_id;
  update public.fulfillment_batches set request_acceptance_status='accepted',updated_at=now() where source_request_id=p_request_id and deleted_at is null;
  if v.work_started_at is null then insert into public.service_request_events(request_id,event_type,details,actor_id) values(p_request_id,'work_started','{}',auth.uid()); end if;
  return true;
end $$;

create or replace function public.submit_service_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account uuid; v_executor uuid; v_short bigint; v_result jsonb; v_user uuid;
begin
  select applicant_account_id,executor_account_id,short_id into v_account,v_executor,v_short from public.service_requests where id=p_request_id;
  if v_account is null or not public.request_user_has_permission(v_account,'request_create') then raise exception 'Нет права подтверждать заявку'; end if;
  v_result:=public.submit_service_request_impl(p_request_id);
  if v_executor is not null then
    for v_user in
      select distinct am.user_id from public.account_members am
      where am.account_id=v_executor and (
        am.role in ('owner','admin') or exists(select 1 from public.role_assignments ra join public.roles rr on rr.id=ra.role_id
          where ra.account_id=v_executor and ra.user_id=am.user_id and coalesce((rr.permissions->>'request_manage')::boolean,false)))
    loop
      insert into public.batch_notifications(account_id,type,title,body,recipient_user_id,source_request_id)
      values(v_executor,'service_request_submitted','Новая заявка R-'||v_short,'Заявка подтверждена и ожидает разбора.',v_user,p_request_id);
    end loop;
  end if;
  return v_result;
end $$;

create or replace function public.accept_service_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account uuid;
begin
  select executor_account_id into v_account from public.service_requests where id=p_request_id;
  if v_account is null or not public.request_user_has_permission(v_account,'request_manage') then raise exception 'Нет права принимать заявку'; end if;
  return public.accept_service_request_impl(p_request_id);
end $$;

create or replace function public.reject_service_request(p_request_id uuid,p_comment text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account uuid;
begin
  select executor_account_id into v_account from public.service_requests where id=p_request_id;
  if v_account is null or not public.request_user_has_permission(v_account,'request_manage') then raise exception 'Нет права отклонять заявку'; end if;
  return public.reject_service_request_impl(p_request_id,p_comment);
end $$;

create or replace function public.copy_service_request(p_request_id uuid)
returns public.service_requests language plpgsql security definer set search_path=public as $$
declare v_account uuid;
begin
  select applicant_account_id into v_account from public.service_requests where id=p_request_id;
  if v_account is null or not public.request_user_has_permission(v_account,'request_create') then raise exception 'Нет права копировать заявку'; end if;
  return public.copy_service_request_impl(p_request_id);
end $$;

revoke all on function public.create_service_request_draft_impl(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.save_service_request_draft_impl(uuid,text,uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.submit_service_request_impl(uuid) from public,anon,authenticated;
revoke all on function public.accept_service_request_impl(uuid) from public,anon,authenticated;
revoke all on function public.reject_service_request_impl(uuid,text) from public,anon,authenticated;
revoke all on function public.copy_service_request_impl(uuid) from public,anon,authenticated;
grant execute on function public.create_service_request_draft(uuid,uuid,text) to authenticated;
grant execute on function public.save_service_request_draft(uuid,text,uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.submit_service_request(uuid) to authenticated;
grant execute on function public.accept_service_request(uuid) to authenticated;
grant execute on function public.reject_service_request(uuid,text) to authenticated;
grant execute on function public.copy_service_request(uuid) to authenticated;
revoke all on function public.assign_service_request_responsible(uuid,uuid) from public,anon,authenticated;
revoke all on function public.start_service_request_work(uuid) from public,anon,authenticated;
grant execute on function public.assign_service_request_responsible(uuid,uuid) to authenticated;
grant execute on function public.start_service_request_work(uuid) to authenticated;

drop policy if exists service_requests_select on public.service_requests;
create policy service_requests_select on public.service_requests for select using (
  deleted_at is null and (
    public.request_user_has_permission(applicant_account_id,'request_view')
    or public.request_user_has_permission(executor_account_id,'request_view')
  )
);
drop policy if exists request_stores_select on public.service_request_stores;
create policy request_stores_select on public.service_request_stores for select using (
  public.service_request_stores.deleted_at is null and exists(select 1 from public.service_requests r where r.id=request_id and r.deleted_at is null and (
    public.request_user_has_permission(r.applicant_account_id,'request_view')
    or public.request_user_has_permission(r.executor_account_id,'request_view')))
);
drop policy if exists request_versions_select on public.service_request_versions;
create policy request_versions_select on public.service_request_versions for select using (
  exists(select 1 from public.service_requests r where r.id=request_id and r.deleted_at is null and (
    public.request_user_has_permission(r.applicant_account_id,'request_history_view')
    or public.request_user_has_permission(r.executor_account_id,'request_history_view')))
);
drop policy if exists request_events_select on public.service_request_events;
create policy request_events_select on public.service_request_events for select using (
  exists(select 1 from public.service_requests r where r.id=request_id and r.deleted_at is null and (
    public.request_user_has_permission(r.applicant_account_id,'request_history_view')
    or public.request_user_has_permission(r.executor_account_id,'request_history_view')))
);
drop policy if exists request_correction_drafts_applicant on public.service_request_correction_drafts;
create policy request_correction_drafts_applicant on public.service_request_correction_drafts for select using (
  exists(select 1 from public.service_requests r where r.id=request_id and r.deleted_at is null
    and public.request_user_has_permission(r.applicant_account_id,'request_create'))
);
drop policy if exists batch_documents_select on public.fulfillment_batch_documents;
create policy batch_documents_select on public.fulfillment_batch_documents for select using (
  exists(select 1 from public.fulfillment_batches b where b.id=batch_id and b.deleted_at is null and (
    public.request_user_has_permission(b.account_id,'fulfillment_view')
    or public.request_user_has_permission(b.operator_account_id,'fulfillment_view')))
);

alter table public.batch_notifications add column if not exists recipient_user_id uuid references auth.users(id) on delete cascade;
create index if not exists batch_notifications_recipient_idx on public.batch_notifications(recipient_user_id,is_read,created_at desc);
drop policy if exists bn_select on public.batch_notifications;
drop policy if exists "bn_select" on public.batch_notifications;
create policy bn_select on public.batch_notifications for select using (
  account_id in(select account_id from public.account_members where user_id=auth.uid())
  and (recipient_user_id is null or recipient_user_id=auth.uid())
);
drop policy if exists bn_update on public.batch_notifications;
drop policy if exists "bn_update" on public.batch_notifications;
create policy bn_update on public.batch_notifications for update using (
  account_id in(select account_id from public.account_members where user_id=auth.uid())
  and (recipient_user_id is null or recipient_user_id=auth.uid())
);

revoke all on function public.get_service_request_invite(uuid) from public,anon,authenticated;
grant execute on function public.get_service_request_invite(uuid) to anon,authenticated;
revoke all on function public.reserve_service_request_invite(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_service_request_invite(uuid,text,text) to authenticated;
revoke all on function public.save_service_request_invite_reserve(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_service_request_invite_reserve(uuid,jsonb) to authenticated;
revoke all on function public.replace_service_request_invite_reserve(uuid) from public,anon,authenticated;
grant execute on function public.replace_service_request_invite_reserve(uuid) to authenticated;
revoke all on function public.account_has_active_request_invite(uuid) from public,anon,authenticated;
grant execute on function public.account_has_active_request_invite(uuid) to authenticated;
revoke all on function public.submit_service_request_invite_reserve(uuid,text,text,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.submit_service_request_invite_reserve(uuid,text,text,text,text,text,jsonb,uuid) to authenticated;
revoke all on function public.claim_service_request_invite(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_service_request_invite(uuid,uuid,boolean) to authenticated;
revoke all on function public.admin_list_service_request_invites() from public,anon,authenticated;
grant execute on function public.admin_list_service_request_invites() to authenticated;
revoke all on function public.admin_detach_service_request_invite(uuid) from public,anon,authenticated;
grant execute on function public.admin_detach_service_request_invite(uuid) to authenticated;
revoke all on function public.admin_delete_service_request_invite_data(uuid) from public,anon,authenticated;
grant execute on function public.admin_delete_service_request_invite_data(uuid) to authenticated;
revoke all on function public.activate_my_trial(uuid) from public,anon,authenticated;
grant execute on function public.activate_my_trial(uuid) to authenticated;
revoke all on function public.get_customer_company_request_links(uuid) from public,anon,authenticated;
grant execute on function public.get_customer_company_request_links(uuid) to authenticated;
revoke all on function public.admin_preview_service_request_invite(uuid) from public,anon,authenticated;
grant execute on function public.admin_preview_service_request_invite(uuid) to authenticated;
revoke all on function public.request_invite_user_can_bind(uuid) from public,anon,authenticated;
grant execute on function public.request_invite_user_can_bind(uuid) to service_role;
revoke all on function public.request_invite_user_can_view(uuid) from public,anon,authenticated;
grant execute on function public.request_invite_user_can_view(uuid) to service_role;
revoke all on function public.list_request_invite_bindable_accounts() from public,anon,authenticated;
grant execute on function public.list_request_invite_bindable_accounts() to authenticated;
revoke all on function public.request_user_has_permission(uuid,text) from public,anon,authenticated;
grant execute on function public.request_user_has_permission(uuid,text) to service_role;
