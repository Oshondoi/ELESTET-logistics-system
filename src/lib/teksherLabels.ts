// Phrases from the Teksher cabinet list. The live status dictionary is
// CREATED, PROGRESS, WAITING, ACCEPTED, REJECTED, CANCELED.

const OPERATION_TYPE: Record<string, string> = {
  MARK_CODE_ORDER: 'Заказ на эмиссию КМ',
  EMISSION: 'Заказ на эмиссию КМ',
  MARKING: 'Нанесение',
  UTILISATION: 'Нанесение',
  TRANSGRAN_REGISTRATION: 'Регистрация трансграна',
  TRANSGRAN: 'Регистрация трансграна',
  IMPORT: 'Регистрация трансграна',
  IMPORT_REGISTRATION: 'Регистрация трансграна',
}

const OPERATION_STATUS: Record<string, string> = {
  CREATED: 'Создана',
  PROGRESS: 'Выполняется',
  IN_PROGRESS: 'Выполняется',
  PROCESSING: 'Выполняется',
  WAITING: 'Ожидает приемки РФ',
  ACCEPTED: 'Выполнена',
  COMPLETED: 'Выполнена',
  REJECTED: 'Отклонена',
  DECLINED: 'Отклонена',
  FAILED: 'Отклонена',
  CANCELED: 'Отменено',
  CANCELLED: 'Отменено',
}

export function teksherTypeLabel(type: string | null | undefined): string {
  if (!type) return '—'
  return OPERATION_TYPE[type] ?? type
}

export function teksherStatusLabel(status: string | null | undefined): string {
  if (!status) return '—'
  return OPERATION_STATUS[status] ?? status
}

export function teksherStatusClass(status: string | null | undefined): string {
  if (status === 'REJECTED' || status === 'DECLINED' || status === 'FAILED') return 'bg-red-50 text-red-700 border-red-200'
  if (status === 'CANCELED' || status === 'CANCELLED') return 'bg-slate-100 text-slate-500 border-slate-200'
  if (status === 'CREATED') return 'bg-sky-50 text-sky-700 border-sky-200'
  if (status === 'PROGRESS' || status === 'IN_PROGRESS' || status === 'PROCESSING' || status === 'WAITING') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (status === 'ACCEPTED' || status === 'COMPLETED') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-slate-100 text-slate-600 border-slate-200'
}

export function operationCanPrint(type: string | null | undefined): boolean {
  return type === 'MARK_CODE_ORDER' || type === 'EMISSION' || type === 'MARKING' || type === 'UTILISATION'
}
