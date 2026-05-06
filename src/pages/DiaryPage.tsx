import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiaryEntry {
  id: string
  user_id: string
  date: string // YYYY-MM-DD
  day_summary: string
  tasks_done: string[]
  tasks_tomorrow: string[]
  media_urls: string[]
  ai_review: string | null
  created_at: string
  updated_at: string
}

interface AiSettings {
  claude_key: string
  claude_model: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface DiaryPageProps {
  userId: string
  userEmail: string
  userName: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDateRu(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatDateShortRu(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function getDayOfWeekRu(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  return days[d.getDay()]
}

// ─── Claude API call ──────────────────────────────────────────────────────────

async function callClaude(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  maxTokens = 1000,
): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  })

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({})) as { error?: { message?: string } }
    if (resp.status === 401) throw new Error('Неверный Claude API-ключ')
    if (resp.status === 429) throw new Error('Превышен лимит Claude. Попробуйте позже.')
    throw new Error(`Claude API error ${resp.status}: ${errData.error?.message ?? ''}`)
  }

  type ClaudeResp = { content: Array<{ type: string; text: string }> }
  const json = (await resp.json()) as ClaudeResp
  return json.content.find((b) => b.type === 'text')?.text?.trim() ?? ''
}

// ─── TaskList sub-component ───────────────────────────────────────────────────

interface TaskListProps {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
}

