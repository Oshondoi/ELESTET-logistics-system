// Shared by Auth hook and future trusted notification/campaign workers. Never expose as a public sender.
export interface Letter {
  to: string
  purpose: 'signup' | 'recovery' | 'invite' | 'notification' | 'campaign'
  eventKey: string
  heading: string
  code?: string
  message?: string
  reservation?: { number: string; requested_at: string }
}
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function reservationFromRedirect(redirect: string | undefined) {
  const m = redirect?.match(/^https:\/\/elestet\.net\/auth-email\/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\/([1-9][0-9]{0,18})$/)
  return m ? { requested_at: m[1], number: m[2] } : undefined
}

export async function eventHash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('')
}

export function renderLetter(letter: Letter, number: string, time: string) {
  if (!/^[1-9][0-9]*$/.test(number) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(time)) throw new Error('Invalid letter metadata')
  if (letter.code !== undefined && !/^[0-9]{6}$/.test(letter.code)) throw new Error('Invalid OTP')
  const stamp = `${time.slice(8, 10)}.${time.slice(5, 7)}.${time.slice(0, 4)}, ${time.slice(11, 19)} UTC`
  const text = ['ELESTET', letter.heading, `Письмо №${number}`, letter.code, letter.message,
    letter.code ? 'Никому не сообщайте код' : undefined, '', '', stamp].filter(x => x !== undefined).join('\n')
  const html = `<div style="font-family:Arial,sans-serif;color:#000;max-width:560px;margin:auto;padding:24px"><h2>ELESTET</h2><p>${escapeHtml(letter.heading)}</p><p style="font-size:22px;font-weight:700;color:#000">Письмо №${number}</p>${letter.code ? `<p style="font-size:36px;font-weight:700;color:#000;letter-spacing:5px">${letter.code}</p><p>Никому не сообщайте код</p>` : ''}${letter.message ? `<p>${escapeHtml(letter.message)}</p>` : ''}<p style="margin-top:48px;font-size:12px;color:#666">${stamp}</p></div>`
  return { subject: `ELESTET — письмо №${number}`, html, text }
}

export async function sendNumberedLetter(letter: Letter, deps: { rpc: Rpc; apiKey: string; fetch: typeof fetch }) {
  const { data, error } = await deps.rpc('prepare_email_dispatch', {
    p_email: letter.to, p_event_key: letter.eventKey, p_purpose: letter.purpose,
    p_number: letter.reservation?.number ?? null, p_requested_at: letter.reservation?.requested_at ?? null,
  })
  if (error) throw new Error('Cannot prepare letter')
  const meta = data as { number: string; requested_at: string; sent: boolean }
  if (!meta || typeof meta.sent !== 'boolean') throw new Error('Invalid dispatch response')
  if (meta.sent) return
  const content = renderLetter(letter, meta.number, meta.requested_at)
  const result = await deps.fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${deps.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `letter/${letter.eventKey}` },
    body: JSON.stringify({ from: 'ELESTET <noreply@elestet.net>', to: [letter.to], ...content }),
  })
  if (!result.ok) throw new Error('Email provider failed')
  const response = await result.json() as { id?: string }
  if (!response.id) throw new Error('Missing provider id')
  const complete = await deps.rpc('complete_email_dispatch', { p_event_key: letter.eventKey, p_provider_id: response.id })
  if (complete.error) throw new Error('Cannot record delivery')
}
