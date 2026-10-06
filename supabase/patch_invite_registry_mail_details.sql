-- Function-only updates; no historical links, mail, users or subscriptions rewritten.
begin;
create or replace function public.invite_registry_state(i public.service_request_invites,p_reserved boolean)
returns text language sql stable set search_path=public as $$
 select case when i.delete_reason='expired' then 'expired'
 when i.delete_reason='replaced_by_applicant' then 'replaced'
 when i.deleted_at is not null then 'deleted' when i.revoked_at is not null then 'replaced'
 when i.expires_at<=now() then 'expired'
 when i.expires_at='infinity'::timestamptz then 'bound'
 when i.applicant_account_id is not null then 'bound_pending'
 when p_reserved then 'reserved' else 'active' end
$$;
revoke all on function public.invite_registry_state(public.service_request_invites,boolean) from public,anon,authenticated;

create or replace function public.admin_list_service_request_invites_v2()
returns table(id uuid,token uuid,state text,created_at timestamptz,expires_at timestamptz,
 creator_email text,executor_id uuid,executor_name text,applicant_id uuid,applicant_short_id integer,applicant_name text,
 reserved_email text,reserved_name text,email_confirmed boolean,request_count bigint,batch_count bigint,
 ended_at timestamptz,end_reason text,auth_created_at timestamptz,company_created_at timestamptz,is_available boolean)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_platform_superadmin() then raise exception 'Недостаточно прав' using errcode='42501'; end if;
 return query
 select i.id,i.token,public.invite_registry_state(i,r.invite_id is not null),i.created_at,i.expires_at,
 creator.email::text,i.executor_account_id,e.name,i.applicant_account_id,a.short_id,a.name,
 coalesce(r.email,u.email::text),coalesce(r.full_name,profile.full_name),
 case when u.id is null then null else u.email_confirmed_at is not null end,
 (select count(*) from public.service_requests sr where sr.invite_id=i.id and sr.deleted_at is null),
 (select count(*) from public.fulfillment_batches fb join public.service_requests sr on sr.id=fb.source_request_id where sr.invite_id=i.id and sr.deleted_at is null and fb.deleted_at is null),
 case when i.delete_reason='expired' then i.initial_expires_at when i.delete_reason='replaced_by_applicant' then coalesce(i.revoked_at,i.deleted_at) when i.deleted_at is not null then i.deleted_at
 when i.revoked_at is not null then i.revoked_at when i.expires_at<=now() then i.expires_at end,
 case when i.delete_reason='expired' then 'Срок действия ссылки истёк'
 when i.delete_reason='replaced_by_applicant' then 'Заменена другой ссылкой'
 when i.deleted_at is not null then case i.delete_reason when 'data_deleted_by_superadmin' then 'Данные ссылки удалены администратором' when 'detached_by_superadmin' then 'Ссылка отвязана администратором' else 'Ссылка удалена' end
 when i.revoked_at is not null then 'Заменена другой ссылкой' when i.expires_at<=now() then 'Срок действия ссылки истёк' end,
 u.created_at,a.created_at,i.deleted_at is null and i.revoked_at is null and i.expires_at>now()
 from public.service_request_invites i join public.accounts e on e.id=i.executor_account_id
 left join public.accounts a on a.id=i.applicant_account_id
 left join auth.users creator on creator.id=i.created_by
 left join public.service_request_invite_reserves r on r.invite_id=i.id
 left join lateral(select m.user_id from public.account_members m where m.account_id=i.applicant_account_id and m.role='owner' order by m.created_at,m.user_id limit 1) owner_member on true
 left join auth.users u on u.id=coalesce(r.user_id,i.claimed_by,owner_member.user_id)
 left join public.profiles profile on profile.user_id=u.id
 order by i.created_at desc,i.id;
end $$;
revoke all on function public.admin_list_service_request_invites_v2() from public,anon;
grant execute on function public.admin_list_service_request_invites_v2() to authenticated;

-- Preserve the old return type for other callers while fixing its state/auth data too.
create or replace function public.admin_list_service_request_invites()
returns table(id uuid,token uuid,state text,created_at timestamptz,expires_at timestamptz,
 creator_email text,executor_id uuid,executor_name text,applicant_id uuid,applicant_short_id integer,applicant_name text,
 reserved_email text,reserved_name text,email_confirmed boolean,request_count bigint,batch_count bigint)
language sql stable security definer set search_path=public as $$
 select x.id,x.token,x.state,x.created_at,x.expires_at,x.creator_email,x.executor_id,x.executor_name,x.applicant_id,x.applicant_short_id,x.applicant_name,x.reserved_email,x.reserved_name,x.email_confirmed,x.request_count,x.batch_count
 from public.admin_list_service_request_invites_v2() x
