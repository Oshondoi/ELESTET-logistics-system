begin;
do $$
declare u uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
 a uuid;e uuid;e2 uuid;st uuid;p uuid;s uuid;role_id uuid; req public.service_requests%rowtype; other public.service_requests%rowtype;
 device uuid:=gen_random_uuid();draft jsonb;result jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@example.invalid',now()),(viewer,viewer||'@example.invalid',now()),(stranger,stranger||'@example.invalid',now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.accounts(name) values('tracking applicant') returning id into a;
 insert into public.accounts(name) values('tracking executor one') returning id into e;
 insert into public.accounts(name) values('tracking executor two') returning id into e2;
 insert into public.account_members(account_id,user_id,role) values(a,u,'owner'),(e,u,'owner'),(e2,u,'owner'),(a,viewer,'viewer'),(e,stranger,'owner');
 insert into public.roles(account_id,name,permissions) values(a,'tracking viewer','{"request_view":true}') returning id into role_id;
 insert into public.role_assignments(account_id,user_id,role_id) values(a,viewer,role_id);
 insert into public.stores(account_id,name,marketplace,store_code) values(a,'tracking store','Wildberries','TRTEST') returning id into st;
 select * into req from public.create_service_request_from_form(a,e,'tracking first','Tester',u||'@example.invalid','',null);
 draft:=jsonb_build_object('executorAccountId',e,'title','tracking first','stores',jsonb_build_array(jsonb_build_object(
  'store_id',st,'intake_mode','bulk','delivery_mode','self_delivery','position',0,
  'payload','{"items":[{"barcode":"TRACK-ITEM","name":"Tracked goods","qty":4}],"supplies":[]}'::jsonb)));
 perform public.open_service_request_work_draft(req.id,device);
 perform public.save_service_request_work_draft(req.id,device,draft);
 perform public.submit_service_request(req.id,device);
 perform public.accept_service_request(req.id);
 select batch_id into p from public.service_request_stores where request_id=req.id;
 select id into s from public.batch_pipeline_stages where batch_id=p and order_index=1;
 update public.fulfillment_items set qty_received=3,qty_marked=777,notes='PRIVATE WAREHOUSE' where pipeline_stage_id=s;
 perform public.record_fulfillment_step_result(p,s,'reception');
 update public.fulfillment_items set qty_received=99 where pipeline_stage_id=s;
 perform public.issue_reception_documents(p,s);
 select * into other from public.create_service_request_from_form(a,e2,'tracking second','Tester',u||'@example.invalid','',null);
 result:=public.list_client_request_tracking(a);
 if (result->>'total')::integer<>2 then raise exception 'Different executors missing'; end if;
 if (public.list_client_request_tracking(a,'R-'||req.short_id)->>'total')::integer<>1 then raise exception 'R-ID search broken'; end if;
 if (public.list_client_request_tracking(a,'second')->>'total')::integer<>1 then raise exception 'Title search broken'; end if;
 if jsonb_array_length(public.list_client_request_tracking(a,'',50)->'rows')<>0 then raise exception 'Pagination broken'; end if;
 result:=public.get_client_request_tracking(a,req.id);
 if (result#>>'{batches,0,stages,1,items,0,received}')::integer<>3 then raise exception 'Working reception leaked'; end if;
 if result#>>'{batches,0,stages,1,items,0,marked}' is not null then raise exception 'Unconfirmed marking leaked via reception snapshot'; end if;
 if result::text like '%PRIVATE WAREHOUSE%' or result::text like '%pricing_source%' or result::text like '%confirmed_by%' then raise exception 'Internal fields leaked'; end if;
 if jsonb_array_length(result#>'{batches,0,documents}')<>2 or jsonb_array_length(result->'history')=0 then raise exception 'Permitted documents/history missing'; end if;
 perform set_config('request.jwt.claim.sub',viewer::text,true);
 result:=public.get_client_request_tracking(a,req.id);
 if (result->>'history_allowed')::boolean or (result->>'documents_allowed')::boolean
  or jsonb_array_length(result->'history')<>0 or jsonb_array_length(result#>'{batches,0,documents}')<>0 then raise exception 'Separate permissions ignored'; end if;
 -- Membership or ownership of the issuer/executor is not applicant permission.
 perform set_config('request.jwt.claim.sub',stranger::text,true);
 begin perform public.get_client_request_tracking(a,req.id);raise exception 'FAIL: executor read applicant tracking';exception when insufficient_privilege then null;end;
 begin perform public.list_client_request_tracking(a);raise exception 'FAIL: outsider listed applicant';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 begin perform public.get_client_request_tracking(e,req.id);raise exception 'FAIL: mismatched account/request';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.get_client_request_tracking(a,req.id);raise exception 'FAIL: anonymous read';exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.get_client_request_tracking(uuid,uuid)','execute') then raise exception 'Anonymous grant'; end if;
end $$;
rollback;
