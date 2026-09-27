import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!
const ANON_KEY=Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response(null,{headers:cors})
  try{
    const authorization=req.headers.get('Authorization')
    if(!authorization) return json({error:'Не авторизован'},401)
    const userClient=createClient(SUPABASE_URL,ANON_KEY,{global:{headers:{Authorization:authorization}}})
    const {data:{user}}=await userClient.auth.getUser()
    if(!user) return json({error:'Не авторизован'},401)
    const body=await req.json() as Record<string,unknown>
    const action=String(body.action??'')
    const storeId=String(body.store_id??'')
    if(!storeId) return json({error:'store_id обязателен'},400)
    const permission=action==='seller_info'?'stores_manage':action==='feedbacks_reply'?'reviews_manage':'reviews_view'
    const svc=createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false}})
    const {data:allowed}=await svc.rpc('server_user_has_store_permission',{p_user_id:user.id,p_store_id:storeId,p_permission:permission})
    if(!allowed) return json({error:'Нет права на операцию магазина'},403)
    const {data:apiKey}=await svc.rpc('get_store_wb_api_key',{p_store_id:storeId})
    if(!apiKey) return json({error:'API-ключ WB не настроен'},400)

    let url=''; let method='GET'; let requestBody:unknown=undefined
    if(action==='seller_info') url='https://common-api.wildberries.ru/api/v1/seller-info'
    else if(action==='feedbacks_list') url=`https://feedbacks-api.wildberries.ru/api/v1/feedbacks?isAnswered=${body.is_answered===true}&take=100&skip=0`
    else if(action==='feedbacks_reply'){url='https://feedbacks-api.wildberries.ru/api/v1/feedbacks/answer';method='PATCH';requestBody={id:body.feedback_id,text:body.text}}
    else return json({error:'Неизвестная операция'},400)

    const response=await fetch(url,{method,headers:{Authorization:String(apiKey),...(requestBody?{'Content-Type':'application/json'}:{})},body:requestBody?JSON.stringify(requestBody):undefined})
    const text=await response.text()
    let payload:unknown=text
    try{payload=text?JSON.parse(text):{}}catch{/* preserve upstream text */}
    if(!response.ok) return json({error:response.status===429?'Лимит WB API. Повторите позже.':`Ошибка WB API: ${response.status}`,details:payload},response.status)
    return json({ok:true,data:payload,retry_after:Number(response.headers.get('Retry-After')||response.headers.get('X-Ratelimit-Reset')||4)})
  }catch(error){return json({error:error instanceof Error?error.message:String(error)},500)}
})