$$;

create or replace function public.admin_preview_service_request_invite(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare link record; result jsonb;
begin
 if not public.is_platform_superadmin() then raise exception 'Недостаточно прав' using errcode='42501'; end if;
 select * into link from public.admin_list_service_request_invites_v2() x where x.token=p_token;
 if not found then raise exception 'Ссылка не найдена'; end if;
 select jsonb_build_object('invite_id',link.id,'state',link.state,'expires_at',link.expires_at,'ended_at',link.ended_at,'end_reason',link.end_reason,
 'email',link.reserved_email,'full_name',link.reserved_name,'email_confirmed',link.email_confirmed,'auth_created_at',link.auth_created_at,'company_created_at',link.company_created_at,
 'executor',jsonb_build_object('id',link.executor_id,'name',link.executor_name,'short_id',e.short_id),
 'applicant',case when link.applicant_id is null then null else jsonb_build_object('id',link.applicant_id,'name',link.applicant_name,'short_id',link.applicant_short_id) end,
 'reserve',case when r.invite_id is null then null else jsonb_build_object('email',r.email,'full_name',r.full_name,'draft',r.draft,'expires_at',r.expires_at) end,
 'requests',coalesce((select jsonb_agg(jsonb_build_object('id',sr.id,'short_id',sr.short_id,'status',sr.status,'title',sr.title,'current_version',sr.current_version) order by sr.created_at) from public.service_requests sr where sr.invite_id=link.id and sr.deleted_at is null),'[]')) into result
 from public.accounts e left join public.service_request_invite_reserves r on r.invite_id=link.id where e.id=link.executor_id;
 return result;
end $$;

-- Only the actually connected sender is advertised. Own-domain sending remains unconnected.
-- Both reservation metadata and the Auth route use this same decision.
create or replace function public.auth_sender_display_name(p_account uuid) returns text
language sql stable security definer set search_path=public as $$
 select case when exists(select 1 from public.accounts a where a.id=p_account and a.deleted_at is null and a.plan<>'none' and a.plan_until>now() and a.logo_subscription_until>now())
 and not coalesce((select m.fallback_allowed from public.company_brand_mail m where m.account_id=p_account),false)
 then null else 'ELESTET' end
$$;
revoke all on function public.auth_sender_display_name(uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_account_stores_safe(p_account_id uuid)
 RETURNS TABLE(id uuid, account_id uuid, store_code text, name text, marketplace text, created_at timestamp with time zone, supplier text, address text, ai_prompt text, inn text, supplier_full text, deleted_at timestamp with time zone, phone text, teksher_participant_id text, teksher_participant_name text, teksher_balance numeric, teksher_balance_money numeric, teksher_products integer, teksher_operations integer, teksher_synced_at timestamp with time zone, country text, short_id integer, customer_account_id uuid, restored_at timestamp with time zone, has_api_key boolean, has_teksher_credentials boolean, has_company_request_link boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id,s.account_id,s.store_code,s.name,s.marketplace,s.created_at,s.supplier,s.address,s.ai_prompt,s.inn,s.supplier_full,
    s.deleted_at,s.phone,s.teksher_participant_id,s.teksher_participant_name,s.teksher_balance,s.teksher_balance_money,
    s.teksher_products,s.teksher_operations,s.teksher_synced_at,s.country,s.short_id,s.customer_account_id,s.restored_at,
    sec.wb_api_key_cipher is not null,(nullif(s.teksher_login,'') is not null and nullif(s.teksher_password,'') is not null),
    exists(select 1 from public.service_request_invites i where i.applicant_account_id=s.customer_account_id and i.deleted_at is null and i.revoked_at is null and i.expires_at>now())
  from public.stores s left join public.store_integration_secrets sec on sec.store_id=s.id
  where s.account_id=p_account_id and public.is_account_member(p_account_id)
  order by s.created_at desc
$function$
;
CREATE OR REPLACE FUNCTION public.get_customer_company_request_links(p_executor_account_id uuid)
 RETURNS TABLE(customer_account_id uuid, token uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct s.customer_account_id,i.token
  from public.stores s
  join public.service_request_invites i on i.applicant_account_id=s.customer_account_id
    and i.deleted_at is null and i.revoked_at is null and i.expires_at>now()
  where s.account_id=p_executor_account_id and s.deleted_at is null
    and public.is_account_member(p_executor_account_id)
$function$
;
CREATE OR REPLACE FUNCTION public.reserve_email_delivery_number(p_email text, p_request_id uuid, p_purpose text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
  return jsonb_build_object('number',v_request.number::text,'sender_name','ELESTET','requested_at',to_char(v_request.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
 end if;
 insert into public.email_delivery_counters(recipient_hash) values(v_hash) on conflict do nothing;
 select * into v_counter from public.email_delivery_counters where recipient_hash=v_hash for update;
 if coalesce(auth.role(),'')<>'service_role' and v_counter.last_requested_at>v_now-interval '60 seconds' then raise exception 'Подождите минуту перед повторной отправкой кода.' using errcode='P0001'; end if;
 update public.email_delivery_counters set last_number=last_number+1,last_requested_at=v_now where recipient_hash=v_hash returning * into v_counter;
 insert into public.email_delivery_requests(request_id,recipient_hash,number,purpose,requested_at) values(p_request_id,v_hash,v_counter.last_number,p_purpose,v_now);
 return jsonb_build_object('number',v_counter.last_number::text,'sender_name','ELESTET','requested_at',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end $function$
;
CREATE OR REPLACE FUNCTION public.reserve_invite_email_number(p_email text, p_request_id uuid, p_purpose text, p_invite uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare target uuid; old_target uuid; result jsonb;
begin
 if p_purpose is null or p_purpose not in ('signup','invite','recovery') then raise exception 'Invalid purpose'; end if;
 select executor_account_id into target from public.service_request_invites where token=p_invite and deleted_at is null and revoked_at is null and expires_at>now();
 if target is null then raise exception 'Ссылка недоступна'; end if;
 result:=public.reserve_email_delivery_number(p_email,p_request_id,p_purpose);
 select brand_account_id into old_target from public.email_delivery_requests where request_id=p_request_id for update;
 if old_target is not null and old_target<>target then raise exception 'Request context conflict'; end if;
 update public.email_delivery_requests set brand_account_id=target where request_id=p_request_id;
 return result||jsonb_build_object('sender_name',public.auth_sender_display_name(target));
end $function$
;
CREATE OR REPLACE FUNCTION public.resolve_auth_mail_route(p_email text, p_number text, p_time text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare target uuid; mail public.company_brand_mail%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only'; end if;
 select r.brand_account_id into target from public.email_delivery_requests r
 where r.recipient_hash=encode(digest(lower(btrim(p_email)),'sha256'),'hex') and r.number::text=p_number
 and to_char(r.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')=p_time;
 perform 1 from public.accounts where id=target and deleted_at is null and plan<>'none' and plan_until>now() and logo_subscription_until>now() for update;
 if not found then return jsonb_build_object('allowed',true,'sender_name',public.auth_sender_display_name(target)); end if;
 select * into mail from public.company_brand_mail where account_id=target;
 if not coalesce(mail.fallback_allowed,false) then
  if not exists(select 1 from public.batch_notifications where account_id=target and type='brand_mail_blocked' and created_at>now()-interval '1 hour') then
   insert into public.batch_notifications(account_id,type,title,body,recipient_user_id)
   select target,'brand_mail_blocked','Не удалось отправить код клиенту','Подключите отправителя бренда или разрешите резервную отправку от ELESTET.',m.user_id
   from public.account_members m where m.account_id=target and m.role='owner';
  end if;
  return jsonb_build_object('allowed',false);
 end if;
 return jsonb_build_object('allowed',true,'sender_name',public.auth_sender_display_name(target),'reply_to',case when mail.verified_at is not null then mail.email end);
end $function$
;
CREATE OR REPLACE FUNCTION public.queue_new_notification_mail()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare executor_label text;
begin
 -- New events only; existing notifications are never backfilled. No business data in email previews.
 if new.type='brand_mail_blocked' then return new; end if;
 select format('C-%s · %s',e.short_id,left(e.name,200)) into executor_label
 from public.service_requests r join public.accounts e on e.id=r.executor_account_id
 where r.id=new.source_request_id and new.account_id in (r.applicant_account_id,r.executor_account_id);
 insert into public.numbered_mail_queue(event_id,account_id,user_id,purpose,heading,message,portal)
 select 'notification:'||new.id||':'||m.user_id,new.account_id,m.user_id,'notification','Новое уведомление',
 case when executor_label is not null then 'Исполнитель заявки: '||executor_label||'. ' else '' end||'Откройте уведомление в личном кабинете.',
 exists(select 1 from public.service_requests r where r.id=new.source_request_id and r.applicant_account_id=new.account_id)
 from public.account_members m join public.mail_preferences p on p.user_id=m.user_id and p.notifications
 join auth.users u on u.id=m.user_id and u.email_confirmed_at is not null
 where m.account_id=new.account_id and (new.recipient_user_id is null or new.recipient_user_id=m.user_id)
 on conflict(event_id) do nothing;
 return new;
end $function$
;

notify pgrst,'reload schema';
commit;
