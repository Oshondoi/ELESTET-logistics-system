begin;
create table if not exists public.mail_preferences(
 user_id uuid primary key references auth.users(id) on delete cascade,
 notifications boolean not null default false,campaigns boolean not null default false,updated_at timestamptz not null default now()
);
alter table public.mail_preferences enable row level security;
revoke all on public.mail_preferences from public,anon,authenticated;
create or replace function public.get_mail_preferences() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('notifications',coalesce((select notifications from public.mail_preferences where user_id=auth.uid()),false),
 'campaigns',coalesce((select campaigns from public.mail_preferences where user_id=auth.uid()),false))
$$;
create or replace function public.set_mail_preferences(p_notifications boolean,p_campaigns boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or p_notifications is null or p_campaigns is null then raise exception 'Войдите в аккаунт'; end if;
 insert into public.mail_preferences values(auth.uid(),p_notifications,p_campaigns,now()) on conflict(user_id) do update set notifications=p_notifications,campaigns=p_campaigns,updated_at=now();
end $$;
revoke all on function public.get_mail_preferences(),public.set_mail_preferences(boolean,boolean) from public,anon;
grant execute on function public.get_mail_preferences(),public.set_mail_preferences(boolean,boolean) to authenticated;
create table if not exists public.numbered_mail_queue(
 id uuid primary key default gen_random_uuid(), event_id text not null unique,
 account_id uuid not null references public.accounts(id),user_id uuid not null references auth.users(id) on delete cascade,
 purpose text not null check(purpose in ('notification','campaign')),portal boolean not null default false,
 heading text not null check(length(heading) between 1 and 200),message text not null check(length(message) between 1 and 5000),
 status text not null default 'queued' check(status in ('queued','sending','sent','skipped','failed','blocked')),
 attempts integer not null default 0, available_at timestamptz not null default now(),created_at timestamptz not null default now(),
 lease uuid,recipient_email text,reply_to text,route_key text,first_attempt_at timestamptz,completed_at timestamptz,block_notified boolean not null default false
);
create index if not exists numbered_mail_queue_pending on public.numbered_mail_queue(available_at) where status in ('queued','sending','blocked');
alter table public.numbered_mail_queue enable row level security;
revoke all on public.numbered_mail_queue from public,anon,authenticated;
create or replace function public.enqueue_numbered_mail(p_event text,p_account uuid,p_user uuid,p_purpose text,p_heading text,p_message text,p_portal boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare job uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only'; end if;
 if p_event is null or length(p_event) not between 1 and 200 or p_purpose not in ('notification','campaign') or p_portal is null then raise exception 'Invalid mail'; end if;
 if not exists(select 1 from public.account_members m join auth.users u on u.id=m.user_id join public.mail_preferences p on p.user_id=u.id
 where m.account_id=p_account and m.user_id=p_user and u.email_confirmed_at is not null and case when p_purpose='campaign' then p.campaigns else p.notifications end) then return null; end if;
 insert into public.numbered_mail_queue(event_id,account_id,user_id,purpose,heading,message,portal)
 values(p_event,p_account,p_user,p_purpose,p_heading,p_message,p_portal) on conflict(event_id) do nothing returning id into job;
 if job is null then
  select id into job from public.numbered_mail_queue where event_id=p_event and account_id=p_account and user_id=p_user and purpose=p_purpose and heading=p_heading and message=p_message and portal=p_portal;
  if job is null then raise exception 'Mail event conflict'; end if;
 end if;
 return job;
end $$;
revoke all on function public.enqueue_numbered_mail(text,uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_numbered_mail(text,uuid,uuid,text,text,text,boolean) to service_role;
create or replace function public.queue_new_notification_mail() returns trigger language plpgsql security definer set search_path=public as $$
begin
 -- New events only; existing notifications are never backfilled. No business data in email previews.
 if new.type='brand_mail_blocked' then return new; end if;
 insert into public.numbered_mail_queue(event_id,account_id,user_id,purpose,heading,message,portal)
 select 'notification:'||new.id||':'||m.user_id,new.account_id,m.user_id,'notification','Новое уведомление',
 'Откройте уведомления в личном кабинете. Настройки получения писем доступны в профиле.',
 exists(select 1 from public.service_requests r where r.id=new.source_request_id and r.applicant_account_id=new.account_id)
 from public.account_members m join public.mail_preferences p on p.user_id=m.user_id and p.notifications
 join auth.users u on u.id=m.user_id and u.email_confirmed_at is not null
 where m.account_id=new.account_id and (new.recipient_user_id is null or new.recipient_user_id=m.user_id)
 on conflict(event_id) do nothing;
 return new;
end $$;
revoke all on function public.queue_new_notification_mail() from public,anon,authenticated;
drop trigger if exists queue_new_notification_mail on public.batch_notifications;
create trigger queue_new_notification_mail after insert on public.batch_notifications for each row execute function public.queue_new_notification_mail();
create or replace function public.claim_numbered_mail() returns jsonb language plpgsql security definer set search_path=public as $$
declare q public.numbered_mail_queue%rowtype; target uuid; mail public.company_brand_mail%rowtype; address text; brand_active boolean; result jsonb:='[]'; token uuid; routing text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only'; end if;
 for q in select * from public.numbered_mail_queue where status in ('queued','sending','blocked') and available_at<=now() order by created_at limit 10 for update skip locked loop
  if q.attempts>=8 or q.first_attempt_at<now()-interval '19 hours' or q.created_at<now()-interval '7 days' then
   update public.numbered_mail_queue set status='failed' where id=q.id;continue;
  end if;
  select u.email into address from auth.users u join public.mail_preferences p on p.user_id=u.id
  where u.id=q.user_id and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())
   and case when q.purpose='campaign' then p.campaigns else p.notifications end
   and exists(select 1 from public.account_members m join public.accounts a on a.id=m.account_id where m.account_id=q.account_id and m.user_id=u.id and a.deleted_at is null);
  if address is null or (q.recipient_email is not null and q.recipient_email<>address) then
   update public.numbered_mail_queue set status='skipped' where id=q.id;continue;
  end if;
  target:=q.account_id;
  if q.portal then
   select i.executor_account_id into target from public.service_request_invites i where i.applicant_account_id=q.account_id and i.deleted_at is null and i.revoked_at is null and i.expires_at>now() order by i.bound_at desc nulls last,i.created_at desc limit 1;
  end if;
  select exists(select 1 from public.accounts a where a.id=target and a.deleted_at is null and a.plan<>'none' and a.plan_until>now() and a.logo_subscription_until>now()) into brand_active;
  select * into mail from public.company_brand_mail where account_id=target;
  -- Custom sender domains are not connected yet. Fallback is NEVER implied.
  if brand_active and not coalesce(mail.fallback_allowed,false) then
   update public.numbered_mail_queue set status='blocked',available_at=now()+interval '15 minutes',block_notified=true where id=q.id;
   if not q.block_notified then
    insert into public.batch_notifications(account_id,type,title,body,recipient_user_id)
    select target,'brand_mail_blocked','Почта бренда не подключена','Письмо ожидает настройки отправителя или разрешения резервной отправки от ELESTET.',m.user_id
    from public.account_members m where m.account_id=target and m.role='owner';
   end if;
   continue;
  end if;
  routing:=case when brand_active then target::text||':'||coalesce(case when mail.verified_at is not null then mail.email end,'') else 'elestet' end;
  if q.route_key is not null and q.route_key<>routing then
   update public.numbered_mail_queue set status='skipped' where id=q.id;continue;
  end if;
  token:=gen_random_uuid();
  update public.numbered_mail_queue set status='sending',attempts=attempts+1,lease=token,available_at=now()+interval '90 seconds',
   recipient_email=address,route_key=routing,first_attempt_at=coalesce(first_attempt_at,now()),
   reply_to=case when first_attempt_at is not null then reply_to when brand_active and mail.verified_at is not null then mail.email else null end
   where id=q.id returning * into q;
  result:=result||jsonb_build_array(jsonb_build_object('id',q.id,'lease',token,'to',address,'purpose',q.purpose,'heading',q.heading,'message',q.message,'reply_to',q.reply_to));
 end loop;
 return result;
end $$;
create or replace function public.finish_numbered_mail(p_id uuid,p_lease uuid,p_success boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only'; end if;
 if p_success is null then raise exception 'Invalid result'; end if;
 update public.numbered_mail_queue set status=case when p_success then 'sent' when attempts>=8 then 'failed' else 'queued' end,
 completed_at=case when p_success then now() else null end,available_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer))
 where id=p_id and lease=p_lease and status='sending';
end $$;
revoke all on function public.claim_numbered_mail(),public.finish_numbered_mail(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_numbered_mail(),public.finish_numbered_mail(uuid,uuid,boolean) to service_role;
create or replace function public.admin_mail_queue() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from public.profiles where user_id=auth.uid() and platform_role='superadmin') then raise exception 'Только superadmin'; end if;
 return jsonb_build_object('counts',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.numbered_mail_queue group by status)x),'{}'),
 'jobs',coalesce((select jsonb_agg(x) from (select q.id,a.short_id,a.name,q.purpose,q.status,q.attempts,q.created_at,q.available_at,q.completed_at
 from public.numbered_mail_queue q join public.accounts a on a.id=q.account_id order by q.created_at desc limit 100)x),'[]'));
end $$;
revoke all on function public.admin_mail_queue() from public,anon;
grant execute on function public.admin_mail_queue() to authenticated;
notify pgrst,'reload schema';
commit;
