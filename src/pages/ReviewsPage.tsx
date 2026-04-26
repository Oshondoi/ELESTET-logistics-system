import { useEffect, useRef, useState } from 'react'
import { AiSettingsModal } from '../components/reviews/AiSettingsModal'
import { Button } from '../components/ui/Button'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Textarea } from '../components/ui/Textarea'
import { cn } from '../lib/utils'
import {
  WbRateLimitError,
  callOpenAi,
  cancelAiReply,
  saveStorePrompt,
  createAiPrompt,
  updateAiPrompt,
  deleteAiPrompt,
  fetchAiPrompts,
  createReviewTemplate,
  deleteReviewTemplate,
  fetchReviewTemplates,
  getAiSettings,
  loadFeedbackRowsFromDb,
  markReplySent,
  saveAiReply,
  saveAiSettings,
  sendWbReply,
  syncFeedbacksFromWb,
  updateReviewTemplate,
} from '../services/reviewsService'
import type {
  AiPrompt,
  AiPromptFormValues,
  AiSettings,
  AiSettingsFormValues,
  ReviewTemplate,
  ReviewTemplateFormValues,
  Store,
  WbFeedback,
  WbFeedbackRow,
} from '../types'

// ── Helpers ────────────────────────────────────────────────────

function applyTemplate(text: string, fb: WbFeedback): string {
  const buyer = fb.userName || 'Покупатель'
  const product = fb.productDetails?.productName || 'товар'
  return text
    .replace(/\{buyer_name\}/g, buyer)
    .replace(/\{product_name\}/g, product)
    .replace(/\{stars\}/g, String(fb.productValuation))
}

// ── Stars ──────────────────────────────────────────────────────

const Stars = ({ value }: { value: number }) => (
  <span className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((i) => (
      <svg
        key={i}
        viewBox="0 0 24 24"
        className={cn('h-3.5 w-3.5', i <= value ? 'text-amber-400' : 'text-slate-200')}
        fill="currentColor"
        stroke="none"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ))}
  </span>
)

// ── TemplateFormModal ──────────────────────────────────────────

const RATING_OPTIONS = [1, 2, 3, 4, 5] as const

interface TemplateFormModalProps {
  open: boolean
  initial?: ReviewTemplate | null
  onClose: () => void
  onSubmit: (values: ReviewTemplateFormValues) => Promise<void>
}

const TemplateFormModal = ({ open, initial, onClose, onSubmit }: TemplateFormModalProps) => {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [ratings, setRatings] = useState<number[]>([])
  const [keywords, setKeywords] = useState('')
  const [isAuto, setIsAuto] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setText(initial?.text ?? '')
      setRatings(initial?.trigger_ratings ?? [])
      setKeywords((initial?.trigger_keywords ?? []).join(', '))
      setIsAuto(initial?.is_auto ?? false)
      setError(null)
    }
  }, [open, initial])

  const toggleRating = (r: number) =>
    setRatings((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r].sort((a, b) => a - b),
    )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Введите название'); return }
    if (!text.trim()) { setError('Введите текст ответа'); return }
    setIsSaving(true)
    setError(null)
    try {
      const kws = keywords.split(',').map((k) => k.trim()).filter(Boolean)
      await onSubmit({ name: name.trim(), text: text.trim(), trigger_ratings: ratings, trigger_keywords: kws, is_auto: isAuto })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Редактировать шаблон' : 'Новый шаблон'}>
      <form className="grid gap-5" onSubmit={(e) => void handleSubmit(e)}>
        <Input
          label="Название шаблона"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: Положительный ответ"
        />

        <div className="grid gap-1.5">
          <Textarea
            label="Текст ответа"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Спасибо, {buyer_name}! Рады, что товар понравился."
            rows={4}
          />
          <p className="text-[11px] text-slate-400">
            Переменные:{' '}
            <code className="rounded bg-slate-100 px-1">{'{buyer_name}'}</code>,{' '}
            <code className="rounded bg-slate-100 px-1">{'{product_name}'}</code>,{' '}
            <code className="rounded bg-slate-100 px-1">{'{stars}'}</code>
          </p>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium text-slate-700">
            Триггер: оценка{' '}
            <span className="font-normal text-slate-400">(пусто = любая)</span>
          </label>
          <div className="flex gap-2">
            {RATING_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => toggleRating(r)}
                className={cn(
                  'flex h-9 w-9 flex-col items-center justify-center rounded-xl border text-sm font-semibold transition-colors',
                  ratings.includes(r)
                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:text-slate-600',
                )}
              >
                {r}
                <span className="text-[8px] leading-none">★</span>
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Триггер: ключевые слова (через запятую)"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="брак, не работает, маломерит"
        />

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div
            role="switch"
            aria-checked={isAuto}
            onClick={() => setIsAuto((v) => !v)}
            className={cn(
              'relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
              isAuto ? 'bg-blue-500' : 'bg-slate-200',
            )}
          >
            <div
              className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                isAuto ? 'translate-x-4' : 'translate-x-0.5',
              )}
            />
          </div>
          <div>
            <div className="text-sm font-medium text-slate-800">Авто-ответ (legacy)</div>
            <div className="text-xs text-slate-500">Использовать в будущем авто-режиме</div>
          </div>
        </label>

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

// ── NegativeSendModal ─────────────────────────────────────────

interface NegativeSendModalProps {
  open: boolean
  isLoading: boolean
  onConfirm: () => void
  onClose: () => void
}

const NegativeSendModal = ({ open, isLoading, onConfirm, onClose }: NegativeSendModalProps) => (
  <Modal open={open} onClose={onClose} title="Негативный отзыв — подтвердите отправку">
    <div className="grid gap-5">
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m10.29 3.86-8.27 14.3A1 1 0 0 0 2.9 20h16.2a1 1 0 0 0 .88-1.84l-8.27-14.3a1 1 0 0 0-1.72 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p className="text-sm text-amber-800">
          Это отзыв с низкой оценкой (1–3★). Убедитесь, что ответ корректен и не навредит
          репутации магазина. Ответ на отзыв нельзя изменить после отправки.
        </p>
      </div>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading}>
          Отмена
        </Button>
        <Button type="button" onClick={onConfirm} disabled={isLoading}>
          {isLoading ? 'Отправка...' : 'Всё верно, отправить'}
        </Button>
      </div>
    </div>
  </Modal>
)

// ── ReviewsPage ────────────────────────────────────────────────

