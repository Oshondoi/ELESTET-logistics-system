import { supabase } from '../lib/supabase'
import type { ReviewTemplate, ReviewTemplateFormValues, WbFeedback } from '../types'

// ─── WB Feedbacks API ─────────────────────────────────────────

const WB_FB_BASE = 'https://feedbacks-api.wildberries.ru'

export interface FeedbacksData {
  feedbacks: WbFeedback[]
  countUnanswered: number
}

export async function fetchWbFeedbacks(
  apiKey: string,
  isAnswered: boolean,
): Promise<FeedbacksData> {
  const resp = await fetch(
    `${WB_FB_BASE}/api/v1/feedbacks?isAnswered=${isAnswered}&take=100&skip=0`,
    { headers: { Authorization: apiKey } },
  )
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        'Нет доступа к отзывам. Убедитесь, что API-ключ WB имеет разрешение «Вопросы и отзывы».',
      )
    }
    if (resp.status === 429) {
      throw new Error(
        'Лимит WB API: не более 1 запроса в минуту. Подождите 60 секунд.',
      )
    }
    throw new Error(`Ошибка WB API: ${resp.status} ${resp.statusText}`)
  }
  type Resp = {
    data?: { feedbacks?: WbFeedback[]; countUnanswered?: number }
    error?: boolean
    errorText?: string
  }
  const json = (await resp.json()) as Resp
  if (json.error) throw new Error(json.errorText || 'Ошибка WB API')
  return {
    feedbacks: json?.data?.feedbacks ?? [],
    countUnanswered: json?.data?.countUnanswered ?? 0,
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
  const { error } = await supabase
    .from('review_templates')
    .update(values)
    .eq('id', id)
  if (error) throw error
}

export async function deleteReviewTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('review_templates')
    .delete()
    .eq('id', id)
  if (error) throw error
}
