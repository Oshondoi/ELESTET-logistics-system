import { supabase } from '../lib/supabase'
import type {
  AiModel,
  AiReplyStatus,
  AiSettings,
  AiSettingsFormValues,
  ReviewTemplate,
  ReviewTemplateFormValues,
  WbFeedback,
  WbFeedbackRow,
} from '../types'

// ─── WB Feedbacks API ─────────────────────────────────────────

const WB_FB_BASE = 'https://feedbacks-api.wildberries.ru'
// WB не возвращает заголовки Retry-After при 429 — реальный лимит неизвестен.
// Используем exponential backoff: базовый 60с, максимум 10 минут.
const WB_COOLDOWN_BASE = 60
const WB_COOLDOWN_MAX = 600
const WB_LS_FAIL_COUNT = 'wb_feedbacks_fail_count'

function getBackoffSec(): number {
  const count = parseInt(localStorage.getItem(WB_LS_FAIL_COUNT) ?? '0', 10)
  return Math.min(WB_COOLDOWN_BASE * Math.pow(2, count), WB_COOLDOWN_MAX)
}

function incrementFailCount(): void {
  const count = parseInt(localStorage.getItem(WB_LS_FAIL_COUNT) ?? '0', 10)
  localStorage.setItem(WB_LS_FAIL_COUNT, String(count + 1))
}

function resetFailCount(): void {
  localStorage.removeItem(WB_LS_FAIL_COUNT)
}

export class WbRateLimitError extends Error {
  constructor(
    public readonly retryAfterSec: number,
    message: string,
  ) {
    super(message)
    this.name = 'WbRateLimitError'
  }
}

export interface FeedbacksData {
  feedbacks: WbFeedback[]
  countUnanswered: number
  /** Сколько секунд ждать до следующего запроса (из X-Ratelimit-Reset или дефолт). */
  retryAfterSec: number
}

export async function fetchWbFeedbacks(
  apiKey: string,
  isAnswered: boolean,
): Promise<FeedbacksData> {
  const resp = await fetch(
    `${WB_FB_BASE}/api/v1/feedbacks?isAnswered=${isAnswered}&take=100&skip=0`,
    { headers: { Authorization: apiKey } },
  )

  // Логируем ВСЕ rate-limit заголовки — чтобы знать реальные лимиты WB
  const rlHeaders = {
    'X-Ratelimit-Limit':     resp.headers.get('X-Ratelimit-Limit'),
    'X-Ratelimit-Remaining': resp.headers.get('X-Ratelimit-Remaining'),
    'X-Ratelimit-Reset':     resp.headers.get('X-Ratelimit-Reset'),
    'Retry-After':           resp.headers.get('Retry-After'),
    'RateLimit-Limit':       resp.headers.get('RateLimit-Limit'),
    'RateLimit-Remaining':   resp.headers.get('RateLimit-Remaining'),
    'RateLimit-Reset':       resp.headers.get('RateLimit-Reset'),
  }
  console.log(`[WB Feedbacks] status=${resp.status} isAnswered=${isAnswered}`, rlHeaders)

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        'Нет доступа к отзывам. Убедитесь, что API-ключ WB имеет разрешение «Вопросы и отзывы».',
      )
    }
    if (resp.status === 429) {
      const headerVal = parseInt(resp.headers.get('Retry-After') ?? resp.headers.get('RateLimit-Reset') ?? '', 10)
      // WB не присылает заголовки — считаем backoff сами
      const wait = headerVal > 0 ? headerVal : getBackoffSec()
      incrementFailCount()
      console.warn(`[WB Feedbacks] 429 — wait=${wait}s (failCount теперь: ${localStorage.getItem(WB_LS_FAIL_COUNT)})`)
      throw new WbRateLimitError(wait, `Лимит WB API: подождите ${wait} секунд.`)
    }
    throw new Error(`Ошибка WB API: ${resp.status} ${resp.statusText}`)
  }
  // Читаем X-Ratelimit-Reset — через сколько секунд лимит восстановится
  const rlReset = parseInt(resp.headers.get('X-Ratelimit-Reset') ?? resp.headers.get('RateLimit-Reset') ?? '', 10)
  type Resp = {
    data?: { feedbacks?: WbFeedback[]; countUnanswered?: number }
    error?: boolean
    errorText?: string
  }
  const json = (await resp.json()) as Resp
  if (json.error) throw new Error(json.errorText || 'Ошибка WB API')
  // Успех — сбрасываем счётчик ошибок
  resetFailCount()
  return {
    feedbacks: json?.data?.feedbacks ?? [],
    countUnanswered: json?.data?.countUnanswered ?? 0,
    retryAfterSec: rlReset > 0 ? rlReset : WB_COOLDOWN_BASE,
  }
}

