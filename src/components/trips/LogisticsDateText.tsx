import { useState } from 'react'
import { cn, formatDate } from '../../lib/utils'

type Props = {
  value: string | null | undefined
  manual?: boolean
  editable?: boolean
  onSave?: (isoDate: string) => void | Promise<void>
}

export const LogisticsDateText = ({ value, manual = false, editable = false, onSave }: Props) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!value) {
    return <span className="text-slate-300">—</span>
  }

  const open = () => {
    if (!editable || !onSave) return
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

  if (manual) {
    return (
      <button
        type="button"
        disabled={!editable}
        onClick={open}
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
          'bg-amber-50 text-amber-700',
          editable && 'hover:bg-amber-100',
        )}
      >
        {label}
      </button>
    )
  }

  if (editable) {
    return (
      <button type="button" onClick={open} className="text-[10px] text-slate-500 hover:text-slate-700">
        {label}
      </button>
    )
  }

  return <span className="text-[10px] text-slate-500">{label}</span>
}
