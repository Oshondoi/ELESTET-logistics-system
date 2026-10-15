-- Local clone only; all fixtures roll back.
begin;
do $$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); a uuid; st uuid; sid uuid; pid uuid; receipt jsonb; n integer;
begin
 insert into auth.users(id,email) values(u,'finish@example.invalid'),(outsider,'outsider@example.invalid');
 insert into public.accounts(name) values('Finish test') returning id into a;
 insert into public.account_members(account_id,user_id,role) values(a,u,'owner');
 insert into public.stores(account_id,store_code,name) values(a,'finish-test','Finish') returning id into st;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.fbs_marking_sessions(account_id,store_id,created_by,device_id,device_name,status,box_scan_enabled,barcode_scan_enabled)
 values(a,st,u,'test-device','Test','partial',false,false) returning id into sid;
 insert into public.fbs_orders(account_id,store_id,wb_order_id,supplier_status,wb_system_status)
 values(a,st,'receipt-1','confirm','waiting');
 insert into public.fbs_marking_pairs(session_id,account_id,store_id,order_id,wb_qr,sgtin,created_by,device_id,status)
 values(sid,a,st,'receipt-1','QR-test','010460000000000021TEST',u,'test-device','error') returning id into pid;
 begin
  perform public.complete_resolved_fbs_marking_session(sid,'test-device');
  raise exception 'TEST unresolved allowed';
 exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 update public.fbs_marking_pairs set status='sent',sent_at=now(),error=null where id=pid;
 if not exists(select 1 from public.fbs_marking_history where session_id=sid and event_type='pair_submission_evidence') then raise exception 'Evidence missing'; end if;
 update public.fbs_marking_sessions set pending_product_barcode='123' where id=sid;
 begin
  perform public.complete_resolved_fbs_marking_session(sid,'test-device');
  raise exception 'TEST pending allowed';
 exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 update public.fbs_marking_sessions set pending_product_barcode=null where id=sid;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin
  perform public.complete_resolved_fbs_marking_session(sid,'test-device');
  raise exception 'TEST outsider finished';
 exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 begin
  perform public.get_fbs_marking_session_receipt(sid);
  raise exception 'TEST outsider exported';
 exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 begin
  perform public.complete_resolved_fbs_marking_session(sid,'wrong-device');
  raise exception 'TEST wrong device allowed';
 exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 perform public.complete_resolved_fbs_marking_session(sid,'test-device');
 perform public.complete_resolved_fbs_marking_session(sid,'test-device');
 if (select status from public.fbs_marking_sessions where id=sid)<>'completed' then raise exception 'Not completed'; end if;
 if (select count(*) from public.fbs_marking_history where session_id=sid and event_type='session_finished_without_resend')<>1 then raise exception 'Duplicate audit'; end if;
 if (select status from public.fbs_marking_pairs where id=pid)<>'sent' then raise exception 'Sent pair changed'; end if;
 receipt:=public.get_fbs_marking_session_receipt(sid);
 if jsonb_array_length(receipt->'events')<3 then raise exception 'Receipt lost history'; end if;
end $$;
rollback;
