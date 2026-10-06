-- Read-only preview of the existing superadmin cascade. No customer rows changed.
begin;

create or replace function public.invite_delete_table_label(p_name text) returns text
language sql immutable set search_path=public as $$
 select coalesce(('{' ||
 '"service_requests":"Заявки","fulfillment_batches":"Партии","service_request_invite_reserves":"Черновики ссылки",' ||
 '"service_request_stores":"Магазины внутри заявок","service_request_work_drafts":"Рабочие черновики","service_request_correction_drafts":"Черновики корректировок",' ||
 '"service_request_events":"События заявок","service_request_versions":"Версии заявок","service_request_supply_archives":"Архивы поставок заявки",' ||
 '"batch_pipeline_stages":"Стадии партий","batch_outsource_stages":"Стадии аутсорса","fulfillment_items":"Товарные строки","fulfillment_supplies":"Поставки","fulfillment_boxes":"Короба","fulfillment_box_items":"Содержимое коробов",' ||
 '"fulfillment_batch_documents":"Документы партий","fulfillment_reception_history":"История приёмки","fulfillment_step_versions":"Подтверждённые версии этапов","fulfillment_stage_stock":"Остатки стадий","fulfillment_stage_warehouse_history":"История складов стадий",' ||
 '"batch_notifications":"Уведомления","batch_journal":"Журнал партий","batch_consumables":"Расходные материалы","batch_archive_votes":"Решения об архивировании",' ||
 '"fulfillment_marking_logs":"Маркировка","fulfillment_marking_log_history":"История маркировки","fulfillment_otk_logs":"ОТК","fulfillment_otk_log_history":"История ОТК","fulfillment_packaging_logs":"Упаковка","fulfillment_stage_logs":"Журнал этапов",' ||
 '"fulfillment_excel_action_history":"История Excel","fulfillment_wb_box_code_registry":"Коды коробов WB","fulfillment_box_barcode_registry":"Реестр штрихкодов коробов","fulfillment_kiz_pairs":"Связки КИЗ",' ||
 '"wms_inventory_scans":"Сканы инвентаризации","wms_cell_items":"Товары в складских ячейках","wms_movements":"История перемещений","trip_lines":"Строки рейсов","transgran_shipments":"Отправления Transgran",' ||
 '"fbs_stock_allocations":"Резервы FBS","fbs_marking_sessions":"Сессии маркировки FBS","store_links":"Связи магазинов"}')::jsonb->>p_name,p_name)
$$;
revoke all on function public.invite_delete_table_label(text) from public,anon,authenticated;

