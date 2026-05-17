import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'
import type { Store } from '../types'

// ── Типы ─────────────────────────────────────────────────────────────────────

interface TeksherStats {
  connected: true
  participantName: string
  participantId: string
  balance: number       // балл-коды
  balanceMoney: number  // деньги
  course?: number       // курс: 1 сом = course КИЗ-кодов
  productGroup?: string // productGroupAlias (lp, etc)
}

interface TeksherProduct {
  id: string | number
  gtin: string
  name?: string
  fullName?: string
  status?: string
  codesCount?: number
  productGroupCode?: string
  trademark?: string
}

interface TeksherCode {
  id: string | number
  code?: string
  barcode?: string
  gtin?: string
  status?: string
  issueDate?: string
  createdDate?: string
  emissionDate?: string
}

interface TeksherOperation {
  id: string | number
  operationId?: string | number
  operationType?: string
  type?: string
  status?: string
  kmsCount?: number
  codesCount?: number
  gtin?: string
  createdAt?: string
  createdDate?: string
}

interface TnvedItem {
  id?: string | number
  fullCode?: string
  code?: string
  subPositionName?: string
  positionName?: string
  position?: string
  groupName?: string
  productGroup?: string
  subgroupId?: number | null
  teksherTnvedId?: number | null
  [key: string]: unknown
}

interface AttrTemplate {
  // Актуальная структура API Teksher
  dataType?: number
  position?: number
  isRequired?: boolean
  multiplication?: boolean
  attributeType?: {
    code?: string
    name?: string
    values?: Array<string | { id?: number; value?: string; code?: string; name?: string }>
    unitCodes?: string[]
  }
  // Старая структура (запасной вариант)
  attributeTypeCode?: string; code?: string; typeCode?: string
  name?: string; attributeTypeName?: string; required?: boolean
  allowedValues?: Array<string | { value?: string; name?: string }>
  values?: Array<string | { value?: string; name?: string }>
  dictionaryValues?: Array<string | { value?: string; name?: string }>
}


interface CountryItem {
  id?: string | number
  name?: string
  nameRu?: string
  code?: string
  numericCode?: string | number
  [key: string]: unknown
}

interface KizPageProps {
  stores: Store[]
  selectedStoreId: string
  onStoreChange: (id: string) => void
  isAdmin?: boolean
}

// ── Утилиты ───────────────────────────────────────────────────────────────────

