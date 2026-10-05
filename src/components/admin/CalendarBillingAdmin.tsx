import {useEffect,useRef,useState} from 'react'
import {supabase} from '../../lib/supabase'
type Company={id:string;short_id:number;name:string;balance_som:number}
type Order={id:string;account_id:string;short_id:number;name:string;status:string;kind:string;due_som:number;wallet_som:number;external_som:number;payment_reference:string|null}
type Snapshot={companies:Company[];orders:Order[];config:{checkout_enabled:boolean;provider_enabled:boolean;timezone:string|null}}
async function rpc<T>(name:string,args:Record<string,unknown>={}):Promise<T>{if(!supabase)throw new Error('Сервис недоступен');const{data,error}=await supabase.rpc(name as never,args as never);if(error)throw new Error(error.message);return data as T}
export function CalendarBillingAdmin(){
 const[data,setData]=useState<Snapshot|null>(null),[search,setSearch]=useState(''),[offset,setOffset]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const[account,setAccount]=useState(''),[delta,setDelta]=useState(''),[reason,setReason]=useState(''),[order,setOrder]=useState(''),[note,setNote]=useState('')
 const[detail,setDetail]=useState<{entries:{operation_id:string;delta_som:number;balance_after_som:number;reason:string;created_at:string}[];audit:{id:string;action:string;note:string;created_at:string}[]}|null>(null)
 const adjustment=useRef<string|null>(null),noteId=useRef<string|null>(null),lock=useRef(false)
 const [appliedSearch,setAppliedSearch]=useState('')
 async function reload(){setData(await rpc<Snapshot>('admin_calendar_billing',{p_search:appliedSearch,p_offset:offset}))}
 useEffect(()=>{let current=true;rpc<Snapshot>('admin_calendar_billing',{p_search:appliedSearch,p_offset:offset}).then(d=>{if(current)setData(d)}).catch(e=>{if(current)setError(e.message)});return()=>{current=false}},[offset,appliedSearch])
 useEffect(()=>{adjustment.current=null;setDetail(null)},[account,delta,reason])
 useEffect(()=>{noteId.current=null},[order,note])
 async function run(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'Ошибка')}finally{lock.current=false;setBusy(false)}}
 return <section className="space-y-4 rounded-3xl border bg-white p-5">
  <h2 className="text-xl font-semibold">Календарные заказы и баланс</h2>
  <p className="text-sm text-slate-500">Приём оплаты: {data?.config.checkout_enabled?'включён':'выключен'} · Провайдер: {data?.config.provider_enabled?'подключён':'ожидает подключения'} · Календарь: {data?.config.timezone??'не настроен'}</p>
  <div className="flex gap-2"><input aria-label="Поиск компании или заказа" className="rounded-xl border p-2" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Название, C-ID или ID заказа"/><button disabled={busy} onClick={()=>{if(appliedSearch===search&&offset===0)void run(reload);else{setAppliedSearch(search);setOffset(0)}}}>Найти / обновить</button></div>
  <div className="min-h-6 text-sm text-red-600" role="alert">{error}</div>
  <div className="grid gap-4 lg:grid-cols-2">
   <form className="rounded-xl border p-4" onSubmit={e=>{e.preventDefault();void run(async()=>{
    const amount=Number(delta);if(!account||!Number.isSafeInteger(amount)||!amount||reason.trim().length<5)throw new Error('Выберите компанию, целую ненулевую сумму и причину')
    if(!adjustment.current&&!window.confirm(`Изменить баланс выбранной компании на ${amount} сом?`))return
    adjustment.current??=crypto.randomUUID()
    await rpc('admin_adjust_calendar_balance',{p_id:adjustment.current,p_account:account,p_delta:amount,p_note:reason})
    await reload();adjustment.current=null;setDelta('');setReason('')
   })}}>
    <h3 className="font-semibold">Ручная корректировка</h3>
    <select aria-label="Компания для баланса" value={account} disabled={busy} onChange={e=>setAccount(e.target.value)} className="mt-2 w-full rounded-xl border p-2"><option value="">Выберите компанию</option>{data?.companies.map(a=><option key={a.id} value={a.id}>C-{a.short_id} · {a.name} · {a.balance_som} сом</option>)}</select>
    <input aria-label="Сумма корректировки" value={delta} disabled={busy} onChange={e=>setDelta(e.target.value)} className="mt-2 w-full rounded-xl border p-2" placeholder="+100 или -100"/>
    <textarea aria-label="Причина корректировки" value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} maxLength={2000} className="mt-2 w-full rounded-xl border p-2" placeholder="Обязательная причина"/>
    <button disabled={busy} className="mt-2 rounded-xl border px-3 py-2">Сохранить корректировку</button>
    <button type="button" disabled={busy||!account} onClick={()=>void run(async()=>setDetail(await rpc('admin_calendar_billing_detail',{p_account:account})))} className="ml-2">Журнал компании</button>
   </form>
   <form className="rounded-xl border p-4" onSubmit={e=>{e.preventDefault();void run(async()=>{
    noteId.current??=crypto.randomUUID();await rpc('admin_note_calendar_payment',{p_id:noteId.current,p_order:order,p_note:note});noteId.current=null;setNote('');await reload()
   })}}>
    <h3 className="font-semibold">Заметка о сверке платежа</h3><p className="mt-1 text-sm text-slate-500">Не подтверждает оплату, не меняет тариф и баланс.</p>
    <input aria-label="ID заказа для сверки" value={order} disabled={busy} onChange={e=>setOrder(e.target.value)} className="mt-2 w-full rounded-xl border p-2"/>
    <textarea aria-label="Результат сверки" value={note} disabled={busy} onChange={e=>setNote(e.target.value)} maxLength={2000} className="mt-2 w-full rounded-xl border p-2"/>
    <button disabled={busy||!order||note.trim().length<5} className="mt-2 rounded-xl border px-3 py-2">Сохранить заметку</button>
   </form>
  </div>
  <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Компания / заказ</th><th>Статус</th><th>С баланса</th><th>Доплата</th><th>Платёж</th></tr></thead><tbody>{data?.orders.map(o=><tr key={o.id} className="border-t"><td className="p-2">C-{o.short_id} · {o.name}<button className="block text-xs text-blue-600" onClick={()=>setOrder(o.id)}>{o.id}</button></td><td>{o.status}</td><td>{o.wallet_som}</td><td>{o.external_som}</td><td>{o.payment_reference??'—'}</td></tr>)}</tbody></table></div>
  <div className="flex gap-3"><button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Назад</button><span>Страница {offset/50+1}</span><button disabled={!data||(data.orders.length<50&&data.companies.length<50)} onClick={()=>setOffset(offset+50)}>Далее</button></div>
  {detail&&<div className="rounded-xl bg-slate-50 p-4"><h3 className="font-semibold">Журнал: последние 100 записей</h3>{detail.entries.map(e=><p key={e.operation_id} className="mt-2 text-sm">{e.created_at} · {e.delta_som>0?'+':''}{e.delta_som} сом · остаток {e.balance_after_som} · {e.reason}</p>)}{detail.audit.map(a=><p key={a.id} className="mt-2 text-sm">{a.created_at} · {a.note}</p>)}</div>}
 </section>
}
