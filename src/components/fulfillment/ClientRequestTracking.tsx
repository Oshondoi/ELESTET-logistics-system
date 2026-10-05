import { useEffect, useState } from 'react'
import { getRequestTracking, listRequestTracking, type TrackingDetail, type TrackedRequest } from '../../services/requestTrackingService'
import { formatBillingDate } from '../../lib/calendarBilling'

const statuses: Record<string,string> = {draft:'Черновик',submitted:'Ожидает исполнителя',accepted:'Принята',rejected:'Отклонена',cancelled:'Отменена',pending:'Ожидает',active:'В работе',in_progress:'В работе',done:'Завершена',completed:'Завершена',issued:'Выдан',agreed:'Согласован'}
const steps: Record<string,string> = {reception:'Приёмка',otk:'ОТК',packaging:'Упаковка',marking:'Маркировка',packing:'Короба',logistics:'Логистика',done:'Завершено'}
const events: Record<string,string> = {submitted:'Заявка подтверждена и отправлена',corrected:'Подтверждена корректировка',accepted:'Заявка принята',rejected:'Заявка отклонена',cancelled:'Заявка отменена',executor_changed:'Изменён исполнитель'}
const date = (value: string | null) => value ? formatBillingDate(value) : '—'
const button = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-40'

export function ClientRequestTracking({accountId}: {accountId:string}) {
  const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[offset,setOffset]=useState(0)
  const [rows,setRows]=useState<TrackedRequest[]>([]),[total,setTotal]=useState(0)
  const [selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<TrackingDetail|null>(null)
  const [synced,setSynced]=useState<string|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const [online,setOnline]=useState(navigator.onLine),[refresh,setRefresh]=useState(0)
  useEffect(()=>{const timer=window.setTimeout(()=>{setQuery(search.trim());setOffset(0)},250);return()=>window.clearTimeout(timer)},[search])
  useEffect(()=>{
    let active=true,inFlight=false
    setRows([]);setDetail(null);setSynced(null);setError('');setLoading(true)
    async function load() {
      if(inFlight || !active) return
      if(!navigator.onLine){setOnline(false);setLoading(false);return}
      inFlight=true
      try {
        const result=selected?await getRequestTracking(accountId,selected):await listRequestTracking(accountId,query,offset)
        if(!active)return
        if('rows' in result){setRows(result.rows);setTotal(result.total)}else setDetail(result)
        setSynced(result.synced_at);setError('');setOnline(true)
      } catch(e) {
        if(active){setError(e instanceof Error?e.message:'Не удалось обновить заявки');setRows([]);setDetail(null)}
      } finally {inFlight=false;if(active)setLoading(false)}
    }
    void load()
    const wake=()=>{setOnline(navigator.onLine);if(document.visibilityState==='visible')void load()}
    const offline=()=>setOnline(false)
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},30_000)
    window.addEventListener('online',wake);window.addEventListener('offline',offline);window.addEventListener('focus',wake);document.addEventListener('visibilitychange',wake)
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('online',wake);window.removeEventListener('offline',offline);window.removeEventListener('focus',wake);document.removeEventListener('visibilitychange',wake)}
  },[accountId,query,offset,selected,refresh])
  return <section className="space-y-4" aria-label="Отслеживание заявок">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-white p-5 ring-1 ring-slate-100">
      <div><h2 className="text-lg font-semibold">{selected?'Отслеживание заявки':'Мои заявки'}</h2>
        <p className="mt-1 text-xs text-slate-500" role="status">{!online?'Нет соединения. Показаны последние полученные данные.':error?'Обновление не удалось':loading?'Загрузка…':`Обновлено: ${date(synced)} (Бишкек)`}</p></div>
      <div className="flex gap-2">{selected&&<button className={button} onClick={()=>setSelected(null)}>К списку заявок</button>}<button className={button} disabled={loading||!online} onClick={()=>setRefresh(n=>n+1)}>Обновить</button></div>
    </div>
    {error&&<p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    {!selected&&<label className="block text-sm text-slate-600">Поиск по R-ID или названию<input aria-label="Поиск заявок" value={search} maxLength={200} onChange={e=>setSearch(e.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-white p-3" placeholder="R-123 или название заявки"/></label>}
    {loading&&<div className="rounded-3xl bg-white p-10 text-center text-slate-500">Загрузка…</div>}
    {!selected&&!loading&&!error&&online&&rows.length===0&&<div className="rounded-3xl bg-white p-10 text-center text-slate-500">{query?'По вашему запросу ничего не найдено':'Заявок пока нет'}</div>}
    {!selected&&rows.map(r=><button key={r.id} onClick={()=>setSelected(r.id)} className="block w-full rounded-2xl bg-white p-5 text-left ring-1 ring-slate-200 hover:ring-blue-300">
      <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">C-{r.applicant_company_short_id} / R-{r.short_id} · {r.title||'Без названия'}</span><span className="text-sm text-blue-700">{statuses[r.status]??r.status}</span></div>
      <p className="mt-2 text-sm text-slate-600">Исполнитель: C-{r.executor_company_short_id} · {r.executor_company_name}</p>
      <p className="mt-1 text-xs text-slate-500">Обновлена: {date(r.updated_at)} (Бишкек)</p>
    </button>)}
    {!selected&&!error&&total>50&&<div className="flex items-center justify-between"><button className={button} disabled={offset===0||loading} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Предыдущие</button><span className="text-sm">{offset+1}–{Math.min(offset+50,total)} из {total}</span><button className={button} disabled={offset+50>=total||loading} onClick={()=>setOffset(n=>n+50)}>Следующие</button></div>}
    {detail&&<>
      <div className="rounded-3xl bg-white p-5"><h3 className="text-xl font-semibold">C-{detail.applicant_company_short_id} / R-{detail.short_id} · {detail.title||'Заявка'}</h3>
        <p className="mt-2">{statuses[detail.status]??detail.status}</p><p className="mt-1 text-sm">Исполнитель: C-{detail.executor_company_short_id} · {detail.executor_company_name}</p>
        <p className="mt-2 text-xs text-slate-500">Создана: {date(detail.created_at)} · Работа начата: {date(detail.work_started_at)} (Бишкек)</p></div>
      {!detail.batches.length&&<p className="rounded-2xl bg-white p-5 text-sm text-slate-500">Партии появятся после подтверждения товаров заявки.</p>}
      {detail.batches.map(b=><section key={b.id} className="space-y-4 rounded-3xl bg-white p-5">
        <div><h3 className="font-semibold">C-{b.owner_short_id} / P-{b.short_id} · {b.name}</h3><p className="mt-1 text-sm text-slate-500">{b.store_name} · {statuses[b.status]??b.status}</p></div>
        {b.stages.map(s=><div key={s.id} className="rounded-2xl border border-slate-200 p-4">
          <h4 className="font-medium">Стадия {s.order_index+1} · C-{s.company_short_id} · {s.company_name}</h4>
          <p className="mt-1 text-sm">{statuses[s.status]??s.status} · Этап: {steps[s.step]??s.step}</p>
          <p className="mt-1 text-xs text-slate-500">Начало: {date(s.activated_at)} · Завершение: {date(s.completed_at)} (Бишкек)</p>
          <p className="mt-3 text-sm text-slate-600">{s.confirmed_at?`Последний подтверждённый результат: ${date(s.confirmed_at)} (Бишкек)`:'Подтверждённых результатов пока нет'}</p>
          {s.items.length>0&&<div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="p-2">Товар</th><th className="p-2">Заявлено</th><th className="p-2">Принято</th><th className="p-2">Брак</th><th className="p-2">ОТК</th><th className="p-2">Маркировано</th><th className="p-2">В коробах</th></tr></thead><tbody>{s.items.map((i,index)=><tr key={index} className="border-t border-slate-100"><td className="p-2"><p>{i.name||i.barcode}</p><p className="text-xs text-slate-500">{[i.barcode,i.article,i.size,i.color].filter(Boolean).join(' · ')}</p></td>{[i.declared,i.received,i.defect,i.otk,i.marked,i.packed].map((qty,n)=><td key={n} className="p-2">{qty??'—'}</td>)}</tr>)}</tbody></table></div>}
        </div>)}
        <div><h4 className="font-medium">Доступные документы</h4>
          {!detail.documents_allowed?<p className="mt-1 text-sm text-slate-500">Для просмотра документов требуется право просмотра фулфилмента.</p>:!b.documents.length?<p className="mt-1 text-sm text-slate-500">Выданных документов пока нет.</p>:b.documents.map(d=><details key={d.id} className="mt-2 rounded-xl border p-3 text-sm"><summary className="cursor-pointer">{d.kind==='acceptance_act'?'Акт приёмки':'Счёт'} · редакция {d.revision} · {statuses[d.status]??d.status}</summary><p className="mt-2">Выдан: {date(d.issued_at)} (Бишкек)</p>{d.accepted_quantity!==null&&<p>Принято: {d.accepted_quantity} шт.</p>}<p className="mt-1 text-xs text-slate-500">Запись документа. Печатная форма ещё не предусмотрена.</p></details>)}
        </div>
      </section>)}
      <section className="rounded-3xl bg-white p-5"><h3 className="font-semibold">История подтверждений</h3>
        {!detail.history_allowed?<p className="mt-2 text-sm text-slate-500">Нет права просмотра истории заявок.</p>:!detail.history.length?<p className="mt-2 text-sm text-slate-500">Подтверждений ещё нет.</p>:<ol className="mt-3 space-y-3">{detail.history.map(h=><li key={h.id} className="border-l-2 border-blue-100 pl-3 text-sm"><p>{h.kind==='step'?`Подтверждён этап: ${steps[h.event]??h.event}`:events[h.event]??h.event} · версия {h.version}</p>{h.batch_short_id!==null&&<p className="text-xs text-slate-500">C-{h.owner_short_id} / P-{h.batch_short_id} · компания стадии C-{h.company_short_id}</p>}<p className="text-xs text-slate-500">{date(h.at)} (Бишкек)</p></li>)}</ol>}
      </section>
    </>}
  </section>
}
