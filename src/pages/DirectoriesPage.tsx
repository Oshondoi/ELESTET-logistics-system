import { useState } from 'react'
import type { Carrier, Warehouse } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'

interface DirectoryPanelProps {
  title: string
  items: Array<{ id: string; name: string }>
  onAdd: (name: string) => Promise<unknown>
  onDelete: (id: string) => Promise<void>
}

const DirectoryPanel = ({ title, items, onAdd, onDelete }: DirectoryPanelProps) => {
  const [inputValue, setInputValue] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

        {items.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                <span>{item.name}</span>
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
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center justify-center py-8 text-sm text-slate-400">
            Список пуст
          </div>
        )}

        <form onSubmit={(e) => void handleAdd(e)} className="flex gap-2 border-t border-slate-100 px-4 py-3">
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
        {addError && <p className="px-4 pb-3 text-xs text-rose-500">{addError}</p>}
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

interface DirectoriesPageProps {
  carriers: Carrier[]
  warehouses: Warehouse[]
  onAddCarrier: (name: string) => Promise<unknown>
  onDeleteCarrier: (id: string) => Promise<void>
  onAddWarehouse: (name: string) => Promise<unknown>
  onDeleteWarehouse: (id: string) => Promise<void>
}

export const DirectoriesPage = ({
  carriers,
  warehouses,
  onAddCarrier,
  onDeleteCarrier,
  onAddWarehouse,
  onDeleteWarehouse,
}: DirectoriesPageProps) => (
  <div className="space-y-4">
    <div className="grid gap-4 lg:grid-cols-2">
      <DirectoryPanel
        title="Перевозчики"
        items={carriers}
        onAdd={onAddCarrier}
        onDelete={onDeleteCarrier}
      />
      <DirectoryPanel
        title="Склады назначения"
        items={warehouses}
        onAdd={onAddWarehouse}
        onDelete={onDeleteWarehouse}
      />
    </div>
  </div>
)
