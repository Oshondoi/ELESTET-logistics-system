-- Implementation is a platform-managed grant, never a customer role template.
-- No customer memberships, payments or subscriptions are changed by this migration.
begin;
create table public.implementation_staff (
 user_id uuid primary key references auth.users(id), active boolean not null default true,
 eligible boolean not null default false, updated_at timestamptz not null default now()
);
create table public.implementation_projects (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
 payment_reference text not null unique, paid_som bigint not null check(paid_som>0), paid_at timestamptz not null,
 status text not null default 'paid' check(status in ('paid','active','completed')),
 started_at timestamptz, completed_at timestamptz, version integer not null default 0
);
create unique index implementation_one_open on public.implementation_projects(account_id) where status<>'completed';
create table public.implementation_assignments (
 project_id uuid not null references public.implementation_projects(id), user_id uuid not null references auth.users(id),
 assigned_by uuid not null, assigned_at timestamptz not null default now(), revoked_at timestamptz,
 primary key(project_id,user_id)
);
-- A compatibility membership lets the existing RLS / RPC checks see a worker.
-- Its original role is restored atomically on revocation; it is not a customer role.
create table public.implementation_member_bridge (
 account_id uuid not null references public.accounts(id), user_id uuid not null references auth.users(id),
 original_role text, primary key(account_id,user_id)
);
create table public.implementation_audit (
 id bigint generated always as identity primary key, account_id uuid, project_id uuid,
 actor_id uuid, subject_id uuid, event text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
alter table public.implementation_staff enable row level security;
alter table public.implementation_projects enable row level security;
alter table public.implementation_assignments enable row level security;
alter table public.implementation_member_bridge enable row level security;
alter table public.implementation_audit enable row level security;
revoke all on public.implementation_staff, public.implementation_projects, public.implementation_assignments,
 public.implementation_member_bridge, public.implementation_audit from public,anon,authenticated;

create function public.is_implementation_owner() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where user_id=auth.uid() and short_id=1 and platform_role='superadmin')
$$;
create function public.implementation_access(p_account uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.implementation_projects p join public.accounts a on a.id=p.account_id
 join public.implementation_assignments x on x.project_id=p.id and x.user_id=p_user and x.revoked_at is null
 where p.account_id=p_account and p.status='active' and a.deleted_at is null and (
 exists(select 1 from public.profiles f where f.user_id=p_user and f.short_id=1 and f.platform_role='superadmin')
 or exists(select 1 from public.implementation_staff s where s.user_id=p_user and s.active and s.eligible)))
$$;
create function public.implementation_require_owner() returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_implementation_owner() then raise exception 'Только владелец ELESTET U-1' using errcode='42501';end if;
 -- Serializes lifecycle/staff changes, not business work in client companies.
 perform pg_advisory_xact_lock(178941,1);
end $$;

