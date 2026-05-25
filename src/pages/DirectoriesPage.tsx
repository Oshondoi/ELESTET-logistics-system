import { useEffect, useMemo, useRef, useState } from 'react'
import type { Carrier, Consumable, ConsumableCatalogItem, FulfillmentWorkTariff, Warehouse } from '../types'
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
  setPrimaryCurrency,
  updateCurrencyRate,
  fetchStageCurrencies,
  upsertStageCurrency,
  fetchWarehouseSettings,
  saveWarehouseSettings,
  fetchConsumables,
  addConsumable,
  updateConsumable,
  deleteConsumable,
  fetchConsumableCatalog,
  addConsumableCatalogItem,
  updateConsumableCatalogItem,
  deleteConsumableCatalogItem,
} from '../services/directoriesService'
import type { CarrierUpdateData, WarehouseOrderSettings } from '../services/directoriesService'

const CONSUMABLE_KIND_OPTIONS = [
  { id: 'box', label: 'Короб' },
  { id: 'zip', label: 'ZIP-пакет' },
  { id: 'thermo', label: 'Термо этикетка' },
] as const

const CONSUMABLE_SIZE_OPTIONS: Record<string, string[]> = {
  box: ['60x40x40', '60x40x30', '50x40x40', '40x30x30', '40x30x20'],
  zip: ['40x35', '40x30', '35x30', '30x25', '25x20', '20x15'],
}

