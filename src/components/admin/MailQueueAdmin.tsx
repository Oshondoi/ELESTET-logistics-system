import {useEffect,useState} from 'react'
import {supabase} from '../../lib/supabase'
type Snapshot={counts:Record<string,number>;jobs:{id:string;short_id:number;name:string;purpose:string;status:string;attempts:number;created_at:string}[]}
const labels:Record<string,string>={queued:'Ожидает',sending:'Отправляется',sent:'Принято почтовым сервисом',blocked:'Ожидает настройки бренда',skipped:'Отменено по правам или настройкам',failed:'Нужна проверка'}
export function MailQueueAdmin(){
 const[data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0)
 useEffect(()=>{let active=true;setError('');supabase?.rpc('admin_mail_queue' as never).then(({data,error})=>{if(active){if(error)setError('Не удалось загрузить очередь');else setData(data as unknown as Snapshot)}});return()=>{active=false}},[version])
 return <section className="space-y-4 rounded-3xl border bg-white p-5"><h2 className="text-xl font-semibold">Почтовая очередь</h2><p className="text-sm text-slate-500">Последние 100 фоновых писем. Коды входа отправляются отдельно. Принятие сервисом не гарантирует попадание во входящие.</p>
  <button className="rounded-xl border px-3 py-2" onClick={()=>setVersion(v=>v+1)}>Обновить очередь</button><p role="alert" className="min-h-6 text-red-600">{error}</p>
  <div className="flex flex-wrap gap-4">{Object.entries(data?.counts??{}).map(([status,count])=><span key={status}>{labels[status]??status}: {count}</span>)}</div>
  <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Компания</th><th>Назначение</th><th>Состояние</th><th>Попытки</th><th>Создано</th></tr></thead><tbody>{data?.jobs.map(j=><tr key={j.id} className="border-t"><td className="p-2">C-{j.short_id} · {j.name}</td><td>{j.purpose==='campaign'?'Рассылка':'Уведомление'}</td><td>{labels[j.status]??j.status}</td><td>{j.attempts}</td><td>{new Date(j.created_at).toLocaleString('ru-RU')}</td></tr>)}</tbody></table></div>
 </section>
}
