// Phrases from the Teksher manual «Модуль заказа кодов маркировки» v2.2.
// Types: sections 5.8–5.14 and 6.7. Status «ВЫПОЛНЯЕТСЯ»: section 6.8.
// Status «Отклонен»: the marking-report section of the same manual line.
// ACCEPTED is not given a Russian name in the text of that manual.

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
  WAITING: 'ВЫПОЛНЯЕТСЯ',
  PROGRESS: 'ВЫПОЛНЯЕТСЯ',
  IN_PROGRESS: 'ВЫПОЛНЯЕТСЯ',
  PROCESSING: 'ВЫПОЛНЯЕТСЯ',
  REJECTED: 'Отклонен',
  DECLINED: 'Отклонен',
  FAILED: 'Отклонен',
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
  if (status === 'WAITING' || status === 'PROGRESS' || status === 'IN_PROGRESS' || status === 'PROCESSING') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (status === 'ACCEPTED' || status === 'COMPLETED') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-slate-100 text-slate-600 border-slate-200'
}

export function operationCanPrint(type: string | null | undefined): boolean {
  return type === 'MARK_CODE_ORDER' || type === 'EMISSION' || type === 'MARKING' || type === 'UTILISATION'
}