const CONSUMABLE_KIND_LABELS: Record<string, string> = {
  box: 'Короб',
  zip: 'ZIP-пакет',
}

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
  sortMode, orderIds, onSortChange,
}: DirectoryPanelProps & {
  accountId: string
  sortMode: 'alpha' | 'custom'
  orderIds: string[]
  onSortChange: (next: import('../services/directoriesService').WarehouseOrderSettings) => void
}) => {
  const [inputValue, setInputValue] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [posEditId, setPosEditId] = useState<string | null>(null)
  const [posInput, setPosInput] = useState('')

  const displayItems = useMemo(() => {
    if (sortMode === 'alpha') return [...items].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    const orderMap = new Map(orderIds.map((id, i) => [id, i]))
    return [...items].sort((a, b) => (orderMap.get(a.id) ?? 999999) - (orderMap.get(b.id) ?? 999999))
  }, [sortMode, items, orderIds])

  const applySortMode = (mode: 'alpha' | 'custom') => {
    if (mode === 'custom') {
      const alpha = [...items].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(i => i.id)
      const merged = [
        ...orderIds.filter(id => items.some(x => x.id === id)),
        ...alpha.filter(id => !orderIds.includes(id)),
      ]
      onSortChange({ sort_mode: 'custom', order_ids: merged })
    } else {
      onSortChange({ sort_mode: 'alpha', order_ids: orderIds })
    }
  }

  const saveOrder = (newOrder: string[]) => {
    onSortChange({ sort_mode: 'custom', order_ids: newOrder })
  }

  const handleMoveToPosition = (id: string, targetPos: number) => {
    const currentIds = displayItems.map(i => i.id)
    const fromIndex = currentIds.indexOf(id)
    if (fromIndex === -1) return
    const toIndex = Math.max(0, Math.min(displayItems.length - 1, targetPos - 1))
    if (fromIndex === toIndex) return
    const next = [...currentIds]
    next.splice(fromIndex, 1)
    next.splice(toIndex, 0, id)
    saveOrder(next)
  }

  const commitPos = (id: string) => {
    const n = parseInt(posInput, 10)
    if (!isNaN(n) && n >= 1) handleMoveToPosition(id, n)
    setPosEditId(null)
  }

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
                className="flex items-center gap-2 px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                {/* Поле позиции — только в custom режиме */}
                {sortMode === 'custom' && (
                  posEditId === item.id ? (
                    <input
                      type="number"
                      autoFocus
                      value={posInput}
                      min={1}
                      max={displayItems.length}
                      onChange={(e) => setPosInput(e.target.value)}
                      onBlur={() => commitPos(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitPos(item.id) }
                        if (e.key === 'Escape') setPosEditId(null)
                      }}
                      onFocus={(e) => e.target.select()}
                      className="w-10 shrink-0 rounded-lg border border-blue-300 py-0.5 text-center text-xs font-medium text-slate-700 outline-none focus:ring-1 focus:ring-blue-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setPosEditId(item.id); setPosInput(String(index + 1)) }}
                      title="Изменить позицию"
                      className="w-10 shrink-0 rounded-lg border border-slate-200 bg-slate-50 py-0.5 text-center text-xs font-medium text-slate-400 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-500"
                    >
                      {index + 1}
                    </button>
                  )
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

const AUTO_FETCH_LS_KEY = (accountId: string) => `currency_auto_fetch_${accountId}`

const CurrenciesPanel = ({
  accountId,
  canManage,
}: {
  accountId: string
  canManage: boolean
}) => {
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [idMap, setIdMap] = useState<Record<string, string>>({})
  const [primaryCode, setPrimaryCode] = useState<string | null>(null)
  const [rateMap, setRateMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null)
  const [editingRate, setEditingRate] = useState<string | null>(null)
  const [rateInput, setRateInput] = useState('')
  const [savingRate, setSavingRate] = useState<string | null>(null)
  const [autoFetch, setAutoFetch] = useState(false)
  const [fetchingRates, setFetchingRates] = useState(false)
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<Date | null>(null)

  const fetchRatesFromAPI = async (
    primary: string,
    enabledSet: Set<string>,
    ids: Record<string, string>,
  ) => {
    if (!primary) return
    setFetchingRates(true)
    try {
      const resp = await fetch(`https://open.er-api.com/v6/latest/${primary}`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = (await resp.json()) as { result: string; rates: Record<string, number> }
      if (data.result !== 'success') throw new Error('API error')
      const newRates: Record<string, number> = {}
      const saves: Promise<void>[] = []
      for (const code of enabledSet) {
        if (code === primary) continue
        const apiRate = data.rates[code]
        if (apiRate && apiRate > 0) {
          newRates[code] = apiRate
          const id = ids[code]
          if (id) saves.push(updateCurrencyRate(id, apiRate))
        }
      }
      await Promise.all(saves)
      setRateMap((prev) => ({ ...prev, ...newRates }))
      setRatesUpdatedAt(new Date())
    } catch (e) {
      console.error('Rate fetch failed:', e)
    } finally {
      setFetchingRates(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchAccountCurrencies(accountId)
      .then(async (list) => {
        const enabledSet = new Set(list.map((c) => c.code))
        const ids = Object.fromEntries(list.map((c) => [c.code, c.id]))
        const primary = list.find((c) => c.is_primary)
        const primaryC = primary?.code ?? null
        setEnabled(enabledSet)
        setIdMap(ids)
        setPrimaryCode(primaryC)
        setRateMap(Object.fromEntries(list.map((c) => [c.code, c.exchange_rate ?? 1])))
        const isAuto = localStorage.getItem(AUTO_FETCH_LS_KEY(accountId)) === '1'
        setAutoFetch(isAuto)
        if (isAuto && primaryC) {
          void fetchRatesFromAPI(primaryC, enabledSet, ids)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [accountId])

  const toggleAutoFetch = async () => {
    if (!canManage || fetchingRates) return
    const next = !autoFetch
    setAutoFetch(next)
    if (next) {
      localStorage.setItem(AUTO_FETCH_LS_KEY(accountId), '1')
      if (primaryCode) {
        void fetchRatesFromAPI(primaryCode, enabled, idMap)
      }
    } else {
      localStorage.removeItem(AUTO_FETCH_LS_KEY(accountId))
    }
  }

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
          if (primaryCode === code) setPrimaryCode(null)
        }
      } else {
        const row = await addAccountCurrency(accountId, code)
        setEnabled((prev) => new Set([...prev, code]))
        setIdMap((prev) => ({ ...prev, [code]: row.id }))
        setRateMap((prev) => ({ ...prev, [code]: 1 }))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setToggling(null)
    }
  }

  const handleSetPrimary = async (code: string) => {
    if (!canManage || settingPrimary) return
    const id = idMap[code]
    if (!id) return
    setSettingPrimary(code)
    try {
      await setPrimaryCurrency(accountId, id)
      setPrimaryCode(code)
      if (autoFetch) {
        void fetchRatesFromAPI(code, enabled, idMap)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSettingPrimary(null)
    }
  }

  const startEditRate = (code: string) => {
    if (!canManage || primaryCode === code || autoFetch) return
    setEditingRate(code)
    setRateInput(String(rateMap[code] ?? 1))
  }

  const saveRate = async (code: string) => {
    const id = idMap[code]
    if (!id) { setEditingRate(null); return }
    const rate = parseFloat(rateInput)
    if (isNaN(rate) || rate <= 0) { setEditingRate(null); return }
    setSavingRate(code)
    try {
      await updateCurrencyRate(id, rate)
      setRateMap((prev) => ({ ...prev, [code]: rate }))
    } catch (e) {
      console.error(e)
    } finally {
      setSavingRate(null)
      setEditingRate(null)
    }
  }

  const updatedLabel = ratesUpdatedAt
    ? `Обновлено в ${ratesUpdatedAt.getHours().toString().padStart(2, '0')}:${ratesUpdatedAt.getMinutes().toString().padStart(2, '0')}`
    : null

  return (
    <Card className="overflow-hidden rounded-3xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-400">Включённые валюты будут доступны при выборе в тарифах работ</p>
        {canManage && (
          <button
            type="button"
            onClick={() => void toggleAutoFetch()}
            disabled={fetchingRates}
            title={autoFetch ? 'Авто-обновление курса включено (open.er-api.com)' : 'Включить авто-обновление курса с open.er-api.com'}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
              autoFetch
                ? 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            {fetchingRates ? (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" opacity="0.25"/>
                <path d="M21 12a9 9 0 00-9-9" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
            )}
            {fetchingRates ? 'Обновляется…' : autoFetch ? 'Авто-курс вкл' : 'Авто-курс'}
            {autoFetch && !fetchingRates && updatedLabel && (
              <span className="text-blue-400">· {updatedLabel}</span>
            )}
          </button>
        )}
      </div>
      {/* Column headers */}
      <div className="grid grid-cols-[40px_1fr_120px_140px] items-center gap-2 border-b border-slate-100 px-4 py-2">
        <div />
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Валюта</div>
        <div className="text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">Основная</div>
        <div className="text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Курс к основной
          {autoFetch && <span className="ml-1 font-normal normal-case text-blue-400">· авто</span>}
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-slate-400">Загрузка…</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {ALL_CURRENCIES.map((cur) => {
            const isOn = enabled.has(cur.code)
            const isToggling = toggling === cur.code
            const isPrimary = primaryCode === cur.code
            const isSettingPrimary = settingPrimary === cur.code
            const rate = rateMap[cur.code] ?? 1
            const isEditingRate = editingRate === cur.code
            const isSavingThisRate = savingRate === cur.code
            const rateReadOnly = autoFetch || !canManage
            return (
              <div key={cur.code} className={`grid grid-cols-[40px_1fr_120px_140px] items-center gap-2 px-4 py-2.5 ${!isOn ? 'opacity-50' : ''}`}>
                {/* Toggle */}
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
                {/* Code + Name */}
                <div className="flex items-center gap-2.5">
                  <span className="w-10 rounded-lg bg-slate-100 px-2 py-0.5 text-center text-xs font-semibold text-slate-700">{cur.code}</span>
                  <span className="text-sm text-slate-700">{cur.label}</span>
                  <span className="text-xs text-slate-400">{cur.symbol}</span>
                  {isToggling && <span className="text-xs text-slate-400">…</span>}
                </div>
                {/* Primary star */}
                <div className="flex items-center justify-center">
                  {isOn ? (
                    <button
                      type="button"
                      disabled={!canManage || Boolean(settingPrimary)}
                      onClick={() => void handleSetPrimary(cur.code)}
                      title={isPrimary ? 'Основная валюта' : 'Сделать основной'}
                      className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-slate-100 disabled:opacity-50"
                    >
                      {isSettingPrimary ? (
                        <span className="text-xs text-slate-400">…</span>
                      ) : isPrimary ? (
                        <svg viewBox="0 0 24 24" className="h-5 w-5 text-amber-500" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-300 hover:text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                      )}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </div>
                {/* Exchange rate */}
                <div className="flex items-center justify-center">
                  {isOn ? (
                    isPrimary ? (
                      <span className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-center text-sm font-medium text-slate-400 select-none">1</span>
                    ) : rateReadOnly ? (
                      <span className={`w-24 rounded-lg border border-slate-200 px-3 py-1 text-center text-sm font-medium ${autoFetch ? 'border-blue-100 bg-blue-50 text-blue-700' : 'bg-slate-50 text-slate-500'}`}>
                        {fetchingRates ? '…' : rate}
                      </span>
                    ) : isEditingRate ? (
                      <input
                        type="number" min="0.0001" step="any"
                        value={rateInput}
                        autoFocus
                        onChange={(e) => setRateInput(e.target.value)}
                        onBlur={() => void saveRate(cur.code)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void saveRate(cur.code); if (e.key === 'Escape') setEditingRate(null) }}
                        className="w-24 rounded-lg border border-blue-300 px-3 py-1 text-center text-sm outline-none focus:ring-1 focus:ring-blue-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditRate(cur.code)}
                        className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-1 text-center text-sm font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                      >
                        {isSavingThisRate ? '…' : rate}
                      </button>
                    )
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {primaryCode === null && enabled.size > 0 && (
        <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-600">
          Выберите основную валюту — нажмите ★ напротив нужной
        </div>
      )}
    </Card>
  )
}

// ── Расходники ────────────────────────────────────────────────

const ConsumablesPanel = ({
  accountId,
  canManage,
}: {
  accountId: string
  canManage: boolean
}) => {
  const [catalogItems, setCatalogItems] = useState<ConsumableCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [enabledCurrencies, setEnabledCurrencies] = useState<string[]>([])
  const [activeCatalogKind, setActiveCatalogKind] = useState(
    () => localStorage.getItem('catalog_active_kind') ?? 'Короб'
  )
  const [addSizeInput, setAddSizeInput] = useState('')
  const [isAddingSize, setIsAddingSize] = useState(false)
  const [addCatalogPrice, setAddCatalogPrice] = useState('')
  const [addCatalogCost, setAddCatalogCost] = useState('')
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null)
  const [editCatalogParam, setEditCatalogParam] = useState('')
  const [editCatalogPrice, setEditCatalogPrice] = useState('')
  const [editCatalogCost, setEditCatalogCost] = useState('')
  const [focusCatalogField, setFocusCatalogField] = useState<'price' | 'cost'>('price')
  const [addingNewKind, setAddingNewKind] = useState(false)
  const [newKindName, setNewKindName] = useState('')
  const [isAddingNewKind, setIsAddingNewKind] = useState(false)
  // catalog section currency
  const [defaultCatalogCurrency, setDefaultCatalogCurrency] = useState(
    () => localStorage.getItem('catalog_section_currency') ?? ''
  )
  const [isApplyingCatalogToAll, setIsApplyingCatalogToAll] = useState(false)
  const [addCatalogCurrency, setAddCatalogCurrency] = useState('RUB')
  const [hiddenCatalogKinds, setHiddenCatalogKinds] = useState<string[]>([])
  const [showKindManageModal, setShowKindManageModal] = useState(false)
  const [kindDeleteConfirm, setKindDeleteConfirm] = useState<string | null>(null)
  const [isDeletingKind, setIsDeletingKind] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchConsumableCatalog(accountId), fetchAccountCurrencies(accountId)])
      .then(([catalog, cs]) => {
        setCatalogItems(catalog)
        const codes = cs.map((c) => c.code)
        setEnabledCurrencies(codes)
        const savedCatalogCurrency = localStorage.getItem('catalog_section_currency')
        const catalogCurrencies = [...new Set(catalog.map((i) => (i as ConsumableCatalogItem).currency).filter(Boolean))]
        const inferredCatalogDefault = (!savedCatalogCurrency && catalogCurrencies.length === 1) ? (catalogCurrencies[0] ?? '') : (savedCatalogCurrency ?? '')
        setDefaultCatalogCurrency(inferredCatalogDefault)
        setAddCatalogCurrency(inferredCatalogDefault || (codes[0] ?? 'RUB'))
        const hiddenSaved = JSON.parse(localStorage.getItem(`hidden_catalog_kinds_${accountId}`) ?? '[]') as string[]
        setHiddenCatalogKinds(hiddenSaved)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [accountId])

  const handleCatalogDefaultCurrencyChange = (currency: string) => {
    setDefaultCatalogCurrency(currency)
    if (currency) {
      localStorage.setItem('catalog_section_currency', currency)
      setAddCatalogCurrency(currency)
    } else {
      localStorage.removeItem('catalog_section_currency')
    }
  }

  const handleCatalogApplyToAll = async () => {
    if (!defaultCatalogCurrency) return
    setIsApplyingCatalogToAll(true)
    const targets = catalogItems.filter((i) => i.size !== '')
    try {
      await Promise.all(targets.map((i) => updateConsumableCatalogItem(i.id, { currency: defaultCatalogCurrency })))
      setCatalogItems((prev) => prev.map((i) => i.size !== '' ? { ...i, currency: defaultCatalogCurrency } : i))
    } catch (e) { console.error(e) }
    finally { setIsApplyingCatalogToAll(false) }
  }

  const handleAddNewKind = async () => {
    if (!newKindName.trim()) return
    setIsAddingNewKind(true)
    try {
      const created = await addConsumableCatalogItem(accountId, newKindName.trim(), '')
      setCatalogItems((prev) => [...prev, created])
      setActiveCatalogKind(newKindName.trim())
      localStorage.setItem('catalog_active_kind', newKindName.trim())
      setNewKindName('')
      setAddingNewKind(false)
    } catch (e) { console.error(e) }
    finally { setIsAddingNewKind(false) }
  }

  const handleAddSizeForKind = async () => {
    if (!addSizeInput.trim()) return
    setIsAddingSize(true)
    try {
      const created = await addConsumableCatalogItem(accountId, activeCatalogKind, addSizeInput.trim(), Number(addCatalogPrice) || 0, Number(addCatalogCost) || 0, defaultCatalogCurrency || addCatalogCurrency)
      setCatalogItems((prev) => [...prev, created])
      setAddSizeInput('')
      setAddCatalogPrice('')
      setAddCatalogCost('')
    } catch (e) { console.error(e) }
    finally { setIsAddingSize(false) }
  }

  const startCatalogEdit = (item: ConsumableCatalogItem, field: 'price' | 'cost' = 'price') => {
    setEditingCatalogId(item.id)
    setEditCatalogParam(item.size)
    setEditCatalogPrice('')
    setEditCatalogCost('')
    setFocusCatalogField(field)
  }

  const saveCatalogValues = async (id: string) => {
    const current = catalogItems.find((i) => i.id === id)
    if (!current) return
    const patch = {
      size: editCatalogParam.trim() || current.size,
      price: editCatalogPrice.trim() === '' ? current.price : Number(editCatalogPrice),
      cost: editCatalogCost.trim() === '' ? current.cost : Number(editCatalogCost),
    }
    try {
      await updateConsumableCatalogItem(id, patch)
      setCatalogItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
    } catch (e) { console.error(e) }
  }

  const saveCatalogEdit = async (id: string) => {
    await saveCatalogValues(id)
    setEditingCatalogId(null)
  }

  const switchCatalogFocusField = async (newField: 'price' | 'cost', rowId: string) => {
    await saveCatalogValues(rowId)
    if (focusCatalogField === 'price') setEditCatalogPrice('')
    else if (focusCatalogField === 'cost') setEditCatalogCost('')
    setFocusCatalogField(newField)
  }

  const handleDeleteBase = async (id: string) => {
    try {
      await deleteConsumableCatalogItem(id)
      setCatalogItems((prev) => prev.filter((item) => item.id !== id))
    } catch (e) {
      console.error(e)
    }
  }

  const handleToggleHideKind = (kindLabel: string) => {
    const allKindLabels = [
      ...CONSUMABLE_KIND_OPTIONS.map(k => k.label),
      ...catalogItems
        .filter(item => item.size === '' && !CONSUMABLE_KIND_OPTIONS.some(k => k.label === item.kind))
        .map(item => item.kind)
        .filter((k, i, arr) => arr.indexOf(k) === i),
    ]
    setHiddenCatalogKinds(prev => {
      const isHiding = !prev.includes(kindLabel)
      const next = isHiding ? [...prev, kindLabel] : prev.filter(k => k !== kindLabel)
      localStorage.setItem(`hidden_catalog_kinds_${accountId}`, JSON.stringify(next))
      if (isHiding && activeCatalogKind === kindLabel) {
        const firstVisible = allKindLabels.find(k => !next.includes(k))
        if (firstVisible) {
          setActiveCatalogKind(firstVisible)
          localStorage.setItem('catalog_active_kind', firstVisible)
        }
      }
      return next
    })
  }

  const handleDeleteKind = async (kindLabel: string) => {
    setIsDeletingKind(true)
    try {
      const toDelete = catalogItems.filter(i => i.kind === kindLabel)
      await Promise.all(toDelete.map(i => deleteConsumableCatalogItem(i.id)))
      const updatedItems = catalogItems.filter(i => i.kind !== kindLabel)
      setCatalogItems(updatedItems)
      setHiddenCatalogKinds(prev => {
        const next = prev.filter(k => k !== kindLabel)
        localStorage.setItem(`hidden_catalog_kinds_${accountId}`, JSON.stringify(next))
        return next
      })
      if (activeCatalogKind === kindLabel) {
        const remainingKindLabels = [
          ...CONSUMABLE_KIND_OPTIONS.map(k => k.label),
          ...updatedItems
            .filter(i => i.size === '' && !CONSUMABLE_KIND_OPTIONS.some(k => k.label === i.kind))
            .map(i => i.kind)
            .filter((k, i, arr) => arr.indexOf(k) === i),
        ]
        const firstKind = remainingKindLabels[0] ?? CONSUMABLE_KIND_OPTIONS[0].label
        setActiveCatalogKind(firstKind)
        localStorage.setItem('catalog_active_kind', firstKind)
      }
      setKindDeleteConfirm(null)
    } catch (e) { console.error(e) }
    finally { setIsDeletingKind(false) }
  }

  return (
    <Card className="overflow-hidden rounded-3xl">
      {loading ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-400">Загрузка…</div>
      ) : (
        <>
          {(() => {
            const catalogKinds = [
              ...CONSUMABLE_KIND_OPTIONS,
              ...catalogItems
                .filter((item) => item.size === '' && !CONSUMABLE_KIND_OPTIONS.some((k) => k.label === item.kind))
                .map((item) => ({ id: item.kind, label: item.kind }))
                .filter((k, i, arr) => arr.findIndex((x) => x.id === k.id) === i),
            ]
            const visibleCatalogKinds = catalogKinds.filter(k => !hiddenCatalogKinds.includes(k.label))
            const sizeItems = catalogItems
              .filter((item) => item.kind === activeCatalogKind && item.size !== '')
              .sort((a, b) => {
                const numsA = a.size.split(/[xXхХ×]/).map(Number).filter((n) => !isNaN(n))
                const numsB = b.size.split(/[xXхХ×]/).map(Number).filter((n) => !isNaN(n))
                if (numsA.length > 0 && numsB.length > 0) {
                  for (let i = 0; i < Math.max(numsA.length, numsB.length); i++) {
                    const diff = (numsB[i] ?? 0) - (numsA[i] ?? 0)
                    if (diff !== 0) return diff
                  }
                }
                return b.size.localeCompare(a.size)
              })
            return (
              <>
                {/* Kind sub-tabs */}
                <div className="flex items-center bg-slate-50 px-4 py-2 border-b border-slate-100">
                  <div className="flex flex-wrap flex-1 items-center gap-0.5 overflow-x-auto">
                  {visibleCatalogKinds.map((kind) => {
                    const count = catalogItems.filter((item) => item.kind === kind.label && item.size !== '').length
                    return (
                      <button
                        key={kind.id}
                        type="button"
                        onClick={() => { setActiveCatalogKind(kind.label); localStorage.setItem('catalog_active_kind', kind.label); setEditingCatalogId(null) }}
                        className={`flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${activeCatalogKind === kind.label ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'}`}
                      >
                        {kind.label}
                        {count > 0 && (
                          <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${activeCatalogKind === kind.label ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-500'}`}>{count}</span>
                        )}
                      </button>
                    )
                  })}
                  {canManage && (
                    addingNewKind ? (
                      <div className="flex items-center gap-1 ml-1">
                        <input
                          type="text"
                          value={newKindName}
                          autoFocus
                          onChange={(e) => setNewKindName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') void handleAddNewKind(); if (e.key === 'Escape') { setAddingNewKind(false); setNewKindName('') } }}
                          placeholder="Вид расходника…"
                          className="rounded-lg border border-blue-300 bg-white px-2 py-1 text-xs outline-none focus:border-blue-400 w-36"
                        />
                        <button type="button" onClick={() => void handleAddNewKind()} disabled={isAddingNewKind || !newKindName.trim()} className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{isAddingNewKind ? '…' : 'OK'}</button>
                        <button type="button" onClick={() => { setAddingNewKind(false); setNewKindName('') }} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-slate-600">✕</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setAddingNewKind(true)} className="ml-1 flex-shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium text-blue-500 hover:text-blue-700 hover:bg-blue-50 transition-colors">+ Расходник</button>
                    )
                  )}
                  </div>
                  {canManage && (
                    <button type="button" onClick={() => setShowKindManageModal(true)} className="ml-2 flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors" title="Управление расходниками">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </button>
                  )}
                </div>
                {/* Section currency bar */}
                {canManage && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
                    <span className="text-xs text-slate-400">Валюта раздела:</span>
                    <select
                      value={defaultCatalogCurrency}
                      onChange={(e) => handleCatalogDefaultCurrencyChange(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                    >
                      <option value="">— не задано —</option>
                      {(enabledCurrencies.length > 0 ? enabledCurrencies : ['RUB']).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    {sizeItems.length > 0 && (
                      <button
                        type="button"
                        disabled={isApplyingCatalogToAll || !defaultCatalogCurrency}
                        onClick={() => void handleCatalogApplyToAll()}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50"
                      >
                        {isApplyingCatalogToAll ? '…' : `Применить ко всем (${sizeItems.length})`}
                      </button>
                    )}
                    <span className="ml-auto text-xs text-slate-300">Применяется к новым позициям автоматически</span>
                  </div>
                )}
                {/* Catalog table */}
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/60">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Параметр</th>
                      <th className="w-28 px-4 py-2 text-center">
                        <div className="text-xs font-medium text-slate-500">Цена</div>
                        <div className="text-[10px] font-normal text-slate-400">для заказчика</div>
                      </th>
                      <th className="w-28 px-4 py-2 text-center">
                        <div className="text-xs font-medium text-emerald-600">Себестоимость</div>
                        <div className="text-[10px] font-normal text-emerald-400">закупочная</div>
                      </th>
                      <th className="w-24 px-4 py-2 text-center text-xs font-medium text-slate-500">Валюта</th>
                      {canManage && <th className="w-[80px] px-4 py-2" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {canManage && (
                      <tr className="bg-slate-50/40">
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            placeholder="Добавить параметр…"
                            value={addSizeInput}
                            onChange={(e) => setAddSizeInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddSizeForKind() }}
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400 placeholder:text-slate-400"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number" min="0" step="any" placeholder="0"
                            value={addCatalogPrice}
                            onChange={(e) => setAddCatalogPrice(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddSizeForKind() }}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number" min="0" step="any" placeholder="0"
                            value={addCatalogCost}
                            onChange={(e) => setAddCatalogCost(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddSizeForKind() }}
                            className="w-full rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-center text-sm text-emerald-700 outline-none focus:border-emerald-400 placeholder:text-emerald-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        </td>
                        <td className="px-4 py-2 text-center">
                          {defaultCatalogCurrency ? (
                            <span className="rounded-md bg-amber-100 px-2 py-1.5 text-xs font-medium text-amber-700">{defaultCatalogCurrency}</span>
                          ) : (
                            <select
                              value={addCatalogCurrency}
                              onChange={(e) => setAddCatalogCurrency(e.target.value)}
                              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400"
                            >
                              {(enabledCurrencies.length > 0 ? enabledCurrencies : ['RUB']).map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => void handleAddSizeForKind()}
                            disabled={isAddingSize || !addSizeInput.trim()}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {isAddingSize ? '…' : '+ Добавить'}
                          </button>
                        </td>
                      </tr>
                    )}
                    {sizeItems.length === 0 ? (
                      <tr>
                        <td colSpan={canManage ? 5 : 4} className="py-8 text-center text-sm text-slate-400">Параметры не добавлены</td>
                      </tr>
                    ) : sizeItems.map((item) => {
                      const isEditing = editingCatalogId === item.id
                      const cellBase = canManage ? 'cursor-text' : ''
                      const viewCell = `px-4 py-1.5 ${cellBase}`
                      return (
                        <tr key={item.id} className="group hover:bg-slate-50" onBlur={(e) => { if (isEditing && !e.currentTarget.contains(e.relatedTarget as Node)) setEditingCatalogId(null) }}>
                          <td className="px-4 py-1.5">
                            <div className="rounded-lg px-2 py-1 text-sm text-slate-700">
                              {item.size}
                            </div>
                          </td>
                          <td className={viewCell}>
                            {isEditing && focusCatalogField === 'price' ? (
                              <input
                                type="number" min="0" step="any"
                                placeholder={String(item.price ?? 0)}
                                value={editCatalogPrice}
                                autoFocus
                                onChange={(e) => setEditCatalogPrice(e.target.value)}
                                onBlur={() => { void saveCatalogValues(item.id); setEditCatalogPrice('') }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { void saveCatalogEdit(item.id) } if (e.key === 'Escape') { setEditingCatalogId(null) } }}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              />
                            ) : (
                              <div
                                className="rounded-lg px-2 py-1 text-center text-sm font-medium text-slate-800 hover:bg-white hover:ring-1 hover:ring-slate-200"
                                onMouseDown={isEditing ? (e) => e.preventDefault() : undefined}
                                onClick={canManage ? (isEditing ? () => void switchCatalogFocusField('price', item.id) : () => startCatalogEdit(item, 'price')) : undefined}
                              >
                                {editCatalogPrice !== '' && isEditing ? editCatalogPrice : (item.price ?? 0)}
                              </div>
                            )}
                          </td>
                          <td className={viewCell}>
                            {isEditing && focusCatalogField === 'cost' ? (
                              <input
                                type="number" min="0" step="any"
                                placeholder={String(item.cost ?? 0)}
                                value={editCatalogCost}
                                autoFocus
                                onChange={(e) => setEditCatalogCost(e.target.value)}
                                onBlur={() => { void saveCatalogValues(item.id); setEditCatalogCost('') }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { void saveCatalogEdit(item.id) } if (e.key === 'Escape') { setEditingCatalogId(null) } }}
                                className="w-full rounded-lg border border-emerald-200 px-2 py-1 text-center text-sm text-emerald-700 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              />
                            ) : (
                              <div
                                className="rounded-lg px-2 py-1 text-center text-sm font-medium text-emerald-700 hover:bg-white hover:ring-1 hover:ring-emerald-200"
                                onMouseDown={isEditing ? (e) => e.preventDefault() : undefined}
                                onClick={canManage ? (isEditing ? () => void switchCatalogFocusField('cost', item.id) : () => startCatalogEdit(item, 'cost')) : undefined}
                              >
                                {editCatalogCost !== '' && isEditing ? editCatalogCost : (item.cost ?? 0)}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-1.5 text-center">
                            {defaultCatalogCurrency
                              ? <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{defaultCatalogCurrency}</span>
                              : <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{item.currency ?? 'RUB'}</span>
                            }
                          </td>
                          {canManage && (
                            <td className="px-4 py-1.5">
                              <div className="flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100">
                                <button type="button" onMouseDown={(e) => { e.preventDefault(); setEditingCatalogId(null) }} onClick={() => void handleDeleteBase(item.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500">
                                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            )
          })()}
          {canManage && showKindManageModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setShowKindManageModal(false); setKindDeleteConfirm(null) }}>
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-800">Управление расходниками</h3>
                  <button type="button" onClick={() => { setShowKindManageModal(false); setKindDeleteConfirm(null) }} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto py-1">
                  {[
                    ...CONSUMABLE_KIND_OPTIONS,
                    ...catalogItems
                      .filter((item) => item.size === '' && !CONSUMABLE_KIND_OPTIONS.some((k) => k.label === item.kind))
                      .map((item) => ({ id: item.kind, label: item.kind }))
                      .filter((k, i, arr) => arr.findIndex((x) => x.id === k.id) === i),
                  ].map(kind => {
                    const isSystem = CONSUMABLE_KIND_OPTIONS.some(k => k.label === kind.label)
                    const isHidden = hiddenCatalogKinds.includes(kind.label)
                    const count = catalogItems.filter(i => i.kind === kind.label && i.size !== '').length
                    return (
                      <div key={kind.id} className={`grid items-center gap-3 px-5 py-3 ${isHidden ? 'opacity-50' : ''}`} style={{ gridTemplateColumns: '1fr auto auto' }}>
                        <span className="min-w-0 truncate text-sm text-slate-700">
                          {kind.label}
                          {count > 0 && <span className="ml-1.5 text-xs text-slate-400">({count})</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleHideKind(kind.label)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${isHidden ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                        >
                          {isHidden ? 'Показать' : 'Скрыть'}
                        </button>
                        {isSystem ? (
                          <span className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400">системный</span>
                        ) : (
                          kindDeleteConfirm === kind.label ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-red-500">Удалить?</span>
                              <button type="button" disabled={isDeletingKind} onClick={() => void handleDeleteKind(kind.label)} className="rounded-lg bg-red-500 px-2 py-1 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50">{isDeletingKind ? '…' : 'Да'}</button>
                              <button type="button" onClick={() => setKindDeleteConfirm(null)} className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-slate-600">Нет</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setKindDeleteConfirm(kind.label)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">Удалить</button>
                          )
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </>
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
      { id: 'otk',        label: 'ОТК' },
      { id: 'packaging',  label: 'Упаковка' },
      { id: 'marking',    label: 'Маркировка' },
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
  sortedWarehouses,
}: {
  accountId: string
  canManage: boolean
  warehouses: Warehouse[]
  sortedWarehouses: Warehouse[]
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
  // virtual row editing (склад из каталога без тарифа)
  const [editingVirtualId, setEditingVirtualId] = useState<string | null>(null)
  const [vPrice, setVPrice] = useState('')
  const [vPriceKg, setVPriceKg] = useState('')
  const [vWorker, setVWorker] = useState('')
  const [vSenior, setVSenior] = useState('')
  const [vFocusField, setVFocusField] = useState<'price' | 'pricekg' | 'worker' | 'senior'>('price')

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

  // Переключение фокуса внутри строки: сохраняем + сбрасываем текущее поле
  const switchFocusField = async (newField: typeof focusField, rowId: string) => {
    await saveCurrentValues(rowId)
    if (focusField === 'price') setEditPrice('')
    else if (focusField === 'pricekg') setEditPricePerKg('')
    else if (focusField === 'worker') setEditPriceWorker('')
    else if (focusField === 'senior') setEditPriceSenior('')
    setFocusField(newField)
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

  // Объединённый список строк: склады из каталога (виртуальные) + реальные тарифы
  // sortedWarehouses приходит как prop (порядок синхронизирован через БД)
  const displayRows: Array<{ kind: 'tariff'; tariff: FulfillmentWorkTariff } | { kind: 'virtual'; warehouse: Warehouse }> = (() => {
    if (!isWarehouseStage) return stageTariffs.map(t => ({ kind: 'tariff' as const, tariff: t }))
    const result: Array<{ kind: 'tariff'; tariff: FulfillmentWorkTariff } | { kind: 'virtual'; warehouse: Warehouse }> = []
    for (const w of sortedWarehouses) {
      const existing = stageTariffs.find(t => t.name === w.name)
      if (existing) result.push({ kind: 'tariff', tariff: existing })
      else result.push({ kind: 'virtual', warehouse: w })
    }
    // Тарифы добавленные вручную, не совпадающие ни с одним складом
    for (const t of stageTariffs) {
      if (!sortedWarehouses.some(w => w.name === t.name)) result.push({ kind: 'tariff', tariff: t })
    }
    return result
  })()

  const startEditVirtual = (warehouseId: string, field: 'price' | 'pricekg' | 'worker' | 'senior' = 'price') => {
    setEditingId(null)
    setEditingVirtualId(warehouseId)
    setVPrice('')
    setVPriceKg('')
    setVWorker('')
    setVSenior('')
    setVFocusField(field)
  }

  const saveVirtualRow = async (warehouseName: string) => {
    if (vPrice === '' && vPriceKg === '' && vWorker === '' && vSenior === '') {
      setEditingVirtualId(null)
      return
    }
    const forcedCurrency = stageCurrencies[activeStage]
    try {
      const t = await addWorkTariff(
        accountId, activeStage,
        warehouseName,
        Number(vPrice) || 0,
        forcedCurrency || addCurrency,
        Number(vWorker) || 0,
        Number(vSenior) || 0,
        Number(vPriceKg) || 0,
      )
      setTariffs(prev => [...prev, t])
    } catch (e) {
      console.error(e)
    } finally {
      setEditingVirtualId(null)
    }
  }

  return (
    <Card className="overflow-hidden rounded-3xl">
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

      {/* Single table: header + add row + data rows all in one */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-400">Загрузка…</div>
      ) : (
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
              {!isWarehouseStage && (
                <th className="w-28 px-4 py-2 text-center">
                  <div className="text-xs font-medium text-blue-600">Старшему</div>
                  <div className="text-[10px] font-normal text-blue-400">цена / за единицу</div>
                </th>
              )}
              <th className="w-24 px-4 py-2 text-center text-xs font-medium text-slate-500">Валюта</th>
              {canManage && <th className="w-[120px] px-4 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {/* Add row */}
            {canManage && (
              <tr className="bg-slate-50/40">
                <td className="px-4 py-2">
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
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400 placeholder:text-slate-400"
                    />
                  )}
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number" min="0" step="any" placeholder="0"
                    value={addPrice}
                    onChange={(e) => setAddPrice(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
                    title="Заказчику / за короб"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </td>
                {isWarehouseStage && (
                  <td className="px-4 py-2">
                    <input
                      type="number" min="0" step="any" placeholder="0"
                      value={addPricePerKg}
                      onChange={(e) => setAddPricePerKg(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
                      title="Заказчику / за кг"
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </td>
                )}
                <td className="px-4 py-2">
                  <input
                    type="number" min="0" step="any" placeholder="0"
                    value={addPriceWorker}
                    onChange={(e) => setAddPriceWorker(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
                    title="Исполнителю"
                    className="w-full rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-center text-sm text-emerald-700 outline-none focus:border-emerald-400 placeholder:text-emerald-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </td>
                {!isWarehouseStage && (
                  <td className="px-4 py-2">
                    <input
                      type="number" min="0" step="any" placeholder="0"
                      value={addPriceSenior}
                      onChange={(e) => setAddPriceSenior(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
                      title="Старшему"
                      className="w-full rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-center text-sm text-blue-700 outline-none focus:border-blue-400 placeholder:text-blue-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                  </td>
                )}
                <td className="px-4 py-2 text-center">
                  {stageCurrencies[activeStage] ? (
                    <span className="rounded-md bg-amber-100 px-2 py-1.5 text-xs font-medium text-amber-700">{stageCurrencies[activeStage]}</span>
                  ) : (
                    <select
                      value={addCurrency}
                      onChange={(e) => setAddCurrency(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400"
                    >
                      {(enabledCurrencies.length > 0 ? enabledCurrencies : ['RUB']).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void handleAdd()}
                    disabled={isAdding || !addName.trim()}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isAdding ? '…' : '+ Добавить'}
                  </button>
                </td>
              </tr>
            )}
            {/* Data rows */}
            {displayRows.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="py-8 text-center text-sm text-slate-400">Нет тарифов в этом разделе</td>
              </tr>
            ) : (
                displayRows.map((row) => {
                  // ── Виртуальная строка (склад без тарифа) ──
                  if (row.kind === 'virtual') {
                    const w = row.warehouse
                    const isVEditing = editingVirtualId === w.id
                    const vCellBase = canManage ? 'cursor-text' : ''
                    const vViewCell = `px-4 py-1.5 ${vCellBase}`
                    return (
                      <tr
                        key={`virtual_${w.id}`}
                        className="group hover:bg-slate-50/70"
                        onBlur={(e) => { if (isVEditing && !e.currentTarget.contains(e.relatedTarget as Node)) void saveVirtualRow(w.name) }}
                      >
                        <td className={vViewCell}>
                          <div className="rounded-lg px-2 py-1 text-sm text-slate-400 italic">{w.name}</div>
                        </td>
                        <td className={vViewCell}>
                          {isVEditing && vFocusField === 'price' ? (
                            <input
                              type="number" min="0" step="any" placeholder="0"
                              value={vPrice} autoFocus
                              onChange={(e) => setVPrice(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void saveVirtualRow(w.name); if (e.key === 'Escape') setEditingVirtualId(null) }}
                              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          ) : (
                            <div
                              className="rounded-lg px-2 py-1 text-center text-sm font-medium text-slate-400 hover:bg-white hover:ring-1 hover:ring-slate-200"
                              onMouseDown={isVEditing ? (e) => e.preventDefault() : undefined}
                              onClick={canManage ? () => { isVEditing ? setVFocusField('price') : startEditVirtual(w.id, 'price') } : undefined}
                            >{vPrice !== '' && isVEditing ? vPrice : '—'}</div>
                          )}
                        </td>
                        {isWarehouseStage && (
                          <td className={vViewCell}>
                            {isVEditing && vFocusField === 'pricekg' ? (
                              <input
                                type="number" min="0" step="any" placeholder="0"
                                value={vPriceKg} autoFocus
                                onChange={(e) => setVPriceKg(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') void saveVirtualRow(w.name); if (e.key === 'Escape') setEditingVirtualId(null) }}
                                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              />
                            ) : (
                              <div
                                className="rounded-lg px-2 py-1 text-center text-sm font-medium text-slate-400 hover:bg-white hover:ring-1 hover:ring-slate-200"
                                onMouseDown={isVEditing ? (e) => e.preventDefault() : undefined}
                                onClick={canManage ? () => { isVEditing ? setVFocusField('pricekg') : startEditVirtual(w.id, 'pricekg') } : undefined}
                              >{vPriceKg !== '' && isVEditing ? vPriceKg : '—'}</div>
                            )}
                          </td>
                        )}
                        <td className={vViewCell}>
                          {isVEditing && vFocusField === 'worker' ? (
                            <input
                              type="number" min="0" step="any" placeholder="0"
                              value={vWorker} autoFocus
                              onChange={(e) => setVWorker(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void saveVirtualRow(w.name); if (e.key === 'Escape') setEditingVirtualId(null) }}
                              className="w-full rounded-lg border border-emerald-200 px-2 py-1 text-center text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          ) : (
                            <div
                              className="rounded-lg px-2 py-1 text-center text-sm font-medium text-emerald-600 hover:bg-white hover:ring-1 hover:ring-emerald-200"
                              onMouseDown={isVEditing ? (e) => e.preventDefault() : undefined}
                              onClick={canManage ? () => { isVEditing ? setVFocusField('worker') : startEditVirtual(w.id, 'worker') } : undefined}
                            >{vWorker !== '' && isVEditing ? vWorker : '—'}</div>
                          )}
                        </td>

                        <td className="px-4 py-1.5 text-center">
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400">
                            {stageCurrencies[activeStage] || addCurrency || 'RUB'}
                          </span>
                        </td>
                        {canManage && <td />}
                      </tr>
                    )
                  }

                  // ── Реальная строка тарифа ──
                  const t = row.tariff
                  const isEditing = editingId === t.id
                  const cellBase = canManage ? 'cursor-text' : ''
                  const viewCell = `px-4 py-1.5 ${cellBase}`
                  return (
                    <tr key={t.id} className="group hover:bg-slate-50" onBlur={(e) => { if (isEditing && !e.currentTarget.contains(e.relatedTarget as Node)) setEditingId(null) }}>
                      <td className={viewCell}>
                        <div className="px-2 py-1 text-sm text-slate-700">{t.name}</div>
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
                            onClick={canManage ? (isEditing ? () => void switchFocusField('price', t.id) : () => startEdit(t, 'price')) : undefined}
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
                              onClick={canManage ? (isEditing ? () => void switchFocusField('pricekg', t.id) : () => startEdit(t, 'pricekg')) : undefined}
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
                            onClick={canManage ? (isEditing ? () => void switchFocusField('worker', t.id) : () => startEdit(t, 'worker')) : undefined}
                          >{editPriceWorker !== '' && isEditing ? editPriceWorker : (t.price_worker ?? 0)}</div>
                        )}
                      </td>
                      {!isWarehouseStage && (
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
                              onClick={canManage ? (isEditing ? () => void switchFocusField('senior', t.id) : () => startEdit(t, 'senior')) : undefined}
                            >{editPriceSenior !== '' && isEditing ? editPriceSenior : (t.price_senior ?? 0)}</div>
                          )}
                        </td>
                      )}
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

  // ── Порядок складов (загружается из БД) ──────────────────────────
  const [wsSettings, setWsSettings] = useState<WarehouseOrderSettings>({ sort_mode: 'alpha', order_ids: [] })
  useEffect(() => {
    void fetchWarehouseSettings(accountId).then(s => setWsSettings(s))
  }, [accountId])

  const sortedWarehouses = useMemo(() => {
    if (wsSettings.sort_mode === 'custom') {
      const orderMap = new Map(wsSettings.order_ids.map((id, i) => [id, i]))
      return [...warehouses].sort((a, b) => (orderMap.get(a.id) ?? 999999) - (orderMap.get(b.id) ?? 999999))
    }
    return [...warehouses].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [wsSettings, warehouses])

  const handleWsSettingsChange = (next: WarehouseOrderSettings) => {
    setWsSettings(next)
    void saveWarehouseSettings(accountId, next)
  }
  const [tab, setTab] = useState<'dirs' | 'work' | 'consumables' | 'currencies'>(
    () => {
      const saved = localStorage.getItem('dirs_tab')
      if (saved === 'dirs' || saved === 'work' || saved === 'consumables' || saved === 'currencies') return saved
      return 'dirs'
    }
  )

  const handleTabChange = (key: 'dirs' | 'work' | 'consumables' | 'currencies') => {
    localStorage.setItem('dirs_tab', key)
    setTab(key)
  }

  const tabs = [
    { key: 'dirs' as const, label: 'Перевозчики и склады' },
    { key: 'work' as const, label: 'Тарифы работ' },
    { key: 'consumables' as const, label: 'Расходники' },
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
            sortMode={wsSettings.sort_mode}
            orderIds={wsSettings.order_ids}
            onSortChange={handleWsSettingsChange}
          />
        </div>
      )}

      {tab === 'work' && (
        <WorkTariffsPanel accountId={accountId} canManage={canManageTariffs} warehouses={warehouses} sortedWarehouses={sortedWarehouses} />
      )}

      {tab === 'consumables' && (
        <ConsumablesPanel accountId={accountId} canManage={canManageTariffs} />
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
