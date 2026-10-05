import {useEffect,useState} from 'react'
import {supabase} from '../../lib/supabase'
import {billingCalendarDay,formatBillingDate} from '../../lib/calendarBilling'
type Quote={available:boolean;reason?:string;due_som?:number;credit_som?:number;balance_som?:number;wallet_som?:number;external_som?:number;starts_at?:string;ends_at?:string}
type Order={id:string;target_plan:string;status:string;wallet_som:number;external_som:number;due_som:number;credit_som:number}
type State={server_now?:string;balance_som:number;cycle:{changes:number;original_paid_at:string}|null;orders:Order[]}
async function rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{
 if(!supabase)throw new Error('Сервис недоступен')
 const{data,error}=await supabase.rpc(name as never,args as never)
 if(error)throw new Error(error.message)
 return data as T
}
export function CalendarCheckout({accountId,onRefresh}:{accountId:string;onRefresh:()=>void}){
 const[state,setState]=useState<State|null>(null),[plan,setPlan]=useState('seller'),[kind,setKind]=useState('main')
 const[tomorrow,setTomorrow]=useState(false),[useBalance,setUseBalance]=useState(false)
 const[quote,setQuote]=useState<Quote|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const[clock,setClock]=useState<{instant:number;received:number}|null>(null),[tick,setTick]=useState(0)
 useEffect(()=>{if(state?.server_now)setClock({instant:Date.parse(state.server_now),received:performance.now()})},[state])
 useEffect(()=>{const id=window.setInterval(()=>setTick(n=>n+1),1000);return()=>window.clearInterval(id)},[])
 const calendarNow=clock?clock.instant+performance.now()-clock.received:null
 const canStartTomorrow=calendarNow!==null&&billingCalendarDay(calendarNow)>15
 useEffect(()=>{if(!canStartTomorrow)setTomorrow(false)},[canStartTomorrow,tick])
 const reload=async()=>setState(await rpc<State>('get_company_checkout_state',{p_account:accountId}))
 useEffect(()=>{
  let current=true,inFlight=false
  setState(null);setClock(null);setQuote(null);setUseBalance(false);setTomorrow(false);setError('')
  const sync=async()=>{if(inFlight)return;inFlight=true;try{const s=await rpc<State>('get_company_checkout_state',{p_account:accountId});if(current)setState(s)}catch(e){if(current)setError(e instanceof Error?e.message:'Не удалось обновить данные оплаты')}finally{inFlight=false}}
  const wake=()=>{if(document.visibilityState==='visible')void sync()}
  void sync();const timer=window.setInterval(wake,60_000)
  window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake)
  return()=>{current=false;window.clearInterval(timer);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake)}
 },[accountId])
 useEffect(()=>{setQuote(null)},[plan,kind,tomorrow,useBalance,canStartTomorrow])
 async function run(task:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await task()}catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие')}finally{setBusy(false)}}
 const args={p_account:accountId,p_plan:kind.startsWith('brand')?'brand':plan,p_kind:kind,p_tomorrow:['main','brand'].includes(kind)&&canStartTomorrow?tomorrow:false,p_use_balance:useBalance}
 async function create(){
  // Reconfirm the server quotation before reserving any wallet funds.
  const fresh=await rpc<Quote>('quote_company_checkout',args)
  if(JSON.stringify(fresh)!==JSON.stringify(quote)){setQuote(fresh);throw new Error('Расчёт обновился. Проверьте сумму и подтвердите снова.')}
  await rpc('create_company_checkout',{...args,p_order:crypto.randomUUID(),p_expected_quote:fresh})
  setQuote(null);await reload()
 }
 return <section className="rounded-3xl border bg-white p-5" aria-label="Календарная оплата">
  <h2 className="text-lg font-semibold">Оплата и смена тарифа</h2>
  <p className="mt-2 text-sm text-slate-500">Расчёт до первого числа. Внешняя оплата появится после подключения платёжного сервиса.</p>
  {state&&<p className="mt-3">Баланс компании: {state.balance_som.toLocaleString('ru-RU')} сом</p>}
  <p className="mt-1 text-xs text-slate-500">Все даты оплаты — по времени Бишкека (UTC+6).</p>
  {state?.cycle&&<p className="mt-2 text-sm">Использовано смен: {state.cycle.changes} из 3. Окно смены заканчивается {formatBillingDate(Date.parse(state.cycle.original_paid_at)+48*3600000)} (Бишкек).</p>}
  <div className="mt-4 grid gap-3 sm:grid-cols-2">
   <label>Действие<select aria-label="Действие оплаты" disabled={busy} className="mt-1 w-full rounded-xl border p-3" value={kind} onChange={e=>{setKind(e.target.value);setTomorrow(false)}}>
    <option value="main">Подключить основной тариф</option><option value="renew">Продлить основной тариф на месяц</option><option value="change">Сменить основной тариф</option><option value="brand">Подключить «Свой бренд»</option><option value="brand_renew">Продлить «Свой бренд» на месяц</option>
   </select></label>
   {!kind.startsWith('brand')&&<label>Тариф<select aria-label="Тариф оплаты" disabled={busy} className="mt-1 w-full rounded-xl border p-3" value={plan} onChange={e=>setPlan(e.target.value)}><option value="seller">Селлер</option><option value="operational">Операционный</option></select></label>}
  </div>
  {['main','brand'].includes(kind)&&canStartTomorrow&&<label className="mt-3 block text-sm"><input type="checkbox" checked={tomorrow} disabled={busy} onChange={e=>setTomorrow(e.target.checked)}/> Начать завтра (по времени Бишкека)</label>}
  {(state?.balance_som??0)>0&&<label className="mt-3 block text-sm"><input type="checkbox" checked={useBalance} disabled={busy} onChange={e=>setUseBalance(e.target.checked)}/> Использовать баланс для полной или частичной оплаты</label>}
  <button disabled={busy||!state} onClick={()=>void run(async()=>setQuote(await rpc<Quote>('quote_company_checkout',args)))} className="mt-4 rounded-xl border px-4 py-2">Рассчитать на сервере</button>
  {quote&&<div className="mt-4 rounded-xl bg-slate-50 p-4">
   {quote.due_som!==undefined&&<>
    <p>К оплате: {quote.due_som} сом</p><p>С баланса: {quote.wallet_som} сом · Доплата: {quote.external_som} сом</p>
    {!!quote.credit_som&&<p>Зачислим на баланс: {quote.credit_som} сом</p>}
    <p className="mt-2 text-sm">Период: {quote.starts_at?formatBillingDate(quote.starts_at):'—'} — {quote.ends_at?formatBillingDate(quote.ends_at):'—'} (конец не включён; Бишкек)</p>
   </>}
   {quote.reason&&<p className="mt-2 text-sm">{quote.reason}</p>}
   {quote.available&&<button disabled={busy} onClick={()=>void run(create)} className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-white">Создать заказ{quote.wallet_som?' и зарезервировать баланс':''}</button>}
  </div>}
  <div className="mt-3 min-h-12 text-sm text-red-600" role="alert">{error}</div>
  {state?.orders.map(o=><div key={o.id} className="mt-2 rounded-xl border p-3 text-sm">
   <p>{o.target_plan==='brand'?'Свой бренд':o.target_plan==='seller'?'Селлер':'Операционный'} · {{pending:'Ожидает подтверждения',paid:'Оплачен',cancelled:'Отменён',expired:'Истёк'}[o.status]??o.status}</p>
   <p>С баланса: {o.wallet_som} сом · Доплата: {o.external_som} сом</p>
   {o.status==='pending'&&<div className="mt-2 flex gap-3">
    {o.external_som===0&&<button disabled={busy} onClick={()=>void run(async()=>{await rpc('settle_company_checkout',{p_order:o.id,p_reference:'wallet:'+o.id,p_amount:0,p_currency:'KGS'});await reload();onRefresh()})}>Подтвердить оплату / смену</button>}
    <button disabled={busy} onClick={()=>void run(async()=>{await rpc('cancel_company_checkout',{p_order:o.id});await reload()})}>Отменить заказ</button>
   </div>}
  </div>)}
 </section>
}
