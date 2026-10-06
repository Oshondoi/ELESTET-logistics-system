import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Staff { user_id: string; short_id: number; full_name: string; active: boolean; eligible: boolean }
interface Assignment { user_id: string; short_id: number; full_name: string }
interface Project { id: string; company_name: string; company_short_id: number; status: 'paid' | 'active' | 'completed'; version: number; paid_som: number; started_at: string | null; assignments: Assignment[] }
interface Audit { id: number; actor_id: string | null; subject_id: string | null; event: string; created_at: string; details: Record<string, unknown> }
const rpc = async (name: string, args = {}) => {
  if (!supabase) throw new Error('Нет соединения')
  const { data, error } = await (supabase as any).rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}
const labels = { paid: 'Оплачено · ожидает запуска', active: 'Внедрение идёт', completed: 'Завершено' }
const events: Record<string, string> = { staff_changed: 'Состав команды изменён', payment_registered: 'Оплата подтверждена сервером', assigned: 'Специалист назначен', revoked: 'Специалист отключён', started: 'Внедрение запущено', completed: 'Внедрение завершено', work: 'Действие в компании' }
export function ImplementationAccessAdmin() {
  const [staff, setStaff] = useState<Staff[]>([]), [projects, setProjects] = useState<Project[]>([])
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState('')
  const [shortId, setShortId] = useState(''), [selected, setSelected] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<Audit[] | null>(null)
  async function load() {
    const data = await rpc('admin_implementation_overview')
    setStaff(data.staff); setProjects(data.projects); setLoaded(true)
  }
  async function action(fn: () => Promise<unknown>) {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие') }
    finally { setBusy(false) }
  }
  useEffect(() => { void action(load) }, [])
  async function changeStaff(s: Staff, active: boolean, eligible: boolean) {
    await rpc('admin_set_implementation_staff', { p_short_id: s.short_id, p_active: active, p_eligible: eligible }); await load()
  }
  async function assign(p: Project, user: string, value: boolean) {
    await rpc('admin_assign_implementation', { p_project: p.id, p_user: user, p_assign: value, p_version: p.version }); await load()
  }
  async function transition(p: Project, next: string) {
    const message = next === 'start' ? `Запустить согласованное внедрение в C-${p.company_short_id}? U-1 и назначенные специалисты получат доступ.` : `Завершить внедрение в C-${p.company_short_id}? Системный доступ команды, включая U-1, будет отключён.`
    if (!window.confirm(message)) return
    await rpc('admin_transition_implementation', { p_project: p.id, p_action: next, p_version: p.version }); await load()
  }
  const button = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-50'
  return <section className="space-y-4" aria-label="Доступ команды внедрения">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Команда и доступ внедрения</h2><button className={button} disabled={busy} onClick={() => void action(load)}>Обновить доступы</button></div>
    <p className="text-sm text-slate-500">Управляет только U-1. Это системный доступ, не клиентская роль. Оплата не запускает внедрение автоматически. Finik ещё не подключён: кнопки ручного подтверждения оплаты здесь нет.</p>
    <div role="status" className="min-h-6 text-sm text-rose-600">{error}</div>
    {loaded && <>
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <h3 className="font-semibold">Сотрудники ELESTET</h3>
        <p className="text-sm text-slate-500">U-1 получает доступ автоматически при запуске. Остальным нужен статус сотрудника и допуск. Статус не открывает админку.</p>
        <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void action(async () => { await rpc('admin_set_implementation_staff', { p_short_id: Number(shortId.replace(/^u-?/i, '')), p_active: true, p_eligible: true }); setShortId(''); await load() }) }}>
          <input aria-label="User ID сотрудника" required pattern="[uU]-?[0-9]+|[0-9]+" placeholder="U-123" className="min-w-0 rounded-xl border px-3 py-2" value={shortId} disabled={busy} onChange={e => setShortId(e.target.value)} />
          <button className={button} disabled={busy}>Добавить с допуском</button>
        </form>
        {!staff.length && <p>Сотрудники пока не добавлены.</p>}
        {staff.map(s => <div key={s.user_id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"><span>U-{s.short_id} · {s.full_name || 'Без имени'} · {s.active ? (s.eligible ? 'Допущен' : 'Без допуска') : 'Отключён'}</span><div className="flex flex-wrap gap-2">
          {s.active && <button disabled={busy} className={button} onClick={() => { if (s.eligible && !window.confirm('Отозвать допуск и все доступы внедрения сотрудника?')) return; void action(() => changeStaff(s, true, !s.eligible)) }}>{s.eligible ? 'Отозвать допуск' : 'Выдать допуск'}</button>}
          <button disabled={busy} className={button} onClick={() => { if (s.active && !window.confirm('Исключить сотрудника и отозвать все его доступы внедрения?')) return; void action(() => changeStaff(s, !s.active, false)) }}>{s.active ? 'Исключить из команды' : 'Вернуть без допуска'}</button>
        </div></div>)}
      </div>
      <h3 className="font-semibold">Оплаченные внедрения</h3>
      {!projects.length && <p className="rounded-2xl bg-slate-50 p-4">Подтверждённых оплат внедрения пока нет. Назначение и запуск появятся после серверного подтверждения оплаты.</p>}
      {projects.map(p => <article key={p.id} className="rounded-2xl border bg-white p-4 space-y-3">
        <h4 className="font-semibold">C-{p.company_short_id} · {p.company_name}</h4><p>{labels[p.status]} · {p.paid_som.toLocaleString('ru-RU')} сом</p>
        {p.status !== 'completed' && <>
          <p className="text-sm text-slate-500">U-1 — автоматически при запуске. Рабочие права владельца без удаления компании, передачи владения и управления оплатами.</p>
          {p.assignments.filter(a => a.short_id !== 1).map(a => <div key={a.user_id} className="flex flex-wrap items-center gap-3"><span>U-{a.short_id} · {a.full_name}</span><button disabled={busy} className={button} onClick={() => { if(window.confirm('Отозвать доступ специалиста к этому внедрению?')) void action(() => assign(p, a.user_id, false)) }}>Снять назначение</button></div>)}
          <div className="flex flex-wrap gap-2"><select aria-label={`Специалист C-${p.company_short_id}`} disabled={busy} className="min-w-0 max-w-full rounded-xl border p-2" value={selected[p.id] || ''} onChange={e => setSelected(old => ({ ...old, [p.id]: e.target.value }))}><option value="">Выберите сотрудника</option>{staff.filter(s => s.active && s.eligible && !p.assignments.some(a => a.user_id === s.user_id)).map(s => <option key={s.user_id} value={s.user_id}>U-{s.short_id} · {s.full_name}</option>)}</select>
            <button disabled={busy || !selected[p.id]} className={button} onClick={() => void action(async () => { await assign(p, selected[p.id], true); setSelected(old => ({ ...old, [p.id]: '' })) })}>Назначить</button>
            <button disabled={busy} className={button} onClick={() => void action(() => transition(p, p.status === 'paid' ? 'start' : 'complete'))}>{p.status === 'paid' ? 'Запустить внедрение' : 'Завершить внедрение'}</button>
          </div>
        </>}
        <button disabled={busy} className={button} onClick={() => void action(async () => setHistory(await rpc('admin_implementation_history', { p_project: p.id })))}>История внедрения</button>
      </article>)}
      <button disabled={busy} className={button} onClick={() => void action(async () => setHistory(await rpc('admin_implementation_history')))}>История команды</button>
      {history && <div className="rounded-2xl border p-4 space-y-2"><h3 className="font-semibold">Последние 100 событий</h3>{history.map(h => <div key={h.id} className="break-words border-t pt-2 text-sm"><p>{new Date(h.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' })} · {events[h.event] || h.event}</p><p className="text-slate-500">Исполнитель: {h.actor_id || 'Сервер'}</p>{h.event === 'work' && <p>{String(h.details.table)} · {String(h.details.operation)}</p>}</div>)}</div>}
    </>}
  </section>
}
