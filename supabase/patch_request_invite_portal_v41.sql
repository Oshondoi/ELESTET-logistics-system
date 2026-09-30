-- Request creation and invite ownership corrections. Safe to rerun.
-- Discussion public-request-invite-auth-20260926, revision 63.

create or replace function public.create_service_request_from_form(
  p_applicant_account_id uuid,
  p_executor_account_id uuid,
  p_title text default '',
  p_applicant_name text default '',
  p_applicant_email text default '',
  p_comment text default '',
  p_invite_token uuid default null
) returns public.service_requests
language plpgsql security definer set search_path=public as $$
declare
  v_request public.service_requests%rowtype;
  v_invite public.service_request_invites%rowtype;
  v_auth_email text;
begin
  if not public.request_user_has_permission(p_applicant_account_id,'request_create') then
    raise exception 'Нет права создавать заявки';
  end if;
  if p_executor_account_id is null or not exists(
    select 1 from public.accounts where id=p_executor_account_id and deleted_at is null
  ) then raise exception 'Выберите действующую компанию-исполнителя'; end if;
  select lower(email) into v_auth_email from auth.users where id=auth.uid();
  if p_applicant_email is not null and nullif(btrim(p_applicant_email),'') is not null
     and lower(btrim(p_applicant_email)) is distinct from v_auth_email then
    raise exception 'Почта заявителя должна совпадать с почтой аккаунта';
  end if;
  if p_invite_token is not null then
    select * into v_invite from public.service_request_invites where token=p_invite_token for update;
    if not found or v_invite.deleted_at is not null or v_invite.revoked_at is not null
       or v_invite.expires_at<=now() or v_invite.applicant_account_id is distinct from p_applicant_account_id then
      raise exception 'Клиентская ссылка недоступна';
    end if;
  end if;
  insert into public.service_requests(
    applicant_account_id,applicant_company_short_id,applicant_company_name,
    executor_account_id,executor_company_short_id,executor_company_name,
    invite_id,title,applicant_name,applicant_email,comment
  )
  select applicant.id,applicant.short_id,applicant.name,
    executor.id,executor.short_id,executor.name,
    v_invite.id,coalesce(p_title,''),nullif(btrim(p_applicant_name),''),
    coalesce(v_auth_email,nullif(lower(btrim(p_applicant_email)),'')),nullif(btrim(p_comment),'')
  from public.accounts applicant,public.accounts executor
  where applicant.id=p_applicant_account_id and executor.id=p_executor_account_id
  returning * into v_request;
  return v_request;
end $$;

revoke all on function public.create_service_request_from_form(uuid,uuid,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_service_request_from_form(uuid,uuid,text,text,text,text,uuid) to authenticated;

create or replace function public.list_recent_request_executors(p_applicant_account_id uuid)
returns table(id uuid,short_id integer,name text)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.request_user_has_permission(p_applicant_account_id,'request_create') then
    raise exception 'Нет права просматривать исполнителей';
  end if;
  return query
  select a.id,a.short_id,a.name
  from public.accounts a
  join (
    select r.executor_account_id,max(r.submitted_at) last_submitted
    from public.service_requests r
    where r.applicant_account_id=p_applicant_account_id
      and r.current_version>0 and r.executor_account_id is not null
    group by r.executor_account_id
  ) recent on recent.executor_account_id=a.id
  where a.deleted_at is null
  order by recent.last_submitted desc nulls last
  limit 20;
end $$;

revoke all on function public.list_recent_request_executors(uuid) from public,anon,authenticated;
grant execute on function public.list_recent_request_executors(uuid) to authenticated;

create or replace function public.remove_service_requests(p_request_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_request public.service_requests%rowtype;
  v_deleted integer:=0;
  v_cancelled integer:=0;
  v_version integer;
begin
  if p_request_ids is null or cardinality(p_request_ids)=0 then
    return jsonb_build_object('deleted',0,'cancelled',0);
  end if;
  if cardinality(p_request_ids)>100 then raise exception 'За один раз можно выбрать не более 100 заявок'; end if;
  for v_request in
    select * from public.service_requests where id=any(p_request_ids) order by id for update
  loop
    if not public.request_user_has_permission(v_request.applicant_account_id,'request_create') then
      raise exception 'Нет права удалить заявку R-%',v_request.short_id;
    end if;
    if v_request.current_version=0 then
      if exists(select 1 from public.fulfillment_batches where source_request_id=v_request.id) then
        raise exception 'У черновика R-% уже есть партия; автоматическое удаление запрещено',v_request.short_id;
      end if;
      delete from public.service_request_correction_drafts where request_id=v_request.id;
      delete from public.service_request_events where request_id=v_request.id;
      delete from public.service_request_versions where request_id=v_request.id;
      delete from public.service_request_stores where request_id=v_request.id;
      delete from public.service_requests where id=v_request.id;
      v_deleted:=v_deleted+1;
    elsif v_request.status<>'cancelled' then
      v_version:=v_request.current_version+1;
      update public.service_requests set status='cancelled',current_version=v_version,updated_at=now()
      where id=v_request.id;
      update public.fulfillment_batches set status='cancelled',updated_at=now()
      where source_request_id=v_request.id and deleted_at is null;
      insert into public.service_request_versions(request_id,version,event_type,snapshot,confirmed_by)
      values(v_request.id,v_version,'cancelled',public.request_snapshot(v_request.id),auth.uid());
      insert into public.service_request_events(request_id,event_type,details,actor_id)
      values(v_request.id,'cancelled',jsonb_build_object('reason','Отменено заказчиком'),auth.uid());
      v_cancelled:=v_cancelled+1;
    end if;
  end loop;
  if (select count(distinct selected.id) from unnest(p_request_ids) as selected(id)) <>
     (select count(*) from public.service_requests where id=any(p_request_ids)) + v_deleted then
    raise exception 'Некоторые выбранные заявки не найдены';
  end if;
  return jsonb_build_object('deleted',v_deleted,'cancelled',v_cancelled);
end $$;

revoke all on function public.remove_service_requests(uuid[]) from public,anon,authenticated;
grant execute on function public.remove_service_requests(uuid[]) to authenticated;

-- A draft is private to the applicant until it has been confirmed and sent.
drop policy if exists service_requests_select on public.service_requests;
create policy service_requests_select on public.service_requests for select using (
  deleted_at is null and (
    public.request_user_has_permission(applicant_account_id,'request_view')
    or (current_version>0 and public.request_user_has_permission(executor_account_id,'request_view'))
  )
);
drop policy if exists request_stores_select on public.service_request_stores;
create policy request_stores_select on public.service_request_stores for select using (
  public.service_request_stores.deleted_at is null and exists(
    select 1 from public.service_requests r where r.id=request_id and r.deleted_at is null and (
      public.request_user_has_permission(r.applicant_account_id,'request_view')
      or (r.current_version>0 and public.request_user_has_permission(r.executor_account_id,'request_view'))
    )
  )
);

-- Never accept a client-supplied email as proof of ownership or reassign a reserve.
alter table public.service_request_invite_reserves
  drop constraint if exists service_request_invite_reserves_email_key;
create index if not exists service_request_invite_reserves_email_idx
  on public.service_request_invite_reserves(email);

create or replace function public.request_invite_recent_email_otp()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) method
    where method->>'method' in ('otp','email/signup')
      and (method->>'timestamp')::bigint >= extract(epoch from now()-interval '10 minutes')::bigint
  )
$$;

