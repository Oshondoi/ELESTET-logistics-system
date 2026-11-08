export const DAY_WIDTH = 44
export const DAY_MS = 86400000

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export type CalendarRange = {
  start: string
  end: string
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function parseISODate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function formatISODate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function addDays(date: Date, days: number): Date {
  const next = startOfDay(date)
  next.setDate(next.getDate() + days)
  return next
}

export function addMonths(date: Date, months: number): Date {
  const source = startOfDay(date)
  const day = source.getDate()
  const next = new Date(source.getFullYear(), source.getMonth() + months, 1)
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, lastDay))
  return next
}

export function diffDays(later: Date, earlier: Date): number {
  return Math.round((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / DAY_MS)
}

export function defaultRange(today = new Date()): CalendarRange {
  const day = startOfDay(today)
  return {
    start: formatISODate(addDays(day, -45)),
    end: formatISODate(addDays(day, 45)),
  }
}

export function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = []
  for (let cursor = startOfDay(start); cursor.getTime() <= startOfDay(end).getTime(); cursor = addDays(cursor, 1)) {
    days.push(cursor)
  }
  return days
}

export function monthLabel(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export function weekdayLabel(date: Date): string {
  return WEEKDAYS[date.getDay()]
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

export function formatRuDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(parseISODate(value))
}

export function clipToRange(start: string, end: string, rangeStart: Date, rangeEnd: Date): { startIndex: number; endIndex: number } | null {
  const itemStart = parseISODate(start)
  const itemEnd = parseISODate(end)
  if (itemEnd < rangeStart || itemStart > rangeEnd) return null
  const visibleStart = itemStart < rangeStart ? rangeStart : itemStart
  const visibleEnd = itemEnd > rangeEnd ? rangeEnd : itemEnd
  return {
    startIndex: diffDays(visibleStart, rangeStart),
    endIndex: diffDays(visibleEnd, rangeStart),
  }
}
