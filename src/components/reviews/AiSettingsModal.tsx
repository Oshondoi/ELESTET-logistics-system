import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { cn } from '../../lib/utils'
import type {
  AiModel,
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
  onClose: () => void
  onSubmit: (values: AiSettingsFormValues) => Promise<void>
  onSaveStorePrompt: (prompt: string) => Promise<void>
}

const OPENAI_MODEL_OPTIONS: { value: AiModel; label: string }[] = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini — быстро, дёшево (рекомендуется)' },
  { value: 'gpt-4o', label: 'GPT-4o — умнее, поддерживает фото' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
]

const CLAUDE_MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet — умный, сбалансированный, поддерживает фото (рекомендуется)' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku — быстрый, дёшевый, поддерживает фото' },
  { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus — наиболее мощный, дорогой, поддерживает фото' },
]

const TONE_OPTIONS: { value: AiTone; label: string; desc: string }[] = [
  { value: 'polite', label: 'Вежливый', desc: 'Профессиональный и учтивый' },
  { value: 'neutral', label: 'Нейтральный', desc: 'Деловой, без эмоций' },
  { value: 'friendly', label: 'Дружелюбный', desc: 'Тёплый и располагающий' },
  { value: 'professional', label: 'Профессиональный', desc: 'Строго формальный' },
]

// ─── Переиспользуемая модалка промпта (с черновиком) ──────────
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
export const AiSettingsModal = ({ open, initial, initialStorePrompt, onClose, onSubmit, onSaveStorePrompt }: AiSettingsModalProps) => {
  const [tab, setTab] = useState<AiProvider>('claude')
  const [activeProvider, setActiveProvider] = useState<AiProvider>('openai')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiKeyDeleted, setOpenaiKeyDeleted] = useState(false)
  const [model, setModel] = useState<AiModel>('gpt-4o-mini')
  const [claudeKey, setClaudeKey] = useState('')
  const [claudeKeyDeleted, setClaudeKeyDeleted] = useState(false)
  const [claudeModel, setClaudeModel] = useState<ClaudeModel>('claude-3-5-sonnet-20241022')
  const [tone, setTone] = useState<AiTone>('polite')
  const [prompt, setPrompt] = useState('')
  const [storePrompt, setStorePrompt] = useState('')
  const [systemPromptOpen, setSystemPromptOpen] = useState(false)
  const [storePromptOpen, setStorePromptOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setOpenaiKey('')
      setOpenaiKeyDeleted(false)
      setClaudeKey('')
      setClaudeKeyDeleted(false)
      setTab(initial?.provider ?? 'openai')
      setActiveProvider(initial?.provider ?? 'openai')
      setModel(initial?.model ?? 'gpt-4o-mini')
      setClaudeModel(initial?.claude_model ?? 'claude-3-5-sonnet-20241022')
      setTone(initial?.tone ?? 'polite')
      setPrompt(initial?.system_prompt ?? '')
      setStorePrompt(initialStorePrompt)
      setError(null)
      setSystemPromptOpen(false)
      setStorePromptOpen(false)
    }
  }, [open, initial, initialStorePrompt])

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
        system_prompt: prompt,
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
      <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving} form="ai-settings-form">
        Отмена
      </Button>
      <Button type="submit" disabled={isSaving} form="ai-settings-form">
        {isSaving ? 'Сохранение...' : 'Сохранить'}
      </Button>
    </div>
  )

  return (
    <>
      <Modal open={open} onClose={onClose} title="Настройки ИИ-ответов" footer={footer}>
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
              <button
                type="button"
                onClick={() => setSystemPromptOpen(true)}
                className="flex flex-1 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 text-left"
              >
                Системный промпт
              </button>
              <button
                type="button"
                onClick={() => setStorePromptOpen(true)}
                className="flex flex-1 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 text-left"
              >
                Промпт магазина
              </button>
            </div>
          </div>

          {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        </form>
      </Modal>

      <PromptModal
        open={systemPromptOpen}
        title="Системный промпт"
        hint="Если указать — полностью заменяет стандартный промпт. ИИ читает его первым."
        value={prompt}
        onSave={setPrompt}
        onClose={() => setSystemPromptOpen(false)}
      />

      <PromptModal
        open={storePromptOpen}
        title="Промпт магазина"
        hint="Добавляется после системного промпта. ИИ читает его вторым. Принадлежит только этому магазину."
        value={storePrompt}
        onSave={async (v) => { setStorePrompt(v); await onSaveStorePrompt(v) }}
        onClose={() => setStorePromptOpen(false)}
      />
    </>
  )
}

