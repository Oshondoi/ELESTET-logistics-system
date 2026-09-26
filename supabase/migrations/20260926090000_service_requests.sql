-- Client requests -> store branches -> fulfillment batches.
-- Idempotent foundation for R/P numbering, permanent store links, immutable
-- confirmations, executor acceptance and per-batch legal documents.

create sequence if not exists public.service_request_short_id_seq;

create table if not exists public.account_number_counters (
  account_id uuid not null references public.accounts(id) on delete cascade,
  entity text not null check (entity in ('store', 'batch')),
  last_value integer not null default 0,
  primary key (account_id, entity)
);

insert into public.account_number_counters(account_id, entity, last_value)
select account_id, 'batch', coalesce(max(short_id), 0)
from public.fulfillment_batches group by account_id
on conflict (account_id, entity) do update
set last_value = greatest(account_number_counters.last_value, excluded.last_value);

alter table public.stores add column if not exists short_id integer;
alter table public.stores add column if not exists customer_account_id uuid references public.accounts(id) on delete restrict;
alter table public.stores add column if not exists restored_at timestamptz;
alter table public.stores add column if not exists country text;

with ranked as (
  select id, account_id, row_number() over (partition by account_id order by created_at, id)::integer as n
  from public.stores where deleted_at is null and short_id is null
)
update public.stores s set short_id = ranked.n from ranked where s.id = ranked.id;

insert into public.account_number_counters(account_id, entity, last_value)
select account_id, 'store', coalesce(max(short_id), 0)
from public.stores where deleted_at is null group by account_id
on conflict (account_id, entity) do update
set last_value = greatest(account_number_counters.last_value, excluded.last_value);

create unique index if not exists stores_account_short_id_uidx
  on public.stores(account_id, short_id) where short_id is not null;

