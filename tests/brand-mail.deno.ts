import {handleBrandMail,codeHash} from '../supabase/functions/brand-mail/index.ts'
import {handleMailQueue} from '../supabase/functions/process-numbered-mail/index.ts'
const assert=(v:unknown,m:string)=>{if(!v)throw new Error(m)}
Deno.test('brand mail verifies user, hashes OTP, numbers mail and worker requires secret',async()=>{
 Deno.env.set('SUPABASE_URL','https://database.invalid');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','test-service-secret');Deno.env.set('RESEND_API_KEY','test');Deno.env.set('MAIL_WORKER_SECRET','worker-test')
 const original=globalThis.fetch;let sent=0,db=0,challenge='',hash=''
 globalThis.fetch=async(input,init)=>{
  const url=String(input),body=init?.body?JSON.parse(init.body as string):{}
  if(url.includes('/auth/v1/user'))return Response.json({id:'11111111-1111-4111-8111-111111111111',email:'owner@example.invalid'})
  if(url.endsWith('/begin_brand_mail_verification')){db++;challenge=body.p_challenge;hash=body.p_hash;assert(!JSON.stringify(body).includes('code"'),'raw code sent to DB');return Response.json({email:'company@example.invalid',challenge_id:challenge})}
  if(url.endsWith('/prepare_email_dispatch'))return Response.json({number:'7',requested_at:'2026-10-06T01:00:00Z',sent:false})
  if(url.endsWith('/complete_email_dispatch'))return Response.json(null)
  if(url==='https://api.resend.com/emails'){
   sent++;assert(body.subject==='ELESTET — письмо №7','number missing');const code=body.text.match(/\n(\d{6})\n/)[1];assert(await codeHash('test-service-secret',challenge,code)===hash,'hash mismatch');return Response.json({id:'test-id'})
  }
  if(url.endsWith('/claim_numbered_mail'))return Response.json([])
  throw new Error('Unexpected network request')
 }
 try{
  assert((await handleBrandMail(new Request('https://test.invalid',{method:'POST'}))).status===401,'unauthorized accepted')
  assert(db===0&&sent===0,'unauthorized side effect')
  const result=await handleBrandMail(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer user-token'},body:JSON.stringify({action:'request',account_id:'22222222-2222-4222-8222-222222222222',email:'company@example.invalid'})}))
  assert(result.status===200&& (await result.json()).number==='7','verification delivery');assert(sent===1,'send count')
  assert((await handleMailQueue(new Request('https://test.invalid',{method:'POST'}))).status===401,'worker unauthenticated')
  assert((await handleMailQueue(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer worker-test'}}))).status===200,'worker authorized')
 }finally{globalThis.fetch=original}
})
