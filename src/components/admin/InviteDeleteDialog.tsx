import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Item { id: string; number?: string | null; name?: string | null; status?: string | null }
interface Group { table: string; label: string; count: number; items: Item[]; message?: string }
interface Preview {
  invite_id: string; fingerprint?: string; already_deleted: boolean; can_delete: boolean
  groups: Group[]; effects: Group[]; blockers: Group[]; preserved?: string[]; notice?: string
}

function Inventory({ groups }: { groups: Group[] }) {
  return <div className="space-y-2">{groups.map((group, index) => <details key={`${group.table}-${index}`} className="rounded-xl border border-slate-200 p-3">
    <summary className="cursor-pointer font-medium">{group.label}: {group.count}</summary>
    {group.message && <p className="mt-2 text-sm">{group.message}</p>}
    <ul className="mt-2 max-h-48 space-y-2 overflow-auto text-sm">{group.items.map(item => <li key={item.id} className="break-words">
      {item.number && <strong>№{item.number} · </strong>}{item.name}{item.status && <span> · {item.status}</span>}
      <span className="block break-all text-xs text-slate-500">ID: {item.id}</span>
    </li>)}</ul>
  </details>)}</div>
}

export function InviteDeleteDialog({ inviteId, onClose, onDeleted }: { inviteId: string; onClose: () => void; onDeleted: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const alive = useRef(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  async function refresh() {
    if (lock.current) return
    lock.current = true; setBusy(true); setConfirmed(false); setPreview(null); setMessage('')
    try {
      if (!supabase) throw new Error()
      const { data, error } = await supabase.rpc('admin_preview_invite_deletion' as never, { p_invite_id: inviteId } as never)
      if (error || !data) throw new Error()
      if (alive.current) setPreview(data as unknown as Preview)
    } catch { if (alive.current) setMessage('Не удалось проверить состав данных. Удаление недоступно. Попробуйте обновить.') }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => {
    alive.current = true
    dialog.current?.showModal()
    void refresh()
    return () => { alive.current = false }
    // Parent keys the dialog by invite ID; each opening always obtains a new snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function remove() {
    if (lock.current || !confirmed || !preview?.can_delete || !preview.fingerprint || !supabase) return
    lock.current = true; setBusy(true); setMessage('')
    try {
      const { data, error } = await supabase.rpc('admin_confirm_invite_deletion' as never, { p_invite_id: inviteId, p_fingerprint: preview.fingerprint } as never)
      if (error || !data) throw new Error()
      const result = data as unknown as { ok: boolean; message?: string; preview?: Preview }
      if (!alive.current) return
      if (result.ok) { onDeleted(); return }
      setPreview(result.preview ?? null); setConfirmed(false)
      setMessage(result.message ?? 'Удаление запрещено. Обновите состав данных.')
    } catch {
      if (alive.current) {
        setPreview(null); setConfirmed(false)
        setMessage('Не удалось получить результат. Обновите состав: операция могла завершиться. Повтор без проверки запрещён.')
      }
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }

  return <dialog ref={dialog} aria-labelledby="invite-delete-title" onCancel={event => { event.preventDefault(); if (!lock.current) onClose() }} className="m-auto h-[85vh] w-[min(94vw,760px)] max-w-none overflow-hidden rounded-3xl p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40">
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-5 py-4"><h2 id="invite-delete-title" className="text-lg font-semibold">Удаление данных ссылки</h2><button autoFocus type="button" aria-label="Закрыть" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-2 disabled:opacity-40">✕</button></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
        {busy && <p role="status">Проверяем данные…</p>}
        {message && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{message}</p>}
        {preview?.already_deleted ? <p role="status">Данные этой ссылки уже удалены. Повторное удаление не требуется.</p> : preview && <>
          <section><h3 className="mb-2 font-semibold">Будет удалено</h3><p className="mb-3 text-sm">Рабочая ссылка и перечисленные ниже данные. Раскройте строку, чтобы увидеть конкретные записи.</p><Inventory groups={preview.groups} />{!preview.groups.length && <p className="text-sm">Заявок и черновиков нет. Будет отключена только ссылка.</p>}</section>
          <section className="rounded-xl bg-emerald-50 p-3"><h3 className="font-semibold">Останется</h3><ul className="mt-2 list-inside list-disc text-sm">{preview.preserved?.map(text => <li key={text}>{text}</li>)}</ul></section>
          {!!preview.effects.length && <section><h3 className="mb-2 font-semibold">Сохранится со снятием связей</h3><Inventory groups={preview.effects} /></section>}
          {!!preview.blockers.length && <section className="rounded-xl bg-rose-50 p-3"><h3 className="mb-2 font-semibold text-rose-700">Почему нельзя удалить</h3><Inventory groups={preview.blockers} /></section>}
          <p className="text-sm text-slate-600">{preview.notice}</p>
        </>}
      </div>
      <footer className="space-y-3 border-t p-5">
        {preview?.can_delete && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />Я проверил состав и понимаю, что удалённые данные нельзя восстановить этой кнопкой.</label>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border px-4 py-2">Отмена</button><button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-xl border px-4 py-2">Обновить состав</button><button type="button" disabled={busy || !confirmed || !preview?.can_delete} onClick={() => void remove()} className="rounded-xl bg-rose-600 px-4 py-2 text-white disabled:opacity-40">Удалить перечисленные данные</button></div>
      </footer>
    </div>
  </dialog>
}
