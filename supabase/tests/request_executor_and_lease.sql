-- LOCAL empty-clone regression only. Fixtures always rolled back.
begin;
do $test$
declare
 u uuid:=gen_random_uuid(); a uuid; e uuid; n integer; r uuid; i uuid;
 d1 uuid:=gen_random_uuid(); d2 uuid:=gen_random_uuid(); rows_count integer;
begin
 insert into auth.users(id,email,email_confirmed_at,created_at) values(u,u||'@example.invalid',now(),now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.accounts(name) values('Applicant fixture') returning id into a;
 insert into public.accounts(name) values('Executor fixture') returning id,short_id into e,n;
 insert into public.account_members(account_id,user_id,role) values(a,u,'owner');
 if (select count(*) from public.search_executor_accounts(n::text))<>1 then raise exception 'Exact ID missing'; end if;
 if exists(select 1 from public.search_executor_accounts('Executor fixture'))
 or exists(select 1 from public.search_executor_accounts('C-'||n)) then raise exception 'Name/prefix accepted'; end if;
 insert into public.service_requests(applicant_account_id,executor_account_id,title,applicant_name,applicant_email,current_version)
 values(a,e,'Test','Tester',u||'@example.invalid',1) returning id into r;
 if exists(select 1 from public.list_recent_request_executors(a)) then raise exception 'Unaccepted executor listed'; end if;
 insert into public.service_request_versions(request_id,version,event_type,snapshot,confirmed_by)
 values(r,1,'accepted',jsonb_build_object('request',jsonb_build_object('applicant_account_id',a,'executor_account_id',e)),u);
 if (select count(*) from public.list_recent_request_executors(a))<>1 then raise exception 'Accepted executor missing'; end if;
 -- History survives a later pending correction (accepted_at can be null).
 update public.service_requests set accepted_at=null where id=r;
 if (select count(*) from public.list_recent_request_executors(a))<>1 then raise exception 'Accepted history lost'; end if;
 insert into public.service_request_invites(executor_account_id,created_by,expires_at,initial_expires_at)
 values(e,u,'infinity','infinity') returning id into i;
 insert into public.service_request_invite_reserves(invite_id,user_id,email,full_name,expires_at,draft)
 values(i,u,u||'@example.invalid','Tester','infinity','{}');
 perform public.open_my_request_reserve(i,d1);
 update public.service_request_invite_reserves set lease_last_seen=now()-interval '10 minutes' where invite_id=i;
 if not public.heartbeat_my_request_reserve(i,d1) then raise exception 'Idle owner cannot resume'; end if;
 perform public.save_my_request_reserve(i,'{"title":"preserved"}',d1);
 begin
   perform public.open_my_request_reserve(i,d2);
   raise exception 'TEST: active owner was displaced';
 exception when others then
   if sqlerrm like 'TEST:%' then raise; end if;
 end;
 update public.service_request_invite_reserves set lease_last_seen=now()-interval '10 minutes' where invite_id=i;
 perform public.open_my_request_reserve(i,d2);
 if public.heartbeat_my_request_reserve(i,d1) then raise exception 'Old owner renewed after takeover'; end if;
 begin
   perform public.save_my_request_reserve(i,'{"title":"wrong"}',d1);
   raise exception 'TEST: old owner overwrote draft';
 exception when others then
   if sqlerrm like 'TEST:%' then raise; end if;
 end;
 if (select draft->>'title' from public.service_request_invite_reserves where invite_id=i)<>'preserved' then raise exception 'Draft lost'; end if;
end $test$;
rollback;