create function public.implementation_sync_member(p_account uuid,p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare old_role text; b public.implementation_member_bridge%rowtype;
begin
 perform set_config('app.implementation_internal','on',true);
 select * into b from public.implementation_member_bridge where account_id=p_account and user_id=p_user for update;
 if public.implementation_access(p_account,p_user) then
  if not found then
   select role into old_role from public.account_members where account_id=p_account and user_id=p_user for update;
   insert into public.implementation_member_bridge values(p_account,p_user,old_role);
   insert into public.account_members(account_id,user_id,role) values(p_account,p_user,'admin')
   on conflict(account_id,user_id) do update set role=case when account_members.role='owner' then 'owner' else 'admin' end;
  end if;
 elsif found then
  if b.original_role is null then delete from public.account_members where account_id=p_account and user_id=p_user;
  else update public.account_members set role=b.original_role where account_id=p_account and user_id=p_user;end if;
  delete from public.implementation_member_bridge where account_id=p_account and user_id=p_user;
 end if;
 perform set_config('app.implementation_internal','off',true);
end $$;

-- This entrypoint is only for a trusted payment adapter. Browsers cannot mark paid.
-- The adapter must validate provider signature, company, expected order amount/currency first.
create function public.register_implementation_payment(p_account uuid,p_reference text,p_amount bigint,p_paid_at timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare p public.implementation_projects%rowtype; k uuid;
begin
 perform pg_advisory_xact_lock(178941,1);
 if p_reference is null or length(trim(p_reference)) not between 3 and 200 or p_amount is null or p_amount<=0
 or p_paid_at is null or p_paid_at>now() then raise exception 'Некорректное подтверждение оплаты';end if;
 select * into p from public.implementation_projects where payment_reference=p_reference;
 if found then
  if p.account_id<>p_account or p.paid_som<>p_amount or p.paid_at<>p_paid_at then raise exception 'Конфликт платёжного подтверждения';end if;
  return p.id;
 end if;
 if not exists(select 1 from public.accounts where id=p_account and deleted_at is null) then raise exception 'Компания недоступна';end if;
 insert into public.implementation_projects(account_id,payment_reference,paid_som,paid_at)
 values(p_account,p_reference,p_amount,p_paid_at) returning id into k;
 insert into public.implementation_audit(account_id,project_id,actor_id,event,details)
 values(p_account,k,auth.uid(),'payment_registered',jsonb_build_object('reference',p_reference,'amount_som',p_amount));
 return k;
end $$;

create function public.admin_set_implementation_staff(p_short_id integer,p_active boolean,p_eligible boolean)
returns void language plpgsql security definer set search_path=public as $$
declare u uuid; pair record;
begin
 perform public.implementation_require_owner();
 if p_active is null or p_eligible is null or p_short_id is null or p_short_id=1 then raise exception 'Некорректный сотрудник';end if;
 select user_id into u from public.profiles where short_id=p_short_id;
 if u is null then raise exception 'Пользователь не найден';end if;
 insert into public.implementation_staff(user_id,active,eligible) values(u,p_active,p_eligible)
 on conflict(user_id) do update set active=excluded.active,eligible=excluded.eligible,updated_at=now();
 if not p_active or not p_eligible then
  update public.implementation_assignments set revoked_at=now() where user_id=u and revoked_at is null;
  for pair in select account_id from public.implementation_member_bridge where user_id=u loop
   perform public.implementation_sync_member(pair.account_id,u);
  end loop;
 end if;
 insert into public.implementation_audit(actor_id,subject_id,event,details)
 values(auth.uid(),u,'staff_changed',jsonb_build_object('active',p_active,'eligible',p_eligible));
end $$;

create function public.admin_assign_implementation(p_project uuid,p_user uuid,p_assign boolean,p_version integer)
returns void language plpgsql security definer set search_path=public as $$
declare p public.implementation_projects%rowtype;
begin
 perform public.implementation_require_owner();
 select * into p from public.implementation_projects where id=p_project for update;
 if not found or p.status='completed' then raise exception 'Оплаченное внедрение недоступно';end if;
 if p_version is distinct from p.version then raise exception 'Данные изменились. Обновите список';end if;
 if p_assign is null or p_user is null or exists(select 1 from public.profiles where user_id=p_user and short_id=1) then raise exception 'Доступ U-1 управляется автоматически';end if;
 if p_assign and not exists(select 1 from public.implementation_staff where user_id=p_user and active and eligible) then
  raise exception 'Нужен действующий сотрудник ELESTET с допуском к внедрению';end if;
 if p_assign then
  insert into public.implementation_assignments(project_id,user_id,assigned_by) values(p.id,p_user,auth.uid())
  on conflict(project_id,user_id) do update set revoked_at=null,assigned_by=auth.uid(),assigned_at=now();
 else update public.implementation_assignments set revoked_at=now() where project_id=p.id and user_id=p_user and revoked_at is null;end if;
 perform public.implementation_sync_member(p.account_id,p_user);
 update public.implementation_projects set version=version+1 where id=p.id;
 insert into public.implementation_audit(account_id,project_id,actor_id,subject_id,event)
 values(p.account_id,p.id,auth.uid(),p_user,case when p_assign then 'assigned' else 'revoked' end);
end $$;

create function public.admin_transition_implementation(p_project uuid,p_action text,p_version integer)
returns void language plpgsql security definer set search_path=public as $$
declare p public.implementation_projects%rowtype; u record;
begin
 perform public.implementation_require_owner();
 select * into p from public.implementation_projects where id=p_project for update;
 if not found then raise exception 'Внедрение не найдено';end if;
 if (p_action='start' and p.status='active') or (p_action='complete' and p.status='completed') then return;end if;
 if p_version is distinct from p.version then raise exception 'Данные изменились. Обновите список';end if;
 if p_action='start' and p.status='paid' then
  if not exists(select 1 from public.accounts where id=p.account_id and deleted_at is null and plan='operational' and plan_until>now()) then
   raise exception 'Сначала требуется оплаченный Операционный период для согласованного запуска';end if;
  update public.implementation_projects set status='active',started_at=now(),version=version+1 where id=p.id;
  insert into public.implementation_assignments(project_id,user_id,assigned_by) values(p.id,auth.uid(),auth.uid());
 elsif p_action='complete' and p.status='active' then
  update public.implementation_projects set status='completed',completed_at=now(),version=version+1 where id=p.id;
 else raise exception 'Недопустимый переход внедрения';end if;
 for u in select user_id from public.implementation_assignments where project_id=p.id and revoked_at is null loop
  perform public.implementation_sync_member(p.account_id,u.user_id);
 end loop;
 insert into public.implementation_audit(account_id,project_id,actor_id,event)
 values(p.account_id,p.id,auth.uid(),case when p_action='start' then 'started' else 'completed' end);
end $$;

create function public.admin_implementation_overview() returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.is_implementation_owner() then raise exception 'Только владелец ELESTET U-1' using errcode='42501';end if;
 return jsonb_build_object(
 'staff',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('short_id',f.short_id,'full_name',f.full_name) order by f.short_id)
 from public.implementation_staff s join public.profiles f on f.user_id=s.user_id),'[]'::jsonb),
 'projects',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('company_name',a.name,'company_short_id',a.short_id,
 'assignments',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('short_id',f.short_id,'full_name',f.full_name))
 from public.implementation_assignments x join public.profiles f on f.user_id=x.user_id where x.project_id=p.id and x.revoked_at is null),'[]'::jsonb)) order by p.paid_at desc)
 from public.implementation_projects p join public.accounts a on a.id=p.account_id),'[]'::jsonb));
