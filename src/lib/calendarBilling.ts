// Pure quotation only. It neither authorizes access nor changes billing records.
// Caller supplies the business calendar date, never the payer's guessed timezone.
export const BILLING_TIME_ZONE = 'Asia/Bishkek'
export function billingCalendarDay(instant: number | string | Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: BILLING_TIME_ZONE, day: 'numeric' }).format(new Date(instant)))
}
export function formatBillingDate(instant: number | string | Date): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: BILLING_TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }).format(new Date(instant))
}
export interface CalendarQuote { startDate: string; endDateExclusive: string; chargedDays: number; amountSom: number }
function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Некорректная дата')
  const d = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new Error('Некорректная дата')
  return d
}
function price(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) throw new Error('Некорректная месячная цена')
}
export function quoteCalendarMonth(monthlySom: number, purchaseDate: string, startTomorrow = false): CalendarQuote {
  price(monthlySom)
  const date = parseDate(purchaseDate)
  if (startTomorrow && date.getUTCDate() <= 15) throw new Error('Начало завтра доступно после 15-го числа')
  if (startTomorrow) date.setUTCDate(date.getUTCDate() + 1)
  const day = date.getUTCDate()
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
  const daysInMonth = new Date(end.getTime() - 86400000).getUTCDate()
  const chargedFrom = day <= 15 ? Math.floor((day - 1) / 5) * 5 + 1 : day
  const chargedDays = daysInMonth - chargedFrom + 1
  // First phase includes the whole calendar month; 28/29/31 days don't alter its price.
  const amount = chargedFrom === 1 ? BigInt(monthlySom) : (BigInt(monthlySom) * BigInt(chargedDays) + 15n) / 30n
  return { startDate: date.toISOString().slice(0,10), endDateExclusive: end.toISOString().slice(0,10), chargedDays, amountSom: Number(amount) }
}
export function quotePlanReplacement(input: {
  previousMonthlySom: number; nextMonthlySom: number; purchaseDate: string; startTomorrow?: boolean;
  paidAt: string; now: string; completedChanges: number; kind: 'main' | 'brand';
}) {
  const paid = Date.parse(input.paidAt), now = Date.parse(input.now)
  if (!Number.isFinite(paid) || !Number.isFinite(now) || now < paid) throw new Error('Некорректное время оплаты')
  if (input.kind !== 'main') throw new Error('Для дополнительной опции перерасчёт недоступен')
  if (!Number.isInteger(input.completedChanges) || input.completedChanges < 0 || input.completedChanges >= 3 || now - paid >= 48 * 3600000) {
    throw new Error('Для перерасчёта обратитесь в поддержку')
  }
  const previous = quoteCalendarMonth(input.previousMonthlySom, input.purchaseDate, input.startTomorrow)
  const next = quoteCalendarMonth(input.nextMonthlySom, input.purchaseDate, input.startTomorrow)
  const difference = next.amountSom - previous.amountSom
  return { ...next, dueSom: Math.max(0, difference), creditSom: Math.max(0, -difference), paidAt: input.paidAt }
}

// Display quotation only. Actual balance must be checked and debited by server settlement.
export function quoteBalanceContribution(dueSom: number, balanceSom: number, useBalance = false) {
  price(dueSom); price(balanceSom)
  const fromBalanceSom = useBalance ? Math.min(dueSom, balanceSom) : 0
  return { fromBalanceSom, remainingSom: dueSom - fromBalanceSom }
}
