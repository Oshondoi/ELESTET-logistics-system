-- Accounting only. Does not provision DNS/HTTPS/From or change tenant routing.
begin;
create table if not exists public.company_domain_registry(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 hostname text not null unique,
 source text not null check(source in ('new','existing')),
 registration_expires_on date,
 registrar text not null default '' check(length(registrar)<=120),
 site_state text not null default 'not_connected' check(site_state in ('not_connected','awaiting_dns','reported_connected','disabled','error')),
 mail_state text not null default 'not_connected' check(mail_state in ('not_connected','awaiting_dns','reported_connected','disabled','error')),
 notes text not null default '' check(length(notes)<=2000),
 version integer not null default 1,
 updated_by uuid not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(hostname=lower(hostname) and length(hostname)<=253 and hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$')
);
create table if not exists public.company_domain_registry_audit(
 id bigint generated always as identity primary key,
 domain_id uuid not null references public.company_domain_registry(id),
 actor_id uuid not null,created_at timestamptz not null default now(),
 previous jsonb,next jsonb not null
);
alter table public.company_domain_registry enable row level security;
alter table public.company_domain_registry_audit enable row level security;
revoke all on public.company_domain_registry,public.company_domain_registry_audit from public,anon,authenticated;

create or replace function public.admin_list_company_domains() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_platform_superadmin() then raise exception 'Недостаточно прав' using errcode='42501';end if;
 return jsonb_build_object('domains',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('company_name',a.name,'company_short_id',a.short_id) order by d.updated_at desc,d.id) from public.company_domain_registry d join public.accounts a on a.id=d.account_id),'[]'),
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'short_id',a.short_id) order by a.name,a.id) from public.accounts a where a.deleted_at is null),'[]'));
end $$;
create or replace function public.admin_save_company_domain(p_id uuid,p_version integer,p_account_id uuid,p_hostname text,p_source text,p_expires_on date,p_registrar text,p_site_state text,p_mail_state text,p_notes text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare old_row public.company_domain_registry%rowtype; saved public.company_domain_registry%rowtype; host text:=lower(btrim(p_hostname));
begin
 if not public.is_platform_superadmin() then raise exception 'Недостаточно прав' using errcode='42501';end if;
 if not exists(select 1 from public.accounts where id=p_account_id and deleted_at is null) then raise exception 'Выберите действующую компанию';end if;
 if host is null or length(host)>253 or host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' or host ~ '(^|\.)elestet\.net$' or host ~ '\.localhost$' then raise exception 'Укажите клиентский домен без протокола, пути и порта; для кириллицы используйте Punycode';end if;
 if p_id is null then
  insert into public.company_domain_registry(account_id,hostname,source,registration_expires_on,registrar,site_state,mail_state,notes,updated_by)
  values(p_account_id,host,p_source,p_expires_on,btrim(coalesce(p_registrar,'')),p_site_state,p_mail_state,btrim(coalesce(p_notes,'')),auth.uid()) returning * into saved;
 else
  select * into old_row from public.company_domain_registry where id=p_id for update;
  if not found then raise exception 'Запись не найдена';end if;
  if p_version is distinct from old_row.version then raise exception 'Запись изменена другим администратором. Обновите список и откройте её заново.';end if;
  if old_row.account_id<>p_account_id or old_row.hostname<>host then raise exception 'Компания и адрес существующей записи не меняются; создайте новую запись';end if;
  update public.company_domain_registry set source=p_source,registration_expires_on=p_expires_on,registrar=btrim(coalesce(p_registrar,'')),site_state=p_site_state,mail_state=p_mail_state,notes=btrim(coalesce(p_notes,'')),version=version+1,updated_by=auth.uid(),updated_at=now() where id=p_id returning * into saved;
 end if;
 insert into public.company_domain_registry_audit(domain_id,actor_id,previous,next) values(saved.id,auth.uid(),case when p_id is null then null else to_jsonb(old_row) end,to_jsonb(saved));
 return to_jsonb(saved);
exception when unique_violation then raise exception 'Этот домен уже есть в реестре';
 when check_violation or not_null_violation then raise exception 'Проверьте значения и длину полей';
end $$;
create or replace function public.admin_company_domain_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_platform_superadmin() then raise exception 'Недостаточно прав' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (select * from public.company_domain_registry_audit where domain_id=p_id order by id desc limit 100) x),'[]');
end $$;
revoke all on function public.admin_list_company_domains(), public.admin_save_company_domain(uuid,integer,uuid,text,text,date,text,text,text,text),public.admin_company_domain_history(uuid) from public,anon;
grant execute on function public.admin_list_company_domains(),public.admin_save_company_domain(uuid,integer,uuid,text,text,date,text,text,text,text),public.admin_company_domain_history(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
