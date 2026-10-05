import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.103.0'
import {eventHash,sendNumberedLetter} from '../_shared/numbered-email.ts'
export async function handleMailQueue(req:Request){
 const secret=Deno.env.get('MAIL_WORKER_SECRET')
 if(!secret||req.headers.get('Authorization')!==`Bearer ${secret}`)return new Response('Unauthorized',{status:401})
 if(req.method!=='POST')return new Response('Method not allowed',{status:405})
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),apiKey=Deno.env.get('RESEND_API_KEY')
 if(!url||!key||!apiKey)return new Response('Unavailable',{status:503})
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const claimed=await client.rpc('claim_numbered_mail')
 if(claimed.error)return new Response('Queue unavailable',{status:503})
 let sent=0,failed=0
 for(const job of claimed.data??[]){
  let ok=false
  try{
   await sendNumberedLetter({to:job.to,purpose:job.purpose,eventKey:await eventHash(`outbox:${job.id}`),heading:job.heading,message:job.message},
    {rpc:async(name,args)=>await client.rpc(name,args),apiKey,fetch,replyTo:job.reply_to??undefined})
   ok=true;sent++
  }catch{failed++}
  const finished=await client.rpc('finish_numbered_mail',{p_id:job.id,p_lease:job.lease,p_success:ok})
  if(finished.error)return new Response('Queue finalization pending',{status:503})
 }
 return Response.json({sent,failed})
}
if(import.meta.main)Deno.serve(handleMailQueue)
