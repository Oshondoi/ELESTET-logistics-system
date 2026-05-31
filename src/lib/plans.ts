// ──────────────────────────────────────────────────────────────
// Конфиг тарифов и функции проверки доступа
// Добавить новую платную фичу = одна строка в FEATURES
// ──────────────────────────────────────────────────────────────

export type PlanKey = 'none' | 'seller' | 'operational' | 'trial'

export interface AccountBillingInfo {
  plan?: string | null
  plan_until?: string | null
  trial_ends_at?: string | null
  grace_until?: string | null
  plan_features?: Record<string, unknown> | null
}

// ── Статус аккаунта ──────────────────────────────────────────

export type BillingStatus =
  | 'trial'       // триал активен
  | 'active'      // подписка активна
  | 'grace'       // grace period (3 дня в долг)
  | 'expired'     // всё истекло → read-only

/** Активное переопределение из access_overrides (ручной триал/план) */
export interface ActiveOverride {
  type: 'trial' | 'plan'
  plan: 'seller' | 'operational' | null
  free_until: string // ISO date, e.g. "2026-12-31"
}

export function getBillingStatus(account: AccountBillingInfo, override?: ActiveOverride | null): BillingStatus {
  const now = new Date()

  // 0. Переопределение (приоритет выше billing полей)
  if (override && new Date(override.free_until) >= now) {
    if (override.type === 'trial') return 'trial'
    if (override.type === 'plan') return 'active'
  }

  // 1. Активная подписка
  if (account.plan_until && new Date(account.plan_until) > now) return 'active'

  // 2. Триал
  if (account.trial_ends_at && new Date(account.trial_ends_at) > now) return 'trial'

  // 3. Grace period
  if (account.grace_until && new Date(account.grace_until) > now) return 'grace'

  // 4. Истекло
  return 'expired'
}

/** Можно ли создавать/редактировать данные */
export function canWrite(account: AccountBillingInfo, override?: ActiveOverride | null): boolean {
  const status = getBillingStatus(account, override)
  return status === 'trial' || status === 'active' || status === 'grace'
}

/** Сколько дней осталось в триале (отрицательное = истёк) */
export function trialDaysLeft(account: AccountBillingInfo, override?: ActiveOverride | null): number {
  // override типа trial — берём его дату (она приоритетнее)
  if (override?.type === 'trial' && new Date(override.free_until) >= new Date()) {
    return Math.ceil((new Date(override.free_until).getTime() - Date.now()) / 86400000)
  }
  if (!account.trial_ends_at) return 0
  return Math.ceil((new Date(account.trial_ends_at).getTime() - Date.now()) / 86400000)
}

/** Сколько дней осталось в grace (отрицательное = истёк) */
export function graceDaysLeft(account: AccountBillingInfo): number {
  if (!account.grace_until) return 0
  return Math.ceil((new Date(account.grace_until).getTime() - Date.now()) / 86400000)
}

// ── Доступ к страницам по тарифу ─────────────────────────────
// На trial/grace/expired — все страницы видны (write = canWrite)
// На активной подписке — зависит от тарифа
const OPERATIONAL_ONLY_PAGES = ['fulfillment', 'shipments', 'directories', 'invoices'] as const

export const PLAN_PAGE_LABELS: Record<string, { title: string; desc: string }> = {
  fulfillment:  { title: 'Фулфилмент',   desc: 'Производственный учёт, пайплайн заказов, маркировка и отгрузка' },
  shipments:    { title: 'Логистика',     desc: 'Управление отгрузками, перевозчиками и транспортными документами' },
  directories:  { title: 'Справочники',   desc: 'Перевозчики, склады и тарифные справочники' },
  invoices:     { title: 'Счета',         desc: 'Выставление и отслеживание счетов для клиентов' },
}

/**
 * Доступна ли страница при текущем плане.
 * Только при статусе 'active' + plan='seller' ограничиваем operational-страницы.
 */
export function canAccessPage(page: string, account: AccountBillingInfo, override?: ActiveOverride | null): boolean {
  const status = getBillingStatus(account, override)
  // trial / grace / expired — все страницы открыты (read-only контролируется через canWrite)
  if (status !== 'active') return true
  // активная подписка — эффективный план (override.plan приоритетнее)
  const effectivePlan = (override?.type === 'plan' && override.plan) ? override.plan : account.plan
  if (effectivePlan === 'operational') return true
  if (effectivePlan === 'seller') {
    return !(OPERATIONAL_ONLY_PAGES as readonly string[]).includes(page)
  }
  return true
}
