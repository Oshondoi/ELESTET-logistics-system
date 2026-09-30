-- Apply after v41. Confirmation journals, rejection/reassignment, notifications.
begin;

create or replace function public.notify_request_executor(p_request_id uuid,p_event text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.service_requests%rowtype;
begin
  select * into r from public.service_requests where id=p_request_id;
  if r.executor_account_id is null then return; end if;
  insert into public.batch_notifications(account_id,type,title,body,recipient_user_id,source_request_id)
  select r.executor_account_id,'service_request_'||p_event,
    case when p_event='corrected' then 'Обновлена заявка R-' else 'Новая заявка R-' end||r.short_id,
    case when p_event='corrected' then 'Заявленные данные обновлены. Фактическая приёмка не изменена.'
         else 'Заявка подтверждена и доступна для исполнения.' end,
    am.user_id,r.id
  from public.account_members am
  where am.account_id=r.executor_account_id and (
    am.role in ('owner','admin') or am.user_id=r.responsible_user_id or exists(
      select 1 from public.role_assignments ra join public.roles role on role.id=ra.role_id and role.account_id=ra.account_id
      where ra.account_id=am.account_id and ra.user_id=am.user_id
        and coalesce((role.permissions->>'request_manage')::boolean,false)
    )
  ) group by am.user_id;
end $$;
revoke all on function public.notify_request_executor(uuid,text) from public,anon,authenticated;

-- One delivery per recipient per confirmation, including self-orders.
-- v41 calls this compatibility wrapper only for an initial confirmation.
create or replace function public.submit_service_request_v40(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_account uuid;
begin
  select applicant_account_id into v_account from public.service_requests where id=p_request_id;
  if not public.request_user_has_permission(v_account,'request_create') then raise exception 'Нет права подтверждать заявку'; end if;
  v_result:=public.submit_service_request_impl(p_request_id);
  perform public.notify_request_executor(p_request_id,'submitted');
  return v_result;
end $$;
revoke all on function public.submit_service_request_v40(uuid) from public,anon,authenticated;

create or replace function public.reassign_rejected_service_request(p_request_id uuid,p_executor_account_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.service_requests%rowtype; e public.accounts%rowtype; v_version integer;
begin
  select * into r from public.service_requests where id=p_request_id and deleted_at is null for update;
  if not found or not public.request_user_has_permission(r.applicant_account_id,'request_create') then raise exception 'Заявка недоступна'; end if;
  if r.status<>'rejected' then raise exception 'Сменить исполнителя можно только после отказа'; end if;
  select * into e from public.accounts where id=p_executor_account_id and deleted_at is null;
  if not found then raise exception 'Выберите действующую компанию'; end if;
  if e.id=r.executor_account_id then raise exception 'Выберите другого исполнителя'; end if;
  if exists(select 1 from public.batch_pipeline_stages s join public.fulfillment_batches b on b.id=s.batch_id
            where b.source_request_id=r.id and s.order_index>0) then
    raise exception 'У заявки уже есть стадия исполнителя';
  end if;
  v_version:=r.current_version+1;
  update public.service_requests set executor_account_id=e.id,executor_company_short_id=e.short_id,
    executor_company_name=e.name,status='submitted',responsible_user_id=null,work_started_at=null,
    accepted_at=null,rejected_at=null,rejection_comment=null,submitted_at=now(),current_version=v_version,updated_at=now()
  where id=r.id;
  update public.fulfillment_batches set operator_account_id=e.id,request_acceptance_status='pending',status='active',updated_at=now()
  where source_request_id=r.id and deleted_at is null;
  update public.service_request_work_drafts set draft=jsonb_set(draft,'{executorAccountId}',to_jsonb(e.id)),
    lease_device=null,lease_last_seen=null where request_id=r.id;
  if e.id=r.applicant_account_id then
    update public.batch_pipeline_stages s set status='active',current_stage='reception',completed_at=null,name='Исполнитель',
      stage_otk=b.stage_otk,stage_packaging=b.stage_packaging,stage_marking=b.stage_marking,stage_logistics=b.stage_logistics
    from public.fulfillment_batches b where b.id=s.batch_id and b.source_request_id=r.id and s.order_index=0;
    update public.service_requests set status='accepted',accepted_at=now() where id=r.id;
    update public.fulfillment_batches set request_acceptance_status='accepted' where source_request_id=r.id;
    update public.fulfillment_items i set qty_received=0,qty_defect=0
    from public.fulfillment_batches b where b.id=i.batch_id and b.source_request_id=r.id;
  end if;
  insert into public.service_request_versions(request_id,version,event_type,snapshot,confirmed_by)
  values(r.id,v_version,'submitted',public.request_snapshot(r.id),auth.uid());
  insert into public.service_request_events(request_id,event_type,details,actor_id)
  values(r.id,'executor_changed',jsonb_build_object('previous_executor_account_id',r.executor_account_id,'executor_account_id',e.id),auth.uid());
  perform public.notify_request_executor(r.id,'submitted');
  return jsonb_build_object('ok',true,'request_id',r.id,'version',v_version);
end $$;
revoke all on function public.reassign_rejected_service_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reassign_rejected_service_request(uuid,uuid) to authenticated;

-- Immutable, complete step results. Working writes never create a version.
create table if not exists public.fulfillment_step_versions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.fulfillment_batches(id) on delete cascade,
  pipeline_stage_id uuid references public.batch_pipeline_stages(id) on delete cascade,
  step text not null check(step in ('reception','otk','packaging','marking','packing','logistics')),
  version integer not null,
  snapshot jsonb not null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now()
);
create unique index if not exists fulfillment_step_versions_scope on public.fulfillment_step_versions
  (batch_id,coalesce(pipeline_stage_id,'00000000-0000-0000-0000-000000000000'::uuid),step,version);
alter table public.fulfillment_step_versions enable row level security;
revoke all on public.fulfillment_step_versions from anon,authenticated;
grant select on public.fulfillment_step_versions to authenticated;
drop policy if exists step_versions_read on public.fulfillment_step_versions;
create policy step_versions_read on public.fulfillment_step_versions for select to authenticated using (
  (pipeline_stage_id is null and exists(select 1 from public.fulfillment_batches b where b.id=batch_id and
    public.request_user_has_permission(b.account_id,'fulfillment_view')))
  or exists(select 1 from public.batch_pipeline_stages s where s.id=pipeline_stage_id and
    public.request_user_has_permission(coalesce(s.partner_account_id,s.owner_account_id),'fulfillment_view'))
);

create or replace function public.record_fulfillment_step_result(p_batch_id uuid,p_pipeline_stage_id uuid,p_step text)
returns integer language plpgsql security definer set search_path=public as $$
declare v_snapshot jsonb; v_previous jsonb; v_version integer; v_logs jsonb:='[]'::jsonb; v_supplies jsonb:='[]'::jsonb;
begin
  -- Serialize all confirmations of this batch, including concurrent corrections.
  perform 1 from public.fulfillment_batches where id=p_batch_id for update;
  if not found then raise exception 'Партия не найдена'; end if;
  if p_step in ('otk','packaging','marking') then
    execute format('select coalesce(jsonb_agg(to_jsonb(l)-''user_email''-''tariff'' order by l.id),''[]''::jsonb) from public.%I l where l.batch_id=$1 and l.pipeline_stage_id is not distinct from $2 and l.deleted_at is null',
      case p_step when 'otk' then 'fulfillment_otk_logs' when 'packaging' then 'fulfillment_packaging_logs' else 'fulfillment_marking_logs' end)
      into v_logs using p_batch_id,p_pipeline_stage_id;
  end if;
  if p_step in ('packing','logistics') then
    select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'warehouse_name',s.warehouse_name,'boxes',
      coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'items',coalesce((select jsonb_agg(jsonb_build_object('barcode',i.barcode,'qty',i.qty) order by i.id)
        from public.fulfillment_box_items i where i.box_id=b.id),'[]'::jsonb)) order by b.id)
        from public.fulfillment_boxes b where b.supply_id=s.id),'[]'::jsonb)) order by s.id),'[]'::jsonb)
    into v_supplies from public.fulfillment_supplies s
    where s.batch_id=p_batch_id and s.pipeline_stage_id is not distinct from p_pipeline_stage_id;
  end if;
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'lineage_id',i.lineage_id,'barcode',i.barcode,'name',i.product_name,'article',i.article,
    'size',i.size,'color',i.color,'declared',i.qty_declared,'received',i.qty_received,'defect',i.qty_defect,
    'otk',i.qty_otk,'marked',i.qty_marked,'packed',i.qty_packed,'boxes',i.boxes,'warehouse',i.notes,'excluded',i.is_excluded) order by i.id),'[]'::jsonb),
    'logs',v_logs,'supplies',v_supplies) into v_snapshot
  from public.fulfillment_items i where i.batch_id=p_batch_id and i.pipeline_stage_id is not distinct from p_pipeline_stage_id;
  select snapshot,version into v_previous,v_version from public.fulfillment_step_versions
  where batch_id=p_batch_id and pipeline_stage_id is not distinct from p_pipeline_stage_id and step=p_step order by version desc limit 1;
  if v_previous=v_snapshot then return v_version; end if;
  v_version:=coalesce(v_version,0)+1;
  insert into public.fulfillment_step_versions(batch_id,pipeline_stage_id,step,version,snapshot,confirmed_by)
  values(p_batch_id,p_pipeline_stage_id,p_step,v_version,v_snapshot,auth.uid());
  return v_version;