interface ReviewsPageProps {
  stores: Store[]
  activeAccountId: string
  selectedStoreId: string
  onStoreChange: (id: string) => void
}

const REVIEWS_TAB_KEY = 'reviews_active_tab'
const AUTO_SETTINGS_KEY = 'reviews_auto_settings'
const AUTO_SENT_TODAY_KEY = 'reviews_auto_sent_today'

type Tab = 'queue' | 'answered' | 'templates' | 'test'

interface AutoSettings {
  source: 'ai' | 'templates' | 'ai_with_fallback'
  dailyLimit: number
  targetRatings: number[]
  requireText: boolean
  delaySeconds: number
  storeIds: string[]
}

const DEFAULT_AUTO_SETTINGS: AutoSettings = {
  source: 'ai',
  dailyLimit: 50,
  targetRatings: [1, 2, 3, 4, 5],
  requireText: false,
  delaySeconds: 5,
  storeIds: [],
}

const loadAutoSettings = (): AutoSettings => {
  try {
    const raw = localStorage.getItem(AUTO_SETTINGS_KEY)
    if (raw) return { ...DEFAULT_AUTO_SETTINGS, ...JSON.parse(raw) }
  } catch {}
  return DEFAULT_AUTO_SETTINGS
}

const loadAutoSentToday = (): number => {
  try {
    const raw = localStorage.getItem(AUTO_SENT_TODAY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { date: string; count: number }
      if (parsed.date === new Date().toISOString().slice(0, 10)) return parsed.count
    }
  } catch {}
  return 0
}

const getSavedTab = (): Tab => {
  const saved = localStorage.getItem(REVIEWS_TAB_KEY)
  if (saved === 'queue' || saved === 'answered' || saved === 'templates' || saved === 'test') return saved
  return 'queue'
}

