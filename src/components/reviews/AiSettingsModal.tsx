import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { cn } from '../../lib/utils'
import type {
  AiModel,
  AiPrompt,
  AiPromptFormValues,
  AiProvider,
  AiSettings,
  AiSettingsFormValues,
  AiTone,
  ClaudeModel,
} from '../../types'

interface AiSettingsModalProps {
  open: boolean
  initial: AiSettings | null
  initialStorePrompt: string
  systemPrompts: AiPrompt[]
  storePrompts: AiPrompt[]
  onClose: () => void
  onSubmit: (values: AiSettingsFormValues) => Promise<void>
  onSaveStorePrompt: (prompt: string) => Promise<void>
  onCreatePrompt: (type: 'system' | 'store', values: AiPromptFormValues) => Promise<AiPrompt>
  onUpdatePrompt: (id: string, values: AiPromptFormValues) => Promise<void>
  onDeletePrompt: (id: string) => Promise<void>
}

const OPENAI_MODEL_OPTIONS: { value: AiModel; label: string }[] = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini — быстро, дёшево (рекомендуется)' },
  { value: 'gpt-4o', label: 'GPT-4o — умнее, поддерживает фото' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
]

const CLAUDE_MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — умный, сбалансированный (рекомендуется)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — быстрый, дёшевый' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 — наиболее мощный, дорогой' },
]

const TONE_OPTIONS: { value: AiTone; label: string; desc: string }[] = [
  { value: 'polite', label: 'Вежливый', desc: 'Профессиональный и учтивый' },
  { value: 'neutral', label: 'Нейтральный', desc: 'Деловой, без эмоций' },
  { value: 'friendly', label: 'Дружелюбный', desc: 'Тёплый и располагающий' },
  { value: 'professional', label: 'Профессиональный', desc: 'Строго формальный' },
]

// ─── Модалка добавления/редактирования одного промпта ─────────
interface PromptAddEditModalProps {
  open: boolean
  title: string
  hint: string
  initial?: AiPromptFormValues
  onSave: (values: AiPromptFormValues) => Promise<void>
  onClose: () => void
}

