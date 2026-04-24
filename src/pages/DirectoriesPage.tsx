import { useState } from 'react'
import type { Carrier, Warehouse } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'

interface DirectoryPanelProps {
  title: string
  items: Array<{ id: string; name: string; is_system?: boolean }>
  onAdd: (name: string) => Promise<unknown>
  onDelete: (id: string) => Promise<void>
  onUpdate: (id: string, name: string) => Promise<void>
  canManage?: boolean
}

const DirectoryPanel = ({ title, items, onAdd, onDelete, onUpdate, canManage = true }: DirectoryPanelProps) => {
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

interface DirectoriesPageProps {
  carriers: Carrier[]
  warehouses: Warehouse[]
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
  onAddCarrier,
  onDeleteCarrier,
  onRenameCarrier,
  onAddWarehouse,
  onDeleteWarehouse,
  onRenameWarehouse,
  canManage = true,
}: DirectoriesPageProps) => (
  <div className="space-y-4">
    <div className="grid gap-4 lg:grid-cols-2">
      <DirectoryPanel
        title="Перевозчики"
        items={carriers}
        onAdd={onAddCarrier}
        onDelete={onDeleteCarrier}
        onUpdate={onRenameCarrier}
        canManage={canManage}
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
  </div>
)
