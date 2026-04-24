import { useState, useId } from 'react'
import {
  ColumnConfig,
  CustomColDef,
  BUILTIN_TRIP_COLS,
  BUILTIN_LINE_COLS,
} from '../../services/columnConfigService'
import { cn } from '../../lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  tripConfig: ColumnConfig
  lineConfig: ColumnConfig
  onSave: (tripConfig: ColumnConfig, lineConfig: ColumnConfig) => Promise<void>
}

type Tab = 'trip' | 'line'
type ColType = CustomColDef['type']

const COL_TYPE_LABELS: Record<ColType, string> = {
  text: 'Текст',
  number: 'Число',
  date: 'Дата',
  boolean: 'Да/Нет',
}

function useConfigDraft(initial: ColumnConfig) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initial.hiddenBuiltin))
  const [customCols, setCustomCols] = useState<CustomColDef[]>(() =>
    [...initial.customCols].sort((a, b) => a.position - b.position),
  )

  const toggleBuiltin = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const addCol = (col: Omit<CustomColDef, 'key' | 'position'>) =>
    setCustomCols((prev) => [
      ...prev,
      { ...col, key: `custom_${Date.now()}`, position: prev.length },
    ])

  const updateCol = (key: string, col: Omit<CustomColDef, 'key' | 'position'>) =>
    setCustomCols((prev) => prev.map((c) => (c.key === key ? { ...c, ...col } : c)))

  const removeCol = (key: string) =>
    setCustomCols((prev) => prev.filter((c) => c.key !== key))

  const toConfig = (): ColumnConfig => ({
    hiddenBuiltin: [...hidden],
    customCols: customCols.map((c, i) => ({ ...c, position: i })),
  })

  return { hidden, toggleBuiltin, customCols, addCol, updateCol, removeCol, toConfig }
}

interface ColFormState {
  name: string
  type: ColType
}

function CustomColForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: ColFormState
  onSubmit: (v: ColFormState) => void
  onCancel: () => void
  submitLabel: string
}) {
  const nameId = useId()
  const typeId = useId()
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<ColType>(initial?.type ?? 'text')

  return (
    <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor={nameId} className="w-20 shrink-0 text-xs text-slate-500">
            Название
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название колонки"
            className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            autoFocus
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={typeId} className="w-20 shrink-0 text-xs text-slate-500">
            Тип данных
          </label>
          <select
            id={typeId}
            value={type}
            onChange={(e) => setType(e.target.value as ColType)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
          >
            {(Object.keys(COL_TYPE_LABELS) as ColType[]).map((t) => (
              <option key={t} value={t}>
                {COL_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => onSubmit({ name: name.trim(), type })}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabContent({
  builtinCols,
  draft,
}: {
  builtinCols: typeof BUILTIN_TRIP_COLS | typeof BUILTIN_LINE_COLS
  draft: ReturnType<typeof useConfigDraft>
}) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-5">
      {/* Встроенные колонки */}
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Системные колонки
        </p>
        <div className="flex flex-col gap-1">
          {builtinCols.map((col) => {
            const visible = !draft.hidden.has(col.key)
            return (
              <label
                key={col.key}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition hover:bg-slate-50"
              >
                <span
                  role="checkbox"
                  aria-checked={visible}
                  tabIndex={0}
                  onClick={() => draft.toggleBuiltin(col.key)}
                  onKeyDown={(e) => e.key === ' ' && draft.toggleBuiltin(col.key)}
                  className={cn(
                    'relative h-4 w-4 shrink-0 cursor-pointer rounded border transition',
                    visible
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-slate-300 bg-white',
                  )}
                >
                  {visible && (
                    <svg
                      viewBox="0 0 24 24"
                      className="absolute inset-0 h-full w-full text-white"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                <span className="text-sm text-slate-700">{col.label}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* Пользовательские колонки */}
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Пользовательские колонки
        </p>
        <div className="flex flex-col gap-1">
          {draft.customCols.length === 0 && !showAddForm && (
            <p className="px-3 text-sm text-slate-400">Нет пользовательских колонок</p>
          )}
          {draft.customCols.map((col) => (
            <div key={col.key}>
              {editingKey === col.key ? (
                <CustomColForm
                  initial={{ name: col.name, type: col.type }}
                  onSubmit={(v) => {
                    draft.updateCol(col.key, v)
                    setEditingKey(null)
                  }}
                  onCancel={() => setEditingKey(null)}
                  submitLabel="Сохранить"
                />
              ) : (
                <div className="flex items-center gap-2 rounded-xl px-3 py-2 transition hover:bg-slate-50">
                  <span className="flex-1 text-sm text-slate-700">{col.name}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {COL_TYPE_LABELS[col.type]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingKey(col.key)}
                    className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-blue-50 hover:text-blue-500"
                    aria-label="Редактировать колонку"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => draft.removeCol(col.key)}
                    className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                    aria-label="Удалить колонку"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}
          {showAddForm ? (
            <CustomColForm
              onSubmit={(v) => {
                draft.addCol(v)
                setShowAddForm(false)
              }}
              onCancel={() => setShowAddForm(false)}
              submitLabel="Добавить"
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="mt-1 flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-blue-500 transition hover:bg-blue-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Добавить колонку
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ColumnSettingsModal({ open, onClose, tripConfig, lineConfig, onSave }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('trip')
  const [saving, setSaving] = useState(false)

  const tripDraft = useConfigDraft(tripConfig)
  const lineDraft = useConfigDraft(lineConfig)

  if (!open) return null

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(tripDraft.toConfig(), lineDraft.toConfig())
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">Настройка колонок</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-100 px-5 pt-3">
          {([['trip', 'Рейс'], ['line', 'Поставка']] as [Tab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                'rounded-t-lg px-4 py-2 text-sm font-medium transition',
                activeTab === tab
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'trip' ? (
            <TabContent builtinCols={BUILTIN_TRIP_COLS} draft={tripDraft} />
          ) : (
            <TabContent builtinCols={BUILTIN_LINE_COLS} draft={lineDraft} />
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-60"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}
