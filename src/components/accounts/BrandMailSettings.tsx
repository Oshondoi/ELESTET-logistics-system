import {useEffect,useRef,useState} from 'react'
import {supabase} from '../../lib/supabase'
type Settings={allowed:boolean;email:string|null;verified_at:string|null;fallback_allowed:boolean;pending_email:string|null;challenge_id:string|null;letter_number?:string|null}
export function BrandMailSettings({accountId}:{accountId:string}){
 const[data,setData]=useState<Settings|null>(null),[email,setEmail]=useState(''),[code,setCode]=useState(''),[number,setNumber]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
 const lock=useRef(false)
 async function read(){if(!supabase)throw new Error('Сервис недоступен');const r=await supabase.rpc('get_brand_mail_settings' as never,{p_account:accountId} as never);if(r.error)throw r.error;return r.data as unknown as Settings}
 async function reload(){const s=await read();setData(s);setNumber(s.letter_number??'');return s}
 useEffect(()=>{let active=true;read().then(s=>{if(active){setData(s);setNumber(s.letter_number??'');setEmail(s.pending_email??s.email??'')}}).catch(()=>{if(active)setMessage('Не удалось загрузить почтовые настройки')});return()=>{active=false}},[accountId])
 async function run(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(e instanceof Error?e.message:'Не удалось выполнить действие')}finally{lock.current=false;setBusy(false)}}
 async function invoke(body:Record<string,unknown>){
  if(!supabase)throw new Error('Сервис недоступен')
  const r=await supabase.functions.invoke('brand-mail',{body:{...body,account_id:accountId}})
  if(r.error){let msg='Почта временно недоступна';try{msg=(await r.error.context.json()).error??msg}catch{}throw new Error(msg)}
  if(r.data.error)throw new Error(r.data.error);return r.data
 }
 if(!data)return <p role="status">{message||'Загрузка почтовых настроек…'}</p>
 if(!data.allowed)return null
 return <section className="rounded-3xl border bg-white p-5" aria-label="Почта бренда">
  <h2 className="text-lg font-semibold">Свой бренд — почта</h2>
  <p className="mt-2 text-sm text-slate-500">Адрес для ответов клиентов. Почта входа в аккаунт не меняется. Отправка с вашего домена подключается отдельно.</p>
  <p className="mt-3 text-sm">Подтверждённый адрес: {data.verified_at?data.email:'не указан'}</p>
  <form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();void run(async()=>{setNumber('');const r=await invoke({action:'request',email});setNumber(r.number);setCode('');await reload();setMessage('Код отправлен')})}}>
   <label className="block text-sm">Почта компании<input aria-label="Почта компании" type="email" required maxLength={254} value={email} disabled={busy} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-xl border p-3"/></label>
   <button disabled={busy} className="rounded-xl border px-4 py-2">Получить код</button>
  </form>
  <div className="mt-3 h-36 overflow-auto">
   <p className="h-8 text-lg font-bold text-black">{busy?'Отправка / проверка…':number?`Письмо №${number}`:''}</p>
   {data.challenge_id&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{const r=await invoke({action:'verify',challenge_id:data.challenge_id,code});if(!r.ok)throw new Error(r.message);await reload();setCode('');setMessage('Почта подтверждена')})}}>
    <p className="mb-2 text-xs text-slate-500">Код для {data.pending_email}. До подтверждения используется прежний адрес.</p>
    <div className="flex gap-2"><input aria-label="Код почты компании" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} className="min-w-0 flex-1 rounded-xl border p-3"/><button disabled={busy||code.length!==6}>Подтвердить</button></div>
   </form>}
  </div>
  <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={data.fallback_allowed} disabled={busy} onChange={e=>{const allowed=e.target.checked;void run(async()=>{const r=await supabase!.rpc('set_brand_mail_fallback' as never,{p_account:accountId,p_allowed:allowed} as never);if(r.error)throw r.error;await reload();setMessage(allowed?'Резервная отправка разрешена':'Резервная отправка запрещена')})}}/>Разрешаю отправку от ELESTET, если почта моего бренда недоступна.</label>
  <div className="mt-3 h-14 overflow-auto text-sm" role="status" aria-live="polite">{message}</div>
 </section>
}
