import { supabase } from './supabase'

// Display metadata only; never a credential or an OTP validity check.
// The server, not the browser clock, allocates both fields atomically.
export const EMAIL_REQUEST_PREFIX = 'https://elestet.net/auth-email/'

export async function createEmailCodeRequest(email: string, purpose: 'signup' | 'recovery' | 'invite', requestId = crypto.randomUUID()) {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.rpc('reserve_email_delivery_number' as never, {
    p_email: email.trim(), p_request_id: requestId, p_purpose: purpose,
  } as never)
  if (error) throw new Error(error.message)
  const result = data as unknown as { number: string; requested_at: string }
  if (!result || !/^[1-9][0-9]*$/.test(result.number) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(result.requested_at)) {
    throw new Error('Не удалось получить номер письма. Повторите попытку позже.')
  }
  const requestedAt = `${result.requested_at}/${result.number}`
  return { requestedAt, number: result.number, redirectTo: EMAIL_REQUEST_PREFIX + requestedAt, requestId }
}

export function emailRequestNumber(value?: string | null) {
  return value?.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\/([1-9][0-9]*)$/)?.[1] ?? null
}

export function formatEmailCodeRequestTime(value: string) {
  return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}, ${value.slice(11, 19)} UTC`
}
