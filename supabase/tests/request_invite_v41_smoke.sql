-- Run after patch_request_invite_portal_v41.sql. The inner exception block
-- ALWAYS rolls back fixture writes, even if the caller omits BEGIN/ROLLBACK.
-- PostgreSQL sequences can still advance; never rewind production sequences.
do $$
declare
  v_user_id uuid;
  v_email text;
  v_account public.accounts%rowtype;
  v_executor public.accounts%rowtype;
  v_store public.stores%rowtype;
  v_request public.service_requests%rowtype;
  v_external_request public.service_requests%rowtype;
  v_batch_id uuid;
  v_original_batch_id uuid;
  v_supply_id uuid;
  v_supply_key uuid:=gen_random_uuid();
  v_box_key uuid:=gen_random_uuid();
  v_payload jsonb;
  v_corrected_payload jsonb;
  v_store_code text;
  v_qty integer;
  v_device_a uuid:=gen_random_uuid();
  v_device_b uuid:=gen_random_uuid();
  v_stage_id uuid;
  v_declared integer;
  v_received integer;
  v_invite_id uuid;
  v_reserve_result jsonb;
  v_account_count integer;
  v_store_count integer;
begin
  begin -- rollback-only fixture subtransaction
  select id,email into v_user_id,v_email from auth.users
  where email_confirmed_at is not null order by created_at limit 1;
  if v_user_id is null then raise exception 'No verified Auth user for smoke test'; end if;
  perform set_config('request.jwt.claim.sub',v_user_id::text,true);
  insert into public.accounts(name) values('Request v41 smoke') returning * into v_account;
  insert into public.account_members(account_id,user_id,role)
  values(v_account.id,v_user_id,'owner');
  loop
    v_store_code:='Z'||lpad(floor(random()*10000)::integer::text,4,'0');
    exit when not exists(select 1 from public.stores where store_code=v_store_code);
  end loop;
  insert into public.stores(account_id,store_code,name,marketplace)
  values(v_account.id,v_store_code,'Smoke store','Wildberries') returning * into v_store;
  select * into v_request from public.create_service_request_from_form(
    v_account.id,v_account.id,'Smoke self-order','Smoke applicant',v_email,'',null
  );
  v_payload:=jsonb_build_object(
    'items',jsonb_build_array(jsonb_build_object('barcode','SMOKE-123','name','Smoke item','qty',2,'position',0)),
    'supplies',jsonb_build_array(jsonb_build_object('key',v_supply_key,'warehouse_name','Smoke warehouse',
      'boxes',jsonb_build_array(jsonb_build_object('key',v_box_key,
        'items',jsonb_build_array(jsonb_build_object('barcode','SMOKE-123','qty',2))))))
  );
  begin
    perform public.validate_service_request_intake(
      jsonb_set(v_payload,'{supplies}','[]'::jsonb),'boxes'
    );
    raise exception 'Empty supply unexpectedly passed validation';
  exception when others then
    if sqlerrm not like '%непустую поставку%' then raise; end if;
  end;
  begin
    perform public.validate_service_request_intake(
      jsonb_set(v_payload,'{supplies,0,boxes,0,items}','[]'::jsonb),'boxes'
    );
    raise exception 'Empty box unexpectedly passed validation';
  exception when others then
    if sqlerrm not like '%Пустой короб%' then raise; end if;
  end;
  perform public.open_service_request_work_draft(v_request.id,v_device_a);
  begin
    perform public.open_service_request_work_draft(v_request.id,v_device_b);
    raise exception 'Active device lease did not block another device';
  exception when others then
    if sqlerrm not like '%другом устройстве%' then raise; end if;
  end;
  update public.service_request_work_drafts set lease_last_seen=now()-interval '3 minutes'
  where request_id=v_request.id;
  perform public.open_service_request_work_draft(v_request.id,v_device_b);
  perform public.save_service_request_work_draft(v_request.id,v_device_b,jsonb_build_object(
    'title','Smoke self-order','executorAccountId',v_account.id,
    'applicantName','Smoke applicant','applicantEmail',v_email,'comment','',
    'stores',jsonb_build_array(jsonb_build_object(
      'store_id',v_store.id,'position',0,'delivery_mode','self_delivery',
      'intake_mode','boxes','payload',v_payload
    ))
  ));
  begin
    perform public.submit_service_request(v_request.id);
    raise exception 'Legacy submit bypassed the active work lease';
  exception when others then
    if sqlerrm not like '%новом интерфейсе%' then raise; end if;
  end;
  perform public.submit_service_request(v_request.id,v_device_b);
  select batch_id into v_batch_id from public.service_request_stores
  where request_id=v_request.id and applicant_store_id=v_store.id;
  v_original_batch_id:=v_batch_id;
  select id into v_supply_id from public.fulfillment_supplies
  where batch_id=v_batch_id and source_request_store_id in(
    select id from public.service_request_stores where request_id=v_request.id
  );
  if v_batch_id is null or v_supply_id is null then
    raise exception 'Initial R/P/supply was not created';
  end if;
  select coalesce(sum(bi.qty),0) into v_qty from public.fulfillment_box_items bi
  join public.fulfillment_boxes box on box.id=bi.box_id
  where box.supply_id=v_supply_id;
  if v_qty<>2 then raise exception 'Initial box quantity is %, expected 2',v_qty; end if;
  v_corrected_payload:=jsonb_set(
    jsonb_set(v_payload,'{items,0,qty}','3'::jsonb),
    '{supplies,0,boxes,0,items,0,qty}','3'::jsonb
  );
  perform public.save_service_request_draft(
    v_request.id,'Smoke self-order',v_account.id,'Smoke applicant',v_email,'',
    jsonb_build_array(jsonb_build_object(
      'store_id',v_store.id,'position',0,'delivery_mode','self_delivery',
      'intake_mode','boxes','payload',v_corrected_payload
    ))
  );
  perform public.submit_service_request(v_request.id);
  select batch_id into v_batch_id from public.service_request_stores
  where request_id=v_request.id and applicant_store_id=v_store.id;
  if v_batch_id is distinct from v_original_batch_id then
    raise exception 'Correction consumed a new P';
  end if;
  if not exists(select 1 from public.service_request_supply_archives archive
    join public.service_request_stores rs on rs.id=archive.request_store_id
    where rs.request_id=v_request.id) then
    raise exception 'Previous box version was not archived';
  end if;
  select coalesce(sum(bi.qty),0) into v_qty from public.fulfillment_box_items bi
  join public.fulfillment_boxes box on box.id=bi.box_id
  join public.fulfillment_supplies supply on supply.id=box.supply_id
  where supply.batch_id=v_batch_id and supply.source_request_store_id in(
    select id from public.service_request_stores where request_id=v_request.id
  );
  if v_qty<>3 then raise exception 'Corrected box quantity is %, expected 3',v_qty; end if;

  insert into public.accounts(name) values('Request v41 executor smoke') returning * into v_executor;
  insert into public.account_members(account_id,user_id,role)
  values(v_executor.id,v_user_id,'owner');
  select * into v_external_request from public.create_service_request_from_form(
    v_account.id,v_executor.id,'Smoke external-order','Smoke applicant',v_email,'',null
  );
  insert into public.service_request_stores(
    request_id,applicant_store_id,position,delivery_mode,intake_mode,payload
  ) values(v_external_request.id,v_store.id,0,'self_delivery','boxes',v_payload);
  perform public.submit_service_request(v_external_request.id);
  select batch_id into v_batch_id from public.service_request_stores
  where request_id=v_external_request.id;
  if (select count(*) from public.batch_pipeline_stages where batch_id=v_batch_id)<>1 or
     not exists(select 1 from public.batch_pipeline_stages
                where batch_id=v_batch_id and order_index=0 and status='done') then
    raise exception 'External request must start with one completed applicant stage';
  end if;
  perform public.accept_service_request(v_external_request.id);
  select id into v_stage_id from public.batch_pipeline_stages
  where batch_id=v_batch_id and order_index=1 and partner_account_id=v_executor.id;
  if v_stage_id is null then raise exception 'Executor stage was not created on acceptance'; end if;
  select qty_declared,qty_received into v_declared,v_received from public.fulfillment_items
  where batch_id=v_batch_id and pipeline_stage_id=v_stage_id and barcode='SMOKE-123';
  if v_declared<>2 or v_received<>0 then
    raise exception 'Executor quantities after acceptance: declared %, actual %',v_declared,v_received;
  end if;
  perform public.save_service_request_draft(
    v_external_request.id,'Smoke external-order',v_executor.id,'Smoke applicant',v_email,'',
    jsonb_build_array(jsonb_build_object(
      'store_id',v_store.id,'position',0,'delivery_mode','self_delivery',
      'intake_mode','boxes','payload',v_corrected_payload
    ))
  );
  perform public.submit_service_request(v_external_request.id);
  select qty_declared,qty_received into v_declared,v_received from public.fulfillment_items
  where batch_id=v_batch_id and pipeline_stage_id=v_stage_id and barcode='SMOKE-123';
  if v_declared<>3 or v_received<>0 then
    raise exception 'Executor quantities after correction: declared %, actual %',v_declared,v_received;
  end if;
  perform public.remove_service_requests(array[v_external_request.id]);
  if not exists(select 1 from public.fulfillment_batches
                where id=v_batch_id and status='cancelled') then
    raise exception 'Cancelled request did not cancel its P';
  end if;
  begin
    update public.fulfillment_items set qty_received=1
    where batch_id=v_batch_id and pipeline_stage_id=v_stage_id and barcode='SMOKE-123';
    raise exception 'Cancelled stage unexpectedly accepted new work';
  exception when others then
    if sqlerrm='Cancelled stage unexpectedly accepted new work' then raise; end if;
  end;

  select count(*) into v_account_count from public.accounts;
  select count(*) into v_store_count from public.stores;
  insert into public.service_request_invites(
    executor_account_id,created_by,expires_at,initial_expires_at
  ) values(v_executor.id,v_user_id,now()+interval '30 days',now()+interval '30 days')
  returning id into v_invite_id;
  insert into public.service_request_invite_reserves(
    invite_id,user_id,email,full_name,expires_at,draft
  ) values(v_invite_id,v_user_id,lower(v_email),'Smoke applicant',now()+interval '30 days','{}'::jsonb);
  perform public.open_my_request_reserve(v_invite_id,v_device_a);
  begin
    perform public.open_my_request_reserve(v_invite_id,v_device_b);
    raise exception 'Active reserve lease did not block another device';
  exception when others then
    if sqlerrm not like '%другом устройстве%' then raise; end if;
  end;
  update public.service_request_invite_reserves set lease_last_seen=now()-interval '3 minutes'
  where invite_id=v_invite_id;
  perform public.open_my_request_reserve(v_invite_id,v_device_b);
  begin
    perform public.save_my_request_reserve(v_invite_id,'{"title":"Legacy bypass"}'::jsonb);
    raise exception 'Legacy save bypassed the active reserve lease';
  exception when others then
    if sqlerrm not like '%новом интерфейсе%' then raise; end if;
  end;
  begin
    perform public.submit_my_request_reserve(
      v_invite_id,'Ignored new company','Smoke applicant',v_email,
      'Legacy bypass','',jsonb_build_array(),v_executor.id,v_account.id
    );
    raise exception 'Legacy submit bypassed the active reserve lease';
  exception when others then
    if sqlerrm not like '%новом интерфейсе%' then raise; end if;
  end;
  perform public.save_my_request_reserve(v_invite_id,'{"title":"Lease survived"}'::jsonb,v_device_b);
  v_reserve_result:=public.submit_my_request_reserve(
    v_invite_id,'Ignored new company','Smoke applicant',v_email,
    'Existing company reserve','',jsonb_build_array(jsonb_build_object(
      'store_id',v_store.id,'name',v_store.name,'marketplace',v_store.marketplace,
      'position',0,'delivery_mode','self_delivery','intake_mode','bulk',
      'items',jsonb_build_array(jsonb_build_object('barcode','SMOKE-123','name','Smoke item','qty',2))
    )),v_executor.id,v_account.id,v_device_b
  );
  if (v_reserve_result->>'account_id')::uuid is distinct from v_account.id or
     (select count(*) from public.accounts)<>v_account_count or
     (select count(*) from public.stores)<>v_store_count then
    raise exception 'Old reserve created an extra company or store';
  end if;
  if not exists(select 1 from public.service_request_invites
                where id=v_invite_id and expires_at='infinity'::timestamptz) then
    raise exception 'First confirmation did not make the link permanent';
  end if;
    raise exception using errcode='ZX041', message='rollback_request_v41_fixtures';
  exception when sqlstate 'ZX041' then
    if sqlerrm <> 'rollback_request_v41_fixtures' then raise; end if;
  end;
end $$;
select 'request_invite_v41_smoke_ok' as result;