export const ReviewsPage = ({
  stores,
  activeAccountId,
  selectedStoreId,
  onStoreChange,
}: ReviewsPageProps) => {
  const storesWithKey = stores.filter((s) => s.api_key)
  const activeStore =
    storesWithKey.find((s) => s.id === selectedStoreId) ?? storesWithKey[0] ?? null

  const [tab, setTabState] = useState<Tab>(getSavedTab)

  const setTab = (t: Tab) => {
    localStorage.setItem(REVIEWS_TAB_KEY, t)
    setTabState(t)
  }

  // Rows from DB (include ai_reply fields). null = not yet loaded.
  const [queueRows, setQueueRows] = useState<WbFeedbackRow[] | null>(null)
  const [answeredRows, setAnsweredRows] = useState<WbFeedbackRow[] | null>(null)
  const [countUnanswered, setCountUnanswered] = useState(0)

  const [isFetching, setIsFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Cooldown — храним в localStorage чтобы переживал перезагрузку
  const LS_KEY = 'wb_feedbacks_cooldown_end'
  const [cooldownEndAt, setCooldownEndAtState] = useState<number | null>(() => {
    const stored = localStorage.getItem(LS_KEY)
    if (!stored) return null
    const val = parseInt(stored, 10)
    return val > Date.now() ? val : null
  })
  const [cooldownLeft, setCooldownLeft] = useState<number>(() => {
    const stored = localStorage.getItem(LS_KEY)
    if (!stored) return 0
    const val = parseInt(stored, 10)
    return val > Date.now() ? Math.ceil((val - Date.now()) / 1000) : 0
  })

  const setCooldownEndAt = (endAt: number | null) => {
    if (endAt) localStorage.setItem(LS_KEY, String(endAt))
    else localStorage.removeItem(LS_KEY)
    setCooldownEndAtState(endAt)
  }

  // Per-feedback state
  const [localTexts, setLocalTexts] = useState<Record<string, string>>({})
  const [openReplyIds, setOpenReplyIds] = useState<Set<string>>(new Set())
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set())
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set())
  const [genErrors, setGenErrors] = useState<Record<string, string>>({})
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({})
  const [negativePending, setNegativePending] = useState<WbFeedbackRow | null>(null)

  // Photo preview on hover
  const [photoPreview, setPhotoPreview] = useState<{ url: string; x: number; y: number } | null>(null)

  // AI settings
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [aiSettingsModalOpen, setAiSettingsModalOpen] = useState(false)
  const [systemPrompts, setSystemPrompts] = useState<AiPrompt[]>([])
  const [storePrompts, setStorePrompts] = useState<AiPrompt[]>([])

  // Templates
  const [templates, setTemplates] = useState<ReviewTemplate[]>([])
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ReviewTemplate | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState<ReviewTemplate | null>(null)
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false)

  // Test tab
  const [testText, setTestText] = useState('')
  const [testRating, setTestRating] = useState(5)
  const [testProduct, setTestProduct] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [isTestGenerating, setIsTestGenerating] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)

  // Automation tab
  const [autoSettings, setAutoSettings] = useState<AutoSettings>(loadAutoSettings)
  const [autoSentToday, setAutoSentToday] = useState(loadAutoSentToday)
  const [isAutoRunning, setIsAutoRunning] = useState(false)
  const [autoProgress, setAutoProgress] = useState<{ done: number; total: number } | null>(null)
  const [autoLog, setAutoLog] = useState<string[]>([])

  // Store modal
  const [storeModalOpen, setStoreModalOpen] = useState(false)
  const [pendingStoreIds, setPendingStoreIds] = useState<string[]>([])

  // Store dropdown
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false)
  const storeDropdownRef = useRef<HTMLDivElement | null>(null)

  // ── Load AI settings on mount / account change
  useEffect(() => {
    if (!activeAccountId) return
    getAiSettings(activeAccountId).then(setAiSettings).catch(() => {})
    fetchAiPrompts(activeAccountId, 'system').then(setSystemPrompts).catch(() => {})
  }, [activeAccountId])

  // ── Load store prompts when active store changes
  useEffect(() => {
    if (!activeAccountId || !activeStore?.id) { setStorePrompts([]); return }
    fetchAiPrompts(activeAccountId, 'store', activeStore.id).then(setStorePrompts).catch(() => {})
  }, [activeAccountId, activeStore?.id])

  // ── When rows load: init localTexts from existing ai_reply + auto-open
  useEffect(() => {
    if (!queueRows) return
    setLocalTexts((prev) => {
      const next = { ...prev }
      for (const row of queueRows) {
        if (row.ai_reply && !next[row.id]) next[row.id] = row.ai_reply
      }
      return next
    })
    setOpenReplyIds((prev) => {
      const n = new Set(prev)
      for (const row of queueRows) {
        if (row.ai_reply_status === 'generated') n.add(row.id)
      }
      return n
    })
  }, [queueRows])

  // ── Reset per-feedback state on store change + immediate DB load
  useEffect(() => {
    setQueueRows(null)
    setAnsweredRows(null)
    setFetchError(null)
    setCountUnanswered(0)
    setLocalTexts({})
    setOpenReplyIds(new Set())
    setGeneratingIds(new Set())
    setSendingIds(new Set())
    setGenErrors({})
    setSendErrors({})
    setTestResult(null)
    setTestError(null)
    if (activeStore?.id && tab !== 'templates' && tab !== 'test') {
      void loadFromDb(tab === 'answered')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStore?.id])

  // ── Auto-load from DB on tab switch (only if not yet cached)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab === 'templates' || tab === 'test') return
    const isAnswered = tab === 'answered'
    const cached = isAnswered ? answeredRows : queueRows
    if (cached === null && activeStore?.id) void loadFromDb(isAnswered)
  }, [tab])

  // ── Cooldown countdown timer
  useEffect(() => {
    if (!cooldownEndAt) return
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((cooldownEndAt - Date.now()) / 1000))
      setCooldownLeft(left)
      if (left === 0) { clearInterval(timer); setFetchError(null) }
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldownEndAt])

  // ── Load templates
  useEffect(() => {
    if (!activeAccountId) return
    setIsLoadingTemplates(true)
    fetchReviewTemplates(activeAccountId)
      .then(setTemplates)
      .catch(() => {})
      .finally(() => setIsLoadingTemplates(false))
  }, [activeAccountId])

  // ── Close store dropdown on outside click
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!storeDropdownRef.current?.contains(e.target as Node)) setStoreDropdownOpen(false)
    }
    window.addEventListener('pointerdown', handler)
    return () => window.removeEventListener('pointerdown', handler)
  }, [])

  const canRefresh = !isFetching && cooldownLeft === 0
  const isAiConfigured = aiSettings?.provider === 'claude' ? !!aiSettings.claude_key : !!aiSettings?.openai_key

  // ── Load rows from DB
  const loadFromDb = async (isAnswered: boolean) => {
    if (!activeStore?.id) return
    setIsFetching(true)
    setFetchError(null)
    try {
      const rows = await loadFeedbackRowsFromDb(activeStore.id, isAnswered)
      if (isAnswered) setAnsweredRows(rows)
      else { setQueueRows(rows); setCountUnanswered(rows.length) }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setIsFetching(false)
    }
  }

  // ── Sync from WB API → upsert DB → reload rows with AI fields
  const syncFromWb = async (isAnswered: boolean) => {
    if (!activeStore?.api_key || !activeStore?.id) return
    setIsFetching(true)
    setFetchError(null)
    try {
      const result = await syncFeedbacksFromWb(
        activeStore.api_key,
        activeStore.id,
        activeAccountId,
        isAnswered,
      )
      // Reload from DB to get full rows including existing ai_reply fields
      const rows = await loadFeedbackRowsFromDb(activeStore.id, isAnswered)
      const endAt = Date.now() + result.retryAfterSec * 1000
      setCooldownEndAt(endAt)
      setCooldownLeft(result.retryAfterSec)
      setCountUnanswered(result.countUnanswered)
      if (isAnswered) setAnsweredRows(rows)
      else setQueueRows(rows)
    } catch (err) {
      if (err instanceof WbRateLimitError) {
        const endAt = Date.now() + err.retryAfterSec * 1000
        setCooldownEndAt(endAt)
        setCooldownLeft(err.retryAfterSec)
      }
      setFetchError(err instanceof Error ? err.message : 'Ошибка синхронизации')
    } finally {
      setIsFetching(false)
    }
  }

  // ── Generate AI reply for a feedback
  const handleGenerate = async (row: WbFeedbackRow) => {
    if (!aiSettings || !isAiConfigured) {
      setGenErrors((prev) => ({
        ...prev,
        [row.id]: 'API-ключ ИИ не настроен. Нажмите «⚙ Настройки ИИ».',
      }))
      return
    }
    setGeneratingIds((prev) => new Set(prev).add(row.id))
    setGenErrors((prev) => { const n = { ...prev }; delete n[row.id]; return n })
    try {
      const text = await callOpenAi(aiSettings, {
        text: row.data.text,
        productValuation: row.data.productValuation,
        userName: row.data.userName,
        productName: row.data.productDetails?.productName ?? null,
        photoLinks: row.data.photoLinks ?? null,
        storePrompt: activeStore?.ai_prompt ?? undefined,
        extraSystemPrompts: systemPrompts.map((p) => p.content),
        extraStorePrompts: storePrompts.map((p) => p.content),
      })
      await saveAiReply(row.id, text)
      setLocalTexts((prev) => ({ ...prev, [row.id]: text }))
      setQueueRows((prev) =>
        prev
          ? prev.map((r) =>
              r.id === row.id ? { ...r, ai_reply: text, ai_reply_status: 'generated' as const } : r,
            )
          : prev,
      )
      setOpenReplyIds((prev) => new Set(prev).add(row.id))
    } catch (err) {
      setGenErrors((prev) => ({
        ...prev,
        [row.id]: err instanceof Error ? err.message : 'Ошибка генерации',
      }))
    } finally {
      setGeneratingIds((prev) => { const n = new Set(prev); n.delete(row.id); return n })
    }
  }

  // ── Send reply (negative reviews require extra confirmation)
  const handleSendReply = async (row: WbFeedbackRow, confirmed = false) => {
    if (!activeStore?.api_key) return
    const text = localTexts[row.id]?.trim()
    if (!text) return

    // For 1–3★ require confirmation via modal
    if (!confirmed && row.data.productValuation <= 3) {
      setNegativePending(row)
      return
    }

    setSendingIds((prev) => new Set(prev).add(row.id))
    setSendErrors((prev) => { const n = { ...prev }; delete n[row.id]; return n })
    try {
      await sendWbReply(activeStore.api_key, row.id, text)
      await markReplySent(row.id)
      setQueueRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev))
      setOpenReplyIds((prev) => { const n = new Set(prev); n.delete(row.id); return n })
    } catch (err) {
      setSendErrors((prev) => ({
        ...prev,
        [row.id]: err instanceof Error ? err.message : 'Ошибка отправки',
      }))
    } finally {
      setSendingIds((prev) => { const n = new Set(prev); n.delete(row.id); return n })
    }
  }

  // ── Template CRUD
  const handleTemplateSubmit = async (values: ReviewTemplateFormValues) => {
    if (editingTemplate) {
      await updateReviewTemplate(editingTemplate.id, values)
      setTemplates((prev) => prev.map((t) => (t.id === editingTemplate.id ? { ...t, ...values } : t)))
    } else {
      const created = await createReviewTemplate(activeAccountId, values)
      setTemplates((prev) => [...prev, created])
    }
  }

  const handleDeleteTemplate = async () => {
    if (!deletingTemplate) return
    setIsDeletingTemplate(true)
    try {
      await deleteReviewTemplate(deletingTemplate.id)
      setTemplates((prev) => prev.filter((t) => t.id !== deletingTemplate.id))
      setDeletingTemplate(null)
    } finally {
      setIsDeletingTemplate(false)
    }
  }

  // ── Save store prompt (legacy single field)
  const handleSaveStorePrompt = async (prompt: string) => {
    if (!activeStore?.id) return
    await saveStorePrompt(activeStore.id, prompt)
  }

  // ── Prompt list CRUD
  const handleCreatePrompt = async (type: 'system' | 'store', values: AiPromptFormValues): Promise<AiPrompt> => {
    const storeId = type === 'store' ? activeStore?.id : undefined
    const created = await createAiPrompt(activeAccountId, type, values, storeId)
    if (type === 'system') setSystemPrompts((prev) => [...prev, created])
    else setStorePrompts((prev) => [...prev, created])
    return created
  }

  const handleUpdatePrompt = async (id: string, values: AiPromptFormValues) => {
    await updateAiPrompt(id, values)
    const updater = (prev: AiPrompt[]) =>
      prev.map((p) => (p.id === id ? { ...p, title: values.title, content: values.content } : p))
    setSystemPrompts(updater)
    setStorePrompts(updater)
  }

  const handleDeletePrompt = async (id: string) => {
    await deleteAiPrompt(id)
    setSystemPrompts((prev) => prev.filter((p) => p.id !== id))
    setStorePrompts((prev) => prev.filter((p) => p.id !== id))
  }

  // ── Automation settings save
  const saveAutoSettingsToStorage = (next: AutoSettings) => {
    setAutoSettings(next)
    localStorage.setItem(AUTO_SETTINGS_KEY, JSON.stringify(next))
  }

  // ── Auto-run: generate + send for all pending reviews
  const handleAutoRun = async () => {
    if (!activeStore?.api_key || !queueRows) return
    if (isAutoRunning) return
    if (autoSettings.storeIds.length === 0) {
      setAutoLog(['Выберите магазины в настройках автоматизации.'])
      return
    }

    const remaining = autoSettings.dailyLimit - autoSentToday
    if (remaining <= 0) {
      setAutoLog(['Дневной лимит исчерпан.'])
      return
    }

    const candidates = queueRows.filter((row) => {
      if (!autoSettings.storeIds.includes(row.data.storeId ?? '')) return false
      if (autoSettings.requireText && !row.data.text?.trim()) return false
      if (!autoSettings.targetRatings.includes(row.data.productValuation)) return false
      return true
    }).slice(0, remaining)

    if (candidates.length === 0) {
      setAutoLog(['Нет подходящих отзывов в очереди.'])
      return
    }

    setIsAutoRunning(true)
    setAutoProgress({ done: 0, total: candidates.length })
    setAutoLog([`Начинаем: ${candidates.length} отзывов`])
    let sent = 0

    for (const row of candidates) {
      try {
        let text: string | null = null

        if (autoSettings.source === 'ai' || autoSettings.source === 'ai_with_fallback') {
          if (aiSettings && isAiConfigured) {
            try {
              text = await callOpenAi(aiSettings, {
                text: row.data.text,
                productValuation: row.data.productValuation,
                userName: row.data.userName,
                productName: row.data.productDetails?.productName ?? null,
                photoLinks: row.data.photoLinks ?? null,
                storePrompt: activeStore?.ai_prompt ?? undefined,
                extraSystemPrompts: systemPrompts.map((p) => p.content),
                extraStorePrompts: storePrompts.map((p) => p.content),
              })
            } catch {
              if (autoSettings.source !== 'ai_with_fallback') throw new Error('Ошибка ИИ')
            }
          }
        }

        if (!text && (autoSettings.source === 'templates' || autoSettings.source === 'ai_with_fallback')) {
          const matched = templates.find((tpl) => {
            if (tpl.trigger_keywords.length > 0) {
              const lower = (row.data.text ?? '').toLowerCase()
              return tpl.trigger_keywords.some((kw) => lower.includes(kw.toLowerCase()))
            }
            if (tpl.trigger_ratings.length > 0) return tpl.trigger_ratings.includes(row.data.productValuation)
            return true
          })
          if (matched) text = applyTemplate(matched.text, row.data)
        }

        if (!text) {
          setAutoLog((prev) => [...prev, `⚠ Пропущен: нет текста для отзыва #${row.data.id?.slice(-6) ?? '?'}`])
          setAutoProgress((p) => p ? { ...p, done: p.done + 1 } : p)
          continue
        }

        await saveAiReply(row.id, text)
        setLocalTexts((prev) => ({ ...prev, [row.id]: text! }))

        if (autoSettings.delaySeconds > 0) {
          await new Promise((res) => setTimeout(res, autoSettings.delaySeconds * 1000))
        }

        await sendWbReply(activeStore.api_key, row.id, text)
        await markReplySent(row.id)
        setQueueRows((prev) => prev ? prev.filter((r) => r.id !== row.id) : prev)
        sent++
        const todayStr = new Date().toISOString().slice(0, 10)
        const newCount = autoSentToday + sent
        setAutoSentToday(newCount)
        localStorage.setItem(AUTO_SENT_TODAY_KEY, JSON.stringify({ date: todayStr, count: newCount }))
        setAutoLog((prev) => [...prev, `✓ Отправлено: ${row.data.userName ?? 'Покупатель'}, ${row.data.productValuation}★`])
      } catch (err) {
        setAutoLog((prev) => [...prev, `✗ Ошибка: ${err instanceof Error ? err.message : 'неизвестно'}`])
      }
      setAutoProgress((p) => p ? { ...p, done: p.done + 1 } : p)
    }

    setAutoLog((prev) => [...prev, `Готово. Отправлено: ${sent} из ${candidates.length}`])
    setIsAutoRunning(false)
    setAutoProgress(null)
  }

  // ── Save AI settings
  const handleSaveAiSettings = async (values: AiSettingsFormValues) => {
    await saveAiSettings(activeAccountId, values)
    setAiSettings((prev) => ({
      account_id: activeAccountId,
      ...(prev ?? { updated_at: new Date().toISOString() }),
      ...values,
      system_prompt: values.system_prompt.trim() || null,
      updated_at: new Date().toISOString(),
    }))
  }

  // ── Test generate (dry-run, nothing saved or sent)
  const handleTestGenerate = async () => {
    if (!aiSettings || !isAiConfigured) {
      setTestError('API-ключ ИИ не настроен (кнопка «⚙ Настройки ИИ»).')
      return
    }
    if (!testText.trim()) {
      setTestError('Введите текст отзыва.')
      return
    }
    setIsTestGenerating(true)
    setTestError(null)
    setTestResult(null)
    try {
      const text = await callOpenAi(aiSettings, {
        text: testText,
        productValuation: testRating,
        productName: testProduct.trim() || null,
        userName: null,
      })
      setTestResult(text)
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsTestGenerating(false)
    }
  }

  // ── No stores with API key
  if (storesWithKey.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <h2 className="mb-2 text-base font-semibold text-slate-800">Нет магазинов с API-ключом</h2>
        <p className="text-sm text-slate-500">
          Добавьте API-ключ в разделе «Магазины», чтобы загружать отзывы WB.
        </p>
      </div>
    )
  }

  const currentRows = tab === 'answered' ? answeredRows : queueRows

  // ── Render
  return (
    <div className="flex flex-col gap-4">

      {/* ── API key hint */}
      <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>
          API-ключ WB должен иметь разрешение <strong>«Вопросы и отзывы»</strong>.{' '}
          Лимит WB API: <strong>3 запроса за 30 сек</strong>.
        </span>
      </div>

      {/* ── Header row */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Store selector */}
        <div ref={storeDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setStoreDropdownOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 10.5 6 5h12l2 5.5" />
              <path d="M5 10h14v9H5z" />
            </svg>
            <span>{activeStore?.name ?? 'Выберите магазин'}</span>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {storeDropdownOpen && (
            <div className="absolute left-0 top-full z-20 mt-1.5 w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
              {storesWithKey.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { onStoreChange(s.id); setStoreDropdownOpen(false) }}
                  className={cn(
                    'flex w-full items-center px-4 py-2 text-sm transition-colors hover:bg-slate-50',
                    s.id === activeStore?.id ? 'font-semibold text-blue-600' : 'text-slate-700',
                  )}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Unanswered badge — always rendered to reserve space */}
        <span
          className={cn(
            'rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600',
            !(tab === 'queue' && countUnanswered > 0) && 'invisible',
          )}
        >
          {countUnanswered} без ответа
        </span>

        <div className="ml-auto flex items-center gap-2">

          {/* AI Settings button */}
          <button
            type="button"
            onClick={() => setAiSettingsModalOpen(true)}
            title="Настройки ИИ-ответов"
            className={cn(
              'flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors',
              isAiConfigured
                ? 'border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
            )}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {isAiConfigured ? 'ИИ настроен' : 'Настройки ИИ'}
          </button>

          {/* Sync button — always visible, disabled on templates/test */}
          <Button
            variant="secondary"
            onClick={() => void syncFromWb(tab === 'answered')}
            disabled={!canRefresh || !activeStore?.api_key || tab === 'templates' || tab === 'test'}
            title={
              !activeStore?.api_key
                ? 'Нет API-ключа'
                : cooldownLeft > 0
                  ? `Осталось ${cooldownLeft} с`
                  : ''
            }
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {isFetching
              ? '...'
              : cooldownLeft > 0
                ? `Синхронизировать (${cooldownLeft}с)`
                : 'Синхронизировать'}
          </Button>
        </div>
      </div>

      {/* ── Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            { key: 'queue' as Tab, label: 'Без ответа' },
            { key: 'answered' as Tab, label: 'Отвечено' },
            { key: 'templates' as Tab, label: `Автоматизация${templates.length > 0 ? ` (${templates.length})` : ''}` },
            { key: 'test' as Tab, label: '🧪 Тест ИИ-ответа' },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Test tab (dry-run, nothing sent) */}
      {tab === 'test' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <strong>Режим теста — ничего не сохраняется и не отправляется.</strong>{' '}
            Введите тестовый отзыв, нажмите «Сгенерировать» — ИИ покажет пример ответа.
          </div>

          {!isAiConfigured && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
              </svg>
              <span className="text-sm text-slate-600">
                API-ключ ИИ не настроен.{' '}
                <button
                  type="button"
                  onClick={() => setAiSettingsModalOpen(true)}
                  className="font-semibold text-blue-600 hover:underline"
                >
                  Настроить →
                </button>
              </span>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4">

              {/* Rating */}
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-slate-700">Оценка</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setTestRating(r)}
                      className={cn(
                        'flex h-9 w-9 flex-col items-center justify-center rounded-xl border text-sm font-semibold transition-colors',
                        testRating === r
                          ? 'border-amber-400 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300',
                      )}
                    >
                      {r}
                      <span className="text-[8px] leading-none">★</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Product name */}
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Название товара <span className="font-normal text-slate-400">(необязательно)</span>
                </label>
                <input
                  type="text"
                  value={testProduct}
                  onChange={(e) => setTestProduct(e.target.value)}
                  placeholder="Например: Футболка мужская базовая"
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                />
              </div>

              {/* Review text */}
              <div className="grid gap-1.5">
                <label className="text-sm font-medium text-slate-700">Текст отзыва</label>
                <textarea
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  rows={4}
                  placeholder="Товар пришёл быстро, качество хорошее, размер соответствует..."
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
                />
              </div>

              {testError && <p className="text-sm text-rose-500">{testError}</p>}

              <Button
                onClick={() => void handleTestGenerate()}
                disabled={isTestGenerating || !testText.trim()}
                className="w-full justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                {isTestGenerating ? 'Генерация...' : 'Сгенерировать ИИ-ответ'}
              </Button>
            </div>
          </div>

          {testResult && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  ИИ-ответ (тест — не отправляется)
                </span>
              </div>
              <p className="text-sm leading-relaxed text-slate-800">{testResult}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Queue / Answered tabs */}
      {tab !== 'templates' && tab !== 'test' && (
        <div className="flex flex-col gap-3">

          {/* Loading */}
          {isFetching && currentRows === null && (
            <div className="py-14 text-center text-sm text-slate-400">Загрузка отзывов...</div>
          )}

          {/* Error */}
          {!isFetching && fetchError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {fetchError}
            </div>
          )}

          {/* Empty */}
          {!isFetching && !fetchError && currentRows !== null && currentRows.length === 0 && (
            <div className="py-16 text-center text-sm text-slate-400">
              {tab === 'queue' ? 'Все отзывы отвечены — отличная работа!' : 'Отвеченных отзывов нет.'}
            </div>
          )}

          {/* AI key notice (queue only, when reviews present) */}
          {tab === 'queue' && !isAiConfigured && (currentRows ?? []).length > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-violet-400" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span className="text-sm text-violet-700">
                ИИ-ответы недоступны — API-ключ ИИ не настроен.{' '}
                <button
                  type="button"
                  onClick={() => setAiSettingsModalOpen(true)}
                  className="font-semibold underline"
                >
                  Настроить →
                </button>
              </span>
            </div>
          )}

          {/* Feedback cards */}
          {(currentRows ?? []).map((row) => {
            const fb = row.data
            const isGenerating = generatingIds.has(row.id)
            const isSending = sendingIds.has(row.id)
            const replyOpen = openReplyIds.has(row.id)
            const genError = genErrors[row.id]
            const sendError = sendErrors[row.id]
            const hasAiReply = Boolean(row.ai_reply)

            return (
              <div
                key={row.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                {/* Top row: review content */}
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Stars value={fb.productValuation} />
                      {fb.productDetails?.productName && (
                        <span className="max-w-[280px] truncate text-xs text-slate-600">
                          {fb.productDetails.productName}
                        </span>
                      )}
                      {fb.productDetails?.supplierArticle && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {fb.productDetails.supplierArticle}
                        </span>
                      )}
                      {fb.productDetails?.nmId && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
                          WB #{fb.productDetails.nmId}
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-slate-700">
                      {fb.text || <span className="italic text-slate-400">Отзыв без текста</span>}
                    </p>
                    {fb.answer?.text && (
                      <div className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">
                        <span className="font-semibold">Ответ продавца: </span>
                        {fb.answer.text}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs text-slate-400">
                      {new Date(fb.createdDate).toLocaleDateString('ru-RU')}
                    </div>
                    {fb.userName && (
                      <div className="mt-0.5 text-xs text-slate-400">{fb.userName}</div>
                    )}
                  </div>
                </div>

                {/* Photos */}
                {(fb.photoLinks ?? []).length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {(fb.photoLinks ?? []).slice(0, 6).map((photo, i) => (
                      <a key={i} href={photo.fullSize} target="_blank" rel="noopener noreferrer">
                        <img
                          src={photo.miniSize}
                          alt=""
                          className="h-14 w-14 cursor-zoom-in rounded-xl object-cover hover:opacity-90 transition-opacity"
                          onMouseEnter={(e) => {
                            const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect()
                            const popW = 288
                            const popH = 384
                            const gap = 12
                            const x = rect.right + gap + popW > window.innerWidth
                              ? rect.left - gap - popW
                              : rect.right + gap
                            const y = Math.min(rect.top, window.innerHeight - popH - gap)
                            setPhotoPreview({ url: photo.fullSize, x, y })
                          }}
                          onMouseLeave={() => setPhotoPreview(null)}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      </a>
                    ))}
                  </div>
                )}

                {/* Reply area — queue tab only */}
                {tab === 'queue' && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {!replyOpen ? (
                      /* Collapsed: action buttons */
                      <div className="flex flex-wrap items-center gap-2">
                        {/* AI generate */}
                        <button
                          type="button"
                          onClick={() => void handleGenerate(row)}
                          disabled={isGenerating}
                          title={!isAiConfigured ? 'Настройте API-ключ ИИ (кнопка «⚙ Настройки ИИ»)' : ''}
                          className={cn(
                            'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors',
                            isAiConfigured
                              ? 'bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-60'
                              : 'cursor-not-allowed bg-slate-100 text-slate-400',
                          )}
                        >
                          {isGenerating ? (
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                            </svg>
                          )}
                          {isGenerating ? 'Генерация...' : 'ИИ-ответ'}
                        </button>

                        {/* Manual write */}
                        <button
                          type="button"
                          onClick={() => setOpenReplyIds((prev) => new Set(prev).add(row.id))}
                          className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200"
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
                          </svg>
                          Ответить
                        </button>

                        {genError && <span className="text-xs text-rose-500">{genError}</span>}
                      </div>
                    ) : (
                      /* Expanded: textarea + controls */
                      <div className="flex flex-col gap-2.5">
                        {/* AI badge */}
                        {hasAiReply && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700">
                              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                              </svg>
                              ИИ-ответ
                            </span>
                            {fb.productValuation <= 3 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                                ⚠ Требует проверки (негативный)
                              </span>
                            )}
                          </div>
                        )}

                        <textarea
                          ref={(el) => {
                            if (el) {
                              el.style.height = 'auto'
                              el.style.height = Math.min(el.scrollHeight, 240) + 'px'
                            }
                          }}
                          value={localTexts[row.id] ?? ''}
                          onChange={(e) => {
                            setLocalTexts((prev) => ({ ...prev, [row.id]: e.target.value }))
                            e.target.style.height = 'auto'
                            e.target.style.height = Math.min(e.target.scrollHeight, 240) + 'px'
                          }}
                          placeholder="Текст ответа..."
                          style={{ minHeight: '80px', maxHeight: '240px' }}
                          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none overflow-y-auto"
                        />

                        {/* Template chips */}
                        {templates.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-slate-400">Шаблоны:</span>
                            {templates.slice(0, 8).map((tpl) => (
                              <button
                                key={tpl.id}
                                type="button"
                                onClick={() =>
                                  setLocalTexts((prev) => ({
                                    ...prev,
                                    [row.id]: applyTemplate(tpl.text, fb),
                                  }))
                                }
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-600"
                              >
                                {tpl.name}
                              </button>
                            ))}
                          </div>
                        )}

                        {genError && <p className="text-xs text-rose-500">{genError}</p>}
                        {sendError && <p className="text-xs text-rose-500">{sendError}</p>}

                        <div className="flex items-center gap-2">
                          {/* Regenerate */}
                          {isAiConfigured && (
                            <button
                              type="button"
                              onClick={() => void handleGenerate(row)}
                              disabled={isGenerating}
                              className="flex items-center gap-1 text-xs text-violet-500 transition-colors hover:text-violet-700 disabled:opacity-50"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className={cn('h-3.5 w-3.5', isGenerating && 'animate-spin')}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <polyline points="23 4 23 10 17 10" />
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                              </svg>
                              {isGenerating ? 'Генерация...' : hasAiReply ? 'Перегенерировать' : 'Сгенерировать ИИ'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setOpenReplyIds((prev) => {
                                const n = new Set(prev); n.delete(row.id); return n
                              })
                              // Сбросить ai_reply в БД чтобы при reload не открывалось снова
                              void cancelAiReply(row.id)
                              setQueueRows((prev) =>
                                prev
                                  ? prev.map((r) =>
                                      r.id === row.id
                                        ? { ...r, ai_reply: null, ai_reply_status: 'none' as const }
                                        : r,
                                    )
                                  : prev,
                              )
                            }}
                            className="text-xs text-slate-400 transition-colors hover:text-slate-600"
                          >
                            Отмена
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleSendReply(row)}
                            disabled={isSending || !localTexts[row.id]?.trim()}
                            className={cn(
                              'ml-auto rounded-xl px-4 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50',
                              fb.productValuation <= 3
                                ? 'bg-amber-500 hover:bg-amber-600'
                                : 'bg-blue-500 hover:bg-blue-600',
                            )}
                          >
                            {isSending
                              ? 'Отправка...'
                              : fb.productValuation <= 3
                                ? '⚠ Отправить ответ'
                                : 'Отправить ответ'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Answered badge (answered tab) */}
                {tab === 'answered' && fb.answer?.text && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Ответ отправлен
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {(currentRows ?? []).length >= 100 && (
            <p className="py-2 text-center text-xs text-slate-400">
              Показаны 100 последних отзывов.
            </p>
          )}
        </div>
      )}

      {/* ── Templates tab */}
      {tab === 'templates' && (
        <div className="flex flex-col gap-5">

          {/* ── Магазины ──────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Магазины</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {autoSettings.storeIds.length === 0
                ? 'Ни один магазин не выбран'
                : autoSettings.storeIds.length === storesWithKey.length
                ? `Все магазины (${storesWithKey.length})`
                : `Выбрано: ${autoSettings.storeIds.length} из ${storesWithKey.length}`}
            </p>
            <button
              type="button"
              onClick={() => { setPendingStoreIds(autoSettings.storeIds); setStoreModalOpen(true) }}
              className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
            >
              Выбрать
            </button>
            {autoSettings.storeIds.length === 0 && storesWithKey.length > 0 && (
              <p className="mt-2 text-[11px] text-amber-600">Выберите хотя бы один магазин для запуска автоматизации</p>
            )}
          </div>

          {/* ── Источник ответов ─────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Источник ответов</h3>
            <div className="flex flex-col gap-2">
              {([
                { value: 'ai', label: 'ИИ (Claude / OpenAI)', desc: 'Генерирует уникальный ответ для каждого отзыва' },
                { value: 'templates', label: 'Шаблоны', desc: 'Использует подходящий шаблон из вкладки «Автоматизация»' },
                { value: 'ai_with_fallback', label: 'ИИ → Шаблоны (резервный)', desc: 'Пробует ИИ, при ошибке — шаблон' },
              ] as const).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${autoSettings.source === opt.value ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <input
                    type="radio"
                    name="auto-source"
                    checked={autoSettings.source === opt.value}
                    onChange={() => saveAutoSettingsToStorage({ ...autoSettings, source: opt.value })}
                    className="mt-0.5 accent-blue-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{opt.label}</p>
                    <p className="text-xs text-slate-400">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* ── Лимиты ────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Лимиты и задержки</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Лимит ответов в сутки</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={autoSettings.dailyLimit}
                    onChange={(e) => saveAutoSettingsToStorage({ ...autoSettings, dailyLimit: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                  />
                  <span className="text-xs text-slate-400">ответов / день</span>
                </div>
                <p className="text-[11px] text-slate-400">Сегодня отправлено: <strong>{autoSentToday}</strong> из {autoSettings.dailyLimit}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Пауза между ответами</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={300}
                    value={autoSettings.delaySeconds}
                    onChange={(e) => saveAutoSettingsToStorage({ ...autoSettings, delaySeconds: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none"
                  />
                  <span className="text-xs text-slate-400">секунд</span>
                </div>
                <p className="text-[11px] text-slate-400">Имитирует естественный интервал, снижает риск блокировки</p>
              </div>
            </div>
          </div>

          {/* ── Фильтры ───────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">Фильтры</h3>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-slate-600">Отвечать на оценки</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => {
                        const cur = autoSettings.targetRatings
                        const next = cur.includes(star) ? cur.filter((r) => r !== star) : [...cur, star].sort()
                        if (next.length > 0) saveAutoSettingsToStorage({ ...autoSettings, targetRatings: next })
                      }}
                      className={`flex h-9 w-12 items-center justify-center rounded-xl border text-sm font-medium transition-colors ${autoSettings.targetRatings.includes(star) ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-400 hover:border-slate-300'}`}
                    >
                      {star}★
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={autoSettings.requireText}
                  onChange={(e) => saveAutoSettingsToStorage({ ...autoSettings, requireText: e.target.checked })}
                  className="h-4 w-4 rounded accent-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-700">Только отзывы с текстом</p>
                  <p className="text-xs text-slate-400">Пропускать отзывы только с оценкой, без текста</p>
                </div>
              </label>
            </div>
          </div>

          {/* ── Запуск ────────────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Запуск автоответа</h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  В очереди: <strong className="text-slate-600">{queueRows?.filter((r) => autoSettings.targetRatings.includes(r.data.productValuation) && (!autoSettings.requireText || r.data.text?.trim())).length ?? 0}</strong> подходящих отзывов
                </p>
              </div>
              <button
                type="button"
                disabled={isAutoRunning || !activeStore?.api_key || autoSentToday >= autoSettings.dailyLimit || autoSettings.storeIds.length === 0}
                onClick={() => void handleAutoRun()}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {isAutoRunning ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    {autoProgress ? `${autoProgress.done} / ${autoProgress.total}` : 'Запуск...'}
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M5 3l14 9-14 9V3z" /></svg>
                    Запустить сейчас
                  </>
                )}
              </button>
            </div>
            {autoSentToday >= autoSettings.dailyLimit && (
              <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Дневной лимит исчерпан ({autoSettings.dailyLimit} ответов). Сбросится завтра.
              </div>
            )}
            {!activeStore?.api_key && (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                API-ключ магазина не настроен. Добавьте его в разделе «Магазины».
              </div>
            )}
            {autoLog.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Лог запуска</p>
                  <button type="button" onClick={() => setAutoLog([])} className="text-[11px] text-slate-400 hover:text-slate-600">Очистить</button>
                </div>
                <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                  {autoLog.map((line, i) => (
                    <p key={i} className={`text-xs ${line.startsWith('✓') ? 'text-emerald-600' : line.startsWith('✗') ? 'text-rose-500' : line.startsWith('⚠') ? 'text-amber-600' : 'text-slate-500'}`}>{line}</p>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Шаблоны (компактный список для fallback) ─────── */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Шаблоны ответов</h3>
                <p className="mt-0.5 text-xs text-slate-400">Приоритет: ключевые слова → оценка → универсальный</p>
              </div>
              <button
                type="button"
                onClick={() => { setEditingTemplate(null); setTemplateModalOpen(true) }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
              >
                + Шаблон
              </button>
            </div>
            {isLoadingTemplates && <p className="py-4 text-center text-xs text-slate-400">Загрузка...</p>}
            {!isLoadingTemplates && templates.length === 0 && (
              <p className="py-4 text-center text-xs text-slate-400">Шаблонов нет. Нажмите «+ Шаблон».</p>
            )}
            <div className="flex flex-col gap-2">
              {templates.map((tpl) => (
                <div key={tpl.id} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-semibold text-slate-700">{tpl.name}</span>
                      {tpl.is_auto && <span className="rounded-full bg-blue-50 px-1.5 py-px text-[10px] font-bold text-blue-600">Авто</span>}
                      {tpl.trigger_ratings.length > 0 && <span className="text-[11px] text-amber-600">{tpl.trigger_ratings.map((r) => `${r}★`).join(' ')}</span>}
                      {tpl.trigger_keywords.length > 0 && <span className="rounded-full bg-slate-200 px-1.5 py-px text-[10px] text-slate-500">{tpl.trigger_keywords.slice(0, 2).join(', ')}{tpl.trigger_keywords.length > 2 ? ` +${tpl.trigger_keywords.length - 2}` : ''}</span>}
                      {tpl.trigger_ratings.length === 0 && tpl.trigger_keywords.length === 0 && <span className="rounded-full bg-emerald-50 px-1.5 py-px text-[10px] text-emerald-600">Универсальный</span>}
                    </div>
                    <p className="line-clamp-1 text-xs text-slate-400">{tpl.text}</p>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button type="button" onClick={() => { setEditingTemplate(tpl); setTemplateModalOpen(true) }} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600 transition">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                    <button type="button" onClick={() => setDeletingTemplate(tpl)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── Modals */}
      <AiSettingsModal
        open={aiSettingsModalOpen}
        initial={aiSettings}
        initialStorePrompt={activeStore?.ai_prompt ?? ''}
        systemPrompts={systemPrompts}
        storePrompts={storePrompts}
        onClose={() => setAiSettingsModalOpen(false)}
        onSubmit={handleSaveAiSettings}
        onSaveStorePrompt={handleSaveStorePrompt}
        onCreatePrompt={handleCreatePrompt}
        onUpdatePrompt={handleUpdatePrompt}
        onDeletePrompt={handleDeletePrompt}
      />

      <NegativeSendModal
        open={negativePending !== null}
        isLoading={negativePending ? sendingIds.has(negativePending.id) : false}
        onConfirm={() => {
          if (negativePending) void handleSendReply(negativePending, true)
          setNegativePending(null)
        }}
        onClose={() => setNegativePending(null)}
      />

      <TemplateFormModal
        open={templateModalOpen}
        initial={editingTemplate}
        onClose={() => { setTemplateModalOpen(false); setEditingTemplate(null) }}
        onSubmit={handleTemplateSubmit}
      />

      <DeleteConfirmModal
        open={deletingTemplate !== null}
        title="Удалить шаблон?"
        description={`Шаблон «${deletingTemplate?.name ?? ''}» будет удалён. Это действие нельзя отменить.`}
        isSubmitting={isDeletingTemplate}
        onClose={() => setDeletingTemplate(null)}
        onConfirm={() => void handleDeleteTemplate()}
      />

      {/* ── Модалка выбора магазинов ── */}
      {storeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setStoreModalOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-800">Выбор магазинов</h2>
              <button type="button" onClick={() => setStoreModalOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {/* Body */}
            <div className="h-[60vh] overflow-y-auto px-5 py-3">
              {storesWithKey.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">Нет магазинов с API-ключом</p>
              ) : (
                <>
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        const allIds = storesWithKey.map((s) => s.id)
                        const allSelected = allIds.every((id) => pendingStoreIds.includes(id))
                        setPendingStoreIds(allSelected ? [] : allIds)
                      }}
                      className="text-xs text-blue-500 hover:text-blue-700 transition"
                    >
                      {storesWithKey.every((s) => pendingStoreIds.includes(s.id)) ? 'Снять все' : 'Выбрать все'}
                    </button>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {storesWithKey.map((store) => {
                      const checked = pendingStoreIds.includes(store.id)
                      return (
                        <li key={store.id}>
                          <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors ${checked ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setPendingStoreIds(checked
                                  ? pendingStoreIds.filter((id) => id !== store.id)
                                  : [...pendingStoreIds, store.id]
                                )
                              }}
                              className="h-4 w-4 accent-blue-500"
                            />
                            <span className="text-sm font-medium text-slate-700">{store.name}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <span className="text-xs text-slate-400">
                {pendingStoreIds.length === 0 ? 'Не выбрано' : `Выбрано: ${pendingStoreIds.length}`}
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStoreModalOpen(false)} className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition">
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => {
                    saveAutoSettingsToStorage({ ...autoSettings, storeIds: pendingStoreIds })
                    setStoreModalOpen(false)
                  }}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Превью фото при наведении */}
      {photoPreview && (
        <div
          className="pointer-events-none fixed z-50 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-slate-200"
          style={{ left: photoPreview.x, top: photoPreview.y }}
        >
          <img src={photoPreview.url} alt="" className="h-96 w-72 object-cover" />
        </div>
      )}
    </div>
  )
}
