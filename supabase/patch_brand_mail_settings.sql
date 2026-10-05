begin;
create table if not exists public.company_brand_mail (
 account_id uuid primary key references public.accounts(id),
 email text, verified_at timestamptz,
 fallback_allowed boolean not null default false,
 consent_actor uuid, consent_at timestamptz,
 pending_email text, challenge_id uuid, code_hash text,
 expires_at timestamptz, attempts integer not null default 0,
 requested_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.brand_mail_attempts (
 id uuid primary key, account_id uuid not null, recipient_hash text not null,
 created_at timestamptz not null default now()
);
create index if not exists brand_mail_attempts_recipient on public.brand_mail_attempts(recipient_hash,created_at);
create table if not exists public.brand_mail_audit (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, actor_id uuid not null,
 action text not null, created_at timestamptz not null default now()
);
alter table public.company_brand_mail enable row level security;
alter table public.brand_mail_attempts enable row level security;
alter table public.brand_mail_audit enable row level security;
revoke all on public.company_brand_mail,public.brand_mail_attempts,public.brand_mail_audit from public,anon,authenticated;
create or replace function public.can_manage_brand_mail(p_account uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.accounts a join public.account_members m on m.account_id=a.id
 where a.id=p_account and a.deleted_at is null and m.user_id=p_user and (m.role='owner' or exists(
 select 1 from public.role_assignments ra join public.roles r on r.id=ra.role_id and r.account_id=ra.account_id
 where ra.account_id=a.id and ra.user_id=p_user and r.permissions->>'brand_mail_manage'='true')))
$$;
revoke all on function public.can_manage_brand_mail(uuid,uuid) from public,anon,authenticated;
create or replace function public.get_brand_mail_settings(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare s public.company_brand_mail%rowtype;
begin
 if not public.can_manage_brand_mail(p_account,auth.uid()) then return jsonb_build_object('allowed',false); end if;
 select * into s from public.company_brand_mail where account_id=p_account;
 return jsonb_build_object('allowed',true,'email',s.email,'verified_at',s.verified_at,
 'fallback_allowed',coalesce(s.fallback_allowed,false),'pending_email',s.pending_email,
 'challenge_id',s.challenge_id,'expires_at',s.expires_at,'requested_at',s.requested_at,
 'letter_number',(select r.number::text from public.email_delivery_dispatches d join public.email_delivery_requests r on r.request_id=d.request_id where d.event_key=encode(digest('brand-email:'||s.challenge_id::text,'sha256'),'hex')));
end $$;
create or replace function public.set_brand_mail_fallback(p_account uuid,p_allowed boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.can_manage_brand_mail(p_account,auth.uid()) or p_allowed is null then raise exception 'Нет права управления почтой бренда'; end if;
 insert into public.company_brand_mail(account_id,fallback_allowed,consent_actor,consent_at)
 values(p_account,p_allowed,auth.uid(),now()) on conflict(account_id) do update
 set fallback_allowed=p_allowed,consent_actor=auth.uid(),consent_at=now(),updated_at=now();
 insert into public.brand_mail_audit(account_id,actor_id,action) values(p_account,auth.uid(),case when p_allowed then 'fallback_allowed' else 'fallback_revoked' end);
end $$;
create or replace function public.begin_brand_mail_verification(p_account uuid,p_user uuid,p_email text,p_challenge uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.company_brand_mail%rowtype; recipient text:=lower(btrim(p_email)); v_recipient_hash text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only'; end if;
 if not public.can_manage_brand_mail(p_account,p_user) then raise exception 'Нет права управления почтой бренда'; end if;
 if recipient is null or length(recipient)>254 or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or p_challenge is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Проверьте адрес почты'; end if;
 v_recipient_hash:=encode(digest(recipient,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(v_recipient_hash,894));
 perform 1 from public.accounts where id=p_account for update;
 insert into public.company_brand_mail(account_id) values(p_account) on conflict do nothing;
 select * into s from public.company_brand_mail where account_id=p_account for update;
 if s.requested_at>now()-interval '60 seconds' then raise exception 'Повторная отправка доступна через минуту'; end if;
 if (select count(*) from public.brand_mail_attempts where created_at>now()-interval '1 hour' and (account_id=p_account or recipient_hash=v_recipient_hash))>=10 then raise exception 'Слишком много запросов. Попробуйте через час'; end if;
 insert into public.brand_mail_attempts(id,account_id,recipient_hash) values(p_challenge,p_account,v_recipient_hash);
 update public.company_brand_mail set pending_email=recipient,challenge_id=p_challenge,code_hash=p_hash,
 expires_at=now()+interval '10 minutes',attempts=0,requested_at=now(),updated_at=now() where account_id=p_account;
 return jsonb_build_object('email',recipient,'challenge_id',p_challenge);
end $$;
create or replace function public.verify_brand_mail(p_account uuid,p_user uuid,p_challenge uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.company_brand_mail%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only'; end if;
 if not public.can_manage_brand_mail(p_account,p_user) then raise exception 'Нет права управления почтой бренда'; end if;
 select * into s from public.company_brand_mail where account_id=p_account for update;
 if not found or s.challenge_id is distinct from p_challenge or s.expires_at<=now() or s.attempts>=5 or s.code_hash is null then
 return jsonb_build_object('ok',false,'message','Запросите новый код'); end if;
 update public.company_brand_mail set attempts=attempts+1 where account_id=p_account;
 if s.code_hash is distinct from p_hash then return jsonb_build_object('ok',false,'message','Неверный код'); end if;
 update public.company_brand_mail set email=s.pending_email,verified_at=now(),pending_email=null,challenge_id=null,code_hash=null,expires_at=null,updated_at=now() where account_id=p_account;
 insert into public.brand_mail_audit(account_id,actor_id,action) values(p_account,p_user,'email_verified');
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.get_brand_mail_settings(uuid),public.set_brand_mail_fallback(uuid,boolean) from public,anon;
grant execute on function public.get_brand_mail_settings(uuid),public.set_brand_mail_fallback(uuid,boolean) to authenticated;
revoke all on function public.begin_brand_mail_verification(uuid,uuid,text,uuid,text),public.verify_brand_mail(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_brand_mail_verification(uuid,uuid,text,uuid,text),public.verify_brand_mail(uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
