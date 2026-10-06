export const inviteStateLabel: Record<string, string> = {
  active: 'Активна 30 дней', reserved: 'Зарезервирована',
  bound_pending: 'Привязана · до первой заявки', bound: 'Привязана бессрочно',
  replaced: 'Заменена', expired: 'Истекла', deleted: 'Удалена',
}
export function inviteDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—'
  return new Date(value).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' })
}
export function inviteTerm(state: string, expires?: string | null) {
  return state === 'bound' && expires === 'infinity' ? 'Бессрочно' : inviteDate(expires)
}
