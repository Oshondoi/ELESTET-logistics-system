// Schema-only production read; ALL mutations and payment proofs target loopback PostgreSQL.
// Install embedded-postgres@17.6.0-beta.15 and pg in an isolated temporary directory.
// Business concurrency tests, not a production throughput benchmark or replacement for RLS tests.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const root=resolve(process.env.PG_TEST_ROOT||'');
if(!process.env.PG_TEST_ROOT||!root.includes('elestet-concurrency-'))throw Error('Use a dedicated temporary PG_TEST_ROOT');
const {default:EmbeddedPostgres}=await import(pathToFileURL(join(root,'node_modules/embedded-postgres/dist/index.js')).href);
const token=process.env.SUPABASE_ACCESS_TOKEN,project=process.env.SUPABASE_PROJECT_REF;
if(!token||!project)throw Error('Read-only schema export requires management credentials');
async function remote(query){
 if(!/^select\s/i.test(query))throw Error('Remote writes prohibited');
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(30000)});
 const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;
}
const scope="(n.nspname='public' or (n.nspname='auth' and c.relname in ('users','identities')))";
const pg=new EmbeddedPostgres({databaseDir:join(root,'data-'+randomUUID()),user:'postgres',password:randomUUID(),port:55439,persistent:true,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','max_connections=60'],onLog:()=>{},onError:()=>{}});
let db;const clients=[];
async function connect(){const c=pg.getPgClient('postgres','127.0.0.1');await c.connect();await c.query("set statement_timeout='20s';set lock_timeout='10s'");clients.push(c);return c;}
const sql=async(q,p)=>db.query(q,p);
function expectedFailures(results,pattern){for(const r of results)if(r.status==='rejected'){assert.notEqual(r.reason.code,'40P01','no deadlocks');assert.notEqual(r.reason.code,'55P03','no lock timeouts');assert.match(r.reason.message,pattern);}}
async function asUser(user,work,role='authenticated') {const c=await connect();try{await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[user,role,JSON.stringify({sub:user,role,amr:[{method:'otp',timestamp:Math.floor(Date.now()/1000)}]})]);const result=await work(c);await c.query('commit');return result;}catch(e){await c.query('rollback');throw e;}finally{await c.end();clients.splice(clients.indexOf(c),1);}}
async function user(){const id=randomUUID();await sql('insert into auth.users(id,email,email_confirmed_at,created_at) values($1,$2,now(),now())',[id,`${id}@example.invalid`]);return id;}
async function company(owner,name='Local concurrency company'){const {rows:[a]}=await sql('insert into public.accounts(name) values($1) returning id',[name]);await sql("insert into public.account_members(account_id,user_id,role) values($1,$2,'owner')",[a.id,owner]);return a.id;}
try{
 await pg.initialise();await pg.start();db=await connect();
 await sql("create schema auth;create schema extensions;create schema storage;create schema net;create schema vault;create schema cron;create role anon;create role authenticated;create role service_role bypassrls;create extension pgcrypto with schema extensions;create extension pg_trgm with schema extensions;create extension if not exists \"uuid-ossp\" with schema extensions;set check_function_bodies=off;set search_path=public,extensions;");
 for(const r of await remote("select format('create type %I.%I as enum (%s)',n.nspname,t.typname,string_agg(quote_literal(e.enumlabel),',' order by e.enumsortorder)) as ddl from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname in ('public','auth') group by n.nspname,t.typname"))await sql(r.ddl);
 for(const r of await remote("select format('create sequence %I.%I',n.nspname,c.relname) as ddl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='S'"))await sql(r.ddl);
 const tables=await remote(`select c.oid,c.relname,n.nspname,c.relrowsecurity,c.relforcerowsecurity,format('create table %I.%I (%s)',n.nspname,c.relname,string_agg(format('%I %s%s%s',a.attname,format_type(a.atttypid,a.atttypmod),case when a.attgenerated<>'' then ' generated always as ('||(select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d where d.adrelid=c.oid and d.adnum=a.attnum)||') stored' else '' end,case when a.attnotnull then ' not null' else '' end),',' order by a.attnum)) as ddl from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped where ${scope} and c.relkind='r' group by c.oid,c.relname,n.nspname`);
 for(const r of tables)await sql(r.ddl);
 for(let offset=0;;offset+=30){const rows=await remote(`select pg_get_functiondef(p.oid) as ddl,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname in ('public','auth') and l.lanname in ('sql','plpgsql') and p.prokind='f' order by p.oid limit 30 offset ${offset}`);for(const r of rows)await sql(r.ddl);if(rows.length<30)break;}
 for(const r of await remote(`select format('alter table %I.%I alter column %I %s',n.nspname,c.relname,a.attname,case when a.attidentity<>'' then 'add generated by default as identity' else 'set default '||pg_get_expr(d.adbin,d.adrelid) end) as ddl from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where ${scope} and c.relkind='r' and a.attnum>0 and (d.oid is not null or a.attidentity<>'') and a.attgenerated=''`))await sql(r.ddl);
 const constraints=await remote(`select format('alter table %I.%I add constraint %I %s',n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid)) as ddl,k.contype from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where ${scope} and k.contype in ('p','u','c','f') order by case k.contype when 'f' then 1 else 0 end,k.oid`);
 for(const r of constraints)await sql(r.ddl);
 for(const r of await remote(`select pg_get_indexdef(i.indexrelid) as ddl from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where ${scope} and not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)`))await sql(r.ddl);
 for(const r of await remote(`select pg_get_triggerdef(t.oid) as ddl from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${scope} and not t.tgisinternal`))await sql(r.ddl);
 // No cron jobs, worker processes, Edge functions, outbound mail or real customer rows copied.
 const cfg=(await remote('select to_jsonb(c) as row from public.calendar_billing_config c'))[0].row;
 await sql('insert into public.calendar_billing_config select * from jsonb_populate_record(null::public.calendar_billing_config,$1)',[JSON.stringify({...cfg,checkout_enabled:true,provider_enabled:true})]);
 for(const r of await remote("select to_jsonb(c) as row from public.plan_configs c where key in ('seller','operational')"))await sql('insert into public.plan_configs select * from jsonb_populate_record(null::public.plan_configs,$1)',[JSON.stringify(r.row)]);
 console.log(`local_schema_ready: ${tables.length} empty tables; PostgreSQL 17.6; loopback only`);
 // Optional candidate migrations are executed only on the local clone.
 for(const file of (process.env.PG_TEST_PATCHES||'').split(';').filter(Boolean))await sql(await readFile(file,'utf8'));
 // Optional authorization suites: replay public RLS and table grants on the empty clone.
 if(process.env.PG_TEST_SQL){
  for(const r of await remote("select format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) as ddl from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname in ('public','auth') and l.lanname in ('sql','plpgsql') and p.prokind='f'"))await sql(r.ddl);
  for(const r of await remote("select format('grant execute on function %I.%I(%s) to %s',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),case when x.grantee=0 then 'public' else quote_ident(pg_get_userbyid(x.grantee)) end) as ddl from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where n.nspname in ('public','auth') and l.lanname in ('sql','plpgsql') and p.prokind='f' and (x.grantee=0 or pg_get_userbyid(x.grantee) in ('anon','authenticated','service_role'))"))await sql(r.ddl);
  for(const r of await remote("select format('create policy %I on %I.%I as %s for %s to %s%s%s',policyname,schemaname,tablename,permissive,cmd,array_to_string(roles,','),case when qual is null then '' else ' using ('||qual||')' end,case when with_check is null then '' else ' with check ('||with_check||')' end) as ddl from pg_policies where schemaname='public'"))await sql(r.ddl);
  for(const t of tables.filter(t=>t.nspname==='public'&&t.relrowsecurity))await sql(`alter table public."${t.relname}" enable row level security`);
  await sql('grant usage on schema public,auth to authenticated,anon,service_role');
  for(const r of await remote("select format('grant %s on table public.%I to %I',g.privilege_type,g.table_name,g.grantee) as ddl from information_schema.role_table_grants g join information_schema.tables t on t.table_schema=g.table_schema and t.table_name=g.table_name and t.table_type='BASE TABLE' where g.table_schema='public' and g.grantee in ('authenticated','anon','service_role')"))await sql(r.ddl);
  for(const file of process.env.PG_TEST_SQL.split(';').filter(Boolean))await sql(await readFile(file,'utf8'));
  console.log('local_authorization_suites_passed');
 }
 for(let round=1;round<=3;round++){console.log(`concurrency_round ${round}/3`);await runInvites();await runBilling();}
 console.log('local_concurrency_all_passed');
}finally{
 for(const c of [...clients])try{await c.end()}catch{}
 await pg.stop();
 console.log('local_postgres_stopped; disposable data retained under PG_TEST_ROOT for diagnosis');
}
async function runInvites(){
 const owner=await user(),executor=await company(owner,'Local executor'),applicant=await user();
 const tokens=[randomUUID(),randomUUID(),randomUUID()];const invites=[];
 for(const t of tokens){const {rows:[i]}=await sql('insert into public.service_request_invites(token,executor_account_id,created_by) values($1,$2,$3) returning id',[t,executor,owner]);invites.push(i.id);}
 for(const i of invites)await sql("insert into public.service_request_invite_reserves(invite_id,user_id,email,full_name,draft,expires_at) values($1,$2,$3,'Tester','{}',now()+interval '30 days')",[i,applicant,`${applicant}@example.invalid`]);
 // Valid lifecycle: two independent old drafts plus ONE current active link.
 await sql("update public.service_request_invites set deleted_at=now(),delete_reason='expired',expires_at=now()-interval '1 second' where id=any($1::uuid[])",[invites.slice(0,2)]);
 const goods=JSON.stringify([{name:'Local store',marketplace:'wildberries',intake_mode:'bulk',items:[{name:'Goods',barcode:'LOCAL',qty:2}]}]);
 const started=Date.now();
 const results=await Promise.all(invites.map(i=>asUser(applicant,c=>c.query("select public.submit_my_request_reserve($1,'Applicant','Tester',$2,'Local request','',$3,$4,null) as result",[i,`${applicant}@example.invalid`,goods,executor]))));
 assert.equal(new Set(results.map(r=>r.rows[0].result.account_id)).size,1,'one first company across simultaneous drafts');
 const account=results[0].rows[0].result.account_id;
 assert.equal((await sql('select count(*)::int n from public.service_requests where applicant_account_id=$1',[account])).rows[0].n,3);
 // Two employees authorized to bind the same company; both race for new links.
 const employee=await user();await sql("insert into public.account_members(account_id,user_id,role) values($1,$2,'owner')",[account,employee]);
 const fresh=[randomUUID(),randomUUID()];for(const t of fresh)await sql('insert into public.service_request_invites(token,executor_account_id,created_by) values($1,$2,$3)',[t,executor,owner]);
 await Promise.all(fresh.map((t,i)=>asUser(i?employee:applicant,c=>c.query('select * from public.claim_service_request_invite($1,$2,true)',[t,account]))));
 assert.equal((await sql('select count(*)::int n from public.service_request_invites where applicant_account_id=$1 and deleted_at is null and revoked_at is null and expires_at>now()',[account])).rows[0].n,1,'one active company link');
 assert.equal((await sql('select count(*)::int n from public.service_requests where applicant_account_id=$1 and executor_account_id=$2',[account,executor])).rows[0].n,3,'replacement retains request executors');
 const oldToken=randomUUID(),nextToken=randomUUID();
 const {rows:[old]}=await sql("insert into public.service_request_invites(token,executor_account_id,created_by,deleted_at,delete_reason) values($1,$2,$3,now(),'expired') returning id",[oldToken,executor,owner]);
 await sql("insert into public.service_request_invite_reserves(invite_id,user_id,email,full_name,draft,expires_at) values($1,$2,$3,'Tester','{}',now())",[old.id,applicant,`${applicant}@example.invalid`]);
 await sql('insert into public.service_request_invites(token,executor_account_id,created_by) values($1,$2,$3)',[nextToken,executor,owner]);
 const mixed=await Promise.allSettled([
  ...Array.from({length:5},()=>asUser(applicant,c=>c.query("select public.submit_my_request_reserve($1,'Applicant','Tester',$2,'Double submit','',$3,$4,$5)",[old.id,`${applicant}@example.invalid`,goods,executor,account]))),
  asUser(employee,c=>c.query('select * from public.claim_service_request_invite($1,$2,true)',[nextToken,account])),
 ]);
 assert.equal(mixed.slice(0,5).filter(x=>x.status==='fulfilled').length,1,'same draft submitted once');
 expectedFailures(mixed,/Черновик недоступен/);
 assert.equal(mixed[5].status,'fulfilled','replacement alongside submission');
 assert.equal((await sql('select count(*)::int n from public.service_requests where applicant_account_id=$1',[account])).rows[0].n,4);
 const outsider=await user();await assert.rejects(asUser(outsider,c=>c.query('select * from public.claim_service_request_invite($1,$2,true)',[nextToken,account])),/доступ/);
 assert.equal((await sql('select count(*)::int n from public.service_request_invites where applicant_account_id=$1 and deleted_at is null and revoked_at is null',[account])).rows[0].n,1);
 console.log(`invite_parallel_ok: 3 first submissions/one company, 2 employees, 5 duplicate submissions + replacement, outsider denied; ${Date.now()-started}ms`);
}
async function runBilling(){
 const owner=await user(),account=await company(owner,'Local billing');
 await sql('insert into public.company_billing_wallets(account_id,balance_som) values($1,10000)',[account]);
 const op=randomUUID();
 await Promise.all(Array.from({length:12},()=>asUser(owner,c=>c.query("select public.apply_company_balance_entry($1,$2,-1000,'checkout','local-test',true)",[account,op]),'service_role')));
 assert.equal((await sql('select balance_som::int n from public.company_billing_wallets where account_id=$1',[account])).rows[0].n,9000);
 assert.equal((await sql('select count(*)::int n from public.company_balance_entries where operation_id=$1',[op])).rows[0].n,1);
 const debits=await Promise.allSettled(Array.from({length:12},()=>asUser(owner,c=>c.query("select public.apply_company_balance_entry($1,$2,-1000,'checkout','local-spend',true)",[account,randomUUID()]),'service_role')));
 assert.equal(debits.filter(x=>x.status==='fulfilled').length,9,'no negative wallet');
 expectedFailures(debits,/Insufficient balance/);
 assert.equal((await sql('select balance_som::int n from public.company_billing_wallets where account_id=$1',[account])).rows[0].n,0);
 await sql('update public.company_billing_wallets set balance_som=100000 where account_id=$1',[account]);
 const order=randomUUID();
 await Promise.all(Array.from({length:8},()=>asUser(owner,c=>c.query("select public.create_company_checkout($1,$2,'seller','main',false,true)",[order,account]))));
 await Promise.all(Array.from({length:12},()=>asUser(owner,c=>c.query("select public.settle_company_checkout($1,$2,0,'KGS')",[order,`wallet:${order}`]))));
 assert.equal((await sql('select count(*)::int n from public.calendar_billing_cycles where account_id=$1',[account])).rows[0].n,1);
 assert.equal((await sql("select count(*)::int n from public.company_balance_entries where source_reference=$1 and reason='checkout'",[order])).rows[0].n,1);
 // Exact external proof delivered twelve times; no real payment provider is called.
 const brand=randomUUID();const o=(await asUser(owner,c=>c.query("select public.create_company_checkout($1,$2,'brand','brand',false,false) as result",[brand,account]))).rows[0].result;
 const proof='local-proof:'+randomUUID();
 await Promise.all(Array.from({length:12},()=>asUser(owner,c=>c.query("select public.settle_company_checkout($1,$2,$3,'KGS')",[brand,proof,o.external_som]),'service_role')));
 assert.equal((await sql('select status from public.calendar_billing_orders where id=$1',[brand])).rows[0].status,'paid');
 const raceOwner=await user(),raceAccount=await company(raceOwner,'Local cancellation race');
 await sql('insert into public.company_billing_wallets(account_id,balance_som) values($1,100000)',[raceAccount]);
 const proposals=Array.from({length:8},()=>randomUUID());
 const races=await Promise.allSettled(proposals.map(id=>asUser(raceOwner,c=>c.query("select public.create_company_checkout($1,$2,'seller','main',false,true) as result",[id,raceAccount]))));
 assert.equal(races.filter(x=>x.status==='fulfilled').length,1,'only one pending order per company');
 expectedFailures(races,/Сначала завершите или отмените предыдущий заказ/);
 const pending=races.find(x=>x.status==='fulfilled').value.rows[0].result;
 const cancellation=await Promise.allSettled([
  ...Array.from({length:6},()=>asUser(raceOwner,c=>c.query('select public.cancel_company_checkout($1)',[pending.id]))),
  ...Array.from({length:6},()=>asUser(raceOwner,c=>c.query("select public.settle_company_checkout($1,$2,0,'KGS')",[pending.id,`wallet:${pending.id}`]))),
 ]);
 expectedFailures(cancellation,/Заказ закрыт или истёк/);
 const final=(await sql('select status from public.calendar_billing_orders where id=$1',[pending.id])).rows[0];
 assert.ok(['paid','cancelled'].includes(final.status));
 const wallet=(await sql('select balance_som::int n from public.company_billing_wallets where account_id=$1',[raceAccount])).rows[0].n;
 assert.equal(wallet,100000-(final.status==='paid'?Number(pending.wallet_som):0),'cancel/payment race preserves exact wallet');
 assert.equal((await sql("select count(*)::int n from public.company_balance_entries where source_reference=$1 and reason='checkout_release'",[pending.id])).rows[0].n,final.status==='cancelled'?1:0);
 // A provider proof cannot pay a second order, even from another company.
 const duplicateOwner=await user(),duplicateAccount=await company(duplicateOwner,'Local duplicate proof'),duplicateOrder=randomUUID();
 const second=(await asUser(duplicateOwner,c=>c.query("select public.create_company_checkout($1,$2,'seller','main',false,false) as result",[duplicateOrder,duplicateAccount]))).rows[0].result;
 await assert.rejects(asUser(duplicateOwner,c=>c.query("select public.settle_company_checkout($1,$2,$3,'KGS')",[duplicateOrder,proof,second.external_som]),'service_role'),/unique/);
 assert.equal((await sql('select count(*)::int n from public.calendar_billing_cycles where account_id=$1',[duplicateAccount])).rows[0].n,0,'failed proof rolls back subscription');
 assert.equal((await sql('select status from public.calendar_billing_orders where id=$1',[duplicateOrder])).rows[0].status,'pending');
 console.log('billing_parallel_ok: duplicate debits/orders/proofs, competing spends/orders, cancel-vs-pay race, cross-company proof reuse rejected atomically');
}
