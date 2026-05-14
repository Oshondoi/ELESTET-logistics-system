import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { Modal } from '../components/ui/Modal'
import { PhotoThumb } from '../components/ui/PhotoThumb'
import type { Store } from '../types'

// ── Teksher stats (получаем с сервера через Edge Function, пароль никогда не приходит на фронт)
type TeksherStats =
  | { connected: true; participantName: string; balance: number; balanceMoney: number; products: number; operations: number; syncedAt?: string | null; needsSync?: boolean }
  | { connected: false }

interface TeksherProduct {
  id: number | string
  gtin?: string
  name?: string
  fullName?: string
  productGroupCode?: string
  status?: string
  codesCount?: number
  trademark?: string
  manufacturerFullName?: string
  manufacturedCountry?: { id?: number; code?: string; name?: string }
  attributes?: Array<{ attributeTypeCode?: string; value?: string; name?: string }>
  [key: string]: unknown
}

interface TeksherCode {
  id: number | string
  code?: string
  barcode?: string
  gtin?: string
  status?: string
  issueDate?: string
  createdDate?: string
  emissionDate?: string
  serialNumber?: string
  [key: string]: unknown
}

interface TeksherOperation {
  id: number | string
  operationType?: string
  type?: string
  status?: string
  codesCount?: number
  quantity?: number
  gtin?: string
  createdDate?: string
  date?: string
  productGroupCode?: string
  [key: string]: unknown
}

interface WBProductInfo {
  nm_id: number
  vendor_code: string | null
  name: string | null
  brand: string | null
  category: string | null
  color: string | null
  composition: string | null
  country: string | null
  barcodes: string[]
  photos: Array<{ big?: string; c246x328?: string; small?: string }> | null
}

// Teksher fullName "АРТ.25101 цвет бежевый, р.M" → WB vendor_code "АРТ.25101 цвет бежевый"
function vendorCodeFromFullName(fullName: string): string {
  return fullName.replace(/,\s*р\..*$/i, '').trim()
}

// Цвет из Teksher.
// List endpoint возвращает attributes: null — поэтому основной источник fullName.
// attributes[36] используется как запасной (если вдруг будет заполнен).
function teksherColor(p: TeksherProduct): string | null {
  // Парсим из fullName: "АРТ.25101 цвет бежевый, р.M" → "бежевый"
  const match = (p.fullName ?? p.name ?? '').match(/цвет\s+(.+?)(?:,\s*р\.|$)/i)
  if (match?.[1]) return match[1].trim()
  // Запасной: attributes[36] (доступен только при запросе единичного товара)
  return p.attributes?.find((a) => a.attributeTypeCode === '36')?.value ?? null
}

// Перевод статуса Teksher на русский
const TEKSHER_STATUS_RU: Record<string, string> = {
  PUBLISHED: 'Опубликован',
  ACTIVE: 'Активен',
  DRAFT: 'Черновик',
  ARCHIVED: 'Архивирован',
  WITHDRAWN: 'Отозван',
  BLOCKED: 'Заблокирован',
  CLOSED: 'Закрыт',
}
function teksherStatusRu(status: string | undefined): string {
  if (!status) return '—'
  return TEKSHER_STATUS_RU[status] ?? status
}

function codeStatusBadge(status: string | undefined): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    ISSUED:      { label: 'Выдан',        cls: 'bg-blue-50 text-blue-700' },
    APPLIED:     { label: 'Нанесён',      cls: 'bg-amber-50 text-amber-700' },
    SOLD:        { label: 'Продан',       cls: 'bg-emerald-50 text-emerald-700' },
    WRITTEN_OFF: { label: 'Списан',       cls: 'bg-slate-100 text-slate-500' },
    WITHDRAWN:   { label: 'Отозван',      cls: 'bg-red-50 text-red-700' },
  }
  const s = status ?? ''
  return map[s] ?? { label: s || '—', cls: 'bg-slate-100 text-slate-500' }
}

function opTypeBadge(type: string | undefined): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    EMISSION: { label: 'Эмиссия',      cls: 'bg-violet-50 text-violet-700' },
    MARKING:  { label: 'Нанесение',    cls: 'bg-blue-50 text-blue-700' },
    SHIPMENT: { label: 'Отгрузка',     cls: 'bg-orange-50 text-orange-700' },
    WRITE_OFF:{ label: 'Списание',     cls: 'bg-slate-100 text-slate-500' },
    RECEIPT:  { label: 'Поступление',  cls: 'bg-emerald-50 text-emerald-700' },
  }
  const t = type ?? ''
  return map[t] ?? { label: t || '—', cls: 'bg-slate-100 text-slate-500' }
}

