// Management SQL runs in independent sessions. No users/companies/requests inserted.
// Verifies all entry points wait BEFORE business reads/writes for the same actor.
import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
const token=process.env.SUPABASE_ACCESS_TOKEN,project=process.env.SUPABASE_PROJECT_REF;
if(!token||!project)throw Error('Set management credentials in environment');
async function sql(query){const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(25000)});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;}
const actor=randomUUID(),other=randomUUID(),invite=randomUUID();
const setup=`select set_config('request.jwt.claim.sub','${actor}',true);`;
const holder=sql(`begin;${setup} select public.lock_request_invite_actor(); select pg_sleep(10); rollback; select 'released' as result;`);
try{
 let locked=false;
 for(let i=0;i<30;i++){const r=await sql(`begin;select pg_try_advisory_xact_lock(hashtextextended('request-user:${actor}',8123)) as acquired;commit;`);if(r[0]?.acquired===false){locked=true;break;}await new Promise(r=>setTimeout(r,100));}
 assert.equal(locked,true,'Holder lock observed');
 const calls=[
  `public.reserve_service_request_invite('${invite}','Fixture','nobody@example.invalid')`,
  `public.replace_service_request_invite_reserve('${invite}')`,
  `public.claim_service_request_invite('${invite}',null,true)`,
  `public.submit_my_request_reserve('${invite}','C','N','nobody@example.invalid','T','','[]',null,null)`,
  `public.submit_my_request_reserve('${invite}','C','N','nobody@example.invalid','T','','[]',null,null,'${other}')`,
  `public.submit_service_request_invite_reserve('${invite}','C','N','nobody@example.invalid','T','','[]',null)`,
  `public.submit_service_request_invite_reserve('${invite}','C','N','nobody@example.invalid','T','','[]',null,'${other}')`,
 ];
 await Promise.all(calls.map(async call=>{
  await sql(`begin;set local lock_timeout='500ms';${setup} do $$ begin begin perform ${call};raise exception 'FAIL: entry bypassed actor serialization';exception when lock_not_available then null;end;end $$;rollback;select 'blocked correctly' as result;`);
 }));
 await sql(`begin;set local lock_timeout='500ms';select set_config('request.jwt.claim.sub','${other}',true);select public.lock_request_invite_actor();rollback;select 'independent actor not blocked' as result;`);
 console.log('invite_concurrency_ok: 7 entry points serialized for one actor; independent actor proceeds; no fixtures persisted');
}finally{await holder;}