export async function sendWbReply(
  apiKey: string,
  feedbackId: string,
  text: string,
): Promise<void> {
  const resp = await fetch(`${WB_FB_BASE}/api/v1/feedbacks`, {
    method: 'PATCH',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: feedbackId, text }),
  })
  if (!resp.ok) {
    if (resp.status === 401) throw new Error('Неверный API-ключ WB')
    throw new Error(`Ошибка отправки ответа: ${resp.status}`)
  }
}

// ─── Supabase — шаблоны ───────────────────────────────────────

export async function fetchReviewTemplates(accountId: string): Promise<ReviewTemplate[]> {
  if (!supabase) throw new Error('Supabase not configured')
  const { data, error } = await supabase
    .from('review_templates')
    .select('*')
    .eq('account_id', accountId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ReviewTemplate[]
}

export async function createReviewTemplate(
  accountId: string,
  values: ReviewTemplateFormValues,
): Promise<ReviewTemplate> {
  if (!supabase) throw new Error('Supabase not configured')
  const { data, error } = await supabase
    .from('review_templates')
    .insert({ account_id: accountId, sort_order: 0, ...values })
    .select()
    .single()
  if (error) throw error
  return data as ReviewTemplate
}

export async function updateReviewTemplate(
  id: string,
  values: Partial<ReviewTemplateFormValues>,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase
    .from('review_templates')
    .update(values)
    .eq('id', id)
  if (error) throw error
}

export async function deleteReviewTemplate(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  const { error } = await supabase
    .from('review_templates')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ─── Supabase — кэш отзывов wb_feedbacks ─────────────────────

/** Загрузить отзывы из локального кэша (без обращения к WB). */
export async function loadFeedbacksFromDb(
  storeId: string,
  isAnswered: boolean,
): Promise<WbFeedback[]> {
  if (!supabase) throw new Error('Supabase not configured')
  const { data, error } = await supabase
    .from('wb_feedbacks')
    .select('data')
    .eq('store_id', storeId)
    .eq('is_answered', isAnswered)
    .order('created_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => row.data as unknown as WbFeedback)
}

/**
 * Синхронизировать отзывы: WB API → wb_feedbacks (replace-sync).
 * Удаляет старые строки (store + is_answered) и вставляет свежие.
 */
export async function syncFeedbacksFromWb(
  apiKey: string,
  storeId: string,
  accountId: string,
  isAnswered: boolean,
): Promise<FeedbacksData> {
  // Сначала получаем данные от WB. Если WB вернул ошибку (429 и т.д.) —
  // DB вообще не трогаем, старые данные остаются.
  const result = await fetchWbFeedbacks(apiKey, isAnswered)

  if (supabase && result.feedbacks.length > 0) {
    // Upsert: обновляем существующие записи или добавляем новые.
    // DELETE намеренно не делаем — если WB вдруг вернул меньше данных
    // или следующий шаг упадёт, старые данные в DB остаются нетронутыми.
    const { error: upsertError } = await supabase
      .from('wb_feedbacks')
      .upsert(
        result.feedbacks.map((fb) => ({
          id: fb.id,
          store_id: storeId,
          account_id: accountId,
          data: fb as unknown as Record<string, unknown>,
          is_answered: isAnswered,
          created_date: fb.createdDate ?? null,
          synced_at: new Date().toISOString(),
        })),
        { onConflict: 'id' },
      )
    if (upsertError) throw new Error(`Ошибка сохранения в БД: ${upsertError.message}`)
  }

  return result
}

// ─── Supabase — полные строки wb_feedbacks (с AI-полями) ─────

export async function loadFeedbackRowsFromDb(
  storeId: string,
  isAnswered: boolean,
): Promise<WbFeedbackRow[]> {
  if (!supabase) throw new Error('Supabase not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('wb_feedbacks')
    .select('id, store_id, account_id, data, is_answered, ai_reply, ai_reply_status, reply_sent_at, synced_at')
    .eq('store_id', storeId)
    .eq('is_answered', isAnswered)
    .order('created_date', { ascending: false })
  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id as string,
    store_id: row.store_id as string,
    account_id: row.account_id as string,
    data: row.data as unknown as WbFeedback,
    is_answered: row.is_answered as boolean,
    ai_reply: (row.ai_reply as string | null) ?? null,
    ai_reply_status: ((row.ai_reply_status as string) ?? 'none') as AiReplyStatus,
    reply_sent_at: (row.reply_sent_at as string | null) ?? null,
    synced_at: row.synced_at as string,
  }))
}

export async function saveAiReply(feedbackId: string, text: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('wb_feedbacks')
    .update({ ai_reply: text, ai_reply_status: 'generated' })
    .eq('id', feedbackId)
  if (error) throw error
}

export async function cancelAiReply(feedbackId: string): Promise<void> {
  if (!supabase) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('wb_feedbacks')
    .update({ ai_reply: null, ai_reply_status: 'none' })
    .eq('id', feedbackId)
  // Ошибки игнорируем — это фоновая операция, UI уже закрыт
}

export async function saveStorePrompt(storeId: string, prompt: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('stores')
    .update({ ai_prompt: prompt.trim() || null })
    .eq('id', storeId)
  if (error) throw error
}

export async function markReplySent(feedbackId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('wb_feedbacks')
    .update({
      is_answered: true,
      ai_reply_status: 'sent',
      reply_sent_at: new Date().toISOString(),
    })
    .eq('id', feedbackId)
  if (error) throw error
}

// ─── Supabase — настройки ИИ per-account ────────────────────

export async function getAiSettings(accountId: string): Promise<AiSettings | null> {
  if (!supabase) throw new Error('Supabase not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('account_ai_settings')
    .select('*')
    .eq('account_id', accountId)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data as AiSettings
}

export async function saveAiSettings(
  accountId: string,
  values: AiSettingsFormValues,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('account_ai_settings')
    .upsert({
      account_id: accountId,
      provider: values.provider,
      openai_key: values.openai_key,
      model: values.model,
      claude_key: values.claude_key,
      claude_model: values.claude_model,
      tone: values.tone,
      system_prompt: values.system_prompt.trim() || null,
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}

// ─── OpenAI API ──────────────────────────────────────────────

interface AiFeedbackInput {
  text?: string | null
  productValuation: number
  userName?: string | null
  productName?: string | null
  photoLinks?: { fullSize: string; miniSize: string }[] | null
  storePrompt?: string | null
}

/** Конвертирует URL изображения в base64 data URL */
async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const blob = await resp.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function buildAiPromptParts(settings: AiSettings, feedback: AiFeedbackInput): { systemContent: string; textContent: string } {
  const toneMap: Record<string, string> = {
    polite: 'вежливым и профессиональным',
    neutral: 'нейтральным и деловым',
    friendly: 'дружелюбным и тёплым',
    professional: 'строго профессиональным и формальным',
  }

  const baseSystem =
    settings.system_prompt?.trim() ||
    `Ты — специалист по работе с клиентами интернет-магазина на маркетплейсе Wildberries.
Пиши ответы на отзывы покупателей на русском языке.
Будь ${toneMap[settings.tone] ?? 'вежливым и профессиональным'}.
Ответ должен быть кратким (2–4 предложения), конкретным, без шаблонных фраз.
Не используй смайлы и восклицательные знаки. Обращайся на «Вы».`

  const systemContent = feedback.storePrompt?.trim()
    ? `${baseSystem}

${feedback.storePrompt.trim()}`
    : baseSystem

  const parts: string[] = [`Оценка: ${feedback.productValuation}/5`]
  if (feedback.productName) parts.push(`Товар: ${feedback.productName}`)
  if (feedback.userName) parts.push(`Покупатель: ${feedback.userName}`)
  parts.push('')
  parts.push(`Текст отзыва: ${feedback.text?.trim() || 'Без текста (только оценка)'}`)
  parts.push('')
  parts.push('Напиши ответ продавца:')

  return { systemContent, textContent: parts.join('\n') }
}

async function callOpenAiDirect(settings: AiSettings, feedback: AiFeedbackInput): Promise<string> {
  const { systemContent, textContent } = buildAiPromptParts(settings, feedback)

  // GPT-4o Vision: передаём фото если модель gpt-4o и есть photoLinks
  const isVisionModel = settings.model === 'gpt-4o'
  const photos = feedback.photoLinks ?? []
  let userMessage: unknown

  if (isVisionModel && photos.length > 0) {
    const base64Photos = await Promise.all(
      photos.slice(0, 3).map((p) => fetchImageAsBase64(p.fullSize))
    )
    const imageContents = base64Photos
      .filter((b64): b64 is string => b64 !== null)
      .map((b64) => ({ type: 'image_url', image_url: { url: b64, detail: 'low' } }))

    userMessage = {
      role: 'user',
      content: [{ type: 'text', text: textContent }, ...imageContents],
    }
  } else {
    userMessage = { role: 'user', content: textContent }
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.openai_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'system', content: systemContent }, userMessage],
      max_tokens: 400,
      temperature: 0.7,
    }),
  })

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({})) as { error?: { message?: string } }
    if (resp.status === 401) throw new Error('Неверный OpenAI API-ключ. Проверьте настройки.')
    if (resp.status === 429) throw new Error('Превышен лимит OpenAI. Попробуйте позже.')
    throw new Error(errData.error?.message || `OpenAI API error: ${resp.status}`)
  }

  type OAIResponse = { choices: Array<{ message: { content: string } }> }
  const json = (await resp.json()) as OAIResponse
  return json.choices[0]?.message?.content?.trim() ?? ''
}

