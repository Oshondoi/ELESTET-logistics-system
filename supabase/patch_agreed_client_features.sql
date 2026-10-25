-- Agreed client features: store barcode guard, role invite, one role per member,
-- logistics manual dates + activity log, Excel export presets.
begin;

-- ─── Store barcode guard ───────────────────────────────────────
create or replace function public.assert_fulfillment_store_barcode(
  p_store_id uuid,
  p_barcode text
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_barcode text := btrim(coalesce(p_barcode, ''));
  v_store_name text;
begin
  if p_store_id is null or v_barcode = '' then
    return;
  end if;

  if exists (
    select 1
    from public.products p
    where p.store_id = p_store_id
      and exists (
        select 1
        from unnest(coalesce(p.barcodes, array[]::text[])) sku
        where btrim(sku) = v_barcode
      )
  ) then
    return;
  end if;

  select coalesce(nullif(btrim(s.name), ''), 'магазина партии')
  into v_store_name
  from public.stores s
  where s.id = p_store_id;

  raise exception 'Этот баркод не принадлежит магазину «%».', v_store_name;
end;
$$;

create or replace function public.assert_fulfillment_box_store_barcode(
  p_box_id uuid,
  p_barcode text
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_store_id uuid;
begin
  select batch.store_id
  into v_store_id
  from public.fulfillment_boxes box
  join public.fulfillment_supplies supply on supply.id = box.supply_id
  join public.fulfillment_batches batch on batch.id = supply.batch_id
  where box.id = p_box_id;

  perform public.assert_fulfillment_store_barcode(v_store_id, p_barcode);
end;
$$;

create or replace function public.assert_fulfillment_batch_store_barcode(
  p_batch_id uuid,
  p_barcode text
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_store_id uuid;
begin
  select store_id into v_store_id from public.fulfillment_batches where id = p_batch_id;
  perform public.assert_fulfillment_store_barcode(v_store_id, p_barcode);
end;
$$;

create or replace function public.guard_fulfillment_item_store_barcode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if coalesce(btrim(new.barcode), '') <> '' then
    perform public.assert_fulfillment_batch_store_barcode(new.batch_id, new.barcode);
  end if;
  return new;
end;
$$;

drop trigger if exists fulfillment_items_store_barcode_guard on public.fulfillment_items;
create trigger fulfillment_items_store_barcode_guard
  before insert or update of barcode on public.fulfillment_items
  for each row execute function public.guard_fulfillment_item_store_barcode();

create or replace function public.increment_fulfillment_box_item(
  p_box_id uuid,
  p_barcode text,
  p_item_id uuid,
  p_product_name text,
  p_qty integer
)
returns public.fulfillment_box_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box public.fulfillment_boxes%rowtype;
  v_result public.fulfillment_box_items%rowtype;
  v_barcode text := trim(p_barcode);
begin
  if v_barcode = '' then raise exception 'Баркод не указан'; end if;
  if p_qty < 1 then raise exception 'Количество должно быть не меньше 1'; end if;

  select * into v_box from public.fulfillment_boxes where id = p_box_id;
  if not found then raise exception 'Короб не найден'; end if;
  if not public.can_manage_fulfillment_box(v_box.id) then raise exception 'Нет доступа к коробу'; end if;

  perform public.assert_fulfillment_box_store_barcode(v_box.id, v_barcode);

  insert into public.fulfillment_box_items (
    box_id, account_id, barcode, item_id, product_name, qty
  ) values (
    v_box.id, v_box.account_id, v_barcode, p_item_id, p_product_name, p_qty
  )
  on conflict (box_id, barcode) do update
  set qty = fulfillment_box_items.qty + excluded.qty,
      item_id = coalesce(fulfillment_box_items.item_id, excluded.item_id),
      product_name = coalesce(fulfillment_box_items.product_name, excluded.product_name)
  returning * into v_result;

  return v_result;
end;
$$;

-- ─── One role per employee in a company ────────────────────────
with ranked as (
  select
    ctid,
    row_number() over (
      partition by account_id, user_id
      order by created_at asc, role_id asc
    ) as rn
  from public.role_assignments
)
delete from public.role_assignments ra
using ranked r
where ra.ctid = r.ctid
  and r.rn > 1;

create unique index if not exists role_assignments_account_user_uidx
  on public.role_assignments(account_id, user_id);

create or replace function public.set_role_assignments(
  p_role_id uuid,
  p_user_ids uuid[] default '{}'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_account_id uuid;
  v_user_id uuid;
begin
  select account_id into v_account_id from public.roles where id = p_role_id;
  if v_account_id is null then
    raise exception 'Роль не найдена';
  end if;

  delete from public.role_assignments
  where role_id = p_role_id
    and not (user_id = any(coalesce(p_user_ids, '{}'::uuid[])));

  foreach v_user_id in array coalesce(p_user_ids, '{}'::uuid[])
  loop
    delete from public.role_assignments
    where account_id = v_account_id
      and user_id = v_user_id
      and role_id <> p_role_id;

    insert into public.role_assignments(role_id, user_id, account_id)
    values (p_role_id, v_user_id, v_account_id)
    on conflict (role_id, user_id) do nothing;
  end loop;
end;
$$;

-- ─── Permanent role invite link ────────────────────────────────
create table if not exists public.role_invite_links (
  role_id uuid primary key references public.roles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  is_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists role_invite_links_token_uidx
  on public.role_invite_links(token);

alter table public.role_invite_links enable row level security;

drop policy if exists "members view role invite links" on public.role_invite_links;
create policy "members view role invite links"
  on public.role_invite_links for select
  using (
    exists (
      select 1 from public.account_members am
      where am.account_id = role_invite_links.account_id
        and am.user_id = auth.uid()
    )
  );

drop policy if exists "owners admins manage role invite links" on public.role_invite_links;
create policy "owners admins manage role invite links"
  on public.role_invite_links for all
  using (
    exists (
      select 1 from public.account_members am
      where am.account_id = role_invite_links.account_id
        and am.user_id = auth.uid()
        and am.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.account_members am
      where am.account_id = role_invite_links.account_id
        and am.user_id = auth.uid()
        and am.role in ('owner', 'admin')
    )
  );

create or replace function public.ensure_role_invite_link(p_role_id uuid)
returns table(token uuid, is_enabled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Нужно войти';
  end if;

  select r.account_id into v_account_id from public.roles r where r.id = p_role_id;
  if v_account_id is null then
    raise exception 'Роль не найдена';
  end if;

  if not exists (
    select 1 from public.account_members am
    where am.account_id = v_account_id
      and am.user_id = auth.uid()
      and am.role in ('owner', 'admin')
  ) then
    raise exception 'Нет права управлять ссылками ролей';
  end if;

  insert into public.role_invite_links(role_id, account_id)
  values (p_role_id, v_account_id)
  on conflict (role_id) do update
  set updated_at = timezone('utc', now());

  return query
  select l.token, l.is_enabled
  from public.role_invite_links l
  where l.role_id = p_role_id;
end;
$$;

create or replace function public.set_role_invite_enabled(p_role_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_role_invite_link(p_role_id);
  update public.role_invite_links
  set is_enabled = coalesce(p_enabled, true),
      updated_at = timezone('utc', now())
  where role_id = p_role_id;
end;
$$;

create or replace function public.get_public_role_invite(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link public.role_invite_links%rowtype;
  v_role public.roles%rowtype;
  v_account public.accounts%rowtype;
begin
  select * into v_link from public.role_invite_links where token = p_token;
  if not found or not v_link.is_enabled then
    return jsonb_build_object('valid', false);
  end if;

  select * into v_role from public.roles where id = v_link.role_id;
  select * into v_account from public.accounts where id = v_link.account_id;

  return jsonb_build_object(
    'valid', true,
    'role_name', v_role.name,
    'company_name', v_account.name,
    'account_id', v_account.id
  );
end;
$$;

create or replace function public.accept_role_invite(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_link public.role_invite_links%rowtype;
  v_existing_role_id uuid;
  v_member_role text;
begin
  if v_uid is null then
    raise exception 'Нужно войти';
  end if;

  select * into v_link from public.role_invite_links where token = p_token;
  if not found or not v_link.is_enabled then
    raise exception 'Ссылка недействительна или отключена';
  end if;

  select am.role into v_member_role
  from public.account_members am
  where am.account_id = v_link.account_id
    and am.user_id = v_uid;

  if v_member_role in ('owner', 'admin', 'implementation') then
    raise exception 'Владельцу и администратору ссылка сотрудника не нужна';
  end if;

  select ra.role_id into v_existing_role_id
  from public.role_assignments ra
  where ra.account_id = v_link.account_id
    and ra.user_id = v_uid;

  if v_existing_role_id is not null and v_existing_role_id <> v_link.role_id then
    raise exception 'Вы уже работаете в этой компании с другой ролью. Роль меняют на странице «Роли и доступы».';
  end if;

  insert into public.account_members(account_id, user_id, role)
  values (v_link.account_id, v_uid, 'viewer')
  on conflict (account_id, user_id) do nothing;

  delete from public.role_assignments
  where account_id = v_link.account_id
    and user_id = v_uid
    and role_id <> v_link.role_id;

  insert into public.role_assignments(role_id, user_id, account_id)
  values (v_link.role_id, v_uid, v_link.account_id)
  on conflict (role_id, user_id) do nothing;

  return jsonb_build_object('account_id', v_link.account_id, 'role_id', v_link.role_id);
end;
$$;

grant execute on function public.ensure_role_invite_link(uuid) to authenticated;
grant execute on function public.set_role_invite_enabled(uuid, boolean) to authenticated;
grant execute on function public.get_public_role_invite(uuid) to anon, authenticated;
grant execute on function public.accept_role_invite(uuid) to authenticated;

-- ─── Logistics manual dates ────────────────────────────────────
alter table public.trips
  add column if not exists date_manual jsonb not null default '{}'::jsonb;

alter table public.trip_lines
  add column if not exists date_manual jsonb not null default '{}'::jsonb;

create or replace function public.set_logistics_manual_date(
  p_entity text,
  p_entity_id uuid,
  p_field text,
  p_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_wb_fields text[] := array['wb_created_at', 'planned_marketplace_delivery_date', 'wb_acceptance_date'];
begin
  if auth.uid() is null then
    raise exception 'Нужно войти';
  end if;

  if p_field = any(v_wb_fields) then
    raise exception 'Эту дату можно менять только через синхронизацию с WB';
  end if;

  if p_entity = 'trip' then
    select account_id into v_account_id from public.trips where id = p_entity_id;
    if v_account_id is null then raise exception 'Рейс не найден'; end if;
    if not exists (
      select 1 from public.account_members am
      where am.account_id = v_account_id and am.user_id = auth.uid()
    ) then raise exception 'Нет доступа'; end if;

    if p_field = 'created_at' then
      update public.trips
      set created_at = (p_date::text || 'T12:00:00Z')::timestamptz,
          date_manual = coalesce(date_manual, '{}'::jsonb) || jsonb_build_object('created_at', true)
      where id = p_entity_id;
    elsif p_field = 'departure_date' then
      update public.trips set departure_date = p_date,
        date_manual = coalesce(date_manual, '{}'::jsonb) || jsonb_build_object('departure_date', true)
      where id = p_entity_id;
    elsif p_field = 'arrived_at' then
      update public.trips set arrived_at = p_date,
        date_manual = coalesce(date_manual, '{}'::jsonb) || jsonb_build_object('arrived_at', true)
      where id = p_entity_id;
    elsif p_field = 'finished_at' then
      update public.trips set finished_at = p_date,
        date_manual = coalesce(date_manual, '{}'::jsonb) || jsonb_build_object('finished_at', true)
      where id = p_entity_id;
    else
      raise exception 'Поле даты не поддерживается';
    end if;
    return;
  end if;

  if p_entity = 'trip_line' then
    select account_id into v_account_id from public.trip_lines where id = p_entity_id;
    if v_account_id is null then raise exception 'Поставка не найдена'; end if;
    if not exists (
      select 1 from public.account_members am
      where am.account_id = v_account_id and am.user_id = auth.uid()
    ) then raise exception 'Нет доступа'; end if;

    if p_field = 'waiting_at' then
      update public.trip_lines set waiting_at = p_date,
        date_manual = coalesce(date_manual, '{}'::jsonb) || jsonb_build_object('waiting_at', true)
      where id = p_entity_id;
    elsif p_field = 'transit_at' then
      update public.trip_lines set transit_at = p_date,
        date_manual = coalesce(date_manual, '{}'::jsonb) || jsonb_build_object('transit_at', true)
      where id = p_entity_id;
    elsif p_field = 'arrival_date' then
      update public.trip_lines set arrival_date = p_date,
        date_manual = coalesce(date_manual, '{}'::jsonb) || jsonb_build_object('arrival_date', true)
      where id = p_entity_id;
    elsif p_field = 'shipped_date' then
      update public.trip_lines set shipped_date = p_date,
        date_manual = coalesce(date_manual, '{}'::jsonb) || jsonb_build_object('shipped_date', true)
      where id = p_entity_id;
    elsif p_field = 'reception_date' then
      update public.trip_lines set reception_date = p_date,
        date_manual = coalesce(date_manual, '{}'::jsonb) || jsonb_build_object('reception_date', true)
      where id = p_entity_id;
    else
      raise exception 'Поле даты не поддерживается';
    end if;
    return;
  end if;

  raise exception 'Неизвестный объект';
end;
$$;

grant execute on function public.set_logistics_manual_date(text, uuid, text, date) to authenticated;

-- ─── Logistics activity log ────────────────────────────────────
create table if not exists public.logistics_activity_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete set null,
  trip_line_id uuid references public.trip_lines(id) on delete set null,
  actor_user_id uuid,
  actor_name text,
  actor_email text,
  actor_label text not null default 'Сотрудник',
  timezone_label text,
  message text not null,
  field_key text,
  old_value text,
  new_value text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists logistics_activity_log_account_created_idx
  on public.logistics_activity_log(account_id, created_at desc);

alter table public.logistics_activity_log enable row level security;

drop policy if exists "members view logistics log" on public.logistics_activity_log;
create policy "members view logistics log"
  on public.logistics_activity_log for select
  using (
    exists (
      select 1 from public.account_members am
      where am.account_id = logistics_activity_log.account_id
        and am.user_id = auth.uid()
    )
  );

create or replace function public._logistics_actor()
returns table(user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid(), p.full_name, au.email::text
  from auth.users au
  left join public.profiles p on p.user_id = au.id
  where au.id = auth.uid();
$$;

create or replace function public.logistics_write_activity(
  p_account_id uuid,
  p_trip_id uuid,
  p_trip_line_id uuid,
  p_message text,
  p_field_key text default null,
  p_old_value text default null,
  p_new_value text default null,
  p_actor_label text default 'Сотрудник'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
begin
  select * into v_actor from public._logistics_actor();
  insert into public.logistics_activity_log(
    account_id, trip_id, trip_line_id,
    actor_user_id, actor_name, actor_email, actor_label,
    timezone_label, message, field_key, old_value, new_value
  ) values (
    p_account_id, p_trip_id, p_trip_line_id,
    v_actor.user_id, v_actor.full_name, v_actor.email, coalesce(p_actor_label, 'Сотрудник'),
    null, p_message, p_field_key, p_old_value, p_new_value
  );
end;
$$;

grant execute on function public.logistics_write_activity(uuid, uuid, uuid, text, text, text, text, text) to authenticated;

create or replace function public.fetch_logistics_activity_log(
  p_account_id uuid,
  p_limit integer default 200
)
returns setof public.logistics_activity_log
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.account_members am
    where am.account_id = p_account_id and am.user_id = auth.uid()
  ) then
    raise exception 'Нет доступа к журналу';
  end if;

  return query
  select *
  from public.logistics_activity_log
  where account_id = p_account_id
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

grant execute on function public.fetch_logistics_activity_log(uuid, integer) to authenticated;

-- ─── Excel export presets ────────────────────────────────────────
create table if not exists public.fulfillment_excel_export_presets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  columns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists fulfillment_excel_export_presets_account_idx
  on public.fulfillment_excel_export_presets(account_id, updated_at desc);

alter table public.fulfillment_excel_export_presets enable row level security;

drop policy if exists "members manage excel export presets" on public.fulfillment_excel_export_presets;
create policy "members manage excel export presets"
  on public.fulfillment_excel_export_presets for all
  using (
    exists (
      select 1 from public.account_members am
      where am.account_id = fulfillment_excel_export_presets.account_id
        and am.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.account_members am
      where am.account_id = fulfillment_excel_export_presets.account_id
        and am.user_id = auth.uid()
    )
  );

create table if not exists public.fulfillment_excel_preset_activity (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  preset_id uuid,
  preset_name text not null,
  action text not null,
  actor_user_id uuid,
  actor_name text,
  actor_email text,
  message text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists fulfillment_excel_preset_activity_account_idx
  on public.fulfillment_excel_preset_activity(account_id, created_at desc);

alter table public.fulfillment_excel_preset_activity enable row level security;

drop policy if exists "members view excel preset activity" on public.fulfillment_excel_preset_activity;
create policy "members view excel preset activity"
  on public.fulfillment_excel_preset_activity for select
  using (
    exists (
      select 1 from public.account_members am
      where am.account_id = fulfillment_excel_preset_activity.account_id
        and am.user_id = auth.uid()
    )
  );

commit;
