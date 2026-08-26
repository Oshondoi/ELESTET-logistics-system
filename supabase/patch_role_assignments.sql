-- A role is a reusable permission template. Users are assigned through a
-- junction table so one role can be used by any number of employees.
create table if not exists public.role_assignments (
  role_id uuid not null references public.roles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (role_id, user_id)
);

create index if not exists role_assignments_account_user_idx
  on public.role_assignments(account_id, user_id);

-- Preserve every assignment created by the old one-user-per-role model.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'roles'
      and column_name = 'assigned_user_id'
  ) then
    execute $migration$
      insert into public.role_assignments (role_id, user_id, account_id)
      select id, assigned_user_id, account_id
      from public.roles
      where assigned_user_id is not null
      on conflict (role_id, user_id) do nothing
    $migration$;
  end if;
end;
$$;

alter table public.role_assignments enable row level security;
grant select, insert, delete on public.role_assignments to authenticated;

drop policy if exists "members can view role assignments" on public.role_assignments;
create policy "members can view role assignments"
  on public.role_assignments for select
  using (
    exists (
      select 1 from public.account_members am
      where am.account_id = role_assignments.account_id
        and am.user_id = auth.uid()
    )
  );

drop policy if exists "owners and admins can manage role assignments" on public.role_assignments;
create policy "owners and admins can manage role assignments"
  on public.role_assignments for all
  using (
    exists (
      select 1 from public.account_members am
      where am.account_id = role_assignments.account_id
        and am.user_id = auth.uid()
        and am.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.account_members am
      where am.account_id = role_assignments.account_id
        and am.user_id = auth.uid()
        and am.role in ('owner', 'admin')
    )
  );

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
begin
  select account_id into v_account_id from public.roles where id = p_role_id;
  if v_account_id is null then
    raise exception 'Роль не найдена';
  end if;

  delete from public.role_assignments
  where role_id = p_role_id
    and not (user_id = any(coalesce(p_user_ids, '{}'::uuid[])));

  insert into public.role_assignments(role_id, user_id, account_id)
  select p_role_id, user_id, v_account_id
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as user_id
  on conflict (role_id, user_id) do nothing;
end;
$$;

grant execute on function public.set_role_assignments(uuid, uuid[]) to authenticated;

create or replace function public.get_role_assignments(p_account_id uuid)
returns table(
  role_id uuid,
  user_id uuid,
  email text,
  full_name text,
  short_id integer
)
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
    raise exception 'Нет доступа к сотрудникам этой компании';
  end if;

  return query
  select ra.role_id,
         ra.user_id,
         coalesce(au.email::text, ''),
         coalesce(p.full_name, ''),
         p.short_id
  from public.role_assignments ra
  join auth.users au on au.id = ra.user_id
  left join public.profiles p on p.user_id = ra.user_id
  where ra.account_id = p_account_id
  order by p.full_name nulls last, au.email;
end;
$$;

grant execute on function public.get_role_assignments(uuid) to authenticated;

create or replace function public.enforce_role_assignment_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select account_id into new.account_id from public.roles where id = new.role_id;
  if new.account_id is null then
    raise exception 'Роль не найдена';
  end if;
  return new;
end;
$$;

drop trigger if exists role_assignments_enforce_account on public.role_assignments;
create trigger role_assignments_enforce_account
  before insert or update on public.role_assignments
  for each row execute function public.enforce_role_assignment_account();

create or replace function public.sync_role_assignment_to_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.account_members(account_id, user_id, role)
    values (new.account_id, new.user_id, 'viewer')
    on conflict (account_id, user_id) do nothing;
    return new;
  end if;

  if not exists (
    select 1 from public.role_assignments ra
    where ra.account_id = old.account_id and ra.user_id = old.user_id
  ) then
    delete from public.account_members
    where account_id = old.account_id and user_id = old.user_id and role = 'viewer';
  end if;
  return old;
end;
$$;

drop trigger if exists role_assignments_sync_member on public.role_assignments;
create trigger role_assignments_sync_member
  after insert or delete on public.role_assignments
  for each row execute function public.sync_role_assignment_to_member();

-- The old trigger/column encoded a single assignee and must no longer be used.
drop trigger if exists roles_sync_member on public.roles;
alter table public.roles drop column if exists assigned_user_id;
