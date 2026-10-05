begin;
do $$
declare
 u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); e uuid:=gen_random_uuid();
 token uuid:=gen_random_uuid(); result jsonb;
begin
 insert into auth.users(id,email) values(u,u::text||'@example.invalid');
 insert into public.accounts(id,name,plan,plan_until,logo_subscription_until)
 values(a,'Applicant','none',null,null),(e,'Executor','premium',now()+interval '2 days',now()+interval '1 day');
 insert into public.account_members(account_id,user_id,role) values(a,u,'owner');
 insert into public.company_brand_assets(account_id,brand_name,tab_title,original_path)
 values(e,'Test brand','Brand portal',e::text||'/private-source');
 insert into public.service_request_invites(token,executor_account_id,applicant_account_id) values(token,e,a);
 perform set_config('request.jwt.claim.sub',u::text,true);
 set local role authenticated;
 if public.resolve_company_brand(e) is not null then raise exception 'foreign company leaked'; end if;
 result:=public.resolve_company_brand(a,null,true);
 if result->>'name'<>'Test brand' or result ? 'original_path' then raise exception 'portal brand incorrect'; end if;
 begin
  update public.accounts set logo_subscription_until=now()+interval '1 day' where id=a;
  raise exception 'client granted entitlement';
 exception when raise_exception then
  if sqlerrm<>'Оплата опции изменяется только сервером' then raise; end if;
 end;
 reset role;
 set local role anon;
 result:=public.resolve_company_brand(null,token);
 if result->>'title'<>'Brand portal' then raise exception 'public invite brand missing'; end if;
 if public.resolve_company_brand(e) is not null then raise exception 'anonymous enumeration'; end if;
 reset role;
 update public.accounts set logo_subscription_until=now()-interval '1 second' where id=e;
 if public.resolve_company_brand(null,token) is not null then raise exception 'expired brand active'; end if;
 update public.accounts set logo_subscription_until=null where id=e;
 if public.resolve_company_brand(null,token) is not null then raise exception 'premium must not grant brand'; end if;
end $$;
rollback;