-- Internal collector follows actual FK cascades and explicitly deleted roots.
-- CTIDs never leave the server. No DELETE is attempted to obtain a preview.
create or replace function public.invite_delete_snapshot(p_invite_id uuid,p_lock boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
 v public.service_request_invites%rowtype; requests uuid[]; batches uuid[];
 graph jsonb:='{}'; prior jsonb; tids jsonb; selected text[]; fk record; seed record; rel record;
 join_sql text; rows_json jsonb; effects jsonb:='[]'; blocked jsonb:='[]'; groups jsonb:='[]';
 signatures text:=''; fingerprint text; key text; lock_sql text; detail jsonb;
begin
 if not public.is_platform_superadmin() then raise exception 'Недостаточно прав' using errcode='42501'; end if;
 if p_lock then select * into v from public.service_request_invites where id=p_invite_id for update;
 else select * into v from public.service_request_invites where id=p_invite_id; end if;
 if not found then raise exception 'Ссылка не найдена' using errcode='P0002'; end if;
 if v.delete_reason='data_deleted_by_superadmin' then
  return jsonb_build_object('already_deleted',true,'can_delete',false,'groups','[]'::jsonb,'effects','[]'::jsonb,'blockers','[]'::jsonb);
 end if;
 lock_sql:=case when p_lock then ' for update of x' else '' end;
 -- Lock parent requests before reading their batches: concurrent FK inserts wait.
 if p_lock then perform id from public.service_requests where invite_id=p_invite_id order by id for update; end if;
 select coalesce(array_agg(id),'{}') into requests from public.service_requests where invite_id=p_invite_id;
 if p_lock then perform id from public.fulfillment_batches where source_request_id=any(requests) order by id for update; end if;
 select coalesce(array_agg(id),'{}') into batches from public.fulfillment_batches where source_request_id=any(requests);
 for seed in select * from (values
  ('service_requests','x.invite_id=$1'),('fulfillment_batches','x.source_request_id=any($2)'),
  ('service_request_invite_reserves','x.invite_id=$1'),
  ('batch_notifications','x.batch_id=any($3) or x.source_request_id=any($2)'),
  ('fulfillment_batch_documents','x.batch_id=any($3)'),('fulfillment_reception_history','x.batch_id=any($3)'),
  ('fulfillment_stage_stock','x.batch_id=any($3)'),('fulfillment_stage_warehouse_history','x.batch_id=any($3)'),
  ('service_request_stores','x.request_id=any($2)'),('service_request_work_drafts','x.request_id=any($2)'),
  ('service_request_correction_drafts','x.request_id=any($2)'),('service_request_events','x.request_id=any($2)'),
  ('service_request_versions','x.request_id=any($2)')) as seeds(name,predicate)
 loop
  execute format('select coalesce(jsonb_agg(t),''[]'') from (select x.ctid::text t from public.%I x where %s order by x.ctid%s) q',seed.name,seed.predicate,lock_sql)
   into tids using p_invite_id,requests,batches;
  key:=to_regclass('public.'||seed.name)::oid::text;
  graph:=jsonb_set(graph,array[key],tids);
 end loop;
 loop
  prior:=graph;
  for fk in select c.* from pg_constraint c where c.contype='f' and c.confdeltype='c'
    and graph ? c.confrelid::text order by c.confrelid,c.conrelid,c.oid
  loop
   select string_agg(format('x.%I=p.%I',a.attname,b.attname),' and ' order by k.n) into join_sql
    from unnest(fk.conkey,fk.confkey) with ordinality k(a,b,n)
    join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.a
    join pg_attribute b on b.attrelid=fk.confrelid and b.attnum=k.b;
   selected:=array(select jsonb_array_elements_text(graph->fk.confrelid::text));
   execute format('select coalesce(jsonb_agg(t),''[]'') from (select x.ctid::text t from %s x where exists(select 1 from %s p where p.ctid=any($1::tid[]) and %s) order by x.ctid%s) q',fk.conrelid::regclass,fk.confrelid::regclass,join_sql,lock_sql)
    into tids using selected;
   select coalesce(jsonb_agg(t order by t),'[]') into tids from
    (select distinct jsonb_array_elements_text(coalesce(graph->fk.conrelid::text,'[]')||tids) t) q;
   graph:=jsonb_set(graph,array[fk.conrelid::text],tids);
  end loop;
  exit when prior=graph;
 end loop;
 -- Exact per-table inventory, explicit IDs/status, digest of entire rows to reject stale confirmation.
 for rel in select c.oid,c.relname from pg_class c where graph ? c.oid::text order by c.oid loop
  selected:=array(select jsonb_array_elements_text(graph->rel.oid::text));
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''id'',coalesce(j->>''id'',j->>''invite_id'',j->>''request_id'',t),''number'',coalesce(j->>''short_id'',j->>''box_number'',j->>''supply_number''),''name'',coalesce(j->>''title'',j->>''name'',j->>''barcode''),''status'',j->>''status'') order by t),''[]''),coalesce(string_agg(md5(j::text),'''' order by t),'''') from (select to_jsonb(x) j,x.ctid::text t from %s x where x.ctid=any($1::tid[])) q',rel.oid::regclass)
   into rows_json,fingerprint using selected;
  signatures:=signatures||rel.oid::text||fingerprint;
  if jsonb_array_length(rows_json)>0 then groups:=groups||jsonb_build_array(jsonb_build_object('table',rel.relname,'label',public.invite_delete_table_label(rel.relname),'count',jsonb_array_length(rows_json),'items',rows_json)); end if;
 end loop;
 -- External FK references are NOT silently included in the deletion scope.
 for fk in select c.*,cl.relname from pg_constraint c join pg_class cl on cl.oid=c.conrelid
   where c.contype='f' and c.confdeltype<>'c' and graph ? c.confrelid::text order by c.oid loop
  select string_agg(format('x.%I=p.%I',a.attname,b.attname),' and ' order by k.n) into join_sql
   from unnest(fk.conkey,fk.confkey) with ordinality k(a,b,n)
   join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.a
   join pg_attribute b on b.attrelid=fk.confrelid and b.attnum=k.b;
  selected:=array(select jsonb_array_elements_text(graph->fk.confrelid::text));
  execute format('select coalesce(jsonb_agg(jsonb_build_object(''id'',coalesce(j->>''id'',t),''status'',j->>''status'') order by t),''[]''),coalesce(string_agg(md5(j::text),'''' order by t),'''') from (select to_jsonb(x) j,x.ctid::text t from %s x where x.ctid<>all($2::tid[]) and exists(select 1 from %s p where p.ctid=any($1::tid[]) and %s) order by x.ctid%s) q',fk.conrelid::regclass,fk.confrelid::regclass,join_sql,lock_sql)
   into rows_json,fingerprint using selected,array(select jsonb_array_elements_text(coalesce(graph->fk.conrelid::text,'[]')));
  signatures:=signatures||fk.oid::text||fingerprint;
  if jsonb_array_length(rows_json)>0 then
   detail:=jsonb_build_object('code',case when fk.confdeltype in ('a','r') then 'LINKED_RECORDS' else 'LINKS_REMOVED' end,'table',fk.relname,'label',public.invite_delete_table_label(fk.relname),'count',jsonb_array_length(rows_json),'items',rows_json,
    'message',case when fk.confdeltype in ('a','r') then 'Сначала устраните блокирующую связь: ' else 'Записи сохранятся, но связь с удаляемыми данными будет снята: ' end||public.invite_delete_table_label(fk.relname));
   if fk.confdeltype in ('a','r') then blocked:=blocked||jsonb_build_array(detail);
   else effects:=effects||jsonb_build_array(detail); end if;
  end if;
 end loop;
 selected:=array(select jsonb_array_elements_text(coalesce(graph->'public.fulfillment_box_items'::regclass::oid::text,'[]')));
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'status',a.status) order by a.id),'[]') into rows_json
 from public.fbs_stock_allocations a join public.fulfillment_box_items bi on bi.id=a.box_item_id
 where bi.ctid=any(selected::tid[]) and a.status in ('reserved','awaiting_wb');
 if jsonb_array_length(rows_json)>0 then blocked:=blocked||jsonb_build_array(jsonb_build_object('code','FBS_RESERVED','table','fbs_stock_allocations','label','Резервы FBS','count',jsonb_array_length(rows_json),'items',rows_json,'message','Товар зарезервирован для FBS. Сначала завершите или снимите резерв штатным способом.')); end if;
 return jsonb_build_object('invite_id',v.id,'already_deleted',false,'can_delete',jsonb_array_length(blocked)=0,
  'fingerprint',md5(to_jsonb(v)::text||signatures||blocked::text),'groups',groups,'effects',effects,'blockers',blocked,
  'preserved',jsonb_build_array('Аккаунт, подтверждённая почта и пароль','Компания, её сотрудники, роли, настройки и подписка','Магазины компании','Заявки и черновики других ссылок','Административный аудит'),
  'notice','Ссылка перестанет работать. Удаление перечисленных данных необратимо. Связки КИЗ сохраняются в истории с отметкой удаления; связанные записи ниже сохраняются со снятием связей.');
