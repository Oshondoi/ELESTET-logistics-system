-- Revision 40: production boundary for long-lived WB / TEKSHER credentials.

do $$ declare p record; begin
  for p in select schemaname,tablename,policyname from pg_policies
    where schemaname='public' and policyname like 'dev_public_%'
  loop execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop;
end $$;

do $$ begin
  if not exists(select 1 from vault.secrets where name='store_integration_encryption_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'store_integration_encryption_key','AES/PGP envelope key for store integration secrets',null);
  end if;
end $$;

create table if not exists public.store_integration_secrets(
  store_id uuid primary key references public.stores(id) on delete cascade,
  wb_api_key_cipher bytea,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.store_integration_secrets enable row level security;

create or replace function public.store_secret_key()
returns text language sql stable security definer set search_path=public,vault as $$
  select decrypted_secret from vault.decrypted_secrets where name='store_integration_encryption_key' limit 1
$$;
revoke all on function public.store_secret_key() from public,anon,authenticated;
grant execute on function public.store_secret_key() to service_role;

insert into public.store_integration_secrets(store_id,wb_api_key_cipher,updated_by)
select id,extensions.pgp_sym_encrypt(api_key,public.store_secret_key(),'cipher-algo=aes256,compress-algo=1'),null
from public.stores where nullif(api_key,'') is not null
on conflict(store_id) do update set wb_api_key_cipher=coalesce(store_integration_secrets.wb_api_key_cipher,excluded.wb_api_key_cipher);

update public.stores set api_key=null where api_key is not null;

create or replace function public.get_store_wb_api_key(p_store_id uuid)
returns text language plpgsql stable security definer set search_path=public,vault as $$
declare v_cipher bytea;
begin
  if auth.role()<>'service_role' then raise exception 'Server-only secret'; end if;
  select wb_api_key_cipher into v_cipher from public.store_integration_secrets where store_id=p_store_id;
  if v_cipher is null then return null; end if;
  return extensions.pgp_sym_decrypt(v_cipher,public.store_secret_key());
end $$;
revoke all on function public.get_store_wb_api_key(uuid) from public,anon,authenticated;
grant execute on function public.get_store_wb_api_key(uuid) to service_role;

create or replace function public.list_server_wb_stores()
returns table(store_id uuid,account_id uuid) language plpgsql stable security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Server-only operation'; end if;
  return query select s.id,s.account_id from public.stores s join public.store_integration_secrets sec on sec.store_id=s.id
    where sec.wb_api_key_cipher is not null and s.deleted_at is null;
end $$;
revoke all on function public.list_server_wb_stores() from public,anon,authenticated;
grant execute on function public.list_server_wb_stores() to service_role;

create or replace function public.server_user_has_store_permission(p_user_id uuid,p_store_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.role()='service_role' and exists(
    select 1 from public.stores s join public.account_members am on am.account_id=s.account_id and am.user_id=p_user_id
    where s.id=p_store_id and s.deleted_at is null and (
      am.role in('owner','admin') or exists(select 1 from public.role_assignments ra join public.roles r on r.id=ra.role_id
        where ra.account_id=s.account_id and ra.user_id=p_user_id and coalesce((r.permissions->>p_permission)::boolean,false))
    )
  )
$$;
revoke all on function public.server_user_has_store_permission(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.server_user_has_store_permission(uuid,uuid,text) to service_role;

create or replace function public.save_store_wb_api_key(p_store_id uuid,p_api_key text)
returns boolean language plpgsql security definer set search_path=public,vault as $$
declare v_account uuid;
begin
  select account_id into v_account from public.stores where id=p_store_id and deleted_at is null;
  if v_account is null or not public.request_user_has_permission(v_account,'stores_manage') and not exists(
    select 1 from public.account_members where account_id=v_account and user_id=auth.uid() and role in('owner','admin')
  ) then raise exception 'Нет права изменять интеграции магазина'; end if;
  if nullif(btrim(p_api_key),'') is null then
    delete from public.store_integration_secrets where store_id=p_store_id;
  else
    insert into public.store_integration_secrets(store_id,wb_api_key_cipher,updated_by,updated_at)
    values(p_store_id,extensions.pgp_sym_encrypt(btrim(p_api_key),public.store_secret_key(),'cipher-algo=aes256,compress-algo=1'),auth.uid(),now())
    on conflict(store_id) do update set wb_api_key_cipher=excluded.wb_api_key_cipher,updated_by=auth.uid(),updated_at=now();
  end if;
  return true;
end $$;
revoke all on function public.save_store_wb_api_key(uuid,text) from public,anon,authenticated;
grant execute on function public.save_store_wb_api_key(uuid,text) to authenticated;

create or replace function public.rotate_store_integration_key(p_new_key text)
returns integer language plpgsql security definer set search_path=public,vault as $$
declare v_old text; v_row record; v_count integer:=0; v_secret_id uuid;
begin
  if not public.is_platform_superadmin() then raise exception 'Недостаточно прав'; end if;
  if length(coalesce(p_new_key,''))<32 then raise exception 'Новый ключ слишком короткий'; end if;
  v_old:=public.store_secret_key();
  for v_row in select store_id,wb_api_key_cipher from public.store_integration_secrets where wb_api_key_cipher is not null for update loop
    update public.store_integration_secrets set wb_api_key_cipher=extensions.pgp_sym_encrypt(extensions.pgp_sym_decrypt(v_row.wb_api_key_cipher,v_old),p_new_key,'cipher-algo=aes256,compress-algo=1'),key_version=key_version+1,updated_at=now() where store_id=v_row.store_id;
    v_count:=v_count+1;
  end loop;
  select id into v_secret_id from vault.secrets where name='store_integration_encryption_key';
  perform vault.update_secret(v_secret_id,p_new_key,'store_integration_encryption_key','Rotated store integration encryption key',null);
  return v_count;
end $$;
revoke all on function public.rotate_store_integration_key(text) from public,anon,authenticated;
grant execute on function public.rotate_store_integration_key(text) to authenticated;

drop function if exists public.get_account_stores_safe(uuid);
create function public.get_account_stores_safe(p_account_id uuid)
returns table(
  id uuid,account_id uuid,store_code text,name text,marketplace text,created_at timestamptz,
  supplier text,address text,ai_prompt text,inn text,supplier_full text,deleted_at timestamptz,phone text,
  teksher_participant_id text,teksher_participant_name text,teksher_balance numeric,teksher_balance_money numeric,
  teksher_products integer,teksher_operations integer,teksher_synced_at timestamptz,country text,short_id integer,
  customer_account_id uuid,restored_at timestamptz,has_api_key boolean,has_teksher_credentials boolean,
  has_company_request_link boolean
) language sql stable security definer set search_path=public as $$
  select s.id,s.account_id,s.store_code,s.name,s.marketplace,s.created_at,s.supplier,s.address,s.ai_prompt,s.inn,s.supplier_full,
    s.deleted_at,s.phone,s.teksher_participant_id,s.teksher_participant_name,s.teksher_balance,s.teksher_balance_money,
    s.teksher_products,s.teksher_operations,s.teksher_synced_at,s.country,s.short_id,s.customer_account_id,s.restored_at,
    sec.wb_api_key_cipher is not null,(nullif(s.teksher_login,'') is not null and nullif(s.teksher_password,'') is not null),
    exists(select 1 from public.service_request_invites i where i.applicant_account_id=s.customer_account_id and i.deleted_at is null and i.revoked_at is null)
  from public.stores s left join public.store_integration_secrets sec on sec.store_id=s.id
  where s.account_id=p_account_id and public.is_account_member(p_account_id)
  order by s.created_at desc
$$;
revoke all on function public.get_account_stores_safe(uuid) from public,anon,authenticated;
grant execute on function public.get_account_stores_safe(uuid) to authenticated;

-- Browser roles never receive or write long-lived secrets. Service-role Edge
-- Functions retain server-side access to the legacy encrypted TEKSHER fields.
revoke all on table public.store_integration_secrets from public,anon,authenticated;
revoke all on table public.stores from anon,authenticated;
grant select(id,account_id,store_code,name,marketplace,created_at,supplier,address,ai_prompt,inn,supplier_full,deleted_at,phone,teksher_participant_id,teksher_participant_name,teksher_balance,teksher_balance_money,teksher_products,teksher_operations,teksher_synced_at,country,short_id,customer_account_id,restored_at) on public.stores to authenticated;
grant insert(account_id,store_code,name,marketplace,supplier,address,ai_prompt,inn,supplier_full,phone,country,customer_account_id) on public.stores to authenticated;
grant update(name,marketplace,store_code,supplier,address,ai_prompt,inn,supplier_full,deleted_at,phone,country,customer_account_id,restored_at) on public.stores to authenticated;

-- The old compatibility view must not expose api_key.
drop view if exists public.stores_safe;
create view public.stores_safe with(security_invoker=true) as
select id,account_id,store_code,name,marketplace,created_at,supplier,address,ai_prompt,inn,supplier_full,deleted_at,phone,
  teksher_participant_id,teksher_participant_name,teksher_balance,teksher_balance_money,teksher_products,teksher_operations,
  teksher_synced_at,country,short_id,customer_account_id,restored_at
from public.stores;
revoke all on public.stores_safe from anon;
grant select on public.stores_safe to authenticated;

create table if not exists public.user_ai_secrets(
  user_id uuid primary key references auth.users(id) on delete cascade,
  claude_key_cipher bytea not null,
  claude_model text not null default 'claude-sonnet-4-6',
  updated_at timestamptz not null default now()
);
alter table public.user_ai_secrets enable row level security;
revoke all on table public.user_ai_secrets from public,anon,authenticated;

create or replace function public.save_my_diary_ai_secret(p_api_key text,p_model text)
returns boolean language plpgsql security definer set search_path=public,vault as $$
begin
  if auth.uid() is null then raise exception 'Не авторизован'; end if;
  if nullif(btrim(p_api_key),'') is null then
    if exists(select 1 from public.user_ai_secrets where user_id=auth.uid()) then
      update public.user_ai_secrets set claude_model=coalesce(nullif(btrim(p_model),''),claude_model),updated_at=now() where user_id=auth.uid();
    else raise exception 'Введите API-ключ'; end if;
  else
    insert into public.user_ai_secrets(user_id,claude_key_cipher,claude_model)
    values(auth.uid(),extensions.pgp_sym_encrypt(btrim(p_api_key),public.store_secret_key(),'cipher-algo=aes256,compress-algo=1'),coalesce(nullif(btrim(p_model),''),'claude-sonnet-4-6'))
    on conflict(user_id) do update set claude_key_cipher=excluded.claude_key_cipher,claude_model=excluded.claude_model,updated_at=now();
  end if;
  return true;
end $$;
create or replace function public.delete_my_diary_ai_secret()
returns boolean language plpgsql security definer set search_path=public as $$ begin delete from public.user_ai_secrets where user_id=auth.uid(); return true; end $$;
create or replace function public.get_my_diary_ai_settings()
returns table(configured boolean,claude_model text) language sql stable security definer set search_path=public as $$
  select true,claude_model from public.user_ai_secrets where user_id=auth.uid()
$$;
create or replace function public.get_server_diary_ai_secret(p_user_id uuid)
returns table(api_key text,claude_model text) language plpgsql stable security definer set search_path=public,vault as $$
begin
  if auth.role()<>'service_role' then raise exception 'Server-only secret'; end if;
  return query select extensions.pgp_sym_decrypt(s.claude_key_cipher,public.store_secret_key()),s.claude_model from public.user_ai_secrets s where s.user_id=p_user_id;
end $$;
revoke all on function public.save_my_diary_ai_secret(text,text) from public,anon,authenticated;
revoke all on function public.delete_my_diary_ai_secret() from public,anon,authenticated;
revoke all on function public.get_my_diary_ai_settings() from public,anon,authenticated;
revoke all on function public.get_server_diary_ai_secret(uuid) from public,anon,authenticated;
grant execute on function public.save_my_diary_ai_secret(text,text) to authenticated;
grant execute on function public.delete_my_diary_ai_secret() to authenticated;
grant execute on function public.get_my_diary_ai_settings() to authenticated;
grant execute on function public.get_server_diary_ai_secret(uuid) to service_role;

-- Account-level AI credentials used by Reviews are also server-only.
create table if not exists public.account_ai_secrets(
  account_id uuid primary key references public.accounts(id) on delete cascade,
  openai_key_cipher bytea,
  claude_key_cipher bytea,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.account_ai_secrets enable row level security;

insert into public.account_ai_secrets(account_id,openai_key_cipher,claude_key_cipher)
select account_id,
  case when nullif(openai_key,'') is null then null else extensions.pgp_sym_encrypt(openai_key,public.store_secret_key(),'cipher-algo=aes256,compress-algo=1') end,
  case when nullif(claude_key,'') is null then null else extensions.pgp_sym_encrypt(claude_key,public.store_secret_key(),'cipher-algo=aes256,compress-algo=1') end
from public.account_ai_settings
where nullif(openai_key,'') is not null or nullif(claude_key,'') is not null
on conflict(account_id) do update set
  openai_key_cipher=coalesce(public.account_ai_secrets.openai_key_cipher,excluded.openai_key_cipher),
  claude_key_cipher=coalesce(public.account_ai_secrets.claude_key_cipher,excluded.claude_key_cipher);
update public.account_ai_settings set openai_key='',claude_key='' where openai_key<>'' or claude_key<>'';

create or replace function public.account_user_has_permission(p_account_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.account_members am where am.account_id=p_account_id and am.user_id=auth.uid() and am.role in ('owner','admin'))
    or exists(
      select 1 from public.role_assignments ra join public.roles r on r.id=ra.role_id and r.account_id=ra.account_id
      join public.account_members am on am.account_id=ra.account_id and am.user_id=ra.user_id
      where ra.account_id=p_account_id and ra.user_id=auth.uid() and coalesce((r.permissions->>p_permission)::boolean,false)
    )
$$;
revoke all on function public.account_user_has_permission(uuid,text) from public,anon,authenticated;
grant execute on function public.account_user_has_permission(uuid,text) to authenticated,service_role;

create or replace function public.get_account_ai_settings_safe(p_account_id uuid)
returns table(account_id uuid,provider text,openai_key text,model text,claude_key text,claude_model text,tone text,system_prompt text,updated_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.account_user_has_permission(p_account_id,'reviews_view') then raise exception 'Недостаточно прав'; end if;
  return query select s.account_id,s.provider,
    case when x.openai_key_cipher is null then '' else '__configured__' end,
    s.model,case when x.claude_key_cipher is null then '' else '__configured__' end,
    s.claude_model,s.tone,s.system_prompt,s.updated_at
  from public.account_ai_settings s left join public.account_ai_secrets x using(account_id)
  where s.account_id=p_account_id;
end $$;

create or replace function public.save_account_ai_settings_secure(
  p_account_id uuid,p_provider text,p_openai_key text,p_model text,p_claude_key text,p_claude_model text,p_tone text,p_system_prompt text
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public.account_user_has_permission(p_account_id,'reviews_ai') then raise exception 'Недостаточно прав'; end if;
  insert into public.account_ai_settings(account_id,provider,model,claude_model,tone,system_prompt,updated_at)
  values(p_account_id,p_provider,p_model,p_claude_model,p_tone,nullif(btrim(p_system_prompt),''),now())
  on conflict(account_id) do update set provider=excluded.provider,model=excluded.model,claude_model=excluded.claude_model,tone=excluded.tone,system_prompt=excluded.system_prompt,updated_at=now();
  insert into public.account_ai_secrets(account_id,updated_by) values(p_account_id,auth.uid()) on conflict(account_id) do nothing;
  if p_openai_key<>'__configured__' then
    update public.account_ai_secrets set openai_key_cipher=case when nullif(btrim(p_openai_key),'') is null then null else extensions.pgp_sym_encrypt(btrim(p_openai_key),public.store_secret_key(),'cipher-algo=aes256,compress-algo=1') end,updated_at=now(),updated_by=auth.uid() where account_id=p_account_id;
  end if;
  if p_claude_key<>'__configured__' then
    update public.account_ai_secrets set claude_key_cipher=case when nullif(btrim(p_claude_key),'') is null then null else extensions.pgp_sym_encrypt(btrim(p_claude_key),public.store_secret_key(),'cipher-algo=aes256,compress-algo=1') end,updated_at=now(),updated_by=auth.uid() where account_id=p_account_id;
  end if;
  return true;
end $$;

create or replace function public.get_server_account_ai_settings(p_account_id uuid)
returns table(account_id uuid,provider text,openai_key text,model text,claude_key text,claude_model text,tone text,system_prompt text)
language plpgsql stable security definer set search_path=public,vault as $$
begin
  if auth.role()<>'service_role' then raise exception 'Server-only secret'; end if;
  return query select s.account_id,s.provider,
    case when x.openai_key_cipher is null then '' else extensions.pgp_sym_decrypt(x.openai_key_cipher,public.store_secret_key()) end,
    s.model,case when x.claude_key_cipher is null then '' else extensions.pgp_sym_decrypt(x.claude_key_cipher,public.store_secret_key()) end,
    s.claude_model,s.tone,s.system_prompt
  from public.account_ai_settings s left join public.account_ai_secrets x using(account_id) where s.account_id=p_account_id;
end $$;

revoke all on public.account_ai_settings from anon,authenticated;
grant select(account_id,provider,model,claude_model,tone,system_prompt,updated_at) on public.account_ai_settings to authenticated;
revoke all on public.account_ai_secrets from public,anon,authenticated;
revoke all on function public.get_account_ai_settings_safe(uuid) from public,anon,authenticated;
revoke all on function public.save_account_ai_settings_secure(uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.get_server_account_ai_settings(uuid) from public,anon,authenticated;
grant execute on function public.get_account_ai_settings_safe(uuid) to authenticated;
grant execute on function public.save_account_ai_settings_secure(uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.get_server_account_ai_settings(uuid) to service_role;