const PromptAddEditModal = ({ open, title, hint, initial, onSave, onClose }: PromptAddEditModalProps) => {
  const [titleVal, setTitleVal] = useState('')
  const [content, setContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setTitleVal(initial?.title ?? '')
      setContent(initial?.content ?? '')
      setTimeout(() => {
        if (ref.current) {
          ref.current.style.height = 'auto'
          ref.current.style.height = Math.min(ref.current.scrollHeight, 400) + 'px'
          ref.current.focus()
        }
      }, 0)
    }
  }, [open, initial])

  if (!open) return null

  const handleSave = async () => {
    if (!content.trim()) return
    setIsSaving(true)
    try {
      await onSave({ title: titleVal, content })
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="relative flex w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-7 py-5">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="flex flex-col gap-4 px-7 py-6">
          <Input
            label="Название (необязательно)"
            placeholder="Например: Тон для негативных отзывов"
            value={titleVal}
            onChange={(e) => setTitleVal(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Содержимое промпта</label>
            <textarea
              ref={ref}
              value={content}
              onChange={(e) => {
                setContent(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 600) + 'px'
              }}
              placeholder="Введите текст промпта..."
              rows={12}
              className="w-full resize-none overflow-y-auto rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
              style={{ minHeight: '240px' }}
            />
            <p className="text-[11px] text-slate-400">{hint}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-7 py-5">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>Отмена</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!content.trim() || isSaving}>
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Модалка списка промптов ───────────────────────────────────
interface PromptListModalProps {
  open: boolean
  title: string
  hint: string
  prompts: AiPrompt[]
  onAdd: () => void
  onEdit: (prompt: AiPrompt) => void
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}

const PromptListModal = ({ open, title, hint, prompts, onAdd, onEdit, onDelete, onClose }: PromptListModalProps) => {
  const [deletingId, setDeletingId] = useState<string | null>(null)

  if (!open) return null

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try { await onDelete(id) } finally { setDeletingId(null) }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div className="relative flex w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl" style={{ maxHeight: '90vh', minHeight: '520px' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-7 py-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-600 transition">Закрыть</button>
        </div>
        <div className="flex-1 overflow-y-auto px-7 py-5 space-y-3">
          {prompts.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">Промптов нет. Нажмите «Добавить».</p>
          ) : prompts.map((p) => (
            <div key={p.id} className="flex items-start gap-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex-1 min-w-0">
                {p.title && <p className="text-sm font-semibold text-slate-800 mb-1">{p.title}</p>}
                <p className="text-sm text-slate-600 whitespace-pre-wrap break-words">{p.content}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                <button
                  type="button"
                  onClick={() => onEdit(p)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-blue-50 hover:text-blue-500"
                  title="Редактировать"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(p.id)}
                  disabled={deletingId === p.id}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
                  title="Удалить"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M9 4h6" /><path d="M5 7h14" />
                    <path d="M8 7v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" />
                    <path d="M10 11v4" /><path d="M14 11v4" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-200 px-7 py-5">
          <button
            type="button"
            onClick={onAdd}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
          >
            <span className="text-lg leading-none">+</span>
            Добавить промпт
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Устаревшая модалка — оставлена для совместимости ─────────
interface PromptModalProps {
  open: boolean
  title: string
  hint: string
  value: string
  onSave: (v: string) => void
  onClose: () => void
}

const PromptModal = ({ open, title, hint, value, onSave, onClose }: PromptModalProps) => {
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setDraft(value)
      // пересчёт высоты после рендера
      setTimeout(() => {
        if (ref.current) {
          ref.current.style.height = 'auto'
          ref.current.style.height = Math.min(ref.current.scrollHeight, 480) + 'px'
          ref.current.focus()
        }
      }, 0)
    }
  }, [open, value])

  if (!open) return null

  const handleSave = () => { onSave(draft); onClose() }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="relative flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="px-6 py-4">
          <textarea
            ref={ref}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 480) + 'px'
            }}
            placeholder="Оставьте пустым — будет использован стандартный промпт"
            rows={6}
            className="w-full resize-none overflow-y-auto rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
          />
          <p className="mt-1.5 text-[11px] text-slate-400">{hint}</p>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose}>Отмена</Button>
          <Button type="button" onClick={handleSave}>Сохранить</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Основная модалка настроек ────────────────────────────────
export const AiSettingsModal = ({ open, initial, initialStorePrompt, systemPrompts, storePrompts, onClose, onSubmit, onSaveStorePrompt, onCreatePrompt, onUpdatePrompt, onDeletePrompt }: AiSettingsModalProps) => {
  const [tab, setTab] = useState<AiProvider>('claude')
  const [activeProvider, setActiveProvider] = useState<AiProvider>('openai')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiKeyDeleted, setOpenaiKeyDeleted] = useState(false)
  const [model, setModel] = useState<AiModel>('gpt-4o-mini')
  const [claudeKey, setClaudeKey] = useState('')
  const [claudeKeyDeleted, setClaudeKeyDeleted] = useState(false)
  const [claudeModel, setClaudeModel] = useState<ClaudeModel>('claude-sonnet-4-6')
  const [tone, setTone] = useState<AiTone>('polite')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Prompt list modals
  const [systemListOpen, setSystemListOpen] = useState(false)
  const [storeListOpen, setStoreListOpen] = useState(false)
  // Add/edit modal
  const [addEditOpen, setAddEditOpen] = useState(false)
  const [addEditType, setAddEditType] = useState<'system' | 'store'>('system')
  const [editingPrompt, setEditingPrompt] = useState<AiPrompt | null>(null)
  // Unsaved changes guard
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setOpenaiKey('')
      setOpenaiKeyDeleted(false)
      setClaudeKey('')
      setClaudeKeyDeleted(false)
      setTab(initial?.provider ?? 'openai')
      setActiveProvider(initial?.provider ?? 'openai')
      setModel(initial?.model ?? 'gpt-4o-mini')
      setClaudeModel(initial?.claude_model ?? 'claude-sonnet-4-6')
      setTone(initial?.tone ?? 'polite')
      setError(null)
      setSystemListOpen(false)
      setStoreListOpen(false)
      setAddEditOpen(false)
      setConfirmCloseOpen(false)
    }
  }, [open, initial, initialStorePrompt])

  const isDirty =
    openaiKey !== '' ||
    openaiKeyDeleted ||
    claudeKey !== '' ||
    claudeKeyDeleted ||
    model !== (initial?.model ?? 'gpt-4o-mini') ||
    claudeModel !== (initial?.claude_model ?? 'claude-sonnet-4-6') ||
    tone !== (initial?.tone ?? 'polite') ||
    activeProvider !== (initial?.provider ?? 'openai')

  const handleClose = () => {
    if (isDirty) {
      setConfirmCloseOpen(true)
    } else {
      onClose()
    }
  }

  const openAddModal = (type: 'system' | 'store') => {
    setAddEditType(type)
    setEditingPrompt(null)
    setAddEditOpen(true)
  }

  const openEditModal = (prompt: AiPrompt) => {
    setAddEditType(prompt.type)
    setEditingPrompt(prompt)
    setAddEditOpen(true)
  }

  const handleSavePrompt = async (values: AiPromptFormValues) => {
    if (editingPrompt) {
      await onUpdatePrompt(editingPrompt.id, values)
    } else {
      await onCreatePrompt(addEditType, values)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setError(null)
    try {
      await onSubmit({
        provider: activeProvider,
        openai_key: openaiKeyDeleted ? '' : (openaiKey.trim() || initial?.openai_key || ''),
        model,
        claude_key: claudeKeyDeleted ? '' : (claudeKey.trim() || initial?.claude_key || ''),
        claude_model: claudeModel,
        tone,
        system_prompt: initial?.system_prompt ?? '',
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setIsSaving(false)
    }
  }

  const footer = (
    <div className="flex justify-end gap-3">
      <Button type="button" variant="secondary" onClick={handleClose} disabled={isSaving} form="ai-settings-form">
        Отмена
      </Button>
      <Button type="submit" disabled={isSaving} form="ai-settings-form">
        {isSaving ? 'Сохранение...' : 'Сохранить'}
      </Button>
    </div>
  )

  return (
    <>
      <Modal open={open} onClose={handleClose} title="Настройки ИИ-ответов" footer={footer}>
        <form id="ai-settings-form" className="grid gap-5" onSubmit={(e) => void handleSubmit(e)}>

          {/* Provider Tabs */}
          <div className="border-b border-slate-200">
            <div className="flex gap-0">
              {([
                { value: 'claude' as AiProvider, label: 'Claude', hasKey: !!initial?.claude_key },
                { value: 'openai' as AiProvider, label: 'OpenAI', hasKey: !!initial?.openai_key },
              ] as const).map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => { setTab(t.value); setError(null) }}
                  className={cn(
                    'relative flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium transition-colors',
                    tab === t.value
                      ? 'text-blue-600 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-500'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {t.label}
                  {t.hasKey && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Ключ настроен" />
                  )}
                  {activeProvider === t.value && (
                    <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-blue-600">
                      активный
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Provider content — оба рендерятся, неактивный invisible, чтобы высота не прыгала */}
          <div className="grid [&>*]:[grid-area:1/1]">
            {/* OpenAI settings */}
            <div className={cn('grid gap-5', tab !== 'openai' && 'invisible pointer-events-none select-none')}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-slate-400">Настройки OpenAI. Настройки обоих ИИ сохраняются.</p>
                <button
                  type="button"
                  onClick={() => setActiveProvider('openai')}
                  disabled={activeProvider === 'openai'}
                  className={cn(
                    'rounded-lg border px-3 py-1 text-xs font-medium transition',
                    activeProvider === 'openai'
                      ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-default'
                      : 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100',
                  )}
                >
                  Активировать
                </button>
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-slate-700">OpenAI API-ключ</label>
                {initial?.openai_key && !openaiKey && !openaiKeyDeleted && (
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm">
                    <span className="flex-1 font-mono tracking-widest text-slate-500">{'•'.repeat(32)}</span>
                    <button type="button" onClick={() => setOpenaiKeyDeleted(true)} className="shrink-0 text-xs font-medium text-rose-500 hover:underline">
                      Удалить
                    </button>
                  </div>
                )}
                {openaiKeyDeleted && (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm">
                    <span className="flex-1 text-rose-600">Ключ будет удалён при сохранении</span>
                    <button type="button" onClick={() => setOpenaiKeyDeleted(false)} className="shrink-0 text-xs font-medium text-slate-500 hover:underline">
                      Отменить
                    </button>
                  </div>
                )}
                {(!initial?.openai_key || openaiKey) && !openaiKeyDeleted && (
                  <input
                    type="password"
                    value={openaiKey.trim() === '' && openaiKey.length > 0 ? '' : openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-proj-..."
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                  />
                )}
                <p className="text-[11px] text-slate-400">
                  Получите ключ на{' '}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">
                    platform.openai.com
                  </a>
                </p>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700">Модель</label>
                {OPENAI_MODEL_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors',
                      model === opt.value ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300',
                    )}
                  >
                    <input type="radio" name="ai-model" value={opt.value} checked={model === opt.value} onChange={() => setModel(opt.value)} className="accent-blue-500" />
                    <span className="text-sm text-slate-800">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Claude settings */}
            <div className={cn('grid gap-5', tab !== 'claude' && 'invisible pointer-events-none select-none')}>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-slate-400">Настройки Claude. Настройки обоих ИИ сохраняются.</p>
                <button
                  type="button"
                  onClick={() => setActiveProvider('claude')}
                  disabled={activeProvider === 'claude'}
                  className={cn(
                    'rounded-lg border px-3 py-1 text-xs font-medium transition',
                    activeProvider === 'claude'
                      ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-default'
                      : 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100',
                  )}
                >
                  Активировать
                </button>
              </div>
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-slate-700">Claude API-ключ</label>
                {initial?.claude_key && !claudeKey && !claudeKeyDeleted && (
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm">
                    <span className="flex-1 font-mono tracking-widest text-slate-500">{'•'.repeat(32)}</span>
                    <button type="button" onClick={() => setClaudeKeyDeleted(true)} className="shrink-0 text-xs font-medium text-rose-500 hover:underline">
                      Удалить
                    </button>
                  </div>
                )}
                {claudeKeyDeleted && (
                  <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm">
                    <span className="flex-1 text-rose-600">Ключ будет удалён при сохранении</span>
                    <button type="button" onClick={() => setClaudeKeyDeleted(false)} className="shrink-0 text-xs font-medium text-slate-500 hover:underline">
                      Отменить
                    </button>
                  </div>
                )}
                {(!initial?.claude_key || claudeKey) && !claudeKeyDeleted && (
                  <input
                    type="password"
                    value={claudeKey.trim() === '' && claudeKey.length > 0 ? '' : claudeKey}
                    onChange={(e) => setClaudeKey(e.target.value)}
                    placeholder="sk-ant-..."
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                  />
                )}
                <p className="text-[11px] text-slate-400">
                  Получите ключ на{' '}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">
                    console.anthropic.com
                  </a>
                </p>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700">Модель</label>
                {CLAUDE_MODEL_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors',
                      claudeModel === opt.value ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300',
                    )}
                  >
                    <input type="radio" name="claude-model" value={opt.value} checked={claudeModel === opt.value} onChange={() => setClaudeModel(opt.value)} className="accent-blue-500" />
                    <span className="text-sm text-slate-800">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Tone — shared */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium text-slate-700">Тон ответов</label>
            <div className="flex gap-2">
              {TONE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTone(opt.value)}
                  title={opt.desc}
                  className={cn(
                    'flex-1 rounded-xl border px-3 py-2 text-sm transition-colors',
                    tone === opt.value
                      ? 'border-blue-300 bg-blue-50 font-semibold text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt buttons — shared */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium text-slate-700">Промпты</label>
            <div className="flex gap-2">
              {/* System prompt */}
              <div className="flex flex-1 overflow-hidden rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setSystemListOpen(true)}
                  className="flex flex-1 items-center gap-2 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 text-left"
                >
                  <span>Системный промпт</span>
                  {systemPrompts.length > 0 && (
                    <span className="ml-auto rounded-full bg-blue-100 px-1.5 py-px text-xs font-medium text-blue-600">{systemPrompts.length}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => openAddModal('system')}
                  title="Добавить системный промпт"
                  className="flex items-center justify-center border-l border-slate-200 bg-slate-50 px-3 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
              {/* Store prompt */}
              <div className="flex flex-1 overflow-hidden rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setStoreListOpen(true)}
                  className="flex flex-1 items-center gap-2 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 text-left"
                >
                  <span>Промпт магазина</span>
                  {storePrompts.length > 0 && (
                    <span className="ml-auto rounded-full bg-blue-100 px-1.5 py-px text-xs font-medium text-blue-600">{storePrompts.length}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => openAddModal('store')}
                  title="Добавить промпт магазина"
                  className="flex items-center justify-center border-l border-slate-200 bg-slate-50 px-3 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        </form>
      </Modal>

      <PromptListModal
        open={systemListOpen}
        title="Системный промпт"
        hint="Добавляется первым. Если указан — заменяет стандартный промпт ИИ."
        prompts={systemPrompts}
        onAdd={() => openAddModal('system')}
        onEdit={openEditModal}
        onDelete={onDeletePrompt}
        onClose={() => setSystemListOpen(false)}
      />

      <PromptListModal
        open={storeListOpen}
        title="Промпт магазина"
        hint="Добавляется после системного. Принадлежит только текущему магазину."
        prompts={storePrompts}
        onAdd={() => openAddModal('store')}
        onEdit={openEditModal}
        onDelete={onDeletePrompt}
        onClose={() => setStoreListOpen(false)}
      />

      <PromptAddEditModal
        open={addEditOpen}
        title={editingPrompt ? 'Редактировать промпт' : (addEditType === 'system' ? 'Добавить системный промпт' : 'Добавить промпт магазина')}
        hint={addEditType === 'system'
          ? 'Если указан — полностью заменяет стандартный промпт. ИИ читает его первым.'
          : 'Добавляется после системного промпта. ИИ читает его вторым.'}
        initial={editingPrompt ? { title: editingPrompt.title, content: editingPrompt.content } : undefined}
        onSave={handleSavePrompt}
        onClose={() => setAddEditOpen(false)}
      />

      {confirmCloseOpen && (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Закрыть без сохранения?</h3>
            <p className="mt-1.5 text-sm text-slate-500">Изменения не будут сохранены.</p>
            <div className="mt-5 flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setConfirmCloseOpen(false)}>
                Продолжить редактирование
              </Button>
              <button
                type="button"
                onClick={() => { setConfirmCloseOpen(false); onClose() }}
                className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-600"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