function formatTeksherDate(d: string | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatSyncTime(iso: string) {
  return new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

interface KizPageProps {
  stores: Store[]
  selectedStoreId: string
  onStoreChange: (id: string) => void
  isAdmin?: boolean
}

export const KizPage = ({ stores, selectedStoreId, onStoreChange, isAdmin }: KizPageProps) => {
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false)
  const [storeSearch, setStoreSearch] = useState('')
  const storeSearchRef = useRef<HTMLInputElement>(null)
  const storeDropdownRef = useRef<HTMLDivElement>(null)

  // ── Teksher state
  const [teksherStats, setTeksherStats] = useState<TeksherStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [syncLoading, setSyncLoading] = useState(false)
  const [teksherConnectedIds, setTeksherConnectedIds] = useState<Set<string>>(new Set())

  // ── Connect form state
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const [stepsModalOpen, setStepsModalOpen] = useState(false)
  const [infoModalOpen, setInfoModalOpen] = useState(false)
  const [infoTab, setInfoTab] = useState<'statuses' | 'format' | 'links'>('statuses')
  const [connectLogin, setConnectLogin] = useState('')
  const [connectPassword, setConnectPassword] = useState('')
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  // ── Подтабы
  const [subTab, setSubTab] = useState<'main' | 'products' | 'codes' | 'operations'>(() => {
    const saved = localStorage.getItem('elestet-kiz-subtab')
    return (saved === 'products' || saved === 'codes' || saved === 'operations') ? saved : 'main'
  })

  // ── Товары (GTIN)
  const [productItems, setProductItems] = useState<TeksherProduct[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [productsError, setProductsError] = useState<string | null>(null)
  const [productsPage, setProductsPage] = useState(0)
  const [productsTotalPages, setProductsTotalPages] = useState(1)
  const [productsTotalElements, setProductsTotalElements] = useState(0)
  const [productsSearch, setProductsSearch] = useState('')
  const [productsSearchInput, setProductsSearchInput] = useState('')

  // ── WB-данные для обогащения таблицы Teksher (ключ = vendor_code)
  const [wbByVendorCode, setWbByVendorCode] = useState<Map<string, WBProductInfo>>(new Map())
  const [wbLoading, setWbLoading] = useState(false)

  // ── КИЗ-коды
  const [codesItems, setCodesItems] = useState<TeksherCode[]>([])
  const [codesLoading, setCodesLoading] = useState(false)
  const [codesError, setCodesError] = useState<string | null>(null)
  const [codesPage, setCodesPage] = useState(0)
  const [codesTotalPages, setCodesTotalPages] = useState(1)
  const [codesTotalElements, setCodesTotalElements] = useState(0)
  const [codesStatus, setCodesStatus] = useState<'' | 'ISSUED' | 'APPLIED' | 'SOLD'>('ISSUED')

  // ── Операции
  const [opsItems, setOpsItems] = useState<TeksherOperation[]>([])
  const [opsLoading, setOpsLoading] = useState(false)
  const [opsError, setOpsError] = useState<string | null>(null)
  const [opsPage, setOpsPage] = useState(0)
  const [opsTotalPages, setOpsTotalPages] = useState(1)
  const [opsTotalElements, setOpsTotalElements] = useState(0)

  const activeStore = stores.find((s) => s.id === selectedStoreId) ?? stores[0] ?? null

  // ── Закрытие дропдауна по клику вне
  useEffect(() => {
    if (!storeDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (storeDropdownRef.current && !storeDropdownRef.current.contains(e.target as Node)) {
        setStoreDropdownOpen(false)
        setStoreSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [storeDropdownOpen])

  // ── Загрузка IDs магазинов с авторизацией Teksher (для сортировки)
  useEffect(() => {
    if (!supabase || stores.length === 0) return
    const storeIds = stores.map((s) => s.id)
    supabase
      .from('stores')
      .select('id')
      .in('id', storeIds)
      .not('teksher_login', 'is', null)
      .then(({ data }) => {
        if (data) setTeksherConnectedIds(new Set(data.map((r) => r.id as string)))
      })
  }, [stores])

  // ── Загрузка товаров Teksher при переходе на таб products или смене магазина
  useEffect(() => {
    if (subTab !== 'products' || !activeStore || !supabase) return
    setProductsLoading(true)
    setProductsError(null)
    supabase.functions
      .invoke('teksher-auth', { body: { store_id: activeStore.id, action: 'products', page: productsPage, size: 20, search: productsSearch } })
      .then(({ data, error }) => {
        if (error) { setProductsError(error.message); return }
        if (data?.connected === false) { setProductsError('Teksher не подключён'); return }
        setProductItems(data?.items ?? [])
        setProductsTotalPages(data?.totalPages ?? 1)
        setProductsTotalElements(data?.totalElements ?? 0)
      })
      .catch((e: unknown) => setProductsError((e as Error).message))
      .finally(() => setProductsLoading(false))
  }, [subTab, activeStore?.id, productsPage, productsSearch])

  // ── Загрузка WB-товаров для обогащения (baркод → WBProductInfo)
  useEffect(() => {
    if (subTab !== 'products' || !activeStore?.id || !supabase) return
    setWbLoading(true)
    supabase
      .from('products')
      .select('nm_id, vendor_code, name, brand, category, color, composition, country, barcodes, photos')
      .eq('store_id', activeStore.id)
      .then(({ data }) => {
        const map = new Map<string, WBProductInfo>()
        for (const p of data ?? []) {
          if (p.vendor_code) map.set(p.vendor_code as string, p as WBProductInfo)
        }
        setWbByVendorCode(map)
        setWbLoading(false)
      })
  }, [subTab, activeStore?.id])

  // ── Загрузка КИЗ-кодов
  useEffect(() => {
    if (subTab !== 'codes' || !activeStore || !supabase) return
    setCodesLoading(true)
    setCodesError(null)
    supabase.functions
      .invoke('teksher-auth', { body: { store_id: activeStore.id, action: 'codes', page: codesPage, size: 30, status: codesStatus } })
      .then(({ data, error }) => {
        if (error) { setCodesError(error.message); return }
        if (data?.connected === false) { setCodesError('Teksher не подключён'); return }
        setCodesItems(data?.items ?? [])
        setCodesTotalPages(data?.totalPages ?? 1)
        setCodesTotalElements(data?.totalElements ?? 0)
      })
      .catch((e: unknown) => setCodesError((e as Error).message))
      .finally(() => setCodesLoading(false))
  }, [subTab, activeStore?.id, codesPage, codesStatus])

  // ── Загрузка операций
  useEffect(() => {
    if (subTab !== 'operations' || !activeStore || !supabase) return
    setOpsLoading(true)
    setOpsError(null)
    supabase.functions
      .invoke('teksher-auth', { body: { store_id: activeStore.id, action: 'operations', page: opsPage, size: 20 } })
      .then(({ data, error }) => {
        if (error) { setOpsError(error.message); return }
        if (data?.connected === false) { setOpsError('Teksher не подключён'); return }
        setOpsItems(data?.items ?? [])
        setOpsTotalPages(data?.totalPages ?? 1)
        setOpsTotalElements(data?.totalElements ?? 0)
      })
      .catch((e: unknown) => setOpsError((e as Error).message))
      .finally(() => setOpsLoading(false))
  }, [subTab, activeStore?.id, opsPage])

  // ── Автозагрузка статистики при смене магазина
  useEffect(() => {
    if (!activeStore || !supabase) {
      setTeksherStats(null)
      return
    }
    setTeksherStats(null)
    setStatsError(null)
    setStatsLoading(true)
    supabase.functions
      .invoke('teksher-auth', { body: { store_id: activeStore.id, action: 'stats' } })
      .then(({ data, error }) => {
        if (error) { setStatsError(error.message); return }
        setTeksherStats(data as TeksherStats)
      })
      .catch((e: unknown) => setStatsError((e as Error).message))
      .finally(() => setStatsLoading(false))
  }, [activeStore?.id])

  // ── Подключить кабинет Teksher
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeStore || !supabase) return
    setConnectLoading(true)
    setConnectError(null)
    try {
      const { data, error } = await supabase.functions.invoke('teksher-auth', {
        body: { store_id: activeStore.id, action: 'connect', login: connectLogin, password: connectPassword },
      })
      if (error) throw new Error(error.message)
      setTeksherStats(data as TeksherStats)
      setTeksherConnectedIds((prev) => new Set([...prev, activeStore.id]))
      setConnectLogin('')
      setConnectPassword('')
      setConnectModalOpen(false)
    } catch (e: unknown) {
      setConnectError((e as Error).message)
    } finally {
      setConnectLoading(false)
    }
  }

  // ── Синхронизация: свежие данные с Teksher + сохранить в БД
  const handleSync = async () => {
    if (!activeStore || !supabase) return
    setSyncLoading(true)
    setStatsError(null)
    try {
      const { data, error } = await supabase.functions.invoke('teksher-auth', {
        body: { store_id: activeStore.id, action: 'sync' },
      })
      if (error) throw new Error(error.message)
      setTeksherStats(data as TeksherStats)
    } catch (e: unknown) {
      setStatsError((e as Error).message)
    } finally {
      setSyncLoading(false)
    }
  }

  // ── Отключить кабинет
  const handleDisconnect = async () => {
    if (!activeStore || !supabase) return
    await supabase.functions.invoke('teksher-auth', {
      body: { store_id: activeStore.id, action: 'disconnect' },
    })
    setTeksherStats({ connected: false })
    setTeksherConnectedIds((prev) => { const next = new Set(prev); next.delete(activeStore.id); return next })
  }

  const steps = [
    {
      num: 1,
      title: 'Регистрация товара',
      note: 'Один раз на каждый SKU',
      desc: 'Каждый артикул / цвет / размер регистрируется в Teksher. Система присваивает GTIN-14 — уникальный международный код товара.',
    },
    {
      num: 2,
      title: 'Заказ кодов (эмиссия)',
      note: 'Платно — списывается с баланса',
      desc: 'Заказываем N кодов на конкретный GTIN. Teksher генерирует коды и списывает деньги. Коды появляются со статусом ISSUED.',
    },
    {
      num: 3,
      title: 'Печать и нанесение',
      note: 'Стикер на каждую единицу товара',
      desc: 'Каждый код распечатывается на стикер (Data Matrix) и клеится на единицу. После — регистрируем «Нанесение» в Teksher: ISSUED → APPLIED.',
    },
    {
      num: 4,
      title: 'Отгрузка в Россию',
      note: 'Трансграничная операция',
      desc: 'При отправке партии в РФ регистрируем «Трансгран» в Teksher. При продаже в РФ — Честный Знак фиксирует: APPLIED → SOLD.',
    },
  ]

  return (
    <div className="flex flex-col gap-4">

      {/* ── Строка управления (store selector + кнопка) */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Store selector */}
        <div ref={storeDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setStoreSearch('')
              setStoreDropdownOpen((v) => {
                if (!v) setTimeout(() => storeSearchRef.current?.focus(), 30)
                return !v
              })
            }}
            className="flex w-48 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 10.5 6 5h12l2 5.5" />
              <path d="M5 10h14v9H5z" />
            </svg>
            <span className="flex-1 truncate text-left">{activeStore?.name ?? 'Выберите магазин'}</span>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {storeDropdownOpen && (
            <div
              className="absolute left-0 top-full z-20 mt-1.5 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Поиск */}
              <div className="border-b border-slate-100 px-3 py-2">
                <input
                  ref={storeSearchRef}
                  type="text"
                  value={storeSearch}
                  onChange={(e) => setStoreSearch(e.target.value)}
                  placeholder="Поиск магазина..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-blue-400"
                />
              </div>
              <div className="max-h-60 overflow-y-auto">
                {[...stores]
                  .sort((a, b) => {
                    const aConn = teksherConnectedIds.has(a.id) ? 0 : 1
                    const bConn = teksherConnectedIds.has(b.id) ? 0 : 1
                    if (aConn !== bConn) return aConn - bConn
                    return a.name.localeCompare(b.name, 'ru')
                  })
                  .filter((s) => s.name.toLowerCase().includes(storeSearch.toLowerCase()))
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { onStoreChange(s.id); setStoreDropdownOpen(false); setStoreSearch('') }}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50',
                        s.id === activeStore?.id ? 'font-semibold text-blue-600' : 'text-slate-700',
                      )}
                    >
                      {s.id === activeStore?.id
                        ? <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5"/></svg>
                        : <span className="h-3.5 w-3.5 shrink-0" />
                      }
                      <span className="flex-1 truncate">{s.name}</span>
                      {teksherConnectedIds.has(s.id) && (
                        <span className="ml-1 shrink-0 text-[10px] font-medium text-emerald-500">T</span>
                      )}
                    </button>
                  ))}
                {stores.filter((s) => s.name.toLowerCase().includes(storeSearch.toLowerCase())).length === 0 && (
                  <p className="px-4 py-3 text-sm text-slate-400">Ничего не найдено</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Кнопка подключить — всегда активна */}
        <button
          type="button"
          onClick={() => { setConnectError(null); setConnectModalOpen(true) }}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          Подключить Teksher
        </button>

        {/* Статус подключения — фиксированная ширина чтобы не было скачков */}
        <span className="inline-flex w-36 items-center justify-center gap-1.5">
          {statsLoading ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-400" />
              <span className="text-xs text-slate-400">Загрузка...</span>
            </>
          ) : teksherStats?.connected === true ? (
            <span className="text-xs font-medium text-emerald-600">Teksher подключён</span>
          ) : (
            <span className="text-xs font-medium text-amber-500">Teksher не подключён</span>
          )}
        </span>

        {/* Как это работает */}
        <span className="mx-1 text-slate-200">|</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Как это работает?</span>
        <button
          type="button"
          onClick={() => setStepsModalOpen(true)}
          className="text-xs font-medium text-blue-600 transition hover:text-blue-800"
        >
          Подробно
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setInfoModalOpen(true)}
            className="text-xs font-medium text-blue-600 transition hover:text-blue-800"
          >
            Инфо
          </button>
        )}

        <div className="ml-auto flex flex-col items-end gap-0.5">
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncLoading || !teksherStats || teksherStats.connected === false}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className={`h-4 w-4${syncLoading ? ' animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            {syncLoading ? 'Синхронизация...' : 'Синхронизировать'}
          </button>
          <span className="text-[10px] text-slate-400">
            {teksherStats?.connected === true && teksherStats.syncedAt
              ? `Обновлено ${formatSyncTime(teksherStats.syncedAt)}`
              : '\u00a0'}
          </span>
        </div>
      </div>

      {/* ── Ошибка загрузки статистики */}
      {statsError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          <span>Ошибка загрузки данных Teksher: {statsError}</span>
        </div>
      )}

      {/* ── Модалка подключения */}
      <Modal
        open={connectModalOpen}
        title="Подключить кабинет Teksher"
        description="Пароль сохраняется на сервере — фронт его не получает никогда."
        onClose={() => { setConnectModalOpen(false); setConnectLogin(''); setConnectPassword(''); setConnectError(null) }}
        className="max-w-md"
        footer={
          <div className="flex items-center justify-between gap-3">
            {teksherStats?.connected === true && (
              <button
                type="button"
                onClick={() => { void handleDisconnect(); setConnectModalOpen(false) }}
                className="text-xs text-slate-400 transition hover:text-red-500"
              >
                Отключить кабинет
              </button>
            )}
            <div className="ml-auto flex gap-3">
              <button
                type="button"
                onClick={() => { setConnectModalOpen(false); setConnectLogin(''); setConnectPassword(''); setConnectError(null) }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="submit"
                form="teksher-connect-form"
                disabled={connectLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {connectLoading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                {connectLoading ? 'Подключение...' : 'Подключить'}
              </button>
            </div>
          </div>
        }
      >
        <form id="teksher-connect-form" onSubmit={(e) => { void handleConnect(e) }} className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            Введите логин и пароль от{' '}
            <a href="https://label.teksher.kg" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">label.teksher.kg</a>.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Логин</label>
            <input
              type="text"
              value={connectLogin}
              onChange={(e) => setConnectLogin(e.target.value)}
              placeholder="Введите логин Teksher"
              required
              autoComplete="username"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Пароль</label>
            <input
              type="password"
              value={connectPassword}
              onChange={(e) => setConnectPassword(e.target.value)}
              placeholder="Введите пароль Teksher"
              required
              autoComplete="current-password"
              data-lpignore="true"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          {connectError && (
            <p className="text-sm text-red-600">{connectError}</p>
          )}
        </form>
      </Modal>

      {/* ── Подтабы */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { key: 'main', label: 'Главная' },
          { key: 'products', label: 'Товары (GTIN)' },
          { key: 'codes', label: 'КИЗ-коды' },
          { key: 'operations', label: 'Операции' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => { setSubTab(key); localStorage.setItem('elestet-kiz-subtab', key) }}
            className={cn(
              'px-3 pb-2 text-sm font-medium transition',
              subTab === key
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'main' && <>

      {/* ── Сводка — всегда видна, скелет при загрузке, 0 если не подключено */}
      <div className="grid grid-cols-3 gap-3">
        {/* Баланс КИЗ */}
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Баланс КИЗ</p>
          {statsLoading ? (
            <>
              <div className="mt-1.5 h-6 w-32 animate-pulse rounded-md bg-slate-100" />
              <div className="mt-1.5 h-3.5 w-20 animate-pulse rounded-md bg-slate-100" />
            </>
          ) : (
            <>
              <p className="mt-1 text-xl font-bold text-slate-800">
                {teksherStats?.connected === true ? teksherStats.balance.toLocaleString('ru') : '0'} шт.
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                ≈ {teksherStats?.connected === true ? teksherStats.balanceMoney.toFixed(2) : '0.00'} сом
              </p>
            </>
          )}
        </div>
        {/* Товаров (GTIN) */}
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Товаров (GTIN)</p>
          {statsLoading ? (
            <>
              <div className="mt-1.5 h-6 w-16 animate-pulse rounded-md bg-slate-100" />
              <div className="mt-1.5 h-3.5 w-24 animate-pulse rounded-md bg-slate-100" />
            </>
          ) : (
            <>
              <p className="mt-1 text-xl font-bold text-slate-800">
                {teksherStats?.connected === true ? teksherStats.products.toLocaleString('ru') : '0'}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">зарегистрировано</p>
            </>
          )}
        </div>
        {/* Операций */}
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Операций</p>
          {statsLoading ? (
            <>
              <div className="mt-1.5 h-6 w-20 animate-pulse rounded-md bg-slate-100" />
              <div className="mt-1.5 h-3.5 w-28 animate-pulse rounded-md bg-slate-100" />
            </>
          ) : (
            <>
              <p className="mt-1 text-xl font-bold text-slate-800">
                {teksherStats?.connected === true ? teksherStats.operations.toLocaleString('ru') : '0'}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">всего в кабинете</p>
            </>
          )}
        </div>
      </div>




      {/* ── Модалка: подробно — 4 этапа */}
      <Modal
        open={stepsModalOpen}
        title="Как это работает?"
        onClose={() => setStepsModalOpen(false)}
        className="max-w-xl"
      >
        <div className="divide-y divide-slate-100">
          {steps.map((step) => (
            <div key={step.num} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                {step.num}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="font-semibold text-slate-800">{step.title}</p>
                  <p className="text-xs text-slate-400">{step.note}</p>
                </div>
                <p className="mt-1 text-sm text-slate-500 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* ── Инфо-модалка: 3 таба (owner-only) */}
      <Modal
        open={infoModalOpen}
        title="Информация"
        onClose={() => setInfoModalOpen(false)}
        className="!w-[60vw] !max-w-none min-h-[65vh]"
      >
        {/* Табы */}
        <div className="flex gap-1 border-b border-slate-200 -mt-1 mb-4">
          {([
            { key: 'statuses', label: 'Статусы' },
            { key: 'format', label: 'Формат GS1' },
            { key: 'links', label: 'Ссылки' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setInfoTab(key)}
              className={cn(
                'px-3 pb-2 text-sm font-medium transition',
                infoTab === key
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-slate-500 hover:text-slate-800',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Статусы */}
        {infoTab === 'statuses' && (
          <div className="divide-y divide-slate-100">
            <div className="flex items-center gap-3 py-3 first:pt-0">
              <span className="w-16 rounded-md bg-slate-100 px-2 py-0.5 text-center text-[11px] font-bold text-slate-600">ISSUED</span>
              <p className="text-sm text-slate-500">Код заказан, готов к нанесению</p>
            </div>
            <div className="flex items-center gap-3 py-3">
              <svg viewBox="0 0 24 24" className="ml-5 h-3 w-3 shrink-0 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 14 0M13 6l6 6-6 6"/></svg>
              <span className="w-16 rounded-md bg-slate-100 px-2 py-0.5 text-center text-[11px] font-bold text-slate-600">APPLIED</span>
              <p className="text-sm text-slate-500">Нанесён на товар</p>
            </div>
            <div className="flex items-center gap-3 py-3 last:pb-0">
              <svg viewBox="0 0 24 24" className="ml-5 h-3 w-3 shrink-0 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 14 0M13 6l6 6-6 6"/></svg>
              <span className="w-16 rounded-md bg-slate-100 px-2 py-0.5 text-center text-[11px] font-bold text-slate-600">SOLD</span>
              <p className="text-sm text-slate-500">Продан в РФ</p>
            </div>
          </div>
        )}

        {/* Формат GS1 */}
        {infoTab === 'format' && (
          <div>
            <div className="rounded-xl bg-slate-50 px-4 py-2.5 font-mono text-sm">
              <span className="text-blue-600 font-semibold">01</span>
              <span className="text-slate-700">04703804901035</span>
              <span className="text-blue-600 font-semibold">21</span>
              <span className="text-slate-500">5Ik+Or/ZCNWnK</span>
            </div>
            <div className="mt-3 space-y-1.5 text-sm text-slate-500">
              <p><span className="font-mono font-semibold text-blue-600">01</span> — AI «GTIN»</p>
              <p><span className="font-mono text-slate-700">04703804901035</span> — GTIN-14 (047 = КР)</p>
              <p><span className="font-mono font-semibold text-blue-600">21</span> — AI «Серийный номер»</p>
              <p><span className="font-mono text-slate-500">5Ik+Or/ZCNWnK</span> — серийный № (13 символов)</p>
            </div>
          </div>
        )}

        {/* Ссылки */}
        {infoTab === 'links' && (
          <div className="flex flex-wrap gap-2">
            <a href="https://label.teksher.kg" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Кабинет Teksher
            </a>
            <a href="https://label.teksher.kg/facade/api/v1/marking_codes/filter?size=30&page=0&productGroupCode=LP+RF&status=ISSUED" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              API: ISSUED коды
            </a>
            <a href="https://label.teksher.kg/facade/api/v1/products?page=0&size=20" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              API: Товары (GTIN)
            </a>
          </div>
        )}
      </Modal>

      </>}

      {/* ── Таб: Товары (GTIN) */}
      {subTab === 'products' && (
        <div className="flex flex-col gap-4">
          {/* Поиск + счётчик */}
          <div className="flex items-center gap-3">
            <form
              onSubmit={(e) => { e.preventDefault(); setProductsPage(0); setProductsSearch(productsSearchInput) }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={productsSearchInput}
                onChange={(e) => setProductsSearchInput(e.target.value)}
                placeholder="Поиск по названию..."
                className="w-64 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
              <button
                type="submit"
                className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
              >
                Найти
              </button>
              {productsSearch && (
                <button
                  type="button"
                  onClick={() => { setProductsSearchInput(''); setProductsSearch(''); setProductsPage(0) }}
                  className="text-xs text-slate-400 transition hover:text-slate-600"
                >
                  Сбросить
                </button>
              )}
            </form>
            {!productsLoading && productsTotalElements > 0 && (
              <span className="text-sm text-slate-400">Всего: {productsTotalElements.toLocaleString('ru')}</span>
            )}
            {!wbLoading && (
              <span className="text-xs text-slate-400">
                WB: {wbByVendorCode.size} артикулов
              </span>
            )}
          </div>

          {/* Ошибка */}
          {productsError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              {productsError}
            </div>
          )}

          {/* Таблица */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="w-10 px-2 py-3" />
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">GTIN</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">Арт. WB</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Название GTIN</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Бренд</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Цвет</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Страна</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Производитель</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Предмет</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {productsLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        <td className="px-2 py-3"><div className="h-8 w-8 animate-pulse rounded-md bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-36 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-48 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-32 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-slate-100" /></td>
                      </tr>
                    ))
                  : productItems.length === 0
                    ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">
                          {productsSearch ? 'Ничего не найдено' : 'Нет товаров'}
                        </td>
                      </tr>
                    )
                    : productItems.map((p) => {
                        const vendorKey = (p.fullName ?? p.name) ? vendorCodeFromFullName(p.fullName ?? p.name ?? '') : null
                        const wb = vendorKey ? wbByVendorCode.get(vendorKey) : undefined
                        const photoUrl = wb?.photos?.[0]?.c246x328 ?? wb?.photos?.[0]?.small ?? wb?.photos?.[0]?.big ?? null
                        return (
                          <tr key={p.id} className="hover:bg-slate-50">
                            {/* Фото */}
                            <td className="px-2 py-2">
                              {wbLoading
                                ? <div className="h-8 w-8 animate-pulse rounded-md bg-slate-100" />
                                : <PhotoThumb url={photoUrl} className="h-8 w-8 rounded-md" />}
                            </td>
                            {/* GTIN */}
                            <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{p.gtin ?? '—'}</td>
                            {/* Арт. WB */}
                            <td className="px-4 py-3 whitespace-nowrap">
                              {wb?.nm_id ? (
                                <a
                                  href={`https://www.wildberries.ru/catalog/${wb.nm_id}/detail.aspx`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {wb.nm_id}
                                </a>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            {/* Название GTIN — из Teksher fullName */}
                            <td className="px-4 py-3 text-slate-800 max-w-xs">
                              <span className="line-clamp-2">{p.fullName ?? p.name ?? <span className="text-slate-300">—</span>}</span>
                            </td>
                            {/* Бренд */}
                            <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{wb?.brand ?? <span className="text-slate-300">—</span>}</td>
                            {/* Цвет — из Teksher attributes */}
                            <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{teksherColor(p) ?? <span className="text-slate-300">—</span>}</td>
                            {/* Страна — из Teksher */}
                            <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{p.manufacturedCountry?.name ?? <span className="text-slate-300">—</span>}</td>
                            {/* Производитель — из Teksher */}
                            <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{p.manufacturerFullName ?? <span className="text-slate-300">—</span>}</td>
                            {/* Предмет */}
                            <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{wb?.category ?? <span className="text-slate-300">—</span>}</td>
                            {/* Статус Teksher (русский) */}
                            <td className="px-4 py-3">
                              <span className={cn(
                                'inline-block rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
                                p.status === 'ACTIVE' || p.status === 'PUBLISHED'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-slate-100 text-slate-600',
                              )}>
                                {teksherStatusRu(p.status)}
                              </span>
                            </td>
                          </tr>
                        )
                      })
                }
              </tbody>
            </table>
          </div>

          {/* Пагинация */}
          {productsTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={productsPage === 0}
                onClick={() => setProductsPage((p) => p - 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                ← Назад
              </button>
              <span className="text-sm text-slate-500">
                {productsPage + 1} / {productsTotalPages}
              </span>
              <button
                type="button"
                disabled={productsPage >= productsTotalPages - 1}
                onClick={() => setProductsPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
              >
                Вперёд →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Таб: КИЗ-коды */}
      {subTab === 'codes' && (
        <div className="flex flex-col gap-4">
          {/* Фильтр по статусу */}
          <div className="flex flex-wrap items-center gap-3">
            {(['', 'ISSUED', 'APPLIED', 'SOLD'] as const).map((s) => {
              const labels: Record<string, string> = { '': 'Все', ISSUED: 'Выданные', APPLIED: 'Нанесённые', SOLD: 'Проданные' }
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setCodesStatus(s); setCodesPage(0) }}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm font-medium transition',
                    codesStatus === s
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {labels[s]}
                </button>
              )
            })}
            {!codesLoading && codesTotalElements > 0 && (
              <span className="ml-auto text-sm text-slate-400">Всего: {codesTotalElements.toLocaleString('ru')}</span>
            )}
          </div>

          {codesError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              {codesError}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Код</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">GTIN</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Статус</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {codesLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        <td className="px-4 py-3"><div className="h-4 w-8 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-52 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-36 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-100" /></td>
                      </tr>
                    ))
                  : codesItems.length === 0
                    ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">Нет кодов</td>
                      </tr>
                    )
                    : codesItems.map((c, i) => {
                        const rawCode = String(c.code ?? c.barcode ?? c.id ?? '')
                        const { label, cls } = codeStatusBadge(c.status as string | undefined)
                        const date = (c.issueDate ?? c.createdDate ?? c.emissionDate) as string | undefined
                        return (
                          <tr key={c.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 text-xs text-slate-400">{codesPage * 30 + i + 1}</td>
                            <td className="px-4 py-3 max-w-xs">
                              <span className="block truncate font-mono text-xs text-slate-700" title={rawCode}>{rawCode || '—'}</span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{c.gtin ?? '—'}</td>
                            <td className="px-4 py-3">
                              <span className={cn('inline-block rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', cls)}>{label}</span>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatTeksherDate(date)}</td>
                          </tr>
                        )
                      })
                }
              </tbody>
            </table>
          </div>

          {codesTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button type="button" disabled={codesPage === 0} onClick={() => setCodesPage((p) => p - 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
                ← Назад
              </button>
              <span className="text-sm text-slate-500">{codesPage + 1} / {codesTotalPages}</span>
              <button type="button" disabled={codesPage >= codesTotalPages - 1} onClick={() => setCodesPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
                Вперёд →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Таб: Операции */}
      {subTab === 'operations' && (
        <div className="flex flex-col gap-4">
          {!opsLoading && opsTotalElements > 0 && (
            <div className="text-sm text-slate-400">Всего операций: {opsTotalElements.toLocaleString('ru')}</div>
          )}

          {opsError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              {opsError}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">#</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Тип операции</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">GTIN</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap">Кол-во кодов</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Статус</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {opsLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        <td className="px-4 py-3"><div className="h-4 w-8 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-36 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-slate-100" /></td>
                        <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-100" /></td>
                      </tr>
                    ))
                  : opsItems.length === 0
                    ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">Нет операций</td>
                      </tr>
                    )
                    : opsItems.map((op, i) => {
                        const opType = (op.operationType ?? op.type) as string | undefined
                        const { label: typeLabel, cls: typeCls } = opTypeBadge(opType)
                        const { label: stLabel, cls: stCls } = codeStatusBadge(op.status as string | undefined)
                        const count = (op.codesCount ?? op.quantity) as number | undefined
                        const date = (op.createdDate ?? op.date) as string | undefined
                        return (
                          <tr key={op.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 text-xs text-slate-400">{opsPage * 20 + i + 1}</td>
                            <td className="px-4 py-3">
                              <span className={cn('inline-block rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', typeCls)}>{typeLabel}</span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">{op.gtin ?? '—'}</td>
                            <td className="px-4 py-3 text-sm text-slate-700">{count != null ? count.toLocaleString('ru') : '—'}</td>
                            <td className="px-4 py-3">
                              <span className={cn('inline-block rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', stCls)}>{stLabel}</span>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatTeksherDate(date)}</td>
                          </tr>
                        )
                      })
                }
              </tbody>
            </table>
          </div>

          {opsTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button type="button" disabled={opsPage === 0} onClick={() => setOpsPage((p) => p - 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
                ← Назад
              </button>
              <span className="text-sm text-slate-500">{opsPage + 1} / {opsTotalPages}</span>
              <button type="button" disabled={opsPage >= opsTotalPages - 1} onClick={() => setOpsPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
                Вперёд →
              </button>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
