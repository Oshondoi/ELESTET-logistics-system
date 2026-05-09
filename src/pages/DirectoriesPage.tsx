import { useEffect, useState } from 'react'
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

// ── Модалка редактирования перевозчика ────────────────────────────

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

const WorkTariffsPanel = ({
  accountId,
  canManage,
}: {
  accountId: string
  canManage: boolean
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
  const [isAdding, setIsAdding] = useState(false)
  // edit tariff
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState('')
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

  const handleAdd = async () => {
    if (!addName.trim()) return
    setIsAdding(true)
    try {
      const t = await addWorkTariff(accountId, activeStage, addName.trim(), Number(addPrice) || 0, stageCurrencies[activeStage] || addCurrency)
      setTariffs((prev) => [...prev, t])
      setAddName('')
      setAddPrice('')
    } catch (e) {
      console.error(e)
    } finally {
      setIsAdding(false)
    }
  }

  const startEdit = (t: FulfillmentWorkTariff) => {
    setEditingId(t.id)
    setEditName(t.name)
    setEditPrice(String(t.price_per_unit))
    setEditCurrency(t.currency ?? 'RUB')
  }

  const saveEdit = async (id: string) => {
    const forcedCurrency = stageCurrencies[activeStage]
    const patch = { name: editName.trim(), price_per_unit: Number(editPrice) || 0, currency: forcedCurrency || editCurrency }
    try {
      await updateWorkTariff(id, patch)
      setTariffs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    } catch (e) {
      console.error(e)
    }
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
        <p className="mt-0.5 text-xs text-slate-400">Расценки за единицу по каждому виду работ</p>
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

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-400">Загрузка…</div>
      ) : (
        <>
          {stageTariffs.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-slate-400">
              Нет тарифов в этом разделе
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50/60">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">Название тарифа</th>
                  <th className="w-32 px-4 py-2 text-center text-xs font-medium text-slate-500">Цена за ед</th>
                  <th className="w-24 px-4 py-2 text-center text-xs font-medium text-slate-500">Валюта</th>
                  {canManage && <th className="w-20 px-4 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stageTariffs.map((t) => {
                  const isEditing = editingId === t.id
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(t.id) }}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-400"
                          />
                        ) : (
                          <span className="text-slate-700">{t.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(t.id) }}
                            className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                        ) : (
                          <span className="font-medium text-slate-800">{t.price_per_unit}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {isEditing ? (
                          stageCurrencies[activeStage] ? (
                            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{stageCurrencies[activeStage]}</span>
                          ) : (
                            <select
                              value={editCurrency}
                              onChange={(e) => setEditCurrency(e.target.value)}
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
                        <td className="px-4 py-2">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => void saveEdit(t.id)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50"
                              >
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
                              >
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => startEdit(t)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-blue-50 hover:text-blue-500"
                              >
                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(t)}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:bg-red-50 hover:text-red-500"
                              >
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* Add tariff row */}
          {canManage && (
            <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/40 px-4 py-2">
              <input
                type="text"
                placeholder="Название тарифа"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400 placeholder:text-slate-400"
              />
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={addPrice}
                onChange={(e) => setAddPrice(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
                className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
          <DirectoryPanel
            title="Склады назначения"
            items={warehouses}
            onAdd={onAddWarehouse}
            onDelete={onDeleteWarehouse}
            onUpdate={onRenameWarehouse}
            canManage={canManage}
            canDelete={canDelete}
          />
        </div>
      )}

      {tab === 'work' && (
        <WorkTariffsPanel accountId={accountId} canManage={canManage} />
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
