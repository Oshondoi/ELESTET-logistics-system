begin;
-- Read-only applicant projection. Branding/invite ownership never authorizes data.
-- No generic row/snapshot serialization: internal warehouses, tariffs, staff and
-- working (unconfirmed) fulfillment values are intentionally excluded.
create or replace function public.list_client_request_tracking(p_account uuid,p_search text default '',p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.request_user_has_permission(p_account,'request_view') then
  raise exception 'Нет доступа к заявкам компании' using errcode='42501';
 end if;
 if p_offset is null or p_offset<0 or length(coalesce(p_search,''))>200 then raise exception 'Некорректный поиск'; end if;
 with matching as (
  select r.id,r.short_id,r.title,r.status,r.created_at,r.applicant_company_short_id,
   r.executor_company_short_id,r.executor_company_name,
   greatest(r.updated_at,(select max(s.updated_at) from public.fulfillment_batches b
     join public.batch_pipeline_stages s on s.batch_id=b.id
     where b.source_request_id=r.id and b.deleted_at is null
       and coalesce(s.partner_account_id,s.owner_account_id) in (r.applicant_account_id,r.executor_account_id)),
    (select max(v.confirmed_at) from public.fulfillment_step_versions v join public.fulfillment_batches b on b.id=v.batch_id
     join public.batch_pipeline_stages s on s.id=v.pipeline_stage_id and s.batch_id=b.id
     where b.source_request_id=r.id and b.deleted_at is null
       and coalesce(s.partner_account_id,s.owner_account_id) in (r.applicant_account_id,r.executor_account_id))) as updated_at
  from public.service_requests r where r.applicant_account_id=p_account and r.deleted_at is null
   and (coalesce(trim(p_search),'')='' or position(lower(trim(p_search)) in lower(coalesce(r.title,'')))>0
      or lower(trim(p_search)) in (r.short_id::text,'r-'||r.short_id::text))
 ), page as (select * from matching order by updated_at desc,id limit 50 offset p_offset)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.updated_at desc,p.id) from page p),'[]'::jsonb),
   'total',(select count(*) from matching),'synced_at',now()) into result;
 return result;
end $$;
revoke all on function public.list_client_request_tracking(uuid,text,integer) from public,anon;
grant execute on function public.list_client_request_tracking(uuid,text,integer) to authenticated;

