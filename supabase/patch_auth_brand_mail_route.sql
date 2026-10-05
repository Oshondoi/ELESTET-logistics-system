begin;
alter table public.email_delivery_requests add column if not exists brand_account_id uuid;
create or replace function public.reserve_invite_email_number(p_email text,p_request_id uuid,p_purpose text,p_invite uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target uuid; old_target uuid; result jsonb;
begin
 if p_purpose is null or p_purpose not in ('signup','invite','recovery') then raise exception 'Invalid purpose'; end if;
 select executor_account_id into target from public.service_request_invites where token=p_invite and deleted_at is null and revoked_at is null and expires_at>now();
 if target is null then raise exception 'Ссылка недоступна'; end if;
 result:=public.reserve_email_delivery_number(p_email,p_request_id,p_purpose);
 select brand_account_id into old_target from public.email_delivery_requests where request_id=p_request_id for update;
 if old_target is not null and old_target<>target then raise exception 'Request context conflict'; end if;
 update public.email_delivery_requests set brand_account_id=target where request_id=p_request_id;
 return result;
end $$;
revoke all on function public.reserve_invite_email_number(text,uuid,text,uuid) from public;
grant execute on function public.reserve_invite_email_number(text,uuid,text,uuid) to anon,authenticated;
create or replace function public.resolve_auth_mail_route(p_email text,p_number text,p_time text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare target uuid; mail public.company_brand_mail%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only'; end if;
 select r.brand_account_id into target from public.email_delivery_requests r
 where r.recipient_hash=encode(digest(lower(btrim(p_email)),'sha256'),'hex') and r.number::text=p_number
 and to_char(r.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')=p_time;
 perform 1 from public.accounts where id=target and deleted_at is null and plan<>'none' and plan_until>now() and logo_subscription_until>now() for update;
 if not found then return jsonb_build_object('allowed',true); end if;
 select * into mail from public.company_brand_mail where account_id=target;
 if not coalesce(mail.fallback_allowed,false) then
  if not exists(select 1 from public.batch_notifications where account_id=target and type='brand_mail_blocked' and created_at>now()-interval '1 hour') then
   insert into public.batch_notifications(account_id,type,title,body,recipient_user_id)
   select target,'brand_mail_blocked','Не удалось отправить код клиенту','Подключите отправителя бренда или разрешите резервную отправку от ELESTET.',m.user_id
   from public.account_members m where m.account_id=target and m.role='owner';
  end if;
  return jsonb_build_object('allowed',false);
 end if;
 return jsonb_build_object('allowed',true,'reply_to',case when mail.verified_at is not null then mail.email end);
end $$;
revoke all on function public.resolve_auth_mail_route(text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_auth_mail_route(text,text,text) to service_role;
-- Preserve the reservation function's positional INSERT after extending its table.
create or replace function public.reserve_email_delivery_number(p_email text,p_request_id uuid,p_purpose text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare v_email text:=lower(btrim(p_email)); v_hash text; v_request public.email_delivery_requests%rowtype;
v_counter public.email_delivery_counters%rowtype; v_now timestamptz:=clock_timestamp();
begin
 if p_request_id is null or v_email is null or length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or p_purpose is null or p_purpose not in ('signup','recovery','invite','notification','campaign') then raise exception 'Invalid email request' using errcode='22023'; end if;
 if p_purpose in ('notification','campaign') and coalesce(auth.role(),'')<>'service_role' then raise exception 'Server delivery only' using errcode='42501'; end if;
 v_hash:=encode(digest(v_email,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,731));
 select * into v_request from public.email_delivery_requests where request_id=p_request_id;
 if found then
  if v_request.recipient_hash<>v_hash or v_request.purpose<>p_purpose then raise exception 'Request conflict' using errcode='22023'; end if;
  return jsonb_build_object('number',v_request.number::text,'requested_at',to_char(v_request.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
 end if;
 insert into public.email_delivery_counters(recipient_hash) values(v_hash) on conflict do nothing;
 select * into v_counter from public.email_delivery_counters where recipient_hash=v_hash for update;
 if coalesce(auth.role(),'')<>'service_role' and v_counter.last_requested_at>v_now-interval '60 seconds' then raise exception 'Подождите минуту перед повторной отправкой кода.' using errcode='P0001'; end if;
 update public.email_delivery_counters set last_number=last_number+1,last_requested_at=v_now where recipient_hash=v_hash returning * into v_counter;
 insert into public.email_delivery_requests(request_id,recipient_hash,number,purpose,requested_at) values(p_request_id,v_hash,v_counter.last_number,p_purpose,v_now);
 return jsonb_build_object('number',v_counter.last_number::text,'requested_at',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end $$;
notify pgrst,'reload schema';
commit;
