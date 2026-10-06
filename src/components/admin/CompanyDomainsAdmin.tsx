import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const states: Record<string, string> = { not_connected: 'Не подключён', awaiting_dns: 'Ожидает DNS', reported_connected: 'Подключён — отметка администратора', disabled: 'Отключён', error: 'Ошибка' }
interface Domain { id: string; account_id: string; hostname: string; source: string; registration_expires_on: string | null; registrar: string; site_state: string; mail_state: string; notes: string; version: number; company_name?: string; company_short_id?: number }
interface Company { id: string; name: string; short_id: number }
interface Audit { id: number; actor_id: string; created_at: string; previous: Domain | null; next: Domain }
const empty = (): Domain => ({ id: '', account_id: '', hostname: '', source: 'existing', registration_expires_on: null, registrar: '', site_state: 'not_connected', mail_state: 'not_connected', notes: '', version: 0 })
const rpc = async (name: string, args = {}) => {
  if (!supabase) throw new Error('Нет соединения')
  const { data, error } = await (supabase as any).rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}
export function CompanyDomainsAdmin() {
  const [domains, setDomains] = useState<Domain[]>([]), [companies, setCompanies] = useState<Company[]>([])
  const [form, setForm] = useState<Domain | null>(null), [history, setHistory] = useState<Audit[] | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState('')
  const [loaded, setLoaded] = useState(false)
  async function load() {
    setBusy(true); setError('')
    try { const data = await rpc('admin_list_company_domains'); setDomains(data.domains); setCompanies(data.companies); setLoaded(true) }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить реестр') }
    finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])
  function field<K extends keyof Domain>(key: K, value: Domain[K]) { setForm(old => old ? { ...old, [key]: value } : old) }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!form || busy) return
    setBusy(true); setError('')
    try {
      await rpc('admin_save_company_domain', { p_id: form.id || null, p_version: form.version, p_account_id: form.account_id, p_hostname: form.hostname, p_source: form.source, p_expires_on: form.registration_expires_on || null, p_registrar: form.registrar, p_site_state: form.site_state, p_mail_state: form.mail_state, p_notes: form.notes })
      setForm(null); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить') }
    finally { setBusy(false) }
  }
  async function showHistory(id: string) {
    setBusy(true); setError(''); setHistory(null)
    try { setHistory(await rpc('admin_company_domain_history', { p_id: id })) }
    catch { setError('Не удалось загрузить историю') }
    finally { setBusy(false) }
  }
  const input = 'mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 disabled:bg-slate-100'
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Домены компаний</h2><div className="flex gap-3"><button disabled={busy} onClick={() => void load()}>Обновить</button><button className="rounded-xl bg-blue-600 px-4 py-2 text-white" disabled={busy || !loaded} onClick={() => { setForm(empty()); setHistory(null); setError('') }}>Добавить домен</button></div></div>
    <p className="rounded-xl bg-amber-50 p-3 text-sm">Только учёт. Сохранение карточки не подключает DNS, HTTPS или отправку почты. Состояния — ручные отметки администратора, не проверка провайдера. Домен принадлежит клиенту; регистрация и продление оплачиваются отдельно.</p>
    <div role="status" className="min-h-6 text-sm text-red-600">{error}</div>
    {form && <form onSubmit={e => void save(e)} className="rounded-2xl border bg-white p-4">
      <h3 className="mb-3 font-semibold">{form.id ? 'Редактирование домена' : 'Новый домен'}</h3>
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <label>Компания<select aria-label="Компания" required className={input} value={form.account_id} disabled={!!form.id} onChange={e => field('account_id', e.target.value)}><option value="">Выберите компанию</option>{companies.map(c => <option key={c.id} value={c.id}>C-{c.short_id} · {c.name}</option>)}</select></label>
        <label>Домен или поддомен<input required maxLength={253} className={input} placeholder="wms.client.kg" value={form.hostname} disabled={!!form.id} onChange={e => field('hostname', e.target.value)} /><span className="text-xs text-slate-500">Без https:// и пути. Кириллица — в Punycode.</span></label>
        <label>Вариант<select className={input} value={form.source} onChange={e => field('source', e.target.value)}><option value="existing">Существующий домен клиента</option><option value="new">Новый домен для клиента</option></select></label>
        <label>Регистрация оплачена до<input type="date" className={input} value={form.registration_expires_on || ''} onChange={e => field('registration_expires_on', e.target.value || null)} /><span className="text-xs text-slate-500">Не срок опции «Свой бренд». Если неизвестен — оставьте пустым.</span></label>
        <label>Регистратор<input maxLength={120} className={input} value={form.registrar} onChange={e => field('registrar', e.target.value)} /></label>
        <label>Сайт<select aria-label="Сайт" className={input} value={form.site_state} onChange={e => field('site_state', e.target.value)}>{Object.entries(states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Почта<select aria-label="Почта" className={input} value={form.mail_state} onChange={e => field('mail_state', e.target.value)}>{Object.entries(states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Примечание<textarea maxLength={2000} className={input} value={form.notes} onChange={e => field('notes', e.target.value)} /><span className="text-xs text-slate-500">Не храните здесь пароли и API-ключи.</span></label>
      </fieldset>
      <div className="mt-4 flex gap-4"><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2 text-white" type="submit">{busy ? 'Сохранение…' : 'Сохранить карточку'}</button><button type="button" disabled={busy} onClick={() => setForm(null)}>Отмена</button></div>
    </form>}
    <input aria-label="Поиск домена или компании" className={input} placeholder="Поиск домена или компании" value={query} onChange={e => setQuery(e.target.value)} />
    {!loaded && busy && <p>Загрузка…</p>}
    {loaded && !domains.length && <p>Домены пока не добавлены.</p>}
    <div className="grid gap-3">{domains.filter(d => `${d.hostname} ${d.company_name} C-${d.company_short_id}`.toLowerCase().includes(query.toLowerCase())).map(d => <article className="rounded-2xl border bg-white p-4" key={d.id}>
      <h3 className="break-all font-semibold">{d.hostname}</h3><p>C-{d.company_short_id} · {d.company_name}</p>
      <p className="mt-2 text-sm">Сайт: {states[d.site_state]} · Почта: {states[d.mail_state]}</p><p className="text-sm">Регистрация до: {d.registration_expires_on || 'Не указано'} · {d.source === 'new' ? 'Новый домен' : 'Существующий домен'}{d.registrar ? ` · ${d.registrar}` : ''}</p>
      {d.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{d.notes}</p>}
      <div className="mt-3 flex gap-4"><button disabled={busy} onClick={() => { setForm({ ...d }); setHistory(null); setError('') }}>Редактировать</button><button disabled={busy} onClick={() => void showHistory(d.id)}>История изменений</button></div>
    </article>)}</div>
    {history && <div className="rounded-2xl border bg-white p-4"><div className="flex justify-between"><h3 className="font-semibold">История — последние 100 изменений</h3><button onClick={() => setHistory(null)}>Закрыть историю</button></div>{history.map(h => <div className="mt-3 border-t pt-2 text-sm" key={h.id}><p>{new Date(h.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' })} · Бишкек · {h.previous ? 'Изменение' : 'Создание'} · {h.next.hostname}</p><p className="break-all text-xs">Администратор: {h.actor_id}</p>{(['source', 'registration_expires_on', 'registrar', 'site_state', 'mail_state', 'notes'] as const).filter(k => !h.previous || h.previous[k] !== h.next[k]).map(k => <p className="whitespace-pre-wrap break-words" key={k}>{{ source: 'Вариант', registration_expires_on: 'Срок регистрации', registrar: 'Регистратор', site_state: 'Сайт', mail_state: 'Почта', notes: 'Примечание' }[k]}: {String(h.previous?.[k] ?? '—')} → {String(h.next[k] ?? '—')}</p>)}</div>)}</div>}
  </section>
}