create or replace function public.get_client_request_tracking(p_account uuid,p_request uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.service_requests%rowtype; batches jsonb; events jsonb; history_allowed boolean; documents_allowed boolean;
begin
 if auth.uid() is null or not public.request_user_has_permission(p_account,'request_view') then
  raise exception 'Нет доступа к заявкам компании' using errcode='42501';
 end if;
 select * into r from public.service_requests where id=p_request and applicant_account_id=p_account and deleted_at is null;
 if not found then raise exception 'Заявка недоступна' using errcode='42501'; end if;
 history_allowed:=public.request_user_has_permission(p_account,'request_history_view');
 documents_allowed:=public.request_user_has_permission(p_account,'fulfillment_view');
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',b.id,'short_id',b.short_id,'owner_short_id',a.short_id,'name',b.name,'status',b.status,
  'store_name',st.name,'acceptance_status',b.request_acceptance_status,
  'stages',coalesce((select jsonb_agg(jsonb_build_object(
    'id',s.id,'order_index',s.order_index,'company_short_id',sa.short_id,'company_name',sa.name,
    'step',s.current_stage,'status',s.status,'activated_at',s.activated_at,'completed_at',s.completed_at,
    'confirmed_at',(select max(fv.confirmed_at) from public.fulfillment_step_versions fv where fv.batch_id=b.id and fv.pipeline_stage_id=s.id),
    'items',coalesce((select jsonb_agg(jsonb_build_object('barcode',i->>'barcode','name',i->>'name',
      'article',i->>'article','size',i->>'size','color',i->>'color','declared',i->'declared',
      'received',i->'received',
      'defect',(select oi->'defect' from jsonb_array_elements(coalesce(otk.snapshot->'items','[]'::jsonb)) oi where oi->>'id'=i->>'id' limit 1),
      'otk',(select oi->'otk' from jsonb_array_elements(coalesce(otk.snapshot->'items','[]'::jsonb)) oi where oi->>'id'=i->>'id' limit 1),
      'marked',(select mi->'marked' from jsonb_array_elements(coalesce(marking.snapshot->'items','[]'::jsonb)) mi where mi->>'id'=i->>'id' limit 1),
      'packed',(select pi->'packed' from jsonb_array_elements(coalesce(packing.snapshot->'items','[]'::jsonb)) pi where pi->>'id'=i->>'id' limit 1)) order by ord)
      from jsonb_array_elements(coalesce(v.snapshot->'items','[]'::jsonb)) with ordinality item(i,ord)
      where coalesce((i->>'excluded')::boolean,false)=false),'[]'::jsonb)
   ) order by s.order_index,s.id)
   from public.batch_pipeline_stages s
   join public.accounts sa on sa.id=coalesce(s.partner_account_id,s.owner_account_id)
   left join lateral (select fv.snapshot,fv.confirmed_at from public.fulfillment_step_versions fv
     where fv.batch_id=b.id and fv.pipeline_stage_id=s.id and fv.step='reception' order by fv.version desc limit 1) v on true
   left join lateral (select fv.snapshot from public.fulfillment_step_versions fv where fv.batch_id=b.id and fv.pipeline_stage_id=s.id and fv.step='otk' order by fv.version desc limit 1) otk on true
   left join lateral (select fv.snapshot from public.fulfillment_step_versions fv where fv.batch_id=b.id and fv.pipeline_stage_id=s.id and fv.step='marking' order by fv.version desc limit 1) marking on true
   left join lateral (select fv.snapshot from public.fulfillment_step_versions fv where fv.batch_id=b.id and fv.pipeline_stage_id=s.id and fv.step='packing' order by fv.version desc limit 1) packing on true
   where s.batch_id=b.id and sa.id in (r.applicant_account_id,r.executor_account_id)),'[]'::jsonb),
  'documents',case when documents_allowed then coalesce((select jsonb_agg(jsonb_build_object(
    'id',d.id,'kind',d.kind,'revision',d.revision,'status',d.status,'issued_at',d.issued_at,
    'accepted_quantity',d.payload->'accepted_quantity') order by d.issued_at desc,d.id)
   from public.fulfillment_batch_documents d
   where d.batch_id=b.id and d.status in ('issued','agreed') and d.issued_at is not null
    and (d.pipeline_stage_id is null or exists(select 1 from public.batch_pipeline_stages ds
      where ds.id=d.pipeline_stage_id and ds.batch_id=b.id
       and coalesce(ds.partner_account_id,ds.owner_account_id) in (r.applicant_account_id,r.executor_account_id)))),'[]'::jsonb)
   else '[]'::jsonb end
 ) order by rs.position,b.id),'[]'::jsonb) into batches
 from public.service_request_stores rs
 join public.fulfillment_batches b on b.id=rs.batch_id and b.source_request_id=r.id and b.deleted_at is null
 join public.accounts a on a.id=b.account_id
 left join public.stores st on st.id=rs.applicant_store_id
 where rs.request_id=r.id and rs.deleted_at is null;
 if history_allowed then
  select coalesce(jsonb_agg(to_jsonb(e) order by e.at desc,e.id),'[]'::jsonb) into events from (
   select v.id::text id,v.confirmed_at at,'request'::text kind,v.event_type event,v.version,
    null::integer batch_short_id,null::integer owner_short_id,null::integer company_short_id
   from public.service_request_versions v where v.request_id=r.id
   union all
   select fv.id::text,fv.confirmed_at,'step',fv.step,fv.version,b.short_id,a.short_id,sa.short_id
   from public.fulfillment_step_versions fv join public.fulfillment_batches b on b.id=fv.batch_id
   join public.accounts a on a.id=b.account_id
   join public.batch_pipeline_stages s on s.id=fv.pipeline_stage_id and s.batch_id=b.id
   join public.accounts sa on sa.id=coalesce(s.partner_account_id,s.owner_account_id)
   where b.source_request_id=r.id and b.deleted_at is null and sa.id in (r.applicant_account_id,r.executor_account_id)
  ) e;
 else events:='[]'::jsonb; end if;
 return jsonb_build_object('id',r.id,'short_id',r.short_id,'title',r.title,'status',r.status,
  'applicant_company_short_id',r.applicant_company_short_id,
  'executor_company_short_id',r.executor_company_short_id,'executor_company_name',r.executor_company_name,
  'created_at',r.created_at,'updated_at',r.updated_at,'work_started_at',r.work_started_at,
  'batches',batches,'history',events,'history_allowed',history_allowed,'documents_allowed',documents_allowed,'synced_at',now());
end $$;
revoke all on function public.get_client_request_tracking(uuid,uuid) from public,anon;
grant execute on function public.get_client_request_tracking(uuid,uuid) to authenticated;
commit;