create or replace function public.next_account_number(p_account_id uuid, p_entity text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_value integer;
begin
  if p_entity not in ('store', 'batch') then raise exception 'Unknown number scope'; end if;
  insert into public.account_number_counters(account_id, entity, last_value)
  values (p_account_id, p_entity, 1)
  on conflict (account_id, entity) do update
  set last_value = account_number_counters.last_value + 1
  returning last_value into v_value;
  return v_value;
end $$;

create or replace function public.assign_store_short_id()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.short_id is null and new.deleted_at is null then
    new.short_id := public.next_account_number(new.account_id, 'store');
  end if;
  return new;
end $$;
drop trigger if exists store_short_id_trigger on public.stores;
create trigger store_short_id_trigger before insert on public.stores
for each row execute function public.assign_store_short_id();

-- Replace MAX()+1 with a locked counter. Numbers remain consumed after archive/delete.
create or replace function public.assign_batch_short_id()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.short_id is null then
    new.short_id := public.next_account_number(new.account_id, 'batch');
  end if;
  return new;
end $$;
drop trigger if exists batch_short_id_trigger on public.fulfillment_batches;
create trigger batch_short_id_trigger before insert on public.fulfillment_batches
for each row execute function public.assign_batch_short_id();

create table if not exists public.service_request_invites (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  executor_account_id uuid not null references public.accounts(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  short_id bigint not null unique default nextval('public.service_request_short_id_seq'),
  applicant_account_id uuid not null references public.accounts(id) on delete restrict,
  applicant_company_short_id integer,
  applicant_company_name text,
  executor_account_id uuid references public.accounts(id) on delete restrict,
  executor_company_short_id integer,
  executor_company_name text,
  invite_id uuid references public.service_request_invites(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','submitted','accepted','rejected','cancelled')),
  title text not null default '',
  applicant_name text,
  applicant_email text,
  comment text,
  current_version integer not null default 0,
  copied_from_request_id uuid references public.service_requests(id) on delete set null,
  submitted_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  rejection_comment text,
  created_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.service_requests add column if not exists applicant_company_short_id integer;
alter table public.service_requests add column if not exists applicant_company_name text;
alter table public.service_requests add column if not exists executor_company_short_id integer;
alter table public.service_requests add column if not exists executor_company_name text;
update public.service_requests r set applicant_company_short_id=a.short_id, applicant_company_name=a.name
from public.accounts a where a.id=r.applicant_account_id and (r.applicant_company_short_id is null or r.applicant_company_name is null);

create table if not exists public.store_links (
  id uuid primary key default gen_random_uuid(),
  applicant_account_id uuid not null references public.accounts(id) on delete restrict,
  applicant_store_id uuid not null references public.stores(id) on delete restrict,
  executor_account_id uuid not null references public.accounts(id) on delete restrict,
  executor_store_id uuid references public.stores(id) on delete restrict,
  created_from_request_id uuid references public.service_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(applicant_store_id, executor_account_id)
);

create table if not exists public.service_request_stores (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete restrict,
  applicant_store_id uuid not null references public.stores(id) on delete restrict,
  store_link_id uuid references public.store_links(id) on delete restrict,
  batch_id uuid references public.fulfillment_batches(id) on delete restrict,
  position integer not null default 0,
  delivery_mode text not null default 'self_delivery' check (delivery_mode in ('pickup','self_delivery')),
  intake_mode text not null default 'bulk' check (intake_mode in ('bulk','catalog','barcodes','boxes')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(request_id, applicant_store_id)
);

create table if not exists public.service_request_versions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete restrict,
  version integer not null,
  event_type text not null check (event_type in ('submitted','corrected','accepted','rejected','cancelled')),
  snapshot jsonb not null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  unique(request_id, version)
);

create table if not exists public.service_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete restrict,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.service_request_correction_drafts (
  request_id uuid primary key references public.service_requests(id) on delete restrict,
  draft jsonb not null,
  saved_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.fulfillment_batches add column if not exists source_request_id uuid references public.service_requests(id) on delete restrict;
alter table public.fulfillment_batches add column if not exists source_request_store_id uuid references public.service_request_stores(id) on delete restrict;
alter table public.fulfillment_batches add column if not exists operator_account_id uuid references public.accounts(id) on delete restrict;
alter table public.fulfillment_batches add column if not exists applicant_store_id uuid references public.stores(id) on delete restrict;
alter table public.fulfillment_batches add column if not exists executor_store_id uuid references public.stores(id) on delete restrict;
alter table public.fulfillment_batches add column if not exists store_link_id uuid references public.store_links(id) on delete restrict;
alter table public.fulfillment_batches add column if not exists request_acceptance_status text not null default 'not_required'
  check (request_acceptance_status in ('not_required','pending','accepted','rejected'));
alter table public.fulfillment_batches add column if not exists customer_company_short_id integer;
alter table public.fulfillment_batches add column if not exists customer_company_name text;

create unique index if not exists fulfillment_batches_account_short_id_uidx
  on public.fulfillment_batches(account_id, short_id) where short_id is not null;
create unique index if not exists fulfillment_batches_request_store_uidx
  on public.fulfillment_batches(source_request_store_id) where source_request_store_id is not null;

create table if not exists public.fulfillment_batch_documents (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fulfillment_batches(id) on delete restrict,
  pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete restrict,
  kind text not null check (kind in ('acceptance_act','invoice')),
  revision integer not null default 1,
  status text not null default 'draft' check (status in ('draft','issued','agreed','void')),
  payload jsonb not null default '{}'::jsonb,
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz,
  agreed_by uuid references auth.users(id) on delete set null,
  agreed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(batch_id, pipeline_stage_id, kind, revision)
);

create index if not exists service_requests_applicant_idx on public.service_requests(applicant_account_id, created_at desc);
create index if not exists service_requests_executor_idx on public.service_requests(executor_account_id, created_at desc);
create index if not exists service_request_stores_request_idx on public.service_request_stores(request_id, position);
create index if not exists store_links_parties_idx on public.store_links(applicant_account_id, executor_account_id);

create or replace function public.is_account_member(p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.account_members where account_id = p_account_id and user_id = auth.uid())
$$;

alter table public.service_request_invites enable row level security;
alter table public.service_requests enable row level security;
alter table public.service_request_stores enable row level security;
alter table public.service_request_versions enable row level security;
alter table public.service_request_events enable row level security;
alter table public.service_request_correction_drafts enable row level security;
alter table public.store_links enable row level security;
alter table public.fulfillment_batch_documents enable row level security;

drop policy if exists service_requests_select on public.service_requests;
create policy service_requests_select on public.service_requests for select using (
  public.is_account_member(applicant_account_id) or public.is_account_member(executor_account_id)
);
drop policy if exists request_stores_select on public.service_request_stores;
create policy request_stores_select on public.service_request_stores for select using (
  exists(select 1 from public.service_requests r where r.id=request_id and
    (public.is_account_member(r.applicant_account_id) or public.is_account_member(r.executor_account_id)))
);
drop policy if exists request_versions_select on public.service_request_versions;
create policy request_versions_select on public.service_request_versions for select using (
  exists(select 1 from public.service_requests r where r.id=request_id and
    (public.is_account_member(r.applicant_account_id) or public.is_account_member(r.executor_account_id)))
);
drop policy if exists request_events_select on public.service_request_events;
create policy request_events_select on public.service_request_events for select using (
  exists(select 1 from public.service_requests r where r.id=request_id and
    (public.is_account_member(r.applicant_account_id) or public.is_account_member(r.executor_account_id)))
);
drop policy if exists request_correction_drafts_applicant on public.service_request_correction_drafts;
create policy request_correction_drafts_applicant on public.service_request_correction_drafts for select using (
  exists(select 1 from public.service_requests r where r.id=request_id and public.is_account_member(r.applicant_account_id))
);
drop policy if exists store_links_select on public.store_links;
create policy store_links_select on public.store_links for select using (
  public.is_account_member(applicant_account_id) or public.is_account_member(executor_account_id)
);
drop policy if exists batch_documents_select on public.fulfillment_batch_documents;
create policy batch_documents_select on public.fulfillment_batch_documents for select using (
  exists(select 1 from public.fulfillment_batches b where b.id=batch_id and
    (public.is_account_member(b.account_id) or public.is_account_member(b.operator_account_id)))
);
drop policy if exists request_invites_executor on public.service_request_invites;
create policy request_invites_executor on public.service_request_invites for select using (public.is_account_member(executor_account_id));

-- The executor may operate only request-created batches assigned to it.
drop policy if exists fulfillment_batches_request_operator_select on public.fulfillment_batches;
create policy fulfillment_batches_request_operator_select on public.fulfillment_batches for select using (
  operator_account_id is not null and public.is_account_member(operator_account_id)
);
drop policy if exists fulfillment_batches_request_operator_update on public.fulfillment_batches;
create policy fulfillment_batches_request_operator_update on public.fulfillment_batches for update using (
  operator_account_id is not null and public.is_account_member(operator_account_id) and request_acceptance_status = 'accepted'
);

create or replace function public.request_snapshot(p_request_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'request', to_jsonb(r) - 'updated_at',
    'stores', coalesce((select jsonb_agg(to_jsonb(rs) order by rs.position) from public.service_request_stores rs where rs.request_id=r.id and rs.deleted_at is null), '[]'::jsonb)
  ) from public.service_requests r where r.id=p_request_id
$$;

create or replace function public.create_service_request_draft(
  p_applicant_account_id uuid,
  p_executor_account_id uuid default null,
  p_title text default ''
) returns public.service_requests language plpgsql security definer set search_path = public as $$
declare v_row public.service_requests%rowtype;
begin
  if not public.is_account_member(p_applicant_account_id) then raise exception 'Нет доступа к компании заявителя'; end if;
  insert into public.service_requests(applicant_account_id, applicant_company_short_id, applicant_company_name, executor_account_id, title)
  select a.id,a.short_id,a.name,p_executor_account_id,coalesce(p_title,'') from public.accounts a where a.id=p_applicant_account_id
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.save_service_request_draft(
  p_request_id uuid,
  p_title text,
  p_executor_account_id uuid,
  p_applicant_name text,
  p_applicant_email text,
  p_comment text,
  p_stores jsonb
) returns public.service_requests language plpgsql security definer set search_path = public as $$
declare v_request public.service_requests%rowtype; v_store jsonb; v_store_count integer;
begin
  select * into v_request from public.service_requests where id=p_request_id for update;
  if not found or not public.is_account_member(v_request.applicant_account_id) then raise exception 'Заявка недоступна'; end if;
  if v_request.status not in ('draft','submitted','accepted') then raise exception 'Эту заявку нельзя корректировать'; end if;
  if v_request.status = 'accepted' then
    select count(*) into v_store_count from public.service_request_stores where request_id=p_request_id and deleted_at is null;
    if v_store_count <> jsonb_array_length(coalesce(p_stores,'[]'::jsonb)) or exists(
      select 1 from jsonb_array_elements(coalesce(p_stores,'[]'::jsonb)) x
      where not exists(select 1 from public.service_request_stores rs where rs.request_id=p_request_id and rs.deleted_at is null and rs.applicant_store_id=(x->>'store_id')::uuid)
    ) then raise exception 'После принятия нельзя добавлять или удалять магазинные ветки; корректируйте их данные'; end if;
    insert into public.service_request_correction_drafts(request_id,draft)
    values(p_request_id,jsonb_build_object('title',p_title,'comment',p_comment,'stores',p_stores))
    on conflict(request_id) do update set draft=excluded.draft,saved_by=auth.uid(),updated_at=now();
    return v_request;
  end if;
  update public.service_requests set title=coalesce(p_title,''), executor_account_id=p_executor_account_id,
    executor_company_short_id=(select short_id from public.accounts where id=p_executor_account_id),
    executor_company_name=(select name from public.accounts where id=p_executor_account_id),
    applicant_name=case when current_version=0 then nullif(btrim(p_applicant_name),'') else applicant_name end,
    applicant_email=case when current_version=0 then nullif(lower(btrim(p_applicant_email)),'') else applicant_email end,
    comment=nullif(btrim(p_comment),''), updated_at=now() where id=p_request_id returning * into v_request;
  -- A correction made before acceptance replaces the reserved P branches. Old P
  -- numbers stay consumed and the new confirmation receives new numbers.
  if v_request.status = 'submitted' then
    update public.fulfillment_batches set status='cancelled', request_acceptance_status='rejected', deleted_at=now(), updated_at=now()
    where source_request_id=p_request_id and request_acceptance_status='pending';
    update public.service_request_stores set batch_id=null where request_id=p_request_id;
  end if;
  update public.service_request_stores set deleted_at=now(), updated_at=now() where request_id=p_request_id;
  for v_store in select * from jsonb_array_elements(coalesce(p_stores,'[]'::jsonb)) loop
    if not exists(select 1 from public.stores s where s.id=(v_store->>'store_id')::uuid and s.account_id=v_request.applicant_account_id and s.deleted_at is null) then
      raise exception 'Магазин заявки недоступен';
    end if;
    insert into public.service_request_stores(request_id, applicant_store_id, position, delivery_mode, intake_mode, payload, deleted_at)
    values(p_request_id, (v_store->>'store_id')::uuid, coalesce((v_store->>'position')::integer,0),
      coalesce(v_store->>'delivery_mode','self_delivery'), coalesce(v_store->>'intake_mode','bulk'), coalesce(v_store->'payload','{}'::jsonb), null)
    on conflict(request_id, applicant_store_id) do update set position=excluded.position, delivery_mode=excluded.delivery_mode,
      intake_mode=excluded.intake_mode, payload=excluded.payload, deleted_at=null, updated_at=now();
  end loop;
  return v_request;
end $$;

create or replace function public.submit_service_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.service_requests%rowtype; v_group public.service_request_stores%rowtype;
  v_batch public.fulfillment_batches%rowtype; v_version integer; v_item jsonb; v_settings public.fulfillment_settings%rowtype; v_draft jsonb;
begin
  select * into v_request from public.service_requests where id=p_request_id for update;
  if not found or not public.is_account_member(v_request.applicant_account_id) then raise exception 'Заявка недоступна'; end if;
  if v_request.status = 'accepted' then
    select draft into v_draft from public.service_request_correction_drafts where request_id=p_request_id;
    if v_draft is null then raise exception 'Черновик корректировки не найден'; end if;
    update public.service_requests set title=coalesce(v_draft->>'title',title),comment=nullif(btrim(v_draft->>'comment'),''),updated_at=now() where id=p_request_id;
    for v_item in select * from jsonb_array_elements(coalesce(v_draft->'stores','[]'::jsonb)) loop
      update public.service_request_stores set delivery_mode=coalesce(v_item->>'delivery_mode',delivery_mode),
        intake_mode=coalesce(v_item->>'intake_mode',intake_mode),payload=coalesce(v_item->'payload',payload),updated_at=now()
      where request_id=p_request_id and applicant_store_id=(v_item->>'store_id')::uuid and deleted_at is null;
    end loop;
    update public.fulfillment_items fi set qty_declared=greatest(coalesce((line->>'qty')::integer,0),0), corrected_at=now()
    from public.service_request_stores rs,
      lateral jsonb_array_elements(coalesce(rs.payload->'items','[]'::jsonb)) line
    where rs.request_id=p_request_id and rs.batch_id=fi.batch_id and fi.barcode=coalesce(line->>'barcode','') and rs.deleted_at is null;
    delete from public.service_request_correction_drafts where request_id=p_request_id;
    v_version := v_request.current_version+1;
    update public.service_requests set current_version=v_version,updated_at=now() where id=p_request_id;
    insert into public.service_request_versions(request_id,version,event_type,snapshot,confirmed_by)
    values(p_request_id,v_version,'corrected',public.request_snapshot(p_request_id),auth.uid());
    insert into public.service_request_events(request_id,event_type,actor_id) values(p_request_id,'corrected',auth.uid());
    return jsonb_build_object('ok',true,'request_id',p_request_id,'version',v_version);
  end if;
  if v_request.executor_account_id is null then raise exception 'Выберите исполнителя'; end if;
  if nullif(btrim(v_request.applicant_name),'') is null or nullif(btrim(v_request.applicant_email),'') is null then raise exception 'Укажите имя и почту заявителя'; end if;
  if not exists(select 1 from public.service_request_stores where request_id=p_request_id and deleted_at is null) then raise exception 'Добавьте хотя бы один магазин'; end if;
  select * into v_settings from public.fulfillment_settings where account_id=v_request.applicant_account_id;
  for v_group in select * from public.service_request_stores where request_id=p_request_id and deleted_at is null order by position loop
    if v_group.batch_id is null then
      insert into public.fulfillment_batches(account_id, operator_account_id, store_id, applicant_store_id, name,
        source_request_id, source_request_store_id, request_acceptance_status,
        stage_otk, stage_packaging, stage_marking, stage_packing, stage_logistics, comment, created_by,
        customer_company_short_id, customer_company_name)
      values(v_request.applicant_account_id, v_request.executor_account_id, v_group.applicant_store_id, v_group.applicant_store_id,
        coalesce(nullif(v_request.title,''), 'Заявка R-'||v_request.short_id), p_request_id, v_group.id, 'pending',
        coalesce(v_settings.stage_otk,true), coalesce(v_settings.stage_packaging,false), coalesce(v_settings.stage_marking,true),
        coalesce(v_settings.stage_packing,true), coalesce(v_settings.stage_logistics,true), v_request.comment, auth.uid(),
        (select short_id from public.accounts where id=v_request.applicant_account_id),
        (select name from public.accounts where id=v_request.applicant_account_id)) returning * into v_batch;
      update public.service_request_stores set batch_id=v_batch.id, updated_at=now() where id=v_group.id;
      for v_item in select * from jsonb_array_elements(coalesce(v_group.payload->'items','[]'::jsonb)) loop
        insert into public.fulfillment_items(batch_id, barcode, product_name, size, color, article, qty_declared, qty_received, notes, sort_order)
        values(v_batch.id, coalesce(v_item->>'barcode',''), nullif(v_item->>'name',''), nullif(v_item->>'size',''), nullif(v_item->>'color',''),
          nullif(v_item->>'article',''), greatest(coalesce((v_item->>'qty')::integer,0),0), 0, nullif(v_item->>'notes',''),
          coalesce((v_item->>'position')::integer,0));
      end loop;
    end if;
  end loop;
  v_version := v_request.current_version + 1;
  update public.service_requests set status='submitted', submitted_at=now(), current_version=v_version, updated_at=now() where id=p_request_id;
  insert into public.service_request_versions(request_id,version,event_type,snapshot,confirmed_by)
  values(p_request_id,v_version,case when v_request.current_version=0 then 'submitted' else 'corrected' end,public.request_snapshot(p_request_id),auth.uid());
  insert into public.service_request_events(request_id,event_type,actor_id) values(p_request_id,'submitted',auth.uid());
  return jsonb_build_object('ok',true,'request_id',p_request_id,'version',v_version);
end $$;

create or replace function public.accept_service_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.service_requests%rowtype; v_group public.service_request_stores%rowtype;
  v_source public.stores%rowtype; v_link public.store_links%rowtype; v_executor_store uuid; v_version integer; v_stage_id uuid;
begin
  select * into v_request from public.service_requests where id=p_request_id for update;
  if not found or not public.is_account_member(v_request.executor_account_id) then raise exception 'Заявка недоступна исполнителю'; end if;
  if v_request.status <> 'submitted' then raise exception 'Заявка уже обработана'; end if;
  for v_group in select * from public.service_request_stores where request_id=p_request_id and deleted_at is null loop
    select * into v_source from public.stores where id=v_group.applicant_store_id;
    select * into v_link from public.store_links where applicant_store_id=v_group.applicant_store_id and executor_account_id=v_request.executor_account_id;
    if found then
      v_executor_store := v_link.executor_store_id;
      if v_executor_store is not null then update public.stores set deleted_at=null, restored_at=now() where id=v_executor_store and deleted_at is not null; end if;
    else
      insert into public.stores(account_id, customer_account_id, name, marketplace, supplier, supplier_full, address, country, inn, phone)
      values(v_request.executor_account_id, v_request.applicant_account_id, v_source.name, v_source.marketplace,
        v_source.supplier, v_source.supplier_full, v_source.address, v_source.country, v_source.inn, v_source.phone)
      returning id into v_executor_store;
      insert into public.store_links(applicant_account_id,applicant_store_id,executor_account_id,executor_store_id,created_from_request_id)
      values(v_request.applicant_account_id,v_group.applicant_store_id,v_request.executor_account_id,v_executor_store,p_request_id) returning * into v_link;
    end if;
    update public.service_request_stores set store_link_id=v_link.id, updated_at=now() where id=v_group.id;
    update public.fulfillment_batches set executor_store_id=v_executor_store, store_link_id=v_link.id,
      request_acceptance_status='accepted', updated_at=now() where id=v_group.batch_id;
    if not exists(select 1 from public.batch_pipeline_stages where batch_id=v_group.batch_id) then
      insert into public.batch_pipeline_stages(batch_id,owner_account_id,partner_account_id,order_index,name,current_stage,status,
        stage_otk,stage_packaging,stage_marking,stage_packing,stage_logistics,activated_at)
      select b.id,b.account_id,v_request.executor_account_id,0,'Исполнитель','reception','active',
        b.stage_otk,b.stage_packaging,b.stage_marking,b.stage_packing,b.stage_logistics,now()
      from public.fulfillment_batches b where b.id=v_group.batch_id returning id into v_stage_id;
      perform set_config('app.pipeline_internal','on',true);
      update public.fulfillment_items set pipeline_stage_id=v_stage_id where batch_id=v_group.batch_id and pipeline_stage_id is null;
      perform set_config('app.pipeline_internal','off',true);
    end if;
  end loop;
  v_version := v_request.current_version + 1;
  update public.service_requests set status='accepted',accepted_at=now(),current_version=v_version,updated_at=now() where id=p_request_id;
  insert into public.service_request_versions(request_id,version,event_type,snapshot,confirmed_by)
  values(p_request_id,v_version,'accepted',public.request_snapshot(p_request_id),auth.uid());
  insert into public.service_request_events(request_id,event_type,actor_id) values(p_request_id,'accepted',auth.uid());
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.issue_reception_documents(p_batch_id uuid, p_pipeline_stage_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_batch public.fulfillment_batches%rowtype; v_revision integer; v_act uuid; v_invoice uuid; v_qty integer;
begin
  select * into v_batch from public.fulfillment_batches where id=p_batch_id;
  if not found or not (public.is_account_member(v_batch.account_id) or public.is_account_member(v_batch.operator_account_id)) then
    raise exception 'Партия недоступна';
  end if;
  select coalesce(sum(qty_received + coalesce(qty_defect,0)),0) into v_qty from public.fulfillment_items
  where batch_id=p_batch_id and (p_pipeline_stage_id is null or pipeline_stage_id=p_pipeline_stage_id) and coalesce(is_excluded,false)=false;
  select coalesce(max(revision),0)+1 into v_revision from public.fulfillment_batch_documents
  where batch_id=p_batch_id and pipeline_stage_id is not distinct from p_pipeline_stage_id;
  insert into public.fulfillment_batch_documents(batch_id,pipeline_stage_id,kind,revision,status,payload,issued_by,issued_at)
  values(p_batch_id,p_pipeline_stage_id,'acceptance_act',v_revision,'issued',jsonb_build_object('accepted_quantity',v_qty),auth.uid(),now()) returning id into v_act;
  insert into public.fulfillment_batch_documents(batch_id,pipeline_stage_id,kind,revision,status,payload,issued_by,issued_at)
  values(p_batch_id,p_pipeline_stage_id,'invoice',v_revision,'issued',jsonb_build_object('accepted_quantity',v_qty,'pricing_source','executor_tariffs'),auth.uid(),now()) returning id into v_invoice;
  return jsonb_build_object('ok',true,'act_id',v_act,'invoice_id',v_invoice,'revision',v_revision);
end $$;

create or replace function public.reject_service_request(p_request_id uuid, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_request public.service_requests%rowtype; v_version integer;
begin
  select * into v_request from public.service_requests where id=p_request_id for update;
  if not found or not public.is_account_member(v_request.executor_account_id) then raise exception 'Заявка недоступна исполнителю'; end if;
  if v_request.status <> 'submitted' then raise exception 'Заявка уже обработана'; end if;
  v_version := v_request.current_version + 1;
  update public.service_requests set status='rejected', rejected_at=now(), rejection_comment=nullif(btrim(p_comment),''), current_version=v_version, updated_at=now() where id=p_request_id;
  update public.fulfillment_batches set request_acceptance_status='rejected', status='cancelled', updated_at=now() where source_request_id=p_request_id;
  insert into public.service_request_versions(request_id,version,event_type,snapshot,confirmed_by)
  values(p_request_id,v_version,'rejected',public.request_snapshot(p_request_id),auth.uid());
  insert into public.service_request_events(request_id,event_type,details,actor_id) values(p_request_id,'rejected',jsonb_build_object('comment',p_comment),auth.uid());
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.copy_service_request(p_request_id uuid)
returns public.service_requests language plpgsql security definer set search_path = public as $$
declare v_source public.service_requests%rowtype; v_copy public.service_requests%rowtype;
begin
  select * into v_source from public.service_requests where id=p_request_id;
  if not found or not public.is_account_member(v_source.applicant_account_id) then raise exception 'Заявка недоступна'; end if;
  insert into public.service_requests(applicant_account_id,applicant_company_short_id,applicant_company_name,title,applicant_name,applicant_email,comment,copied_from_request_id)
  values(v_source.applicant_account_id,v_source.applicant_company_short_id,v_source.applicant_company_name,v_source.title,v_source.applicant_name,v_source.applicant_email,v_source.comment,p_request_id) returning * into v_copy;
  insert into public.service_request_stores(request_id,applicant_store_id,position,delivery_mode,intake_mode,payload)
  select v_copy.id,applicant_store_id,position,delivery_mode,intake_mode,payload from public.service_request_stores where request_id=p_request_id and deleted_at is null;
  return v_copy;
end $$;

create or replace function public.search_executor_accounts(p_query text)
returns table(id uuid, short_id integer, name text) language sql stable security definer set search_path = public as $$
  select a.id,a.short_id,a.name from public.accounts a
  where a.deleted_at is null and (a.name ilike '%'||trim(p_query)||'%' or a.short_id::text=regexp_replace(p_query,'\D','','g'))
  order by case when a.short_id::text=regexp_replace(p_query,'\D','','g') then 0 else 1 end,a.name limit 20
$$;

create or replace function public.create_service_request_invite(p_executor_account_id uuid)
returns public.service_request_invites language plpgsql security definer set search_path = public as $$
declare v_row public.service_request_invites%rowtype;
begin
  if not public.is_account_member(p_executor_account_id) then raise exception 'Нет доступа'; end if;
  insert into public.service_request_invites(executor_account_id) values(p_executor_account_id) returning * into v_row;
  return v_row;
end $$;

create or replace function public.get_service_request_invite(p_token uuid)
returns table(executor_account_id uuid, executor_short_id integer, executor_name text, expires_at timestamptz, is_available boolean)
language sql stable security definer set search_path = public as $$
  select i.executor_account_id,a.short_id,a.name,i.expires_at,
    (i.revoked_at is null and i.expires_at>now())
  from public.service_request_invites i join public.accounts a on a.id=i.executor_account_id where i.token=p_token
$$;

create or replace function public.claim_service_request_invite(p_token uuid)
returns table(id uuid, short_id integer, name text) language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Сначала войдите или зарегистрируйтесь'; end if;
  if not exists(select 1 from public.service_request_invites where token=p_token and revoked_at is null and expires_at>now()) then
    raise exception 'Ссылка недействительна или истекла';
  end if;
  update public.service_request_invites set claimed_by=auth.uid(), claimed_at=coalesce(claimed_at,now()) where token=p_token;
  return query select a.id,a.short_id,a.name from public.service_request_invites i join public.accounts a on a.id=i.executor_account_id where i.token=p_token;
end $$;

-- Structured delete guard. UI receives the exact reason and may disable the action.
drop function if exists public.archive_store(uuid);
create or replace function public.archive_store(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_store public.stores%rowtype; v_reason text;
begin
  select * into v_store from public.stores where id=p_store_id for update;
  if not found or not public.is_account_member(v_store.account_id) then raise exception 'Магазин недоступен'; end if;
  if exists(select 1 from public.service_request_stores rs join public.service_requests r on r.id=rs.request_id
    left join public.fulfillment_batches b on b.id=rs.batch_id
    where rs.applicant_store_id=p_store_id and rs.deleted_at is null and r.deleted_at is null
      and (r.status in ('draft','submitted') or (r.status='accepted' and b.deleted_at is null and b.status not in ('done','cancelled')))) then
    v_reason := 'Магазин участвует в незакрытой заявке';
  elsif exists(select 1 from public.fulfillment_batches b where (b.store_id=p_store_id or b.applicant_store_id=p_store_id or b.executor_store_id=p_store_id)
    and b.deleted_at is null and b.status not in ('done','cancelled')) then
    v_reason := 'Магазин участвует в незавершённой партии или стадии';
  end if;
  if v_reason is not null then return jsonb_build_object('ok',false,'code','ACTIVE_DESCENDANT','reason',v_reason); end if;
  update public.stores set deleted_at=now() where id=p_store_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.prevent_store_physical_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Магазины удаляются только логически: история и постоянные связи должны сохраняться';
end $$;
drop trigger if exists prevent_store_physical_delete_trigger on public.stores;
create trigger prevent_store_physical_delete_trigger before delete on public.stores
for each row execute function public.prevent_store_physical_delete();

-- Legacy 15-day cleanup must not physically erase store identity/history.
create or replace function public.hard_delete_expired_stores()
returns void language plpgsql security definer set search_path = public as $$
begin
  return;
end $$;

revoke all on function public.next_account_number(uuid,text) from public, anon;
revoke all on function public.request_snapshot(uuid) from public, anon;
grant execute on function public.create_service_request_draft(uuid,uuid,text) to authenticated;
grant execute on function public.save_service_request_draft(uuid,text,uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.submit_service_request(uuid) to authenticated;
grant execute on function public.accept_service_request(uuid) to authenticated;
grant execute on function public.reject_service_request(uuid,text) to authenticated;
grant execute on function public.copy_service_request(uuid) to authenticated;
grant execute on function public.search_executor_accounts(text) to authenticated;
grant execute on function public.create_service_request_invite(uuid) to authenticated;
grant execute on function public.get_service_request_invite(uuid) to anon, authenticated;
grant execute on function public.claim_service_request_invite(uuid) to authenticated;
grant execute on function public.archive_store(uuid) to authenticated;
grant execute on function public.issue_reception_documents(uuid,uuid) to authenticated;

comment on table public.service_requests is 'R: client request; confirmed history is stored in service_request_versions';
comment on table public.store_links is 'Permanent identity link; each side keeps independent store data';
comment on column public.stores.customer_account_id is 'Customer company represented by this card in an executor account';
