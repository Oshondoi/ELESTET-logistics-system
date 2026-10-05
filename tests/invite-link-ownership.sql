begin;
do $$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();a uuid;e uuid;t uuid:=gen_random_uuid();old_token uuid:=gen_random_uuid();i uuid;old_id uuid;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@example.invalid',now()),(outsider,outsider||'@example.invalid',now());
 insert into public.accounts(name) values('Ownership applicant') returning id into a;
 insert into public.accounts(name) values('Ownership executor') returning id into e;
 insert into public.account_members(account_id,user_id,role) values(a,u,'owner');
 insert into public.service_request_invites(token,executor_account_id,created_by) values(t,e,u) returning id into i;
 insert into public.service_request_invites(token,executor_account_id,created_by) values(old_token,e,u) returning id into old_id;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.claim_service_request_invite(t,a);
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin
  perform public.reserve_service_request_invite(t,'Outsider',outsider||'@example.invalid');
  raise exception 'FAIL: outsider reserved bound company link';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 perform public.reserve_service_request_invite(old_token,'Outsider',outsider||'@example.invalid');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint)))::text,true);
 begin
  perform public.replace_service_request_invite_reserve(t);
  raise exception 'FAIL: outsider transferred reserve into bound company link';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 if exists(select 1 from public.service_request_invite_reserves where invite_id=i) then raise exception 'Bound link contaminated';end if;
 if (select deleted_at from public.service_request_invites where id=old_id) is not null then raise exception 'Denied transfer revoked old reserve';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.claim_service_request_invite(t,a);
end $$;
rollback;
