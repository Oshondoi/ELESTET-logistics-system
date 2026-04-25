import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { DeleteConfirmModal } from '../components/ui/DeleteConfirmModal'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Textarea } from '../components/ui/Textarea'
import { cn } from '../lib/utils'
import {
  createReviewTemplate,
  deleteReviewTemplate,
  fetchReviewTemplates,
  fetchWbFeedbacks,
  sendWbReply,
  updateReviewTemplate,
} from '../services/reviewsService'
import type { ReviewTemplate, ReviewTemplateFormValues, Store, WbFeedback } from '../types'

// ── Constants ──────────────────────────────────────────────────
// WB Feedbacks GET endpoint: 1 request per minute per API key
const COOLDOWN_SEC = 60

// ── Helpers ────────────────────────────────────────────────────

function applyTemplate(text: string, fb: WbFeedback): string {
  const buyer = fb.userName || 'Покупатель'
  const product = fb.productDetails?.productName || 'товар'
  return text
    .replace(/\{buyer_name\}/g, buyer)
    .replace(/\{product_name\}/g, product)
    .replace(/\{stars\}/g, String(fb.productValuation))
}

function matchTemplate(fb: WbFeedback, templates: ReviewTemplate[]): ReviewTemplate | null {
  const active = templates.filter((t) => t.is_auto)
  const reviewText = (fb.text ?? '').toLowerCase()

  // Priority 1: keyword match
  for (const tpl of active) {
    if (tpl.trigger_keywords.length > 0) {
      const hit = tpl.trigger_keywords.some(
        (kw) => kw.trim() && reviewText.includes(kw.trim().toLowerCase()),
      )
      if (hit) return tpl
    }
  }
  // Priority 2: rating match
  for (const tpl of active) {
    if (tpl.trigger_ratings.length > 0 && tpl.trigger_ratings.includes(fb.productValuation)) {
      return tpl
    }
  }
  // Priority 3: universal
  return (
    active.find((t) => t.trigger_ratings.length === 0 && t.trigger_keywords.length === 0) ?? null
  )
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
            <div className="text-sm font-medium text-slate-800">Авто-ответ</div>
            <div className="text-xs text-slate-500">Использовать при запуске авто-ответа</div>
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

// ── ReviewsPage ────────────────────────────────────────────────

interface ReviewsPageProps {
  stores: Store[]
  activeAccountId: string
  selectedStoreId: string
  onStoreChange: (id: string) => void
}

type Tab = 'queue' | 'answered' | 'templates'

export const ReviewsPage = ({
  stores,
  activeAccountId,
  selectedStoreId,
  onStoreChange,
}: ReviewsPageProps) => {
  const storesWithKey = stores.filter((s) => s.api_key)
  const activeStore =
    storesWithKey.find((s) => s.id === selectedStoreId) ?? storesWithKey[0] ?? null

  const [tab, setTab] = useState<Tab>('queue')

  // null = ещё не загружали, [] = загрузили, но пусто
  // Кэш: не обнуляется при переключении вкладок, только при смене магазина
  const [queueFeedbacks, setQueueFeedbacks] = useState<WbFeedback[] | null>(null)
  const [answeredFeedbacks, setAnsweredFeedbacks] = useState<WbFeedback[] | null>(null)
  const [countUnanswered, setCountUnanswered] = useState(0)

  const [isFetching, setIsFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Cooldown: WB разрешает 1 запрос к GET /feedbacks в минуту
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null)
  const [cooldownLeft, setCooldownLeft] = useState(0)

  // Reply state
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({})
  const [replyingIds, setReplyingIds] = useState<Set<string>>(new Set())
  const [repliedIds, setRepliedIds] = useState<Set<string>>(new Set())
  const [openReplyIds, setOpenReplyIds] = useState<Set<string>>(new Set())
  const [replyErrors, setReplyErrors] = useState<Record<string, string>>({})

  // Templates
  const [templates, setTemplates] = useState<ReviewTemplate[]>([])
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ReviewTemplate | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState<ReviewTemplate | null>(null)
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false)

  // Auto-run
  const [isAutoRunning, setIsAutoRunning] = useState(false)
  const [autoRunProgress, setAutoRunProgress] = useState<{ current: number; total: number } | null>(null)
  const [autoRunResult, setAutoRunResult] = useState<{ sent: number; failed: number } | null>(null)

  // Store dropdown
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false)
  const storeDropdownRef = useRef<HTMLDivElement | null>(null)

  // ── Load feedbacks (не зависит от tab – кэшируем по isAnswered)
  const loadFeedbacks = async (isAnswered: boolean) => {
    if (!activeStore?.api_key) return
    setIsFetching(true)
    setFetchError(null)
    try {
      const result = await fetchWbFeedbacks(activeStore.api_key, isAnswered)
      const now = Date.now()
      setLastFetchAt(now)
      setCooldownLeft(COOLDOWN_SEC)
      setCountUnanswered(result.countUnanswered)
      if (isAnswered) setAnsweredFeedbacks(result.feedbacks)
      else setQueueFeedbacks(result.feedbacks)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setIsFetching(false)
    }
  }

  // ── При смене магазина – сбрасываем весь кэш
  useEffect(() => {
    setQueueFeedbacks(null)
    setAnsweredFeedbacks(null)
    setFetchError(null)
    setCountUnanswered(0)
    setLastFetchAt(null)
    setCooldownLeft(0)
    setRepliedIds(new Set())
    setOpenReplyIds(new Set())
    setReplyTexts({})
    setReplyErrors({})
    setAutoRunResult(null)
  }, [activeStore?.id])

  // ── Авто-загрузка: только если данных ещё нет (не при каждом переключении вкладки!)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab === 'templates') return
    const isAnswered = tab === 'answered'
    const cached = isAnswered ? answeredFeedbacks : queueFeedbacks
    if (cached === null && activeStore?.api_key) {
      void loadFeedbacks(isAnswered)
    }
  }, [tab, activeStore?.id])

  // ── Таймер обратного отсчёта cooldown
  useEffect(() => {
    if (!lastFetchAt) return
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastFetchAt) / 1000)
      const left = Math.max(0, COOLDOWN_SEC - elapsed)
      setCooldownLeft(left)
      if (left === 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [lastFetchAt])

  // Load templates
  useEffect(() => {
    if (!activeAccountId) return
    setIsLoadingTemplates(true)
    fetchReviewTemplates(activeAccountId)
      .then(setTemplates)
      .catch(() => {})
      .finally(() => setIsLoadingTemplates(false))
  }, [activeAccountId])

  // Close store dropdown on outside click
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!storeDropdownRef.current?.contains(e.target as Node)) setStoreDropdownOpen(false)
    }
    window.addEventListener('pointerdown', handler)
    return () => window.removeEventListener('pointerdown', handler)
  }, [])

  const currentFeedbacks = tab === 'answered' ? answeredFeedbacks : queueFeedbacks
  const canRefresh = !isFetching && cooldownLeft === 0
  const autoTemplatesCount = templates.filter((t) => t.is_auto).length

  // ── Toggle reply area + auto-fill template
  const handleToggleReply = (fb: WbFeedback) => {
    setOpenReplyIds((prev) => {
      const n = new Set(prev)
      if (n.has(fb.id)) { n.delete(fb.id); return n }
      n.add(fb.id)
      return n
    })
    if (!replyTexts[fb.id]) {
      const tpl = matchTemplate(fb, templates)
      if (tpl) setReplyTexts((prev) => ({ ...prev, [fb.id]: applyTemplate(tpl.text, fb) }))
    }
  }

  // ── Send single reply
  const handleSendReply = async (fb: WbFeedback) => {
    if (!activeStore?.api_key) return
    const text = replyTexts[fb.id]?.trim()
    if (!text) return
    setReplyingIds((prev) => new Set(prev).add(fb.id))
    setReplyErrors((prev) => { const n = { ...prev }; delete n[fb.id]; return n })
    try {
      await sendWbReply(activeStore.api_key, fb.id, text)
      setRepliedIds((prev) => new Set(prev).add(fb.id))
      setQueueFeedbacks((prev) => prev ? prev.filter((f) => f.id !== fb.id) : prev)
      setOpenReplyIds((prev) => { const n = new Set(prev); n.delete(fb.id); return n })
    } catch (err) {
      setReplyErrors((prev) => ({
        ...prev,
        [fb.id]: err instanceof Error ? err.message : 'Ошибка отправки',
      }))
    } finally {
      setReplyingIds((prev) => { const n = new Set(prev); n.delete(fb.id); return n })
    }
  }

  // ── Auto-reply run
  const handleAutoRun = async () => {
    if (!activeStore?.api_key) return
    const pending = (queueFeedbacks ?? []).filter((f) => !repliedIds.has(f.id))
    const toSend: Array<{ fb: WbFeedback; text: string }> = []
    for (const fb of pending) {
      const tpl = matchTemplate(fb, templates)
      if (tpl) toSend.push({ fb, text: applyTemplate(tpl.text, fb) })
    }
    if (toSend.length === 0) {
      alert(
        autoTemplatesCount === 0
          ? 'Нет шаблонов с включённым авто-ответом. Создайте шаблон и включите «Авто-ответ».'
          : 'Нет подходящих шаблонов для оставшихся отзывов.',
      )
      return
    }
    const skipped = pending.length - toSend.length
    const ok = window.confirm(
      `Отправить авто-ответы на ${toSend.length} из ${pending.length} отзывов?` +
        (skipped > 0 ? `\n\n${skipped} отзывов без подходящего шаблона будут пропущены.` : ''),
    )
    if (!ok) return

    setIsAutoRunning(true)
    setAutoRunResult(null)
    setAutoRunProgress({ current: 0, total: toSend.length })

    let sent = 0; let failed = 0
    for (let i = 0; i < toSend.length; i++) {
      const { fb, text } = toSend[i]
      setAutoRunProgress({ current: i + 1, total: toSend.length })
      try {
        await sendWbReply(activeStore.api_key, fb.id, text)
        setRepliedIds((prev) => new Set(prev).add(fb.id))
        setQueueFeedbacks((prev) => prev ? prev.filter((f) => f.id !== fb.id) : prev)
        sent++
      } catch (_) {
        failed++
      }
      if (i < toSend.length - 1) await new Promise((r) => setTimeout(r, 500))
    }
    setAutoRunProgress(null)
    setAutoRunResult({ sent, failed })
    setIsAutoRunning(false)
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
          Для загрузки отзывов API-ключ WB должен иметь разрешение{' '}
          <strong>«Вопросы и отзывы»</strong>. Создайте или отредактируйте ключ в кабинете WB-продавца.
          {' '}Лимит WB API: <strong>1 запрос в минуту</strong> — кнопка «Обновить» активна раз в 60 секунд.
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
                  onClick={() => {
                    onStoreChange(s.id)
                    setStoreDropdownOpen(false)
                  }}
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

        {/* Unanswered badge from WB */}
        {tab === 'queue' && countUnanswered > 0 && (
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
            {countUnanswered} без ответа
          </span>
        )}

        {/* Spacer */}
        <div className="ml-auto flex items-center gap-2">
          {/* Auto-run info */}
          {tab === 'queue' && (
            <>
              {isAutoRunning && autoRunProgress && (
                <span className="text-xs text-slate-500">
                  Отправка {autoRunProgress.current}/{autoRunProgress.total}...
                </span>
              )}
              {autoRunResult && !isAutoRunning && (
                <span className="text-xs text-slate-500">
                  Отправлено: {autoRunResult.sent}
                  {autoRunResult.failed > 0 && `, ошибок: ${autoRunResult.failed}`}
                </span>
              )}
              <Button
                variant="secondary"
                onClick={() => void handleAutoRun()}
                disabled={isAutoRunning || isFetching || !queueFeedbacks?.length || autoTemplatesCount === 0}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                {isAutoRunning ? 'Отправка...' : 'Авто-ответ'}
              </Button>
            </>
          )}

          {/* Refresh with cooldown */}
          {tab !== 'templates' && (
            <Button
              variant="secondary"
              onClick={() => void loadFeedbacks(tab === 'answered')}
              disabled={!canRefresh}
              title={cooldownLeft > 0 ? `WB разрешает 1 запрос в минуту. Осталось ${cooldownLeft}с` : ''}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {isFetching
                ? '...'
                : cooldownLeft > 0
                  ? `Обновить (${cooldownLeft}с)`
                  : 'Обновить'}
            </Button>
          )}
        </div>
      </div>

      {/* ── Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            { key: 'queue' as Tab, label: 'Без ответа' },
            { key: 'answered' as Tab, label: 'Отвечено' },
            {
              key: 'templates' as Tab,
              label: `Шаблоны${templates.length > 0 ? ` (${templates.length})` : ''}`,
            },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              tab === key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Queue / Answered */}
      {tab !== 'templates' && (
        <div className="flex flex-col gap-3">

          {/* Loading */}
          {isFetching && currentFeedbacks === null && (
            <div className="py-14 text-center text-sm text-slate-400">Загрузка отзывов...</div>
          )}

          {/* Error */}
          {!isFetching && fetchError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {fetchError}
            </div>
          )}

          {/* Empty – loaded but no reviews */}
          {!isFetching && !fetchError && currentFeedbacks !== null && currentFeedbacks.length === 0 && (
            <div className="py-16 text-center text-sm text-slate-400">
              {tab === 'queue'
                ? 'Все отзывы отвечены — отличная работа!'
                : 'Отвеченных отзывов нет.'}
            </div>
          )}

          {/* Feedback cards */}
          {(currentFeedbacks ?? []).map((fb) => {
            const isReplying = replyingIds.has(fb.id)
            const isReplied = repliedIds.has(fb.id)
            const replyOpen = openReplyIds.has(fb.id)
            const replyError = replyErrors[fb.id]
            const autoMatch = matchTemplate(fb, templates)

            return (
              <div
                key={fb.id}
                className={cn(
                  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-opacity',
                  isReplied && 'opacity-40',
                )}
              >
                {/* Top row */}
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
                      {fb.text
                        ? fb.text
                        : <span className="italic text-slate-400">Отзыв без текста</span>}
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
                    {(fb.photoLinks ?? []).slice(0, 6).map((url, i) => (
                      <img key={i} src={url} alt="" className="h-14 w-14 rounded-xl object-cover" />
                    ))}
                  </div>
                )}

                {/* Reply area (queue only) */}
                {tab === 'queue' && !isReplied && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {!replyOpen ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleReply(fb)}
                          className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200"
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
                          </svg>
                          Ответить
                        </button>
                        {autoMatch ? (
                          <span className="text-xs text-slate-400">
                            Авто: <span className="text-blue-500">{autoMatch.name}</span>
                          </span>
                        ) : (
                          autoTemplatesCount > 0 && (
                            <span className="text-xs italic text-slate-400">нет подходящего шаблона</span>
                          )
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        <textarea
                          value={replyTexts[fb.id] ?? ''}
                          onChange={(e) =>
                            setReplyTexts((prev) => ({ ...prev, [fb.id]: e.target.value }))
                          }
                          rows={3}
                          placeholder="Текст ответа..."
                          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none"
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
                                  setReplyTexts((prev) => ({
                                    ...prev,
                                    [fb.id]: applyTemplate(tpl.text, fb),
                                  }))
                                }
                                className={cn(
                                  'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                                  autoMatch?.id === tpl.id
                                    ? 'border-blue-300 bg-blue-50 text-blue-600'
                                    : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600',
                                )}
                              >
                                {tpl.name}
                              </button>
                            ))}
                          </div>
                        )}

                        {replyError && <p className="text-xs text-rose-500">{replyError}</p>}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenReplyIds((prev) => {
                                const n = new Set(prev); n.delete(fb.id); return n
                              })
                            }
                            className="text-xs text-slate-400 transition-colors hover:text-slate-600"
                          >
                            Отмена
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSendReply(fb)}
                            disabled={isReplying || !replyTexts[fb.id]?.trim()}
                            className="ml-auto rounded-xl bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                          >
                            {isReplying ? 'Отправка...' : 'Отправить'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isReplied && (
                  <div className="mt-2 text-xs font-medium text-green-600">✓ Ответ отправлен</div>
                )}
              </div>
            )
          })}

          {/* Showing only 100 */}
          {(currentFeedbacks ?? []).length >= 100 && (
            <p className="py-2 text-center text-xs text-slate-400">
              Показаны 100 последних отзывов. Для полного списка используйте кабинет WB-продавца.
            </p>
          )}
        </div>
      )}

      {/* ── Templates tab */}
      {tab === 'templates' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <p className="max-w-lg text-sm text-slate-500">
              Шаблоны используются при ручном ответе и авто-ответе.{' '}
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
              <p className="text-xs text-slate-400">
                Создайте шаблон и включите «Авто-ответ» для автоматической отправки.
              </p>
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
    </div>
  )
}
