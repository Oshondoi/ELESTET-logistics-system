import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../components/ui/Card'
import { getBillingStatus, trialDaysLeft, graceDaysLeft } from '../lib/plans'
import type { ActiveOverride } from '../lib/plans'
import { activateGracePeriod } from '../services/billingService'
import { createPaymentOrder } from '../services/paymentService'
import type { Account } from '../types'

interface SubscriptionPageProps {
  activeAccount: Account | null
  onAccountRefresh: () => void
  activeOverride?: ActiveOverride | null
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ──────────────────────────────────────────────────────────────
// НАСТРОЙКА СКИДОК — менять здесь когда утвердишь цифры:
const PERIOD_OPTIONS = [
  { months: 1,  label: '1 мес',     discount: 0 },
  { months: 2,  label: '2 мес',     discount: 0 },
  { months: 3,  label: '3 мес',     discount: 0 },
  { months: 6,  label: '6 мес',     discount: 0 },
  { months: 12, label: '12 мес',    discount: 0 },
]

// Базовые цены в сомах за 1 месяц — менять здесь:
const PLAN_PRICES: Record<string, number> = {
  seller:      2000,
  operational: 17000,
}
// ──────────────────────────────────────────────────────────────

const PLANS = [
  {
    key: 'seller',
    label: 'Селлер',
    price: '2 000 сом',
    description: 'Для продавцов на маркетплейсах',
    features: ['Магазины', 'Товары и GTIN', 'Стикеры и КИЗы', 'Отзывы WB', 'Роли'],
    highlight: false,
  },
  {
    key: 'operational',
    label: 'Операционный',
    price: '17 000 сом',
    description: 'Для фулфилмент-центров, цехов и карго',
    features: ['Фулфилмент + Пайплайн', 'Логистика', 'Магазины', 'Товары', 'Справочники', 'Стикеры и КИЗы', 'Аутсорс B2B', 'Счета', 'Роли'],
    highlight: true,
  },
]

export const SubscriptionPage = ({ activeAccount, onAccountRefresh, activeOverride }: SubscriptionPageProps) => {
  const navigate = useNavigate()
  const [graceLoading, setGraceLoading] = useState(false)
  const [graceError, setGraceError] = useState<string | null>(null)
  // Выбранный период (месяцев) для каждого тарифа
  const [selectedMonths, setSelectedMonths] = useState<Record<string, number>>({ seller: 1, operational: 1 })
  const [payLoading, setPayLoading] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)

  if (!activeAccount) {
    return (
      <div className="py-20 text-center text-sm text-slate-400">Выберите компанию</div>
    )
  }

  const status = getBillingStatus(activeAccount, activeOverride)
  const trialLeft = trialDaysLeft(activeAccount, activeOverride)
  const graceLeft = graceDaysLeft(activeAccount)

  const handleActivateGrace = async () => {
    setGraceLoading(true)
    setGraceError(null)
    try {
      const result = await activateGracePeriod(activeAccount.id)
      if (result?.error) {
        setGraceError(result.error)
      } else {
        onAccountRefresh()
      }
    } catch (e) {
      setGraceError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setGraceLoading(false)
    }
  }

