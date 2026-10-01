-- Fixture writes always roll back in the inner exception block, even if the
-- caller omits BEGIN/ROLLBACK. No emails. Sequences may advance (not rolled back).
do $$
declare
  u uuid; mail text; a uuid; e uuid; e2 uuid; st uuid; r public.service_requests%rowtype;
  p uuid; s uuid; applicant_stage uuid; original_p uuid; device uuid:=gen_random_uuid(); other_device uuid:=gen_random_uuid();
  warehouse uuid; payload jsonb; draft jsonb; n integer; version_before integer;
  manager uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); responsible uuid:=gen_random_uuid(); role_id uuid;
begin
  begin -- rollback-only fixture subtransaction
  select id,email into u,mail from auth.users where email_confirmed_at is not null order by created_at limit 1;
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into public.accounts(name) values('v42 applicant') returning id into a;
  insert into public.accounts(name) values('v42 rejecting executor') returning id into e;
  insert into public.accounts(name) values('v42 next executor') returning id into e2;
  insert into public.account_members(account_id,user_id,role) values(a,u,'owner'),(e,u,'owner'),(e2,u,'owner');
  insert into auth.users(id,email) values(manager,manager||'@example.invalid'),(viewer,viewer||'@example.invalid'),(responsible,responsible||'@example.invalid');
  insert into public.account_members(account_id,user_id,role) values(e2,manager,'operator'),(e2,viewer,'viewer'),(e2,responsible,'operator');
  insert into public.roles(account_id,name,permissions) values(e2,'v42 manage','{"request_manage":true}') returning id into role_id;
  insert into public.role_assignments(account_id,user_id,role_id) values(e2,manager,role_id);
  insert into public.roles(account_id,name,permissions) values(e2,'v42 view','{"request_view":true}') returning id into role_id;
  insert into public.role_assignments(account_id,user_id,role_id) values(e2,viewer,role_id);
  insert into public.stores(account_id,name,marketplace,store_code)
  values(a,'v42 store','Wildberries','Z'||lpad((floor(random()*9000)+1000)::int::text,4,'0')) returning id into st;
  select * into r from public.create_service_request_from_form(a,e,'v42 request','Tester',mail,'',null);
  payload:='{"items":[{"barcode":"V42-ITEM","name":"Item","qty":4}],"supplies":[]}'::jsonb;
  draft:=jsonb_build_object('executorAccountId',e,'title','v42 request','stores',jsonb_build_array(jsonb_build_object(
    'store_id',st,'intake_mode','bulk','delivery_mode','self_delivery','position',0,'payload',payload)));
  perform public.open_service_request_work_draft(r.id,device);
  perform public.save_service_request_work_draft(r.id,device,draft);
  perform public.submit_service_request(r.id,device);
  select batch_id into p from public.service_request_stores where request_id=r.id;
  original_p:=p;
  select id into s from public.batch_pipeline_stages where batch_id=p and order_index=0;
  if (select count(*) from public.fulfillment_step_versions where batch_id=p and step='reception')<>1 then raise exception 'Initial applicant result missing'; end if;
  if exists(select 1 from public.fulfillment_reception_history where batch_id=p) then raise exception 'Working item changes reached business history'; end if;
  perform public.reject_service_request(r.id,'No capacity');
  if (select count(*) from public.batch_pipeline_stages where batch_id=p)<>1 then raise exception 'Rejection created executor stage'; end if;
  perform public.reassign_rejected_service_request(r.id,e2);
  if (select batch_id from public.service_request_stores where request_id=r.id)<>original_p then raise exception 'Reassignment changed P'; end if;
  if (select count(*) from public.batch_pipeline_stages where batch_id=p)<>1 then raise exception 'Reassignment prematurely created executor stage'; end if;
  if (select count(*) from public.batch_notifications where source_request_id=r.id and account_id=e2)<>2 then raise exception 'Expected exactly owner and request_manage notification'; end if;
  if exists(select 1 from public.batch_notifications where source_request_id=r.id and recipient_user_id=viewer) then raise exception 'View-only user notified'; end if;
  update public.fulfillment_items set qty_received=9 where pipeline_stage_id=s;
  perform public.accept_service_request(r.id);
  select id into s from public.batch_pipeline_stages where batch_id=p and order_index=1;
  if s is null then raise exception 'Acceptance did not create second stage'; end if;
  if (select qty_declared from public.fulfillment_items where pipeline_stage_id=s)<>4 then raise exception 'Acceptance copied an unconfirmed applicant correction'; end if;
  update public.service_requests set responsible_user_id=responsible where id=r.id;
  select current_version into version_before from public.service_requests where id=r.id;
  draft:=jsonb_set(draft,'{executorAccountId}',to_jsonb(e2));
  draft:=jsonb_set(draft,'{stores,0,payload,items,0,qty}','6');
  perform public.open_service_request_work_draft(r.id,device);
  perform public.save_service_request_work_draft(r.id,device,draft);
  if (select current_version from public.service_requests where id=r.id)<>version_before then raise exception 'Autosave published a version'; end if;
  if (select qty_declared from public.fulfillment_items where pipeline_stage_id=s)<>4 then raise exception 'Correction draft leaked into declared'; end if;
  begin
    perform public.open_service_request_work_draft(r.id,other_device);
    raise exception 'FAIL: second correction device acquired active draft';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform public.submit_service_request(r.id,device);
  if (select qty_declared from public.fulfillment_items where pipeline_stage_id=s)<>6 or
     (select qty_received from public.fulfillment_items where pipeline_stage_id=s)<>0 then raise exception 'Declared/actual correction boundary broken'; end if;
  if (select count(*) from public.fulfillment_step_versions where batch_id=p and step='reception')<>2 then raise exception 'Confirmed applicant correction not journaled'; end if;
  if (select count(*) from public.batch_notifications where source_request_id=r.id and type='service_request_corrected')<>3 then raise exception 'Correction must notify owner, manager and responsible once each'; end if;
  insert into public.wms_warehouses(account_id,name) values(e2,'v42 warehouse') returning id into warehouse;
  update public.batch_pipeline_stages set wms_warehouse_id=warehouse where id=s;
  update public.fulfillment_items set qty_received=3 where pipeline_stage_id=s;
  update public.fulfillment_items set qty_received=5 where pipeline_stage_id=s;
  if exists(select 1 from public.fulfillment_step_versions where pipeline_stage_id=s) then raise exception 'Unconfirmed reception entered journal'; end if;
  perform public.advance_batch_pipeline_step(s);
  if (select count(*) from public.fulfillment_step_versions where pipeline_stage_id=s)<>1 then raise exception 'Step completion missing'; end if;
  update public.fulfillment_items set qty_received=6 where pipeline_stage_id=s;
  if (select count(*) from public.fulfillment_step_versions where pipeline_stage_id=s)<>1 then raise exception 'Intermediate correction entered journal'; end if;
  perform public.confirm_fulfillment_step_correction(p,s,'reception');
  perform public.confirm_fulfillment_step_correction(p,s,'reception');
  if (select count(*) from public.fulfillment_step_versions where pipeline_stage_id=s)<>2 then raise exception 'Repeated same result created duplicate version'; end if;
  if (select (snapshot->'items'->0->>'received')::int from public.fulfillment_step_versions where pipeline_stage_id=s and version=1)<>5 then raise exception 'Previous confirmed snapshot was overwritten'; end if;
  select id into applicant_stage from public.batch_pipeline_stages where batch_id=p and order_index=0;
  update public.fulfillment_items set qty_received=7 where pipeline_stage_id=applicant_stage;
  if (select qty_declared from public.fulfillment_items where pipeline_stage_id=s)<>6 then raise exception 'Unconfirmed applicant edit leaked downstream'; end if;
  perform public.confirm_fulfillment_step_correction(p,applicant_stage,'reception');
  if (select qty_declared from public.fulfillment_items where pipeline_stage_id=s)<>7 or
     (select qty_received from public.fulfillment_items where pipeline_stage_id=s)<>6 then raise exception 'Confirmed stage correction did not preserve actual'; end if;
  if (select (rs.payload->'items'->0->>'qty')::int from public.service_request_stores rs where rs.request_id=r.id)<>7 then raise exception 'Stage correction did not update request declared'; end if;
  perform public.remove_service_requests(array[r.id]);
  begin
    perform public.confirm_fulfillment_step_correction(p,s,'reception');
    raise exception 'FAIL: cancelled stage accepted confirmation';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  -- Self-order: one executor-context notification; intake declared != actual.
  select * into r from public.create_service_request_from_form(a,a,'v42 self','Tester',mail,'',null);
  draft:=jsonb_set(draft,'{executorAccountId}',to_jsonb(a));
  perform public.open_service_request_work_draft(r.id,device);
  perform public.save_service_request_work_draft(r.id,device,draft);
  perform public.submit_service_request(r.id,device);
  if (select count(*) from public.batch_notifications where source_request_id=r.id)<>1 then raise exception 'Self-order notification duplicated'; end if;
  select batch_id into p from public.service_request_stores where request_id=r.id;
  if (select count(*) from public.batch_pipeline_stages where batch_id=p)<>1 then raise exception 'Self-order duplicated stage'; end if;
  if exists(select 1 from public.batch_pipeline_stages where batch_id=p and stage_packing) then raise exception 'Bulk self-order enabled empty boxes'; end if;
  if exists(select 1 from public.fulfillment_items where batch_id=p and qty_received<>0) then raise exception 'Self-order falsely accepted actual'; end if;
    raise exception using errcode='ZX042', message='rollback_request_v42_fixtures';
  exception when sqlstate 'ZX042' then
    if sqlerrm <> 'rollback_request_v42_fixtures' then raise; end if;
  end;
end $$;
select 'request_completion_v42_smoke_ok' as result;
