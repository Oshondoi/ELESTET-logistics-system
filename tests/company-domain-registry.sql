begin;
do $$
declare actor uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); a uuid; q jsonb; saved jsonb; k uuid; host text:=gen_random_uuid()||'.example.invalid';
begin
 insert into auth.users(id,email) values(actor,actor||'@example.invalid'),(owner_id,owner_id||'@example.invalid');
 insert into public.profiles(user_id,full_name,platform_role) values(actor,'Domain admin','superadmin') on conflict(user_id) do update set platform_role='superadmin';
 insert into public.accounts(name) values('Rollback domain company') returning id into a;
 insert into public.account_members(account_id,user_id,role) values(a,owner_id,'owner');
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 begin perform public.admin_list_company_domains();raise exception 'FAIL owner read admin registry';exception when insufficient_privilege then null;end;
 begin perform public.admin_save_company_domain(null,0,a,host,'existing',null,'','not_connected','not_connected','');raise exception 'FAIL owner write';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 set local role authenticated;
 saved:=public.admin_save_company_domain(null,0,a,upper(host),'existing',current_date+365,'Registrar','awaiting_dns','not_connected','No keys');k:=(saved->>'id')::uuid;
 if saved->>'hostname'<>host then raise exception 'Normalization';end if;
 q:=public.admin_list_company_domains();
 if not exists(select 1 from jsonb_array_elements(q->'domains') x where x->>'id'=k::text and x->>'company_name'='Rollback domain company') then raise exception 'List missing';end if;
 saved:=public.admin_save_company_domain(k,1,a,host,'existing',current_date+365,'Registrar','disabled','error','Updated');
 if (saved->>'version')::integer<>2 or jsonb_array_length(public.admin_company_domain_history(k))<>2 then raise exception 'Audit/version missing';end if;
 begin perform public.admin_save_company_domain(k,1,a,host,'new',null,'','not_connected','not_connected','');raise exception 'FAIL stale update';exception when raise_exception then if sqlerrm like 'FAIL%' then raise;end if;end;
 begin perform public.admin_save_company_domain(null,0,a,host,'new',null,'','not_connected','not_connected','');raise exception 'FAIL duplicate';exception when raise_exception then if sqlerrm like 'FAIL%' then raise;end if;end;
 begin perform public.admin_save_company_domain(null,0,a,'https://client.kg/x','new',null,'','not_connected','not_connected','');raise exception 'FAIL invalid host';exception when raise_exception then if sqlerrm like 'FAIL%' then raise;end if;end;
 begin perform public.admin_save_company_domain(null,0,a,'elestet.net','new',null,'','not_connected','not_connected','');raise exception 'FAIL platform host';exception when raise_exception then if sqlerrm like 'FAIL%' then raise;end if;end;
 begin update public.company_domain_registry set hostname='bypass.example.invalid' where id=k;raise exception 'FAIL direct write';exception when insufficient_privilege then null;end;
 reset role;
 if has_function_privilege('anon','public.admin_list_company_domains()','EXECUTE') or has_table_privilege('authenticated','public.company_domain_registry_audit','SELECT') then raise exception 'Privilege leak';end if;
 if (select version from public.company_domain_registry where id=k)<>2 then raise exception 'Failed operation mutated record';end if;
end $$;
rollback;
