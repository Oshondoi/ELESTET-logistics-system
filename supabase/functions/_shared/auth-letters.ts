import { eventHash, reservationFromRedirect, type Letter } from './numbered-email.ts'

export interface AuthEmailPayload {
  user: { id: string; email: string; new_email?: string }
  email_data: { email_action_type: string; token?: string; token_new?: string; token_hash?: string; token_hash_new?: string; redirect_to?: string }
}
const headings: Record<string, string> = {
  signup: 'Подтверждение почты', recovery: 'Восстановление пароля', magiclink: 'Код входа',
  invite: 'Приглашение', reauthentication: 'Подтверждение действия', email_change: 'Подтверждение смены почты',
  password_changed_notification: 'Пароль изменён', email_changed_notification: 'Адрес почты изменён',
  phone_changed_notification: 'Номер телефона изменён', identity_linked_notification: 'Способ входа добавлен',
  identity_unlinked_notification: 'Способ входа удалён', mfa_factor_enrolled_notification: 'Способ двухэтапной проверки добавлен',
  mfa_factor_unenrolled_notification: 'Способ двухэтапной проверки удалён',
}
export async function authLetters(payload: AuthEmailPayload, webhookId: string): Promise<Letter[]> {
  const { user, email_data: data } = payload
  if (!user?.id || !data || !headings[data.email_action_type] || !webhookId) throw new Error('Unsupported Auth email')
  const action = data.email_action_type
  const notification = action.endsWith('_notification')
  const purpose = action === 'recovery' ? 'recovery' : action === 'invite' ? 'invite' : notification || action === 'email_change' || action === 'reauthentication' ? 'notification' : 'signup'
  const entries: { to: string; code?: string; hash?: string }[] = []
  if (action === 'email_change') {
    if (!user.new_email) throw new Error('Missing new email')
    // Supabase's secure-email-change hashes have historical reversed names.
    if (data.token_hash_new && data.token_hash) {
      entries.push({ to: user.email, code: data.token, hash: data.token_hash_new })
      entries.push({ to: user.new_email, code: data.token_new, hash: data.token_hash })
    } else entries.push({ to: user.new_email, code: data.token_new || data.token, hash: data.token_hash })
  } else entries.push({ to: user.email, code: notification ? undefined : data.token, hash: data.token_hash })
  return Promise.all(entries.map(async entry => {
    if (!entry.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.to) || entry.to.length > 254) throw new Error('Invalid recipient')
    if (!notification && (!entry.code || !/^[0-9]{6}$/.test(entry.code) || !entry.hash)) throw new Error('Invalid Auth token')
    const to = entry.to.trim().toLowerCase()
    return {
      to, code: entry.code, purpose, heading: headings[action],
      // Stable across webhook retries; raw OTPs/hashes are never persisted or logged.
      eventKey: await eventHash(JSON.stringify(['auth', user.id, to, action, webhookId])),
      reservation: ['signup', 'magiclink', 'recovery', 'invite'].includes(action) ? reservationFromRedirect(data.redirect_to) : undefined,
      message: notification ? 'Если это были не вы, свяжитесь с поддержкой.' : undefined,
    }
  }))
}
