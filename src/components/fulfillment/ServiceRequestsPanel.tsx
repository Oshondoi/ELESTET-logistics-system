import { useEffect, useMemo, useState } from 'react'
import type { ExecutorAccountSearchResult, ServiceRequest, ServiceRequestItemDraft, Store } from '../../types'
import {
  acceptServiceRequest,
  claimServiceRequestInvite,
  copyServiceRequest,
  createServiceRequestDraft,
  createServiceRequestInvite,
  fetchServiceRequests,
  rejectServiceRequest,
  saveServiceRequestDraft,
  searchExecutorAccounts,
  submitServiceRequest,
} from '../../services/requestService'
import { createStoreInSupabase } from '../../services/storeService'

interface Props {
  accountId: string
  accountShortId: number | null
  stores: Store[]
  userEmail: string
  userName: string
  canManage: boolean
  onStoreCreated?: (store: Store) => void
  onBatchesChanged?: () => void
}

type StoreDraft = {
  storeId: string
  deliveryMode: 'pickup' | 'self_delivery'
  intakeMode: 'bulk' | 'catalog' | 'barcodes' | 'boxes'
  itemsText: string
}

const labels: Record<ServiceRequest['status'], string> = {
  draft: 'Черновик', submitted: 'Ожидает исполнителя', accepted: 'Принята', rejected: 'Отклонена', cancelled: 'Отменена',
}
const tones: Record<ServiceRequest['status'], string> = {
  draft: 'bg-slate-100 text-slate-600', submitted: 'bg-amber-50 text-amber-700', accepted: 'bg-emerald-50 text-emerald-700', rejected: 'bg-rose-50 text-rose-700', cancelled: 'bg-slate-100 text-slate-500',
}

const linesToItems = (value: string): ServiceRequestItemDraft[] => value.split('\n').map((line, position) => {
  const [barcode = '', name = '', qty = '0', article = ''] = line.split(';').map((part) => part.trim())
  return { barcode, name, qty: Math.max(0, Number.parseInt(qty, 10) || 0), article, position }
}).filter((item) => item.barcode || item.name || item.qty > 0)

const itemsToLines = (items: ServiceRequestItemDraft[] | undefined) => (items ?? [])
  .map((item) => [item.barcode, item.name ?? '', item.qty, item.article ?? ''].join('; ')).join('\n')