create or replace function public.reserve_service_request_invite(p_token uuid,p_full_name text,p_email text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_invite public.service_request_invites%rowtype;
  v_reserve public.service_request_invite_reserves%rowtype;
  v_other uuid;
  v_other_token uuid;
  v_email text;
begin
  if auth.uid() is null then raise exception 'Сначала подтвердите почту'; end if;
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null or v_email is distinct from lower(btrim(p_email)) then
    raise exception 'Подтверждённая почта не совпадает с почтой аккаунта';
  end if;
  select * into v_invite from public.service_request_invites where token=p_token for update;
  if not found or v_invite.deleted_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at<=now() then raise exception 'Ссылка недействительна или истекла'; end if;
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
end $$;

create or replace function public.replace_service_request_invite_reserve(p_token uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_new public.service_request_invites%rowtype;
  v_old public.service_request_invites%rowtype;
  v_reserve public.service_request_invite_reserves%rowtype;
begin
  if auth.uid() is null or not public.request_invite_recent_email_otp() then
    raise exception 'Подтвердите перенос кодом из почты';
  end if;
  select * into v_new from public.service_request_invites where token=p_token for update;
  if not found or v_new.deleted_at is not null or v_new.revoked_at is not null
     or v_new.expires_at<=now() then raise exception 'Новая ссылка недействительна'; end if;
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
end $$;

create or replace function public.claim_service_request_invite(
  p_token uuid,p_applicant_account_id uuid default null,p_replace_existing boolean default false
) returns table(id uuid,short_id integer,name text,applicant_account_id uuid,invite_id uuid)
language plpgsql security definer set search_path=public as $$
declare
  v_i public.service_request_invites%rowtype;
  v_old public.service_request_invites%rowtype;
  v_account uuid:=p_applicant_account_id;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Сначала войдите'; end if;
  select * into v_i from public.service_request_invites where token=p_token for update;
  if not found or v_i.deleted_at is not null or v_i.revoked_at is not null
     or v_i.expires_at<=now() then raise exception 'Ссылка недействительна или истекла'; end if;
  if exists(select 1 from public.service_request_invite_reserves
            where invite_id=v_i.id and user_id<>auth.uid()) then
    raise exception 'Ссылка уже закреплена за другим пользователем';
  end if;
  if v_i.applicant_account_id is not null then
    if not public.request_invite_user_can_view(v_i.applicant_account_id) then
      raise exception 'У вас нет доступа к данным текущей ссылки';
    end if;
    v_account:=v_i.applicant_account_id;
  else
    if v_account is null then
      select count(*),min(am.account_id) into v_count,v_account
      from public.account_members am where am.user_id=auth.uid();
      if v_count>1 then raise exception 'Выберите компанию-заявителя'; end if;
    end if;
    if v_account is not null and not public.request_invite_user_can_bind(v_account) then
      raise exception 'Нужны права на заявки и управление партиями выбранной компании';
    end if;
    if v_account is not null then
      update public.service_request_invites
      set deleted_at=now(),delete_reason='expired'
      where applicant_account_id=v_account and id<>v_i.id and expires_at<=now()
        and deleted_at is null and revoked_at is null;
      select * into v_old from public.service_request_invites
      where applicant_account_id=v_account and id<>v_i.id
        and deleted_at is null and revoked_at is null for update;
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
        update public.service_request_invites
        set token=gen_random_uuid(),revoked_at=now(),deleted_at=now(),
            delete_reason='replaced_by_applicant',applicant_account_id=null
        where id=v_old.id;
      end if;
      update public.service_request_invites
      set applicant_account_id=v_account,bound_at=now() where id=v_i.id;
    end if;
  end if;
  update public.service_request_invites
  set claimed_by=auth.uid(),claimed_at=coalesce(claimed_at,now()),last_used_at=now()
  where id=v_i.id;
  return query select a.id,a.short_id,a.name,v_account,v_i.id
  from public.accounts a where a.id=v_i.executor_account_id;
end $$;

create or replace function public.get_service_request_invite(p_token uuid)
returns table(
  invite_id uuid,executor_account_id uuid,executor_short_id integer,executor_name text,
  applicant_account_id uuid,applicant_short_id integer,applicant_name text,
  expires_at timestamptz,is_available boolean,state text,unavailable_reason text,
  reserved_email text,reserved_name text,email_confirmed boolean,reserve_draft jsonb
) language sql stable security definer set search_path=public as $$
  select i.id,i.executor_account_id,e.short_id,e.name,
    i.applicant_account_id,a.short_id,a.name,i.expires_at,
    i.deleted_at is null and i.revoked_at is null and i.expires_at>now(),
    case when i.delete_reason='expired' then 'expired'
         when i.deleted_at is not null then 'deleted'
         when i.revoked_at is not null then 'replaced'
         when i.expires_at<=now() then 'expired'
         when i.expires_at='infinity'::timestamptz then 'bound'
         when r.invite_id is not null then 'reserved' else 'active' end,
    case when i.delete_reason='expired' then 'Срок действия ссылки истёк'
         when i.deleted_at is not null then 'Ссылка удалена'
         when i.revoked_at is not null then 'Ссылка недействительна'
         when i.expires_at<=now() then 'Срок действия ссылки истёк' end,
    coalesce(r.email,owner_user.email::text),
    coalesce(r.full_name,owner_profile.full_name),
    coalesce(u.email_confirmed_at,owner_user.email_confirmed_at) is not null,
    case when r.user_id=auth.uid() then r.draft end
  from public.service_request_invites i
  join public.accounts e on e.id=i.executor_account_id
  left join public.accounts a on a.id=i.applicant_account_id
  left join public.service_request_invite_reserves r on r.invite_id=i.id
  left join auth.users u on u.id=r.user_id
  left join lateral (
    select am.user_id from public.account_members am
    where am.account_id=i.applicant_account_id and am.role='owner'
    order by am.created_at limit 1
  ) owner_member on true
  left join auth.users owner_user on owner_user.id=owner_member.user_id
  left join public.profiles owner_profile on owner_profile.user_id=owner_member.user_id
  where i.token=p_token
$$;

create or replace function public.bind_confirmed_request_invite()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.current_version=0 and new.current_version>0 and new.invite_id is not null then
    update public.service_request_invites
    set applicant_account_id=new.applicant_account_id,
        bound_at=coalesce(bound_at,now()),expires_at='infinity'
    where id=new.invite_id and deleted_at is null and revoked_at is null
      and expires_at>now();
  end if;
  return new;
end $$;
drop trigger if exists bind_confirmed_request_invite_trigger on public.service_requests;
create trigger bind_confirmed_request_invite_trigger
after update of current_version on public.service_requests
for each row execute function public.bind_confirmed_request_invite();

-- Every unconfirmed R has a durable, separate server work area. The lease is
-- per device, not per browser tab; it expires two minutes after last activity.
create table if not exists public.service_request_work_drafts (
  request_id uuid primary key references public.service_requests(id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  lease_device uuid,
  lease_last_seen timestamptz,
  saved_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.service_request_work_drafts enable row level security;
drop policy if exists service_request_work_drafts_select on public.service_request_work_drafts;
create policy service_request_work_drafts_select on public.service_request_work_drafts
for select using (exists(
  select 1 from public.service_requests r where r.id=request_id and r.deleted_at is null
    and public.request_user_has_permission(r.applicant_account_id,'request_create')
));

create or replace function public.open_service_request_work_draft(p_request_id uuid,p_device_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request public.service_requests%rowtype; v_draft public.service_request_work_drafts%rowtype;
begin
  if p_device_id is null then raise exception 'Неизвестное устройство'; end if;
  select * into v_request from public.service_requests where id=p_request_id and deleted_at is null for update;
  if not found or v_request.status<>'draft' or
     not public.request_user_has_permission(v_request.applicant_account_id,'request_create') then
    raise exception 'Черновик заявки недоступен';
  end if;
  insert into public.service_request_work_drafts(request_id) values(p_request_id)
  on conflict(request_id) do nothing;
  select * into v_draft from public.service_request_work_drafts where request_id=p_request_id for update;
  if v_draft.lease_device is not null and v_draft.lease_device<>p_device_id
     and v_draft.lease_last_seen>now()-interval '2 minutes' then
    raise exception 'Черновик сейчас открыт на другом устройстве';
  end if;
  update public.service_request_work_drafts
  set lease_device=p_device_id,lease_last_seen=now() where request_id=p_request_id;
  return v_draft.draft;
end $$;

create or replace function public.heartbeat_service_request_work_draft(p_request_id uuid,p_device_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.service_request_work_drafts d set lease_last_seen=now()
  from public.service_requests r
  where d.request_id=p_request_id and r.id=d.request_id and r.status='draft'
    and d.lease_device=p_device_id
    and public.request_user_has_permission(r.applicant_account_id,'request_create');
  return found;
end $$;

create or replace function public.save_service_request_work_draft(
  p_request_id uuid,p_device_id uuid,p_draft jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request public.service_requests%rowtype;
begin
  select * into v_request from public.service_requests where id=p_request_id and deleted_at is null;
  if not found or v_request.status<>'draft' or
     not public.request_user_has_permission(v_request.applicant_account_id,'request_create') then
    raise exception 'Черновик заявки недоступен';
  end if;
  if jsonb_typeof(coalesce(p_draft,'{}'::jsonb))<>'object' then
    raise exception 'Некорректные данные черновика';
  end if;
  update public.service_request_work_drafts
  set draft=p_draft,lease_last_seen=now(),saved_by=auth.uid(),updated_at=now()
  where request_id=p_request_id and lease_device=p_device_id
    and lease_last_seen>now()-interval '2 minutes';
  if not found then raise exception 'Право записи черновика истекло; откройте заявку заново'; end if;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.open_service_request_work_draft(uuid,uuid) from public,anon,authenticated;
revoke all on function public.heartbeat_service_request_work_draft(uuid,uuid) from public,anon,authenticated;
revoke all on function public.save_service_request_work_draft(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.open_service_request_work_draft(uuid,uuid) to authenticated;
grant execute on function public.heartbeat_service_request_work_draft(uuid,uuid) to authenticated;
grant execute on function public.save_service_request_work_draft(uuid,uuid,jsonb) to authenticated;

-- The published R and its P branches are written together, only at explicit
-- final confirmation. Earlier saves never reach the canonical store rows.
create or replace function public.validate_service_request_intake(
  p_payload jsonb,p_intake_mode text
) returns boolean language plpgsql immutable set search_path=public as $$
declare
  v_items jsonb:=p_payload->'items';
  v_supplies jsonb:=p_payload->'supplies';
  v_supply jsonb;
  v_box jsonb;
  v_item jsonb;
  v_box_item jsonb;
  v_packed integer;
begin
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items)=0 then
    raise exception 'Добавьте товары с положительным количеством';
  end if;
  for v_item in select value from jsonb_array_elements(v_items) loop
    if coalesce((v_item->>'qty')::integer,0)<1 or
       (nullif(btrim(v_item->>'barcode'),'') is null and
        nullif(btrim(v_item->>'name'),'') is null) then
      raise exception 'У каждого товара нужны название или баркод и положительное количество';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(v_items) item
            where nullif(btrim(item->>'barcode'),'') is not null
            group by item->>'barcode' having count(*)>1) then
    raise exception 'Объедините повторяющиеся баркоды в одну строку';
  end if;
  if p_intake_mode<>'boxes' then return true; end if;
  if jsonb_typeof(v_supplies) is distinct from 'array' or jsonb_array_length(v_supplies)=0 then
    raise exception 'Добавьте непустую поставку для готовых коробов';
  end if;
  for v_supply in select value from jsonb_array_elements(v_supplies) loop
    if nullif(btrim(v_supply->>'warehouse_name'),'') is null or
       jsonb_typeof(v_supply->'boxes') is distinct from 'array' or
       jsonb_array_length(v_supply->'boxes')=0 then
      raise exception 'У каждой поставки должны быть склад и короба';
    end if;
    for v_box in select value from jsonb_array_elements(v_supply->'boxes') loop
      if jsonb_typeof(v_box->'items') is distinct from 'array' or
         jsonb_array_length(v_box->'items')=0 then
        raise exception 'Пустой короб нельзя подтвердить';
      end if;
      for v_box_item in select value from jsonb_array_elements(v_box->'items') loop
        if nullif(btrim(v_box_item->>'barcode'),'') is null or
           coalesce((v_box_item->>'qty')::integer,0)<1 or
           not exists(select 1 from jsonb_array_elements(v_items) item
                      where item->>'barcode'=v_box_item->>'barcode') then
          raise exception 'У каждого товара в коробе нужен баркод, положительное количество и строка в заявке';
        end if;
      end loop;
    end loop;
  end loop;
  for v_item in select value from jsonb_array_elements(v_items) loop
    if nullif(btrim(v_item->>'barcode'),'') is null then
      raise exception 'Для распределения по коробам каждому товару нужен баркод';
    end if;
    select coalesce(sum((box_item->>'qty')::integer),0) into v_packed
    from jsonb_array_elements(v_supplies) supply
    cross join lateral jsonb_array_elements(supply->'boxes') box
    cross join lateral jsonb_array_elements(box->'items') box_item
    where box_item->>'barcode'=v_item->>'barcode';
    if v_packed<>(v_item->>'qty')::integer then
      raise exception 'Количество товара % в коробах (%) не совпадает с заявкой (%)',
        v_item->>'barcode',v_packed,v_item->>'qty';
    end if;
  end loop;
  return true;
end $$;

alter table public.fulfillment_supplies
  add column if not exists source_request_store_id uuid references public.service_request_stores(id) on delete set null,
  add column if not exists source_request_supply_key uuid,
  add column if not exists source_request_supply_payload jsonb;
alter table public.fulfillment_boxes
  add column if not exists source_request_box_key uuid;
create table if not exists public.service_request_supply_archives(
  id uuid primary key default gen_random_uuid(),
  request_store_id uuid not null references public.service_request_stores(id) on delete cascade,
  request_version integer not null,
  snapshot jsonb not null,
  archived_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz not null default now()
);
alter table public.service_request_supply_archives enable row level security;
drop policy if exists service_request_supply_archives_select on public.service_request_supply_archives;
create policy service_request_supply_archives_select on public.service_request_supply_archives
for select using(exists(
  select 1 from public.service_request_stores rs
  join public.service_requests r on r.id=rs.request_id
  where rs.id=request_store_id and (
    public.request_user_has_permission(r.applicant_account_id,'request_create') or
    public.is_account_member(r.executor_account_id)
  )
));

create or replace function public.sync_service_request_supplies(
  p_request_store_id uuid,p_batch_id uuid,p_stage_id uuid,
  p_payload jsonb,p_previous_version integer
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_batch public.fulfillment_batches%rowtype;
  v_supply jsonb;
  v_box jsonb;
  v_box_item jsonb;
  v_supply_id uuid;
  v_box_id uuid;
  v_item_id uuid;
  v_item_name text;
  v_box_number integer;
  v_old_snapshot jsonb;
  v_new_supplies jsonb:=coalesce(p_payload->'supplies','[]'::jsonb);
begin
  select * into v_batch from public.fulfillment_batches where id=p_batch_id for update;
  if not found then raise exception 'Партия для поставки не найдена'; end if;
  if jsonb_typeof(v_new_supplies) is distinct from 'array' then
    raise exception 'Некорректные поставки заявки';
  end if;
  if exists(select 1 from public.fulfillment_supplies s
            where s.source_request_store_id=p_request_store_id and s.pipeline_stage_id=p_stage_id) then
    if (select coalesce(jsonb_agg(s.source_request_supply_payload order by s.created_at,s.id),'[]'::jsonb)
        from public.fulfillment_supplies s
        where s.source_request_store_id=p_request_store_id and s.pipeline_stage_id=p_stage_id)=v_new_supplies then
      return;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'supply',to_jsonb(s),
      'boxes',coalesce((select jsonb_agg(jsonb_build_object(
        'box',to_jsonb(b),
        'items',coalesce((select jsonb_agg(to_jsonb(bi)) from public.fulfillment_box_items bi where bi.box_id=b.id),'[]'::jsonb),
        'kiz',coalesce((select jsonb_agg(to_jsonb(k)) from public.fulfillment_kiz_pairs k where k.box_id=b.id),'[]'::jsonb)
      ) order by b.box_number) from public.fulfillment_boxes b where b.supply_id=s.id),'[]'::jsonb)
    ) order by s.created_at,s.id),'[]'::jsonb) into v_old_snapshot
    from public.fulfillment_supplies s
    where s.source_request_store_id=p_request_store_id and s.pipeline_stage_id=p_stage_id;
    insert into public.service_request_supply_archives(request_store_id,request_version,snapshot,archived_by)
    values(p_request_store_id,p_previous_version,v_old_snapshot,auth.uid());
    delete from public.fulfillment_supplies
    where source_request_store_id=p_request_store_id and pipeline_stage_id=p_stage_id;
  end if;
  for v_supply in select value from jsonb_array_elements(v_new_supplies) loop
    insert into public.fulfillment_supplies(
      batch_id,account_id,pipeline_stage_id,warehouse_name,created_by,
      source_request_store_id,source_request_supply_key,source_request_supply_payload
    ) values(
      p_batch_id,v_batch.account_id,p_stage_id,btrim(v_supply->>'warehouse_name'),auth.uid(),
      p_request_store_id,(v_supply->>'key')::uuid,v_supply
    ) returning id into v_supply_id;
    v_box_number:=0;
    for v_box in select value from jsonb_array_elements(v_supply->'boxes') loop
      v_box_number:=v_box_number+1;
      insert into public.fulfillment_boxes(
        supply_id,account_id,box_number,status,source_request_box_key
      ) values(
        v_supply_id,v_batch.account_id,v_box_number,'open',(v_box->>'key')::uuid
      ) returning id into v_box_id;
      for v_box_item in select value from jsonb_array_elements(v_box->'items') loop
        select id,product_name into v_item_id,v_item_name from public.fulfillment_items
        where batch_id=p_batch_id and pipeline_stage_id=p_stage_id
          and barcode=v_box_item->>'barcode' and not is_excluded
        order by created_at limit 1;
        if v_item_id is null then raise exception 'Товар короба не найден в партии'; end if;
        insert into public.fulfillment_box_items(box_id,account_id,barcode,item_id,product_name,qty)
        values(v_box_id,v_batch.account_id,v_box_item->>'barcode',v_item_id,v_item_name,
          (v_box_item->>'qty')::integer);
      end loop;
    end loop;
  end loop;
end $$;

do $$ begin
  if to_regprocedure('public.submit_service_request_v40(uuid)') is null then
    alter function public.submit_service_request(uuid) rename to submit_service_request_v40;
  end if;
end $$;
create or replace function public.submit_service_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_request public.service_requests%rowtype;
  v_draft jsonb;
  v_result jsonb;
  v_batch record;
  v_stage_id uuid;
  v_self boolean;
begin
  select * into v_request from public.service_requests where id=p_request_id and deleted_at is null for update;
  if not found or not public.request_user_has_permission(v_request.applicant_account_id,'request_create') then
    raise exception 'Заявка недоступна';
  end if;
  if v_request.status='draft' and exists(
    select 1 from public.service_request_work_drafts d
    where d.request_id=p_request_id and d.lease_device is not null
      and d.lease_last_seen>now()-interval '2 minutes'
  ) and current_setting('app.request_work_lease_verified',true) is distinct from 'on' then
    raise exception 'Черновик открыт в новом интерфейсе; обновите страницу';
  end if;
  if v_request.status in ('submitted','accepted') then
    return public.publish_service_request_correction(p_request_id);
  end if;
  if v_request.status='draft' then
    select draft into v_draft from public.service_request_work_drafts where request_id=p_request_id;
    if v_draft is not null and v_draft<>'{}'::jsonb then
      perform public.save_service_request_draft_impl(
        p_request_id,coalesce(v_draft->>'title',''),
        coalesce((v_draft->>'executorAccountId')::uuid,v_request.executor_account_id),
        coalesce(v_draft->>'applicantName',v_request.applicant_name,''),
        coalesce(v_draft->>'applicantEmail',v_request.applicant_email,''),
        coalesce(v_draft->>'comment',''),coalesce(v_draft->'stores','[]'::jsonb)
      );
    end if;
    if not exists(select 1 from public.service_request_stores
                  where request_id=p_request_id and deleted_at is null) then
      raise exception 'Добавьте хотя бы один магазин';
    end if;
    perform public.validate_service_request_intake(store.payload,store.intake_mode)
    from public.service_request_stores store
    where store.request_id=p_request_id and store.deleted_at is null;
  end if;
  v_result:=public.submit_service_request_v40(p_request_id);
  if v_request.status='draft' then
    select * into v_request from public.service_requests where id=p_request_id;
    delete from public.service_request_work_drafts where request_id=p_request_id;
    v_self:=v_request.applicant_account_id=v_request.executor_account_id;
    for v_batch in
      select b.id,b.account_id,b.stage_otk,b.stage_packaging,b.stage_marking,
        b.stage_packing,b.stage_logistics,rs.id as request_store_id,rs.intake_mode,rs.payload
      from public.fulfillment_batches b
      join public.service_request_stores rs on rs.id=b.source_request_store_id
      where b.source_request_id=p_request_id and b.deleted_at is null
    loop
      if not exists(select 1 from public.batch_pipeline_stages where batch_id=v_batch.id) then
        insert into public.batch_pipeline_stages(
          batch_id,owner_account_id,partner_account_id,order_index,name,current_stage,status,
          stage_otk,stage_packaging,stage_marking,stage_packing,stage_logistics,
          activated_at,completed_at
        ) values(
          v_batch.id,v_batch.account_id,null,0,
          case when v_self then 'Исполнитель' else 'Заказчик' end,
          case when v_self then 'reception' else 'done' end,
          case when v_self then 'active' else 'done' end,
          case when v_self then v_batch.stage_otk else false end,
          case when v_self then v_batch.stage_packaging else false end,
          case when v_self then v_batch.stage_marking else false end,
          coalesce(jsonb_typeof(v_batch.payload->'supplies')='array' and
            jsonb_array_length(v_batch.payload->'supplies')>0,false),
          case when v_self then v_batch.stage_logistics else false end,
          now(),case when v_self then null else now() end
        ) returning id into v_stage_id;
        perform set_config('app.pipeline_internal','on',true);
        update public.fulfillment_items
        set pipeline_stage_id=v_stage_id,
            qty_received=case when v_self then qty_received else qty_declared end
        where batch_id=v_batch.id and pipeline_stage_id is null;
        perform set_config('app.pipeline_internal','off',true);
        if v_self then
          update public.fulfillment_batches set request_acceptance_status='accepted',updated_at=now()
          where id=v_batch.id;
        end if;
      end if;
      if v_batch.intake_mode='boxes' then
        select id into v_stage_id from public.batch_pipeline_stages
        where batch_id=v_batch.id and order_index=0 and partner_account_id is null;
        if v_stage_id is null and v_self then
          select id into v_stage_id from public.batch_pipeline_stages
          where batch_id=v_batch.id and order_index=0;
        end if;
        if v_stage_id is null then raise exception 'Стадия заявителя для коробов не найдена'; end if;
        perform public.sync_service_request_supplies(
          v_batch.request_store_id,v_batch.id,v_stage_id,v_batch.payload,v_request.current_version
        );
      end if;
    end loop;
    if v_self then
      update public.service_requests set status='accepted',accepted_at=now(),updated_at=now()
      where id=p_request_id;
      update public.service_request_versions set event_type='accepted',
        snapshot=public.request_snapshot(p_request_id)
      where request_id=p_request_id and version=1;
      update public.service_request_events set event_type='accepted'
      where request_id=p_request_id and event_type='submitted';
    end if;
  end if;
  return v_result;
end $$;
create or replace function public.submit_service_request(p_request_id uuid,p_device_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
  select status into v_status from public.service_requests where id=p_request_id;
  if v_status='draft' and not exists(
    select 1 from public.service_request_work_drafts d
    where d.request_id=p_request_id and d.lease_device=p_device_id
      and d.lease_last_seen>now()-interval '2 minutes'
  ) then raise exception 'Право подтверждения черновика истекло или передано другому устройству'; end if;
  perform set_config('app.request_work_lease_verified','on',true);
  return public.submit_service_request(p_request_id);
end $$;
revoke all on function public.submit_service_request_v40(uuid) from public,anon,authenticated;
grant execute on function public.submit_service_request(uuid) to authenticated;
revoke all on function public.submit_service_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.submit_service_request(uuid,uuid) to authenticated;

do $$ begin
  if to_regprocedure('public.accept_service_request_v40(uuid)') is null then
    alter function public.accept_service_request(uuid) rename to accept_service_request_v40;
  end if;
end $$;
create or replace function public.accept_service_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_request public.service_requests%rowtype;
  v_batch record;
  v_stage_id uuid;
  v_result jsonb;
begin
  select * into v_request from public.service_requests where id=p_request_id for update;
  if not found or v_request.status<>'submitted' then raise exception 'Заявка уже обработана'; end if;
  v_result:=public.accept_service_request_v40(p_request_id);
  if v_request.applicant_account_id<>v_request.executor_account_id then
    for v_batch in
      select b.* from public.fulfillment_batches b
      where b.source_request_id=p_request_id and b.deleted_at is null
    loop
      if not exists(select 1 from public.batch_pipeline_stages
                    where batch_id=v_batch.id and order_index=1) then
        if exists(select 1 from public.batch_pipeline_stages
                  where batch_id=v_batch.id and order_index=0
                    and partner_account_id=v_request.executor_account_id) then
          continue; -- Legacy batch already has its executor stage at index zero.
        end if;
        insert into public.batch_pipeline_stages(
          batch_id,owner_account_id,partner_account_id,order_index,name,current_stage,status,
          stage_otk,stage_packaging,stage_marking,stage_packing,stage_logistics,activated_at
        ) values(
          v_batch.id,v_batch.account_id,v_request.executor_account_id,1,
          'Исполнитель','reception','active',v_batch.stage_otk,v_batch.stage_packaging,
          v_batch.stage_marking,v_batch.stage_packing,v_batch.stage_logistics,now()
        ) returning id into v_stage_id;
        perform set_config('app.pipeline_internal','on',true);
        insert into public.fulfillment_items(
          batch_id,pipeline_stage_id,lineage_id,source_item_id,barcode,product_name,
          size,color,article,qty_declared,qty_received,qty_defect,boxes,notes,sort_order
        )
        select item.batch_id,v_stage_id,item.lineage_id,item.id,item.barcode,item.product_name,
          item.size,item.color,item.article,item.qty_received,0,0,item.boxes,item.notes,item.sort_order
        from public.fulfillment_items item
        join public.batch_pipeline_stages stage on stage.id=item.pipeline_stage_id
        where item.batch_id=v_batch.id and stage.order_index=0 and not item.is_excluded
        on conflict(pipeline_stage_id,lineage_id) where pipeline_stage_id is not null
        do update set qty_declared=excluded.qty_declared,product_name=excluded.product_name;
        perform set_config('app.pipeline_internal','off',true);
      end if;
    end loop;
  end if;
  return v_result;
end $$;
revoke all on function public.accept_service_request_v40(uuid) from public,anon,authenticated;
grant execute on function public.accept_service_request(uuid) to authenticated;

-- Expiration invalidates the URL; it must not delete Auth users or work drafts.
create or replace function public.cleanup_expired_service_request_invite_reserves()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  update public.service_request_invites i
  set deleted_at=now(),delete_reason='expired'
  where i.deleted_at is null and i.revoked_at is null and i.expires_at<=now();
  get diagnostics v_count=row_count;
  return v_count;
end $$;

-- The superadmin command is scoped to one link, never to the shared Auth user.
create or replace function public.admin_delete_service_request_invite_data(p_invite_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v public.service_request_invites%rowtype;
  v_request_count integer;
  v_batch_count integer;
  v_request_ids uuid[];
  v_batch_ids uuid[];
begin
  if not public.is_platform_superadmin() then raise exception 'Недостаточно прав'; end if;
  select * into v from public.service_request_invites where id=p_invite_id for update;
  if not found then raise exception 'Ссылка не найдена'; end if;
  select count(*) into v_request_count from public.service_requests
  where invite_id=v.id and deleted_at is null;
  select count(*) into v_batch_count from public.fulfillment_batches
  where source_request_id in(select id from public.service_requests where invite_id=v.id)
    and deleted_at is null;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_request_ids
  from public.service_requests where invite_id=v.id;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_batch_ids
  from public.fulfillment_batches where source_request_id=any(v_request_ids);
  perform set_config('app.pipeline_internal','on',true);
  delete from public.batch_notifications where batch_id=any(v_batch_ids) or source_request_id=any(v_request_ids);
  delete from public.fulfillment_batch_documents where batch_id=any(v_batch_ids);
  delete from public.fulfillment_reception_history where batch_id=any(v_batch_ids);
  delete from public.fulfillment_stage_stock where batch_id=any(v_batch_ids);
  delete from public.fulfillment_stage_warehouse_history where batch_id=any(v_batch_ids);
  update public.fulfillment_batches set source_request_store_id=null where id=any(v_batch_ids);
  delete from public.service_request_stores where request_id=any(v_request_ids);
  delete from public.fulfillment_batches where id=any(v_batch_ids);
  delete from public.service_request_work_drafts where request_id=any(v_request_ids);
  delete from public.service_request_correction_drafts where request_id=any(v_request_ids);
  delete from public.service_request_events where request_id=any(v_request_ids);
  delete from public.service_request_versions where request_id=any(v_request_ids);
  delete from public.service_requests where id=any(v_request_ids);
  perform set_config('app.pipeline_internal','off',true);
  delete from public.service_request_invite_reserves where invite_id=v.id;
  insert into public.service_request_invite_admin_audit(
    invite_id,token_fingerprint,action,executor_account_id,applicant_account_id,actor_id,details
  ) values(
    v.id,encode(extensions.digest(v.token::text,'sha256'),'hex'),'delete_link_data',
    v.executor_account_id,v.applicant_account_id,auth.uid(),
    jsonb_build_object('requests_deleted',v_request_count,'batches_deleted',v_batch_count,'auth_user_deleted',false)
  );
  update public.service_request_invites
  set token=gen_random_uuid(),deleted_at=now(),delete_reason='data_deleted_by_superadmin',applicant_account_id=null
  where id=v.id;
  return jsonb_build_object('ok',true,'deleted_auth_user',false);
end $$;

-- Old and expired link drafts remain visible to their verified Auth owner.
alter table public.service_request_invite_reserves
  add column if not exists lease_device uuid,
  add column if not exists lease_last_seen timestamptz;

create or replace function public.open_my_request_reserve(p_invite_id uuid,p_device_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.service_request_invite_reserves%rowtype;
begin
  if p_device_id is null then raise exception 'Неизвестное устройство'; end if;
  select * into v from public.service_request_invite_reserves
  where invite_id=p_invite_id and user_id=auth.uid() for update;
  if not found or not exists(select 1 from auth.users u
                             where u.id=auth.uid() and u.email_confirmed_at is not null) then
    raise exception 'Черновик недоступен';
  end if;
  if v.lease_device is not null and v.lease_device<>p_device_id
     and v.lease_last_seen>now()-interval '2 minutes' then
    raise exception 'Черновик сейчас открыт на другом устройстве';
  end if;
  update public.service_request_invite_reserves
  set lease_device=p_device_id,lease_last_seen=now() where invite_id=p_invite_id;
  return v.draft;
end $$;

create or replace function public.heartbeat_my_request_reserve(p_invite_id uuid,p_device_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.service_request_invite_reserves
  set lease_last_seen=now()
  where invite_id=p_invite_id and user_id=auth.uid() and lease_device=p_device_id
    and lease_last_seen>now()-interval '2 minutes';
  return found;
end $$;

create or replace function public.save_my_request_reserve(
  p_invite_id uuid,p_draft jsonb,p_device_id uuid
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  if jsonb_typeof(coalesce(p_draft,'{}'::jsonb))<>'object' then
    raise exception 'Некорректный черновик';
  end if;
  update public.service_request_invite_reserves r
  set draft=p_draft,updated_at=now(),lease_last_seen=now()
  where r.invite_id=p_invite_id and r.user_id=auth.uid()
    and r.lease_device=p_device_id and r.lease_last_seen>now()-interval '2 minutes'
    and exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null);
  if not found then raise exception 'Право записи черновика истекло или передано другому устройству'; end if;
  return true;
end $$;

create or replace function public.save_service_request_invite_reserve(
  p_token uuid,p_draft jsonb,p_device_id uuid
) returns boolean language plpgsql security definer set search_path=public as $$
declare v_invite_id uuid;
begin
  select id into v_invite_id from public.service_request_invites
  where token=p_token and deleted_at is null and revoked_at is null and expires_at>now();
  if v_invite_id is null then raise exception 'Клиентская ссылка недоступна'; end if;
  return public.save_my_request_reserve(v_invite_id,p_draft,p_device_id);
end $$;

create or replace function public.submit_my_request_reserve(
  p_invite_id uuid,p_company_name text,p_applicant_name text,p_applicant_email text,
  p_title text,p_comment text,p_stores jsonb,p_executor_account_id uuid,
  p_applicant_account_id uuid,p_device_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
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
end $$;

create or replace function public.submit_service_request_invite_reserve(
  p_token uuid,p_company_name text,p_applicant_name text,p_applicant_email text,
  p_title text,p_comment text,p_stores jsonb,p_executor_account_id uuid,
  p_device_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_invite_id uuid;
begin
  select id into v_invite_id from public.service_request_invites
  where token=p_token and deleted_at is null and revoked_at is null
    and expires_at>now() and applicant_account_id is null for update;
  if v_invite_id is null then raise exception 'Клиентская ссылка недоступна'; end if;
  return public.submit_my_request_reserve(
    v_invite_id,p_company_name,p_applicant_name,p_applicant_email,
    p_title,p_comment,p_stores,p_executor_account_id,null,p_device_id
  );
end $$;

revoke all on function public.open_my_request_reserve(uuid,uuid) from public,anon,authenticated;
revoke all on function public.heartbeat_my_request_reserve(uuid,uuid) from public,anon,authenticated;
revoke all on function public.save_my_request_reserve(uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.save_service_request_invite_reserve(uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.submit_my_request_reserve(uuid,text,text,text,text,text,jsonb,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.submit_service_request_invite_reserve(uuid,text,text,text,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.open_my_request_reserve(uuid,uuid) to authenticated;
grant execute on function public.heartbeat_my_request_reserve(uuid,uuid) to authenticated;
grant execute on function public.save_my_request_reserve(uuid,jsonb,uuid) to authenticated;
grant execute on function public.save_service_request_invite_reserve(uuid,jsonb,uuid) to authenticated;
grant execute on function public.submit_my_request_reserve(uuid,text,text,text,text,text,jsonb,uuid,uuid,uuid) to authenticated;
grant execute on function public.submit_service_request_invite_reserve(uuid,text,text,text,text,text,jsonb,uuid,uuid) to authenticated;

create or replace function public.list_my_request_reserves()
returns table(
  invite_id uuid,executor_account_id uuid,executor_short_id integer,
  executor_name text,full_name text,email text,draft jsonb,
  expires_at timestamptz,link_active boolean
) language sql stable security definer set search_path=public as $$
  select r.invite_id,i.executor_account_id,a.short_id,a.name,r.full_name,r.email,r.draft,
    i.expires_at,i.deleted_at is null and i.revoked_at is null and i.expires_at>now()
  from public.service_request_invite_reserves r
  join public.service_request_invites i on i.id=r.invite_id
  join public.accounts a on a.id=i.executor_account_id
  where r.user_id=auth.uid()
    and exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null)
  order by r.updated_at desc
$$;

create or replace function public.save_my_request_reserve(p_invite_id uuid,p_draft jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.service_request_invite_reserves r
            where r.invite_id=p_invite_id and r.lease_device is not null
              and r.lease_last_seen>now()-interval '2 minutes') then
    raise exception 'Черновик открыт в новом интерфейсе; обновите страницу';
  end if;
  if not exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null) then
    raise exception 'Сначала подтвердите почту';
  end if;
  if jsonb_typeof(coalesce(p_draft,'{}'::jsonb))<>'object' then
    raise exception 'Некорректный черновик';
  end if;
  update public.service_request_invite_reserves
  set draft=p_draft,updated_at=now()
  where invite_id=p_invite_id and user_id=auth.uid();
  if not found then raise exception 'Черновик недоступен'; end if;
  return true;
end $$;

drop function if exists public.submit_my_request_reserve(uuid,text,text,text,text,text,jsonb,uuid);
create or replace function public.submit_my_request_reserve(
  p_invite_id uuid,p_company_name text,p_applicant_name text,p_applicant_email text,
  p_title text,p_comment text,p_stores jsonb,p_executor_account_id uuid,
  p_applicant_account_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
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
end $$;

revoke all on function public.list_my_request_reserves() from public,anon,authenticated;
revoke all on function public.save_my_request_reserve(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.submit_my_request_reserve(uuid,text,text,text,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_my_request_reserves() to authenticated;
grant execute on function public.save_my_request_reserve(uuid,jsonb) to authenticated;
grant execute on function public.submit_my_request_reserve(uuid,text,text,text,text,text,jsonb,uuid,uuid) to authenticated;

-- New-link confirmation shares exactly the same materialisation path as an
-- expired/replaced reserve; only this entry point insists on an active URL.
create or replace function public.submit_service_request_invite_reserve(
  p_token uuid,p_company_name text,p_applicant_name text,p_applicant_email text,
  p_title text,p_comment text,p_stores jsonb,p_executor_account_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_invite public.service_request_invites%rowtype;
begin
  select * into v_invite from public.service_request_invites where token=p_token for update;
  if not found or v_invite.deleted_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at<=now() or v_invite.applicant_account_id is not null then
    raise exception 'Клиентская ссылка недоступна';
  end if;
  return public.submit_my_request_reserve(
    v_invite.id,p_company_name,p_applicant_name,p_applicant_email,
    p_title,p_comment,p_stores,p_executor_account_id,null
  );
end $$;

-- A stage keeps its executor's C-ID for immediate orientation in the pipeline.
alter table public.batch_pipeline_stages
  add column if not exists stage_company_short_id integer;
update public.batch_pipeline_stages stage
set stage_company_short_id=account.short_id
from public.accounts account
where account.id=coalesce(stage.partner_account_id,stage.owner_account_id)
  and stage.stage_company_short_id is distinct from account.short_id;
create or replace function public.set_pipeline_stage_company_short_id()
returns trigger language plpgsql set search_path=public as $$
begin
  select short_id into new.stage_company_short_id from public.accounts
  where id=coalesce(new.partner_account_id,new.owner_account_id);
  return new;
end $$;
drop trigger if exists set_pipeline_stage_company_short_id_trigger on public.batch_pipeline_stages;
create trigger set_pipeline_stage_company_short_id_trigger
before insert or update of owner_account_id,partner_account_id on public.batch_pipeline_stages
for each row execute function public.set_pipeline_stage_company_short_id();

-- Saving a correction must not cancel/recreate P or consume another P-N.
create or replace function public.save_service_request_draft(
  p_request_id uuid,p_title text,p_executor_account_id uuid,p_applicant_name text,
  p_applicant_email text,p_comment text,p_stores jsonb
) returns public.service_requests language plpgsql security definer set search_path=public as $$
declare v public.service_requests%rowtype;
begin
  select * into v from public.service_requests where id=p_request_id and deleted_at is null for update;
  if not found or not public.request_user_has_permission(v.applicant_account_id,'request_create') then
    raise exception 'Нет права редактировать заявку';
  end if;
  if v.status='draft' then
    if exists(select 1 from public.service_request_work_drafts d
              where d.request_id=p_request_id and d.lease_device is not null
                and d.lease_last_seen>now()-interval '2 minutes') then
      raise exception 'Черновик открыт в новом интерфейсе; обновите страницу';
    end if;
    return public.save_service_request_draft_impl(
      p_request_id,p_title,p_executor_account_id,p_applicant_name,p_applicant_email,p_comment,p_stores
    );
  end if;
  if v.status not in ('submitted','accepted') then raise exception 'Заявку нельзя корректировать'; end if;
  if exists(select 1 from public.service_request_work_drafts where request_id=p_request_id and lease_last_seen>now()-interval '2 minutes')
     and current_setting('app.request_work_lease_verified',true) is distinct from 'on' then
    raise exception 'Черновик открыт в новом интерфейсе; обновите страницу';
  end if;
  if p_executor_account_id is distinct from v.executor_account_id then
    raise exception 'После подтверждения нельзя менять исполнителя';
  end if;
  if jsonb_typeof(coalesce(p_stores,'[]'::jsonb))<>'array' or
     jsonb_array_length(coalesce(p_stores,'[]'::jsonb))<>
     (select count(*) from public.service_request_stores
      where request_id=p_request_id and deleted_at is null) or
     exists(select 1 from jsonb_array_elements(coalesce(p_stores,'[]'::jsonb)) row
       where not exists(select 1 from public.service_request_stores current_store
                        where current_store.request_id=p_request_id
                          and current_store.deleted_at is null
                          and current_store.applicant_store_id=(row->>'store_id')::uuid)) then
    raise exception 'После подтверждения нельзя менять набор магазинов этой партии';
  end if;
  insert into public.service_request_correction_drafts(request_id,draft)
  values(p_request_id,jsonb_build_object(
    'title',coalesce(p_title,''),'comment',coalesce(p_comment,''),'stores',p_stores
  )) on conflict(request_id) do update
  set draft=excluded.draft,saved_by=auth.uid(),updated_at=now();
  return v;
end $$;

create or replace function public.publish_service_request_correction(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_request public.service_requests%rowtype;
  v_draft jsonb;
  v_store jsonb;
  v_store_row public.service_request_stores%rowtype;
  v_stage_id uuid;
  v_line jsonb;
  v_item public.fulfillment_items%rowtype;
  v_key text;
  v_version integer;
  v_user uuid;
begin
  select * into v_request from public.service_requests where id=p_request_id and deleted_at is null for update;
  if not found or v_request.status not in ('submitted','accepted') or
     not public.request_user_has_permission(v_request.applicant_account_id,'request_create') then
    raise exception 'Корректировка недоступна';
  end if;
  select draft into v_draft from public.service_request_correction_drafts
  where request_id=p_request_id for update;
  if v_draft is null then raise exception 'Сохраните черновик корректировки'; end if;
  update public.service_requests
  set title=coalesce(v_draft->>'title',title),
      comment=nullif(btrim(v_draft->>'comment'),''),updated_at=now()
  where id=p_request_id;
  for v_store in select value from jsonb_array_elements(v_draft->'stores') loop
    select * into v_store_row from public.service_request_stores
    where request_id=p_request_id and applicant_store_id=(v_store->>'store_id')::uuid
      and deleted_at is null for update;
    if not found then raise exception 'Магазин корректировки не найден'; end if;
    perform public.validate_service_request_intake(
      v_store->'payload',coalesce(v_store->>'intake_mode',v_store_row.intake_mode)
    );
    if exists(
      select 1 from jsonb_array_elements(v_store->'payload'->'items') line
      where coalesce((line->>'qty')::integer,0)<=0
        or (nullif(btrim(line->>'barcode'),'') is null
            and nullif(btrim(line->>'name'),'') is null)
    ) then raise exception 'У каждого товара нужны название или баркод и положительное количество'; end if;
    if exists(
      select 1 from (
        select coalesce(nullif(btrim(line->>'barcode'),''),
               '@'||lower(coalesce(btrim(line->>'name'),''))||':'||
                   lower(coalesce(btrim(line->>'article'),''))) item_key,
               count(*) line_count
        from jsonb_array_elements(v_store->'payload'->'items') line
        group by 1
      ) duplicate where duplicate.line_count>1
    ) then raise exception 'Объедините повторяющиеся товары в одну строку'; end if;
    select id into v_stage_id from public.batch_pipeline_stages
    where batch_id=v_store_row.batch_id and order_index=0 and partner_account_id is null;
    if v_stage_id is null then
      raise exception 'Для старой партии ещё нет стадии заявителя; её корректировка временно заблокирована во избежание потери P';
    end if;
    update public.service_request_stores
    set delivery_mode=coalesce(v_store->>'delivery_mode',delivery_mode),
        intake_mode=coalesce(v_store->>'intake_mode',intake_mode),
        payload=coalesce(v_store->'payload',payload),updated_at=now()
    where id=v_store_row.id;

    for v_line in select value from jsonb_array_elements(v_store->'payload'->'items') loop
      v_key:=coalesce(nullif(btrim(v_line->>'barcode'),''),
        '@'||lower(coalesce(btrim(v_line->>'name'),''))||':'||
            lower(coalesce(btrim(v_line->>'article'),'')));
      if (select count(*) from public.fulfillment_items item
          where item.batch_id=v_store_row.batch_id and item.pipeline_stage_id=v_stage_id
            and coalesce(nullif(btrim(item.barcode),''),
              '@'||lower(coalesce(btrim(item.product_name),''))||':'||
                  lower(coalesce(btrim(item.article),'')))=v_key)>1 then
        raise exception 'Одинаковые товары старой версии нужно объединить вручную перед корректировкой';
      end if;
      select * into v_item from public.fulfillment_items item
      where item.batch_id=v_store_row.batch_id and item.pipeline_stage_id=v_stage_id
        and coalesce(nullif(btrim(item.barcode),''),
          '@'||lower(coalesce(btrim(item.product_name),''))||':'||
              lower(coalesce(btrim(item.article),'')))=v_key
      order by item.created_at limit 1 for update;
      if found then
        update public.fulfillment_items
        set barcode=coalesce(v_line->>'barcode',''),
            product_name=nullif(v_line->>'name',''),article=nullif(v_line->>'article',''),
            qty_declared=(v_line->>'qty')::integer,
            qty_received=case when v_request.applicant_account_id=v_request.executor_account_id
              then qty_received else (v_line->>'qty')::integer end,
            sort_order=coalesce((v_line->>'position')::integer,0),
            is_excluded=false,corrected_at=now()
        where id=v_item.id;
      else
        insert into public.fulfillment_items(
          batch_id,pipeline_stage_id,barcode,product_name,article,
          qty_declared,qty_received,sort_order
        ) values(
          v_store_row.batch_id,v_stage_id,coalesce(v_line->>'barcode',''),
          nullif(v_line->>'name',''),nullif(v_line->>'article',''),
          (v_line->>'qty')::integer,case when v_request.applicant_account_id=v_request.executor_account_id then 0 else (v_line->>'qty')::integer end,
          coalesce((v_line->>'position')::integer,0)
        );
      end if;
    end loop;
    update public.fulfillment_items item
    set qty_declared=0,qty_received=case when v_request.applicant_account_id=v_request.executor_account_id then qty_received else 0 end,is_excluded=true,corrected_at=now()
    where item.batch_id=v_store_row.batch_id and item.pipeline_stage_id=v_stage_id
      and not exists(
        select 1 from jsonb_array_elements(v_store->'payload'->'items') line
        where coalesce(nullif(btrim(line->>'barcode'),''),
          '@'||lower(coalesce(btrim(line->>'name'),''))||':'||
              lower(coalesce(btrim(line->>'article'),'')))=
          coalesce(nullif(btrim(item.barcode),''),
          '@'||lower(coalesce(btrim(item.product_name),''))||':'||
              lower(coalesce(btrim(item.article),'')))
      );
    perform public.sync_service_request_supplies(
      v_store_row.id,v_store_row.batch_id,v_stage_id,v_store->'payload',v_request.current_version
    );
    update public.batch_pipeline_stages
    set stage_packing=case
      when coalesce(v_store->>'intake_mode',v_store_row.intake_mode)='boxes'
        and jsonb_typeof(v_store->'payload'->'supplies')='array'
      then jsonb_array_length(v_store->'payload'->'supplies')>0
      else false end
    where id=v_stage_id and status='done';
  end loop;
  delete from public.service_request_correction_drafts where request_id=p_request_id;
  v_version:=v_request.current_version+1;
  update public.service_requests set current_version=v_version,updated_at=now()
  where id=p_request_id;
  insert into public.service_request_versions(request_id,version,event_type,snapshot,confirmed_by)
  values(p_request_id,v_version,'corrected',public.request_snapshot(p_request_id),auth.uid());
  insert into public.service_request_events(request_id,event_type,actor_id)
  values(p_request_id,'corrected',auth.uid());
  if v_request.executor_account_id<>v_request.applicant_account_id then
    for v_user in select distinct am.user_id from public.account_members am
      where am.account_id=v_request.executor_account_id and (
        am.role in ('owner','admin') or am.user_id=v_request.responsible_user_id
      ) loop
      insert into public.batch_notifications(
        account_id,type,title,body,recipient_user_id,source_request_id
      ) values(
        v_request.executor_account_id,'service_request_corrected',
        'Обновлена заявка R-'||v_request.short_id,
        'Заявленные данные скорректированы; фактическая приёмка не изменена.',
        v_user,p_request_id
      );
    end loop;
  end if;
  return jsonb_build_object('ok',true,'request_id',p_request_id,'version',v_version);
end $$;

revoke all on function public.publish_service_request_correction(uuid) from public,anon,authenticated;
grant execute on function public.save_service_request_draft(uuid,text,uuid,text,text,text,jsonb) to authenticated;

-- Only the explicit superadmin cascade may physically remove a pipeline P.
create or replace function public.prevent_pipeline_batch_deletion()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('app.pipeline_internal',true)='on' and public.is_platform_superadmin() then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if exists(select 1 from public.batch_pipeline_stages where batch_id=old.id) and
     (tg_op='DELETE' or (old.deleted_at is null and new.deleted_at is not null)) then
    raise exception 'Партию с пайплайном нельзя удалить';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

-- Cancellation preserves completed work, but no longer accepts new stage data.
create or replace function public.request_assert_batch_not_cancelled()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_row jsonb;
  v_batch_id uuid;
  v_status text;
begin
  if current_setting('app.pipeline_internal',true)='on' and public.is_platform_superadmin() then
    return case when tg_op='DELETE' then old else new end;
  end if;
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name in ('fulfillment_items','fulfillment_supplies',
                       'fulfillment_batch_documents','batch_pipeline_stages') then
    v_batch_id:=(v_row->>'batch_id')::uuid;
  elsif tg_table_name='fulfillment_boxes' then
    select batch_id into v_batch_id from public.fulfillment_supplies
    where id=(v_row->>'supply_id')::uuid;
  elsif tg_table_name='fulfillment_box_items' then
    select supply.batch_id into v_batch_id from public.fulfillment_boxes box
    join public.fulfillment_supplies supply on supply.id=box.supply_id
    where box.id=(v_row->>'box_id')::uuid;
  end if;
  select status into v_status from public.fulfillment_batches where id=v_batch_id;
  if v_status='cancelled' then raise exception 'Отменённая партия доступна только для просмотра'; end if;
  if tg_op='UPDATE' and to_jsonb(old) is distinct from v_row then
    if tg_table_name in ('fulfillment_items','fulfillment_supplies',
                         'fulfillment_batch_documents','batch_pipeline_stages') then
      v_batch_id:=(to_jsonb(old)->>'batch_id')::uuid;
    elsif tg_table_name='fulfillment_boxes' then
      select batch_id into v_batch_id from public.fulfillment_supplies
      where id=(to_jsonb(old)->>'supply_id')::uuid;
    elsif tg_table_name='fulfillment_box_items' then
      select supply.batch_id into v_batch_id from public.fulfillment_boxes box
      join public.fulfillment_supplies supply on supply.id=box.supply_id
      where box.id=(to_jsonb(old)->>'box_id')::uuid;
    end if;
    select status into v_status from public.fulfillment_batches where id=v_batch_id;
    if v_status='cancelled' then raise exception 'Отменённая партия доступна только для просмотра'; end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'fulfillment_items','fulfillment_supplies','fulfillment_boxes',
    'fulfillment_box_items','fulfillment_batch_documents','batch_pipeline_stages'
  ] loop
    execute format('drop trigger if exists request_cancelled_write_guard on public.%I',v_table);
    execute format('create trigger request_cancelled_write_guard before insert or update or delete on public.%I for each row execute function public.request_assert_batch_not_cancelled()',v_table);
  end loop;
end $$;

notify pgrst, 'reload schema';
