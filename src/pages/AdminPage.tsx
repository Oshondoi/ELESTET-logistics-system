import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { getBillingStatus, trialDaysLeft, graceDaysLeft } from '../lib/plans'
import { adminSetPlan, fetchAllPlanHistory } from '../services/billingService'
import type { PlanHistoryEntry } from '../services/billingService'
import {
  adminGetOverrides, adminCreateOverride, adminDeactivateOverride,
  adminGetSystemSettings, adminUpsertSystemSetting,
} from '../services/accessOverrideService'
import type { AccessOverrideRow } from '../services/accessOverrideService'
import type { PlatformRole } from '../hooks/usePlatformRole'
import {
  adminGetPlatformRoles, adminSetPlatformRole, adminFindUserByShortId,
} from '../services/platformRoleService'
import type { StaffMember } from '../services/platformRoleService'
import { adminGetPlanConfigs, adminUpsertPlanConfig } from '../services/planConfigService'
import type { PlanConfig } from '../services/planConfigService'

interface AdminUser {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  companies: number
  stores: number
  company_names: string[]
  short_id: number | null
}

export interface AdminStats {
  total_users: number
  total_companies: number
  total_stores: number
  users: AdminUser[]
}

export interface AccountBillingRow {
  id: string
  short_id: number | null
  name: string
  plan: string | null
  plan_until: string | null
  trial_ends_at: string | null
  grace_until: string | null
  plan_features: Record<string, unknown> | null
  created_at: string
  owner_user_id: string | null
  owner_email: string | null
  owner_short_id: number | null
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

const STATUS_LABELS: Record<string, string> = {
  trial: 'Триал',
  active: 'Активна',
  grace: 'В долг',
  expired: 'Истёк',
}

const STATUS_COLORS: Record<string, string> = {
  trial: 'bg-blue-100 text-blue-700',
  active: 'bg-emerald-100 text-emerald-700',
  grace: 'bg-orange-100 text-orange-700',
  expired: 'bg-rose-100 text-rose-700',
}

const PLAN_OPTIONS = [
  { value: 'none', label: 'none (нет подписки)' },
  { value: 'trial', label: 'trial (пробный)' },
  { value: 'seller', label: 'seller' },
  { value: 'operational', label: 'operational' },
]

/* ─── SetPlanForm ──────────────────────────────────────────────────── */
interface SetPlanFormProps {
  account: AccountBillingRow
  onDone: () => void
  onCancel: () => void
}

const SetPlanForm = ({ account, onDone, onCancel }: SetPlanFormProps) => {
  const [plan, setPlan] = useState(account.plan ?? 'none')
  const [planUntil, setPlanUntil] = useState(
    account.plan_until ? account.plan_until.slice(0, 10) : ''
  )
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!planUntil) { setErr('Укажите дату окончания'); return }
    setLoading(true)
    setErr(null)
    try {
      await adminSetPlan(account.id, plan, new Date(planUntil).toISOString(), note || undefined)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <p className="mb-3 font-semibold text-slate-700">Установить план — <span className="text-slate-500">{account.name}</span></p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Тариф</label>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            {PLAN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Активен до</label>
          <input
            type="date"
            value={planUntil}
            onChange={(e) => setPlanUntil(e.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Заметка (необяз.)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Оплата 2000р / ..."
            className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => void handleSubmit()}
          className="rounded-xl bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Сохранение...' : 'Сохранить'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-200 px-4 py-1.5 text-xs text-slate-500 transition hover:bg-slate-100"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}

/* ─── AdminPage ─────────────────────────────────────────────────────── */
const ADMIN_TAB_KEY = 'elestet-admin-tab'

export const AdminPage = ({
  platformRole = 'user',
  initialStats = null,
  initialAccounts = null,
  onStatsLoaded,
  onAccountsLoaded,
}: {
  platformRole?: PlatformRole
  initialStats?: AdminStats | null
  initialAccounts?: AccountBillingRow[] | null
  onStatsLoaded?: (stats: AdminStats) => void
  onAccountsLoaded?: (accounts: AccountBillingRow[]) => void
}) => {
  const canEdit = platformRole === 'admin' || platformRole === 'superadmin'
  const isSuperAdmin = platformRole === 'superadmin'
  const [activeTab, setActiveTab] = useState<'users' | 'subscriptions' | 'access' | 'team' | 'payment' | 'plans'>(
    () => (sessionStorage.getItem(ADMIN_TAB_KEY) as 'users' | 'subscriptions' | 'access' | 'team' | 'payment' | 'plans' | null) ?? 'users'
  )

  const handleSetTab = (tab: 'users' | 'subscriptions' | 'access' | 'team' | 'payment' | 'plans') => {
    sessionStorage.setItem(ADMIN_TAB_KEY, tab)
    setActiveTab(tab)
  }

  // ── Users tab state
  const [stats, setStats] = useState<AdminStats | null>(initialStats)
  const [isLoading, setIsLoading] = useState(initialStats === null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // ── Subscriptions tab state
  const [accounts, setAccounts] = useState<AccountBillingRow[]>(initialAccounts ?? [])
  const [planHistory, setPlanHistory] = useState<PlanHistoryEntry[]>([])
  const [subsLoading, setSubsLoading] = useState(false)
  const [subsError, setSubsError] = useState<string | null>(null)
  const [editingAccount, setEditingAccount] = useState<AccountBillingRow | null>(null)

  // ── Access tab state
  const [overrides, setOverrides] = useState<AccessOverrideRow[]>([])
  const [overridesLoading, setOverridesLoading] = useState(false)
  const [overridesError, setOverridesError] = useState<string | null>(null)
  const [trialDaysInput, setTrialDaysInput] = useState('14')
  const [trialDaysSaving, setTrialDaysSaving] = useState(false)
  const [trialDaysSaved, setTrialDaysSaved] = useState(false)
  const [formScope, setFormScope] = useState<'global' | 'account' | 'user'>('account')
  const [formAccountId, setFormAccountId] = useState('')
  const [formUserId, setFormUserId] = useState('')
  const [formType, setFormType] = useState<'trial' | 'plan'>('trial')
  const [formPlan, setFormPlan] = useState<'seller' | 'operational'>('seller')
  const [formFreeUntil, setFormFreeUntil] = useState('')
  const [formReason, setFormReason] = useState('')
  const [formIncludeTrialAccounts, setFormIncludeTrialAccounts] = useState(true)
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // ── Plans tab state
  const [planConfigs, setPlanConfigs] = useState<PlanConfig[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [plansError, setPlansError] = useState<string | null>(null)
  const [editingPlan, setEditingPlan] = useState<PlanConfig | null>(null)
  const [planSaving, setPlanSaving] = useState(false)
  const [planSaveError, setPlanSaveError] = useState<string | null>(null)
  const [planSaveOk, setPlanSaveOk] = useState(false)

  // ── Team tab state
  const [staffList, setStaffList] = useState<StaffMember[]>([])
  const [staffLoading, setStaffLoading] = useState(false)
  const [staffError, setStaffError] = useState<string | null>(null)
  // Форма добавления сотрудника (только superadmin)
  const [addShortId, setAddShortId] = useState('')
  const [addRole, setAddRole] = useState<'support' | 'admin'>('support')
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addSuccess, setAddSuccess] = useState<string | null>(null)
  // Изменение роли в строке таблицы
  const [editingRoleUserId, setEditingRoleUserId] = useState<string | null>(null)
  const [editingRoleValue, setEditingRoleValue] = useState<PlatformRole>('support')
  const [editingRoleSaving, setEditingRoleSaving] = useState(false)

  const loadUsers = useCallback(async () => {
    if (!supabase) return
    setIsLoading(true)
    setError(null)
    try {
      const { data, error: fnErr } = await (supabase as any).rpc('admin_get_stats')
      if (fnErr) throw new Error(fnErr.message)
      if (!data) throw new Error('Пустой ответ')
      const parsed: AdminStats = typeof data === 'string' ? JSON.parse(data) : data
      setStats(parsed)
      onStatsLoaded?.(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setIsLoading(false)
    }
  }, [onStatsLoaded])

  const loadSubscriptions = useCallback(async () => {
    if (!supabase) return
    setSubsLoading(true)
    setSubsError(null)
    try {
      const [accsResult, history] = await Promise.all([
        (supabase as any).rpc('admin_get_billing_overview'),
        fetchAllPlanHistory(),
      ])
      if (accsResult.error) throw new Error(accsResult.error.message)
      const accs = (accsResult.data as AccountBillingRow[] | null) ?? []
      setAccounts(accs)
      onAccountsLoaded?.(accs)
      setPlanHistory(history)
    } catch (e) {
      setSubsError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSubsLoading(false)
    }
  }, [onAccountsLoaded])

  // Лёгкая загрузка только списка компаний (без истории планов) — для дропдауна в табе Доступ
  const loadAccountsOnly = useCallback(async () => {
    if (!supabase || accounts.length > 0) return
    try {
      const { data: accs, error: accsErr } = await (supabase as any).rpc('admin_get_billing_overview')
      if (!accsErr) {
        const list = (accs as AccountBillingRow[] | null) ?? []
        setAccounts(list)
        onAccountsLoaded?.(list)
      }
    } catch { /* silent */ }
  }, [accounts.length, onAccountsLoaded])

  const loadUsersOnly = useCallback(async () => {
    if (!supabase || stats !== null) return
    try {
      const { data, error: fnErr } = await (supabase as any).rpc('admin_get_stats')
      if (!fnErr && data) {
        const parsed: AdminStats = typeof data === 'string' ? JSON.parse(data) : data
        setStats(parsed)
        onStatsLoaded?.(parsed)
      }
    } catch { /* silent */ }
  }, [stats, onStatsLoaded])

  const loadOverrides = useCallback(async () => {
    if (!supabase) return
    setOverridesLoading(true)
    setOverridesError(null)
    try {
      const [rows, settings] = await Promise.all([
        adminGetOverrides(),
        adminGetSystemSettings(),
      ])
      setOverrides(rows)
      if (settings['trial_days_default']) setTrialDaysInput(settings['trial_days_default'])
    } catch (e) {
      setOverridesError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setOverridesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialStats === null) void loadUsers()
  }, []) // загружаем только если нет кэша
  useEffect(() => {
    if (activeTab === 'subscriptions') void loadSubscriptions()
  }, [activeTab, loadSubscriptions])
  useEffect(() => {
    if (activeTab === 'access') {
      void loadAccountsOnly()
      void loadUsersOnly()
      void loadOverrides()
    }
  }, [activeTab, loadAccountsOnly, loadUsersOnly, loadOverrides])

  const loadStaff = useCallback(async () => {
    setStaffLoading(true)
    setStaffError(null)
    try {
      const list = await adminGetPlatformRoles()
      setStaffList(list)
    } catch (e) {
      setStaffError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setStaffLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'team') void loadStaff()
  }, [activeTab, loadStaff])

  const loadPlans = useCallback(async () => {
    setPlansLoading(true)
    setPlansError(null)
    try {
      const list = await adminGetPlanConfigs()
      setPlanConfigs(list)
      setEditingPlan(null)
    } catch (e) {
      setPlansError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setPlansLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'plans') void loadPlans()
  }, [activeTab, loadPlans])

  const filtered = stats?.users.filter((u) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return u.email.toLowerCase().includes(q) || u.company_names.some((n) => n.toLowerCase().includes(q))
  }) ?? []

  const tabs = [
    { key: 'users' as const, label: 'Пользователи' },
    { key: 'subscriptions' as const, label: 'Подписки' },
    { key: 'access' as const, label: 'Доступ' },
    ...(canEdit ? [{ key: 'team' as const, label: 'Команда' }] : []),
    ...(canEdit ? [{ key: 'plans' as const, label: 'Тарифы' }] : []),
    ...(isSuperAdmin ? [{ key: 'payment' as const, label: 'Интеграция оплаты' }] : []),
  ]

  const downloadPaymentDoc = () => {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>ТЗ MBusiness — ELESTET</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  @page { size: A4; margin: 2cm 2.5cm 2cm 2.5cm; mso-page-orientation: portrait; }
  body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.4; }
  h1 { font-size: 16pt; font-weight: bold; margin: 0 0 6pt 0; page-break-after: avoid; }
  h2 { font-size: 13pt; font-weight: bold; margin: 18pt 0 6pt 0; page-break-after: avoid; }
  h3 { font-size: 11pt; font-weight: bold; margin: 12pt 0 4pt 0; page-break-after: avoid; }
  p  { margin: 4pt 0; }
  ul { margin: 4pt 0 4pt 16pt; padding: 0; }
  li { margin: 2pt 0; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 8pt 0;
    table-layout: fixed;
    mso-table-layout-alt: fixed;
  }
  th {
    background: #e8e8e8;
    font-weight: bold;
    font-size: 10pt;
    text-align: left;
    padding: 5pt 6pt;
    border: 1pt solid #888;
    word-wrap: break-word;
  }
  td {
    font-size: 10pt;
    padding: 5pt 6pt;
    border: 1pt solid #bbb;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .mono {
    font-family: Courier New, monospace;
    font-size: 9pt;
    word-break: break-all;
    word-wrap: break-word;
  }
  .meta { color: #555; font-size: 9.5pt; margin: 2pt 0 12pt 0; }
  .note {
    border-left: 4pt solid #f9a825;
    background: #fffde7;
    padding: 6pt 10pt;
    margin: 8pt 0;
    font-size: 10pt;
  }
  .tbl2 col.c1 { width: 35%; }
  .tbl2 col.c2 { width: 65%; }
  .tbl3 col.c1 { width: 22%; }
  .tbl3 col.c2 { width: 18%; }
  .tbl3 col.c3 { width: 60%; }
  .tbl2sm col.c1 { width: 60%; }
  .tbl2sm col.c2 { width: 40%; }
</style>
</head>
<body>
<h1>Техническое задание: Интеграция онлайн-оплаты MBusiness</h1>
<p class="meta">Платформа: ELESTET&#160;&#160;|&#160;&#160;Дата: ${new Date().toLocaleDateString('ru-RU')}&#160;&#160;|&#160;&#160;Версия: 1.1</p>

<h2>1. Назначение</h2>
<p>Настоящее ТЗ описывает требования к интеграции платёжного шлюза MBusiness с платформой ELESTET для приёма онлайн-платежей по подписке.</p>
<p>Со стороны ELESTET интеграция полностью готова: база данных, страница оплаты, страница результата, серверные функции (Edge Functions). Ожидаем API-ключи от MBusiness для финального подключения.</p>

<h2>2. Системные данные ELESTET</h2>
<table class="tbl2">
  <colgroup><col class="c1"/><col class="c2"/></colgroup>
  <tr><th>Параметр</th><th>Значение</th></tr>
  <tr>
    <td>Webhook URL (POST)</td>
    <td class="mono">https://jzucxqakvgzpgtvagsnq.supabase.co&#8203;/functions/v1/payment-webhook</td>
  </tr>
  <tr>
    <td>URL возврата после оплаты</td>
    <td class="mono">https://elestet.net/payment/result&#8203;?order_id={ORDER_ID}</td>
  </tr>
  <tr>
    <td>URL отмены / ошибки</td>
    <td class="mono">https://elestet.net/payment/result&#8203;?order_id={ORDER_ID}</td>
  </tr>
  <tr><td>Валюта</td><td>KGS (кыргызский сом)</td></tr>
</table>
<div class="note"><b>Важно:</b> <span class="mono">{ORDER_ID}</span> — UUID заказа, который мы передаём при создании платежа. Его нужно подставить в redirect URL при настройке на стороне MBusiness.</div>

<h2>3. Создание платежа (ELESTET &#8594; MBusiness)</h2>
<p>Когда пользователь нажимает «Оплатить», наш Edge Function отправляет запрос к вашему API для создания платёжной сессии.</p>
<h3>3.1 Поля запроса</h3>
<table class="tbl3">
  <colgroup><col class="c1"/><col class="c2"/><col class="c3"/></colgroup>
  <tr><th>Поле</th><th>Тип</th><th>Описание</th></tr>
  <tr><td class="mono">amount</td><td>integer</td><td>Сумма в тиынах (сом &#215; 100). Пример: 2&#160;000 сом = 200&#160;000</td></tr>
  <tr><td class="mono">currency</td><td>string</td><td>«KGS»</td></tr>
  <tr><td class="mono">order_id</td><td>string (UUID)</td><td>Уникальный ID заказа ELESTET — нужно сохранить и вернуть в webhook</td></tr>
  <tr><td class="mono">description</td><td>string</td><td>Пример: «Тариф Операционный на 3 мес.»</td></tr>
  <tr><td class="mono">return_url</td><td>string</td><td>URL редиректа пользователя после оплаты (с order_id)</td></tr>
</table>
<h3>3.2 Ожидаемый ответ</h3>
<table class="tbl3">
  <colgroup><col class="c1"/><col class="c2"/><col class="c3"/></colgroup>
  <tr><th>Поле</th><th>Тип</th><th>Описание</th></tr>
  <tr><td class="mono">payment_url</td><td>string</td><td>URL страницы оплаты, на который мы редиректим пользователя</td></tr>
  <tr><td class="mono">provider_order_id</td><td>string</td><td>ID заказа на вашей стороне (для сверки)</td></tr>
</table>

<h2>4. Webhook уведомление (MBusiness &#8594; ELESTET)</h2>
<p>После завершения оплаты ваш сервер отправляет POST-запрос на наш webhook URL. Наш сервер активирует подписку по этому уведомлению.</p>
<h3>4.1 Поля тела запроса (JSON)</h3>
<table class="tbl3">
  <colgroup><col class="c1"/><col class="c2"/><col class="c3"/></colgroup>
  <tr><th>Поле</th><th>Тип</th><th>Описание</th></tr>
  <tr><td class="mono">order_id</td><td>string (UUID)</td><td>ID заказа ELESTET (тот, что мы передали при создании)</td></tr>
  <tr><td class="mono">status</td><td>string</td><td>«paid» — успешно, «failed» — неуспешно</td></tr>
  <tr><td class="mono">provider_order_id</td><td>string</td><td>ID заказа на стороне MBusiness</td></tr>
  <tr><td class="mono">transaction_id</td><td>string</td><td>ID транзакции банка / MBusiness</td></tr>
  <tr><td class="mono">amount</td><td>integer</td><td>Фактически оплаченная сумма в тиынах</td></tr>
</table>
<h3>4.2 Подпись (безопасность)</h3>
<p>Для верификации подлинности webhook мы принимаем HMAC-SHA256 подпись тела запроса. Подпись передаётся в заголовке:</p>
<p><span class="mono">X-MBusiness-Signature: sha256={HMAC_HEX}</span></p>
<p>Секретный ключ для подписи согласовывается отдельно при настройке интеграции.</p>
<h3>4.3 Требования к webhook</h3>
<ul>
  <li>Ожидаем HTTP 200 OK в ответ. При других кодах — повторная отправка.</li>
  <li>Таймаут ожидания ответа: не менее 30 секунд.</li>
  <li>Повторные попытки при недоступности: не менее 3 раз с интервалом 5 минут.</li>
  <li>Webhook должен быть идемпотентным — повторная отправка с тем же order_id не должна дублировать активацию.</li>
</ul>

<h2>5. Тарифы и суммы</h2>
<table class="tbl2sm">
  <colgroup><col class="c1"/><col class="c2"/></colgroup>
  <tr><th>Тариф</th><th>Цена за 1 месяц</th></tr>
  <tr><td>Селлер (seller)</td><td>2&#160;000 сом</td></tr>
  <tr><td>Операционный (operational)</td><td>17&#160;000 сом</td></tr>
  <tr><td>Премиум (premium)</td><td>20&#160;000 сом</td></tr>
</table>
<p>Возможные периоды оплаты: 1, 2, 3, 6, 12 месяцев. Итоговая сумма = цена × кол-во месяцев (± скидка по акции).</p>

<h2>6. Что нужно от MBusiness</h2>
<ul>
  <li>API-ключи sandbox (тестовая среда)</li>
  <li>API-ключи production</li>
  <li>Адреса API endpoint для создания платежа (sandbox и production)</li>
  <li>Тестовые карточные данные для успешной и неуспешной оплаты</li>
  <li>Секретный ключ для HMAC-SHA256 подписи webhook</li>
  <li>Документация по формату запросов (если отличается от описанного выше)</li>
</ul>

<h2>7. Контактное лицо со стороны ELESTET</h2>
<p>По техническим вопросам: <b>Telegram @elestet</b></p>
</body>
</html>`
    const blob = new Blob(['\uFEFF', html], { type: 'application/msword' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'MBusiness_Integration_TZ.doc'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Метрики */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Пользователей', value: stats?.total_users ?? '—', color: 'text-blue-600' },
          { label: 'Компаний', value: stats?.total_companies ?? '—', color: 'text-violet-600' },
          { label: 'Магазинов', value: stats?.total_stores ?? '—', color: 'text-emerald-600' },
        ].map((m) => (
          <Card key={m.label} className="rounded-3xl p-5">
            <div className={`text-3xl font-black ${m.color}`}>{m.value}</div>
            <div className="mt-1 text-sm text-slate-500">{m.label}</div>
          </Card>
        ))}
      </div>

      {/* Табы */}
      <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => handleSetTab(t.key)}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
              activeTab === t.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ TAB: Пользователи ═══════════════════════════════════════ */}
      {activeTab === 'users' && (
        <Card className="overflow-hidden rounded-3xl">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3.5">
            <div className="relative flex-1">
              <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Поиск по email или компании..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-xl border border-transparent bg-slate-100 pl-9 pr-4 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadUsers()}
              disabled={isLoading}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 6.36 2.64L21 3v6h-6l2.12-2.12" />
              </svg>
              Обновить
            </button>
          </div>

          {error && <div className="px-5 py-4 text-sm text-rose-500">{error}</div>}
          {isLoading && !stats && (
            <div className="flex items-center justify-center py-14 text-sm text-slate-400">Загрузка...</div>
          )}

          {stats && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[13px]">
                <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">№</th>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-5 py-3">Email</th>
                    <th className="px-4 py-3">Зарегистрирован</th>
                    <th className="px-4 py-3">Последний вход</th>
                    <th className="px-4 py-3 text-center">Компаний</th>
                    <th className="px-4 py-3 text-center">Магазинов</th>
                    <th className="px-4 py-3">Компании</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((u, idx) => (
                    <tr key={u.id} className="align-middle hover:bg-slate-50">
                      <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-400">
                        {u.short_id != null ? `U${u.short_id}` : '—'}
                      </td>
                      <td className="px-5 py-3 font-medium text-slate-800">{u.email}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(u.created_at)}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(u.last_sign_in_at)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${u.companies > 0 ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400'}`}>
                          {u.companies}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${u.stores > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                          {u.stores}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.company_names.map((name) => (
                            <span key={name} className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{name}</span>
                          ))}
                          {u.company_names.length === 0 && <span className="text-xs text-slate-300">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && !isLoading && (
                    <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">Ничего не найдено</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ═══ TAB: Подписки ═══════════════════════════════════════════ */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-4">
          {/* Форма установки плана */}
          {editingAccount && (
            <SetPlanForm
              account={editingAccount}
              onDone={() => {
                setEditingAccount(null)
                void loadSubscriptions()
              }}
              onCancel={() => setEditingAccount(null)}
            />
          )}

          {/* Таблица компаний */}
          <Card className="overflow-hidden rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <p className="text-sm font-semibold text-slate-700">Компании и планы</p>
              <button
                type="button"
                onClick={() => void loadSubscriptions()}
                disabled={subsLoading}
                className="flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${subsLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 6.36 2.64L21 3v6h-6l2.12-2.12" />
                </svg>
                Обновить
              </button>
            </div>

            {subsError && <div className="px-5 py-4 text-sm text-rose-500">{subsError}</div>}
            {subsLoading && accounts.length === 0 && (
              <div className="flex items-center justify-center py-14 text-sm text-slate-400">Загрузка...</div>
            )}

            {accounts.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[13px]">
                  <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Компания</th>
                      <th className="px-4 py-3">Пользователь</th>
                      <th className="px-4 py-3">Тариф</th>
                      <th className="px-4 py-3">Статус</th>
                      <th className="px-4 py-3">Триал до</th>
                      <th className="px-4 py-3">Подписка до</th>
                      <th className="px-4 py-3">Grace до</th>
                      <th className="px-4 py-3">Создана</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accounts.map((acc) => {
                      const status = getBillingStatus(acc)
                      const days = status === 'trial' ? trialDaysLeft(acc) : status === 'grace' ? graceDaysLeft(acc) : null
                      return (
                        <tr key={acc.id} className="align-middle hover:bg-slate-50">
                          <td className="px-5 py-3">
                            <div className="font-medium text-slate-800">{acc.name}</div>
                            <div className="font-mono text-[11px] text-slate-400">{acc.short_id != null ? `C-${acc.short_id}` : '—'}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-slate-700 text-xs">{acc.owner_email ?? <span className="text-slate-300">—</span>}</div>
                            <div className="font-mono text-[11px] font-semibold text-slate-400">{acc.owner_short_id != null ? `U${acc.owner_short_id}` : <span className="text-slate-300">—</span>}</div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">{acc.plan ?? 'none'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[status] ?? ''}`}>
                              {STATUS_LABELS[status]}
                              {days !== null && ` — ${days}д`}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(acc.trial_ends_at)}</td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(acc.plan_until)}</td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(acc.grace_until)}</td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(acc.created_at)}</td>
                          <td className="px-4 py-3">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => setEditingAccount(acc)}
                                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                              >
                                Установить план
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* История изменений */}
          <Card className="overflow-hidden rounded-3xl">
            <div className="border-b border-slate-100 px-5 py-3.5">
              <p className="text-sm font-semibold text-slate-700">История изменений планов</p>
            </div>
            {planHistory.length === 0 && !subsLoading && (
              <div className="px-5 py-10 text-center text-sm text-slate-400">История пуста</div>
            )}
            {planHistory.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[13px]">
                  <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Дата</th>
                      <th className="px-4 py-3">Событие</th>
                      <th className="px-4 py-3">Компания</th>
                      <th className="px-4 py-3">Было</th>
                      <th className="px-4 py-3">Стало</th>
                      <th className="px-4 py-3">До</th>
                      <th className="px-4 py-3">Заметка</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {planHistory.map((h) => {
                      const acc = accounts.find((a) => a.id === h.account_id)
                      return (
                        <tr key={h.id} className="align-middle hover:bg-slate-50">
                          <td className="px-4 py-3 text-slate-500">{formatDateTime(h.created_at)}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">{h.event_type}</span>
                          </td>
                          <td className="px-4 py-3 text-slate-700">{acc?.name ?? h.account_id.slice(0, 8) + '…'}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">{h.old_plan ?? '—'}</td>
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{h.new_plan ?? '—'}</td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(h.new_plan_until)}</td>
                          <td className="px-4 py-3 text-slate-500 max-w-[180px] truncate">{h.note ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ═══ TAB: Доступ ════════════════════════════════════ */}
      {activeTab === 'access' && (
        <div className="space-y-4">
          {overridesError && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{overridesError}</div>}

          {/* ─ Стандарт триал */}
          {canEdit && (
          <Card className="rounded-3xl p-5">
            <p className="mb-3 text-sm font-semibold text-slate-700">Стандартный триал (дней)</p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={365}
                value={trialDaysInput}
                onChange={(e) => setTrialDaysInput(e.target.value)}
                className="h-9 w-24 rounded-xl border border-slate-200 px-3 text-sm text-slate-800 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                disabled={trialDaysSaving}
                onClick={async () => {
                  setTrialDaysSaving(true)
                  try {
                    await adminUpsertSystemSetting('trial_days_default', String(Number(trialDaysInput)))
                    setTrialDaysSaved(true)
                    setTimeout(() => setTrialDaysSaved(false), 2000)
                  } finally {
                    setTrialDaysSaving(false)
                  }
                }}
                className="rounded-xl bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:opacity-50"
              >
                {trialDaysSaving ? 'Сохранение...' : trialDaysSaved ? '✓ Сохранено' : 'Сохранить'}
              </button>
              <span className="text-xs text-slate-400">Применяется к новым компаниям</span>
            </div>
          </Card>
          )}

          {/* ─ Создать переопределение */}
          {canEdit && (
          <Card className="rounded-3xl p-5">
            <p className="mb-4 text-sm font-semibold text-slate-700">Создать переопределение</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* Скоп */}
              <div>
                <label className="mb-1 block text-xs text-slate-500">Скоп</label>
                <div className="flex gap-3">
                  {(['account', 'user', 'global'] as const).map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-1.5 text-sm">
                      <input type="radio" name="scope" value={s} checked={formScope === s} onChange={() => setFormScope(s)} className="accent-blue-500" />
                      {s === 'account' ? 'Компания' : s === 'user' ? 'Аккаунт' : 'Глобально'}
                    </label>
                  ))}
                </div>
              </div>
              {/* Компания */}
              {formScope === 'account' && (
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Компания</label>
                  <SearchableSelect
                    value={formAccountId}
                    onChange={setFormAccountId}
                    placeholder="— выберите —"
                    options={accounts.map((a) => ({
                      value: a.id,
                      label: `${a.name} (C-${a.short_id})`,
                      searchExtra: `C-${a.short_id} ${a.short_id}`,
                    }))}
                  />
                </div>
              )}
              {/* Пользователь */}
              {formScope === 'user' && (
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Пользователь</label>
                  <SearchableSelect
                    value={formUserId}
                    onChange={setFormUserId}
                    placeholder="— выберите —"
                    options={(stats?.users ?? []).map((u) => ({
                      value: u.id,
                      label: `${u.email}${u.short_id ? ` (U-${u.short_id})` : ''}`,
                      searchExtra: `U-${u.short_id} ${u.short_id}`,
                    }))}
                  />
                </div>
              )}
              {/* Тип */}
              <div>
                <label className="mb-1 block text-xs text-slate-500">Тип</label>
                <div className="flex gap-3">
                  {(['trial', 'plan'] as const).map((t) => (
                    <label key={t} className="flex cursor-pointer items-center gap-1.5 text-sm">
                      <input type="radio" name="type" value={t} checked={formType === t} onChange={() => setFormType(t)} className="accent-blue-500" />
                      {t === 'trial' ? 'Ручной триал' : 'Ручной план'}
                    </label>
                  ))}
                </div>
              </div>
              {/* План */}
              {formType === 'plan' && (
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Тариф</label>
                  <select
                    value={formPlan}
                    onChange={(e) => setFormPlan(e.target.value as 'seller' | 'operational')}
                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="seller">Seller</option>
                    <option value="operational">Operational</option>
                    <option value="premium">Premium</option>
                  </select>
                </div>
              )}
              {/* Дата */}
              <div>
                <label className="mb-1 block text-xs text-slate-500">Бесплатно до</label>
                <input
                  type="date"
                  value={formFreeUntil}
                  onChange={(e) => setFormFreeUntil(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
              {/* Причина */}
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="mb-1 block text-xs text-slate-500">Причина (необяз.)</label>
                <input
                  type="text"
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  placeholder="Комментарий..."
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
            {/* include_trial_accounts — только для глобального скопа */}
            {formScope === 'global' && (
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={formIncludeTrialAccounts}
                  onChange={(e) => setFormIncludeTrialAccounts(e.target.checked)}
                  className="h-4 w-4 rounded accent-blue-500"
                />
                Распространять на компании с активным триалом
              </label>
            )}
            {formError && <p className="mt-2 text-xs text-rose-600">{formError}</p>}
            <button
              type="button"
              disabled={formSubmitting}
              onClick={async () => {
                if (!formFreeUntil) { setFormError('Укажите дату'); return }
                if (formScope === 'account' && !formAccountId) { setFormError('Выберите компанию'); return }
                if (formScope === 'user' && !formUserId) { setFormError('Выберите пользователя'); return }
                setFormSubmitting(true); setFormError(null)
                try {
                  await adminCreateOverride({
                    scope: formScope,
                    account_id: formScope === 'account' ? formAccountId : null,
                    user_id: formScope === 'user' ? formUserId : null,
                    type: formType,
                    plan: formType === 'plan' ? formPlan : null,
                    free_until: formFreeUntil,
                    reason: formReason || null,
                    include_trial_accounts: formScope === 'global' ? formIncludeTrialAccounts : true,
                  })
                  setFormFreeUntil('')
                  setFormReason('')
                  setFormUserId('')
                  void loadOverrides()
                } catch (e) {
                  setFormError(e instanceof Error ? e.message : 'Ошибка')
                } finally {
                  setFormSubmitting(false)
                }
              }}
              className="mt-4 rounded-xl bg-blue-500 px-5 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:opacity-50"
            >
              {formSubmitting ? 'Создание...' : 'Создать'}
            </button>
          </Card>
          )}

          {/* ─ История переопределений */}
          <Card className="overflow-hidden rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <p className="text-sm font-semibold text-slate-700">Переопределения доступа</p>
              <button
                type="button"
                onClick={() => void loadOverrides()}
                disabled={overridesLoading}
                className="flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${overridesLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 6.36 2.64L21 3v6h-6l2.12-2.12" />
                </svg>
                Обновить
              </button>
            </div>
            {overridesLoading && overrides.length === 0 && (
              <div className="flex items-center justify-center py-14 text-sm text-slate-400">Загрузка...</div>
            )}
            {!overridesLoading && overrides.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-slate-400">Переопределений нет</div>
            )}
            {overrides.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[13px]">
                  <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Скоп</th>
                      <th className="px-4 py-3">Компания / Пользователь</th>
                      <th className="px-4 py-3">Тип</th>
                      <th className="px-4 py-3">Тариф</th>
                      <th className="px-4 py-3">До</th>
                      <th className="px-4 py-3">Статус</th>
                      <th className="px-4 py-3">Причина</th>
                      <th className="px-4 py-3">Создано</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overrides.map((ov) => (
                      <tr key={ov.id} className={`align-middle hover:bg-slate-50 ${!ov.is_active ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            ov.scope === 'global' ? 'bg-violet-100 text-violet-700'
                            : ov.scope === 'user' ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                          }`}>
                            {ov.scope === 'global' ? 'Глобально' : ov.scope === 'user' ? 'Аккаунт' : 'Компания'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {ov.scope === 'user'
                            ? (ov.user_email ?? <span className="text-slate-300">—</span>)
                            : (ov.account_name ?? <span className="text-slate-300">—</span>)
                          }
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            ov.type === 'trial' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {ov.type === 'trial' ? 'Триал' : 'План'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{ov.plan ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(ov.free_until)}</td>
                        <td className="px-4 py-3">
                          {ov.is_active
                            ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Активно</span>
                            : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">Отключено</span>
                          }
                        </td>
                        <td className="px-4 py-3 max-w-[160px] truncate text-slate-500">{ov.reason ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(ov.created_at)}</td>
                        <td className="px-4 py-3">
                          {ov.is_active && canEdit && (
                            <button
                              type="button"
                              onClick={async () => {
                                await adminDeactivateOverride(ov.id)
                                void loadOverrides()
                              }}
                              className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-500 transition hover:bg-rose-50"
                            >
                              Отключить
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ═══ TAB: Команда ═══════════════════════════════════ */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          {staffError && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{staffError}</div>}

          {/* ─ Список сотрудников */}
          <Card className="overflow-hidden rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <p className="text-sm font-semibold text-slate-700">Сотрудники платформы</p>
              <button
                type="button"
                onClick={() => void loadStaff()}
                disabled={staffLoading}
                className="flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${staffLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 6.36 2.64L21 3v6h-6l2.12-2.12" />
                </svg>
                Обновить
              </button>
            </div>

            {staffLoading && staffList.length === 0 && (
              <div className="flex items-center justify-center py-14 text-sm text-slate-400">Загрузка...</div>
            )}
            {!staffLoading && staffList.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-slate-400">Сотрудников нет</div>
            )}
            {staffList.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[13px]">
                  <thead className="border-b border-slate-100 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Email</th>
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Роль</th>
                      {isSuperAdmin && <th className="px-4 py-3"></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {staffList.map((member) => (
                      <tr key={member.user_id} className="align-middle hover:bg-slate-50">
                        <td className="px-5 py-3 text-slate-700">{member.email}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">
                          {member.short_id != null ? `U${member.short_id}` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            member.platform_role === 'superadmin' ? 'bg-violet-100 text-violet-700' :
                            member.platform_role === 'admin' ? 'bg-blue-100 text-blue-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {member.platform_role === 'superadmin' ? 'Суперадмин' :
                             member.platform_role === 'admin' ? 'Админ' : 'Саппорт'}
                          </span>
                        </td>
                        {isSuperAdmin && (
                          <td className="px-4 py-3">
                            {editingRoleUserId === member.user_id ? (
                              <div className="flex items-center gap-2">
                                <select
                                  value={editingRoleValue}
                                  onChange={(e) => setEditingRoleValue(e.target.value as PlatformRole)}
                                  className="h-8 rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-300 focus:outline-none"
                                >
                                  <option value="support">Саппорт</option>
                                  <option value="admin">Админ</option>
                                  <option value="superadmin">Суперадмин</option>
                                  <option value="user">— Снять роль</option>
                                </select>
                                <button
                                  type="button"
                                  disabled={editingRoleSaving}
                                  onClick={async () => {
                                    setEditingRoleSaving(true)
                                    try {
                                      await adminSetPlatformRole(member.user_id, editingRoleValue)
                                      setEditingRoleUserId(null)
                                      void loadStaff()
                                    } finally {
                                      setEditingRoleSaving(false)
                                    }
                                  }}
                                  className="rounded-xl bg-blue-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:opacity-50"
                                >
                                  {editingRoleSaving ? '...' : 'OK'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingRoleUserId(null)}
                                  className="rounded-xl border border-slate-200 px-3 py-1 text-xs text-slate-500 transition hover:bg-slate-100"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRoleUserId(member.user_id)
                                  setEditingRoleValue(member.platform_role)
                                }}
                                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                              >
                                Изменить
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ─ Добавить сотрудника (только superadmin) */}
          {isSuperAdmin && (
            <Card className="rounded-3xl p-5">
              <p className="mb-4 text-sm font-semibold text-slate-700">Добавить сотрудника</p>

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">ID пользователя</label>
                  <input
                    type="text"
                    value={addShortId}
                    onChange={(e) => setAddShortId(e.target.value)}
                    placeholder="15 или U15"
                    className="h-9 w-32 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Роль</label>
                  <select
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value as 'support' | 'admin')}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="support">Саппорт</option>
                    <option value="admin">Админ</option>
                  </select>
                </div>
                <button
                  type="button"
                  disabled={addSubmitting || !addShortId.trim()}
                  onClick={async () => {
                    const raw = addShortId.trim().replace(/^[Uu]/, '')
                    const num = parseInt(raw, 10)
                    if (isNaN(num)) { setAddError('Неверный ID'); return }
                    setAddSubmitting(true)
                    setAddError(null)
                    setAddSuccess(null)
                    try {
                      const found = await adminFindUserByShortId(num)
                      if (!found) { setAddError(`Пользователь U${num} не найден`); return }
                      await adminSetPlatformRole(found.user_id, addRole)
                      setAddSuccess(`${found.email} → ${addRole === 'support' ? 'Саппорт' : 'Админ'}`)
                      setAddShortId('')
                      void loadStaff()
                    } catch (e) {
                      setAddError(e instanceof Error ? e.message : 'Ошибка')
                    } finally {
                      setAddSubmitting(false)
                    }
                  }}
                  className="h-9 rounded-xl bg-blue-500 px-5 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:opacity-50"
                >
                  {addSubmitting ? 'Поиск...' : 'Назначить'}
                </button>
              </div>
              {addError && <p className="mt-2 text-xs text-rose-600">{addError}</p>}
              {addSuccess && <p className="mt-2 text-xs text-emerald-600">✓ {addSuccess}</p>}
              <p className="mt-2 text-xs text-slate-400">
                ID виден в таблице пользователей (столбец ID) в формате U15
              </p>
            </Card>
          )}
        </div>
      )}

      {/* ═══ TAB: Интеграция оплаты ══════════════════════════════════ */}
      {activeTab === 'payment' && (
        <div className="space-y-4">
          {/* Статус */}
          <Card className="rounded-3xl p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-xl">⏳</div>
              <div>
                <p className="text-sm font-semibold text-slate-800">Ожидаем API-ключи от MBusiness</p>
                <p className="text-xs text-slate-500">Вся инфраструктура ELESTET готова. Кнопка «Оплатить» отображается на странице тарифов — подключение активируется после получения ключей.</p>
              </div>
            </div>
          </Card>

          {/* Готовность */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="rounded-3xl p-5">
              <p className="mb-3 text-sm font-semibold text-emerald-700">✅ Готово со стороны ELESTET</p>
              <ul className="space-y-2">
                {[
                  'Таблица payment_orders в БД',
                  'RPC create_payment_order, activate_plan_by_payment',
                  'Edge Function create-payment (ждёт ключей)',
                  'Edge Function payment-webhook (ждёт ключей)',
                  'Страница тарифов с выбором периода',
                  'Страница результата с поллингом статуса',
                  'Тариф Premium добавлен',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-slate-700">
                    <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-600">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="rounded-3xl p-5">
              <p className="mb-3 text-sm font-semibold text-amber-700">⏳ Ожидаем от MBusiness</p>
              <ul className="space-y-2">
                {[
                  'API-ключи sandbox (тест)',
                  'API-ключи production',
                  'Адреса endpoint sandbox и production',
                  'Тестовые карточные данные',
                  'Секретный ключ для HMAC-подписи webhook',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-slate-700">
                    <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-600">!</span>
                    {item}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* Системные данные */}
          <Card className="rounded-3xl p-5">
            <p className="mb-4 text-sm font-semibold text-slate-700">Системные данные для MBusiness</p>
            <div className="space-y-3">
              {[
                { label: 'Webhook URL (POST)', value: 'https://jzucxqakvgzpgtvagsnq.supabase.co/functions/v1/payment-webhook' },
                { label: 'Redirect после оплаты', value: 'https://elestet.net/payment/result?order_id={ORDER_ID}' },
                { label: 'Валюта', value: 'KGS (кыргызский сом)' },
              ].map((row) => (
                <div key={row.label} className="flex flex-col gap-0.5">
                  <span className="text-xs text-slate-400">{row.label}</span>
                  <code className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs text-slate-700 break-all">{row.value}</code>
                </div>
              ))}
            </div>
          </Card>

          {/* Тарифы */}
          <Card className="rounded-3xl p-5">
            <p className="mb-3 text-sm font-semibold text-slate-700">Тарифы</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="pb-2 text-left text-xs font-semibold text-slate-500">Тариф</th>
                    <th className="pb-2 text-left text-xs font-semibold text-slate-500">Ключ</th>
                    <th className="pb-2 text-left text-xs font-semibold text-slate-500">Цена / мес</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {[
                    { label: 'Селлер', key: 'seller', price: '2 000 сом' },
                    { label: 'Операционный', key: 'operational', price: '17 000 сом' },
                    { label: 'Премиум', key: 'premium', price: '20 000 сом' },
                  ].map((row) => (
                    <tr key={row.key}>
                      <td className="py-1.5 text-slate-800">{row.label}</td>
                      <td className="py-1.5"><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{row.key}</code></td>
                      <td className="py-1.5 text-slate-700">{row.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">Периоды: 1, 2, 3, 6, 12 месяцев. Сумма = цена × месяцы.</p>
          </Card>

          {/* Скачать ТЗ */}
          <Card className="rounded-3xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Техническое задание для MBusiness</p>
                <p className="mt-0.5 text-xs text-slate-400">Документ с системными данными, форматом запросов, webhook и тарифами — готов к отправке</p>
              </div>
              <button
                type="button"
                onClick={downloadPaymentDoc}
                className="flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Скачать .doc
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ═══ TAB: Тарифы ════════════════════════════════════════ */}
      {activeTab === 'plans' && canEdit && (
        <PlanConfigsTab
          planConfigs={planConfigs}
          plansLoading={plansLoading}
          plansError={plansError}
          editingPlan={editingPlan}
          setEditingPlan={setEditingPlan}
          planSaving={planSaving}
          setPlanSaving={setPlanSaving}
          planSaveError={planSaveError}
          setPlanSaveError={setPlanSaveError}
          planSaveOk={planSaveOk}
          setPlanSaveOk={setPlanSaveOk}
          loadPlans={loadPlans}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Полный список фич системы
// ─────────────────────────────────────────────────────────────────────────────
const ALL_FEATURES: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'Магазины',           label: 'Магазины',           icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l1-5h16l1 5"/><path d="M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9"/><path d="M9 9v11"/><path d="M15 9v11"/><path d="M3 9h18"/></svg> },
  { key: 'Товары',             label: 'Товары',             icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 3H8l-2 4h12l-2-4z"/></svg> },
  { key: 'Товары и GTIN',      label: 'Товары и GTIN',      icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 3H8l-2 4h12l-2-4z"/></svg> },
  { key: 'Справочники',        label: 'Справочники',        icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16"/><path d="M4 10h16"/><path d="M4 14h10"/><path d="M4 18h7"/></svg> },
  { key: 'Стикеры и КИЗы',    label: 'Стикеры и КИЗы',    icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h2"/><path d="M7 12h10"/><path d="M7 17h6"/><path d="M13 7h4"/></svg> },
  { key: 'Отзывы WB',         label: 'Отзывы WB',         icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
  { key: 'Роли',               label: 'Роли',               icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.5"/><path d="M20 8v6"/><path d="M17 11h6"/></svg> },
  { key: 'Фулфилмент',        label: 'Фулфилмент',        icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> },
  { key: 'Фулфилмент + Пайплайн', label: 'Фулфилмент + Пайплайн', icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> },
  { key: 'Логистика',          label: 'Логистика',          icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
  { key: 'Аутсорс B2B',       label: 'Аутсорс B2B',       icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  { key: 'Счета',              label: 'Счета',              icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
  { key: 'White-label (логотип + заголовок вкладки)', label: 'White-label (логотип + заголовок вкладки)', icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg> },
  { key: 'Всё из Операционного', label: 'Всё из Операционного', icon: <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="20 6 9 17 4 12"/></svg> },
]

interface PlanConfigsTabProps {
  planConfigs: PlanConfig[]
  plansLoading: boolean
  plansError: string | null
  editingPlan: PlanConfig | null
  setEditingPlan: React.Dispatch<React.SetStateAction<PlanConfig | null>>
  planSaving: boolean
  setPlanSaving: React.Dispatch<React.SetStateAction<boolean>>
  planSaveError: string | null
  setPlanSaveError: React.Dispatch<React.SetStateAction<string | null>>
  planSaveOk: boolean
  setPlanSaveOk: React.Dispatch<React.SetStateAction<boolean>>
  loadPlans: () => Promise<void>
}

function PlanConfigsTab({
  planConfigs, plansLoading, plansError,
  editingPlan, setEditingPlan,
  planSaving, setPlanSaving,
  planSaveError, setPlanSaveError,
  planSaveOk, setPlanSaveOk,
  loadPlans,
}: PlanConfigsTabProps) {
  const [activePlanTab, setActivePlanTab] = useState<string | null>(null)

  // При первой загрузке — выбираем первый таб
  React.useEffect(() => {
    if (planConfigs.length > 0 && activePlanTab === null) {
      setActivePlanTab(planConfigs[0].key)
    }
  }, [planConfigs, activePlanTab])

  if (plansLoading) return <p className="text-sm text-slate-400">Загрузка...</p>
  if (plansError) return <p className="text-sm text-rose-500">{plansError}</p>
  if (planConfigs.length === 0) return <p className="text-sm text-slate-400">Тарифы не найдены. Примените patch_plan_configs.sql в Supabase Dashboard.</p>

  const currentPlan = planConfigs.find((p) => p.key === activePlanTab) ?? planConfigs[0]
  const isEditing = editingPlan?.key === currentPlan.key
  const p = isEditing ? editingPlan! : currentPlan

  const toggleFeature = (featureKey: string) => {
    if (!isEditing) return
    setEditingPlan((prev) => {
      if (!prev) return prev
      const has = prev.features.includes(featureKey)
      return { ...prev, features: has ? prev.features.filter((f) => f !== featureKey) : [...prev.features, featureKey] }
    })
  }

  // Цена для отображения: зачёркнутая обязательна, со скидкой — опциональна
  const displayPrice = p.price_sale > 0 ? p.price_sale : (p.price_full ?? 0)

  const hasChanges = isEditing && JSON.stringify(editingPlan) !== JSON.stringify(currentPlan)

  const doSave = async () => {
    if (!editingPlan) return
    if (!editingPlan.price_full) { setPlanSaveError('Зачёркнутая цена обязательна'); return }
    setPlanSaving(true); setPlanSaveError(null); setPlanSaveOk(false)
    try {
      await adminUpsertPlanConfig(editingPlan)
      setPlanSaveOk(true)
      void loadPlans()
      setTimeout(() => setPlanSaveOk(false), 2000)
    } catch (e) {
      setPlanSaveError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setPlanSaving(false)
    }
  }

  return (
    <div>
      {/* Табы тарифов */}
      <div className="mb-4 flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
        {planConfigs.map((plan) => (
          <button
            key={plan.key}
            type="button"
            onClick={() => { setActivePlanTab(plan.key); setEditingPlan(null); setPlanSaveError(null); setPlanSaveOk(false) }}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition ${
              activePlanTab === plan.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {plan.label}
            {!plan.is_active && <span className="ml-1 text-xs text-slate-400">(откл.)</span>}
          </button>
        ))}
      </div>

      <Card className="rounded-3xl p-5">
        {/* Шапка */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-semibold uppercase text-slate-400">{currentPlan.key}</span>
            {isEditing && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={p.is_active ?? true}
                  onChange={(e) => setEditingPlan((prev) => prev ? { ...prev, is_active: e.target.checked } : prev)}
                  className="h-3.5 w-3.5 rounded accent-blue-500"
                />
                Активен
              </label>
            )}
            {!isEditing && !currentPlan.is_active && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">Отключён</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isEditing && (
              <button
                type="button"
                onClick={() => { setEditingPlan(null); setPlanSaveError(null); setPlanSaveOk(false) }}
                className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-400 hover:bg-slate-50 transition"
              >
                Отмена
              </button>
            )}
            {!isEditing && (
              <button
                type="button"
                onClick={() => { setEditingPlan({ ...currentPlan }); setPlanSaveError(null); setPlanSaveOk(false) }}
                className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 transition"
              >
                Редактировать
              </button>
            )}
            <button
              type="button"
              disabled={!isEditing || !hasChanges || planSaving}
              onClick={() => void doSave()}
              className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {planSaving ? 'Сохранение...' : 'Сохранить'}
            </button>
            {planSaveOk && <span className="text-xs text-emerald-600">✓ Сохранено</span>}
            {planSaveError && <span className="text-xs text-rose-500">{planSaveError}</span>}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Название */}
          <div>
            <label className="mb-1 block text-xs text-slate-500">Название</label>
            <input type="text" value={p.label} disabled={!isEditing}
              onChange={(e) => setEditingPlan((prev) => prev ? { ...prev, label: e.target.value } : prev)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50 disabled:text-slate-500 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {/* Описание */}
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs text-slate-500">Описание</label>
            <input type="text" value={p.description} disabled={!isEditing}
              onChange={(e) => setEditingPlan((prev) => prev ? { ...prev, description: e.target.value } : prev)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50 disabled:text-slate-500 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {/* Порядок */}
          <div>
            <label className="mb-1 block text-xs text-slate-500">Порядок</label>
            <input type="number" value={p.sort_order} disabled={!isEditing}
              onChange={(e) => setEditingPlan((prev) => prev ? { ...prev, sort_order: Number(e.target.value) } : prev)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50 disabled:text-slate-500 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {/* Зачёркнутая цена (основная, обязательная) */}
          <div>
            <label className="mb-1 block text-xs text-slate-500">
              Зачёркнутая цена <span className="text-rose-400">*</span>
              <span className="ml-1 text-slate-300">(обязательно, сом/мес)</span>
            </label>
            <input type="number" value={p.price_full ?? ''} disabled={!isEditing}
              placeholder="напр. 20000"
              onChange={(e) => setEditingPlan((prev) => prev ? { ...prev, price_full: e.target.value ? Number(e.target.value) : null } : prev)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50 disabled:text-slate-500 placeholder:text-slate-300 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {/* Цена со скидкой (опциональная) */}
          <div>
            <label className="mb-1 block text-xs text-slate-500">
              Цена со скидкой
              <span className="ml-1 text-slate-300">(пусто = без скидки)</span>
            </label>
            <input type="number" value={p.price_sale > 0 ? p.price_sale : ''} disabled={!isEditing}
              placeholder="если есть скидка"
              onChange={(e) => setEditingPlan((prev) => prev ? { ...prev, price_sale: e.target.value ? Number(e.target.value) : 0 } : prev)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50 disabled:text-slate-500 placeholder:text-slate-300 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {/* Итоговая цена показа */}
          <div className="flex items-end gap-2 pb-1">
            <div>
              <p className="mb-1 text-xs text-slate-500">Показывается юзеру</p>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-black text-slate-800">{displayPrice.toLocaleString('ru-RU')} сом</span>
                {p.price_full != null && p.price_sale > 0 && p.price_full > p.price_sale && (
                  <span className="text-sm text-slate-400 line-through">{p.price_full.toLocaleString('ru-RU')}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Фичи */}
        <div className="mt-5">
          <p className="mb-3 text-xs font-semibold text-slate-500">Что входит в тариф</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ALL_FEATURES.map((feat) => {
              const checked = p.features.includes(feat.key)
              return (
                <label
                  key={feat.key}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${
                    checked
                      ? 'border-blue-200 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-500'
                  } ${!isEditing ? 'cursor-default opacity-80' : 'hover:border-blue-300'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!isEditing}
                    onChange={() => toggleFeature(feat.key)}
                    className="h-4 w-4 rounded accent-blue-500 shrink-0"
                  />
                  <span className={`shrink-0 ${checked ? 'text-blue-500' : 'text-slate-400'}`}>{feat.icon}</span>
                  <span className="leading-tight">{feat.label}</span>
                </label>
              )
            })}
          </div>
        </div>

      </Card>
    </div>
  )
}