export const ServiceRequestsPanel = ({ accountId, accountShortId, stores, userEmail, userName, canManage, onStoreCreated, onBatchesChanged }: Props) => {
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ServiceRequest | null>(null)
  const [title, setTitle] = useState('')
  const [name, setName] = useState(userName)
  const [email, setEmail] = useState(userEmail)
  const [comment, setComment] = useState('')
  const [executorQuery, setExecutorQuery] = useState('')
  const [executor, setExecutor] = useState<ExecutorAccountSearchResult | null>(null)
  const [executorResults, setExecutorResults] = useState<ExecutorAccountSearchResult[]>([])
  const [storeDrafts, setStoreDrafts] = useState<StoreDraft[]>([])
  const [activeStore, setActiveStore] = useState(0)
  const [saving, setSaving] = useState(false)
  const [newStoreName, setNewStoreName] = useState('')
  const [newStoreMarketplace, setNewStoreMarketplace] = useState('wildberries')
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [viewing, setViewing] = useState<ServiceRequest | null>(null)

  const load = async () => {
    setLoading(true); setError('')
    try { setRequests(await fetchServiceRequests(accountId)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить заявки') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [accountId])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try { setExecutorResults(await searchExecutorAccounts(executorQuery)) } catch { setExecutorResults([]) }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [executorQuery])

  const openEditor = (request: ServiceRequest) => {
    setEditing(request); setTitle(request.title); setName(request.applicant_name || userName); setEmail(request.applicant_email || userEmail)
    setComment(request.comment || ''); setExecutor(request.executor_account_id ? { id: request.executor_account_id, short_id: request.executor_company_short_id ?? 0, name: request.executor_company_name ?? '' } : null); setExecutorQuery(''); setInviteUrl('')
    setStoreDrafts((request.stores ?? []).map((row) => ({
      storeId: row.applicant_store_id, deliveryMode: row.delivery_mode, intakeMode: row.intake_mode,
      itemsText: itemsToLines(row.payload.items),
    })))
    setActiveStore(0)
  }

  useEffect(() => {
    const token = localStorage.getItem('elestet-pending-request-invite')
    if (!token || !accountId) return
    localStorage.removeItem('elestet-pending-request-invite')
    void (async () => {
      try {
        const invitedExecutor = await claimServiceRequestInvite(token)
        const draft = await createServiceRequestDraft(accountId, invitedExecutor.id)
        openEditor(draft)
        setExecutor(invitedExecutor)
        setExecutorQuery(`C-${invitedExecutor.short_id} · ${invitedExecutor.name}`)
      } catch (inviteError) {
        setError(inviteError instanceof Error ? inviteError.message : 'Не удалось открыть приглашение')
      }
    })()
  // Invite is consumed once for the active company.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const createDraft = async () => {
    setError('')
    try { openEditor(await createServiceRequestDraft(accountId)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось создать заявку') }
  }

  const resolvedExecutorId = executor?.id ?? editing?.executor_account_id ?? ''
  const payload = () => ({
    title, executorAccountId: resolvedExecutorId, applicantName: name, applicantEmail: email, comment,
    stores: storeDrafts.map((store, position) => ({
      store_id: store.storeId, position, delivery_mode: store.deliveryMode, intake_mode: store.intakeMode,
      payload: { items: linesToItems(store.itemsText) },
    })),
  })

  const save = async (submit: boolean) => {
    if (!editing) return
    setSaving(true); setError('')
    try {
      await saveServiceRequestDraft(editing.id, payload())
      if (submit) await submitServiceRequest(editing.id)
      setEditing(null); await load(); if (submit) onBatchesChanged?.()
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить заявку') }
    finally { setSaving(false) }
  }

  const act = async (fn: () => Promise<unknown>) => {
    setSaving(true); setError('')
    try { await fn(); await load(); onBatchesChanged?.() }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие') }
    finally { setSaving(false) }
  }

  const copyInviteUrl = async () => {
    if (!inviteUrl) return
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(inviteUrl)
      else {
        const textarea = document.createElement('textarea')
        textarea.value = inviteUrl
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
      }
      setInviteCopied(true)
    } catch {
      setError('Не удалось скопировать ссылку')
      setInviteCopied(false)
    }
  }

  const closeInvite = () => {
    setInviteUrl('')
    setInviteCopied(false)
  }

  const addStore = (storeId: string) => {
    if (!storeId || storeDrafts.some((row) => row.storeId === storeId)) return
    setStoreDrafts((current) => [...current, { storeId, deliveryMode: 'self_delivery', intakeMode: 'bulk', itemsText: '' }])
    setActiveStore(storeDrafts.length)
  }

  const createStore = async () => {
    if (!newStoreName.trim()) return
    setSaving(true)
    try {
      const store = await createStoreInSupabase({ name: newStoreName, marketplace: newStoreMarketplace }, accountId)
      onStoreCreated?.(store); addStore(store.id); setNewStoreName('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось создать магазин') }
    finally { setSaving(false) }
  }

  const availableStores = useMemo(() => stores.filter((store) => !store.deleted_at && !storeDrafts.some((draft) => draft.storeId === store.id)), [stores, storeDrafts])
  const currentStoreDraft = storeDrafts[activeStore]
  const currentStore = currentStoreDraft ? stores.find((store) => store.id === currentStoreDraft.storeId) : null

  if (loading) return <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400">Загрузка заявок…</div>

  return <div className="space-y-4">
    {error && <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
    <div className="flex items-center justify-between rounded-3xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
      <div><p className="font-semibold text-slate-800">Заявки клиентов</p><p className="text-xs text-slate-400">R — заявка, по одной P на каждый магазин</p></div>
      <div className="flex gap-2">
        {canManage && <button type="button" disabled={saving} onClick={() => void act(async () => {
          const invite = await createServiceRequestInvite(accountId)
          const url = `${window.location.origin}/request-invite/${invite.token}`
          setInviteCopied(false)
          setInviteUrl(url)
        })} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50">Ссылка для клиента</button>}
        {canManage && <button type="button" onClick={() => void createDraft()} className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">+ Новая заявка</button>}
      </div>
    </div>
    {inviteUrl && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="service-request-invite-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeInvite() }}>
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="service-request-invite-title" className="text-lg font-semibold text-slate-900">Ссылка для клиента</h2><p className="mt-1 text-sm text-slate-500">Ссылка действует 30 дней. Нажмите на неё, чтобы скопировать.</p></div>
          <button type="button" onClick={closeInvite} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Закрыть окно">×</button>
        </div>
        <button type="button" onClick={() => void copyInviteUrl()} className="mt-5 block w-full break-all rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-left font-mono text-sm text-blue-700 transition hover:border-blue-400 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-300">{inviteUrl}</button>
        <p className={`mt-3 text-sm font-medium ${inviteCopied ? 'text-emerald-600' : 'text-slate-400'}`}>{inviteCopied ? 'Ссылка скопирована' : 'Копирование произойдёт только после клика по ссылке'}</p>
      </div>
    </div>}
    {requests.length === 0 ? <div className="rounded-3xl bg-white py-16 text-center text-sm text-slate-400">Заявок пока нет</div> :
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-100"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-4 py-3">ID</th><th className="px-4 py-3">Заявка</th><th className="px-4 py-3">Магазины / партии</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3">Дата</th><th className="px-4 py-3" /></tr></thead>
      <tbody className="divide-y divide-slate-100">{requests.map((request) => {
        const isApplicant = request.applicant_account_id === accountId
        return <tr key={request.id} className="hover:bg-slate-50/70"><td className="px-4 py-3 font-mono text-xs"><span className="text-violet-500">C-{request.applicant_company_short_id ?? (isApplicant ? accountShortId : '—')}</span><br />R-{request.short_id}</td>
          <td className="px-4 py-3"><p className="font-medium text-slate-800">{request.title || `Заявка R-${request.short_id}`}</p><p className="text-xs text-slate-400">{isApplicant ? 'Исходящая' : `Заказчик: ${request.applicant_name || '—'}`}</p></td>
          <td className="px-4 py-3">{(request.stores ?? []).map((row) => { const store = stores.find((item) => item.id === row.applicant_store_id); return <div key={row.id} className="text-xs text-slate-600">A-{store?.short_id ?? '—'} · {store?.name ?? 'Магазин'} {row.batch_id ? '· P создана' : ''}</div> })}</td>
          <td className="px-4 py-3"><span className={`rounded-xl px-2 py-1 text-xs font-medium ${tones[request.status]}`}>{labels[request.status]}</span>{request.rejection_comment && <p className="mt-1 max-w-52 text-xs text-rose-500">{request.rejection_comment}</p>}</td>
          <td className="px-4 py-3 text-xs text-slate-400">{new Date(request.created_at).toLocaleDateString('ru-RU')}</td>
          <td className="px-4 py-3"><div className="flex justify-end gap-1"><button onClick={() => setViewing(request)} className="rounded-xl border px-2.5 py-1.5 text-xs">Просмотр</button>{isApplicant && ['draft','submitted','accepted'].includes(request.status) && <button onClick={() => openEditor(request)} className="rounded-xl border px-2.5 py-1.5 text-xs">{request.status === 'draft' ? 'Открыть' : 'Корректировка'}</button>}
          {isApplicant && request.status !== 'draft' && <button onClick={() => void act(async () => { openEditor(await copyServiceRequest(request.id)) })} className="rounded-xl border px-2.5 py-1.5 text-xs">Копия</button>}
          {!isApplicant && request.status === 'submitted' && <><button disabled={saving} onClick={() => void act(() => acceptServiceRequest(request.id))} className="rounded-xl bg-emerald-600 px-2.5 py-1.5 text-xs text-white">Принять</button><button disabled={saving} onClick={() => { const reason=window.prompt('Причина отклонения') ?? ''; void act(() => rejectServiceRequest(request.id, reason)) }} className="rounded-xl bg-rose-50 px-2.5 py-1.5 text-xs text-rose-600">Отклонить</button></>}</div></td></tr>
      })}</tbody></table></div>}

    {editing && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4" onMouseDown={() => !saving && setEditing(null)}><div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex justify-between"><div><h2 className="text-lg font-semibold">R-{editing.short_id} · {editing.current_version ? 'Корректировка' : 'Новая заявка'}</h2><p className="text-xs text-slate-400">Черновик сохраняется в БД, в журнал попадёт только подтверждение</p></div><button onClick={() => setEditing(null)} className="h-8 w-8 rounded-xl text-slate-400 hover:bg-slate-100">×</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-500">Название<input value={title} onChange={(e)=>setTitle(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label><label className="text-xs text-slate-500">Исполнитель: C-ID или название<input disabled={editing.current_version>0} value={executor ? `C-${executor.short_id} · ${executor.name}` : executorQuery} onChange={(e)=>{setExecutor(null);setExecutorQuery(e.target.value)}} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" />{!executor && executorResults.length>0 && <div className="relative"><div className="absolute z-10 mt-1 w-full rounded-xl border bg-white p-1 shadow-xl">{executorResults.map((result)=><button key={result.id} onClick={()=>{setExecutor(result);setExecutorResults([])}} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50">C-{result.short_id} · {result.name}</button>)}</div></div>}</label>
      <label className="text-xs text-slate-500">Имя заявителя<input disabled={editing.current_version>0} title={editing.current_version>0?'Меняется отдельным подтверждаемым действием':undefined} value={name} onChange={(e)=>setName(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" /></label><label className="text-xs text-slate-500">Почта<input disabled={editing.current_version>0} title={editing.current_version>0?'Меняется отдельным подтверждаемым действием':undefined} type="email" value={email} onChange={(e)=>setEmail(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm disabled:bg-slate-50" /></label></div>
      <label className="mt-3 block text-xs text-slate-500">Комментарий<textarea value={comment} onChange={(e)=>setComment(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" /></label>
      <div className="mt-4 rounded-2xl border border-slate-200 p-3"><div className="flex flex-wrap items-center gap-2">{storeDrafts.map((draft,index)=>{const store=stores.find((item)=>item.id===draft.storeId);return <button key={draft.storeId} onClick={()=>setActiveStore(index)} className={`rounded-xl px-3 py-2 text-xs ${activeStore===index?'bg-blue-600 text-white':'bg-slate-100 text-slate-600'}`}>A-{store?.short_id ?? '—'} · {store?.name}</button>})}<select value="" onChange={(e)=>addStore(e.target.value)} className="rounded-xl border px-2 py-2 text-xs"><option value="">+ Выбрать магазин</option>{availableStores.map((store)=><option key={store.id} value={store.id}>A-{store.short_id ?? '—'} · {store.name}</option>)}</select></div>
      <div className="mt-3 flex gap-2"><input placeholder="Новый магазин" value={newStoreName} onChange={(e)=>setNewStoreName(e.target.value)} className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" /><select value={newStoreMarketplace} onChange={(e)=>setNewStoreMarketplace(e.target.value)} className="rounded-xl border px-2 text-sm"><option value="wildberries">Wildberries</option><option value="ozon">Ozon</option><option value="other">Другое</option></select><button onClick={()=>void createStore()} className="rounded-xl border px-3 text-sm">Создать</button></div>
      {currentStoreDraft && <div className="mt-4 space-y-3"><div className="flex items-center justify-between"><p className="font-medium">{currentStore?.name}</p><button onClick={()=>{setStoreDrafts((rows)=>rows.filter((_,index)=>index!==activeStore));setActiveStore(0)}} className="text-xs text-rose-500">Убрать вкладку</button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-500">Способ приёмки<select value={currentStoreDraft.intakeMode} onChange={(e)=>setStoreDrafts((rows)=>rows.map((row,index)=>index===activeStore?{...row,intakeMode:e.target.value as StoreDraft['intakeMode']}:row))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"><option value="bulk">Навалом</option><option value="catalog">Каталог</option><option value="barcodes">По баркодам</option><option value="boxes">Готовые короба</option></select></label><label className="text-xs text-slate-500">Передача<select value={currentStoreDraft.deliveryMode} onChange={(e)=>setStoreDrafts((rows)=>rows.map((row,index)=>index===activeStore?{...row,deliveryMode:e.target.value as StoreDraft['deliveryMode']}:row))} className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"><option value="self_delivery">Сами отправляют</option><option value="pickup">Исполнитель забирает</option></select></label></div><label className="block text-xs text-slate-500">Товары: баркод; название; количество; артикул<textarea rows={7} value={currentStoreDraft.itemsText} onChange={(e)=>setStoreDrafts((rows)=>rows.map((row,index)=>index===activeStore?{...row,itemsText:e.target.value}:row))} className="mt-1 w-full rounded-xl border px-3 py-2 font-mono text-xs" placeholder="4601234567890; Футболка; 25; ART-1" /></label></div>}</div>
      <div className="mt-5 flex justify-end gap-2"><button disabled={saving} onClick={()=>void save(false)} className="rounded-2xl border px-4 py-2 text-sm">Сохранить черновик</button><button disabled={saving||!resolvedExecutorId||storeDrafts.length===0} onClick={()=>void save(true)} title={!resolvedExecutorId?'Выберите исполнителя':storeDrafts.length===0?'Добавьте магазин':undefined} className="rounded-2xl bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:bg-slate-300">Подтвердить и отправить</button></div>
    </div></div>}
    {viewing && <div className="fixed inset-0 z-[109] flex items-center justify-center bg-black/45 p-4" onMouseDown={()=>setViewing(null)}><div className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl" onMouseDown={(e)=>e.stopPropagation()}><div className="flex items-start justify-between"><div><p className="font-mono text-xs text-violet-500">C-{viewing.applicant_company_short_id ?? '—'} · R-{viewing.short_id}</p><h2 className="mt-1 text-lg font-semibold">{viewing.title || 'Заявка'}</h2></div><button onClick={()=>setViewing(null)} className="h-8 w-8 rounded-xl text-slate-400 hover:bg-slate-100">×</button></div><div className="mt-4 space-y-2 rounded-2xl bg-slate-50 p-4 text-sm"><p><span className="text-slate-400">Заказчик:</span> {viewing.applicant_name || '—'}</p><p><span className="text-slate-400">Почта:</span> {viewing.applicant_email || '—'}</p><p><span className="text-slate-400">Статус:</span> {labels[viewing.status]}</p><p><span className="text-slate-400">Версия:</span> {viewing.current_version}</p>{viewing.comment&&<p><span className="text-slate-400">Комментарий:</span> {viewing.comment}</p>}</div><div className="mt-3 space-y-2">{(viewing.stores??[]).map((row)=>{const store=stores.find((item)=>item.id===row.applicant_store_id);return <div key={row.id} className="rounded-2xl border px-4 py-3 text-sm"><p className="font-medium">A-{store?.short_id??'—'} · {store?.name??'Магазин'}</p><p className="mt-1 text-xs text-slate-400">{row.intake_mode} · {row.delivery_mode} · {(row.payload.items??[]).length} позиций</p></div>})}</div></div></div>}
  </div>
}
