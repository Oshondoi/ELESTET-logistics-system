import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getStoreSelectorLabel } from '../lib/storeDisplay'
import type { Store } from '../types'

// ── Типы ─────────────────────────────────────────────────────────────────────

interface WbCampaign {
  advertId: number
  name: string
  type: number
  status: number        // 4=готова, 9=активна, 11=пауза
  createTime: string
  changeTime: string
  startTime?: string
  endTime?: string
  dailyBudget?: number
  budget?: number
}

interface CampaignStat {
  advertId: number
  views: number
  clicks: number
  ctr: number
  cpc: number
  sum: number
  orders: number
  ordersSumRub: number
  cr?: number
  cpo?: number
  cpm?: number
  nmId?: number
}

interface Cluster {
  phrase: string
  status: 'active' | 'inactive'
  bid?: number          // кастомная ставка в у.е. (undefined = базовая)
}

interface ClusterStat {
  phrase: string
  views: number
  clicks: number
  ctr: number
  cpc: number
  cpm?: number
  sum: number
  orders?: number
  basket?: number       // корзина
  avgPosition?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function invokeAdvert(storeId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase!.auth.getSession()
  const token = session?.access_token
  const { data, error } = await supabase!.functions.invoke('wb-advert', {
    body: { ...body, store_id: storeId },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (error) throw new Error(error.message)
  const d = data as Record<string, unknown>
  if (d?.error === 'no_adv_permission') throw new Error('no_adv_permission')
  if (d?.error === 'wb_error') throw new Error(d.message as string)
  return d
}

function statusLabel(status: number): { text: string; cls: string } {
  if (status === 9) return { text: 'Активна', cls: 'bg-emerald-100 text-emerald-700' }
  if (status === 11) return { text: 'Пауза', cls: 'bg-amber-100 text-amber-700' }
  if (status === 4) return { text: 'Готова', cls: 'bg-blue-100 text-blue-700' }
  return { text: 'Завершена', cls: 'bg-slate-100 text-slate-500' }
}

function fmt(n: number | undefined | null, decimals = 0) {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtPct(n: number | undefined | null) {
  if (n == null || isNaN(n)) return '—'
  return n.toFixed(2) + ' %'
}

function defaultDateRange(days = 7): [string, string] {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days + 1)
  const f = (d: Date) => d.toISOString().split('T')[0]
  return [f(from), f(to)]
}

function datesInRange(from: string, to: string): string[] {
  const dates: string[] = []
  const cur = new Date(from)
  const end = new Date(to)
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0])
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

const STORAGE_KEY_DATES = (storeId: string) => `elestet-advert-dates-${storeId}`

// ── Компонент ─────────────────────────────────────────────────────────────────

interface PromotionPageProps {
  stores: Store[]
}

export const PromotionPage = ({ stores }: PromotionPageProps) => {
  const storesWithKey = stores.filter(s => s.api_key)

  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => storesWithKey[0]?.id ?? '')
  const [noAdvPerm, setNoAdvPerm] = useState(false)
  const [campaigns, setCampaigns] = useState<WbCampaign[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [campaignStats, setCampaignStats] = useState<Record<number, CampaignStat>>({})
  const [activeCampaign, setActiveCampaign] = useState<WbCampaign | null>(null)
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [clusterStats, setClusterStats] = useState<Record<string, ClusterStat>>({})
  const [clusterTab, setClusterTab] = useState<'all' | 'active' | 'inactive' | 'custom'>('all')
  const [clusterSearch, setClusterSearch] = useState('')
  const [clusterLoading, setClusterLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const bulkRef = useRef<HTMLDivElement>(null)

  const [minus, setMinus] = useState<string[]>([])
  const [minusInput, setMinusInput] = useState('')
  const [minusLoading, setMinusLoading] = useState(false)
  const [minusOpen, setMinusOpen] = useState(false)

  const [dateFrom, setDateFrom] = useState(() => defaultDateRange(7)[0])
  const [dateTo, setDateTo] = useState(() => defaultDateRange(7)[1])

  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<number>>(new Set())
  const [bulkCampaignOpen, setBulkCampaignOpen] = useState(false)
  const bulkCampaignRef = useRef<HTMLDivElement>(null)

  const [balance, setBalance] = useState<{ balance: number; net: number; bonus: number } | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [depositCampaign, setDepositCampaign] = useState<WbCampaign | null>(null)
  const [depositAmount, setDepositAmount] = useState('1000')
  const [depositLoading, setDepositLoading] = useState(false)

  const activeStore = stores.find(s => s.id === selectedStoreId)

  // Восстановить даты из localStorage при смене магазина
  useEffect(() => {
    if (!selectedStoreId) return
    const saved = localStorage.getItem(STORAGE_KEY_DATES(selectedStoreId))
    if (saved) {
      try {
        const { from, to } = JSON.parse(saved) as { from: string; to: string }
        setDateFrom(from)
        setDateTo(to)
      } catch { /* ignore */ }
    } else {
      const [f, t] = defaultDateRange(7)
      setDateFrom(f)
      setDateTo(t)
    }
    setActiveCampaign(null)
    setCampaigns([])
    setNoAdvPerm(false)
    setBalance(null)
  }, [selectedStoreId])

  useEffect(() => {
    if (!selectedStoreId) return
    localStorage.setItem(STORAGE_KEY_DATES(selectedStoreId), JSON.stringify({ from: dateFrom, to: dateTo }))
  }, [selectedStoreId, dateFrom, dateTo])

  useEffect(() => {
    if (!bulkOpen) return
    const h = (e: MouseEvent) => {
      if (bulkRef.current && !bulkRef.current.contains(e.target as Node)) setBulkOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [bulkOpen])

  useEffect(() => {
    if (!bulkCampaignOpen) return
    const h = (e: MouseEvent) => {
      if (bulkCampaignRef.current && !bulkCampaignRef.current.contains(e.target as Node)) setBulkCampaignOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [bulkCampaignOpen])

  // ── Загрузить кампании ────────────────────────────────────────────────────
  const loadCampaigns = useCallback(async () => {
    if (!selectedStoreId) return
    setCampaignsLoading(true)
    setStatsLoading(false)
    setError(null)
    setNoAdvPerm(false)
    setCampaignStats({})
    try {
      const res = await invokeAdvert(selectedStoreId, { action: 'campaigns' })
      const list = (res.campaigns as WbCampaign[]) ?? []
      setCampaigns(list)
      setCampaignsLoading(false)

      if (list.length > 0) {
        setStatsLoading(true)
        try {
          const ids = list.map(c => Number(c.advertId))
          const dates = datesInRange(dateFrom, dateTo)
          const statsRes = await invokeAdvert(selectedStoreId, { action: 'campaign_stats', ids, dates })
          const statsArr = (statsRes.stats as CampaignStat[]) ?? []
          const statsMap: Record<number, CampaignStat> = {}
          for (const s of statsArr) {
            if (s.advertId != null) statsMap[Number(s.advertId)] = s
          }
          setCampaignStats(statsMap)
        } catch (statsErr) {
          setError((statsErr as Error).message)
        } finally {
          setStatsLoading(false)
        }
      }
      setLastUpdated(new Date())
    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'no_adv_permission') setNoAdvPerm(true)
      else setError(msg)
    } finally {
      setCampaignsLoading(false)
      setStatsLoading(false)
    }
  }, [selectedStoreId, dateFrom, dateTo])

  const loadBalance = useCallback(async () => {
    if (!selectedStoreId) return
    setBalanceLoading(true)
    try {
      const res = await invokeAdvert(selectedStoreId, { action: 'balance' })
      const b = res.balance as { balance: number; net: number; bonus: number }
      setBalance(b)
    } catch { /* не критично — просто не показываем */ } finally {
      setBalanceLoading(false)
    }
  }, [selectedStoreId])

  useEffect(() => {
    if (selectedStoreId) {
      void loadCampaigns()
      void loadBalance()
    }
  }, [selectedStoreId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Загрузить детали кампании ─────────────────────────────────────────────
  const loadCampaignDetail = useCallback(async (campaign: WbCampaign) => {
    setActiveCampaign(campaign)
    setClusterLoading(true)
    setSelected(new Set())
    setClusterSearch('')
    setClusters([])
    setClusterStats({})
    setMinus([])
    try {
      const [clustersRes, minusRes] = await Promise.all([
        invokeAdvert(selectedStoreId, { action: 'clusters', id: campaign.advertId }),
        invokeAdvert(selectedStoreId, { action: 'get_minus', id: campaign.advertId }),
      ])

      const raw = clustersRes.clusters
      let clusterList: Cluster[] = []

      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const r = raw as Record<string, unknown>
        const active = (r.active as Array<{ phrase: string; bid?: number }> ?? []).map(c => ({
          phrase: c.phrase,
          status: 'active' as const,
          bid: c.bid,
        }))
        const inactive = (r.inactive as Array<{ phrase: string }> ?? []).map(c => ({
          phrase: c.phrase,
          status: 'inactive' as const,
        }))
        clusterList = [...active, ...inactive]
      }

      setClusters(clusterList)
      setMinus((minusRes.minus as string[]) ?? [])

      const dates = datesInRange(dateFrom, dateTo)
      const statsRes = await invokeAdvert(selectedStoreId, { action: 'cluster_stats', id: campaign.advertId, dates })
      const statsArr = (statsRes.stats as ClusterStat[]) ?? []
      const statsMap: Record<string, ClusterStat> = {}
      for (const s of statsArr) {
        if (s.phrase) statsMap[s.phrase] = s
      }
      setClusterStats(statsMap)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setClusterLoading(false)
    }
  }, [selectedStoreId, dateFrom, dateTo])

  // ── Bulk-действия над выбранными кампаниями ─────────────────────────────────
  const bulkToggleCampaigns = async (targetStatus: 'start' | 'pause') => {
    if (selectedCampaigns.size === 0) return
    setBulkCampaignOpen(false)
    const action = targetStatus === 'start' ? 'start_campaign' : 'pause_campaign'
    setActionLoading('bulk_campaigns')
    try {
      await Promise.all([...selectedCampaigns].map(id => invokeAdvert(selectedStoreId, { action, id })))
      setSelectedCampaigns(new Set())
      await loadCampaigns()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActionLoading(null)
    }
  }

  // ── Пауза / Запуск кампании ───────────────────────────────────────────────
  const toggleCampaign = async (c: WbCampaign) => {
    setActionLoading(`campaign_${c.advertId}`)
    try {
      const action = c.status === 9 ? 'pause_campaign' : 'start_campaign'
      await invokeAdvert(selectedStoreId, { action, id: c.advertId })
      if (activeCampaign?.advertId === c.advertId) {
        setActiveCampaign(prev => prev ? { ...prev, status: c.status === 9 ? 11 : 9 } : prev)
      }
      await loadCampaigns()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActionLoading(null)
    }
  }

  // ── Изменить ставку кластера ──────────────────────────────────────────────
  const setBid = async (phrase: string, bid: number) => {
    if (!activeCampaign) return
    try {
      await invokeAdvert(selectedStoreId, { action: 'set_bid', id: activeCampaign.advertId, bids: [{ phrase, bid }] })
      setClusters(prev => prev.map(c => c.phrase === phrase ? { ...c, bid } : c))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ── Bulk: отключить/включить/сбросить ─────────────────────────────────────
  const bulkAction = async (type: 'disable' | 'enable' | 'reset') => {
    if (!activeCampaign || selected.size === 0) return
    setBulkOpen(false)
    const phrases = [...selected]
    setActionLoading('bulk')
    try {
      if (type === 'disable') {
        await invokeAdvert(selectedStoreId, { action: 'delete_bid', id: activeCampaign.advertId, phrases })
        setClusters(prev => prev.map(c => phrases.includes(c.phrase) ? { ...c, status: 'inactive' as const, bid: undefined } : c))
      } else if (type === 'enable') {
        const bids = phrases.map(phrase => ({ phrase, bid: 0 }))
        await invokeAdvert(selectedStoreId, { action: 'set_bid', id: activeCampaign.advertId, bids })
        setClusters(prev => prev.map(c => phrases.includes(c.phrase) ? { ...c, status: 'active' as const } : c))
      } else if (type === 'reset') {
        await invokeAdvert(selectedStoreId, { action: 'reset_bid', id: activeCampaign.advertId, phrases })
        setClusters(prev => prev.map(c => phrases.includes(c.phrase) ? { ...c, bid: undefined } : c))
      }
      setSelected(new Set())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActionLoading(null)
    }
  }

  // ── Минус-фразы ───────────────────────────────────────────────────────────
  const addMinus = async () => {
    if (!activeCampaign || !minusInput.trim()) return
    const newMinus = [...new Set([...minus, ...minusInput.split(',').map(s => s.trim()).filter(Boolean)])]
    setMinusLoading(true)
    try {
      await invokeAdvert(selectedStoreId, { action: 'set_minus', id: activeCampaign.advertId, minus: newMinus })
      setMinus(newMinus)
      setMinusInput('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setMinusLoading(false)
    }
  }

  const removeMinus = async (phrase: string) => {
    if (!activeCampaign) return
    const newMinus = minus.filter(m => m !== phrase)
    try {
      await invokeAdvert(selectedStoreId, { action: 'set_minus', id: activeCampaign.advertId, minus: newMinus })
      setMinus(newMinus)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // ── Фильтр кластеров ──────────────────────────────────────────────────────
  const filteredClusters = clusters.filter(c => {
    if (clusterTab === 'active' && c.status !== 'active') return false
    if (clusterTab === 'inactive' && c.status !== 'inactive') return false
    if (clusterTab === 'custom' && c.bid == null) return false
    if (clusterSearch && !c.phrase.toLowerCase().includes(clusterSearch.toLowerCase())) return false
    return true
  })

  const allSelected = filteredClusters.length > 0 && filteredClusters.every(c => selected.has(c.phrase))
  const toggleAll = () => {
    if (allSelected) {
      const next = new Set(selected)
      filteredClusters.forEach(c => next.delete(c.phrase))
      setSelected(next)
    } else {
      const next = new Set(selected)
      filteredClusters.forEach(c => next.add(c.phrase))
      setSelected(next)
    }
  }

  // ── Нет магазинов с ключом ────────────────────────────────────────────────
  if (storesWithKey.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-sm font-medium text-slate-600">Нет магазинов с API-ключом WB</p>
        <p className="mt-1 text-xs text-slate-400">Добавьте API-ключ в настройках магазина</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Тулбар */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-100 bg-white px-4 py-2.5">
        <select
          value={selectedStoreId}
          onChange={e => { setSelectedStoreId(e.target.value); setActiveCampaign(null) }}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {storesWithKey.map(s => (
            <option key={s.id} value={s.id}>{getStoreSelectorLabel(s)}</option>
          ))}
        </select>

        {/* Баланс единого счёта */}
        {(balance != null || balanceLoading) && (
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5">
            <span className="text-xs text-slate-500">Единый счёт:</span>
            {balanceLoading && balance == null
              ? <span className="inline-block h-3 w-16 animate-pulse rounded bg-slate-200" />
              : <span className="text-xs font-semibold text-slate-800">{fmt(balance ? balance.net + balance.balance : 0)} у.е.</span>
            }
          </div>
        )}

        {activeCampaign && (
          <>
            <span className="text-slate-300">/</span>
            <button
              type="button"
              onClick={() => setActiveCampaign(null)}
              className="text-sm text-blue-600 hover:underline"
            >
              Кампании
            </button>
            <span className="text-slate-300">/</span>
            <span className="max-w-[200px] truncate text-sm font-medium text-slate-800">{activeCampaign.name}</span>
          </>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1.5">
          <input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={e => setDateFrom(e.target.value)}
            className="text-xs text-slate-600 focus:outline-none"
          />
          <span className="text-[10px] text-slate-300">—</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={e => setDateTo(e.target.value)}
            className="text-xs text-slate-600 focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => activeCampaign ? void loadCampaignDetail(activeCampaign) : void loadCampaigns()}
          disabled={campaignsLoading || clusterLoading}
          className="flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${(campaignsLoading || clusterLoading) ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 8v-4" /><path d="M3 16v4" />
          </svg>
          Обновить
        </button>

        {lastUpdated && (
          <span className="text-[10px] text-slate-400">
            {lastUpdated.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Ошибки */}
      {noAdvPerm && (
        <div className="mx-4 mt-3 shrink-0 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>API-ключ не имеет прав на рекламу.</strong> Откройте кабинет WB → Настройки → Доступ к API → найдите ключ магазина «{activeStore?.name}» и включите разрешение <strong>«Реклама»</strong>.
        </div>
      )}
      {error && !noAdvPerm && (
        <div className="mx-4 mt-3 shrink-0 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-3 text-rose-400 hover:text-rose-600">✕</button>
        </div>
      )}

      <div className="relative flex-1 flex flex-col min-h-0 px-4 py-4">

        {/* ── Список кампаний ─────────────────────────────────────────────── */}
        {!activeCampaign && (
          <>
            {campaignsLoading && (
              <div className="py-16 text-center text-sm text-slate-400">Загрузка кампаний...</div>
            )}
            {!campaignsLoading && campaigns.length === 0 && !noAdvPerm && !error && (
              <div className="py-16 text-center text-sm text-slate-400">Нет рекламных кампаний</div>
            )}
            {!campaignsLoading && campaigns.length > 0 && (
              <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      {/* Чекбокс «выбрать все» */}
                      <th className="sticky top-0 z-10 w-8 bg-slate-50 px-3 py-2.5 border-b border-slate-200">
                        <input
                          type="checkbox"
                          checked={campaigns.length > 0 && campaigns.every(c => selectedCampaigns.has(c.advertId))}
                          onChange={e => {
                            if (e.target.checked) setSelectedCampaigns(new Set(campaigns.map(c => c.advertId)))
                            else setSelectedCampaigns(new Set())
                          }}
                          className="h-4 w-4 rounded border-slate-300 accent-violet-600 cursor-pointer"
                        />
                      </th>
                      <th className="sticky top-0 z-10 w-12 bg-slate-50 px-3 py-2.5 border-b border-slate-200" />
                      <th className="sticky top-0 z-10 bg-slate-50 px-4 py-2.5 text-left border-b border-slate-200">Кампания</th>
                      <th className="sticky top-0 z-10 bg-slate-50 px-4 py-2.5 text-left border-b border-slate-200">Тип кампании</th>
                      <th className="sticky top-0 z-10 bg-slate-50 px-4 py-2.5 text-right border-b border-slate-200">Бюджет, у.е.</th>
                      <th className="sticky top-0 z-10 bg-slate-50 px-4 py-2.5 text-right border-b border-slate-200">Затраты, ₽</th>
                      <th className="sticky top-0 z-10 bg-slate-50 px-4 py-2.5 text-right border-b border-slate-200">Показы</th>
                      <th className="sticky top-0 z-10 bg-slate-50 px-4 py-2.5 text-right border-b border-slate-200">CTR</th>
                      <th className="sticky top-0 z-10 bg-slate-50 px-4 py-2.5 text-right border-b border-slate-200">Заказы</th>
                      <th className="sticky top-0 z-10 bg-slate-50 px-4 py-2.5 text-right border-b border-slate-200">Доля затрат</th>
                      <th className="sticky top-0 z-10 w-16 bg-slate-50 px-3 py-2.5 border-b border-slate-200" />
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c, idx) => {
                      const st = statusLabel(c.status)
                      const s = campaignStats[Number(c.advertId)]
                      const doshaZatrat = s && (s.ordersSumRub ?? 0) > 0 ? (s.sum / s.ordersSumRub * 100) : null
                      const isLoadingToggle = actionLoading === `campaign_${c.advertId}`
                      const canToggle = c.status === 9 || c.status === 11 || c.status === 4
                      const isOn = c.status === 9
                      const isChecked = selectedCampaigns.has(c.advertId)
                      const rowBorder = idx > 0 ? 'border-t border-slate-100' : ''
                      // Ячейка со статистикой: пока загружается — спиннер, нет данных — Н/Д
                      const statCell = (val: string) => statsLoading
                        ? <span className="inline-block h-3 w-10 animate-pulse rounded bg-slate-200" />
                        : <span className={s ? 'text-slate-700' : 'text-slate-300'}>{s ? val : 'Н/Д'}</span>
                      return (
                        <tr key={c.advertId} className={`group transition-colors ${rowBorder} ${isChecked ? 'bg-violet-50/60' : 'hover:bg-slate-50/60'}`}>

                          {/* Чекбокс строки */}
                          <td className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={e => {
                                const next = new Set(selectedCampaigns)
                                if (e.target.checked) next.add(c.advertId)
                                else next.delete(c.advertId)
                                setSelectedCampaigns(next)
                              }}
                              className="h-4 w-4 rounded border-slate-300 accent-violet-600 cursor-pointer"
                            />
                          </td>

                          {/* Toggle switch */}
                          <td className="px-3 py-3 text-center">
                            <button
                              type="button"
                              disabled={isLoadingToggle || !canToggle}
                              onClick={() => void toggleCampaign(c)}
                              title={isOn ? 'Приостановить' : 'Запустить'}
                              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 ${
                                isOn ? 'bg-green-500' : 'bg-slate-300'
                              }`}
                            >
                              {isLoadingToggle ? (
                                <span className="absolute inset-0 flex items-center justify-center">
                                  <svg viewBox="0 0 24 24" className="h-3 w-3 animate-spin text-white" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 1 1-18 0" /></svg>
                                </span>
                              ) : (
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${isOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
                              )}
                            </button>
                          </td>

                          {/* Кампания */}
                          <td className="px-4 py-3 max-w-[260px]">
                            <button
                              type="button"
                              onClick={() => void loadCampaignDetail(c)}
                              className="block text-left font-medium text-blue-600 hover:underline leading-tight truncate max-w-full"
                            >
                              {c.name}
                            </button>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.text}</span>
                              <span className="text-[10px] text-slate-400">ID {c.advertId}</span>
                            </div>
                          </td>

                          {/* Тип кампании */}
                          <td className="px-4 py-3">
                            <div className="text-xs font-medium text-slate-700">CPM</div>
                            <div className="text-[10px] text-slate-400">{c.type === 9 ? 'Ручная' : 'Единая'}</div>
                          </td>

                          {/* Бюджет */}
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => { setDepositCampaign(c); setDepositAmount('1000') }}
                              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-700 transition"
                            >
                              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12h14"/></svg>
                              {c.budget != null ? fmt(c.budget as number) : '0'} у.е.
                            </button>
                          </td>

                          {/* Затраты */}
                          <td className="px-4 py-3 text-right">{statCell(fmt(s?.sum, 2))}</td>

                          {/* Показы */}
                          <td className="px-4 py-3 text-right">{statCell(fmt(s?.views))}</td>

                          {/* CTR */}
                          <td className="px-4 py-3 text-right">{statCell(fmtPct(s?.ctr))}</td>

                          {/* Заказы */}
                          <td className="px-4 py-3 text-right">{statCell(fmt(s?.orders))}</td>

                          {/* Доля затрат */}
                          <td className="px-4 py-3 text-right">{statCell(doshaZatrat != null ? doshaZatrat.toFixed(2) + ' %' : 'Н/Д')}</td>

                          {/* Действия */}
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {/* Открыть детали / кластеры */}
                              <button
                                type="button"
                                onClick={() => void loadCampaignDetail(c)}
                                title="Поисковые кластеры"
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                              >
                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ── Детали кампании ─────────────────────────────────────────────── */}
        {activeCampaign && (
          <div className="space-y-4">

            {/* Шапка */}
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{activeCampaign.name}</span>
                  <span className="text-xs text-slate-400">ID {activeCampaign.advertId}</span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusLabel(activeCampaign.status).cls}`}>
                    {statusLabel(activeCampaign.status).text}
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={actionLoading === `campaign_${activeCampaign.advertId}`}
                onClick={() => void toggleCampaign(activeCampaign)}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  activeCampaign.status === 9
                    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                } disabled:opacity-50`}
              >
                {activeCampaign.status === 9 ? 'Приостановить' : 'Запустить'}
              </button>
            </div>

            {clusterLoading && (
              <div className="py-12 text-center text-sm text-slate-400">Загрузка кластеров...</div>
            )}

            {!clusterLoading && (
              <>
                {/* Таблица кластеров */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">

                  {/* Контрол-панель */}
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                    {(['all', 'active', 'inactive', 'custom'] as const).map(t => {
                      const labels = { all: 'Все', active: 'Активны', inactive: 'Неактивны', custom: 'Ваша ставка' }
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setClusterTab(t)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                            clusterTab === t ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                          }`}
                        >
                          {labels[t]}
                        </button>
                      )
                    })}

                    <div className="flex-1" />

                    <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                      </svg>
                      <input
                        type="text"
                        placeholder="Искать фразу..."
                        value={clusterSearch}
                        onChange={e => setClusterSearch(e.target.value)}
                        className="w-40 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
                      />
                    </div>

                    <div className="relative" ref={bulkRef}>
                      <button
                        type="button"
                        disabled={selected.size === 0 || actionLoading === 'bulk'}
                        onClick={() => setBulkOpen(v => !v)}
                        className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 6h16M4 12h16M4 18h7" /><circle cx="19" cy="18" r="3" />
                        </svg>
                        Управление кластерами
                        {selected.size > 0 && <span className="ml-1 rounded-full bg-violet-100 px-1.5 text-violet-700">{selected.size}</span>}
                      </button>
                      {bulkOpen && (
                        <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                          <button type="button" onClick={() => void bulkAction('disable')} className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">Отключить</button>
                          <button type="button" onClick={() => void bulkAction('enable')} className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">Включить</button>
                          <button type="button" onClick={() => void bulkAction('reset')} className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">Вернуть базовую ставку</button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Таблица */}
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-100 text-sm">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="w-8 px-3 py-2.5">
                            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                          </th>
                          <th className="px-3 py-2.5 text-left">Фраза</th>
                          <th className="px-3 py-2.5 text-right">Ставка CPM</th>
                          <th className="px-3 py-2.5 text-right">Ср. позиция</th>
                          <th className="px-3 py-2.5 text-right">Показы</th>
                          <th className="px-3 py-2.5 text-right">Клики</th>
                          <th className="px-3 py-2.5 text-right">CTR</th>
                          <th className="px-3 py-2.5 text-right">CPM</th>
                          <th className="px-3 py-2.5 text-right">CPC</th>
                          <th className="px-3 py-2.5 text-right">Корзина</th>
                          <th className="px-3 py-2.5 text-right">Заказы</th>
                          <th className="px-3 py-2.5 text-right">Затраты, ₽</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">

                        {filteredClusters.length > 0 && (() => {
                          const totals = filteredClusters.reduce((acc, c) => {
                            const s = clusterStats[c.phrase]
                            if (!s) return acc
                            acc.views += s.views || 0
                            acc.clicks += s.clicks || 0
                            acc.sum += s.sum || 0
                            acc.orders += s.orders || 0
                            acc.basket += s.basket || 0
                            return acc
                          }, { views: 0, clicks: 0, sum: 0, orders: 0, basket: 0 })
                          const totalCtr = totals.views > 0 ? totals.clicks / totals.views * 100 : 0
                          return (
                            <tr className="bg-slate-50/50 font-medium text-slate-700">
                              <td className="px-3 py-2.5" />
                              <td className="px-3 py-2.5 text-xs text-slate-500">Итого</td>
                              <td /><td />
                              <td className="px-3 py-2.5 text-right">{fmt(totals.views)}</td>
                              <td className="px-3 py-2.5 text-right">{fmt(totals.clicks)}</td>
                              <td className="px-3 py-2.5 text-right">{fmtPct(totalCtr)}</td>
                              <td /><td />
                              <td className="px-3 py-2.5 text-right">{fmt(totals.basket)}</td>
                              <td className="px-3 py-2.5 text-right">{fmt(totals.orders)}</td>
                              <td className="px-3 py-2.5 text-right">{fmt(totals.sum, 2)}</td>
                            </tr>
                          )
                        })()}

                        {filteredClusters.map(c => {
                          const s = clusterStats[c.phrase]
                          const isActive = c.status === 'active'
                          const hasCustomBid = c.bid != null
                          const bidColor = hasCustomBid
                            ? (c.bid! >= 1000 ? 'border-violet-400' : 'border-emerald-400')
                            : 'border-slate-200'

                          return (
                            <tr key={c.phrase} className={`transition ${isActive ? 'hover:bg-slate-50/70' : 'opacity-50'}`}>
                              <td className="px-3 py-2.5">
                                <input
                                  type="checkbox"
                                  checked={selected.has(c.phrase)}
                                  onChange={e => {
                                    const next = new Set(selected)
                                    if (e.target.checked) next.add(c.phrase)
                                    else next.delete(c.phrase)
                                    setSelected(next)
                                  }}
                                  className="rounded"
                                />
                              </td>
                              <td className={`px-3 py-2.5 ${isActive ? 'text-slate-800' : 'text-slate-400'}`}>
                                {c.phrase}
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                {isActive ? (
                                  <BidInput
                                    value={c.bid}
                                    borderColor={bidColor}
                                    onSave={bid => void setBid(c.phrase, bid)}
                                  />
                                ) : (
                                  <span className="text-xs text-slate-300">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right text-slate-600">{fmt(s?.avgPosition, 2)}</td>
                              <td className="px-3 py-2.5 text-right text-slate-600">{fmt(s?.views)}</td>
                              <td className="px-3 py-2.5 text-right text-slate-600">{fmt(s?.clicks)}</td>
                              <td className="px-3 py-2.5 text-right text-slate-600">{fmtPct(s?.ctr)}</td>
                              <td className="px-3 py-2.5 text-right text-slate-600">{fmt(s?.cpm, 2)}</td>
                              <td className="px-3 py-2.5 text-right text-slate-600">{fmt(s?.cpc, 2)}</td>
                              <td className="px-3 py-2.5 text-right text-slate-600">{fmt(s?.basket)}</td>
                              <td className="px-3 py-2.5 text-right text-slate-600">{fmt(s?.orders)}</td>
                              <td className="px-3 py-2.5 text-right text-slate-600">{fmt(s?.sum, 2)}</td>
                            </tr>
                          )
                        })}

                        {filteredClusters.length === 0 && (
                          <tr><td colSpan={12} className="py-10 text-center text-sm text-slate-400">Нет кластеров</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Минус-фразы */}
                <div className="rounded-2xl border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => setMinusOpen(v => !v)}
                    className="flex w-full items-center justify-between px-4 py-3"
                  >
                    <span className="text-sm font-semibold text-slate-800">
                      Минус-фразы
                      {minus.length > 0 && (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{minus.length}</span>
                      )}
                    </span>
                    <svg viewBox="0 0 24 24" className={`h-4 w-4 text-slate-400 transition-transform ${minusOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>

                  {minusOpen && (
                    <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
                      <p className="text-xs text-slate-500">Фразы, по которым реклама не будет показываться. Вводите через запятую.</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="женский, детский, ..."
                          value={minusInput}
                          onChange={e => setMinusInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void addMinus() }}
                          className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          disabled={minusLoading || !minusInput.trim()}
                          onClick={() => void addMinus()}
                          className="rounded-xl bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Добавить
                        </button>
                      </div>
                      {minus.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {minus.map(m => (
                            <span key={m} className="flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs text-rose-700">
                              {m}
                              <button type="button" onClick={() => void removeMinus(m)} className="ml-0.5 text-rose-400 hover:text-rose-600">✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

      </div>

      {/* ── Нижний бар выбора кампаний (как у WB) ────────────────────────── */}
      {selectedCampaigns.size > 0 && !activeCampaign && (
        <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-3 flex items-center gap-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <span className="text-sm text-slate-600 mr-2">
            Выбрано <strong>{selectedCampaigns.size}</strong> {selectedCampaigns.size === 1 ? 'кампанию' : selectedCampaigns.size < 5 ? 'кампании' : 'кампаний'}
          </span>
          <div className="relative" ref={bulkCampaignRef}>
            <button
              type="button"
              onClick={() => setBulkCampaignOpen(v => !v)}
              className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition"
            >
              Другие действия
              <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${bulkCampaignOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {bulkCampaignOpen && (
              <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[200px] rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => void bulkToggleCampaigns('start')}
                  disabled={actionLoading === 'bulk_campaigns'}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-500" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                  Запустить {selectedCampaigns.size} {selectedCampaigns.size < 5 ? 'кампании' : 'кампаний'}
                </button>
                <button
                  type="button"
                  onClick={() => void bulkToggleCampaigns('pause')}
                  disabled={actionLoading === 'bulk_campaigns'}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-400" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  Приостановить {selectedCampaigns.size} {selectedCampaigns.size < 5 ? 'кампании' : 'кампаний'}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSelectedCampaigns(new Set())}
            className="ml-auto text-xs text-slate-400 hover:text-slate-600"
          >
            Отменить выбор
          </button>
        </div>
      )}
    </div>
  )
}

// ── BidInput — инлайн редактирование ставки ────────────────────────────────

interface BidInputProps {
  value?: number
  borderColor: string
  onSave: (bid: number) => void
}

const BidInput = ({ value, borderColor, onSave }: BidInputProps) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value ?? ''))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(String(value ?? '')) }, [value])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const commit = () => {
    const n = parseInt(draft, 10)
    if (!isNaN(n) && n > 0 && n !== value) onSave(n)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`inline-flex items-center gap-1 rounded-lg border-b-2 ${borderColor} bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition`}
      >
        {value != null ? `${value} у.е.` : <span className="text-slate-400">базовая</span>}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      type="number"
      min={1}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      className={`w-20 rounded-lg border-b-2 ${borderColor} bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 focus:outline-none`}
    />
  )
}
