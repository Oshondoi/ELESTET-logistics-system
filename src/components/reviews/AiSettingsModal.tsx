import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Textarea'
import { cn } from '../../lib/utils'
import type { AiModel, AiSettings, AiSettingsFormValues, AiTone } from '../../types'

interface AiSettingsModalProps {
  open: boolean
  initial: AiSettings | null
  onClose: () => void
  onSubmit: (values: AiSettingsFormValues) => Promise<void>
}

const MODEL_OPTIONS: { value: AiModel; label: string }[] = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini (быстро, дёшево — рекомендуется)' },
  { value: 'gpt-4o', label: 'GPT-4o (умнее, дороже)' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
]

const TONE_OPTIONS: { value: AiTone; label: string; desc: string }[] = [
  { value: 'polite', label: 'Вежливый', desc: 'Профессиональный и учтивый' },
  { value: 'neutral', label: 'Нейтральный', desc: 'Деловой, без эмоций' },
  { value: 'friendly', label: 'Дружелюбный', desc: 'Тёплый и располагающий' },
]

export const AiSettingsModal = ({ open, initial, onClose, onSubmit }: AiSettingsModalProps) => {
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [model, setModel] = useState<AiModel>('gpt-4o-mini')
  const [tone, setTone] = useState<AiTone>('polite')
  const [prompt, setPrompt] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setKey(initial?.openai_key ?? '')
      setModel(initial?.model ?? 'gpt-4o-mini')
      setTone(initial?.tone ?? 'polite')
      setPrompt(initial?.system_prompt ?? '')
      setShowKey(false)
      setError(null)
    }
  }, [open, initial])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!key.trim()) { setError('Введите OpenAI API-ключ'); return }
    setIsSaving(true)
    setError(null)
    try {
      await onSubmit({ openai_key: key.trim(), model, tone, system_prompt: prompt })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Настройки ИИ-ответов">
      <form className="grid gap-5" onSubmit={(e) => void handleSubmit(e)}>

        {/* OpenAI Key */}
        <div className="grid gap-1.5">
          <label className="text-sm font-medium text-slate-700">OpenAI API-ключ</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-proj-..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              {showKey ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Получите ключ на{' '}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 underline"
            >
              platform.openai.com
            </a>
            . Ключ хранится в вашей базе данных и виден только членам компании.
          </p>
        </div>

        {/* Model */}
        <div className="grid gap-2">
          <label className="text-sm font-medium text-slate-700">Модель</label>
          {MODEL_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors',
                model === opt.value
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-slate-200 bg-white hover:border-slate-300',
              )}
            >
              <input
                type="radio"
                name="ai-model"
                value={opt.value}
                checked={model === opt.value}
                onChange={() => setModel(opt.value)}
                className="accent-blue-500"
              />
              <span className="text-sm text-slate-800">{opt.label}</span>
            </label>
          ))}
        </div>

        {/* Tone */}
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

        {/* Custom prompt */}
        <div className="grid gap-1.5">
          <Textarea
            label="Системный промпт (необязательно)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Оставьте пустым — будет использован стандартный промпт"
            rows={3}
          />
          <p className="text-[11px] text-slate-400">
            Если указать — полностью заменяет стандартный промпт.
          </p>
        </div>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Отмена
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