end $$;
revoke all on function public.record_fulfillment_step_result(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.confirm_fulfillment_step_correction(p_batch_id uuid,p_pipeline_stage_id uuid,p_step text)
returns integer language plpgsql security definer set search_path=public as $$
declare b public.fulfillment_batches%rowtype; s public.batch_pipeline_stages%rowtype; v_version integer; v_previous integer; r public.service_requests%rowtype; v_items jsonb; v_supplies jsonb;
begin
  select * into b from public.fulfillment_batches where id=p_batch_id and deleted_at is null for update;
  if not found or b.status='cancelled' then raise exception 'Партия недоступна'; end if;
  if p_pipeline_stage_id is not null then
    select * into s from public.batch_pipeline_stages where id=p_pipeline_stage_id and batch_id=b.id;
    if not found or not public.request_user_has_permission(coalesce(s.partner_account_id,s.owner_account_id),'fulfillment_manage') then raise exception 'Нет права корректировать стадию'; end if;
  elsif not public.request_user_has_permission(b.account_id,'fulfillment_manage') then raise exception 'Нет права корректировать партию';
  end if;
  if not exists(select 1 from public.fulfillment_stage_logs where batch_id=b.id and pipeline_stage_id is not distinct from p_pipeline_stage_id and stage=p_step)
     and not (s.status='done' and s.order_index=0 and b.source_request_id is not null and (p_step='reception' or (p_step='packing' and s.stage_packing))) then
    raise exception 'Сначала завершите этап';
  end if;
  select coalesce(max(version),0) into v_previous from public.fulfillment_step_versions
  where batch_id=b.id and pipeline_stage_id is not distinct from p_pipeline_stage_id and step=p_step;
  v_version:=public.record_fulfillment_step_result(b.id,p_pipeline_stage_id,p_step);
  if v_version=v_previous then return v_version; end if;
  -- Publish downstream declared data only at explicit confirmation, never on
  -- a scan, inline write or intermediate save of the completed stage.
  if p_step='reception' then
    perform set_config('app.confirming_step_result','on',true);
    update public.fulfillment_items set qty_received=qty_received
    where batch_id=b.id and pipeline_stage_id is not distinct from p_pipeline_stage_id;
    perform set_config('app.confirming_step_result','off',true);
  end if;
  if b.source_request_id is not null and s.order_index=0 and s.status='done' and p_step in ('reception','packing') then
    select * into r from public.service_requests where id=b.source_request_id for update;
    select coalesce(jsonb_agg(jsonb_build_object('barcode',i.barcode,'name',i.product_name,'article',i.article,
      'size',i.size,'color',i.color,'qty',i.qty_received,'position',i.sort_order) order by i.sort_order),'[]'::jsonb)
    into v_items from public.fulfillment_items i where i.pipeline_stage_id=s.id and not i.is_excluded;
    select coalesce(jsonb_agg(jsonb_build_object('key',supply.id,'warehouse_name',supply.warehouse_name,'boxes',
      coalesce((select jsonb_agg(jsonb_build_object('key',box.id,'items',coalesce((select jsonb_agg(jsonb_build_object('barcode',item.barcode,'qty',item.qty))
        from public.fulfillment_box_items item where item.box_id=box.id),'[]'::jsonb)))
        from public.fulfillment_boxes box where box.supply_id=supply.id),'[]'::jsonb))),'[]'::jsonb)
    into v_supplies from public.fulfillment_supplies supply where supply.pipeline_stage_id=s.id;
    perform public.validate_service_request_intake(jsonb_build_object('items',v_items,'supplies',v_supplies),
      case when jsonb_array_length(v_supplies)>0 then 'boxes' else 'bulk' end);
    update public.service_request_stores set payload=jsonb_build_object('items',v_items,'supplies',v_supplies),
      intake_mode=case when jsonb_array_length(v_supplies)>0 then 'boxes' else 'bulk' end,updated_at=now()
    where id=b.source_request_store_id;
    update public.service_requests set current_version=current_version+1,updated_at=now() where id=r.id;
    insert into public.service_request_versions(request_id,version,event_type,snapshot,confirmed_by)
    values(r.id,r.current_version+1,'corrected',public.request_snapshot(r.id),auth.uid());
    insert into public.service_request_events(request_id,event_type,details,actor_id)
    values(r.id,'corrected',jsonb_build_object('pipeline_stage_id',s.id,'step',p_step),auth.uid());
    perform public.notify_request_executor(r.id,'corrected');
  end if;
  return v_version;
end $$;
revoke all on function public.confirm_fulfillment_step_correction(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_fulfillment_step_correction(uuid,uuid,text) to authenticated;

create or replace function public.record_confirmed_fulfillment_step()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.stage in ('reception','otk','packaging','marking','packing','logistics') then
    perform public.record_fulfillment_step_result(new.batch_id,new.pipeline_stage_id,new.stage);
  end if;
  return new;
end $$;
drop trigger if exists record_confirmed_fulfillment_step on public.fulfillment_stage_logs;
create trigger record_confirmed_fulfillment_step after insert on public.fulfillment_stage_logs
for each row execute function public.record_confirmed_fulfillment_step();

-- Keep old audit rows intact as legacy history; no new per-keystroke business history.
drop trigger if exists audit_fulfillment_reception_item_trigger on public.fulfillment_items;
revoke insert on public.fulfillment_otk_log_history,public.fulfillment_marking_log_history from authenticated,anon;

-- Request confirmation/correction snapshots are taken after all item/box writes.
create or replace function public.record_request_stage_results(p_request_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s record;
begin
  for s in select b.id batch_id,ps.id stage_id,ps.stage_packing from public.fulfillment_batches b
    join public.batch_pipeline_stages ps on ps.batch_id=b.id and ps.order_index=0
    where b.source_request_id=p_request_id and ps.status='done'
  loop
    perform public.record_fulfillment_step_result(s.batch_id,s.stage_id,'reception');
    if s.stage_packing then perform public.record_fulfillment_step_result(s.batch_id,s.stage_id,'packing'); end if;
  end loop;
end $$;
revoke all on function public.record_request_stage_results(uuid) from public,anon,authenticated;
do $$ declare src text; begin
  if to_regprocedure('public.submit_service_request_v41(uuid)') is null then
    alter function public.submit_service_request(uuid) rename to submit_service_request_v41;
  else
    src:=pg_get_functiondef('public.submit_service_request(uuid)'::regprocedure);
    if strpos(src,'public.submit_service_request_v41(p_request_id)')=0 then
      execute replace(src,'FUNCTION public.submit_service_request(','FUNCTION public.submit_service_request_v41(');
    end if;
  end if;
end $$;
create or replace function public.submit_service_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  perform 1 from public.service_requests where id=p_request_id and status in ('draft','submitted','accepted') and deleted_at is null for update;
  if not found then raise exception 'Заявку нельзя подтвердить в текущем состоянии'; end if;
  if exists(select 1 from public.service_request_work_drafts where request_id=p_request_id and lease_last_seen>now()-interval '2 minutes')
     and current_setting('app.request_work_lease_verified',true) is distinct from 'on' then
    raise exception 'Черновик открыт в новом интерфейсе; обновите страницу';
  end if;
  perform set_config('app.confirming_step_result','on',true);
  result:=public.submit_service_request_v41(p_request_id);
  perform public.record_request_stage_results(p_request_id);
  perform set_config('app.confirming_step_result','off',true);
  return result;
end $$;
revoke all on function public.submit_service_request_v41(uuid) from public,anon,authenticated;
revoke all on function public.submit_service_request(uuid) from public,anon,authenticated;
grant execute on function public.submit_service_request(uuid) to authenticated;

-- Replace the old owner/admin-only correction notification loop, preserving the
-- mature publish implementation. Assert the expected source before rewriting.
do $$ declare src text; start_at integer; stop_at integer;
begin
  src:=pg_get_functiondef('public.publish_service_request_correction(uuid)'::regprocedure);
  start_at:=strpos(src,'  if v_request.executor_account_id<>v_request.applicant_account_id then');
  if start_at>0 then
    stop_at:=strpos(substr(src,start_at),'  return jsonb_build_object');
    if stop_at=0 then raise exception 'Unexpected correction publisher definition'; end if;
    src:=substr(src,1,start_at-1)||E'  perform public.notify_request_executor(p_request_id,''corrected'');\n'||substr(src,start_at+stop_at-1);
    execute src;
  end if;
end $$;

-- Corrections use the same durable single-device work area as initial intake.
-- Accept only the last confirmed applicant version, even if its own stage is
-- currently being corrected. Never copy unconfirmed working quantities.
do $$ declare src text;
begin
  src:=pg_get_functiondef('public.accept_service_request(uuid)'::regprocedure);
  if strpos(src,'confirmed_item')=0 then
    src:=replace(src,'item.size,item.color,item.article,item.qty_received,0,0,item.boxes,item.notes,item.sort_order',
      'item.size,item.color,item.article,coalesce((confirmed_item->>''received'')::integer,item.qty_received),0,0,item.boxes,item.notes,item.sort_order');
    src:=replace(src,'where item.batch_id=v_batch.id and stage.order_index=0 and not item.is_excluded',
      E'left join lateral (select snapshot from public.fulfillment_step_versions where pipeline_stage_id=stage.id and step=''reception'' order by version desc limit 1) confirmed on true\n        left join lateral (select value confirmed_item from jsonb_array_elements(confirmed.snapshot->''items'') where value->>''id''=item.id::text) saved on true\n        where item.batch_id=v_batch.id and stage.order_index=0 and\n          case when confirmed.snapshot is null then not item.is_excluded else confirmed_item is not null and not coalesce((confirmed_item->>''excluded'')::boolean,false) end');
    src:=replace(src,'v_stage_id,item.lineage_id,item.id,item.barcode,item.product_name,',
      'v_stage_id,item.lineage_id,item.id,coalesce(confirmed_item->>''barcode'',item.barcode),coalesce(confirmed_item->>''name'',item.product_name),');
    src:=replace(src,'item.size,item.color,item.article,coalesce(',
      'coalesce(confirmed_item->>''size'',item.size),coalesce(confirmed_item->>''color'',item.color),coalesce(confirmed_item->>''article'',item.article),coalesce(');
    src:=replace(src,'0,0,item.boxes,item.notes,item.sort_order',
      '0,0,coalesce((confirmed_item->>''boxes'')::integer,item.boxes),coalesce(confirmed_item->>''warehouse'',item.notes),item.sort_order');
    execute src;
  end if;
end $$;

do $$ declare src text; signature text;
begin
  foreach signature in array array['public.open_service_request_work_draft(uuid,uuid)',
    'public.save_service_request_work_draft(uuid,uuid,jsonb)','public.heartbeat_service_request_work_draft(uuid,uuid)'] loop
    src:=pg_get_functiondef(signature::regprocedure);
    src:=replace(src,'v_request.status<>''draft''','v_request.status not in (''draft'',''submitted'',''accepted'')');
    src:=replace(src,'r.status=''draft''','r.status in (''draft'',''submitted'',''accepted'')');
    -- An expired lease remains writable by its holder until someone atomically
    -- takes it. Never silently reacquire after another device took ownership.
    if signature='public.save_service_request_work_draft(uuid,uuid,jsonb)' then
      src:=replace(src,'and lease_last_seen>now()-interval ''2 minutes''','');
    end if;
    execute src;
  end loop;
end $$;

do $$ declare src text;
begin
  src:=pg_get_functiondef('public.save_my_request_reserve(uuid,jsonb,uuid)'::regprocedure);
  execute replace(src,'and r.lease_last_seen>now()-interval ''2 minutes''','');
end $$;

-- Restore readable errors and keep step advance + confirmed snapshot atomic.
do $$ declare src text; signature text;
begin
  foreach signature in array array['public.propagate_pipeline_declared_correction()','public.sync_completed_stage_stock_correction()'] loop
    src:=pg_get_functiondef(signature::regprocedure);
    if strpos(src,'app.confirming_step_result')=0 then
      src:=regexp_replace(src,E'begin\\n',E'begin\n  if current_setting(''app.confirming_step_result'',true) is distinct from ''on'' then return new; end if;\n');
      execute src;
    end if;
  end loop;
end $$;

create or replace function public.advance_batch_pipeline_step(p_stage_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.batch_pipeline_stages%rowtype; v_next text;
begin
  select * into s from public.batch_pipeline_stages where id=p_stage_id for update;
  if not found then raise exception 'Стадия не найдена'; end if;
  if s.status<>'active' or s.current_stage='done' then raise exception 'Стадия не активна'; end if;
  if not public.is_pipeline_stage_executor(s.id) then raise exception 'Нет доступа'; end if;
  v_next:=public.next_pipeline_fulfillment_step(s);
  insert into public.fulfillment_stage_logs(batch_id,pipeline_stage_id,stage,completed_by)
  values(s.batch_id,s.id,s.current_stage,auth.uid());
  update public.batch_pipeline_stages set current_stage=v_next,updated_at=now() where id=s.id;
  return jsonb_build_object('ok',true,'current_stage',v_next);
end $$;

create or replace function public.submit_service_request(p_request_id uuid,p_device_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.service_requests%rowtype; d jsonb; result jsonb;
begin
  select * into r from public.service_requests where id=p_request_id for update;
  if not found or not public.request_user_has_permission(r.applicant_account_id,'request_create') then raise exception 'Заявка недоступна'; end if;
  select draft into d from public.service_request_work_drafts
  where request_id=r.id and lease_device=p_device_id and lease_last_seen>now()-interval '2 minutes' for update;
  if not found then
    if r.status in ('submitted','accepted') and not exists(select 1 from public.service_request_work_drafts where request_id=r.id) then
      return public.submit_service_request(r.id);
    end if;
    raise exception 'Право подтверждения черновика истекло или передано другому устройству';
  end if;
  perform set_config('app.request_work_lease_verified','on',true);
  if r.status in ('submitted','accepted') then
    perform public.save_service_request_draft(r.id,coalesce(d->>'title',r.title),
      coalesce(nullif(d->>'executorAccountId','')::uuid,r.executor_account_id),r.applicant_name,r.applicant_email,
      coalesce(d->>'comment',''),coalesce(d->'stores','[]'::jsonb));
  end if;
  result:=public.submit_service_request(r.id);
  delete from public.service_request_work_drafts where request_id=r.id;
  return result;
end $$;

-- Keep old saved correction drafts available when the new editor opens.
create or replace function public.seed_request_work_correction()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.draft='{}'::jsonb then
    select coalesce((select draft from public.service_request_correction_drafts where request_id=new.request_id),'{}'::jsonb) into new.draft;
  end if;
  return new;
end $$;
drop trigger if exists seed_request_work_correction on public.service_request_work_drafts;
create trigger seed_request_work_correction before insert on public.service_request_work_drafts
for each row execute function public.seed_request_work_correction();

notify pgrst,'reload schema';
-- Legacy (single-stage) batches also confirm and advance in one transaction.
create or replace function public.advance_fulfillment_batch(p_batch_id uuid,p_expected_step text)
returns public.fulfillment_batches language plpgsql security definer set search_path=public as $$
declare b public.fulfillment_batches%rowtype; steps text[]:=array['reception','otk','packaging','marking','packing','logistics','done']; n integer;
begin
  select * into b from public.fulfillment_batches where id=p_batch_id and deleted_at is null for update;
  if not found or not public.request_user_has_permission(b.account_id,'fulfillment_manage') then raise exception 'Нет доступа к партии'; end if;
  if b.status='cancelled' or b.current_stage is distinct from p_expected_step or b.current_stage='done' then raise exception 'Этап уже изменился; обновите партию'; end if;
  if exists(select 1 from public.batch_pipeline_stages where batch_id=b.id) then raise exception 'Выберите стадию партии'; end if;
  n:=array_position(steps,b.current_stage)+1;
  while n<7 loop
    exit when (steps[n]='otk' and b.stage_otk) or (steps[n]='packaging' and b.stage_packaging)
      or (steps[n]='marking' and b.stage_marking) or (steps[n]='packing' and b.stage_packing)
      or (steps[n]='logistics' and b.stage_logistics);
    n:=n+1;
  end loop;
  insert into public.fulfillment_stage_logs(batch_id,stage,completed_by) values(b.id,b.current_stage,auth.uid());
  update public.fulfillment_batches set current_stage=steps[n],status=case when n=7 then 'done' else 'active' end,updated_at=now()
  where id=b.id returning * into b;
  return b;
end $$;
revoke all on function public.advance_fulfillment_batch(uuid,text) from public,anon,authenticated;
grant execute on function public.advance_fulfillment_batch(uuid,text) to authenticated;
commit;
