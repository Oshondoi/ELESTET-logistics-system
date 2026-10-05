-- Safe only with the migrations in a transaction ending in ROLLBACK.
-- Inner subtransaction also rolls back all fixtures even if outer wrapper is omitted.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_account uuid := gen_random_uuid();
begin
  begin
    insert into auth.users(id,email) values(v_owner,v_owner::text||'@example.invalid'),(v_stranger,v_stranger::text||'@example.invalid');
    insert into public.accounts(id,name) values(v_account,'Temporary brand RLS test');
    insert into public.account_members(account_id,user_id,role) values(v_account,v_owner,'owner');
    perform set_config('request.jwt.claim.sub',v_owner::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    set local role authenticated;
    if not public.can_manage_company_brand(v_account) then raise exception 'owner rejected'; end if;
    insert into public.company_brand_assets(account_id,brand_name) values(v_account,'Brand test');
    insert into public.implementation_inquiries(account_id,description) values(v_account,'Configure warehouse and training');
    if (select count(*) from public.implementation_inquiries where account_id=v_account) <> 1 then raise exception 'own inquiry unreadable'; end if;
    perform set_config('request.jwt.claim.sub',v_stranger::text,true);
    if public.can_manage_company_brand(v_account) then raise exception 'stranger permitted'; end if;
    if exists(select 1 from public.company_brand_assets where account_id=v_account) then raise exception 'brand leak'; end if;
    if exists(select 1 from public.implementation_inquiries where account_id=v_account) then raise exception 'inquiry leak'; end if;
    begin
      insert into public.implementation_inquiries(account_id,description) values(v_account,'Forbidden stranger request');
      raise exception 'stranger insert allowed';
    exception when insufficient_privilege then null;
    end;
    reset role;
    raise exception using errcode='Z0001',message='test rollback';
  exception when sqlstate 'Z0001' then null;
  end;
end $$;
