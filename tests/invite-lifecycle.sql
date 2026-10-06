-- Transactional fixtures only: no persistent users, companies or messages.
begin;
do $$
declare u uuid:=gen_random_uuid();actor uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
 e uuid;e2 uuid;a uuid;i1 uuid;i2 uuid;i3 uuid;i4 uuid;occupied uuid;t1 uuid:=gen_random_uuid();t2 uuid:=gen_random_uuid();t3 uuid:=gen_random_uuid();t4 uuid:=gen_random_uuid();to_occupied uuid:=gen_random_uuid();
 dev uuid:=gen_random_uuid();result jsonb; preview jsonb; r1 uuid;r2 uuid;p uuid;s uuid;wh uuid;zone uuid;cell uuid;box uuid;stock_wh uuid;box_items_before jsonb;company_before jsonb;stores_before jsonb;finance_before jsonb;finance_after jsonb;
 goods jsonb:='[{"name":"Lifecycle store","marketplace":"wildberries","intake_mode":"bulk","items":[{"name":"Lifecycle goods","barcode":"LIFECYCLE","qty":4}]}]';
begin
 if has_function_privilege('authenticated','public.invite_delete_snapshot(uuid,boolean)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_delete_invite_data_internal(uuid)','EXECUTE')
 or has_function_privilege('anon','public.admin_preview_invite_deletion(uuid)','EXECUTE') then raise exception 'Deletion privilege leak'; end if;
 insert into auth.users(id,email,email_confirmed_at,encrypted_password) values
 (u,u||'@example.invalid',now(),'fixture-password-hash'),(actor,actor||'@example.invalid',now(),''),(stranger,stranger||'@example.invalid',now(),'');
 insert into public.profiles(user_id,full_name,platform_role) values(actor,'Lifecycle administrator','superadmin') on conflict(user_id) do update set platform_role='superadmin';
 insert into public.accounts(name) values('Lifecycle executor 1') returning id into e;
 insert into public.accounts(name) values('Lifecycle executor 2') returning id into e2;
 insert into public.account_members(account_id,user_id,role) values(e,actor,'owner'),(e2,actor,'owner');
 insert into public.service_request_invites(token,executor_account_id,created_by) values(t1,e,actor) returning id into i1;
 insert into public.service_request_invites(token,executor_account_id,created_by) values(t2,e2,actor) returning id into i2;
 insert into public.service_request_invites(token,executor_account_id,created_by) values(t3,e2,actor) returning id into i3;
 insert into public.service_request_invites(token,executor_account_id,created_by) values(t4,e,actor) returning id into i4;
 insert into public.service_request_invites(token,executor_account_id,created_by) values(to_occupied,e2,actor) returning id into occupied;
 perform set_config('request.jwt.claim.sub',stranger::text,true);
 perform public.reserve_service_request_invite(to_occupied,'Stranger',stranger||'@example.invalid');
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
 perform public.reserve_service_request_invite(t1,'Tester',u||'@example.invalid');
 perform public.open_my_request_reserve(i1,dev);
 perform public.save_my_request_reserve(i1,'{"title":"OLD DRAFT","executor":{"name":"Original executor"}}',dev);
 result:=public.reserve_service_request_invite(t2,'Tester',u||'@example.invalid');
 if result->>'code'<>'EMAIL_RESERVED' then raise exception 'Active reserve conflict not reported'; end if;
 begin perform public.replace_service_request_invite_reserve(t2);raise exception 'FAIL: password replaced link';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 if (select deleted_at from public.service_request_invites where id=i1) is not null then raise exception 'Failed OTP changed old link'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint)))::text,true);
 begin perform public.replace_service_request_invite_reserve(to_occupied);raise exception 'FAIL: occupied link stolen';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 if (select deleted_at from public.service_request_invites where id=i1) is not null then raise exception 'Conflict partially revoked old link'; end if;
 perform public.replace_service_request_invite_reserve(t2);
 if not exists(select 1 from public.service_request_invites where id=i1 and deleted_at is not null and token<>t1) then raise exception 'Old public token remains usable'; end if;
 if (select draft->>'title' from public.service_request_invite_reserves where invite_id=i1)<>'OLD DRAFT' then raise exception 'Old draft lost on replacement'; end if;
 if (select draft from public.service_request_invite_reserves where invite_id=i2)<>'{}'::jsonb then raise exception 'Old data copied to new draft'; end if;
 if exists(select 1 from public.account_members where user_id=u) then raise exception 'Replacement created company'; end if;
 perform public.open_my_request_reserve(i2,dev);
 perform public.save_my_request_reserve(i2,'{"title":"EXPIRED DRAFT"}',dev);
 update public.service_request_invites set expires_at=now()-interval '1 second' where id=i2;
 perform public.cleanup_expired_service_request_invite_reserves();
 if not exists(select 1 from auth.users where id=u and email_confirmed_at is not null and encrypted_password='fixture-password-hash') then raise exception 'Auth lost on expiry'; end if;
 if (select count(*) from public.list_my_request_reserves())<>2 then raise exception 'Independent drafts missing'; end if;
 begin perform public.claim_service_request_invite(t2);raise exception 'FAIL: expired public URL revived';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 perform public.reserve_service_request_invite(t3,'Tester',u||'@example.invalid');
 goods:=jsonb_set(goods,'{0,intake_mode}','"boxes"');
 goods:=jsonb_set(goods,'{0,supplies}',jsonb_build_array(jsonb_build_object('key',gen_random_uuid(),'warehouse_name','Declared destination',
  'boxes',jsonb_build_array(jsonb_build_object('key',gen_random_uuid(),'items',jsonb_build_array(jsonb_build_object('barcode','LIFECYCLE','qty',4)))))));
 -- Submitting an old independent draft creates the company once and retains its executor.
 begin
  perform public.submit_my_request_reserve(i1,'Lifecycle applicant','Tester',u||'@example.invalid','Invalid request','','[]',e,null,dev);
  raise exception 'FAIL: empty initial submission passed';
 exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 if exists(select 1 from public.account_members where user_id=u) then raise exception 'Failed submission left partial company'; end if;
 result:=public.submit_my_request_reserve(i1,'Lifecycle applicant','Tester',u||'@example.invalid','Old request','',goods,e,null,dev);
 a:=(result->>'account_id')::uuid;r1:=(result->>'request_id')::uuid;
 if (select count(*) from public.account_members where user_id=u)<>1 then raise exception 'First business cascade duplicated'; end if;
 if not exists(select 1 from public.service_requests where id=r1 and executor_account_id=e and invite_id=i1) then raise exception 'New link changed old executor'; end if;
 if not exists(select 1 from public.service_request_invites where id=i3 and applicant_account_id=a and expires_at='infinity') then raise exception 'Active link not bound after first submission'; end if;
 if (select deleted_at from public.service_request_invites where id=i2) is null then raise exception 'Expired link revived during submission'; end if;
 -- The other old draft reuses the company; its executor is independent.
 result:=public.submit_my_request_reserve(i2,'Ignored','Tester',u||'@example.invalid','Second request','',goods,e2,a,dev);
 r2:=(result->>'request_id')::uuid;
 if (result->>'account_id')::uuid<>a or (select count(*) from public.account_members where user_id=u)<>1 then raise exception 'Second draft created extra company'; end if;
 -- A materialized company also requires explicit consent and fresh OTP to replace.
 begin perform public.claim_service_request_invite(t4,a,false);raise exception 'FAIL: company link replaced without consent';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now()-interval '11 minutes')::bigint)))::text,true);
 begin perform public.claim_service_request_invite(t4,a,true);raise exception 'FAIL: stale OTP replaced company link';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 if (select token from public.service_request_invites where id=i3)<>t3 then raise exception 'Denied replacement changed token'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint)))::text,true);
 perform public.claim_service_request_invite(t4,a,true);
 if not exists(select 1 from public.service_request_invites where id=i4 and applicant_account_id=a) then raise exception 'Company not retained on replacement'; end if;
 if not exists(select 1 from public.service_requests where id=r1 and executor_account_id=e) or not exists(select 1 from public.service_requests where id=r2 and executor_account_id=e2) then raise exception 'Replacement rewrote executors'; end if;
 -- Execute reception as a distinct executor user, then view as applicant.
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform public.accept_service_request(r1);
 select batch_id into p from public.service_request_stores where request_id=r1;
 select id into s from public.batch_pipeline_stages where batch_id=p and order_index=1;
 insert into public.wms_warehouses(account_id,name) values(e,'Private lifecycle warehouse') returning id into wh;
 update public.batch_pipeline_stages set wms_warehouse_id=wh,stage_otk=false,stage_packaging=false,stage_marking=false,stage_packing=false,stage_logistics=false where id=s;
 update public.fulfillment_items set qty_received=4 where pipeline_stage_id=s;
 perform public.advance_batch_pipeline_step(s);
 result:=public.complete_batch_pipeline_stage(s);
 if result->>'ok'<>'true' then raise exception 'Stage completion failed: %',result; end if;
 perform public.issue_reception_documents(p,s);
 perform set_config('request.jwt.claim.sub',u::text,true);
 result:=public.get_client_request_tracking(a,r1);
 if (result#>>'{batches,0,stages,1,items,0,received}')::integer<>4 then raise exception 'Confirmed reception not visible to client'; end if;
 if result#>>'{batches,0,stages,1,step}'<>'done' then raise exception 'Completed step not visible'; end if;
 if result#>>'{batches,0,stages,1,status}'<>'done' or result#>>'{batches,0,status}'<>'done' then raise exception 'Completed stage/batch not visible'; end if;
 if jsonb_array_length(result#>'{batches,0,documents}')=0 then raise exception 'Issued documents not visible'; end if;
 if result::text like '%Private lifecycle warehouse%' then raise exception 'Internal warehouse leaked'; end if;
 if (public.list_client_request_tracking(a)->>'total')::integer<>2 then raise exception 'Multi-executor tracking incomplete'; end if;
 -- Non-superadmin cannot delete link data. Any rejection must be atomic.
 begin perform public.admin_delete_service_request_invite_data(i1);raise exception 'FAIL: applicant deleted link data';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;end;
 begin perform public.admin_preview_invite_deletion(i1);raise exception 'FAIL: applicant previewed link data';exception when insufficient_privilege then null;end;
 begin perform public.admin_confirm_invite_deletion(i1,'forged');raise exception 'FAIL: applicant confirmed deletion';exception when insufficient_privilege then null;end;
 if not exists(select 1 from public.service_requests where id=r1) then raise exception 'Denied deletion changed request'; end if;
 select to_jsonb(ac) into company_before from public.accounts ac where id=a;
 select jsonb_agg(to_jsonb(st) order by st.id) into stores_before from public.stores st where st.account_id=a;
 -- Parent-company money and store finance must survive link deletion byte-for-byte.
 insert into public.company_billing_wallets(account_id,balance_som) values(a,7000);
 insert into public.company_balance_entries(operation_id,account_id,delta_som,balance_after_som,reason,source_reference,customer_confirmed) values(gen_random_uuid(),a,7000,7000,'manual_adjustment','rollback-lifecycle',true);
 insert into public.payment_orders(account_id,user_id,plan,months,amount_som) values(a,u,'seller',1,2000);
 insert into public.wb_finance_report_rows(account_id,store_id,period_from,period_to,op_uid,for_pay) select a,st.id,current_date,current_date,'rollback-finance-'||st.id,1234 from public.stores st where st.account_id=a;
 select jsonb_build_object('wallet',(select to_jsonb(w) from public.company_billing_wallets w where w.account_id=a),'entries',(select jsonb_agg(to_jsonb(x) order by x.operation_id) from public.company_balance_entries x where x.account_id=a),'payments',(select jsonb_agg(to_jsonb(x) order by x.id) from public.payment_orders x where x.account_id=a),'wb',(select jsonb_agg(to_jsonb(x) order by x.id) from public.wb_finance_report_rows x where x.account_id=a)) into finance_before;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select b.id into box from public.fulfillment_boxes b join public.fulfillment_supplies sp on sp.id=b.supply_id where sp.batch_id=p limit 1;
 select jsonb_agg(to_jsonb(bi) order by bi.id) into box_items_before from public.fulfillment_box_items bi where bi.box_id=box;
 -- A warehouse reference must still block deletion; earlier child deletions roll back.
 begin
  insert into public.wms_warehouses(account_id,name) values(a,'Lifecycle occupied warehouse') returning id into stock_wh;
  insert into public.wms_zones(account_id,warehouse_id,name) values(a,stock_wh,'Lifecycle zone') returning id into zone;
  insert into public.wms_cells(account_id,zone_id,col,row) values(a,zone,'A',1) returning id into cell;
  insert into public.wms_cell_items(account_id,cell_id,item_type,fulfillment_box_id,qty) values(a,cell,'box',box,1);
  preview:=public.admin_preview_invite_deletion(i1);
  if (preview->>'can_delete')::boolean or not exists(select 1 from jsonb_array_elements(preview->'blockers') x where x->>'table'='wms_cell_items') then raise exception 'FAIL: warehouse blocker missing'; end if;
  result:=public.admin_confirm_invite_deletion(i1,preview->>'fingerprint');
  if result->>'code'<>'BLOCKED' then raise exception 'FAIL: occupied warehouse box deleted'; end if;
  raise exception 'Rollback warehouse fixture' using errcode='P9998';
 exception when sqlstate 'P9998' then null;
 end;
 if (select jsonb_agg(to_jsonb(bi) order by bi.id) from public.fulfillment_box_items bi where bi.box_id=box) is distinct from box_items_before then raise exception 'Blocked deletion partially removed box items'; end if;
 if not exists(select 1 from public.service_requests where id=r1) or not exists(select 1 from public.fulfillment_step_versions where batch_id=p) then raise exception 'Blocked deletion lost business history'; end if;
 insert into public.fbs_stock_allocations(account_id,store_id,wb_order_id,box_item_id,box_id,product_barcode,quantity,status)
 select a,st.id,-98765,bi.id,box,'LIFECYCLE',1,'reserved' from public.stores st cross join public.fulfillment_box_items bi where st.account_id=a and bi.box_id=box limit 1;
 preview:=public.admin_preview_invite_deletion(i1);
 if not exists(select 1 from jsonb_array_elements(preview->'blockers') x where x->>'code'='FBS_RESERVED') then raise exception 'FBS blocker missing'; end if;
 result:=public.admin_confirm_invite_deletion(i1,preview->>'fingerprint');
 if result->>'code'<>'BLOCKED' then raise exception 'FBS reserve bypassed'; end if;
 update public.fbs_stock_allocations set status='released' where account_id=a and wb_order_id='-98765';
 preview:=public.admin_preview_invite_deletion(i1);
 if not exists(select 1 from jsonb_array_elements(preview->'effects') x where x->>'table'='fbs_stock_allocations') then raise exception 'Preserved external reference not disclosed'; end if;
 if not (preview->>'can_delete')::boolean then raise exception 'Unexpected blockers: %',preview->'blockers'; end if;
 if not exists(select 1 from jsonb_array_elements(preview->'groups') x where x->>'table'='fulfillment_box_items') then raise exception 'Box descendants absent from preview'; end if;
 if not exists(select 1 from public.service_requests where id=r1) then raise exception 'Preview mutated data'; end if;
 result:=public.admin_delete_service_request_invite_data(i1);
 if result->>'code'<>'PREVIEW_REQUIRED' then raise exception 'Legacy call bypassed confirmation'; end if;
 update public.service_requests set title='Changed after preview' where id=r1;
 result:=public.admin_confirm_invite_deletion(i1,preview->>'fingerprint');
 if result->>'code'<>'PREVIEW_CHANGED' or not exists(select 1 from public.service_requests where id=r1) then raise exception 'Stale preview accepted'; end if;
 preview:=result->'preview';
 result:=public.admin_confirm_invite_deletion(i1,preview->>'fingerprint');
 if not (result->>'ok')::boolean then raise exception 'Delete refused: %',result; end if;
 result:=public.admin_confirm_invite_deletion(i1,preview->>'fingerprint');
 if not (result->>'already_deleted')::boolean then raise exception 'Retry not idempotent'; end if;
 if not exists(select 1 from public.fbs_stock_allocations where account_id=a and wb_order_id='-98765' and box_id is null and box_item_id is null) then raise exception 'External allocation not preserved'; end if;
 if exists(select 1 from public.service_requests where id=r1) or exists(select 1 from public.fulfillment_batches where id=p) then raise exception 'Target cascade incomplete'; end if;
 if exists(select 1 from public.fulfillment_supplies where batch_id=p)
  or exists(select 1 from public.fulfillment_boxes b join public.fulfillment_supplies sp on sp.id=b.supply_id where sp.batch_id=p)
  or exists(select 1 from public.fulfillment_batch_documents where batch_id=p)
  or exists(select 1 from public.fulfillment_step_versions where batch_id=p) then raise exception 'Target descendants left behind'; end if;
 if not exists(select 1 from public.service_requests where id=r2 and executor_account_id=e2) then raise exception 'Other link request lost'; end if;
 if (select to_jsonb(ac) from public.accounts ac where id=a) is distinct from company_before then raise exception 'Company/subscription changed'; end if;
 select jsonb_build_object('wallet',(select to_jsonb(w) from public.company_billing_wallets w where w.account_id=a),'entries',(select jsonb_agg(to_jsonb(x) order by x.operation_id) from public.company_balance_entries x where x.account_id=a),'payments',(select jsonb_agg(to_jsonb(x) order by x.id) from public.payment_orders x where x.account_id=a),'wb',(select jsonb_agg(to_jsonb(x) order by x.id) from public.wb_finance_report_rows x where x.account_id=a)) into finance_after;
 if finance_after is distinct from finance_before then raise exception 'Parent financial records changed during link deletion';end if;
 if (select jsonb_agg(to_jsonb(st) order by st.id) from public.stores st where st.account_id=a) is distinct from stores_before then raise exception 'Parent stores changed'; end if;
 if not exists(select 1 from auth.users where id=u and encrypted_password='fixture-password-hash') then raise exception 'Auth removed by link deletion'; end if;
 if not exists(select 1 from public.account_members where account_id=a and user_id=u and role='owner') then raise exception 'Membership deleted'; end if;
 if not exists(select 1 from public.service_request_invite_reserves where invite_id=i3 and user_id=u) then raise exception 'Other link draft removed'; end if;
 if not exists(select 1 from public.service_request_invite_admin_audit where invite_id=i1 and action='delete_link_data') then raise exception 'Deletion audit missing'; end if;
 -- Delete only an unmaterialized draft of the active link: parents/other R remain.
 preview:=public.admin_preview_invite_deletion(i3);
 result:=public.admin_confirm_invite_deletion(i3,preview->>'fingerprint');
 if not (result->>'ok')::boolean then raise exception 'Reserve delete refused: %',result; end if;
 if exists(select 1 from public.service_request_invite_reserves where invite_id=i3) then raise exception 'Target reserve left behind'; end if;
 if not exists(select 1 from public.service_requests where id=r2) or not exists(select 1 from auth.users where id=u) then raise exception 'Reserve deletion affected parent'; end if;
end $$;
rollback;