const TaskList = ({ label, items, onChange, placeholder }: TaskListProps) => {
  const [draft, setDraft] = useState('')

  const add = () => {
    const val = draft.trim()
    if (!val) return
    onChange([...items, val])
    setDraft('')
  }

  const remove = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i))
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); add() }
  }

  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-700">{label}</div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder ?? 'Введите задачу...'}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <button
          type="button"
          onClick={add}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition"
          aria-label="Добавить"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="m5 13 4 4L19 7" />
              </svg>
              <span className="flex-1">{item}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="ml-auto text-slate-400 hover:text-rose-500 transition"
                aria-label="Удалить"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export const DiaryPage = ({ userId, userEmail: _userEmail, userName }: DiaryPageProps) => {
  // ── View ────────────────────────────────────────────────────────────────────
  const [view, setView] = useState<'timeline' | 'entry'>('timeline')
  const [selectedDate, setSelectedDate] = useState<string>(todayISO())

  // ── Data ────────────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [isLoadingEntries, setIsLoadingEntries] = useState(true)

  // ── AI Settings (diary-specific, stored in localStorage) ───────────────────
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(() => {
    const key = window.localStorage.getItem('elestet-diary-claude-key') ?? ''
    const model = window.localStorage.getItem('elestet-diary-claude-model') ?? 'claude-sonnet-4-6'
    return key ? { claude_key: key, claude_model: model } : null
  })
  const [showAiSettings, setShowAiSettings] = useState(false)
  const [activeAiTab, setActiveAiTab] = useState<'model' | 'pricing' | 'photo'>('model')
  const [draftKey, setDraftKey] = useState(() => window.localStorage.getItem('elestet-diary-claude-key') ?? '')
  const [draftModel, setDraftModel] = useState(() => window.localStorage.getItem('elestet-diary-claude-model') ?? 'claude-sonnet-4-6')

  // ── Form ────────────────────────────────────────────────────────────────────
  const [summary, setSummary] = useState('')
  const [tasksDone, setTasksDone] = useState<string[]>([])
  const [tasksTomorrow, setTasksTomorrow] = useState<string[]>([])
  const [mediaUrls, setMediaUrls] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Voice ───────────────────────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  // ── AI Review ───────────────────────────────────────────────────────────────
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [aiReview, setAiReview] = useState<string | null>(null)

  // ── Media upload ────────────────────────────────────────────────────────────
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ── Chat ────────────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement | null>(null)

  // ─── Load all entries ──────────────────────────────────────────────────────
  const loadEntries = useCallback(async () => {
    if (!supabase) return
    setIsLoadingEntries(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('diary_entries')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false })
      if (error) throw error
      setEntries((data ?? []) as DiaryEntry[])
    } catch {
      // ignore — table might not exist yet
    } finally {
      setIsLoadingEntries(false)
    }
  }, [userId])

  const saveAiKey = () => {
    const key = draftKey.trim()
    const model = draftModel.trim() || 'claude-sonnet-4-6'
    if (key) {
      window.localStorage.setItem('elestet-diary-claude-key', key)
      window.localStorage.setItem('elestet-diary-claude-model', model)
      setAiSettings({ claude_key: key, claude_model: model })
    } else {
      window.localStorage.removeItem('elestet-diary-claude-key')
      window.localStorage.removeItem('elestet-diary-claude-model')
      setAiSettings(null)
    }
    setShowAiSettings(false)
  }

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  // ─── Populate form when selectedDate changes ────────────────────────────────
  useEffect(() => {
    const entry = entries.find((e) => e.date === selectedDate)
    if (entry) {
      setSummary(entry.day_summary)
      setTasksDone(entry.tasks_done)
      setTasksTomorrow(entry.tasks_tomorrow)
      setMediaUrls(entry.media_urls)
      setAiReview(entry.ai_review)
    } else {
      setSummary('')
      setTasksDone([])
      setTasksTomorrow([])
      setMediaUrls([])
      setAiReview(null)
    }
  }, [selectedDate, entries])

  // ─── Scroll chat to bottom ──────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // ─── Save entry ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!supabase) return
    setSaveError(null)
    setIsSaving(true)
    try {
      const payload = {
        user_id: userId,
        date: selectedDate,
        day_summary: summary.trim(),
        tasks_done: tasksDone,
        tasks_tomorrow: tasksTomorrow,
        media_urls: mediaUrls,
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('diary_entries')
        .upsert(payload, { onConflict: 'user_id,date' })
        .select()
        .single()
      if (error) throw error
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.date === selectedDate)
        if (idx >= 0) { const copy = [...prev]; copy[idx] = data as DiaryEntry; return copy }
        return [data as DiaryEntry, ...prev].sort((a, b) => b.date.localeCompare(a.date))
      })

      // Auto AI review after save
      if (aiSettings?.claude_key && (summary.trim() || tasksDone.length > 0)) {
        void runAiReview(data as DiaryEntry, aiSettings)
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setIsSaving(false)
    }
  }

  // ─── AI Review ────────────────────────────────────────────────────────────
  const runAiReview = async (entry: DiaryEntry, settings: AiSettings) => {
    setIsAnalyzing(true)
    try {
      const entryText = [
        entry.day_summary ? `Как прошёл день:\n${entry.day_summary}` : '',
        entry.tasks_done.length > 0 ? `\nСделано сегодня:\n${entry.tasks_done.map((t) => `• ${t}`).join('\n')}` : '',
        entry.tasks_tomorrow.length > 0 ? `\nЗадачи на завтра:\n${entry.tasks_tomorrow.map((t) => `• ${t}`).join('\n')}` : '',
      ].filter(Boolean).join('\n')

      const systemPrompt = `Ты личный наставник. Пользователь ведёт дневник. 
Прочитай его запись дня и дай честный разбор: 
где он просчитался, где был слаб, почему это важно 
и к чему может привести. Не осуждай — разбирай 
как тренер. Будь конкретным и кратким. Язык: русский.`

      const review = await callClaude(
        settings.claude_key,
        settings.claude_model,
        systemPrompt,
        [{ role: 'user', content: `Дата: ${formatDateRu(entry.date)}\n\n${entryText}` }],
        600,
      )
      setAiReview(review)

      // Save review to DB
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('diary_entries')
        .update({ ai_review: review })
        .eq('id', entry.id)

      setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, ai_review: review } : e))
    } catch (err) {
      setAiReview(`Ошибка анализа: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`)
    } finally {
      setIsAnalyzing(false)
    }
  }

  // ─── Voice input ──────────────────────────────────────────────────────────
  const toggleRecording = () => {
    const SpeechRec = (window as Window & typeof globalThis & { SpeechRecognition?: typeof SpeechRecognition; webkitSpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition
      ?? (window as Window & typeof globalThis & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition

    if (!SpeechRec) {
      alert('Голосовой ввод не поддерживается вашим браузером')
      return
    }

    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }

    const rec = new SpeechRec()
    rec.lang = 'ru-RU'
    rec.continuous = true
    rec.interimResults = false

    rec.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .map((r) => r[0].transcript)
        .join(' ')
      setSummary((prev) => prev + (prev ? ' ' : '') + transcript.trim())
    }

    rec.onerror = () => { setIsRecording(false) }
    rec.onend = () => { setIsRecording(false) }

    rec.start()
    recognitionRef.current = rec
    setIsRecording(true)
  }

  // ─── Media upload ─────────────────────────────────────────────────────────
  const handleMediaUpload = async (files: FileList | null) => {
    if (!files || !supabase) return
    setIsUploading(true)
    const uploaded: string[] = []
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop() ?? 'bin'
        const path = `${userId}/${selectedDate}/${crypto.randomUUID()}.${ext}`
        const { error } = await supabase.storage.from('diary-media').upload(path, file, { upsert: false })
        if (error) throw error
        const { data } = supabase.storage.from('diary-media').getPublicUrl(path)
        // Public URL might be private — use signed URL approach
        const { data: signedData } = await supabase.storage.from('diary-media').createSignedUrl(path, 60 * 60 * 24 * 365)
        uploaded.push(signedData?.signedUrl ?? data.publicUrl)
      }
      setMediaUrls((prev) => [...prev, ...uploaded])
    } catch (err) {
      alert(`Ошибка загрузки: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}`)
    } finally {
      setIsUploading(false)
    }
  }

  const removeMedia = (url: string) => {
    setMediaUrls((prev) => prev.filter((u) => u !== url))
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────
  const handleChatSend = async () => {
    const text = chatInput.trim()
    if (!text || isChatLoading || !aiSettings?.claude_key) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    const newMessages = [...chatMessages, userMsg]
    setChatMessages(newMessages)
    setChatInput('')
    setIsChatLoading(true)

    try {
      // Build context from last 30 entries
      const last30 = [...entries].slice(0, 30).reverse()
      const contextBlock = last30.length > 0
        ? last30.map((e) => {
          const parts = [
            `## ${formatDateRu(e.date)}`,
            e.day_summary ? e.day_summary : '',
            e.tasks_done.length > 0 ? `Сделано: ${e.tasks_done.join(', ')}` : '',
            e.tasks_tomorrow.length > 0 ? `На завтра: ${e.tasks_tomorrow.join(', ')}` : '',
            e.ai_review ? `Разбор дня: ${e.ai_review}` : '',
          ].filter(Boolean).join('\n')
          return parts
        }).join('\n\n---\n\n')
        : 'Записей в дневнике пока нет.'

      const systemPrompt = `Ты — личный помощник и коуч ${userName || 'владельца'}. 
У тебя есть полный доступ к его/её дневнику ELESTET — записям о рабочих днях, задачах, достижениях и неудачах.
Отвечай честно, конкретно, по-деловому. Используй данные из дневника в своих ответах.
Если человек спрашивает о трендах, паттернах или прогрессе — анализируй записи.

ДНЕВНИК (последние ${last30.length} записей):
${contextBlock}`

      const reply = await callClaude(
        aiSettings.claude_key,
        aiSettings.claude_model,
        systemPrompt,
        newMessages,
        1000,
      )

      setChatMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Ошибка: ${err instanceof Error ? err.message : 'Неизвестная ошибка'}` },
      ])
    } finally {
      setIsChatLoading(false)
    }
  }

  const handleChatKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleChatSend() }
  }

  // ─── Navigation helpers ──────────────────────────────────────────────────────
  const openDate = (date: string) => {
    setSelectedDate(date)
  }

  const openEntry = (date: string) => {
    setSelectedDate(date)
    setView('entry')
  }

  const openToday = () => { openEntry(todayISO()) }

  // ─── Generate timeline dates (last 90 days + today if not included) ─────────
  const timelineDates = (() => {
    const today = todayISO()
    const dates: string[] = []
    for (let i = 89; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      dates.push(d.toISOString().slice(0, 10))
    }
    if (!dates.includes(today)) dates.push(today)
    return dates
  })()

  const entryByDate = Object.fromEntries(entries.map((e) => [e.date, e]))

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col gap-4">

      {/* Header tabs */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm">
          {(['timeline', 'entry'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'rounded-[10px] px-4 py-1.5 text-sm font-medium transition',
                view === v ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {v === 'timeline' ? 'Таймлайн' : 'Запись дня'}
            </button>
          ))}
        </div>

        {/* AI settings button */}
        <button
          type="button"
          onClick={() => { setDraftKey(aiSettings?.claude_key ?? ''); setDraftModel(aiSettings?.claude_model ?? 'claude-sonnet-4-6'); setShowAiSettings((s) => !s) }}
          title="Настройки Claude AI для Дневника"
          className={cn(
            'flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition',
            aiSettings?.claude_key
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
          )}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {aiSettings?.claude_key ? 'AI подключён' : 'Настроить AI'}
        </button>

        {view === 'timeline' && (
          <button
            type="button"
            onClick={() => openEntry(selectedDate)}
            className="ml-auto flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Запись
          </button>
        )}

        {view === 'entry' && (
          <span className="ml-auto text-sm font-medium text-slate-500">
            {formatDateRu(selectedDate)}
          </span>
        )}
      </div>

      {/* AI Settings modal */}
      <Modal
        open={showAiSettings}
        onClose={() => setShowAiSettings(false)}
        title="Настройки Claude AI — Дневник"
        className="max-w-5xl"
        headerContent={
          <div className="flex gap-1 pb-3">
            {([
              { id: 'model' as const, label: 'Выбор модели' },
              { id: 'pricing' as const, label: 'Цены на текст' },
              { id: 'photo' as const, label: 'Цены на фото' },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveAiTab(tab.id)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                  activeAiTab === tab.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
        footer={
          activeAiTab === 'model' ? (
            <div className="flex items-center gap-2">
              <Button onClick={saveAiKey}>Сохранить</Button>
              {aiSettings?.claude_key && (
                <button
                  type="button"
                  onClick={() => {
                    window.localStorage.removeItem('elestet-diary-claude-key')
                    window.localStorage.removeItem('elestet-diary-claude-model')
                    setAiSettings(null)
                    setDraftKey('')
                    setShowAiSettings(false)
                  }}
                  className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 transition"
                >
                  Удалить ключ
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {/* ── Tab: Выбор модели ── */}
        {activeAiTab === 'model' && (
          <div className="space-y-6">
            {/* API Key */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Claude API-ключ</label>
              <input
                type="password"
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-800 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1.5 text-[11px] text-slate-400">
                Ключ хранится только в браузере. Получить ключ:{' '}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 underline hover:text-blue-700 transition"
                >
                  console.anthropic.com/settings/keys
                </a>
              </p>
            </div>

            {/* Model cards */}
            <div>
              <div className="mb-3 text-xs font-medium text-slate-600">Модель</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {([
                  {
                    id: 'claude-opus-4-7',
                    name: 'Claude Opus 4',
                    badge: 'Мощнейший',
                    badgeColor: 'bg-violet-100 text-violet-700',
                    desc: 'Самый умный Claude. Глубокий анализ, сложные рассуждения, детальные разборы. Для тех, кому важно качество.',
                    inputPrice: '$15',
                    outputPrice: '$75',
                    costPerRequest: '~$0.03',
                    speedLabel: 'Медленнее',
                    formats: 'Текст · Фото',
                  },
                  {
                    id: 'claude-sonnet-4-6',
                    name: 'Claude Sonnet 4',
                    badge: 'Рекомендуем',
                    badgeColor: 'bg-blue-100 text-blue-700',
                    desc: 'Лучший баланс ума и скорости. Отвечает быстро и качественно — идеален для ежедневного дневника.',
                    inputPrice: '$3',
                    outputPrice: '$15',
                    costPerRequest: '~$0.004',
                    speedLabel: 'Быстро',
                    formats: 'Текст · Фото',
                  },
                  {
                    id: 'claude-haiku-4-5-20251001',
                    name: 'Claude Haiku 4.5',
                    badge: 'Быстрейший',
                    badgeColor: 'bg-emerald-100 text-emerald-700',
                    desc: 'Самый быстрый и дешёвый. Хорошо справляется с короткими записями. Глубины меньше, скорость максимальная.',
                    inputPrice: '$0.80',
                    outputPrice: '$4',
                    costPerRequest: '~$0.001',
                    speedLabel: 'Быстрейший',
                    formats: 'Текст · Фото',
                  },
                  {
                    id: 'claude-3-7-sonnet-20250219',
                    name: 'Claude 3.7 Sonnet',
                    badge: 'Мыслитель',
                    badgeColor: 'bg-amber-100 text-amber-700',
                    desc: 'Умеет "думать вслух" (расширенное мышление). Разбирает запутанные ситуации шаг за шагом.',
                    inputPrice: '$3',
                    outputPrice: '$15',
                    costPerRequest: '~$0.004',
                    speedLabel: 'Среднее',
                    formats: 'Текст · Фото',
                  },
                  {
                    id: 'claude-3-5-sonnet-20241022',
                    name: 'Claude 3.5 Sonnet',
                    badge: 'Стабильный',
                    badgeColor: 'bg-slate-100 text-slate-600',
                    desc: 'Проверенная версия 2024 года. Надёжный, предсказуемый результат. Хорошо знаком разработчикам.',
                    inputPrice: '$3',
                    outputPrice: '$15',
                    costPerRequest: '~$0.004',
                    speedLabel: 'Быстро',
                    formats: 'Текст · Фото',
                  },
                  {
                    id: 'claude-3-5-haiku-20241022',
                    name: 'Claude 3.5 Haiku',
                    badge: 'Бюджетный',
                    badgeColor: 'bg-teal-100 text-teal-700',
                    desc: 'Самая дешёвая актуальная модель. Для базовых запросов и тестирования. Качество чуть ниже Sonnet.',
                    inputPrice: '$0.80',
                    outputPrice: '$4',
                    costPerRequest: '~$0.001',
                    speedLabel: 'Быстрейший',
                    formats: 'Текст · Фото',
                  },
                ] as const).map((m) => {
                  const isSelected = draftModel === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setDraftModel(m.id)}
                      className={cn(
                        'flex flex-col gap-2 rounded-2xl border p-4 text-left transition',
                        isSelected
                          ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[13px] font-semibold text-slate-800">{m.name}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-slate-400">{m.id}</div>
                        </div>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', m.badgeColor)}>
                          {m.badge}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-500">{m.desc}</p>
                      <div className="flex items-center gap-1">
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{m.formats}</span>
                        <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">Видео ✗</span>
                      </div>
                      <div className="mt-auto border-t border-slate-100 pt-2.5 flex items-end justify-between gap-2">
                        <div className="flex gap-3">
                          <div>
                            <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">Запрос → ИИ</div>
                            <div className="text-[12px] font-bold text-slate-700">{m.inputPrice}<span className="text-[9px] font-normal text-slate-400"> /млн</span></div>
                          </div>
                          <div>
                            <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">ИИ → Ответ</div>
                            <div className="text-[12px] font-bold text-slate-700">{m.outputPrice}<span className="text-[9px] font-normal text-slate-400"> /млн</span></div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400">Запись в дневник</div>
                          <div className="text-[12px] font-bold text-emerald-600">{m.costPerRequest}</div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Цены на текст ── */}
        {activeAiTab === 'pricing' && (
          <div className="space-y-6 text-[13px] text-slate-600 leading-relaxed">
            {/* Tokens */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="mb-3 text-[15px] font-semibold text-slate-800">Что такое токены?</div>
              <p className="mb-2">
                Claude не читает текст как человек — он делит его на <strong className="text-slate-800">токены</strong>.
                Один токен ≈ <strong className="text-slate-800">¾ слова</strong> (или 3–4 буквы).
              </p>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
                  <div className="text-[11px] text-slate-400 mb-1">Одно слово</div>
                  <div className="text-[18px] font-bold text-slate-800">1–2</div>
                  <div className="text-[11px] text-slate-400">токена</div>
                </div>
                <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
                  <div className="text-[11px] text-slate-400 mb-1">Запись дневника</div>
                  <div className="text-[18px] font-bold text-slate-800">~500</div>
                  <div className="text-[11px] text-slate-400">токенов</div>
                </div>
                <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
                  <div className="text-[11px] text-slate-400 mb-1">Ответ ИИ</div>
                  <div className="text-[18px] font-bold text-slate-800">~300</div>
                  <div className="text-[11px] text-slate-400">токенов</div>
                </div>
              </div>
            </div>

            {/* Запрос vs Ответ */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="mb-3 text-[15px] font-semibold text-slate-800">Запрос → ИИ vs ИИ → Ответ</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
                  <div className="mb-1 text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Запрос → ИИ</div>
                  <p className="text-[12px] text-slate-600">Всё что вы отправляете: текст записи, список задач, контекст последних 30 дней для чата.</p>
                  <div className="mt-2 text-[12px] font-bold text-blue-700">Дешевле</div>
                </div>
                <div className="rounded-xl bg-violet-50 border border-violet-100 p-3">
                  <div className="mb-1 text-[11px] font-semibold text-violet-700 uppercase tracking-wide">ИИ → Ответ</div>
                  <p className="text-[12px] text-slate-600">Всё что генерирует модель: разбор дня, советы, ответы в чате.</p>
                  <div className="mt-2 text-[12px] font-bold text-violet-700">Дороже (в 5× у Sonnet)</div>
                </div>
              </div>
            </div>

            {/* Что значит $3/1М */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="mb-3 text-[15px] font-semibold text-slate-800">Что значит $3/млн токенов?</div>
              <p className="mb-3">
                За один миллион токенов вы платите $3. Это очень дёшево:
              </p>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-white border-b border-slate-100">
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Действие</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Токенов</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Sonnet ($3/$15)</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600">Haiku ($0.8/$4)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      ['Разбор 1 записи дня', '~800', '~$0.004', '~$0.001'],
                      ['Разбор + фото', '~2000', '~$0.010', '~$0.003'],
                      ['Чат (30 дней контекст)', '~15000', '~$0.075', '~$0.020'],
                      ['100 записей в месяц', '~80K', '~$0.40', '~$0.10'],
                      ['365 записей в год', '~300K', '~$1.50', '~$0.40'],
                    ].map(([action, tokens, sonnet, haiku]) => (
                      <tr key={action} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-700">{action}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{tokens}</td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-600">{sonnet}</td>
                        <td className="px-3 py-2 text-right font-medium text-teal-600">{haiku}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Смена тарифа */}
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="mb-2 text-[15px] font-semibold text-amber-900">Что если переключить модель в середине?</div>
              <p className="mb-3 text-amber-800">
                Каждый запрос оплачивается <strong>независимо</strong> — по тарифу той модели, которая была выбрана <strong>в момент этого конкретного запроса</strong>.
              </p>
              <div className="space-y-2 text-[12px]">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">Sonnet</span>
                  <span className="text-amber-800">2 записи → считаются по $3/млн (Sonnet)</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 font-medium text-[11px] mt-0.5">↓ сменили модель</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">Haiku</span>
                  <span className="text-amber-800">5 записей → считаются по $0.80/млн (Haiku)</span>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-amber-700">
                Прошлые записи <strong>не пересчитываются</strong>. Нет подписки, нет минимального платежа — платите только за то, что используете.
              </p>
            </div>
          </div>
        )}

        {/* ── Tab: Цены на фото ── */}
        {activeAiTab === 'photo' && (
          <div className="space-y-6">
            {/* Formula */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="mb-2 text-[15px] font-semibold text-slate-800">Как фото переводится в токены?</div>
              <p className="mb-3 text-[13px] text-slate-600">
                Claude не «видит» пиксели напрямую — изображение кодируется в токены по формуле:
              </p>
              <code className="inline-block rounded-xl bg-white border border-slate-200 px-4 py-2.5 font-mono text-[13px] text-slate-700">
                токены ≈ (ширина × высота) / 750
              </code>
              <p className="mt-3 text-[12px] text-slate-500">
                Фото считается как <strong className="text-slate-700">Запрос → ИИ</strong> (дешёвая ставка). Ответ ИИ — только текст.
              </p>
            </div>

            {/* Table */}
            <div>
              <div className="mb-2 text-[13px] font-semibold text-slate-700">Стоимость по размерам</div>
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Размер</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Пример</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-slate-600">Токены</th>
                      <th className="px-3 py-2.5 text-right font-semibold text-violet-600">
                        <div>Opus 4</div>
                        <div className="text-[10px] font-normal text-slate-400">$15/млн</div>
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold text-emerald-600">
                        <div>Sonnet 4 · 3.7 · 3.5</div>
                        <div className="text-[10px] font-normal text-slate-400">$3/млн (все трое)</div>
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold text-teal-600">
                        <div>Haiku 4.5 · 3.5</div>
                        <div className="text-[10px] font-normal text-slate-400">$0.8/млн (оба)</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      ['256×256', 'Иконка / аватар', '~87', '$0.0013', '$0.0003', '$0.00007'],
                      ['480×360', 'Телефон SD / скрин', '~230', '$0.0035', '$0.0007', '$0.0002'],
                      ['800×600', 'Обычное фото', '~640', '$0.0096', '$0.002', '$0.0005'],
                      ['1024×768', 'Скриншот экрана', '~1049', '$0.016', '$0.003', '$0.0008'],
                      ['1200×900', 'Хорошее фото', '~1440', '$0.022', '$0.004', '$0.001'],
                      ['1920×1080', 'Full HD', '~2765', '$0.041', '$0.008', '$0.002'],
                      ['1568×1568', 'Макс без сжатия', '~3276', '$0.049', '$0.010', '$0.003'],
                      ['4000×3000', '→ авто-сжатие до 1568px', '~3276', '$0.049', '$0.010', '$0.003'],
                    ].map(([size, label, tokens, opus, sonnet, haiku]) => (
                      <tr key={size} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-slate-600">{size}</td>
                        <td className="px-3 py-2 text-slate-500">{label}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{tokens}</td>
                        <td className="px-3 py-2 text-right font-medium text-violet-600">{opus}</td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-600">{sonnet}</td>
                        <td className="px-3 py-2 text-right font-medium text-teal-600">{haiku}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Notes */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-2.5 text-[12px] text-slate-600">
              <div className="text-[13px] font-semibold text-slate-800 mb-3">Важно знать</div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-slate-400">•</span>
                <span>Anthropic <strong className="text-slate-700">автоматически сжимает</strong> фото до 1568px по длинной стороне. Платите не больше строки «Макс».</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-slate-400">•</span>
                <span>Фото считается как <strong className="text-slate-700">Запрос → ИИ</strong> — дешёвая ставка (не исходящие токены).</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-slate-400">•</span>
                <span>1 фото в среднем ≈ стоимость <strong className="text-slate-700">2–3 текстовых запросов</strong>.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-slate-400">•</span>
                <span>Поддерживаются: <strong className="text-slate-700">JPEG, PNG, GIF, WebP</strong>.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-rose-400">•</span>
                <span className="text-rose-600"><strong>Видео не поддерживается</strong> ни одной моделью Claude через API.</span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ── TIMELINE VIEW ─────────────────────────────────────────────────────── */}
      {view === 'timeline' && (
        <div className="flex-1 overflow-y-auto">
          {isLoadingEntries ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Загрузка...</div>
          ) : (
            <>
              {/* Horizontal date strip */}
              <div className="overflow-x-auto pb-3">
                <div className="flex gap-2" style={{ minWidth: 'max-content' }}>
                  {timelineDates.map((date) => {
                    const entry = entryByDate[date]
                    const isToday = date === todayISO()
                    const isSelected = date === selectedDate
                    const hasEntry = Boolean(entry)

                    return (
                      <button
                        key={date}
                        type="button"
                        onClick={() => openDate(date)}
                        className={cn(
                          'flex w-[72px] shrink-0 flex-col items-center rounded-2xl border p-2.5 text-center transition',
                          isSelected
                            ? 'border-blue-500 bg-blue-600 text-white shadow-md'
                            : hasEntry
                              ? 'border-emerald-200 bg-emerald-50 text-slate-700 hover:bg-emerald-100'
                              : isToday
                                ? 'border-blue-200 bg-blue-50 text-slate-700 hover:bg-blue-100'
                                : 'border-slate-100 bg-white text-slate-500 hover:bg-slate-50',
                        )}
                      >
                        <span className={cn('text-[10px] font-semibold uppercase tracking-wide', isSelected ? 'text-blue-100' : 'text-slate-400')}>
                          {getDayOfWeekRu(date)}
                        </span>
                        <span className="mt-0.5 text-[13px] font-bold">{formatDateShortRu(date)}</span>
                        <span className="mt-1.5 flex h-5 w-5 items-center justify-center rounded-full">
                          {hasEntry ? (
                            <svg viewBox="0 0 24 24" className={cn('h-3.5 w-3.5', isSelected ? 'text-white' : 'text-emerald-600')} fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="m5 13 4 4L19 7" />
                            </svg>
                          ) : isToday ? (
                            <span className={cn('h-2 w-2 rounded-full', isSelected ? 'bg-blue-200' : 'bg-blue-400')} />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-200" />
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Entry cards */}
              <div className="mt-4 space-y-4">
                {entries.length === 0 ? (
                  <Card className="p-8 text-center">
                    <div className="text-4xl">📓</div>
                    <div className="mt-3 text-sm font-medium text-slate-700">Дневник пуст</div>
                    <div className="mt-1 text-xs text-slate-400">Выберите дату и нажмите «+ Запись» чтобы начать</div>
                  </Card>
                ) : (
                  entries.map((entry) => (
                    <Card key={entry.id} className="overflow-hidden">
                      <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
                        <div>
                          <span className="text-sm font-bold text-slate-800">{formatDateRu(entry.date)}</span>
                          <span className="ml-2 text-xs text-slate-400">{getDayOfWeekRu(entry.date)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => openEntry(entry.date)}
                          className="rounded-lg px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 transition"
                        >
                          Открыть
                        </button>
                      </div>

                      <div className="p-5 space-y-3">
                        {entry.day_summary && (
                          <p className="text-sm text-slate-700 leading-relaxed line-clamp-3">{entry.day_summary}</p>
                        )}

                        <div className="flex flex-wrap gap-4">
                          {entry.tasks_done.length > 0 && (
                            <div className="min-w-0 flex-1">
                              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                                Сделано ({entry.tasks_done.length})
                              </div>
                              <ul className="space-y-1">
                                {entry.tasks_done.slice(0, 3).map((t, i) => (
                                  <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                                    <svg viewBox="0 0 24 24" className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 13 4 4L19 7" /></svg>
                                    <span className="line-clamp-1">{t}</span>
                                  </li>
                                ))}
                                {entry.tasks_done.length > 3 && (
                                  <li className="text-xs text-slate-400">+{entry.tasks_done.length - 3} ещё</li>
                                )}
                              </ul>
                            </div>
                          )}

                          {entry.tasks_tomorrow.length > 0 && (
                            <div className="min-w-0 flex-1">
                              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600">
                                На завтра ({entry.tasks_tomorrow.length})
                              </div>
                              <ul className="space-y-1">
                                {entry.tasks_tomorrow.slice(0, 3).map((t, i) => (
                                  <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                                    <svg viewBox="0 0 24 24" className="mt-0.5 h-3 w-3 shrink-0 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                                    <span className="line-clamp-1">{t}</span>
                                  </li>
                                ))}
                                {entry.tasks_tomorrow.length > 3 && (
                                  <li className="text-xs text-slate-400">+{entry.tasks_tomorrow.length - 3} ещё</li>
                                )}
                              </ul>
                            </div>
                          )}
                        </div>

                        {entry.media_urls.length > 0 && (
                          <div className="flex gap-2 flex-wrap">
                            {entry.media_urls.slice(0, 5).map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                <img src={url} alt="" className="h-14 w-14 rounded-xl object-cover border border-slate-200 hover:opacity-80 transition" />
                              </a>
                            ))}
                            {entry.media_urls.length > 5 && (
                              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-xs font-medium text-slate-500">
                                +{entry.media_urls.length - 5}
                              </div>
                            )}
                          </div>
                        )}

                        {entry.ai_review && (
                          <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
                            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-600">
                              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
                                <path d="M12 16v-4M12 8h.01" />
                              </svg>
                              Разбор AI
                            </div>
                            <p className="text-xs text-violet-800 leading-relaxed line-clamp-3">{entry.ai_review}</p>
                          </div>
                        )}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ENTRY VIEW ────────────────────────────────────────────────────────── */}
      {view === 'entry' && (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">

          {/* Date nav */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const d = new Date(selectedDate + 'T00:00:00')
                d.setDate(d.getDate() - 1)
                setSelectedDate(d.toISOString().slice(0, 10))
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition"
              aria-label="Предыдущий день"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg>
            </button>

            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />

            <button
              type="button"
              onClick={() => {
                const d = new Date(selectedDate + 'T00:00:00')
                d.setDate(d.getDate() + 1)
                const next = d.toISOString().slice(0, 10)
                if (next <= todayISO()) setSelectedDate(next)
              }}
              disabled={selectedDate >= todayISO()}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition disabled:opacity-40"
              aria-label="Следующий день"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
            </button>

            {selectedDate !== todayISO() && (
              <button
                type="button"
                onClick={() => setSelectedDate(todayISO())}
                className="ml-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 transition"
              >
                Сегодня
              </button>
            )}
          </div>

          {/* Summary */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">Как прошёл день</div>
              <button
                type="button"
                onClick={toggleRecording}
                className={cn(
                  'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition',
                  isRecording
                    ? 'bg-rose-500 text-white hover:bg-rose-600'
                    : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}
              >
                {isRecording ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                    Стоп
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <path d="M12 19v3M8 22h8" />
                    </svg>
                    Голос
                  </>
                )}
              </button>
            </div>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Опишите, как прошёл ваш день. Что произошло? Какие решения приняли? Что почувствовали?"
              rows={6}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 leading-relaxed"
            />
          </Card>

          {/* Tasks */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-5">
              <TaskList
                label="✅ Сделано сегодня"
                items={tasksDone}
                onChange={setTasksDone}
                placeholder="Что сделали сегодня?"
              />
            </Card>
            <Card className="p-5">
              <TaskList
                label="📋 Задачи на завтра"
                items={tasksTomorrow}
                onChange={setTasksTomorrow}
                placeholder="Что нужно сделать завтра?"
              />
            </Card>
          </div>

          {/* Media */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-700">Фото и скрины</div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 transition disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    Загрузка...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></svg>
                    Загрузить
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                multiple
                className="hidden"
                onChange={(e) => void handleMediaUpload(e.target.files)}
              />
            </div>
            {mediaUrls.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {mediaUrls.map((url, i) => (
                  <div key={i} className="group relative">
                    <img src={url} alt="" className="h-20 w-20 rounded-xl object-cover border border-slate-200" />
                    <button
                      type="button"
                      onClick={() => removeMedia(url)}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100 transition"
                      aria-label="Удалить"
                    >
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-16 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 text-xs text-slate-400">
                Перетащите файлы или нажмите "Загрузить"
              </div>
            )}
          </Card>

          {/* Save */}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="min-w-[140px]"
            >
              {isSaving ? 'Сохранение...' : 'Сохранить запись'}
            </Button>
            {saveError && <span className="text-sm text-rose-500">{saveError}</span>}
            {!aiSettings?.claude_key && (
              <span className="text-xs text-slate-400">Настройте Claude API-ключ в разделе Отзывы → Настройки AI для автоматического разбора</span>
            )}
          </div>

          {/* AI Review */}
          {(isAnalyzing || aiReview) && (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-purple-50 px-5 py-3">
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-violet-600" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
                </svg>
                <span className="text-sm font-semibold text-violet-700">Разбор дня от Claude</span>
                {isAnalyzing && (
                  <svg viewBox="0 0 24 24" className="ml-auto h-4 w-4 animate-spin text-violet-500" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                )}
              </div>
              {isAnalyzing ? (
                <div className="p-5 text-sm text-slate-400">Анализирую запись...</div>
              ) : (
                <div className="p-5">
                  <p className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">{aiReview}</p>
                  {aiSettings?.claude_key && (
                    <button
                      type="button"
                      onClick={() => {
                        const entry = entries.find((e) => e.date === selectedDate)
                        if (entry && aiSettings) void runAiReview(entry, aiSettings)
                      }}
                      disabled={isAnalyzing}
                      className="mt-3 text-xs text-violet-500 hover:text-violet-700 transition disabled:opacity-50"
                    >
                      Обновить разбор
                    </button>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* ── CHAT ──────────────────────────────────────────────────────────── */}
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-sm font-semibold text-slate-700">Чат с AI</span>
              <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">
                {entries.length > 0 ? `${Math.min(entries.length, 30)} записей в контексте` : 'Нет записей'}
              </span>
            </div>

            <div className="flex h-72 flex-col">
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {chatMessages.length === 0 && (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">
                    Спросите Claude о своём прогрессе, паттернах или получите совет
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={cn(
                      'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'ml-auto bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-800',
                    )}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Claude думает...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="border-t border-slate-100 px-4 py-3">
                {!aiSettings?.claude_key ? (
                  <div className="text-center text-xs text-slate-400">
                    Настройте Claude API-ключ в разделе Отзывы → Настройки AI
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <textarea
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={handleChatKey}
                      placeholder="Спросите что-нибудь... (Enter — отправить)"
                      rows={1}
                      className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => void handleChatSend()}
                      disabled={isChatLoading || !chatInput.trim()}
                      className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50"
                      aria-label="Отправить"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m22 2-7 20-4-9-9-4 20-7z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
