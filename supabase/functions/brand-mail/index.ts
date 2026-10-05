import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import {eventHash,sendNumberedLetter} from '../_shared/numbered-email.ts'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}
export async function codeHash(secret:string,challenge:string,code:string){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`brand-mail:${challenge}:${code}`))
 return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('')
}
export async function handleBrandMail(req:Request){
 const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:cors})
 if(req.method==='OPTIONS')return new Response(null,{headers:cors})
 if(req.method!=='POST')return reply({error:'Method not allowed'},405)
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),apiKey=Deno.env.get('RESEND_API_KEY')
 if(!url||!key||!apiKey)return reply({error:'Почта временно недоступна'},503)
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')
 if(!token)return reply({error:'Войдите в аккаунт'},401)
 const {data:auth,error:authError}=await client.auth.getUser(token)
 if(authError||!auth.user)return reply({error:'Войдите в аккаунт'},401)
 try{
  const raw=await req.text();if(raw.length>2048)return reply({error:'Слишком большой запрос'},413)
  const body=JSON.parse(raw),account=body.account_id
  if(typeof account!=='string'||!/^[a-f0-9-]{36}$/i.test(account))return reply({error:'Некорректная компания'},400)
  if(body.action==='request'){
   if(typeof body.email!=='string')return reply({error:'Проверьте адрес почты'},400)
   const challenge=crypto.randomUUID(),code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0')
   const started=await client.rpc('begin_brand_mail_verification',{p_account:account,p_user:auth.user.id,p_email:body.email,p_challenge:challenge,p_hash:await codeHash(key,challenge,code)})
   if(started.error)return reply({error:started.error.message},400)
   const letter={to:started.data.email,purpose:'notification' as const,eventKey:await eventHash(`brand-email:${challenge}`),heading:'Подтверждение почты компании',code}
   const meta=await sendNumberedLetter(letter,{rpc:async(name,args)=>await client.rpc(name,args),apiKey,fetch})
   return reply({challenge_id:challenge,number:meta.number})
  }
  if(body.action==='verify'){
   if(typeof body.challenge_id!=='string'||typeof body.code!=='string'||!/^\d{6}$/.test(body.code))return reply({error:'Введите шестизначный код'},400)
   const result=await client.rpc('verify_brand_mail',{p_account:account,p_user:auth.user.id,p_challenge:body.challenge_id,p_hash:await codeHash(key,body.challenge_id,body.code)})
   if(result.error)return reply({error:'Не удалось проверить код'},400)
   return reply(result.data)
  }
  return reply({error:'Неизвестное действие'},400)
 }catch{return reply({error:'Не удалось отправить или проверить код. Попробуйте позже.'},503)}
}
if(import.meta.main)Deno.serve(handleBrandMail)
