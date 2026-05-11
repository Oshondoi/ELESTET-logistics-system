import { useEffect, useMemo, useRef, useState } from 'react'
import type { Carrier, FulfillmentWorkTariff, Warehouse } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import { Modal } from '../components/ui/Modal'
import {
  fetchCarrierTariffs,
  upsertCarrierTariff,
  fetchWbUnloadTariffs,
  upsertWbUnloadTariff,
  fetchWorkTariffs,
  addWorkTariff,
  updateWorkTariff,
  deleteWorkTariff,
  fetchAccountCurrencies,
  addAccountCurrency,
  deleteAccountCurrency,
  fetchStageCurrencies,
  upsertStageCurrency,
} from '../services/directoriesService'
import type { CarrierUpdateData } from '../services/directoriesService'

interface DirectoryPanelProps {
  title: string
  items: Array<{ id: string; name: string; is_system?: boolean }>
  onAdd: (name: string) => Promise<unknown>
  onDelete: (id: string) => Promise<void>
  onUpdate: (id: string, name: string) => Promise<void>
  canManage?: boolean
  onTariff?: (id: string, name: string) => void
  onEditModal?: (item: { id: string; name: string }) => void
  canDelete?: boolean
}

const DirectoryPanel = ({ title, items, onAdd, onDelete, onUpdate, canManage = true, onTariff, onEditModal, canDelete = true }: DirectoryPanelProps) => {
  const [inputValue, setInputValue] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = inputValue.trim()
    if (!name) return
    setIsAdding(true)
    setAddError(null)
    try {
      await onAdd(name)
      setInputValue('')
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsAdding(false)
    }
  }

  const startEdit = (item: { id: string; name: string }) => {
    setEditingId(item.id)
    setEditValue(item.name)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }

  const handleSave = async (id: string) => {
    const name = editValue.trim()
    if (!name) return
    setIsSaving(true)
    try {
      await onUpdate(id, name)
      setEditingId(null)
    } finally {
      setIsSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Ошибка удаления')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <Card className="overflow-hidden rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          <span className="text-xs text-slate-400">{items.length}</span>
        </div>

        {canManage && (
        <form onSubmit={(e) => void handleAdd(e)} className="flex gap-2 border-b border-slate-100 px-4 py-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Добавить название..."
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400"
          />
          <Button type="submit" disabled={isAdding || !inputValue.trim()} className="rounded-xl px-4 py-2 text-sm">
            {isAdding ? '…' : '+ Добавить'}
          </Button>
        </form>
        )}
        {addError && <p className="px-4 pb-2 text-xs text-rose-500">{addError}</p>}

        {items.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                {editingId === item.id ? (
                  <>
                    <input
                      autoFocus
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(item.id); if (e.key === 'Escape') cancelEdit() }}
                      className="flex-1 rounded-lg border border-blue-400 px-2 py-1 text-sm text-slate-900 outline-none"
                    />
                    <button
                      type="button"
                      disabled={isSaving || !editValue.trim()}
                      onClick={() => void handleSave(item.id)}
                      className="flex h-7 items-center rounded-lg bg-blue-500 px-2 text-xs font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
                    >
                      {isSaving ? '…' : 'Сохранить'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="flex h-7 items-center rounded-lg px-2 text-xs text-slate-400 transition hover:text-slate-600"
                    >
                      Отмена
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex flex-1 items-center gap-2">
                      <span>{item.name}</span>
                      {item.is_system && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-50 text-violet-400">WB</span>
                      )}
                    </div>
                    {canManage && (
                    <div className="flex items-center">
                      {!item.is_system && (
                        <button
                          type="button"
                          onClick={() => onEditModal ? onEditModal(item) : startEdit(item)}
                          aria-label={`Редактировать ${item.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-blue-50 hover:text-blue-500"
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                          </svg>
                        </button>
                      )}
                      {item.is_system ? (
                        <span className="w-7" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(item)}
                          aria-label={`Удалить ${item.name}`}
                          className={`flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition ${
                            canDelete ? 'hover:bg-rose-50 hover:text-rose-500' : 'cursor-not-allowed opacity-30'
                          }`}
                          disabled={!canDelete}
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <path d="M9 4h6" /><path d="M5 7h14" />
                            <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                            <path d="M10 11v4" /><path d="M14 11v4" />
                          </svg>
                        </button>
                      )}
                      {onTariff && (
                        <button
                          type="button"
                          onClick={() => onTariff(item.id, item.name)}
                          aria-label={`Тарифы ${item.name}`}
                          title="Тарифы"
                          className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-emerald-50 hover:text-emerald-600"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v2m0 8v2m-4-7h2a2 2 0 0 0 0-4H9v4m0 0h3a2 2 0 0 1 0 4H9v-4" />
                          </svg>
                        </button>
                      )}
                    </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center justify-center py-8 text-sm text-slate-400">
            Список пуст
          </div>
        )}
      </Card>

      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title="Удалить запись?"
        description={`«${deleteTarget?.name ?? ''}» будет удалён. Это действие нельзя отменить.`}
        isSubmitting={isDeleting}
        error={deleteError}
        onClose={() => { if (!isDeleting) { setDeleteError(null); setDeleteTarget(null) } }}
        onConfirm={() => void handleConfirmDelete()}
      />
    </>
  )
}

// ── Склады назначения с сортировкой и drag-and-drop ──────────────

const WarehousesPanel = ({
  title, items, onAdd, onDelete, onUpdate, canManage = true, canDelete = true, accountId,
}: DirectoryPanelProps & { accountId: string }) => {
  const SORT_KEY = 'warehouse_sort_mode'
  const ORDER_KEY = `warehouse_order_${accountId}`

  const [sortMode, setSortMode] = useState<'alpha' | 'custom'>(() => {
    const s = localStorage.getItem(SORT_KEY)
    return s === 'custom' ? 'custom' : 'alpha'
  })
  const [customOrder, setCustomOrder] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem(ORDER_KEY)
      return s ? (JSON.parse(s) as string[]) : []
    } catch { return [] }
  })

  const [inputValue, setInputValue] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragIndex = useRef<number | null>(null)

  const displayItems = useMemo(() => {
    if (sortMode === 'alpha') return [...items].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    const orderMap = new Map(customOrder.map((id, i) => [id, i]))
    return [...items].sort((a, b) => (orderMap.get(a.id) ?? 999999) - (orderMap.get(b.id) ?? 999999))
  }, [sortMode, items, customOrder])

  const applySortMode = (mode: 'alpha' | 'custom') => {
    setSortMode(mode)
    localStorage.setItem(SORT_KEY, mode)
    if (mode === 'custom') {
      const order = [...items].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(i => i.id)
      const merged = [
        ...customOrder.filter(id => items.some(x => x.id === id)),
        ...order.filter(id => !customOrder.includes(id)),
      ]
      setCustomOrder(merged)
      localStorage.setItem(ORDER_KEY, JSON.stringify(merged))
    }
  }

  const saveOrder = (newOrder: string[]) => {
    setCustomOrder(newOrder)
    localStorage.setItem(ORDER_KEY, JSON.stringify(newOrder))
  }

  const handleDragStart = (index: number) => { dragIndex.current = index }
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }
  const handleDrop = (dropIndex: number) => {
    const from = dragIndex.current
    if (from === null || from === dropIndex) { setDragOverIndex(null); return }
    const next = [...displayItems]
    const [moved] = next.splice(from, 1)
    next.splice(dropIndex, 0, moved)
    saveOrder(next.map(i => i.id))
    dragIndex.current = null
    setDragOverIndex(null)
  }
  const handleDragEnd = () => { dragIndex.current = null; setDragOverIndex(null) }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = inputValue.trim()
    if (!name) return
    setIsAdding(true); setAddError(null)
    try {
      await onAdd(name)
      setInputValue('')
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Ошибка')
    } finally { setIsAdding(false) }
  }

  const startEdit = (item: { id: string; name: string }) => { setEditingId(item.id); setEditValue(item.name) }
  const cancelEdit = () => { setEditingId(null); setEditValue('') }
  const handleSave = async (id: string) => {
    const name = editValue.trim()
    if (!name) return
    setIsSaving(true)
    try { await onUpdate(id, name); setEditingId(null) } finally { setIsSaving(false) }
  }
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true); setDeleteError(null)
    try { await onDelete(deleteTarget.id); setDeleteTarget(null) }
    catch (err) { setDeleteError(err instanceof Error ? err.message : 'Ошибка удаления') }
    finally { setIsDeleting(false) }
  }

  return (
    <>
      <Card className="overflow-hidden rounded-3xl">
        {/* Шапка с кнопками сортировки */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{title}</span>
            <span className="text-xs text-slate-400">{items.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Алфавитный порядок"
              onClick={() => applySortMode('alpha')}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
                sortMode === 'alpha' ? 'bg-blue-50 text-blue-500' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 10h12M4 14h8M4 18h4" />
              </svg>
            </button>
            <button
              type="button"
              title="Свой порядок"
              onClick={() => applySortMode('custom')}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
                sortMode === 'custom' ? 'bg-blue-50 text-blue-500' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="9" cy="5" r="1" fill="currentColor" stroke="none"/>
                <circle cx="15" cy="5" r="1" fill="currentColor" stroke="none"/>
                <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
                <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
                <circle cx="9" cy="19" r="1" fill="currentColor" stroke="none"/>
                <circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/>
              </svg>
            </button>
          </div>
        </div>

        {canManage && (
          <form onSubmit={(e) => void handleAdd(e)} className="flex gap-2 border-b border-slate-100 px-4 py-3">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Добавить название..."
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400"
            />
            <Button type="submit" disabled={isAdding || !inputValue.trim()} className="rounded-xl px-4 py-2 text-sm">
              {isAdding ? '…' : '+ Добавить'}
            </Button>
          </form>
        )}
        {addError && <p className="px-4 pb-2 text-xs text-rose-500">{addError}</p>}

        {displayItems.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {displayItems.map((item, index) => (
              <li
                key={item.id}
                draggable={sortMode === 'custom'}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-2 px-4 py-1.5 text-sm text-slate-700 transition-colors ${
                  sortMode === 'custom' ? 'cursor-grab active:cursor-grabbing' : ''
                } ${
                  dragOverIndex === index && dragIndex.current !== index ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                {/* Drag handle — только в custom режиме */}
                {sortMode === 'custom' && (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-300" fill="currentColor">
                    <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
                    <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                    <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
                  </svg>
                )}
                {editingId === item.id ? (
                  <>
                    <input
                      autoFocus
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(item.id); if (e.key === 'Escape') cancelEdit() }}
                      className="flex-1 rounded-lg border border-blue-400 px-2 py-1 text-sm text-slate-900 outline-none"
                    />
                    <button type="button" disabled={isSaving || !editValue.trim()} onClick={() => void handleSave(item.id)}
                      className="flex h-7 items-center rounded-lg bg-blue-500 px-2 text-xs font-medium text-white transition hover:bg-blue-600 disabled:opacity-50">
                      {isSaving ? '…' : 'Сохранить'}
                    </button>
                    <button type="button" onClick={cancelEdit}
                      className="flex h-7 items-center rounded-lg px-2 text-xs text-slate-400 transition hover:text-slate-600">
                      Отмена
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex flex-1 items-center gap-2">
                      <span>{item.name}</span>
                      {item.is_system && (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-50 text-violet-400">WB</span>
                      )}
                    </div>
                    {canManage && (
                      <div className="flex items-center">
                        {!item.is_system && (
                          <button type="button" onClick={() => startEdit(item)} aria-label={`Редактировать ${item.name}`}
                            className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-blue-50 hover:text-blue-500">
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9">
                              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                            </svg>
                          </button>
                        )}
                        {item.is_system ? (
                          <span className="w-7" />
                        ) : (
                          <button type="button" onClick={() => setDeleteTarget(item)} aria-label={`Удалить ${item.name}`}
                            className={`flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition ${
                              canDelete ? 'hover:bg-rose-50 hover:text-rose-500' : 'cursor-not-allowed opacity-30'
                            }`} disabled={!canDelete}>
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                              <path d="M9 4h6" /><path d="M5 7h14" />
                              <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                              <path d="M10 11v4" /><path d="M14 11v4" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center justify-center py-8 text-sm text-slate-400">Список пуст</div>
        )}
      </Card>

      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title="Удалить запись?"
        description={`«${deleteTarget?.name ?? ''}» будет удалён. Это действие нельзя отменить.`}
        isSubmitting={isDeleting}
        error={deleteError}
        onClose={() => { if (!isDeleting) { setDeleteError(null); setDeleteTarget(null) } }}
        onConfirm={() => void handleConfirmDelete()}
      />
    </>
  )
}

const CarrierEditModal = ({
  carrier,
  currentUserId,
  onClose,
  onSave,
}: {
  carrier: Carrier
  currentUserId: string
  onClose: () => void
  onSave: (id: string, data: CarrierUpdateData) => Promise<void>
}) => {
  const [name, setName] = useState(carrier.name)
  const [phone, setPhone] = useState(carrier.phone ?? '')
  const [contactPerson, setContactPerson] = useState(carrier.contact_person ?? '')
  const [notes, setNotes] = useState(carrier.notes ?? '')
  const [isOwner, setIsOwner] = useState(carrier.owner_user_id === currentUserId)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Введите название'); return }
    setIsSaving(true)
    setError(null)
    try {
      await onSave(carrier.id, {
        name: name.trim(),
        phone: phone.trim() || null,
        contact_person: contactPerson.trim() || null,
        notes: notes.trim() || null,
        owner_user_id: isOwner ? currentUserId : null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Редактировать перевозчика">
      <form className="grid gap-4" onSubmit={(e) => void handleSubmit(e)}>
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-slate-500">Название *</label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
          />
        </div>

        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-slate-500">Телефон</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 999 000-00-00"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400"
          />
        </div>

        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-slate-500">Контактное лицо</label>
          <input
            type="text"
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            placeholder="Иван Иванов"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400"
          />
        </div>

        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-slate-500">Примечания</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Любая дополнительная информация..."
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400"
          />
        </div>

        {/* Я владелец (логистик) */}
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 transition hover:bg-blue-50/40">
          <div className="mt-0.5 flex-shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={isOwner}
              onClick={() => setIsOwner((v) => !v)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${isOwner ? 'bg-blue-500' : 'bg-slate-200'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${isOwner ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800">Я являюсь владельцем этого перевозчика</p>
            <p className="mt-0.5 text-xs text-slate-400">Включите, если вы сами управляете этой логистической компанией</p>
          </div>
        </label>

        {error && <p className="text-sm text-rose-500">{error}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>Отмена</Button>
          <Button type="submit" disabled={isSaving || !name.trim()}>
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Модалка тарифов перевозчика ──────────────────────────────────

const CarrierTariffModal = ({
  carrier,
  warehouses,
  accountId,
  onClose,
}: {
  carrier: Carrier
  warehouses: Warehouse[]
  accountId: string
  onClose: () => void
}) => {
  const [values, setValues] = useState<Record<string, { box: string; kg: string }>>({})
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchCarrierTariffs(accountId, carrier.id)
      .then((tariffs) => {
        const map: Record<string, { box: string; kg: string }> = {}
        const checkedMap: Record<string, boolean> = {}
        for (const t of tariffs) {
          map[t.warehouse_id] = {
            box: t.price_per_box != null ? String(t.price_per_box) : '',
            kg: t.price_per_kg != null ? String(t.price_per_kg) : '',
          }
          checkedMap[t.warehouse_id] = true
        }
        setValues(map)
        setChecked(checkedMap)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [accountId, carrier.id])

  const setValue = (warehouseId: string, field: 'box' | 'kg', val: string) =>
    setValues((prev) => ({
      ...prev,
      [warehouseId]: { ...(prev[warehouseId] ?? { box: '', kg: '' }), [field]: val },
    }))

  const handleBlur = async (warehouseId: string) => {
    const v = values[warehouseId] ?? { box: '', kg: '' }
    const box = v.box.trim() !== '' ? Number(v.box) : null
    const kg = v.kg.trim() !== '' ? Number(v.kg) : null
    try {
      await upsertCarrierTariff(accountId, carrier.id, warehouseId, box, kg)
    } catch (e) {
      console.error(e)
    }
  }

  const destWarehouses = warehouses
  const allChecked = destWarehouses.length > 0 && destWarehouses.every((w) => checked[w.id])
  const someChecked = !allChecked && destWarehouses.some((w) => checked[w.id])

  const toggleAll = () => {
    const next = !allChecked
    setChecked(Object.fromEntries(destWarehouses.map((w) => [w.id, next])))
    if (!next) {
      destWarehouses.forEach((w) => {
        upsertCarrierTariff(accountId, carrier.id, w.id, null, null).catch(console.error)
      })
    }
  }

  const toggleOne = (id: string) => {
    setChecked((prev) => {
      const next = !prev[id]
      if (!next) {
        upsertCarrierTariff(accountId, carrier.id, id, null, null).catch(console.error)
      }
      return { ...prev, [id]: next }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-3xl flex-col rounded-3xl bg-white shadow-xl h-[calc(100vh-1.5rem)] sm:h-[calc(100vh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">{carrier.name}</div>
            <div className="text-xs text-slate-400">Тарифы до складов назначения</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-slate-400">Загрузка…</div>
        ) : destWarehouses.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-slate-400">
            Нет складов назначения
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="w-10 px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = someChecked }}
                      onChange={toggleAll}
                      className="h-4 w-4 cursor-pointer accent-blue-500"
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Склад назначения</th>
                  <th className="w-36 px-3 py-2 text-center text-xs font-medium text-slate-500">За короб (₽)</th>
                  <th className="w-36 px-3 py-2 text-center text-xs font-medium text-slate-500">За кг (₽)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {destWarehouses.map((wh) => (
                  <tr key={wh.id} className={checked[wh.id] ? 'bg-blue-50/40 hover:bg-blue-50' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!checked[wh.id]}
                        onChange={() => toggleOne(wh.id)}
                        className="h-4 w-4 cursor-pointer accent-blue-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      <span>{wh.name}</span>
                      {wh.is_system && (
                        <span className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-violet-50 text-violet-400">WB</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={values[wh.id]?.box ?? ''}
                        onChange={(e) => setValue(wh.id, 'box', e.target.value)}
                        onBlur={() => void handleBlur(wh.id)}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm text-slate-900 outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={values[wh.id]?.kg ?? ''}
                        onChange={(e) => setValue(wh.id, 'kg', e.target.value)}
                        onBlur={() => void handleBlur(wh.id)}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm text-slate-900 outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Панель тарифов отгрузки на склады ВБ ─────────────────────────

const WbUnloadTariffsPanel = ({
  warehouses,
  accountId,
}: {
  warehouses: Warehouse[]
  accountId: string
}) => {
  const systemWarehouses = warehouses.filter((w) => w.is_system)
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchWbUnloadTariffs(accountId)
      .then((tariffs) => {
        const map: Record<string, string> = {}
        for (const t of tariffs) {
          map[t.warehouse_id] = t.price_per_box > 0 ? String(t.price_per_box) : ''
        }
        setValues(map)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [accountId])

  const handleBlur = async (warehouseId: string) => {
    const v = values[warehouseId] ?? ''
    const price = v.trim() !== '' ? Number(v) : null
    try {
      await upsertWbUnloadTariff(accountId, warehouseId, price)
    } catch (e) {
      console.error(e)
    }
  }

  if (systemWarehouses.length === 0) return null

  return (
    <Card className="overflow-hidden rounded-3xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <span className="text-sm font-semibold text-slate-900">Тарифы отгрузки на склады ВБ</span>
          <p className="mt-0.5 text-xs text-slate-400">Стоимость за 1 короб при сдаче груза на склад WB</p>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-6 text-sm text-slate-400">Загрузка…</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Склад ВБ</th>
              <th className="w-40 px-4 py-2 text-center text-xs font-medium text-slate-500">За короб (₽)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {systemWarehouses.map((wh) => (
              <tr key={wh.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-700">{wh.name}</td>
                <td className="px-4 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="—"
                    value={values[wh.id] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [wh.id]: e.target.value }))}
                    onBlur={() => void handleBlur(wh.id)}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm text-slate-900 outline-none focus:border-blue-400"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

// ── Валюты аккаунта ────────────────────────────────────────────

const ALL_CURRENCIES = [
  { code: 'RUB', label: 'Российский рубль',     symbol: '₽' },
  { code: 'KGS', label: 'Кыргызский сом',        symbol: 'с' },
  { code: 'UZS', label: 'Узбекский сум',          symbol: 'сўм' },
  { code: 'KZT', label: 'Казахстанский тенге',   symbol: '₸' },
  { code: 'BYN', label: 'Белорусский рубль',     symbol: 'Br' },
  { code: 'TJS', label: 'Таджикский сомони',     symbol: 'SM' },
  { code: 'AMD', label: 'Армянский драм',         symbol: '֏' },
  { code: 'AZN', label: 'Азербайджанский манат', symbol: '₼' },
  { code: 'GEL', label: 'Грузинский лари',       symbol: '₾' },
  { code: 'MDL', label: 'Молдавский лей',        symbol: 'L' },
  { code: 'TRY', label: 'Турецкая лира',         symbol: '₺' },
  { code: 'USD', label: 'Доллар США',            symbol: '$' },
] as const

const CurrenciesPanel = ({
  accountId,
  canManage,
}: {
  accountId: string
  canManage: boolean
}) => {
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [idMap, setIdMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchAccountCurrencies(accountId)
      .then((list) => {
        setEnabled(new Set(list.map((c) => c.code)))
        setIdMap(Object.fromEntries(list.map((c) => [c.code, c.id])))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [accountId])

  const toggle = async (code: string) => {
    if (!canManage || toggling) return
    setToggling(code)
    try {
      if (enabled.has(code)) {
        const id = idMap[code]
        if (id) {
          await deleteAccountCurrency(id)
          setEnabled((prev) => { const next = new Set(prev); next.delete(code); return next })
          setIdMap((prev) => { const next = { ...prev }; delete next[code]; return next })
        }
      } else {
        const row = await addAccountCurrency(accountId, code)
        setEnabled((prev) => new Set([...prev, code]))
        setIdMap((prev) => ({ ...prev, [code]: row.id }))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setToggling(null)
    }
  }

  return (
    <Card className="overflow-hidden rounded-3xl">
      <div className="border-b border-slate-100 px-4 py-3">
        <span className="text-sm font-semibold text-slate-900">Валюты</span>
        <p className="mt-0.5 text-xs text-slate-400">Включённые валюты будут доступны при выборе в тарифах работ</p>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-slate-400">Загрузка…</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {ALL_CURRENCIES.map((cur) => {
            const isOn = enabled.has(cur.code)
            const isToggling = toggling === cur.code
            return (
              <div
                key={cur.code}
                className="flex items-center gap-4 px-4 py-3"
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  disabled={!canManage || Boolean(toggling)}
                  onClick={() => void toggle(cur.code)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${
                    isOn ? 'bg-blue-500' : 'bg-slate-200'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${isOn ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <span className="w-10 rounded-lg bg-slate-100 px-2 py-0.5 text-center text-xs font-semibold text-slate-700">{cur.code}</span>
                <span className="flex-1 text-sm text-slate-700">{cur.label}</span>
                <span className="text-xs text-slate-400">{cur.symbol}</span>
                {isToggling && <span className="text-xs text-slate-400">…</span>}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ── Тарифы работ фулфилмента ─────────────────────────────────

const WORK_GROUPS = [
  {
    id: 'fulfillment',
    label: 'Фулфилмент',
    stages: [
      { id: 'reception', label: 'Приёмка' },
      { id: 'otk',       label: 'ОТК' },
      { id: 'marking',   label: 'Маркировка' },
      { id: 'packing',   label: 'Формирование коробов' },
    ],
  },
  {
    id: 'logistics',
    label: 'Логистика',
    stages: [
      { id: 'logistics_rf', label: 'Логистика в РФ' },
      { id: 'wb_unload',   label: 'Отгрузка на склады ВБ' },
    ],
  },
] as const

type WorkGroupId = typeof WORK_GROUPS[number]['id']

const WarehouseSearchSelect = ({
  value,
  onChange,
  warehouses,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  autoOpen,
}: {
  value: string
  onChange: (v: string) => void
  warehouses: Warehouse[]
  onFocus?: () => void
  onBlur?: () => void
  autoOpen?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({})
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const filtered = search
    ? warehouses.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()))
    : warehouses

  const openDropdown = () => {
    if (wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect()
      const dropH = 260
      const spaceBelow = window.innerHeight - rect.bottom
      if (spaceBelow >= dropH || spaceBelow >= window.innerHeight - rect.top) {
        setDropStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 9999 })
      } else {
        setDropStyle({ position: 'fixed', bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width, zIndex: 9999 })
      }
    }
    setOpen(true)
    setSearch('')
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  const closeDropdown = () => {
    setOpen(false)
    setSearch('')
    onBlurProp?.()
  }

  const select = (name: string) => {
    onChange(name)
    setOpen(false)
    setSearch('')
    onBlurProp?.()
  }

  useEffect(() => {
    if (autoOpen) openDropdown()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        closeDropdown()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <div ref={wrapRef} className="relative flex-1">
      <div
        tabIndex={0}
        onClick={() => { onFocusProp?.(); openDropdown() }}
        onFocus={() => { if (!open) onFocusProp?.() }}
        className={`flex w-full cursor-pointer items-center justify-between rounded-lg border bg-white px-3 py-1.5 text-sm outline-none transition ${
          open ? 'border-blue-400 ring-1 ring-blue-100' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className={value ? 'text-slate-700' : 'text-slate-400'}>{value || '— Выбрать склад —'}</span>
        <svg
          viewBox="0 0 24 24"
          className={`ml-2 h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      {open && (
        <div
          style={dropStyle}
          onMouseDown={(e) => e.preventDefault()}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          <div className="sticky top-0 border-b border-slate-100 bg-white px-2 py-1.5">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск склада…"
              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-400"
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeDropdown()
                if (e.key === 'Enter' && filtered.length > 0) select(filtered[0].name)
              }}
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400">Ничего не найдено</div>
            ) : (
              filtered.map((w) => (
                <div
                  key={w.id}
                  onClick={() => select(w.name)}
                  className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-blue-50 hover:text-blue-700 ${
                    value === w.name ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700'
                  }`}
                >
                  {w.name}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const WorkTariffsPanel = ({
  accountId,
  canManage,
  warehouses,
}: {
  accountId: string
  canManage: boolean
  warehouses: Warehouse[]
}) => {
  const [tariffs, setTariffs] = useState<FulfillmentWorkTariff[]>([])
  const [loading, setLoading] = useState(true)
  const [activeGroup, setActiveGroup] = useState<WorkGroupId>(() =>
    (localStorage.getItem('work_tariff_group') as WorkGroupId | null) ?? 'fulfillment'
  )
  const [activeStage, setActiveStage] = useState<string>(() =>
    localStorage.getItem('work_tariff_stage') ?? 'reception'
  )
  // currencies
  const [enabledCurrencies, setEnabledCurrencies] = useState<string[]>([])
  const [addCurrency, setAddCurrency] = useState('RUB')
  const [editCurrency, setEditCurrency] = useState('RUB')
  // stage default currencies
  const [stageCurrencies, setStageCurrencies] = useState<Record<string, string>>({})
  const [isApplyingToAll, setIsApplyingToAll] = useState(false)
  const [isSavingStageDefault, setIsSavingStageDefault] = useState(false)
  // add tariff
  const [addName, setAddName] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [addPricePerKg, setAddPricePerKg] = useState('')
  const [addPriceWorker, setAddPriceWorker] = useState('')
  const [addPriceSenior, setAddPriceSenior] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  // edit tariff
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editPricePerKg, setEditPricePerKg] = useState('')
  const [editPriceWorker, setEditPriceWorker] = useState('')
  const [editPriceSenior, setEditPriceSenior] = useState('')
  const [focusField, setFocusField] = useState<'name' | 'price' | 'pricekg' | 'worker' | 'senior'>('name')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // kept for unused-ref safety
  // delete tariff
  const [deleteTarget, setDeleteTarget] = useState<FulfillmentWorkTariff | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchWorkTariffs(accountId), fetchAccountCurrencies(accountId), fetchStageCurrencies(accountId)])
      .then(([ts, cs, sc]) => {
        setTariffs(ts)
        const codes = cs.map((c) => c.code)
        setEnabledCurrencies(codes)
        setStageCurrencies(sc)
        const defaultCur = sc[activeStage] ?? (codes.length > 0 ? codes[0] : 'RUB')
        setAddCurrency(defaultCur)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const currentGroup = WORK_GROUPS.find((g) => g.id === activeGroup) ?? WORK_GROUPS[0]

  const handleGroupChange = (groupId: WorkGroupId) => {
    const group = WORK_GROUPS.find((g) => g.id === groupId)!
    const firstStage = group.stages[0].id
    setActiveGroup(groupId)
    setActiveStage(firstStage)
    localStorage.setItem('work_tariff_group', groupId)
    localStorage.setItem('work_tariff_stage', firstStage)
    setEditingId(null)
    const sc = stageCurrencies[firstStage]
    setAddCurrency(sc ?? enabledCurrencies[0] ?? 'RUB')
  }

  const handleStageChange = (stageId: string) => {
    setActiveStage(stageId)
    localStorage.setItem('work_tariff_stage', stageId)
    setEditingId(null)
    const sc = stageCurrencies[stageId]
    setAddCurrency(sc ?? enabledCurrencies[0] ?? 'RUB')
  }

  const stageTariffs = tariffs.filter((t) => t.stage === activeStage)
  const isWarehouseStage = activeStage === 'logistics_rf' || activeStage === 'wb_unload'

  const handleAdd = async () => {
    if (!addName.trim()) return
    setIsAdding(true)
    try {
      const t = await addWorkTariff(accountId, activeStage, addName.trim(), Number(addPrice) || 0, stageCurrencies[activeStage] || addCurrency, Number(addPriceWorker) || 0, Number(addPriceSenior) || 0, Number(addPricePerKg) || 0)
      setTariffs((prev) => [...prev, t])
      setAddName('')
      setAddPrice('')
      setAddPricePerKg('')
      setAddPriceWorker('')
      setAddPriceSenior('')
    } catch (e) {
      console.error(e)
    } finally {
      setIsAdding(false)
    }
  }

  const startEdit = (t: FulfillmentWorkTariff, field: 'name' | 'price' | 'pricekg' | 'worker' | 'senior' = 'name') => {
    setEditingId(t.id)
    setEditName(t.name)
    setEditPrice('')
    setEditPricePerKg('')
    setEditPriceWorker('')
    setEditPriceSenior('')
    setEditCurrency(t.currency ?? 'RUB')
    setFocusField(field)
  }

  const saveCurrentValues = async (id: string) => {
    const forcedCurrency = stageCurrencies[activeStage]
    const current = tariffs.find((t) => t.id === id)
    if (!current) return
    const patch = {
      name: editName.trim(),
      price_per_unit: editPrice.trim() === '' ? current.price_per_unit : Number(editPrice),
      price_per_kg: editPricePerKg.trim() === '' ? (current.price_per_kg ?? 0) : Number(editPricePerKg),
      price_worker: editPriceWorker.trim() === '' ? (current.price_worker ?? 0) : Number(editPriceWorker),
      price_senior: editPriceSenior.trim() === '' ? (current.price_senior ?? 0) : Number(editPriceSenior),
      currency: forcedCurrency || editCurrency,
    }
    try {
      await updateWorkTariff(id, patch)
      setTariffs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    } catch (e) {
      console.error(e)
    }
  }

  const saveEdit = async (id: string) => {
    await saveCurrentValues(id)
    setEditingId(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await deleteWorkTariff(deleteTarget.id)
      setTariffs((prev) => prev.filter((t) => t.id !== deleteTarget.id))
      setDeleteTarget(null)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleStageCurrencyChange = async (currency: string) => {
    setStageCurrencies((prev) => ({ ...prev, [activeStage]: currency }))
    setAddCurrency(currency || (enabledCurrencies[0] ?? 'RUB'))
    if (!currency) return
    setIsSavingStageDefault(true)
    try {
      await upsertStageCurrency(accountId, activeStage, currency)
    } catch (e) {
      console.error(e)
    } finally {
      setIsSavingStageDefault(false)
    }
  }

  const handleApplyToAll = async () => {
    const currency = stageCurrencies[activeStage]
    if (!currency) return
    setIsApplyingToAll(true)
    try {
      await Promise.all(stageTariffs.map((t) => updateWorkTariff(t.id, { currency })))
      setTariffs((prev) => prev.map((t) => (t.stage === activeStage ? { ...t, currency } : t)))
    } catch (e) {
      console.error(e)
    } finally {
      setIsApplyingToAll(false)
    }
  }

  return (
    <Card className="overflow-hidden rounded-3xl">
      {/* Header */}
      <div className="border-b border-slate-100 px-4 py-3">
        <span className="text-sm font-semibold text-slate-900">Тарифы работ</span>
      </div>

      {/* Group tabs */}
      <div className="flex gap-0 border-b border-slate-100">
        {WORK_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => handleGroupChange(g.id)}
            className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeGroup === g.id
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {g.label}
            <span className={`ml-1.5 text-xs ${activeGroup === g.id ? 'text-blue-400' : 'text-slate-400'}`}>
              {tariffs.filter((t) => WORK_GROUPS.find((grp) => grp.id === g.id)?.stages.some((s) => s.id === t.stage)).length}
            </span>
          </button>
        ))}
      </div>

      {/* Stage sub-tabs */}
      <div className="flex gap-0.5 overflow-x-auto bg-slate-50 px-4 py-2 border-b border-slate-100">
        {currentGroup.stages.map((s) => {
          const count = tariffs.filter((t) => t.stage === s.id).length
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handleStageChange(s.id)}
              className={`flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                activeStage === s.id
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
              }`}
            >
              {s.label}
              {count > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  activeStage === s.id ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Stage default currency bar */}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <span className="text-xs text-slate-400">Валюта раздела:</span>
          <select
            value={stageCurrencies[activeStage] ?? ''}
            onChange={(e) => void handleStageCurrencyChange(e.target.value)}
            disabled={isSavingStageDefault}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400 disabled:opacity-60"
          >
            <option value="">— не задано —</option>
            {(enabledCurrencies.length > 0 ? enabledCurrencies : ['RUB']).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {stageCurrencies[activeStage] && stageTariffs.length > 0 && (
            <button
              type="button"
              disabled={isApplyingToAll}
              onClick={() => void handleApplyToAll()}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
            >
              {isApplyingToAll ? '…' : `Применить ко всем (${stageTariffs.length})`}
            </button>
          )}
          <span className="ml-auto text-xs text-slate-300">Применяется к новым тарифам автоматически</span>
        </div>
      )}

      {/* Add tariff row */}
      {canManage && (
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/40 px-4 py-2">
          {isWarehouseStage ? (
            <WarehouseSearchSelect
              value={addName}
              onChange={setAddName}
              warehouses={warehouses}
            />
          ) : (
            <input
              type="text"
              placeholder="Название тарифа"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400 placeholder:text-slate-400"
            />
          )}
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0"
            value={addPrice}
            onChange={(e) => setAddPrice(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
            title="Заказчику / за короб"
            className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {isWarehouseStage && (
            <input
              type="number"
              min="0"
              step="any"
              placeholder="0"
              value={addPricePerKg}
              onChange={(e) => setAddPricePerKg(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
              title="Заказчику / за кг"
              className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          )}
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0"
            value={addPriceWorker}
            onChange={(e) => setAddPriceWorker(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
            title="Исполнителю"
            className="w-24 rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-center text-sm text-emerald-700 outline-none focus:border-emerald-400 placeholder:text-emerald-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0"
            value={addPriceSenior}
            onChange={(e) => setAddPriceSenior(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
            title="Старшему"
            className="w-24 rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-center text-sm text-blue-700 outline-none focus:border-blue-400 placeholder:text-blue-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-xs text-slate-400">/ед</span>
          {stageCurrencies[activeStage] ? (
            <span className="rounded-md bg-amber-100 px-2 py-1.5 text-xs font-medium text-amber-700">{stageCurrencies[activeStage]}</span>
          ) : (
            <select
              value={addCurrency}
              onChange={(e) => setAddCurrency(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400"
            >
              {(enabledCurrencies.length > 0 ? enabledCurrencies : ['RUB']).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={isAdding || !addName.trim()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isAdding ? '…' : '+ Добавить'}
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-400">Загрузка…</div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="bg-slate-50/60">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">{isWarehouseStage ? 'Склад' : 'Название тарифа'}</th>
                <th className="w-28 px-4 py-2 text-center">
                  <div className="text-xs font-medium text-slate-500">Заказчику</div>
                  <div className="text-[10px] font-normal text-slate-400">{isWarehouseStage ? 'цена / за короб' : activeStage === 'packing' ? 'цена / за короб' : 'цена / за единицу'}</div>
                </th>
                {isWarehouseStage && (
                  <th className="w-28 px-4 py-2 text-center">
                    <div className="text-xs font-medium text-slate-500">Заказчику</div>
                    <div className="text-[10px] font-normal text-slate-400">цена / за кг</div>
                  </th>
                )}
                <th className="w-28 px-4 py-2 text-center">
                  <div className="text-xs font-medium text-emerald-600">Исполнителю</div>
                  <div className="text-[10px] font-normal text-emerald-400">цена / за единицу</div>
                </th>
                <th className="w-28 px-4 py-2 text-center">
                  <div className="text-xs font-medium text-blue-600">Старшему</div>
                  <div className="text-[10px] font-normal text-blue-400">цена / за единицу</div>
                </th>
                <th className="w-24 px-4 py-2 text-center text-xs font-medium text-slate-500">Валюта</th>
                {canManage && <th className="w-20 px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stageTariffs.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? (isWarehouseStage ? 7 : 6) : (isWarehouseStage ? 6 : 5)} className="py-8 text-center text-sm text-slate-400">Нет тарифов в этом разделе</td>
                </tr>
              ) : (
                stageTariffs.map((t) => {
                  const isEditing = editingId === t.id
                  const cellBase = canManage ? 'cursor-text' : ''
                  const viewCell = `px-4 py-1.5 ${cellBase}`
                  return (
                    <tr key={t.id} className="group hover:bg-slate-50" onBlur={(e) => { if (isEditing && !e.currentTarget.contains(e.relatedTarget as Node)) setEditingId(null) }}>
                      <td className={viewCell}>
                        {isEditing && focusField === 'name' ? (
                          isWarehouseStage ? (
                            <WarehouseSearchSelect
                              value={editName}
                              onChange={setEditName}
                              warehouses={warehouses}
                              autoOpen
                              onBlur={() => void saveCurrentValues(t.id)}
                            />
                          ) : (
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              autoFocus
                              onBlur={() => void saveCurrentValues(t.id)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { void saveEdit(t.id) } if (e.key === 'Escape') { setEditingId(null) } }}
                              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                            />
                          )
                        ) : (
                          <div
                            className="rounded-lg px-2 py-1 text-sm text-slate-700 hover:bg-white hover:ring-1 hover:ring-slate-200"
                            onMouseDown={isEditing ? (e) => e.preventDefault() : undefined}
                            onClick={canManage ? (isEditing ? () => setFocusField('name') : () => startEdit(t, 'name')) : undefined}
                          >{isEditing ? editName : t.name}</div>
                        )}
                      </td>
                      <td className={viewCell}>
                        {isEditing && focusField === 'price' ? (
                          <input
                            type="number" min="0" step="any"
                            placeholder={String(t.price_per_unit)}
                            value={editPrice}
                            autoFocus
                            onChange={(e) => setEditPrice(e.target.value)}
                            onBlur={() => { void saveCurrentValues(t.id); setEditPrice('') }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { void saveEdit(t.id) } if (e.key === 'Escape') { setEditingId(null) } }}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        ) : (
                          <div
                            className="rounded-lg px-2 py-1 text-center text-sm font-medium text-slate-800 hover:bg-white hover:ring-1 hover:ring-slate-200"
                            onMouseDown={isEditing ? (e) => e.preventDefault() : undefined}
                            onClick={canManage ? (isEditing ? () => setFocusField('price') : () => startEdit(t, 'price')) : undefined}
                          >{editPrice !== '' && isEditing ? editPrice : t.price_per_unit}</div>
                        )}
                      </td>
                      {isWarehouseStage && (
                        <td className={viewCell}>
                          {isEditing && focusField === 'pricekg' ? (
                            <input
                              type="number" min="0" step="any"
                              placeholder={String(t.price_per_kg ?? 0)}
                              value={editPricePerKg}
                              autoFocus
                              onChange={(e) => setEditPricePerKg(e.target.value)}
                              onBlur={() => { void saveCurrentValues(t.id); setEditPricePerKg('') }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { void saveEdit(t.id) } if (e.key === 'Escape') { setEditingId(null) } }}
                              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          ) : (
                            <div
                              className="rounded-lg px-2 py-1 text-center text-sm font-medium text-slate-800 hover:bg-white hover:ring-1 hover:ring-slate-200"
                              onMouseDown={isEditing ? (e) => e.preventDefault() : undefined}
                              onClick={canManage ? (isEditing ? () => setFocusField('pricekg') : () => startEdit(t, 'pricekg')) : undefined}
                            >{editPricePerKg !== '' && isEditing ? editPricePerKg : (t.price_per_kg ?? 0)}</div>
                          )}
                        </td>
                      )}
                      <td className={viewCell}>
                        {isEditing && focusField === 'worker' ? (
                          <input
                            type="number" min="0" step="any"
                            placeholder={String(t.price_worker ?? 0)}
                            value={editPriceWorker}
                            autoFocus
                            onChange={(e) => setEditPriceWorker(e.target.value)}
                            onBlur={() => { void saveCurrentValues(t.id); setEditPriceWorker('') }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { void saveEdit(t.id) } if (e.key === 'Escape') { setEditingId(null) } }}
                            className="w-full rounded-lg border border-emerald-200 px-2 py-1 text-center text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        ) : (
                          <div
                            className="rounded-lg px-2 py-1 text-center text-sm font-medium text-emerald-700 hover:bg-white hover:ring-1 hover:ring-emerald-200"
                            onMouseDown={isEditing ? (e) => e.preventDefault() : undefined}
                            onClick={canManage ? (isEditing ? () => setFocusField('worker') : () => startEdit(t, 'worker')) : undefined}
                          >{editPriceWorker !== '' && isEditing ? editPriceWorker : (t.price_worker ?? 0)}</div>
                        )}
                      </td>
                      <td className={viewCell}>
                        {isEditing && focusField === 'senior' ? (
                          <input
                            type="number" min="0" step="any"
                            placeholder={String(t.price_senior ?? 0)}
                            value={editPriceSenior}
                            autoFocus
                            onChange={(e) => setEditPriceSenior(e.target.value)}
                            onBlur={() => { void saveCurrentValues(t.id); setEditPriceSenior('') }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { void saveEdit(t.id) } if (e.key === 'Escape') { setEditingId(null) } }}
                            className="w-full rounded-lg border border-blue-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        ) : (
                          <div
                            className="rounded-lg px-2 py-1 text-center text-sm font-medium text-blue-700 hover:bg-white hover:ring-1 hover:ring-blue-200"
                            onMouseDown={isEditing ? (e) => e.preventDefault() : undefined}
                            onClick={canManage ? (isEditing ? () => setFocusField('senior') : () => startEdit(t, 'senior')) : undefined}
                          >{editPriceSenior !== '' && isEditing ? editPriceSenior : (t.price_senior ?? 0)}</div>
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-center">
                        {isEditing ? (
                          stageCurrencies[activeStage] ? (
                            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{stageCurrencies[activeStage]}</span>
                          ) : (
                            <select
                              value={editCurrency}
                              onChange={(e) => setEditCurrency(e.target.value)}
                              onBlur={() => void saveCurrentValues(t.id)}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm outline-none focus:border-blue-400"
                            >
                              {(enabledCurrencies.length > 0 ? enabledCurrencies : ['RUB']).map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          )
                        ) : (
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{t.currency}</span>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-4 py-1.5">
                          <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); setEditingId(null) }}
                              onClick={() => setDeleteTarget(t)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                }))
              }
            </tbody>
          </table>
        </>
      )}

      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title="Удалить тариф?"
        description={`«${deleteTarget?.name ?? ''}» будет удалён.`}
        isSubmitting={isDeleting}
        onClose={() => { if (!isDeleting) setDeleteTarget(null) }}
        onConfirm={() => void handleDelete()}
      />
    </Card>
  )
}

// ── Страница справочников ─────────────────────────────────────────

interface DirectoriesPageProps {
  carriers: Carrier[]
  warehouses: Warehouse[]
  accountId: string
  currentUserId: string
  onAddCarrier: (name: string) => Promise<unknown>
  onDeleteCarrier: (id: string) => Promise<void>
  onRenameCarrier: (id: string, name: string) => Promise<void>
  onUpdateCarrier: (id: string, data: CarrierUpdateData) => Promise<void>
  onAddWarehouse: (name: string) => Promise<unknown>
  onDeleteWarehouse: (id: string) => Promise<void>
  onRenameWarehouse: (id: string, name: string) => Promise<void>
  canManage?: boolean
  canDelete?: boolean
  canManageTariffs?: boolean
}

export const DirectoriesPage = ({
  carriers,
  warehouses,
  accountId,
  currentUserId,
  onAddCarrier,
  onDeleteCarrier,
  onRenameCarrier,
  onUpdateCarrier,
  onAddWarehouse,
  onDeleteWarehouse,
  onRenameWarehouse,
  canManage = true,
  canDelete = true,
  canManageTariffs = false,
}: DirectoriesPageProps) => {
  const [tariffCarrier, setTariffCarrier] = useState<Carrier | null>(null)
  const [editCarrier, setEditCarrier] = useState<Carrier | null>(null)
  const [tab, setTab] = useState<'dirs' | 'work' | 'currencies'>(
    () => {
      const saved = localStorage.getItem('dirs_tab')
      if (saved === 'dirs' || saved === 'work' || saved === 'currencies') return saved
      return 'dirs'
    }
  )

  const handleTabChange = (key: 'dirs' | 'work' | 'currencies') => {
    localStorage.setItem('dirs_tab', key)
    setTab(key)
  }

  const tabs = [
    { key: 'dirs' as const, label: 'Перевозчики и склады' },
    { key: 'work' as const, label: 'Тарифы работ' },
    { key: 'currencies' as const, label: 'Валюты' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => handleTabChange(t.key)}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dirs' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <DirectoryPanel
            title="Перевозчики"
            items={carriers}
            onAdd={onAddCarrier}
            onDelete={onDeleteCarrier}
            onUpdate={onRenameCarrier}
            canManage={canManage}
            canDelete={canDelete}
            onEditModal={(item) => setEditCarrier(carriers.find((c) => c.id === item.id) ?? null)}
            onTariff={(id, name) =>
              setTariffCarrier(carriers.find((c) => c.id === id) ?? { id, account_id: accountId, name, created_at: '' })
            }
          />
          <WarehousesPanel
            title="Склады назначения"
            items={warehouses}
            onAdd={onAddWarehouse}
            onDelete={onDeleteWarehouse}
            onUpdate={onRenameWarehouse}
            canManage={canManage}
            canDelete={canDelete}
            accountId={accountId}
          />
        </div>
      )}

      {tab === 'work' && (
        <WorkTariffsPanel accountId={accountId} canManage={canManageTariffs} warehouses={warehouses} />
      )}

      {tab === 'currencies' && (
        <CurrenciesPanel accountId={accountId} canManage={canManage} />
      )}

      {tariffCarrier && (
        <CarrierTariffModal
          carrier={tariffCarrier}
          warehouses={warehouses}
          accountId={accountId}
          onClose={() => setTariffCarrier(null)}
        />
      )}

      {editCarrier && (
        <CarrierEditModal
          carrier={editCarrier}
          currentUserId={currentUserId}
          onClose={() => setEditCarrier(null)}
          onSave={onUpdateCarrier}
        />
      )}
    </div>
  )
}
