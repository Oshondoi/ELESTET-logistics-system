import { useEffect, useState } from 'react'
import type { Carrier, Warehouse } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import {
  fetchCarrierTariffs,
  upsertCarrierTariff,
  fetchWbUnloadTariffs,
  upsertWbUnloadTariff,
} from '../services/directoriesService'

interface DirectoryPanelProps {
  title: string
  items: Array<{ id: string; name: string; is_system?: boolean }>
  onAdd: (name: string) => Promise<unknown>
  onDelete: (id: string) => Promise<void>
  onUpdate: (id: string, name: string) => Promise<void>
  canManage?: boolean
  onTariff?: (id: string, name: string) => void
}

const DirectoryPanel = ({ title, items, onAdd, onDelete, onUpdate, canManage = true, onTariff }: DirectoryPanelProps) => {
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
                          onClick={() => startEdit(item)}
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
                          className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
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
  }

  const toggleOne = (id: string) =>
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }))

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
                        placeholder="—"
                        value={values[wh.id]?.box ?? ''}
                        onChange={(e) => setValue(wh.id, 'box', e.target.value)}
                        onBlur={() => void handleBlur(wh.id)}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm text-slate-900 outline-none focus:border-blue-400"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="—"
                        value={values[wh.id]?.kg ?? ''}
                        onChange={(e) => setValue(wh.id, 'kg', e.target.value)}
                        onBlur={() => void handleBlur(wh.id)}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-sm text-slate-900 outline-none focus:border-blue-400"
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

// ── Страница справочников ─────────────────────────────────────────

interface DirectoriesPageProps {
  carriers: Carrier[]
  warehouses: Warehouse[]
  accountId: string
  onAddCarrier: (name: string) => Promise<unknown>
  onDeleteCarrier: (id: string) => Promise<void>
  onRenameCarrier: (id: string, name: string) => Promise<void>
  onAddWarehouse: (name: string) => Promise<unknown>
  onDeleteWarehouse: (id: string) => Promise<void>
  onRenameWarehouse: (id: string, name: string) => Promise<void>
  canManage?: boolean
}

export const DirectoriesPage = ({
  carriers,
  warehouses,
  accountId,
  onAddCarrier,
  onDeleteCarrier,
  onRenameCarrier,
  onAddWarehouse,
  onDeleteWarehouse,
  onRenameWarehouse,
  canManage = true,
}: DirectoriesPageProps) => {
  const [tariffCarrier, setTariffCarrier] = useState<Carrier | null>(null)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <DirectoryPanel
          title="Перевозчики"
          items={carriers}
          onAdd={onAddCarrier}
          onDelete={onDeleteCarrier}
          onUpdate={onRenameCarrier}
          canManage={canManage}
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
        />
      </div>

      <WbUnloadTariffsPanel warehouses={warehouses} accountId={accountId} />

      {tariffCarrier && (
        <CarrierTariffModal
          carrier={tariffCarrier}
          warehouses={warehouses}
          accountId={accountId}
          onClose={() => setTariffCarrier(null)}
        />
      )}
    </div>
  )
}
