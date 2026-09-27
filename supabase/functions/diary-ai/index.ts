import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const URL=Deno.env.get('SUPABASE_URL')!,ANON=Deno.env.get('SUPABASE_ANON_KEY')!,SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:cors})
  try{
    const auth=req.headers.get('Authorization');if(!auth)return out({error:'Не авторизован'},401)
    const userClient=createClient(URL,ANON,{global:{headers:{Authorization:auth}}});const {data:{user}}=await userClient.auth.getUser();if(!user)return out({error:'Не авторизован'},401)
    const svc=createClient(URL,SERVICE,{auth:{persistSession:false}});const {data:rows,error}=await svc.rpc('get_server_diary_ai_secret',{p_user_id:user.id});if(error)throw error
    const secret=Array.isArray(rows)?rows[0]:rows;if(!secret?.api_key)return out({error:'Claude API-ключ не настроен'},400)
    const body=await req.json() as {systemPrompt?:string;messages?:Array<{role:string;content:string}>;maxTokens?:number}
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':secret.api_key,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:secret.claude_model,max_tokens:Math.min(Math.max(Number(body.maxTokens)||1000,1),4000),system:body.systemPrompt||'',messages:body.messages||[]})})
    const payload=await response.json().catch(()=>({})) as {content?:Array<{type:string;text:string}>;error?:{message?:string}}
    if(!response.ok)return out({error:response.status===429?'Превышен лимит Claude. Попробуйте позже.':payload.error?.message||`Claude API error ${response.status}`},response.status)
    return out({text:payload.content?.find(item=>item.type==='text')?.text?.trim()||''})
  }catch(error){return out({error:error instanceof Error?error.message:String(error)},500)}
})
