import {useEffect,useState} from 'react'
import {supabase} from '../../lib/supabase'
export function MailPreferences(){
 const[value,setValue]=useState<{notifications:boolean;campaigns:boolean}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 useEffect(()=>{let active=true;supabase?.rpc('get_mail_preferences' as never).then(({data,error})=>{if(active){if(error)setMessage('Не удалось загрузить настройки писем');else setValue(data as unknown as {notifications:boolean;campaigns:boolean})}});return()=>{active=false}},[])
 return <section className="space-y-3"><h3 className="text-sm font-medium">Письма на почту</h3>
  <p className="text-xs text-slate-500">Письма с кодами и уведомления безопасности приходят независимо от этих настроек.</p>
  {value&&<>
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={value.notifications} disabled={busy} onChange={e=>setValue({...value,notifications:e.target.checked})}/>Уведомления о событиях в кабинете</label>
   <label className="flex gap-2 text-sm"><input type="checkbox" checked={value.campaigns} disabled={busy} onChange={e=>setValue({...value,campaigns:e.target.checked})}/>Новости и рассылки сервиса</label>
   <button type="button" disabled={busy} className="rounded-xl border px-3 py-2 text-sm" onClick={async()=>{if(!supabase)return;setBusy(true);setMessage('');try{const r=await supabase.rpc('set_mail_preferences' as never,{p_notifications:value.notifications,p_campaigns:value.campaigns} as never);if(r.error)throw r.error;setMessage('Настройки писем сохранены')}catch{setMessage('Не удалось сохранить настройки')}finally{setBusy(false)}}}>Сохранить настройки писем</button>
  </>}
  <p role="status" className="h-10 overflow-auto text-sm">{message}</p>
 </section>
}
