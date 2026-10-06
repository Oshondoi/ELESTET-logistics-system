-- Extend implementation metadata audit to child records with an indirect company FK.
begin;
create function public.implementation_row_accounts(p_table oid,p_row jsonb,p_seen oid[] default '{}')
returns uuid[] language plpgsql stable security definer set search_path=public as $$
declare f record; key_value text; parent_row jsonb; result uuid[]:='{}'; candidate uuid;
begin
 if p_table=any(p_seen) or cardinality(p_seen)>=6 then return result;end if;
 p_seen:=array_append(p_seen,p_table);
 if p_table='public.accounts'::regclass then
  candidate:=(p_row->>'id')::uuid;
  if public.implementation_access(candidate,auth.uid()) then return array[candidate];end if;
  return result;
 end if;
 -- Prefer direct company keys; no need to scan unrelated product/store parents.
 for f in select a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
 where c.conrelid=p_table and c.contype='f' and cardinality(c.conkey)=1 and c.confrelid='public.accounts'::regclass loop
  candidate:=nullif(p_row->>f.attname,'')::uuid;
  if public.implementation_access(candidate,auth.uid()) then result:=array_append(result,candidate);end if;
 end loop;
 if cardinality(result)>0 then return result;end if;
 for f in select c.confrelid,n.nspname,t.relname,a.attname as child_column,b.attname as parent_column,format_type(b.atttypid,b.atttypmod) as parent_type
 from pg_constraint c join pg_class t on t.oid=c.confrelid join pg_namespace n on n.oid=t.relnamespace
 join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
 join pg_attribute b on b.attrelid=c.confrelid and b.attnum=c.confkey[1]
 where c.conrelid=p_table and c.contype='f' and cardinality(c.conkey)=1 and n.nspname='public'
 and c.confrelid<>'public.accounts'::regclass and not c.confrelid=any(p_seen)
 and t.relname not like 'implementation_%' loop
  key_value:=p_row->>f.child_column;
  if key_value is not null then
   execute format('select to_jsonb(t) from %I.%I t where %I=$1::%s',f.nspname,f.relname,f.parent_column,f.parent_type) into parent_row using key_value;
   if parent_row is not null then result:=result||public.implementation_row_accounts(f.confrelid,parent_row,p_seen);end if;
  end if;
 end loop;
 return array(select distinct x from unnest(result) x);
end $$;
revoke all on function public.implementation_row_accounts(oid,jsonb,oid[]) from public,anon,authenticated;

create or replace function public.audit_implementation_work() returns trigger language plpgsql security definer set search_path=public as $$
declare r jsonb; a uuid; p uuid;
begin
 if tg_op='DELETE' then r:=to_jsonb(old);else r:=to_jsonb(new);end if;
 -- Normal customer writes avoid the FK traversal entirely.
 if exists(select 1 from public.implementation_member_bridge where user_id=auth.uid()) then
  foreach a in array public.implementation_row_accounts(tg_relid,r) loop
   select id into p from public.implementation_projects where account_id=a and status='active';
   insert into public.implementation_audit(account_id,project_id,actor_id,event,details)
   values(a,p,auth.uid(),'work',jsonb_strip_nulls(jsonb_build_object('table',tg_table_name,'operation',tg_op,
    'id',r->>'id','role_id',r->>'role_id','user_id',r->>'user_id')));
  end loop;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
do $$ declare t record;begin
 for t in
 with recursive related(id) as (
  select 'public.accounts'::regclass::oid
  union
  select c.conrelid from pg_constraint c join related r on r.id=c.confrelid where c.contype='f' and cardinality(c.conkey)=1
 ) select c.oid,n.nspname,c.relname from related r join pg_class c on c.oid=r.id join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relname not like 'implementation_%'
 and c.relname not like 'calendar_%' and c.relname not like 'company_balance%' and c.relname not like 'company_billing%'
 and c.relname not like '%audit%' and c.relname not like '%queue%' and c.relname not like '%notification%'
 and c.relname not like '%event%' and c.relname not like '%history%'
 and not exists(select 1 from pg_trigger where tgrelid=c.oid and tgname='implementation_work_audit')
 loop execute format('create trigger implementation_work_audit after insert or update or delete on %I.%I for each row execute function public.audit_implementation_work()',t.nspname,t.relname);end loop;
end $$;
commit;
