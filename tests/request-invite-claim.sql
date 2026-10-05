-- Always rollback; no persistent test users or companies.
begin;
do $$
declare
  u uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  a uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  result record;
begin
  insert into auth.users(id,email) values (u,u::text||'@example.invalid'),(stranger,stranger::text||'@example.invalid');
  insert into public.accounts(id,name) values(a,'Rollback applicant'),(e,'Rollback executor');
  insert into public.service_request_invites(token,executor_account_id,created_by) values(t,e,u);
  perform set_config('request.jwt.claim.sub',u::text,true);
  select * into result from public.claim_service_request_invite(t);
  if result.applicant_account_id is not null or result.id <> e then raise exception 'guest must not create company'; end if;
  insert into public.account_members(account_id,user_id,role) values(a,u,'owner');
  select * into result from public.claim_service_request_invite(t);
  if result.applicant_account_id <> a then raise exception 'single company must bind'; end if;
  select * into result from public.claim_service_request_invite(t,a);
  if result.applicant_account_id <> a then raise exception 'repeat must retain company'; end if;
  perform set_config('request.jwt.claim.sub',stranger::text,true);
  begin
    perform public.claim_service_request_invite(t,a);
    raise exception 'unauthorized access allowed';
  exception when raise_exception then
    if sqlerrm <> 'У вас нет доступа к данным текущей ссылки' then raise; end if;
  end;
end $$;
do $$
declare
  u uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  i uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  device uuid := gen_random_uuid();
  mail text := u::text||'@example.invalid';
  result jsonb;
  stores jsonb := '[{"name":"Rollback store","marketplace":"wildberries","intake_mode":"bulk","items":[{"name":"Test item","barcode":"123456789","qty":1}]}]';
begin
  insert into auth.users(id,email,email_confirmed_at) values(u,mail,now());
  insert into public.accounts(id,name) values(e,'Rollback executor');
  insert into public.service_request_invites(id,token,executor_account_id,created_by) values(i,t,e,u);
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform public.reserve_service_request_invite(t,'Tester',mail);
  perform public.open_my_request_reserve(i,device);
  if exists(select 1 from public.account_members where user_id=u) then raise exception 'reserve created company'; end if;
  result := public.submit_service_request_invite_reserve(t,'Rollback applicant','Tester',mail,'Test','',stores,e,device);
  if (select count(*) from public.account_members where user_id=u) <> 1 then raise exception 'company not materialized once'; end if;
  if not exists(select 1 from public.service_requests where id=(result->>'request_id')::uuid and status='submitted') then raise exception 'request not submitted'; end if;
  begin
    perform public.submit_service_request_invite_reserve(t,'Rollback applicant','Tester',mail,'Test','',stores,e,device);
    raise exception 'duplicate submission allowed';
  exception when raise_exception then
    if sqlerrm <> 'Клиентская ссылка недоступна' then raise; end if;
  end;
  if (select count(*) from public.service_requests where applicant_account_id=(result->>'account_id')::uuid) <> 1 then raise exception 'duplicate request'; end if;
end $$;
rollback;