async function callClaudeDirect(settings: AiSettings, feedback: AiFeedbackInput): Promise<string> {
  const { systemContent, textContent } = buildAiPromptParts(settings, feedback)

  // Claude Vision: все модели claude-3 поддерживают изображения
  const photos = feedback.photoLinks ?? []
  let userContent: unknown

  if (photos.length > 0) {
    const base64Photos = await Promise.all(
      photos.slice(0, 3).map((p) => fetchImageAsBase64(p.fullSize))
    )
    const imageBlocks = base64Photos
      .filter((b64): b64 is string => b64 !== null)
      .map((b64) => {
        // data URL format: "data:image/jpeg;base64,<data>"
        const [header, data] = b64.split(',')
        const mediaType = (header.match(/data:([^;]+);/) ?? [])[1] ?? 'image/jpeg'
        return { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
      })

    userContent = [
      ...imageBlocks,
      { type: 'text', text: textContent },
    ]
  } else {
    userContent = textContent
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': settings.claude_key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.claude_model,
      max_tokens: 400,
      system: systemContent,
      messages: [{ role: 'user', content: userContent }],
    }),
  })

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({})) as { error?: { message?: string } }
    if (resp.status === 401) throw new Error('Неверный Claude API-ключ. Проверьте настройки.')
    if (resp.status === 429) throw new Error('Превышен лимит Claude. Попробуйте позже.')
    throw new Error(errData.error?.message || `Claude API error: ${resp.status}`)
  }

  type ClaudeResponse = { content: Array<{ type: string; text: string }> }
  const json = (await resp.json()) as ClaudeResponse
  return json.content.find((b) => b.type === 'text')?.text?.trim() ?? ''
}

export async function callOpenAi(
  settings: AiSettings,
  feedback: AiFeedbackInput,
): Promise<string> {
  const provider = settings.provider ?? 'openai'
  if (provider === 'claude') {
    if (!settings.claude_key) throw new Error('Claude API-ключ не настроен')
    return callClaudeDirect(settings, feedback)
  }
  if (!settings.openai_key) throw new Error('OpenAI API-ключ не настроен')
  return callOpenAiDirect(settings, feedback)
}
