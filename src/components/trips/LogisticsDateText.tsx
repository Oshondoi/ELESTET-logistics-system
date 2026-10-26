import { useState } from 'react'
import { cn, formatDate } from '../../lib/utils'

type Props = {
  value: string | null | undefined
  /** Ручная правка пользователем — оранжевая плашка */
  manual?: boolean
  /** Дата с WB (только чтение) — синяя плашка, как у автоматических */
  fromWb?: boolean
  editable?: boolean
  onSave?: (isoDate: string) => void | Promise<void>
}

const pillClass = (manual: boolean, editable: boolean) =>
  cn(
    'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
    manual
      ? cn('bg-amber-50 text-amber-700', editable && 'hover:bg-amber-100')
      : cn('bg-blue-50 text-blue-700', editable && 'hover:bg-blue-100'),
  )

export const LogisticsDateText = ({
  value,
  manual = false,
  fromWb = false,
  editable = false,
  onSave,
}: Props) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!value) {
    return <span className="text-slate-300">—</span>
  }

  const readOnly = fromWb || !editable || !onSave
  const isManual = manual && !fromWb

  const open = () => {
    if (readOnly) return
    setDraft(value.slice(0, 10))
    setEditing(true)
  }

  const save = async () => {
    if (!onSave || !draft) {
      setEditing(false)
      return
    }
    await onSave(draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        type="date"
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save()
          if (event.key === 'Escape') setEditing(false)
        }}
        className="w-[108px] rounded-lg border border-slate-200 px-1.5 py-0.5 text-[10px]"
      />
    )
  }

  const label = formatDate(value)

  if (readOnly) {
    return <span className={pillClass(isManual, false)}>{label}</span>
  }

  return (
    <button type="button" onClick={open} className={pillClass(isManual, true)}>
      {label}
    </button>
  )
}
