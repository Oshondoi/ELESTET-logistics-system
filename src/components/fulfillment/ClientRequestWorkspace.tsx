import {useState, type ComponentProps} from 'react'
import {ServiceRequestsPanel} from './ServiceRequestsPanel'
import {ClientRequestTracking} from './ClientRequestTracking'

export function ClientRequestWorkspace(props: ComponentProps<typeof ServiceRequestsPanel>) {
  const [tab,setTab]=useState<'tracking'|'manage'>('tracking')
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2" aria-label="Разделы клиентского кабинета">
      <button className={`rounded-xl px-4 py-2 text-sm ${tab==='tracking'?'bg-blue-600 text-white':'bg-white'}`} onClick={()=>setTab('tracking')}>Мои заявки</button>
      <button className={`rounded-xl px-4 py-2 text-sm ${tab==='manage'?'bg-blue-600 text-white':'bg-white'}`} onClick={()=>setTab('manage')}>Создание и управление</button>
      {props.onMyDrafts&&<button className="rounded-xl bg-white px-4 py-2 text-sm" onClick={props.onMyDrafts}>Сохранённые черновики</button>}
    </div>
    {tab==='tracking'?<ClientRequestTracking key={props.accountId} accountId={props.accountId}/>:<ServiceRequestsPanel {...props}/>}
  </div>
}