end $$;
create function public.admin_implementation_history(p_project uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not public.is_implementation_owner() then raise exception 'Только владелец ELESTET U-1' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select * from public.implementation_audit
 where p_project is null or project_id=p_project order by id desc limit 100) x),'[]'::jsonb);
end $$;

-- Customer roles cannot mutate the platform bridge or grant a lasting role to its holder.
create function public.guard_implementation_membership() returns trigger language plpgsql set search_path=public as $$
declare a uuid; u uuid;
begin
 if current_user not in ('authenticated','anon') and current_setting('app.implementation_internal',true)='on' then
  if tg_op='DELETE' then return old;else return new;end if;
 end if;
 if tg_op<>'INSERT' then
  a:=old.account_id;u:=old.user_id;
  if exists(select 1 from public.implementation_member_bridge where account_id=a and user_id=u) then
   raise exception 'Системный доступ внедрения меняется только через админку ELESTET' using errcode='42501';end if;
 end if;
 if tg_op<>'DELETE' then
  a:=new.account_id;u:=new.user_id;
  if exists(select 1 from public.implementation_member_bridge where account_id=a and user_id=u) then
   raise exception 'Нельзя заменить системный доступ клиентской ролью' using errcode='42501';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
-- The guard needs private-table reads but must retain the caller identity check above.
-- Expose only a boolean predicate to the invoker; no private table SELECT grant.
create function public.has_implementation_bridge(p_account uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.implementation_member_bridge where account_id=p_account and user_id=p_user)
$$;
do $$ declare d text;begin
 select pg_get_functiondef('public.guard_implementation_membership()'::regprocedure) into d;
 d:=replace(d,'exists(select 1 from public.implementation_member_bridge where account_id=a and user_id=u)','public.has_implementation_bridge(a,u)');execute d;