end $$;
revoke all on function public.invite_delete_snapshot(uuid,boolean) from public,anon,authenticated;

create or replace function public.admin_preview_invite_deletion(p_invite_id uuid) returns jsonb
language sql security definer set search_path=public as $$ select public.invite_delete_snapshot(p_invite_id,false) $$;
revoke all on function public.admin_preview_invite_deletion(uuid) from public,anon;
grant execute on function public.admin_preview_invite_deletion(uuid) to authenticated;

-- Preserve the exact former cascade in a private function; old public API must not bypass preview.
do $$ begin
 if to_regprocedure('public.admin_delete_invite_data_internal(uuid)') is null then
  alter function public.admin_delete_service_request_invite_data(uuid) rename to admin_delete_invite_data_internal;
 end if;
end $$;
revoke all on function public.admin_delete_invite_data_internal(uuid) from public,anon,authenticated;
create or replace function public.admin_delete_service_request_invite_data(p_invite_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_platform_superadmin() then raise exception 'Недостаточно прав' using errcode='42501'; end if;
 return jsonb_build_object('ok',false,'code','PREVIEW_REQUIRED','message','Откройте предпросмотр удаления и подтвердите состав данных.');
end $$;
revoke all on function public.admin_delete_service_request_invite_data(uuid) from public,anon;
grant execute on function public.admin_delete_service_request_invite_data(uuid) to authenticated;

create or replace function public.admin_confirm_invite_deletion(p_invite_id uuid,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare snapshot jsonb; result jsonb;
begin
 snapshot:=public.invite_delete_snapshot(p_invite_id,true);
 if coalesce((snapshot->>'already_deleted')::boolean,false) then return jsonb_build_object('ok',true,'already_deleted',true); end if;
 if not (snapshot->>'can_delete')::boolean then return jsonb_build_object('ok',false,'code','BLOCKED','message','Удаление запрещено: устраните указанные связи.','preview',snapshot); end if;
 if p_fingerprint is null or p_fingerprint is distinct from snapshot->>'fingerprint' then
  return jsonb_build_object('ok',false,'code','PREVIEW_CHANGED','message','Данные изменились. Проверьте обновлённый состав и подтвердите ещё раз.','preview',snapshot);
 end if;
 begin
  result:=public.admin_delete_invite_data_internal(p_invite_id);
 exception when foreign_key_violation or check_violation or raise_exception then
  -- Subtransaction rolls back the WHOLE cascade; no raw SQL text or false success.
  return jsonb_build_object('ok',false,'code','DELETE_BLOCKED','message','Удаление остановлено ограничением связанных данных. Ничего не удалено. Обновите состав; если причина не показана, обратитесь в поддержку.');
 end;
 return result;
end $$;
revoke all on function public.admin_confirm_invite_deletion(uuid,text) from public,anon;
grant execute on function public.admin_confirm_invite_deletion(uuid,text) to authenticated;
commit;
