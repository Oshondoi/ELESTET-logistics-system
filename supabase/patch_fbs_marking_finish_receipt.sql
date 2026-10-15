begin;

-- No WB writes: close only an already resolved session. Audit and state commit together.
create or replace function public.complete_resolved_fbs_marking_session(p_session_id uuid, p_device_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.fbs_marking_sessions%rowtype; n integer; sent integer; cancelled integer;
begin
  select * into s from public.fbs_marking_sessions where id=p_session_id for update;
  if auth.uid() is null or s.id is null or s.created_by is distinct from auth.uid()
     or s.device_id is distinct from p_device_id
     or not public.fbs_can_access_store(s.store_id,'fbs_assembly') then
    raise exception 'Нет доступа к сессии этого устройства';
  end if;
  if s.status='completed' then return jsonb_build_object('already_completed',true); end if;
  if s.status not in ('active','partial') then raise exception 'Сессия сейчас отправляется или закрыта'; end if;
  if s.device_identity_required and not s.device_named then raise exception 'Сначала присвойте имя устройству'; end if;
  if s.pending_order_id is not null or s.pending_product_barcode is not null then
    raise exception 'Сначала завершите текущую пару или сбросьте её';
  end if;
  perform 1 from public.fbs_marking_pairs where session_id=s.id for update;
  select count(*),count(*) filter(where status='sent'),count(*) filter(where status='cancelled')
    into n,sent,cancelled from public.fbs_marking_pairs where session_id=s.id;
  if n=0 or n<>sent+cancelled then raise exception 'Есть неотправленные пары или ошибки. Обновите сессию'; end if;
  perform public.fbs_append_marking_history('session_finished_without_resend',jsonb_build_object(
    'session_id',s.id,'actor_user_id',auth.uid(),'device_id',p_device_id,
    'event_data',jsonb_build_object('reason','all_remaining_pairs_resolved','previous_status',s.status,
      'remaining_pairs',n,'sent',sent,'cancelled',cancelled,'wb_requests_made',false,
      'deleted_pairs_in_history',(select count(*) from public.fbs_marking_history where session_id=s.id and event_type='pair_deleted'))));
  update public.fbs_marking_sessions set status='completed',completed_at=now(),submit_started_at=null,updated_at=now() where id=s.id;
  return jsonb_build_object('already_completed',false,'sent',sent,'cancelled',cancelled);
end $$;
revoke all on function public.complete_resolved_fbs_marking_session(uuid,text) from public,anon;
grant execute on function public.complete_resolved_fbs_marking_session(uuid,text) to authenticated;

-- Record observed data, never infer who changed an order in the external WB cabinet.
create or replace function public.audit_fbs_pair_submission_evidence()
returns trigger language plpgsql security definer set search_path=public as $$
declare o jsonb;
begin
  if new.status in ('sent','error') and (new.status is distinct from old.status or new.error is distinct from old.error) then
    select jsonb_build_object('supplier_status',supplier_status,'wb_system_status',wb_system_status,
      'snapshot_updated_at',to_jsonb(fbs_orders)->'updated_at') into o
    from public.fbs_orders where store_id=new.store_id and wb_order_id=new.order_id limit 1;
    perform public.fbs_append_marking_history('pair_submission_evidence',jsonb_build_object(
      'session_id',new.session_id,'pair_id',new.id,'order_id',new.order_id,
      'event_data',jsonb_build_object('result',new.status,'error',new.error,'sent_at',new.sent_at,
        'observed_order',o,'source','elestet_synchronized_wb_cache','external_status_actor','unknown')));
  end if;
  return new;
end $$;
revoke all on function public.audit_fbs_pair_submission_evidence() from public,anon,authenticated;
drop trigger if exists audit_fbs_pair_submission_evidence_trigger on public.fbs_marking_pairs;
create trigger audit_fbs_pair_submission_evidence_trigger after update of status,error on public.fbs_marking_pairs
for each row execute function public.audit_fbs_pair_submission_evidence();

-- Read-only evidence export. No INSERT/UPDATE/DELETE privileges on the journal.
create or replace function public.get_fbs_marking_session_receipt(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.fbs_marking_sessions%rowtype;
begin
  select * into s from public.fbs_marking_sessions where id=p_session_id;
  if auth.uid() is null or s.id is null or not public.fbs_can_access_store(s.store_id,'fbs_assembly') then
    raise exception 'Нет доступа к истории сессии';
  end if;
  return jsonb_build_object('format','elestet-marking-receipt-v1','exported_at',now(),
    'session_id',s.id,'account_id',s.account_id,'store_id',s.store_id,'status',s.status,
    'started_at',s.started_at,'completed_at',s.completed_at,
    'note','История ELESTET. Внешний автор смены статуса WB неизвестен. Завершение сессии не отменяет отправленные КИЗ.',
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'event',h.event_type,'at',h.occurred_at,
      'actor_user_id',h.actor_user_id,'actor_name',h.actor_name,'device_id',h.device_id,'device_name',h.device_name,
      'order_id',h.order_id,'data',h.event_data) order by h.occurred_at,h.id)
      from public.fbs_marking_history h where h.session_id=s.id),'[]'::jsonb));
end $$;
revoke all on function public.get_fbs_marking_session_receipt(uuid) from public,anon;
grant execute on function public.get_fbs_marking_session_receipt(uuid) to authenticated;
commit;
