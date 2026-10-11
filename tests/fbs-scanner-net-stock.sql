-- Isolated empty database only. No real customers or WB requests.
begin;
do $$
declare
 u uuid:=gen_random_uuid(); a uuid; s uuid; w uuid; batch uuid; supply uuid;
 box uuid; item uuid; sess uuid; result jsonb; n integer;
begin
 insert into auth.users(id,email) values(u,'scanner-net@example.invalid');
 insert into accounts(name) values('Scanner net stock test') returning id into a;
 insert into account_members(account_id,user_id,role) values(a,u,'owner');
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 insert into stores(account_id,store_code,name) values(a,'scanner-net','Scanner test') returning id into s;
 insert into wms_warehouses(account_id,name,fbs_enabled) values(a,'Test warehouse',true) returning id into w;
 insert into fulfillment_batches(account_id,store_id,name,wms_warehouse_id) values(a,s,'Test batch',w) returning id into batch;
 insert into fulfillment_supplies(account_id,batch_id,warehouse_name,supply_number) values(a,batch,'Test',1) returning id into supply;
 insert into fulfillment_boxes(account_id,supply_id,box_number,barcode) values(a,supply,1,'TEST-BOX') returning id into box;
 insert into fulfillment_box_items(account_id,box_id,barcode,qty) values(a,box,'2052797745525',3) returning id into item;
 for n in 1..4 loop
  insert into fbs_orders(account_id,store_id,wb_order_id,supplier_status,wb_system_status,skus)
  values(a,s,'net-'||n,'confirm','waiting','["2052797745525"]');
  insert into fbs_wb_qr_catalog(account_id,store_id,order_id,qr_value,supports_sgtin)
  values(a,s,'net-'||n,'official-test-qr-'||n,true);
 end loop;
 -- Two real allocations leave ONE physical unit. Old scanner computed 1-2.
 perform reserve_fbs_order_from_box(s,'net-1',box);
 perform reserve_fbs_order_from_box(s,'net-2',box);
 if (select qty from fulfillment_box_items where id=item)<>1 then raise exception 'Bad fixture'; end if;
 insert into fbs_marking_sessions(account_id,store_id,created_by,device_id,active_box_id,barcode_scan_enabled,box_scan_enabled)
 values(a,s,u,'test-device',box,true,true) returning id into sess;
 result:=scan_fbs_product_barcode(sess,'test-device','2052797745525');
 if (result->>'available')::integer<>1 then raise exception 'Double subtraction in barcode'; end if;
 -- Full QR RPC invokes the second corrected trigger.
 perform scan_fbs_wb_qr(sess,'test-device','net-3','official-test-qr-3');
 if (select pending_order_id from fbs_marking_sessions where id=sess)<>'net-3' then raise exception 'QR failed'; end if;
 perform reserve_fbs_order_from_box(s,'net-3',box);
 perform reserve_fbs_order_from_box(s,'net-3',box);
 if (select qty from fulfillment_box_items where id=item)<>0 then raise exception 'Duplicate binding changed stock'; end if;
 begin
  perform reserve_fbs_order_from_box(s,'net-4',box);
  raise exception 'FAIL oversell';
 exception when raise_exception then if sqlerrm='FAIL oversell' then raise;end if;end;
 update fbs_marking_sessions set pending_order_id=null,pending_wb_qr=null,pending_product_barcode=null,pending_locked_until=null where id=sess;
 begin
  perform scan_fbs_product_barcode(sess,'test-device','2052797745525');
  raise exception 'FAIL empty barcode';
 exception when raise_exception then
  if sqlerrm not like 'В активном коробе закончился%' then raise;end if;
 end;
 update fbs_marking_sessions set pending_product_barcode='2052797745525' where id=sess;
 begin
  perform scan_fbs_wb_qr(sess,'test-device','net-4','official-test-qr-4');
  raise exception 'FAIL empty QR';
 exception when raise_exception then
  if sqlerrm not like 'В активном коробе закончился%' then raise;end if;
 end;
 if (select qty from fulfillment_box_items where id=item)<>0 then raise exception 'Negative stock';end if;
 raise notice 'fbs_scanner_net_stock_passed';
end;
$$;
rollback;
