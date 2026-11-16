-- Group numbers for workshop collections: G-1, G-2, separate from party P numbers.
-- A workshop batch does not take the next party number.
-- Safe to run again.

alter table public.fulfillment_batches
  add column if not exists workshop_only boolean not null default false;

alter table public.fulfillment_workshop_pools
  add column if not exists short_id integer;

create unique index if not exists fulfillment_workshop_pools_account_short_id_uidx
  on public.fulfillment_workshop_pools (account_id, short_id)
  where short_id is not null;

do $$
declare
  v_name text;
begin
  select constraint_row.conname into v_name
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.account_number_counters'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) ilike '%entity%';
  if v_name is not null then
    execute format('alter table public.account_number_counters drop constraint %I', v_name);
  end if;
end $$;

alter table public.account_number_counters
  add constraint account_number_counters_entity_check
  check (entity in ('store', 'batch', 'group'));

create or replace function public.next_account_number(p_account_id uuid, p_entity text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value integer;
begin
  if p_entity not in ('store', 'batch', 'group') then
    raise exception 'Unknown number scope';
  end if;
  insert into public.account_number_counters(account_id, entity, last_value)
  values (p_account_id, p_entity, 1)
  on conflict (account_id, entity) do update
  set last_value = public.account_number_counters.last_value + 1
  returning last_value into v_value;
  return v_value;
end $$;

create or replace function public.assign_batch_short_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.short_id is null and coalesce(new.workshop_only, false) = false then
    new.short_id := public.next_account_number(new.account_id, 'batch');
  end if;
  return new;
end $$;

update public.fulfillment_batches batch
set workshop_only = true,
    short_id = null
from public.fulfillment_workshop_pools pool
where pool.batch_id = batch.id
  and batch.workshop_only is distinct from true;

update public.account_number_counters counter
set last_value = coalesce((
  select max(batch.short_id)
  from public.fulfillment_batches batch
  where batch.account_id = counter.account_id
    and batch.short_id is not null
), 0)
where counter.entity = 'batch'
  and counter.last_value > coalesce((
    select max(batch.short_id)
    from public.fulfillment_batches batch
    where batch.account_id = counter.account_id
      and batch.short_id is not null
  ), 0);

with ordered as (
  select pool.batch_id,
         row_number() over (
           partition by pool.account_id
           order by batch.created_at, pool.batch_id
         )::integer as group_number
  from public.fulfillment_workshop_pools pool
  join public.fulfillment_batches batch on batch.id = pool.batch_id
  where pool.short_id is null
)
update public.fulfillment_workshop_pools pool
set short_id = ordered.group_number
from ordered
where pool.batch_id = ordered.batch_id;

insert into public.account_number_counters(account_id, entity, last_value)
select pool.account_id, 'group', coalesce(max(pool.short_id), 0)
from public.fulfillment_workshop_pools pool
group by pool.account_id
on conflict (account_id, entity) do update
set last_value = greatest(public.account_number_counters.last_value, excluded.last_value);

create or replace function public.start_workshop_boxes(p_batch_id uuid)
returns public.fulfillment_workshop_pools
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_pool public.fulfillment_workshop_pools;
begin
  select account_id into v_account
  from public.fulfillment_batches
  where id = p_batch_id;
  if v_account is null then
    raise exception 'Партия не найдена';
  end if;
  perform public.assert_workshop_member(v_account);

  insert into public.fulfillment_workshop_pools (batch_id, account_id, issued_count, active, short_id)
  values (p_batch_id, v_account, 100, true, public.next_account_number(v_account, 'group'))
  on conflict (batch_id) do nothing;

  select * into v_pool
  from public.fulfillment_workshop_pools
  where batch_id = p_batch_id;

  if v_pool.short_id is null then
    update public.fulfillment_workshop_pools
    set short_id = public.next_account_number(v_account, 'group')
    where batch_id = p_batch_id
      and short_id is null
    returning * into v_pool;
  end if;

  if v_pool.active is distinct from true then
    raise exception 'Сбор уже был. Нажмите «Продолжить».';
  end if;
  return v_pool;
end;
$$;