  const handlePay = async (planKey: string) => {
    if (!activeAccount) return
    setPayLoading(planKey)
    setPayError(null)
    try {
      const months = selectedMonths[planKey] ?? 1
      const base = PLAN_PRICES[planKey] ?? 0
      const discount = PERIOD_OPTIONS.find((o) => o.months === months)?.discount ?? 0
      const amount = Math.round(base * months * (1 - discount / 100))
      const result = await createPaymentOrder({
        account_id:   activeAccount.id,
        plan:         planKey as 'seller' | 'operational',
        months,
        amount_som:   amount,
        discount_pct: discount,
      })
      window.location.href = result.payment_url
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Ошибка создания платежа')
    } finally {
      setPayLoading(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Текущий статус */}
      <Card className="rounded-3xl p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">Текущий статус</p>
        {activeOverride && new Date(activeOverride.free_until) >= new Date() && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-700">
            <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>
              <strong>Ручной доступ</strong>{' '}
              {activeOverride.type === 'trial' && '— пробный период'}
              {activeOverride.type === 'plan' && `— тариф ${activeOverride.plan}`}{' '}
              до {new Date(activeOverride.free_until).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-sm text-slate-500">Компания</p>
            <p className="font-semibold text-slate-900">{activeAccount.name}</p>
          </div>
          <div>
            <p className="text-sm text-slate-500">Статус</p>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              status === 'active' ? 'bg-emerald-100 text-emerald-700'
              : status === 'trial' ? 'bg-blue-100 text-blue-700'
              : status === 'grace' ? 'bg-orange-100 text-orange-700'
              : 'bg-rose-100 text-rose-700'
            }`}>
              {status === 'active' && '✓ Активна'}
              {status === 'trial' && `⏳ Пробный период — ${trialLeft} дн.`}
              {status === 'grace' && `⚠️ Продление в долг — ${graceLeft} дн.`}
              {status === 'expired' && '🔒 Истёк'}
            </span>
          </div>
          {activeAccount.trial_ends_at && (
            <div>
              <p className="text-sm text-slate-500">Триал до</p>
              <p className="font-medium text-slate-700">{formatDate(activeAccount.trial_ends_at)}</p>
            </div>
          )}
          {activeAccount.plan_until && (
            <div>
              <p className="text-sm text-slate-500">Подписка до</p>
              <p className="font-medium text-slate-700">{formatDate(activeAccount.plan_until)}</p>
            </div>
          )}
        </div>

        {/* Grace period action */}
        {status === 'expired' && !activeAccount.grace_until && (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 p-4">
            <p className="text-sm text-rose-800 mb-3">
              Нет активной подписки. Вы можете активировать <strong>3 дня в долг</strong> — система продолжит работу, а дни будут учтены при следующей оплате.
            </p>
            <button
              type="button"
              disabled={graceLoading}
              onClick={() => void handleActivateGrace()}
              className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:opacity-50"
            >
              {graceLoading ? 'Активация...' : 'Активировать +3 дня в долг'}
            </button>
            {graceError && <p className="mt-2 text-xs text-rose-600">{graceError}</p>}
          </div>
        )}
      </Card>

      {/* Тарифы */}
      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">Тарифные планы</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <Card
              key={plan.key}
              className={`rounded-3xl p-5 ${plan.highlight ? 'border-2 border-blue-200 bg-blue-50/40' : ''}`}
            >
              {plan.highlight && (
                <span className="mb-3 inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-600">
                  Популярный
                </span>
              )}
              <p className="text-lg font-black text-slate-900">{plan.label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{plan.description}</p>
              <p className="mt-3 text-2xl font-black text-slate-800">
                {plan.price}
                {plan.price !== '—' && <span className="text-sm font-normal text-slate-500"> /мес</span>}
              </p>
              <ul className="mt-4 space-y-1.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-700">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {/* Калькулятор периода */}
                <p className="mb-2 text-xs text-slate-500">Период</p>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {PERIOD_OPTIONS.map((opt) => {
                    const isSelected = (selectedMonths[plan.key] ?? 1) === opt.months
                    return (
                      <button
                        key={opt.months}
                        type="button"
                        onClick={() => setSelectedMonths((prev) => ({ ...prev, [plan.key]: opt.months }))}
                        className={`rounded-xl px-3 py-1 text-xs font-semibold transition ${
                          isSelected
                            ? 'bg-blue-500 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {opt.label}
                        {opt.discount > 0 && (
                          <span className={`ml-1 ${isSelected ? 'text-blue-200' : 'text-emerald-600'}`}>
                            −{opt.discount}%
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {/* Итоговая сумма */}
                {(() => {
                  const months = selectedMonths[plan.key] ?? 1
                  const base = PLAN_PRICES[plan.key] ?? 0
                  const discount = PERIOD_OPTIONS.find((o) => o.months === months)?.discount ?? 0
                  const total = Math.round(base * months * (1 - discount / 100))
                  return (
                    <div className="mb-3 flex items-baseline gap-2">
                      <span className="text-xl font-black text-slate-800">
                        {total.toLocaleString('ru-RU')} сом
                      </span>
                      {discount > 0 && (
                        <span className="text-xs text-slate-400 line-through">
                          {(base * months).toLocaleString('ru-RU')} сом
                        </span>
                      )}
                      <span className="text-xs text-slate-400">/ {months} мес.</span>
                    </div>
                  )
                })()}
                {payError && payLoading === null && (
                  <p className="mb-2 text-xs text-rose-500">{payError}</p>
                )}
                <button
                  type="button"
                  disabled={payLoading === plan.key}
                  onClick={() => void handlePay(plan.key)}
                  className={`w-full rounded-xl py-2.5 text-sm font-semibold transition ${
                    plan.highlight
                      ? 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50'
                      : 'bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50'
                  }`}
                >
                  {payLoading === plan.key ? 'Обработка...' : 'Оплатить'}
                </button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Контакт */}
      <Card className="rounded-3xl p-5 text-center">
        <p className="text-sm text-slate-600">
          Вопросы по оплате? Пишите в{' '}
          <a href="https://t.me/elestet" target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:underline">
            Telegram
          </a>
        </p>
      </Card>
    </div>
  )
}
