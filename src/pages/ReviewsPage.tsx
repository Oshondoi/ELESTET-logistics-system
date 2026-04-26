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

type Tab = 'queue' | 'answered' | 'templates' | 'test'

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

  // Store dropdown
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false)
  const storeDropdownRef = useRef<HTMLDivElement | null>(null)

  // ── Load AI settings on mount / account change
  useEffect(() => {
    if (!activeAccountId) return
    getAiSettings(activeAccountId).then(setAiSettings).catch(() => {})
  }, [activeAccountId])

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
    if (!aiSettings?.openai_key) {
      setGenErrors((prev) => ({
        ...prev,
        [row.id]: 'OpenAI API-ключ не настроен. Нажмите кнопку «⚙ Настройки ИИ».',
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

  // ── Save store prompt
  const handleSaveStorePrompt = async (prompt: string) => {
    if (!activeStore?.id) return
    await saveStorePrompt(activeStore.id, prompt)
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
    if (!aiSettings?.openai_key) {
      setTestError('Сначала настройте OpenAI API-ключ (кнопка «⚙ Настройки ИИ»).')
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
              aiSettings?.openai_key
                ? 'border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
            )}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {aiSettings?.openai_key ? 'ИИ настроен' : 'Настройки ИИ'}
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
            { key: 'templates' as Tab, label: `Шаблоны${templates.length > 0 ? ` (${templates.length})` : ''}` },
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

          {!aiSettings?.openai_key && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
              </svg>
              <span className="text-sm text-slate-600">
                OpenAI API-ключ не настроен.{' '}
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
          {tab === 'queue' && !aiSettings?.openai_key && (currentRows ?? []).length > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-violet-400" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <span className="text-sm text-violet-700">
                ИИ-ответы недоступны — OpenAI ключ не настроен.{' '}
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
                          title={!aiSettings?.openai_key ? 'Настройте OpenAI ключ (кнопка «⚙ Настройки ИИ»)' : ''}
                          className={cn(
                            'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors',
                            aiSettings?.openai_key
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
                          {aiSettings?.openai_key && (
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
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <p className="max-w-lg text-sm text-slate-500">
              Шаблоны для ручного заполнения ответа.{' '}
              <strong className="text-slate-600">Приоритет:</strong> ключевые слова → оценка → универсальный.
            </p>
            <Button
              onClick={() => { setEditingTemplate(null); setTemplateModalOpen(true) }}
              className="shrink-0"
            >
              + Шаблон
            </Button>
          </div>

          {isLoadingTemplates && (
            <div className="py-8 text-center text-sm text-slate-400">Загрузка...</div>
          )}

          {!isLoadingTemplates && templates.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center">
              <p className="mb-1 text-sm font-medium text-slate-600">Шаблонов пока нет</p>
              <p className="text-xs text-slate-400">Создайте шаблон для быстрого заполнения ответа.</p>
            </div>
          )}

          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{tpl.name}</span>
                  {tpl.is_auto && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-600">
                      Авто
                    </span>
                  )}
                  {tpl.trigger_ratings.length > 0 && (
                    <span className="text-[11px] text-amber-600">
                      {tpl.trigger_ratings.map((r) => `${r}★`).join(' ')}
                    </span>
                  )}
                  {tpl.trigger_keywords.length > 0 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                      {tpl.trigger_keywords.slice(0, 3).join(', ')}
                      {tpl.trigger_keywords.length > 3 ? ` +${tpl.trigger_keywords.length - 3}` : ''}
                    </span>
                  )}
                  {tpl.trigger_ratings.length === 0 && tpl.trigger_keywords.length === 0 && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-600">
                      Универсальный
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-sm text-slate-500">{tpl.text}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => { setEditingTemplate(tpl); setTemplateModalOpen(true) }}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingTemplate(tpl)}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modals */}
      <AiSettingsModal
        open={aiSettingsModalOpen}
        initial={aiSettings}
        initialStorePrompt={activeStore?.ai_prompt ?? ''}
        onClose={() => setAiSettingsModalOpen(false)}
        onSubmit={handleSaveAiSettings}
        onSaveStorePrompt={handleSaveStorePrompt}
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