end $$;
create trigger implementation_guard_member before insert or update or delete on public.account_members for each row execute function public.guard_implementation_membership();
create trigger implementation_guard_assignment before insert or update or delete on public.role_assignments for each row execute function public.guard_implementation_membership();

create function public.implementation_restricted_actor(p_account uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.implementation_member_bridge where account_id=p_account and user_id=auth.uid() and original_role is distinct from 'owner')
$$;
create function public.guard_implementation_account() returns trigger language plpgsql set search_path=public as $$
begin
 -- Preserve U-1's independently authorized platform RPCs, not direct client writes.
 if public.implementation_restricted_actor(old.id) and
 (current_user in ('authenticated','anon') or not public.is_implementation_owner()) then
  if tg_op='DELETE' or (to_jsonb(new)-array['name','logo_url']) is distinct from (to_jsonb(old)-array['name','logo_url']) then
   raise exception 'Внедрение не даёт права удаления компании, передачи владения или изменения оплаты' using errcode='42501';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger implementation_guard_account before update or delete on public.accounts for each row execute function public.guard_implementation_account();
create policy implementation_update_company on public.accounts for update to authenticated
 using(public.implementation_access(id,auth.uid())) with check(public.implementation_access(id,auth.uid()));

create function public.audit_implementation_work() returns trigger language plpgsql security definer set search_path=public as $$
declare r jsonb; a uuid; p uuid;
begin
 if tg_op='DELETE' then r:=to_jsonb(old);else r:=to_jsonb(new);end if;
 a:=nullif(r->>'account_id','')::uuid;
 if a is null and tg_table_name='accounts' then a:=(r->>'id')::uuid;end if;
 if a is not null and public.implementation_access(a,auth.uid()) then
  select id into p from public.implementation_projects where account_id=a and status='active';
  insert into public.implementation_audit(account_id,project_id,actor_id,event,details)
  values(a,p,auth.uid(),'work',jsonb_build_object('table',tg_table_name,'operation',tg_op,'id',r->>'id'));
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
-- Metadata only: never log API keys, OTPs, passwords or business row contents.
do $$ declare t record;begin
 for t in select table_name from information_schema.columns where table_schema='public' and column_name='account_id'
 and table_name not like 'implementation_%' and table_name not like 'calendar_%' and table_name not like 'company_balance%'
 and table_name not like 'company_billing%' and table_name not like '%audit%' and table_name not like '%queue%'
 and table_name not like '%notification%' and table_name not like '%event%' and table_name not like '%history%'
 and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=table_name and c.relkind='r')
 loop execute format('create trigger implementation_work_audit after insert or update or delete on public.%I for each row execute function public.audit_implementation_work()',t.table_name);end loop;
end $$;
create trigger implementation_work_audit after update on public.accounts for each row execute function public.audit_implementation_work();

revoke all on function public.is_implementation_owner(),public.implementation_access(uuid,uuid),public.implementation_require_owner(),
 public.implementation_sync_member(uuid,uuid),public.register_implementation_payment(uuid,text,bigint,timestamptz),
 public.admin_set_implementation_staff(integer,boolean,boolean),public.admin_assign_implementation(uuid,uuid,boolean,integer),
 public.admin_transition_implementation(uuid,text,integer),public.admin_implementation_overview(),public.admin_implementation_history(uuid),
 public.guard_implementation_membership(),public.guard_implementation_account(),public.implementation_restricted_actor(uuid),public.has_implementation_bridge(uuid,uuid),public.audit_implementation_work()
 from public,anon,authenticated;
grant execute on function public.is_implementation_owner(),public.implementation_access(uuid,uuid),public.has_implementation_bridge(uuid,uuid),public.implementation_restricted_actor(uuid),
 public.admin_set_implementation_staff(integer,boolean,boolean),public.admin_assign_implementation(uuid,uuid,boolean,integer),
 public.admin_transition_implementation(uuid,text,integer),public.admin_implementation_overview(),public.admin_implementation_history(uuid) to authenticated;
grant execute on function public.register_implementation_payment(uuid,text,bigint,timestamptz) to service_role;
commit;
