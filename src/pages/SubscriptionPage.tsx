import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../components/ui/Card'
import { ImplementationInquiryForm } from '../components/accounts/ImplementationInquiryForm'
import { CompanyBrandSettings } from '../components/accounts/CompanyBrandSettings'
import { getBillingStatus, trialDaysLeft, graceDaysLeft } from '../lib/plans'
import type { ActiveOverride } from '../lib/plans'
import { activateGracePeriod } from '../services/billingService'
import { CalendarCheckout } from '../components/accounts/CalendarCheckout'
import { getPlanConfigs } from '../services/planConfigService'
import type { PlanConfig } from '../services/planConfigService'
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

// Fallback — используется если БД ещё не содержит plan_configs
const FALLBACK_PLANS: PlanConfig[] = [
  { key: 'seller',      label: 'Селлер',       description: 'Для продавцов на маркетплейсах',          features: ['Магазины','Товары и GTIN','Стикеры и КИЗы','Отзывы WB','Роли'],                                                                                     price_sale: 2000,  price_full: null, sort_order: 1 },
  { key: 'operational', label: 'Операционный', description: 'Для фулфилмент-центров, цехов и карго',   features: ['Фулфилмент + Пайплайн','Логистика','Магазины','Товары','Справочники','Стикеры и КИЗы','Аутсорс B2B','Счета','Роли'],                              price_sale: 17000, price_full: null, sort_order: 2 },
  { key: 'premium',     label: 'Премиум',      description: 'Всё включено — сейчас и в будущем',       features: ['Всё из Операционного','White-label (логотип + заголовок вкладки)'],                                                                               price_sale: 20000, price_full: null, sort_order: 3 },
]
// ──────────────────────────────────────────────────────────────

export const SubscriptionPage = ({ activeAccount, onAccountRefresh, activeOverride }: SubscriptionPageProps) => {
  const navigate = useNavigate()
  const [graceLoading, setGraceLoading] = useState(false)
  const [graceError, setGraceError] = useState<string | null>(null)
  const [showGracePopup, setShowGracePopup] = useState(true)
  const [plans, setPlans] = useState<PlanConfig[]>([])
  const [plansLoading, setPlansLoading] = useState(true)

  useEffect(() => {
    getPlanConfigs()
      .then((list) => setPlans(list.length > 0 ? list : FALLBACK_PLANS))
      .catch(() => setPlans(FALLBACK_PLANS))
      .finally(() => setPlansLoading(false))
  }, [])

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


  return (
    <div className="space-y-6">
      {/* Текущий статус */}
      <Card className="rounded-3xl px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {activeOverride && new Date(activeOverride.free_until) >= new Date() && (
            <span className="flex items-center gap-1.5 text-xs text-violet-700">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <strong>Ручной доступ</strong>{' '}
              {activeOverride.type === 'trial' && '— пробный период'}
              {activeOverride.type === 'plan' && `— тариф ${activeOverride.plan}`}{' '}
              до {new Date(activeOverride.free_until).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </span>
          )}
          {activeOverride && new Date(activeOverride.free_until) >= new Date() && (
            <span className="h-4 w-px bg-slate-200" />
          )}
          <span className="text-sm text-slate-700">
            <span className="text-slate-500">Компания:</span>{' '}
            <span className="font-semibold text-slate-900">{activeAccount.name}</span>
          </span>
          <span className="text-sm text-slate-700">
            <span className="text-slate-500">Статус:</span>{' '}
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
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
          </span>
          {activeAccount.trial_ends_at && (
            <span className="text-sm text-slate-700">
              <span className="text-slate-500">Триал до:</span>{' '}
              <span className="font-medium">{formatDate(activeAccount.trial_ends_at)}</span>
            </span>
          )}
          {activeAccount.plan_until && (
            <span className="text-sm text-slate-700">
              <span className="text-slate-500">Подписка до:</span>{' '}
              <span className="font-medium">{formatDate(activeAccount.plan_until)}</span>
            </span>
          )}
        </div>

        {/* Grace period action — floating popup */}
        {status === 'expired' && !activeAccount.grace_until && showGracePopup && (
          <div className="fixed bottom-6 right-6 z-50 w-80 rounded-2xl border border-rose-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 p-4 pb-3">
              <p className="text-sm text-rose-800 leading-snug">
                Нет активной подписки. Вы можете активировать <strong>3 дня в долг</strong> — система продолжит работу, а дни будут учтены при следующей оплате.
              </p>
              <button
                type="button"
                onClick={() => setShowGracePopup(false)}
                className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                aria-label="Закрыть"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 pb-4">
              <button
                type="button"
                disabled={graceLoading}
                onClick={() => void handleActivateGrace()}
                className="w-full rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:opacity-50"
              >
                {graceLoading ? 'Активация...' : 'Активировать +3 дня в долг'}
              </button>
              {graceError && <p className="mt-2 text-xs text-rose-600">{graceError}</p>}
            </div>
          </div>
        )}
      </Card>

      {/* Тарифы */}
      <div>
        {plansLoading && <p className="py-6 text-center text-sm text-slate-400">Загрузка тарифов...</p>}
        {!plansLoading && (
          <div className={`grid gap-4 ${plans.length === 3 ? 'sm:grid-cols-3' : plans.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
            {plans.filter(plan => plan.key === 'seller' || plan.key === 'operational').map((plan) => (
              <Card
                key={plan.key}
                className={`rounded-3xl p-5 ${
                  plan.key === 'premium' ? 'border-2 border-amber-200 bg-amber-50/40' : ''
                }`}
              >
                <p className="text-lg font-black text-slate-900">{plan.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{plan.description}</p>
                {/* Цена */}
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-slate-800">
                    {((plan.price_sale > 0 ? plan.price_sale : (plan.price_full ?? 0))).toLocaleString('ru-RU')} сом
                    <span className="text-sm font-normal text-slate-500"> /мес</span>
                  </span>
                  {plan.price_full != null && plan.price_sale > 0 && plan.price_full > plan.price_sale && (
                    <span className="text-sm text-slate-400 line-through">
                      {plan.price_full.toLocaleString('ru-RU')} сом
                    </span>
                  )}
                </div>
                <ul className="mt-4 space-y-1.5">
                  {plan.features.filter((f) => f.trim()).map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-slate-700">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="m5 13 4 4L19 7" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <p className="mt-5 text-sm text-slate-500">Расчёт и оформление — в блоке оплаты ниже.</p>
              </Card>
            ))}
          </div>
        )}
      </div>

      <CalendarCheckout key={`checkout-${activeAccount.id}`} accountId={activeAccount.id} onRefresh={onAccountRefresh} />
      <Card className="rounded-3xl p-5"><h2 className="text-lg font-semibold">Свой бренд</h2><p className="mt-2"><s className="mr-2 text-slate-400">10 000 сом</s>5 000 сом / месяц, отдельно от основного тарифа.</p><p className="mt-2 text-sm text-slate-500">Без пробного периода. Требуется действующий основной тариф.</p></Card>
      <Card className="rounded-3xl p-5"><h2 className="text-lg font-semibold">Премиум — с внедрением</h2><p className="mt-2">Внедрение: 90 000 сом, отдельно от регулярного тарифа.</p><p className="mt-2 text-sm text-slate-500">Состав работ и дата запуска согласовываются с командой. Оплата не запускает внедрение автоматически.</p></Card>
      <ImplementationInquiryForm key={activeAccount.id} accountId={activeAccount.id} />
      <CompanyBrandSettings key={`brand-${activeAccount.id}`} accountId={activeAccount.id} />
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