function statusBadge(status: string | undefined): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    PUBLISHED:           { label: 'Опубликован',        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    ACTIVE:              { label: 'Активен',             cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    DRAFT:               { label: 'Черновик',            cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    ARCHIVED:            { label: 'Архивирован',         cls: 'bg-slate-100 text-slate-500 border-slate-200' },
    WITHDRAWN:           { label: 'Отозван',             cls: 'bg-red-50 text-red-700 border-red-200' },
    ISSUED:              { label: 'Эмиттирован',         cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    MARKED:              { label: 'Нанесён (не оплач.)', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    PAYED:               { label: 'Нанесён',             cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    APPLIED:             { label: 'Нанесён',             cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    SOLD:                { label: 'Продан',              cls: 'bg-violet-50 text-violet-700 border-violet-200' },
    WRITTEN_OFF:         { label: 'Списан',              cls: 'bg-slate-100 text-slate-500 border-slate-200' },
    COMPLETED:           { label: 'Выполнена',           cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    PENDING:             { label: 'Ожидание',            cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    IN_PROGRESS:         { label: 'В обработке',         cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    FAILED:              { label: 'Ошибка',              cls: 'bg-red-50 text-red-700 border-red-200' },
    CANCELLED:           { label: 'Отменена',            cls: 'bg-slate-100 text-slate-500 border-slate-200' },
    IMPORT_REGISTRATION: { label: 'Трансгран',           cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  }
  if (!status) return { label: '—', cls: 'bg-slate-100 text-slate-400 border-slate-200' }
  return map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 border-slate-200' }
}

function opTypeLabel(type: string | undefined): string {
  const map: Record<string, string> = {
    EMISSION:    'Эмиссия',
    UTILISATION: 'Нанесение',
    TRANSGRAN:   'Трансгран',
    IMPORT:      'Импорт',
  }
  if (!type) return '—'
  return map[type] ?? type
}

function fmtDate(d: string | undefined): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) }
  catch { return d }
}

// ── Компоненты ────────────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: string | undefined }) => {
  const { label, cls } = statusBadge(status)
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

const Skeleton = ({ rows = 5 }: { rows?: number }) => (
  <div className="animate-pulse space-y-2 p-4">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="h-10 rounded-lg bg-slate-100" />
    ))}
  </div>
)

const NotConnectedPlug = ({ onGoToMain }: { onGoToMain: () => void }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
    </div>
    <p className="text-sm font-medium text-slate-600">Teksher не подключён</p>
    <p className="text-xs text-slate-400">Подключите Teksher чтобы работать с КИЗами</p>
    <button type="button" onClick={onGoToMain} className="mt-1 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700">
      Подключить →
    </button>
  </div>
)

const EmptyState = ({ text, sub }: { text: string; sub?: string }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
      <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
    </div>
    <p className="text-sm font-medium text-slate-600">{text}</p>
    {sub && <p className="text-xs text-slate-400 max-w-xs">{sub}</p>}
  </div>
)

// ── Invoke helper ─────────────────────────────────────────────────────────────

async function invoke(body: Record<string, unknown>): Promise<{ data: Record<string, unknown> | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase не инициализирован' }
  // Принудительно обновляем сессию перед вызовом edge function
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { data: null, error: 'Сессия истекла. Войдите снова.' }
  const { data, error } = await supabase.functions.invoke('teksher-auth', {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) {
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx) {
        const j = await ctx.clone().json() as { error?: string }
        if (j?.error) return { data: null, error: j.error }
      }
    } catch { /* ignore */ }
    return { data: null, error: (error as { message?: string }).message ?? 'Неизвестная ошибка' }
  }
  const d = data as Record<string, unknown>
  if (d?.error) return { data: null, error: d.error as string }
  return { data: d, error: null }
}

// ── Searchable Select ───────────────────────────────────────────────────────────
function SearchableSelect({ value, options, placeholder = '— Выберите —', onChange, className }: {
  value: string; options: string[]; placeholder?: string; onChange: (v: string) => void; className?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dropPos, setDropPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null)

  useEffect(() => { if (open) { setSearch(''); inputRef.current?.focus() } }, [open])

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const above = spaceBelow < 220 && rect.top > 220
    setDropPos({
      top: above ? undefined : rect.bottom + 4,
      bottom: above ? window.innerHeight - rect.top + 4 : undefined,
      left: rect.left,
      width: rect.width,
    })
  }, [open])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node)) {
        setOpen(false); setSearch('')
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (dropRef.current?.contains(e.target as Node)) return
      setOpen(false); setSearch('')
    }
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [open])

  const filtered = search ? options.filter(o => o.toLowerCase().includes(search.toLowerCase())) : options

  const dropdown = open && dropPos ? (
    <div ref={dropRef} style={{ position: 'fixed', top: dropPos.top, bottom: dropPos.bottom, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
      className="rounded-lg border border-slate-200 bg-white shadow-lg max-h-52 overflow-y-auto">
      {filtered.length === 0
        ? <div className="px-3 py-2 text-sm text-slate-400">Ничего не найдено</div>
        : filtered.map(opt => (
          <button key={opt} type="button" onClick={() => { onChange(opt); setOpen(false); setSearch('') }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700 ${opt === value ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}>
            {opt}
          </button>
        ))
      }
    </div>
  ) : null

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      {open ? (
        <input ref={inputRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск..." className="w-full rounded-lg border border-blue-500 px-3 py-2 text-sm outline-none ring-1 ring-blue-500" />
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-left flex items-center justify-between bg-white hover:border-slate-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500">
          <span className={value ? 'text-slate-900' : 'text-slate-400'}>{value || placeholder}</span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400 shrink-0 ml-2" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
        </button>
      )}
      {createPortal(dropdown, document.body)}
    </div>
  )
}

// ── Основной компонент ────────────────────────────────────────────────────────

export const KizPage = ({ stores, selectedStoreId, onStoreChange }: KizPageProps) => {
  const sortedStores = [...stores].sort((a, b) => {
    const aConn = a.teksher_login ? 0 : 1
    const bConn = b.teksher_login ? 0 : 1
    if (aConn !== bConn) return aConn - bConn
    return a.name.localeCompare(b.name, 'ru')
  })
  const activeStore = sortedStores.find((s) => s.id === selectedStoreId) ?? sortedStores[0]

  const [tab, setTab] = useState<'main' | 'products' | 'codes' | 'operations'>('main')

  // Connection / stats
  const [stats, setStats] = useState<TeksherStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [connectForm, setConnectForm] = useState({ login: '', password: '' })
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  // ТН ВЭД sync
  const [tnvedSyncing, setTnvedSyncing] = useState(false)

  // Products
  const [products, setProducts] = useState<TeksherProduct[]>([])
  const [productsTotal, setProductsTotal] = useState(0)
  const [productsPage, setProductsPage] = useState(0)
  const [productsLoading, setProductsLoading] = useState(false)
  const [productsSearch, setProductsSearch] = useState('')

  // Codes
  const [codes, setCodes] = useState<TeksherCode[]>([])
  const [codesTotal, setCodesTotal] = useState(0)
  const [codesLoading, setCodesLoading] = useState(false)
  const [codesStatusFilter, setCodesStatusFilter] = useState('')

  // Operations
  const [operations, setOperations] = useState<TeksherOperation[]>([])
  const [operationsTotal, setOperationsTotal] = useState(0)
  const [operationsLoading, setOperationsLoading] = useState(false)

  // Emit modal
  const [emitModal, setEmitModal] = useState(false)
  const [emitGtin, setEmitGtin] = useState('')
  const [emitQty, setEmitQty] = useState('10')
  const [emitLoading, setEmitLoading] = useState(false)
  const [emitError, setEmitError] = useState<string | null>(null)
  const [emitSuccess, setEmitSuccess] = useState<string | null>(null)

  // Create product modal
  const [createProductModal, setCreateProductModal] = useState(false)
  const [cpGtin, setCpGtin] = useState('')
  const [cpName, setCpName] = useState('')
  const [cpTrademark, setCpTrademark] = useState('')
  const [cpTnved, setCpTnved] = useState('')
  const [cpLoading, setCpLoading] = useState(false)
  const [cpError, setCpError] = useState<string | null>(null)

  // Create product - extended form
  const [cpTab, setCpTab] = useState(0)
  const [cpTnvedName, setCpTnvedName] = useState('')
  const [cpTnvedPos, setCpTnvedPos] = useState('')
  const [cpTnvedPosName, setCpTnvedPosName] = useState('')
  const [cpHasMfr, setCpHasMfr] = useState(true)
  const [cpCountry, setCpCountry] = useState('КЫРГЫЗСТАН')
  const [cpCountryId, setCpCountryId] = useState<number | null>(null)
  const [cpMfrINN, setCpMfrINN] = useState('')
  const [cpMfrName, setCpMfrName] = useState('')
  const [cpAttrValues, setCpAttrValues] = useState<Record<string, string | string[]>>({})
  const [cpAttrUnits, setCpAttrUnits] = useState<Record<string, string | string[]>>({})
  const [cpTeksherTnvedId, setCpTeksherTnvedId] = useState<number | null>(null)
  const [cpMpArticle, setCpMpArticle] = useState('')
  // Атрибуты (динамические — загружаются при выборе ТН ВЭД)
  const [cpAttrTemplates, setCpAttrTemplates] = useState<AttrTemplate[]>([])
  const [cpAttrLoading, setCpAttrLoading] = useState(false)
  // ТН ВЭД selector
  const [tnvedModal, setTnvedModal] = useState(false)
  const [tnvedSearch, setTnvedSearch] = useState('')
  const [tnvedList, setTnvedList] = useState<TnvedItem[]>([])
  const [tnvedLoading, setTnvedLoading] = useState(false)
  const [tnvedDropOpen, setTnvedDropOpen] = useState(false)
  const tnvedDropRef = useRef<HTMLDivElement>(null)
  const tnvedLockedCode = useRef<string | null>(null) // код выбран из списка — не запускать поиск
  // Countries ref
  const [countries, setCountries] = useState<CountryItem[]>([])
  const [participantInfo, setParticipantInfo] = useState<{ gcp: string; gln: string; participantId: string; inn: string; companyName: string } | null>(null)
  const [participantLoading, setParticipantLoading] = useState(false)

  // Topup modal
  const [topupModal, setTopupModal] = useState(false)
  const [topupAmount, setTopupAmount] = useState('')
  const [topupQty, setTopupQty] = useState('')
  const [topupQrData, setTopupQrData] = useState<string | null>(null)
  const [topupQrLoading, setTopupQrLoading] = useState(false)
  const [topupQrError, setTopupQrError] = useState<string | null>(null)

  // Toast
  const [actionResult, setActionResult] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showAction(type: 'ok' | 'err', msg: string) {
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current)
    setActionResult({ type, msg })
    actionTimerRef.current = setTimeout(() => setActionResult(null), 4000)
  }

  // Password visibility
  const [showPassword, setShowPassword] = useState(false)

  // Store dropdown
  const [storeDropOpen, setStoreDropOpen] = useState(false)
  const storeDropRef = useRef<HTMLDivElement>(null)

  // Блокировка скролла фона при открытой модалке
  useEffect(() => {
    if (createProductModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [createProductModal])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!storeDropRef.current?.contains(e.target as Node)) setStoreDropOpen(false)
      if (!tnvedDropRef.current?.contains(e.target as Node)) setTnvedDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Загрузка QR для пополнения ─────────────────────────────────────────
  const loadTopupQr = useCallback(async () => {
    if (!activeStore?.id) return
    setTopupQrLoading(true)
    setTopupQrData(null)
    setTopupQrError(null)
    const productGroupAlias = stats?.productGroup ?? 'lp'
    const { data, error } = await invoke({ store_id: activeStore.id, action: 'topup_qr', productGroupAlias })
    setTopupQrLoading(false)
    if (error) { setTopupQrError(error); return }
    if (data?.qrError) { setTopupQrError(data.qrError as string); return }
    if (data?.qrString) setTopupQrData(data.qrString as string)
  }, [activeStore?.id])

  // ── Загрузка статистики ──────────────────────────────────────────────────
  const loadStats = useCallback(async (storeId: string) => {
    if (!storeId) return
    setStatsLoading(true)
    setStats(null)
    const { data, error } = await invoke({ store_id: storeId, action: 'stats' })
    setStatsLoading(false)
    if (error || !data || data.connected === false) { setStats(null); return }
    setStats(data as unknown as TeksherStats)
  }, [])

  useEffect(() => {
    if (activeStore?.id) {
      setTab('main')
      setProducts([])
      setCodes([])
      setOperations([])
      setParticipantInfo(null)
      void loadStats(activeStore.id)
    }
  }, [activeStore?.id, loadStats])

  // ── Загрузка товаров ─────────────────────────────────────────────────────
  const loadProducts = useCallback(async (page = 0, search = '') => {
    if (!activeStore?.id) return
    setProductsLoading(true)
    const { data, error } = await invoke({ store_id: activeStore.id, action: 'products', page, size: 20, search })
    setProductsLoading(false)
    if (error) { showAction('err', error); return }
    if (page === 0) setProducts((data?.items as TeksherProduct[]) ?? [])
    else setProducts((prev) => [...prev, ...((data?.items as TeksherProduct[]) ?? [])])
    setProductsTotal(Number(data?.total ?? 0))
    setProductsPage(page)
  }, [activeStore?.id])

  useEffect(() => {
    if (tab === 'products' && stats) void loadProducts(0, productsSearch)
  }, [tab, stats, loadProducts, productsSearch])

  // ── Загрузка кодов ───────────────────────────────────────────────────────
  const loadCodes = useCallback(async (statusFilter = '') => {
    if (!activeStore?.id) return
    setCodesLoading(true)
    const { data, error } = await invoke({ store_id: activeStore.id, action: 'codes', page: 0, size: 50, status: statusFilter })
    setCodesLoading(false)
    if (error) { showAction('err', error); return }
    setCodes((data?.items as TeksherCode[]) ?? [])
    setCodesTotal(Number(data?.total ?? 0))
  }, [activeStore?.id])

  useEffect(() => {
    if (tab === 'codes' && stats) void loadCodes(codesStatusFilter)
  }, [tab, stats, loadCodes, codesStatusFilter])

  // ── Загрузка операций ────────────────────────────────────────────────────
  const loadOperations = useCallback(async () => {
    if (!activeStore?.id) return
    setOperationsLoading(true)
    const { data, error } = await invoke({ store_id: activeStore.id, action: 'operations', page: 0, size: 20 })
    setOperationsLoading(false)
    if (error) { showAction('err', error); return }
    setOperations((data?.items as TeksherOperation[]) ?? [])
    setOperationsTotal(Number(data?.total ?? 0))
  }, [activeStore?.id])

  useEffect(() => {
    if (tab === 'operations' && stats) void loadOperations()
  }, [tab, stats, loadOperations])

  // ── Подключить Teksher ───────────────────────────────────────────────────
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeStore?.id) return
    setConnectLoading(true)
    setConnectError(null)
    const { data, error } = await invoke({
      store_id: activeStore.id,
      action: 'connect',
      login: connectForm.login,
      password: connectForm.password,
    })
    setConnectLoading(false)
    if (error) { setConnectError(error); return }
    setConnectForm({ login: '', password: '' })
    if (data?.connected) showAction('ok', 'Teksher подключён!')
    void loadStats(activeStore.id)
  }

  // ── Отключить ────────────────────────────────────────────────────────────
  const handleDisconnect = async () => {
    if (!activeStore?.id || !confirm('Отключить Teksher от этого магазина?')) return
    const { error } = await invoke({ store_id: activeStore.id, action: 'disconnect' })
    if (error) { showAction('err', error); return }
    setStats(null)
    showAction('ok', 'Teksher отключён')
  }

  // ── Синхронизировать ─────────────────────────────────────────────────────
  const handleSync = async () => {
    if (!activeStore?.id) return
    await loadStats(activeStore.id)
    if (tab === 'products') void loadProducts(0, productsSearch)
    if (tab === 'codes') void loadCodes(codesStatusFilter)
    if (tab === 'operations') void loadOperations()
    showAction('ok', 'Данные обновлены')
  }

  // ── Обновить базу ТН ВЭД ─────────────────────────────────────────────────
  const handleTnvedSync = async () => {
    setTnvedSyncing(true)
    try {
      const { data, error } = await supabase.functions.invoke('tnved-sync')
      if (error) { showAction('err', `ТН ВЭД: ${error.message}`); return }
      const d = data as { success?: boolean; synced?: number; error?: string } | null
      if (d?.error) { showAction('err', `ТН ВЭД: ${d.error}`); return }
      // Также обновляем справочник стран
      if (activeStore?.id) {
        const { data: cd } = await invoke({ store_id: activeStore.id, action: 'refresh_countries' })
        if (cd?.items) setCountries(cd.items as CountryItem[])
      }
      showAction('ok', `Справочники обновлены: ТН ВЭД ${(d?.synced ?? 0).toLocaleString('ru')} кодов`)
    } catch (e) {
      showAction('err', `Ошибка: ${(e as Error).message}`)
    } finally {
      setTnvedSyncing(false)
    }
  }

  // ── Опубликовать товар ───────────────────────────────────────────────────
  const handlePublishProduct = async (productId: string | number) => {
    if (!activeStore?.id) return
    const { error } = await invoke({ store_id: activeStore.id, action: 'publish_product', productId: String(productId) })
    if (error) { showAction('err', error); return }
    showAction('ok', 'Товар опубликован')
    void loadProducts(productsPage, productsSearch)
  }

  // ── Нанести коды ─────────────────────────────────────────────────────────
  const handleUtilise = async (orderId: string | number) => {
    if (!activeStore?.id) return
    const { error } = await invoke({ store_id: activeStore.id, action: 'utilise', orderId: String(orderId) })
    if (error) { showAction('err', error); return }
    showAction('ok', 'Нанесение зарегистрировано')
    void loadOperations()
  }

  // ── Заказать КИЗы ────────────────────────────────────────────────────────
  const handleEmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeStore?.id) return
    setEmitLoading(true)
    setEmitError(null)
    setEmitSuccess(null)
    const { data, error } = await invoke({ store_id: activeStore.id, action: 'emit', gtin: emitGtin, quantity: Number(emitQty) })
    setEmitLoading(false)
    if (error) { setEmitError(error); return }
    setEmitSuccess(`Операция создана${data?.operationId ? `. ID: ${String(data.operationId).slice(0, 16)}…` : ''}`)
    void loadStats(activeStore.id)
  }

  // ── Создать товар ─────────────────────────────────────────────────────────
  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeStore?.id) return
    setCpLoading(true)
    setCpError(null)
    // Собираем атрибуты из динамических полей
    const attributes: Array<{ attributeTypeCode: string; value: string; unitCode?: string }> = []
    for (const [code, val] of Object.entries(cpAttrValues)) {
      const unitVal = cpAttrUnits[code]
      if (Array.isArray(val)) {
        val.forEach((v, i) => {
          if (v) {
            const u = Array.isArray(unitVal) ? unitVal[i] : unitVal
            attributes.push({ attributeTypeCode: code, value: v, ...(u ? { unitCode: u } : {}) })
          }
        })
      } else {
        if (val) {
          const u = typeof unitVal === 'string' ? unitVal : undefined
          attributes.push({ attributeTypeCode: code, value: val, ...(u ? { unitCode: u } : {}) })
        }
      }
    }
    const { error } = await invoke({
      store_id: activeStore.id,
      action: 'create_product',
      gtin: cpGtin,
      fullName: cpName,
      trademark: cpTrademark,
      tnvedId: cpTeksherTnvedId,
      producerINN: cpHasMfr ? cpMfrINN : undefined,
      producerName: cpHasMfr ? cpMfrName : undefined,
      countryId: cpCountryId ?? undefined,
      attributes,
    })
    setCpLoading(false)
    if (error) { setCpError(error); return }
    setCreateProductModal(false)
    setCpGtin(''); setCpName(''); setCpTrademark(''); setCpTnved(''); setCpMpArticle('')
    setCpAttrValues({}); setCpAttrUnits({}); setCpAttrTemplates([]); setCpTeksherTnvedId(null); setCpCountryId(null)
    showAction('ok', 'Товар создан (статус DRAFT)')
    void loadProducts(0, productsSearch)
  }

  // ── Инфо об участнике ────────────────────────────────────────────────────
  const loadParticipantInfo = async () => {
    if (!activeStore?.id) return
    setParticipantLoading(true)
    const { data, error } = await invoke({ store_id: activeStore.id, action: 'participant_info' })
    setParticipantLoading(false)
    if (error) { showAction('err', error); return }
    setParticipantInfo(data as { gcp: string; gln: string; participantId: string; inn: string; companyName: string })
  }

  // ── Загрузка списка ТН ВЭД ──────────────────────────────────────────────
  const loadTnvedList = useCallback(async (search: string) => {
    if (!activeStore?.id) return
    setTnvedLoading(true)
    const { data } = await invoke({ store_id: activeStore.id, action: 'tnved_list', search, page: 0, size: 50 })
    setTnvedLoading(false)
    setTnvedList((data?.items ?? []) as TnvedItem[])
  }, [activeStore?.id])

  // ── Загрузка шаблонов атрибутов по коду ТН ВЭД ──────────────────────────
  const loadAttributeTemplates = useCallback(async (tnvedCode: string, subgroupId?: number | null) => {
    if (!activeStore?.id || !tnvedCode) return
    setCpAttrLoading(true)
    const payload: Record<string, unknown> = { store_id: activeStore.id, action: 'attribute_templates', tnvedCode }
    if (subgroupId) payload.subgroupId = subgroupId
    const { data } = await invoke(payload)
    setCpAttrLoading(false)
    const raw = data?.attributes ?? []
    const list: AttrTemplate[] = Array.isArray(raw) ? raw as AttrTemplate[] : []
    console.log('[attr_templates] source:', data?.source, 'subgroupId:', data?.subgroupId, 'count:', list.length)
    if (list.length > 0) {
      console.log('[attr_templates] ВСЕ АТРИБУТЫ:', list.map((t) => `"${t.attributeType?.name ?? t.name ?? t.attributeTypeCode ?? '?'}" values:${(t.attributeType?.values ?? []).length}`).join(' | '))
    }
    setCpAttrValues({})
    setCpAttrUnits({})
    setCpAttrTemplates(list)
  }, [activeStore?.id])

  // ── Загрузка стран ──────────────────────────────────────────────────────
  const loadCountries = useCallback(async () => {
    if (!activeStore?.id || countries.length > 0) return
    const { data } = await invoke({ store_id: activeStore.id, action: 'countries' })
    if (data?.items) {
      const items = data.items as CountryItem[]
      setCountries(items)
      // Инициализируем ID для дефолтного значения
      const found = items.find(c => (c.name ?? c.nameRu ?? String(c.code ?? '')) === 'КЫРГЫЗСТАН')
      if (found?.id != null) setCpCountryId(Number(found.id))
    }
  }, [activeStore?.id, countries.length])

  // ── Debounce-поиск ТН ВЭД при вводе (модал) ──────────────────────────────
  useEffect(() => {
    if (!tnvedModal) return
    const timer = setTimeout(() => { void loadTnvedList(tnvedSearch) }, 500)
    return () => clearTimeout(timer)
  }, [tnvedSearch, tnvedModal, loadTnvedList])

  // ── Inline autocomplete при вводе в поле формы ──────────────────────────
  useEffect(() => {
    if (tnvedModal) return
    // Если значение поля совпадает с выбранным из списка — не искать снова
    if (cpTnved === tnvedLockedCode.current) { setTnvedDropOpen(false); return }
    if (cpTnved.length < 1) { setTnvedDropOpen(false); return }
    const timer = setTimeout(() => { void loadTnvedList(cpTnved).then(() => setTnvedDropOpen(true)) }, 400)
    return () => clearTimeout(timer)
  }, [cpTnved, tnvedModal, loadTnvedList])

  // ── Автозаполнение полей производителя после загрузки данных ───────────────
  useEffect(() => {
    if (cpHasMfr && participantInfo) {
      setCpMfrINN(participantInfo.inn ?? '')
      setCpMfrName(participantInfo.companyName ?? '')
    }
  }, [participantInfo, cpHasMfr])

  const isConnected = stats !== null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Верхняя панель */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white shrink-0 flex-wrap">
        {/* Выбор магазина */}
        <div ref={storeDropRef} className="relative">
          <button
            type="button"
            onClick={() => setStoreDropOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span className="max-w-[140px] truncate">{activeStore?.name ?? 'Магазин'}</span>
            <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 text-slate-400 transition-transform ${storeDropOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          {storeDropOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {sortedStores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { onStoreChange(s.id); setStoreDropOpen(false) }}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 flex items-center gap-2 ${s.id === activeStore?.id ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${s.teksher_login ? 'bg-emerald-500' : 'bg-red-400'}`} />
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Статус */}
        {statsLoading ? (
          <span className="text-xs text-slate-400 animate-pulse">Проверяем…</span>
        ) : isConnected ? (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium text-emerald-700">Teksher подключён</span>
            {stats.participantName && <span className="text-xs text-slate-400">· {stats.participantName}</span>}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-300" />
            <span className="text-xs text-slate-500">Не подключён</span>
          </div>
        )}

        {isConnected && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleTnvedSync()}
              disabled={tnvedSyncing}
              title="Обновить базу кодов ТН ВЭД из Teksher"
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${tnvedSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6-8.485"/><path d="M21 3v5h-5"/></svg>
              {tnvedSyncing ? 'Загрузка ТН ВЭД…' : 'Обновить ТН ВЭД'}
            </button>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={statsLoading}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${statsLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6-8.485"/><path d="M21 3v5h-5"/></svg>
              Обновить
            </button>
          </div>
        )}
      </div>

      {/* Вкладки */}
      <div className="flex border-b border-slate-100 bg-white shrink-0 px-4">
        {([
          { key: 'main' as const, label: 'Главная' },
          { key: 'products' as const, label: 'Товары (GTIN)' },
          { key: 'codes' as const, label: 'КИЗ-коды' },
          { key: 'operations' as const, label: 'Операции' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Toast — fixed overlay, top-right, не двигает контент */}
      {actionResult && (
        <div className={`fixed top-4 right-4 z-[9999] flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg pointer-events-none select-none ${
          actionResult.type === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {actionResult.type === 'ok'
            ? <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5"/></svg>
            : <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-red-500" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
          }
          {actionResult.msg}
        </div>
      )}

      {/* Контент */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">

        {/* ══════ ГЛАВНАЯ ══════ */}
        {tab === 'main' && (
          <div className="space-y-5 max-w-3xl">
            {!isConnected && !statsLoading && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-800">Подключить Teksher</h2>
                    <p className="text-xs text-slate-500">Данные от аккаунта на label.teksher.kg</p>
                  </div>
                </div>
                <form onSubmit={(e) => void handleConnect(e)} className="space-y-3 max-w-sm">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Логин</label>
                    <input
                      type="text"
                      value={connectForm.login}
                      onChange={(e) => setConnectForm((f) => ({ ...f, login: e.target.value }))}
                      placeholder="Логин в Teksher"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Пароль</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={connectForm.password}
                        onChange={(e) => setConnectForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder="Пароль в Teksher"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        tabIndex={-1}
                      >
                        {showPassword ? (
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M1 1l22 22"/></svg>
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                  </div>
                  {connectError && (
                    <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{connectError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={connectLoading}
                    className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {connectLoading ? 'Подключение…' : 'Подключить Teksher'}
                  </button>
                </form>
                <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 p-4 max-w-sm">
                  <p className="text-xs font-semibold text-slate-600 mb-2">Как получить данные?</p>
                  <ol className="space-y-1 text-xs text-slate-500 list-decimal list-inside">
                    <li>Зарегистрируйтесь на <span className="font-medium text-blue-600">label.teksher.kg</span></li>
                    <li>Получите учётные данные после одобрения</li>
                    <li>Введите логин и пароль выше</li>
                  </ol>
                </div>
              </div>
            )}

            {statsLoading && !isConnected && (
              <div className="flex items-center gap-3 py-8 text-sm text-slate-400">
                <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin text-blue-500" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6-8.485"/><path d="M21 3v5h-5"/></svg>
                Проверяем подключение…
              </div>
            )}

            {isConnected && (
              <>
                {/* Баланс */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_max-content_1fr]">
                  <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="mb-2 text-2xl">🎫</div>
                    <p className="text-xl font-bold text-slate-800">{stats.balance.toLocaleString('ru-RU')}</p>
                    <p className="text-xs text-slate-500">Баланс кодов</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">КИЗ-единиц</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="mb-2 text-2xl">💰</div>
                    <p className="text-xl font-bold text-slate-800">
                      {stats.balanceMoney.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-slate-500">Денежный баланс</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Сом</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <p className="text-xs text-slate-500 mb-1">Участник маркировки</p>
                    <p className="text-sm font-semibold text-slate-800 break-words">{stats.participantName || '—'}</p>
                    <p className="text-xs text-slate-400 break-all mt-0.5">ID: {stats.participantId || '—'}</p>
                    <div className="mt-3 flex gap-3 flex-wrap">
                      <button
                        type="button"
                        onClick={() => void loadParticipantInfo()}
                        disabled={participantLoading}
                        className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
                      >
                        {participantLoading ? 'Загрузка…' : '🔍 GCP / GLN'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDisconnect()}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Отключить
                      </button>
                    </div>
                    {participantInfo && (
                      <div className="mt-2 text-xs text-slate-600 space-y-0.5 border-t border-slate-100 pt-2">
                        <div>GCP: <span className="font-mono font-semibold">{participantInfo.gcp || '—'}</span></div>
                        <div>GLN: <span className="font-mono font-semibold">{participantInfo.gln || '—'}</span></div>
                      </div>
                    )}
                  </div>
                  {/* Пополнить баланс */}
                  <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="mb-2 text-2xl">💳</div>
                      <p className="text-sm font-semibold text-slate-800">Пополнить баланс</p>
                      <p className="text-xs text-slate-500 mt-0.5">Через Teksher</p>
                      {stats.course ? (
                        <p className="text-[11px] text-emerald-700 mt-1">1 сом = {stats.course} КИЗ</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setTopupModal(true); setTopupAmount(''); setTopupQty(''); void loadTopupQr() }}
                      className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                      Пополнить
                    </button>
                  </div>
                </div>

                {/* Быстрые действия */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => { setEmitModal(true); setEmitError(null); setEmitSuccess(null) }}
                    className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12l7-7 7 7"/></svg>
                    Заказать КИЗы
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('products')}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    📦 Товары (GTIN)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('codes')}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    🏷️ КИЗ-коды
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('operations')}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    📊 Операции
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══════ ТОВАРЫ (GTIN) ══════ */}
        {tab === 'products' && (
          <div className="space-y-3 max-w-5xl">
            {!isConnected ? (
              <NotConnectedPlug onGoToMain={() => setTab('main')} />
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    value={productsSearch}
                    onChange={(e) => setProductsSearch(e.target.value)}
                    placeholder="Поиск по названию…"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-52"
                  />
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => void loadParticipantInfo()}
                      disabled={participantLoading}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      {participantLoading ? '…' : 'Инфо об участнике'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateProductModal(true)
                        setCpError(null)
                        setCpTab(0)
                        // Инициализируем ID страны если список уже загружен
                        const defCountry = 'КЫРГЫЗСТАН'
                        setCpCountry(defCountry)
                        const found = countries.find(c => String(c.name ?? c.code ?? '') === defCountry)
                        if (found?.id != null) setCpCountryId(Number(found.id))
                        if (!participantInfo) void loadParticipantInfo()
                        void loadCountries()
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                      Новый товар
                    </button>
                  </div>
                </div>

                {participantInfo && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5 text-xs text-blue-800 flex gap-4 flex-wrap">
                    <span>GCP: <span className="font-mono font-semibold">{participantInfo.gcp || '—'}</span></span>
                    <span>GLN: <span className="font-mono font-semibold">{participantInfo.gln || '—'}</span></span>
                    <span>Participant ID: <span className="font-mono">{participantInfo.participantId}</span></span>
                  </div>
                )}

                {productsLoading && products.length === 0 ? (
                  <Skeleton rows={6} />
                ) : products.length === 0 ? (
                  <EmptyState text="Товары не найдены" sub="Создайте первый товар (GTIN) нажав «Новый товар»" />
                ) : (
                  <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">#</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">GTIN</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Название</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Статус</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Коды</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Действия</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {products.map((p, idx) => (
                          <tr key={String(p.id ?? p.gtin)} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-700">{p.gtin}</td>
                            <td className="px-4 py-3 text-xs text-slate-700 max-w-[200px] truncate" title={p.fullName ?? p.name ?? ''}>
                              {p.fullName ?? p.name ?? '—'}
                            </td>
                            <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                            <td className="px-4 py-3 text-right text-xs text-slate-600">{p.codesCount ?? '—'}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {p.status === 'DRAFT' && (
                                  <button type="button" onClick={() => void handlePublishProduct(p.id)} className="text-xs font-medium text-blue-600 hover:underline">
                                    Опубликовать
                                  </button>
                                )}
                                {p.status === 'PUBLISHED' && (
                                  <button
                                    type="button"
                                    onClick={() => { setEmitGtin(p.gtin); setEmitModal(true); setEmitError(null); setEmitSuccess(null) }}
                                    className="text-xs font-medium text-emerald-600 hover:underline"
                                  >
                                    Заказать КИЗы
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {products.length < productsTotal && (
                      <div className="border-t border-slate-100 p-3 text-center">
                        <button
                          type="button"
                          onClick={() => void loadProducts(productsPage + 1, productsSearch)}
                          disabled={productsLoading}
                          className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
                        >
                          {productsLoading ? 'Загрузка…' : `Загрузить ещё (показано ${products.length} из ${productsTotal})`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ══════ КИЗ-КОДЫ ══════ */}
        {tab === 'codes' && (
          <div className="space-y-3 max-w-5xl">
            {!isConnected ? (
              <NotConnectedPlug onGoToMain={() => setTab('main')} />
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex gap-1.5 flex-wrap">
                    {[
                      { val: '', label: 'Все' },
                      { val: 'ISSUED', label: 'Эмиттированы' },
                      { val: 'APPLIED', label: 'Нанесены' },
                      { val: 'SOLD', label: 'Проданы' },
                      { val: 'WRITTEN_OFF', label: 'Списаны' },
                    ].map(({ val, label }) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setCodesStatusFilter(val)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          codesStatusFilter === val
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="ml-auto text-xs text-slate-400">Всего: {codesTotal}</span>
                </div>

                {codesLoading ? (
                  <Skeleton rows={8} />
                ) : codes.length === 0 ? (
                  <EmptyState text="Коды не найдены" sub="Закажите КИЗ-коды на вкладке «Операции»" />
                ) : (
                  <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">#</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Код (DataMatrix)</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">GTIN</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Статус</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Дата</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {codes.map((c, idx) => (
                          <tr key={String(c.id)} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-700 max-w-[220px] truncate" title={c.barcode ?? c.code ?? ''}>
                              {c.barcode ?? c.code ?? String(c.id)}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.gtin ?? '—'}</td>
                            <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                            <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(c.issueDate ?? c.createdDate ?? c.emissionDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {codesTotal > codes.length && (
                      <div className="border-t border-slate-100 p-3 text-center text-xs text-slate-400">
                        Показано {codes.length} из {codesTotal}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ══════ ОПЕРАЦИИ ══════ */}
        {tab === 'operations' && (
          <div className="space-y-3 max-w-5xl">
            {!isConnected ? (
              <NotConnectedPlug onGoToMain={() => setTab('main')} />
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500">Всего: {operationsTotal}</span>
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => void loadOperations()}
                      disabled={operationsLoading}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${operationsLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6-8.485"/><path d="M21 3v5h-5"/></svg>
                      Обновить
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEmitModal(true); setEmitError(null); setEmitSuccess(null) }}
                      className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                      Заказать КИЗы
                    </button>
                  </div>
                </div>

                {operationsLoading ? (
                  <Skeleton rows={6} />
                ) : operations.length === 0 ? (
                  <EmptyState text="Операций нет" sub="Нажмите «Заказать КИЗы» чтобы создать первую операцию" />
                ) : (
                  <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">#</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">ID операции</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Тип</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Статус</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Кол-во</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">GTIN</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Дата</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Действия</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {operations.map((op, idx) => {
                          const opId = op.operationId ?? op.id
                          const opType = op.operationType ?? op.type
                          return (
                            <tr key={String(opId)} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                              <td className="px-4 py-3 font-mono text-xs text-slate-600 max-w-[120px] truncate" title={String(opId)}>
                                {String(opId).slice(0, 14)}…
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-700">{opTypeLabel(opType)}</td>
                              <td className="px-4 py-3"><StatusBadge status={op.status} /></td>
                              <td className="px-4 py-3 text-right text-xs text-slate-700">{op.kmsCount ?? op.codesCount ?? '—'}</td>
                              <td className="px-4 py-3 font-mono text-xs text-slate-500">{op.gtin ?? '—'}</td>
                              <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(op.createdAt ?? op.createdDate)}</td>
                              <td className="px-4 py-3">
                                {op.status === 'COMPLETED' && opType === 'EMISSION' && (
                                  <button
                                    type="button"
                                    onClick={() => void handleUtilise(opId)}
                                    className="text-xs font-medium text-blue-600 hover:underline"
                                  >
                                    Нанести
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {operationsTotal > operations.length && (
                      <div className="border-t border-slate-100 p-3 text-center text-xs text-slate-400">
                        Показано {operations.length} из {operationsTotal}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ══ МОДАЛ: Заказать КИЗ-коды ══════════════════════════════════════════ */}
      {emitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEmitModal(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">Заказать КИЗ-коды</h3>
              <button type="button" onClick={() => setEmitModal(false)} className="text-slate-400 hover:text-slate-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            {emitSuccess ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  ✅ {emitSuccess}
                </div>
                <p className="text-xs text-slate-500">Операция создана. Коды генерируются — обычно 30–60 сек на 100 кодов. Проверьте статус во вкладке «Операции».</p>
                <button
                  type="button"
                  onClick={() => { setEmitModal(false); setTab('operations'); void loadOperations() }}
                  className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Посмотреть операции →
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleEmit(e)} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">GTIN товара</label>
                  <input
                    type="text"
                    value={emitGtin}
                    onChange={(e) => setEmitGtin(e.target.value)}
                    placeholder="4600000000000"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                  <p className="mt-1 text-xs text-slate-400">13-значный штрихкод из вкладки «Товары»</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Количество кодов</label>
                  <input
                    type="number"
                    value={emitQty}
                    onChange={(e) => setEmitQty(e.target.value)}
                    min="1"
                    max="10000"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                  <p className="mt-1 text-xs text-slate-400">Макс. 10 000. Спишется {emitQty || 0} единиц с баланса.</p>
                </div>
                {emitError && (
                  <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{emitError}</p>
                )}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setEmitModal(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                    Отмена
                  </button>
                  <button type="submit" disabled={emitLoading} className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    {emitLoading ? 'Заказываем…' : 'Заказать'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ══ МОДАЛ: Регистрация нового товара ══════════════════════════════════ */}
      {createProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCreateProductModal(false)}>
          <div className="w-[min(96vw,1440px)] rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 shrink-0">
              <h3 className="text-base font-semibold text-slate-800">Регистрация нового товара</h3>
              <button type="button" onClick={() => setCreateProductModal(false)} className="text-slate-400 hover:text-slate-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <form onSubmit={(e) => void handleCreateProduct(e)} className="flex flex-col flex-1 min-h-0">
              {/* ── Двухколоночный layout ── */}
              <div className="grid grid-cols-[2fr_3fr] divide-x divide-slate-100 flex-1 min-h-0 overflow-hidden">
                {/* ══ Левая колонка ══ */}
                <div className="overflow-y-auto p-6 space-y-6">
                  {/* ИДЕНТИФИКАТОРЫ */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                      <span className="text-xs font-semibold uppercase tracking-wider text-blue-500">Идентификаторы</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">GCP</label>
                        <input type="text" value={participantInfo?.gcp ?? ''} readOnly placeholder={participantLoading ? 'Загрузка...' : '—'} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">GLN</label>
                        <input type="text" value={participantInfo?.gln ?? ''} readOnly placeholder="—" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed" />
                      </div>
                    </div>
                  </div>
                  {/* ОПИСАНИЕ ТОВАРА */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                      <span className="text-xs font-semibold uppercase tracking-wider text-blue-500">Описание товара</span>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">GTIN <span className="text-red-500">*</span></label>
                        <input type="text" value={cpGtin} onChange={(e) => setCpGtin(e.target.value)} placeholder="04706020291553" className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" required />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">Полное наименование товара <span className="text-red-500">*</span></label>
                        <input type="text" value={cpName} onChange={(e) => setCpName(e.target.value)} placeholder="Пиджак женский" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" required />
                      </div>
                    </div>
                  </div>
                  {/* АРТИКУЛ МАРКЕТПЛЕЙСА */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                      <span className="text-xs font-semibold uppercase tracking-wider text-blue-500">Артикул маркетплейса</span>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Артикул МП</label>
                      <input type="text" value={cpMpArticle} onChange={(e) => setCpMpArticle(e.target.value)} placeholder="ART-001" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      <p className="mt-1 text-[11px] text-slate-400">Необязательно. Используется для привязки к карточке товара.</p>
                    </div>
                  </div>
                  {/* ПРОИЗВОДИТЕЛЬ И СТРАНА */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                      <span className="text-xs font-semibold uppercase tracking-wider text-blue-500">Производитель и страна</span>
                    </div>
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={cpHasMfr} onChange={(e) => {
                          const checked = e.target.checked
                          setCpHasMfr(checked)
                          if (checked && participantInfo) {
                            setCpMfrINN(participantInfo.inn ?? '')
                            setCpMfrName(participantInfo.companyName ?? '')
                          } else if (!checked) {
                            setCpMfrINN('')
                            setCpMfrName('')
                          }
                        }} className="h-4 w-4 rounded border-slate-300 accent-blue-600" />
                        <span className="text-sm text-slate-600">Данные производителя</span>
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Наименование производителя</label>
                          <input type="text" value={cpMfrName} readOnly={cpHasMfr} onChange={(e) => { if (!cpHasMfr) setCpMfrName(e.target.value) }} placeholder='ОсОО "Например"' className={`w-full rounded-lg border px-3 py-2 text-sm ${cpHasMfr ? 'border-slate-200 bg-slate-50 text-slate-600 cursor-not-allowed' : 'border-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'}`} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">ИНН производителя</label>
                          <input type="text" value={cpMfrINN} readOnly={cpHasMfr} onChange={(e) => { if (!cpHasMfr) setCpMfrINN(e.target.value) }} placeholder="01234567891234" className={`w-full rounded-lg border px-3 py-2 text-sm ${cpHasMfr ? 'border-slate-200 bg-slate-50 text-slate-600 cursor-not-allowed' : 'border-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'}`} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Страна производства <span className="text-red-500">*</span></label>
                          <SearchableSelect
                            value={cpCountry}
                            options={countries.map(c => String(c.name ?? c.code ?? ''))}
                            placeholder={countries.length === 0 ? 'Загрузка…' : '— Страна —'}
                            onChange={(name) => {
                              setCpCountry(name)
                              const found = countries.find(c => String(c.name ?? c.code ?? '') === name)
                              setCpCountryId(found?.id != null ? Number(found.id) : null)
                            }}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Товарный знак</label>
                          <input type="text" value={cpTrademark} onChange={(e) => setCpTrademark(e.target.value)} placeholder="Ваш бренд" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ══ Правая колонка ══ */}
                <div className="overflow-y-auto p-6 space-y-6">
                  {/* ТН ВЭД */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                      <span className="text-xs font-semibold uppercase tracking-wider text-blue-500">ТН ВЭД</span>
                    </div>
                    <div className="space-y-3">
                      <div className="relative" ref={tnvedDropRef}>
                        <label className="mb-1 block text-xs text-slate-500">Код ТН ВЭД <span className="text-red-500">*</span></label>
                        <div className="flex gap-2">
                          <input type="text" value={cpTnved} onChange={(e) => { setCpTnved(e.target.value); if (e.target.value.length < 3) { setTnvedDropOpen(false) } }} placeholder="Введите код или название (мин. 3 символа)…" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                          <button type="button" onClick={() => { setTnvedModal(true); setTnvedSearch(''); void loadTnvedList('') }} className="flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-slate-400 hover:text-blue-600 hover:border-blue-300 transition-colors">
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                          </button>
                        </div>
                        {tnvedDropOpen && tnvedList.length > 0 && (
                          <div className="absolute left-0 right-0 top-full z-[70] mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                            {tnvedLoading && <div className="px-3 py-2 text-xs text-slate-400">Поиск…</div>}
                            {tnvedList.map((item, i) => {
                              const code = String(item.fullCode ?? item.code ?? '')
                              const name = String(item.subPositionName ?? item.name ?? '')
                              const pos  = String(item.position ?? '')
                              const posName = String(item.positionName ?? '')
                              return (
                                <div key={i} onClick={() => { tnvedLockedCode.current = code; setCpTnved(code); setCpTnvedName(name); setCpTnvedPos(pos); setCpTnvedPosName(posName); setCpTeksherTnvedId(item.teksherTnvedId ?? null); setTnvedDropOpen(false); void loadAttributeTemplates(code, item.subgroupId ?? undefined) }}
                                  className="cursor-pointer border-b border-slate-50 px-3 py-2 hover:bg-blue-50 last:border-0">
                                  <div className="text-xs font-bold text-slate-800">{code}</div>
                                  <div className="truncate text-xs text-slate-500">{name}</div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Позиция ТН ВЭД</label>
                          <input type="text" value={cpTnvedPos} readOnly placeholder="—" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-500">Наименование ТН ВЭД</label>
                          <input type="text" value={cpTnvedName} readOnly placeholder="—" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed" />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">Наименование товарной позиции по ТН ВЭД</label>
                        <input type="text" value={cpTnvedPosName} readOnly placeholder="—" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 cursor-not-allowed" />
                      </div>
                    </div>
                  </div>
                  {/* ХАРАКТЕРИСТИКИ — динамически из шаблонов по ТН ВЭД */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                      <span className="text-xs font-semibold uppercase tracking-wider text-blue-500">Характеристики (атрибуты)</span>
                      {cpAttrLoading && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-500" />}
                    </div>
                    {!cpTnved ? (
                      <p className="text-xs text-slate-400 italic">Сначала укажите код ТН ВЭД</p>
                    ) : cpAttrLoading ? (
                      <p className="text-xs text-slate-400">Загрузка атрибутов…</p>
                    ) : cpAttrTemplates.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">Атрибуты не найдены для данного ТН ВЭД</p>
                    ) : (
                      <div className="space-y-3">
                        {cpAttrTemplates
                          .filter((t) => t.attributeType?.code !== '13933' && t.attributeType?.code !== '2630' && t.attributeType?.code !== '2478')
                          .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
                          .map((tpl) => {
                            const at = tpl.attributeType
                            if (!at?.code || !at?.name) return null
                            const code = at.code
                            const label = at.name
                            const isRequired = tpl.isRequired === true
                            const isMulti = tpl.multiplication === true
                            const vals = (at.values ?? [])
                              .map((v) => (typeof v === 'string' ? v : String(v.value ?? v.name ?? v.code ?? '')))
                              .filter(Boolean)
                            const unitCodes = (at.unitCodes ?? []).map(u => String(u)).filter(Boolean)
                            if (isMulti) {
                              const arr = (cpAttrValues[code] as string[] | undefined) ?? ['']
                              const unitArr = unitCodes.length > 0 ? ((cpAttrUnits[code] as string[] | undefined) ?? arr.map(() => '')) : []
                              return (
                                <div key={code}>
                                  <label className="mb-1 block text-xs text-slate-500">
                                    {label}{isRequired && <span className="text-red-500 ml-0.5">*</span>}
                                  </label>
                                  <div className="space-y-1">
                                    {arr.map((v, idx) => (
                                      <div key={idx} className="flex gap-1">
                                        {vals.length > 0 ? (
                                          <SearchableSelect value={v} options={vals} className="flex-1"
                                            onChange={(opt) => {
                                              const n = [...arr]; n[idx] = opt
                                              setCpAttrValues((prev) => ({ ...prev, [code]: n }))
                                            }} />
                                        ) : (
                                          <input type="text" value={v}
                                            onChange={(e) => {
                                              const n = [...arr]; n[idx] = e.target.value
                                              setCpAttrValues((prev) => ({ ...prev, [code]: n }))
                                            }}
                                            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                          />
                                        )}
                                        {unitCodes.length > 0 && (
                                          <SearchableSelect
                                            value={unitArr[idx] ?? ''}
                                            options={unitCodes}
                                            placeholder="Тип"
                                            className="w-28"
                                            onChange={(u) => {
                                              const nu = [...unitArr]; nu[idx] = u
                                              setCpAttrUnits((prev) => ({ ...prev, [code]: nu }))
                                            }}
                                          />
                                        )}
                                        {arr.length > 1 && (
                                          <button type="button"
                                            onClick={() => {
                                              setCpAttrValues((prev) => ({ ...prev, [code]: arr.filter((_, i) => i !== idx) }))
                                              if (unitCodes.length > 0) setCpAttrUnits((prev) => ({ ...prev, [code]: unitArr.filter((_, i) => i !== idx) }))
                                            }}
                                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-300">
                                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                  <button type="button"
                                    onClick={() => {
                                      setCpAttrValues((prev) => ({ ...prev, [code]: [...arr, ''] }))
                                      if (unitCodes.length > 0) setCpAttrUnits((prev) => ({ ...prev, [code]: [...unitArr, ''] }))
                                    }}
                                    className="mt-1 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                                    Добавить
                                  </button>
                                </div>
                              )
                            }
                            const singleVal = (cpAttrValues[code] as string | undefined) ?? ''
                            const singleUnit = (cpAttrUnits[code] as string | undefined) ?? ''
                            if (vals.length > 0) {
                              return (
                                <div key={code}>
                                  <label className="mb-1 block text-xs text-slate-500">
                                    {label}{isRequired && <span className="text-red-500 ml-0.5">*</span>}
                                  </label>
                                  <div className={unitCodes.length > 0 ? 'flex gap-1' : ''}>
                                    <SearchableSelect value={singleVal} options={vals} className={unitCodes.length > 0 ? 'flex-1' : undefined}
                                      onChange={(v) => setCpAttrValues((prev) => ({ ...prev, [code]: v }))} />
                                    {unitCodes.length > 0 && (
                                      <SearchableSelect value={singleUnit} options={unitCodes} placeholder="Тип" className="w-28"
                                        onChange={(u) => setCpAttrUnits((prev) => ({ ...prev, [code]: u }))} />
                                    )}
                                  </div>
                                </div>
                              )
                            }
                            return (
                              <div key={code}>
                                <label className="mb-1 block text-xs text-slate-500">
                                  {label}{isRequired && <span className="text-red-500 ml-0.5">*</span>}
                                </label>
                                <div className={unitCodes.length > 0 ? 'flex gap-1' : ''}>
                                  <input type="text" value={singleVal}
                                    onChange={(e) => setCpAttrValues((prev) => ({ ...prev, [code]: e.target.value }))}
                                    className={`rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${unitCodes.length > 0 ? 'flex-1' : 'w-full'}`}
                                  />
                                  {unitCodes.length > 0 && (
                                    <SearchableSelect value={singleUnit} options={unitCodes} placeholder="Тип" className="w-28"
                                      onChange={(u) => setCpAttrUnits((prev) => ({ ...prev, [code]: u }))} />
                                  )}
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* Footer */}
              <div className="border-t border-slate-100 px-6 py-4 flex items-center justify-between">
                <div>
                  {cpError && <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{cpError}</p>}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCreateProductModal(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Отмена</button>
                  <button type="submit" disabled={cpLoading} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    {cpLoading
                      ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />Сохраняем…</>
                      : <><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Создать товар</>}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ МОДАЛ: Выбор ТН ВЭД ════════════════════════════════════════════════ */}
      {tnvedModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setTnvedModal(false)}>
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 shrink-0">
              <h3 className="text-base font-semibold text-slate-800">Выбор кода ТН ВЭД</h3>
              <button type="button" onClick={() => setTnvedModal(false)} className="text-slate-400 hover:text-slate-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="px-6 py-3 border-b border-slate-100 shrink-0">
              <div className="relative">
                <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                <input type="text" value={tnvedSearch} onChange={(e) => setTnvedSearch(e.target.value)} placeholder="Поиск по коду или названию…" className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" autoFocus />
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {tnvedLoading ? (
                <div className="flex items-center justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" /></div>
              ) : tnvedList.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">{tnvedSearch ? 'Ничего не найдено' : 'Введите запрос для поиска или подождите загрузки'}</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 w-32">Полный код ТН</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-blue-600">Название товара (по субпозиции ТН ВЭД)</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 w-28">Позиция ТН ВЭД</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500 w-44">Товарная группа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tnvedList.map((item, i) => {
                      const code = String(item.fullCode ?? item.code ?? '')
                      const subName = String(item.subPositionName ?? item.name ?? '')
                      const position = String(item.position ?? '')
                      const posName = String(item.positionName ?? '')
                      const group = String(item.groupName ?? item.productGroup ?? '')
                      return (
                        <tr key={i} onClick={() => { setCpTnved(code); setCpTnvedName(subName); setCpTnvedPos(position); setCpTnvedPosName(posName); setCpTeksherTnvedId(item.teksherTnvedId ?? null); setTnvedModal(false); void loadAttributeTemplates(code, item.subgroupId ?? undefined) }} className="border-b border-slate-50 hover:bg-blue-50 cursor-pointer transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-slate-700">{code}</td>
                          <td className="px-4 py-3 text-xs text-slate-700">{subName}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{position}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{group}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ МОДАЛ: Пополнение баланса ══════════════════════════════════════════ */}
      {topupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setTopupModal(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold text-slate-800">Пополнение баланса</h3>
                {activeStore && (
                  <span className="rounded-full bg-emerald-50 px-3 py-0.5 text-sm font-medium text-emerald-700 border border-emerald-100">
                    {activeStore.name}
                  </span>
                )}
              </div>
              <button type="button" onClick={() => setTopupModal(false)} className="text-slate-400 hover:text-slate-600">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="p-6 grid grid-cols-2 gap-6">
              {/* Левая колонка: QR */}
              <div className="flex flex-col items-center gap-3">
                {topupQrLoading ? (
                  <div className="h-56 w-56 animate-pulse rounded-2xl bg-slate-100" />
                ) : topupQrData ? (
                  <QRCodeSVG value={topupQrData} size={224} className="rounded-2xl border border-slate-200 p-2 bg-white" />
                ) : (
                  <div className="flex h-56 w-56 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center px-4">
                    <svg viewBox="0 0 24 24" className="h-12 w-12 text-slate-200 mb-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
                      <path d="M14 14h.01M17 14h.01M20 14v3M14 17h3M17 20h3M20 20h.01"/>
                    </svg>
                    <p className="text-sm text-slate-400 leading-tight">{topupQrError ?? 'QR недоступен'}</p>
                    <a href="https://label.teksher.kg" target="_blank" rel="noopener noreferrer"
                      className="mt-2 text-sm font-medium text-blue-600 hover:underline">
                      Открыть Teksher →
                    </a>
                  </div>
                )}
                <p className="text-xs text-slate-500 text-center">Отсканируйте QR-код для пополнения баланса маркировки</p>
              </div>

              {/* Правая колонка: калькулятор + предупреждения */}
              <div className="flex flex-col gap-4">
                {/* Calculator */}
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-600 mb-3">Калькулятор пополнения</p>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-slate-500">Сумма (сом)</label>
                      <input
                        type="number"
                        value={topupAmount}
                        onChange={(e) => {
                          const val = e.target.value
                          setTopupAmount(val)
                          if (val && stats?.course) {
                            setTopupQty(String(Math.floor(Number(val) * stats.course)))
                          } else {
                            setTopupQty('')
                          }
                        }}
                        placeholder="0"
                        min="0"
                        max="150000"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div className="pb-2 text-slate-400 font-bold text-xl">=</div>
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-slate-500">Количество (шт.)</label>
                      <input
                        type="number"
                        value={topupQty}
                        onChange={(e) => {
                          const val = e.target.value
                          setTopupQty(val)
                          if (val && stats?.course) {
                            setTopupAmount(String(Math.round((Number(val) / stats.course) * 100) / 100))
                          } else {
                            setTopupAmount('')
                          }
                        }}
                        placeholder="0"
                        min="0"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  {stats?.course ? (
                    <p className="mt-2 text-xs text-slate-400">Курс: 1 сом = {stats.course} КИЗ-кодов</p>
                  ) : null}
                </div>

                {/* Warning */}
                <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4m0 4h.01"/>
                  </svg>
                  <p className="text-xs text-amber-800">Возврат денежных средств после подтверждения транзакции невозможен. Максимальная сумма одной транзакции 150&nbsp;000 сом.</p>
                </div>

                {/* Info */}
                <div className="flex gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-blue-500 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>
                  </svg>
                  <p className="text-xs text-blue-800">Оплата происходит напрямую в Teksher. Мы не занимаемся обработкой платежа и не несём ответственности за его проведение.</p>
                </div>
              </div>{/* /правая колонка */}
            </div>{/* /grid */}
          </div>
        </div>
      )}
    </div>
  )
}
