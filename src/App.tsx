import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AccountFormModal } from './components/accounts/AccountFormModal'
import { DeleteAccountModal } from './components/accounts/DeleteAccountModal'
import { ProfileModal } from './components/accounts/ProfileModal'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { TripFormModal } from './components/trips/TripFormModal'
import { ShipmentFormModal } from './components/shipments/ShipmentFormModal'
import { StoreFormModal } from './components/stores/StoreFormModal'
import { Button } from './components/ui/Button'
import { Input } from './components/ui/Input'
import { Modal } from './components/ui/Modal'
import { ToastContainer } from './components/ui/Toast'
import { useAccounts } from './hooks/useAccounts'
import { useAppData } from './hooks/useAppData'
import { useAuth } from './hooks/useAuth'
import { useMyPermissions } from './hooks/useMyPermissions'
import { useRoles } from './hooks/useRoles'
import { usePlatformRole } from './hooks/usePlatformRole'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { getLogoUrl, convertToWebP } from './lib/companyLogo'
import { canWrite, getBillingStatus, trialDaysLeft, graceDaysLeft, canAccessPage, PLAN_PAGE_LABELS } from './lib/plans'
import type { ActiveOverride } from './lib/plans'
import { activateGracePeriod } from './services/billingService'
import { getActiveOverride } from './services/accessOverrideService'
import { AuthPage } from './pages/AuthPage'
import { HomePage } from './pages/HomePage'
import { FulfillmentPage } from './pages/FulfillmentPage'
import { ProductsPage } from './pages/ProductsPage'
import { RolesPage } from './pages/RolesPage'
import { ShipmentsPage } from './pages/ShipmentsPage'
import { StoresPage } from './pages/StoresPage'
import { DirectoriesPage } from './pages/DirectoriesPage'
import { StickersPage } from './pages/StickersPage'
import { ReviewsPage } from './pages/ReviewsPage'
import { InvoicesPage } from './pages/InvoicesPage'
import { AdminPage } from './pages/AdminPage'
import type { AdminStats, AccountBillingRow as AdminAccountBillingRow } from './pages/AdminPage'
import { GlossaryPage } from './pages/GlossaryPage'
import { DiaryPage } from './pages/DiaryPage'
import { FinanceReportPage } from './pages/FinanceReportPage'
import { SubscriptionPage } from './pages/SubscriptionPage'
import { fetchNotifications, markAllNotificationsRead } from './services/outsourceService'
import type { Shipment, ShipmentWithStore } from './types'

/* ── PlanGatewall ─────────────────────────────────────────────────────────
 * Простая заставка когда страница недоступна по тарифу
 * -------------------------------------------------------------------------*/
const PlanGatewall = ({ page, onUpgrade }: { page: string; onUpgrade: () => void }) => {
  const info = PLAN_PAGE_LABELS[page] ?? { title: page, desc: '' }
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-24 text-center">
      <div className="max-w-sm rounded-3xl border border-blue-100 bg-blue-50 px-10 py-10">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-2xl">
          🔒
        </div>
        <h2 className="mb-2 text-lg font-black text-slate-800">{info.title}</h2>
        {info.desc && (
          <p className="mb-1 text-sm text-slate-500">{info.desc}</p>
        )}
        <p className="mb-6 text-sm text-slate-500">
          Доступно в тарифе <strong>«Операционный»</strong>.
        </p>
        <button
          type="button"
          onClick={onUpgrade}
          className="rounded-xl bg-blue-500 px-6 py-2 text-sm font-semibold text-white transition hover:bg-blue-600"
        >
          Посмотреть тарифы
        </button>
      </div>
    </div>
  )
}

type PageKey = 'home' | 'fulfillment' | 'shipments' | 'stores' | 'directories' | 'products' | 'reviews' | 'invoices' | 'roles' | 'stickers' | 'admin' | 'glossary' | 'diary' | 'finance_report' | 'subscription'

const PAGE_ROUTES: Record<PageKey, string> = {
  home: '/',
  fulfillment: '/fulfillment',
  shipments: '/shipments',
  stores: '/stores',
  directories: '/directories',
  products: '/products',
  reviews: '/reviews',
  invoices: '/invoices',
  roles: '/roles',
  stickers: '/stickers',
  admin: '/admin',
  glossary: '/glossary',
  diary: '/diary',
  finance_report: '/finance-report',
  subscription: '/subscription',
}

const ROUTE_PAGES: Record<string, PageKey> = Object.fromEntries(
  Object.entries(PAGE_ROUTES).map(([k, v]) => [v, k as PageKey])
)

const ACTIVE_PAGE_STORAGE_KEY = 'elestet-active-page'
const ACTIVE_ACCOUNT_STORAGE_KEY = 'elestet-active-account-id'
const ACTIVE_STORE_ID_STORAGE_KEY = 'elestet-active-store-id'

const toRawShipments = (shipments: ShipmentWithStore[]): Shipment[] =>
  shipments.map(({ store, ...shipment }) => shipment)

interface EditAccountModalProps {
  open: boolean
  account: import('./types').Account | null
  onClose: () => void
  onSubmit: (name: string, logoUrl?: string | null) => Promise<void>
}

const EditAccountModal = ({ open, account, onClose, onSubmit }: EditAccountModalProps) => {
  const [name, setName] = useState(account?.name ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [logoAction, setLogoAction] = useState<'keep' | 'upload' | 'remove'>('keep')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName(account?.name ?? '')
      setError(null)
      setLogoAction('keep')
      setLogoFile(null)
      setLogoPreview(null)
    }
  }, [open, account])

  const currentLogoUrl = account ? getLogoUrl(account) : null
  const displayLogo = logoAction === 'upload' ? logoPreview : logoAction === 'remove' ? null : currentLogoUrl
  const initial = (account?.name?.charAt(0) ?? '?').toUpperCase()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setError('Файл слишком большой. Максимум 2 МБ.'); return }
    if (logoPreview) URL.revokeObjectURL(logoPreview)
    setLogoFile(file)
    setLogoAction('upload')
    setLogoPreview(URL.createObjectURL(file))
    setError(null)
  }

  const handleRemoveLogo = () => {
    setLogoAction('remove')
    setLogoFile(null)
    if (logoPreview) URL.revokeObjectURL(logoPreview)
    setLogoPreview(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Введите название'); return }
    setIsSubmitting(true)
    setError(null)
    try {
      let logoUrl: string | null | undefined = undefined
      if (logoAction === 'remove') {
        logoUrl = null
      } else if (logoAction === 'upload' && logoFile && account && supabase) {
        const isSvg = logoFile.type === 'image/svg+xml'
        let uploadBlob: Blob
        let fileName: string
        let contentType: string
        if (isSvg) {
          uploadBlob = logoFile
          fileName = 'logo.svg'
          contentType = 'image/svg+xml'
        } else {
          uploadBlob = await convertToWebP(logoFile)
          fileName = 'logo.webp'
          contentType = 'image/webp'
        }
        const path = `${account.id}/${fileName}`
        const { error: uploadError } = await supabase.storage
          .from('company-logos')
          .upload(path, uploadBlob, { upsert: true, contentType })
        if (uploadError) throw uploadError
        const { data } = supabase.storage.from('company-logos').getPublicUrl(path)
        logoUrl = data.publicUrl
      }
      await onSubmit(name.trim(), logoUrl)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Редактировать компанию">
      <form className="grid gap-4" onSubmit={(e) => void handleSubmit(e)}>
        {/* Логотип */}
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">Логотип компании</p>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-violet-100">
              {displayLogo ? (
                <img src={displayLogo} alt="logo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-violet-600">{initial}</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-blue-50 hover:text-blue-600"
              >
                {displayLogo ? 'Изменить' : 'Загрузить'}
              </button>
              {displayLogo && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  Удалить
                </button>
              )}
              <p className="text-[11px] text-slate-400">PNG, JPG, WebP, SVG · макс. 2 МБ</p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <Input
          label="Название компании"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>Отмена</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Сохранение...' : 'Сохранить'}</Button>
        </div>
      </form>
    </Modal>
  )
}

const pageTitles: Record<PageKey, string> = {
  home: 'Главная',
  fulfillment: 'Фулфилмент',
  shipments: 'Логистика',
  stores: 'Магазины',
  directories: 'Справочники',
  products: 'Товары',
  stickers: 'Стикеры и КИЗы',
  reviews: 'Отзывы',
  invoices: 'Счета',
  roles: 'Роли',
  admin: 'Администратор',
  glossary: 'Словарь',
  diary: 'Дневник ELESTET',
  finance_report: 'Фин-отчет',
  subscription: 'Подписка',
}

function App() {
  const { session, isLoading: isAuthLoading, signIn, signOut, signUp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Разбираем URL вида /fulfillment/C-{n}/P-{m} при первом рендере
  const parsedFulfillmentUrl = (() => {
    const m = location.pathname.match(/^\/fulfillment\/C-(\d+)\/P-(\d+)$/)
    if (!m) return null
    return { accountShortId: parseInt(m[1], 10), batchShortId: parseInt(m[2], 10) }
  })()
  // Разбираем URL вида /invoices/C-{n}/I-{m} при первом рендере
  const parsedInvoiceUrl = (() => {
    const m = location.pathname.match(/^\/invoices\/C-(\d+)\/I-(\d+)$/)
    if (!m) return null
    return { accountShortId: parseInt(m[1], 10), invoiceShortId: parseInt(m[2], 10) }
  })()

  const [activePage, setActivePage] = useState<PageKey>(() => {
    // Приоритет: URL > localStorage > 'home'
    const fromUrl = ROUTE_PAGES[location.pathname]
    if (fromUrl) return fromUrl
    if (location.pathname.startsWith('/fulfillment/')) return 'fulfillment'
    if (location.pathname.startsWith('/invoices/')) return 'invoices'
    const storedPage = window.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY)
    if (storedPage && storedPage in PAGE_ROUTES) return storedPage as PageKey
    return 'home'
  })
  // short_id партии из URL — для авто-открытия модалки
  const [initialBatchShortId, setInitialBatchShortId] = useState<number | null>(
    () => parsedFulfillmentUrl?.batchShortId ?? null
  )
  // short_id компании из URL — для переключения аккаунта
  const [pendingAccountShortId] = useState<number | null>(
    () => parsedFulfillmentUrl?.accountShortId ?? null
  )
  // short_id счёта из URL — для авто-открытия модалки счёта
  const [initialInvoiceShortId, setInitialInvoiceShortId] = useState<number | null>(
    () => parsedInvoiceUrl?.invoiceShortId ?? null
  )
  const [pendingInvoiceAccountShortId] = useState<number | null>(
    () => parsedInvoiceUrl?.accountShortId ?? null
  )
  const [activeAccountId, setActiveAccountId] = useState<string | null>(() => {
    return window.localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY)
  })
  const [activeStoreId, setActiveStoreId] = useState<string>(
    () => window.localStorage.getItem(ACTIVE_STORE_ID_STORAGE_KEY) ?? ''
  )
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [pendingDeleteAccountId, setPendingDeleteAccountId] = useState<string | null>(null)
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('')
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null)
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false)
  const [tripModalOpen, setTripModalOpen] = useState(false)
  const [storeModalOpen, setStoreModalOpen] = useState(false)
  const [editingStore, setEditingStore] = useState<import('./types').Store | null>(null)
  const [editingAccount, setEditingAccount] = useState<import('./types').Account | null>(null)
  const [editAccountModalOpen, setEditAccountModalOpen] = useState(false)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [unreadNotifCount, setUnreadNotifCount] = useState(0)
  const [profileUserName, setProfileUserName] = useState<string>(
    (session?.user?.user_metadata?.full_name as string) ?? ''
  )
  useEffect(() => {
    setProfileUserName((session?.user?.user_metadata?.full_name as string) ?? '')
  }, [session?.user?.id])
  const { accounts, archivedAccounts, isLoading: isAccountsLoading, hasFetched: hasAccountsFetched, createAccount, deleteAccount, restoreAccount, updateAccount, reload: reloadAccounts } = useAccounts(Boolean(session))
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null
  const { roles, isLoading: isRolesLoading, addRole, updateRole, removeRole, cloneRoleToAccount } = useRoles(activeAccount?.id ?? null)
  const { permissions, isLoading: isPermissionsLoading, isOwnerOrAdmin } = useMyPermissions(activeAccount?.id ?? null, session?.user?.id ?? null, activeAccount?.my_role)
  const [activeOverride, setActiveOverride] = useState<ActiveOverride | null>(null)

  const fetchOverride = useCallback(() => {
    if (!activeAccount?.id) { setActiveOverride(null); return }
    void getActiveOverride(activeAccount.id).then(setActiveOverride)
  }, [activeAccount?.id])

  // Первая загрузка при смене аккаунта
  useEffect(() => { fetchOverride() }, [fetchOverride])

  // Поллинг каждую минуту — override аптейтся автоматически
  useEffect(() => {
    if (!activeAccount?.id) return
    const id = setInterval(fetchOverride, 60_000)
    return () => clearInterval(id)
  }, [activeAccount?.id, fetchOverride])

  // Обновление при возврате на вкладку
  useEffect(() => {
    const handler = () => { if (!document.hidden) fetchOverride() }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [fetchOverride])

  const { platformRole, isSuperAdmin, isAdmin, isSupport } = usePlatformRole(session?.user?.id)

  // Кэш данных AdminPage между переходами на другие страницы
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null)
  const [adminAccounts, setAdminAccounts] = useState<AdminAccountBillingRow[] | null>(null)

  // Суперадмин / админ / саппорт — вечный operational override (биллинг не мешает)
  const effectiveOverride: ActiveOverride | null = isSupport
    ? { type: 'plan', plan: 'operational', free_until: '2099-12-31' }
    : activeOverride

  const isReadOnly = activeAccount ? !canWrite(activeAccount, effectiveOverride) : false
  const isPageGated = (page: string) => activeAccount ? !canAccessPage(page, activeAccount, effectiveOverride) : false

  useEffect(() => {
    if (!isAccountsLoading && accounts.length > 0) {
      const found = accounts.find((a) => a.id === activeAccountId)
      if (!found) {
        // Fallback: prefer oldest (primary) account
        const oldest = [...accounts].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )[0]
        setActiveAccountId(oldest.id)
      }
    }
  }, [accounts, isAccountsLoading])

  // Auto-create "Основная компания" if user has no companies yet.
  // Guard: hasFetched ensures we only fire AFTER a real Supabase response,
  // not during the transient render where isLoading is stale-false and accounts=[]
  // that occurs between session loading and useAccounts re-initializing.
  const autoCreatingCompanyRef = useRef(false)
  useEffect(() => {
    if (hasAccountsFetched && session && accounts.length === 0 && !autoCreatingCompanyRef.current) {
      autoCreatingCompanyRef.current = true
      void createAccount('Основная компания').then((account) => {
        setActiveAccountId(account.id)
      })
    }
  }, [hasAccountsFetched, session, accounts.length])

  const {
    shipments,
    stores,
    archivedStores,
    trips,
    archivedTripLines,
    carriers,
    warehouses,
    stickers,
    addShipment,
    addStore,
    appendStore,
    updateStore,
    removeStore,
    restoreStore,
    addTrip,
    appendTrip,
    addTripLine,
    addInvoicePhoto,
    replaceInvoicePhoto,
    removeInvoicePhoto,
    addStickerFile,
    removeStickerFile,
    addCombinedStickerFile,
    removeCombinedStickerFile,
    uploadWbPass,
    removeWbPass,
    saveWbSupplyId,
    fetchWbBarcodes,
    refreshCargoType,
    saveMarketplaceDate,
    refreshMarketplaceDate,
    downloadWbExcel,
    removeTrip,
    removeTripLine,
    restoreArchivedTripLine,
    changeTripStatus,
    changeTripLineStatus,
    changeTripLinePaymentStatus,
    editTrip,
    editTripLine,
    bulkMoveLinesToTrip,
    updateTripCustomFields,
    updateLineCustomFields,
    refreshTrips,
    addCarrier,
    removeCarrier,
    renameCarrier,
    updateCarrier,
    addWarehouse,
    removeWarehouse,
    renameWarehouse,
    addSticker,
    editSticker,
    removeSticker,
    bundles,
    addBundle,
    editBundle,
    removeBundle,
    isUsingSupabase,
    isLoading,
    error,
  } = useAppData(activeAccount?.id ?? null)

  const carrierNames = carriers.map((c) => c.name)
  const warehouseNames = warehouses.map((w) => w.name)

  // Карта: страница → ключ разрешения (null = всегда доступна)
  const pagePermKey: Record<PageKey, keyof typeof permissions | null> = {
    home: null,
    fulfillment: 'fulfillment_view',
    shipments: 'shipments_view',
    stores: 'stores_view',
    products: 'stores_view',
    directories: 'directories_view',
    stickers: 'stickers_view',
    reviews: 'reviews_view',
    invoices: null,
    roles: 'roles_manage',
    admin: null,
    glossary: null,
    diary: null,
    finance_report: null,
    subscription: null,
  }

  // Если текущая страница недоступна по правам — показываем home.
  // Используем вычисляемое значение (не useEffect), чтобы избежать race condition:
  // useEffect читает stale state из той же фазы рендера и не видит обновлений permissions.
  const effectivePage: PageKey = (() => {
    if (isAccountsLoading || isPermissionsLoading) return activePage
    if ((activePage === 'admin' || activePage === 'glossary') && !isSupport) return 'home'
    if ((activePage === 'diary' || activePage === 'finance_report') && !isSupport) return 'home'
    const key = pagePermKey[activePage]
    if (key !== null && !permissions[key]) return 'home'
    return activePage
  })()

  // Перезагружать trips каждый раз при открытии страницы Логистики
  useEffect(() => {
    if (effectivePage === 'shipments') void refreshTrips()
  }, [effectivePage])

  // Загрузка счётчика непрочитанных уведомлений
  useEffect(() => {
    if (!activeAccount?.id) return
    void fetchNotifications(activeAccount.id).then((notifs) => {
      setUnreadNotifCount(notifs.filter((n) => !n.is_read).length)
    })
  }, [activeAccount?.id])

  const storesWithApiKey = useMemo(() => stores.filter((s) => s.api_key), [stores])

  useEffect(() => {
    if (!activeStoreId && storesWithApiKey.length > 0) {
      setActiveStoreId(storesWithApiKey[0].id)
    }
  }, [storesWithApiKey, activeStoreId])

  useEffect(() => {
    if (activeStoreId) {
      window.localStorage.setItem(ACTIVE_STORE_ID_STORAGE_KEY, activeStoreId)
    } else {
      window.localStorage.removeItem(ACTIVE_STORE_ID_STORAGE_KEY)
    }
  }, [activeStoreId])

  const rawShipments = useMemo(() => toRawShipments(shipments), [shipments])

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, activePage)
    const route = PAGE_ROUTES[activePage]
    // Не сбрасываем URL партии если уже на /fulfillment/*
    if (activePage === 'fulfillment' && location.pathname.startsWith('/fulfillment/')) return
    // Не сбрасываем URL счёта если уже на /invoices/*
    if (activePage === 'invoices' && location.pathname.startsWith('/invoices/')) return
    if (location.pathname !== route) {
      navigate(route, { replace: false })
    }
  }, [activePage])

  // Синхронизация URL → activePage (кнопка "назад" / прямой переход по ссылке)
  useEffect(() => {
    const pageFromUrl = ROUTE_PAGES[location.pathname]
    if (pageFromUrl && pageFromUrl !== activePage) {
      setActivePage(pageFromUrl)
    } else if (!pageFromUrl && location.pathname.startsWith('/fulfillment/') && activePage !== 'fulfillment') {
      setActivePage('fulfillment')
    } else if (!pageFromUrl && location.pathname.startsWith('/invoices/') && activePage !== 'invoices') {
      setActivePage('invoices')
    }
  }, [location.pathname])

  // Переключаемся на компанию из URL (после загрузки списка компаний)
  useEffect(() => {
    if (!pendingAccountShortId || accounts.length === 0) return
    const target = accounts.find((a) => a.short_id === pendingAccountShortId)
    if (target) setActiveAccountId(target.id)
  }, [accounts, pendingAccountShortId])

  useEffect(() => {
    if (!pendingInvoiceAccountShortId || accounts.length === 0) return
    const target = accounts.find((a) => a.short_id === pendingInvoiceAccountShortId)
    if (target) setActiveAccountId(target.id)
  }, [accounts, pendingInvoiceAccountShortId])

  useEffect(() => {
    if (activeAccountId) {
      window.localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, activeAccountId)
    } else {
      window.localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY)
    }
  }, [activeAccountId])

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Загрузка...
      </div>
    )
  }

  if (!session) {
    return <AuthPage isSupabaseConfigured={isSupabaseConfigured} onSignIn={signIn} onSignUp={signUp} />
  }

  if (isAccountsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Загрузка компании...
      </div>
    )
  }

  const handleCreateAccount = async (name: string) => {
    const account = await createAccount(name)
    setActiveAccountId(account.id)
    return account
  }

  const pendingDeleteAccount = accounts.find((a) => a.id === pendingDeleteAccountId) ?? null

  const handleDeleteCompany = (id: string) => {
    setPendingDeleteAccountId(id)
    setDeleteAccountModalOpen(true)
  }

  const handleConfirmDeleteActiveCompany = async () => {
    if (!pendingDeleteAccountId || !supabase) return
    setIsDeletingAccount(true)
    setDeleteAccountError(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const email = userData.user?.email
      if (!email) throw new Error('Не удалось определить пользователя')
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password: deleteAccountPassword })
      if (authError) throw new Error('Неверный пароль')

      // If deleting the active company — switch to another BEFORE deletion
      // to avoid a frame where activeAccount === null (which clears all data)
      if (activeAccountId === pendingDeleteAccountId) {
        const remaining = accounts.filter((a) => a.id !== pendingDeleteAccountId)
        if (remaining.length > 0) {
          const oldest = [...remaining].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          )[0]
          setActiveAccountId(oldest.id)
        }
      }

      await deleteAccount(pendingDeleteAccountId)
      setPendingDeleteAccountId(null)
      setDeleteAccountPassword('')
      setDeleteAccountError(null)
      setDeleteAccountModalOpen(false)
    } catch (err) {
      setDeleteAccountError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setIsDeletingAccount(false)
    }
  }

  const handleOpenShipmentCreate = () => {
    if (!activeAccount) {
      setAccountModalOpen(true)
      return
    }
    setShipmentModalOpen(true)
  }

  const handleOpenTripCreate = () => {
    if (!activeAccount) {
      setAccountModalOpen(true)
      return
    }
    setTripModalOpen(true)
  }

  const handleOpenStoreCreate = () => {
    if (!activeAccount) {
      setAccountModalOpen(true)
      return
    }

    setEditingStore(null)
    setStoreModalOpen(true)
  }

  const handleOpenStoreEdit = (store: import('./types').Store) => {
    setEditingStore(store)
    setStoreModalOpen(true)
  }

  const handleSyncStore = async (store: import('./types').Store) => {
    if (!store.api_key) return
    const resp = await fetch('https://common-api.wildberries.ru/api/v1/seller-info', {
      headers: { Authorization: store.api_key },
    })
    if (!resp.ok) {
      if (resp.status === 429) throw new Error('Много запросов')
      throw new Error(`Ошибка WB API: ${resp.status} ${resp.statusText}`)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await resp.json() as any
    // data.tradeMark = название магазина, data.name = краткое наименование поставщика (ИП / ООО и т.п.)
    const tradeName = (data.tradeMark ?? '').trim()
    const shortLegalName = (data.name ?? '').trim()
    await updateStore(store.id, {
      name: tradeName || store.name,
      marketplace: store.marketplace,
      store_code: store.store_code,
      supplier: shortLegalName || store.supplier || '',
      supplier_full: store.supplier_full ?? undefined,
      address: store.address ?? '',
      inn: (data.tin ?? store.inn ?? '').trim(),
      phone: store.phone ?? '',
    })
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-50 text-slate-900">
      <ToastContainer />
      <div className="flex h-full">
        {effectivePage !== 'admin' && effectivePage !== 'glossary' && effectivePage !== 'diary' && effectivePage !== 'finance_report' && (
          <Sidebar
            activePage={effectivePage}
            onSelectPage={setActivePage}
            onOpenAddCompany={() => setAccountModalOpen(true)}
            onSignOut={() => void signOut()}
            accounts={accounts}
            activeAccount={activeAccount}
            onSelectAccount={setActiveAccountId}
            onDeleteActiveCompany={handleDeleteCompany}
            onEditCompany={(account) => { setEditingAccount(account); setEditAccountModalOpen(true) }}
            onRestoreAccount={restoreAccount}
            archivedAccounts={archivedAccounts}
            permissions={permissions}
            isAdmin={isSupport}
          />
        )}

        <main className="flex flex-1 flex-col overflow-hidden">
          <Topbar
            title={pageTitles[effectivePage]}
            userName={profileUserName}
            userEmail={session?.user?.email ?? ''}
            isAdmin={isSupport}
            unreadCount={unreadNotifCount}
            onNotificationClick={undefined}
            onAdminClick={() => setActivePage('admin')}
            onGlossaryClick={() => setActivePage('glossary')}
            onDiaryClick={isAdmin ? () => setActivePage('diary') : undefined}
            onFinanceReportClick={isAdmin ? () => setActivePage('finance_report') : undefined}
            onHomeClick={['admin', 'glossary', 'diary', 'finance_report'].includes(effectivePage) ? () => setActivePage('home') : undefined}
            onProfileClick={() => setProfileModalOpen(true)}
            onSignOut={() => void signOut()}
          />

          {/* ── Billing баннер — только для owner компании ── */}
          {activeAccount && activeAccount.my_role === 'owner' && (() => {
            const status = getBillingStatus(activeAccount, effectiveOverride)
            if (status === 'active') return null
            if (status === 'trial') {
              const days = trialDaysLeft(activeAccount, effectiveOverride)
              if (days > 3) return null // не мешаем пока далеко
              return (
                <div className="flex items-center justify-between gap-3 bg-amber-50 px-4 py-2.5 text-xs border-b border-amber-100">
                  <span className="text-amber-800">
                    ⏳ Пробный период истекает через <strong>{days} {days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setActivePage('subscription' as PageKey)}
                    className="rounded-lg bg-amber-500 px-3 py-1 font-semibold text-white transition hover:bg-amber-600"
                  >
                    Выбрать тариф
                  </button>
                </div>
              )
            }
            if (status === 'grace') {
              const days = graceDaysLeft(activeAccount)
              return (
                <div className="flex items-center justify-between gap-3 bg-orange-50 px-4 py-2.5 text-xs border-b border-orange-100">
                  <span className="text-orange-800">
                    ⚠️ Режим продления. Осталось <strong>{days} {days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}</strong>. Оплатите подписку.
                  </span>
                  <button
                    type="button"
                    onClick={() => setActivePage('subscription' as PageKey)}
                    className="rounded-lg bg-orange-500 px-3 py-1 font-semibold text-white transition hover:bg-orange-600"
                  >
                    Оплатить
                  </button>
                </div>
              )
            }
            // expired
            return (
              <div className="flex items-center justify-between gap-3 bg-rose-50 px-4 py-2.5 text-xs border-b border-rose-100">
                <span className="text-rose-800">
                  🔒 Пробный период истёк. Создание и редактирование заблокированы. Данные сохранены.
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void activateGracePeriod(activeAccount.id).then(() => void reloadAccounts())}
                    className="rounded-lg bg-rose-100 px-3 py-1 font-semibold text-rose-700 transition hover:bg-rose-200"
                  >
                    +3 дня в долг
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePage('subscription' as PageKey)}
                    className="rounded-lg bg-rose-500 px-3 py-1 font-semibold text-white transition hover:bg-rose-600"
                  >
                    Оплатить
                  </button>
                </div>
              </div>
            )
          })()}

          <div className="flex-1 overflow-y-scroll p-3 lg:p-4">
            {!isLoading && !error ? (
              effectivePage === 'home' ? (
                <HomePage shipments={shipments} rawShipments={rawShipments} stores={stores} hasAccount={accounts.length > 0} onCreateCompany={() => setAccountModalOpen(true)} />
              ) : effectivePage === 'fulfillment' ? (
                isPageGated('fulfillment') ? (
                  <PlanGatewall page="fulfillment" onUpgrade={() => setActivePage('subscription')} />
                ) : (
                <FulfillmentPage
                  accountId={activeAccount?.id ?? ''}
                  accountShortId={activeAccount?.short_id ?? null}
                  stores={stores}
                  trips={trips}
                  warehouses={warehouses}
                  onEditTripLine={editTripLine}
                  onAddTripLine={addTripLine}
                  onTripCreated={appendTrip}
                  onStoreCreated={appendStore}
                  canManage={(isOwnerOrAdmin || permissions.fulfillment_manage) && !isReadOnly}
                  canOtkAssign={(isOwnerOrAdmin || permissions.fulfillment_otk_assign) && !isReadOnly}
                  canStageJump={(isOwnerOrAdmin || permissions.fulfillment_stage_jump) && !isReadOnly}
                  canPackingAutoAdd={(isOwnerOrAdmin || permissions.fulfillment_packing_autoadd) && !isReadOnly}
                  canSupplyDeleteLocked={(isOwnerOrAdmin || permissions.fulfillment_supply_delete_locked) && !isReadOnly}
                  userId={session?.user?.id ?? ''}
                  userEmail={session?.user?.email ?? ''}
                  userName={profileUserName || (session?.user?.email ?? '')}
                  accountName={activeAccount?.name ?? ''}
                  initialBatchShortId={initialBatchShortId}
                  onBatchUrlConsumed={() => setInitialBatchShortId(null)}
                />
                )
              ) : effectivePage === 'shipments' ? (
                isPageGated('shipments') ? (
                  <PlanGatewall page="shipments" onUpgrade={() => setActivePage('subscription')} />
                ) : (
                <ShipmentsPage
                  trips={trips}
                  archivedTripLines={archivedTripLines}
                  stores={stores}
                  carrierNames={carrierNames}
                  warehouseNames={warehouseNames}
                  onOpenCreate={handleOpenTripCreate}
                  onDeleteTrip={removeTrip}
                  onDeleteTripLine={removeTripLine}
                  onRestoreArchivedTripLine={restoreArchivedTripLine}
                  onChangeTripStatus={changeTripStatus}
                  onChangeTripLineStatus={changeTripLineStatus}
                  onChangeTripLinePaymentStatus={changeTripLinePaymentStatus}
                  onEditTrip={editTrip}
                  onEditTripLine={editTripLine}
                  onAddTripLine={addTripLine}
                  onAddInvoicePhoto={addInvoicePhoto}
                  onReplaceInvoicePhoto={replaceInvoicePhoto}
                  onRemoveInvoicePhoto={removeInvoicePhoto}
                  onAddStickerFile={addStickerFile}
                  onRemoveStickerFile={removeStickerFile}
                  onAddCombinedStickerFile={addCombinedStickerFile}
                  onRemoveCombinedStickerFile={removeCombinedStickerFile}
                  onFetchWbBarcodes={fetchWbBarcodes}
                  onSaveWbSupplyId={saveWbSupplyId}
                  onRefreshCargoType={refreshCargoType}
                  onDownloadWbExcel={downloadWbExcel}
                  onSaveMarketplaceDate={saveMarketplaceDate}
                  onRefreshMarketplaceDate={refreshMarketplaceDate}
                  onUploadWbPass={uploadWbPass}
                  onRemoveWbPass={removeWbPass}
                  canManage={permissions.shipments_manage && !isReadOnly}
                  canDeleteAny={(isOwnerOrAdmin || permissions.shipments_delete_any) && !isReadOnly}
                  canDeleteTrip={(isOwnerOrAdmin || permissions.shipments_delete_trip) && !isReadOnly}
                  isOwnerOrAdmin={isOwnerOrAdmin}
                  accountId={activeAccount?.id ?? ''}
                  userId={session?.user?.id ?? ''}
                  onUpdateTripCustomFields={updateTripCustomFields}
                  onUpdateLineCustomFields={updateLineCustomFields}
                  onBulkMoveLinesToTrip={bulkMoveLinesToTrip}
                />
                )
              ) : effectivePage === 'stores' ? (
                <StoresPage stores={stores} archivedStores={archivedStores} onOpenCreate={handleOpenStoreCreate} onEdit={handleOpenStoreEdit} onDelete={removeStore} onSync={handleSyncStore} onRestore={restoreStore} canManage={permissions.stores_manage && !isReadOnly} canDelete={(isOwnerOrAdmin || permissions.stores_delete) && !isReadOnly} canSync={(permissions.stores_manage || isOwnerOrAdmin || permissions.stores_sync) && !isReadOnly} />
              ) : effectivePage === 'directories' ? (
                isPageGated('directories') ? (
                  <PlanGatewall page="directories" onUpgrade={() => setActivePage('subscription')} />
                ) : (
                <DirectoriesPage
                  carriers={carriers}
                  warehouses={warehouses}
                  accountId={activeAccount?.id ?? ''}
                  currentUserId={session?.user.id ?? ''}
                  onAddCarrier={addCarrier}
                  onDeleteCarrier={removeCarrier}
                  onRenameCarrier={renameCarrier}
                  onUpdateCarrier={updateCarrier}
                  onAddWarehouse={addWarehouse}
                  onDeleteWarehouse={removeWarehouse}
                  onRenameWarehouse={renameWarehouse}
                  canManage={permissions.directories_manage && !isReadOnly}
                  canDelete={(isOwnerOrAdmin || permissions.directories_delete) && !isReadOnly}
                  canManageTariffs={(isOwnerOrAdmin || permissions.directories_tariff_manage) && !isReadOnly}
                />
                )
              ) : effectivePage === 'products' ? (
                <ProductsPage stores={stores} activeAccountId={activeAccount?.id ?? ''} selectedStoreId={activeStoreId} onStoreChange={setActiveStoreId} />
              ) : effectivePage === 'roles' ? (
                <RolesPage
                  roles={roles}
                  accounts={accounts}
                  activeAccountId={activeAccount?.id ?? ''}
                  activeAccountShortId={activeAccount?.short_id ?? null}
                  isLoading={isRolesLoading}
                  onAdd={addRole}
                  onUpdate={updateRole}
                  onDelete={removeRole}
                  onClone={cloneRoleToAccount}
                  canManage={permissions.roles_manage && !isReadOnly}
                />
              ) : effectivePage === 'stickers' ? (
                <StickersPage
                  stickers={stickers}
                  bundles={bundles}
                  stores={stores}
                  selectedStoreId={activeStoreId}
                  onStoreChange={setActiveStoreId}
                  onAdd={addSticker}
                  onEdit={editSticker}
                  onDelete={removeSticker}
                  onAddBundle={addBundle}
                  onEditBundle={editBundle}
                  onDeleteBundle={removeBundle}
                  canManage={permissions.stickers_manage && !isReadOnly}
                  canDelete={(isOwnerOrAdmin || permissions.stickers_delete) && !isReadOnly}
                  canImport={(isOwnerOrAdmin || permissions.stickers_manage || permissions.stickers_import) && !isReadOnly}
                  isAdmin={isAdmin}
                />
              ) : effectivePage === 'reviews' ? (
                <ReviewsPage
                  stores={stores}
                  activeAccountId={activeAccount?.id ?? ''}
                  selectedStoreId={activeStoreId}
                  onStoreChange={setActiveStoreId}
                  canManage={(isOwnerOrAdmin || permissions.reviews_manage) && !isReadOnly}
                  canUseAi={(isOwnerOrAdmin || permissions.reviews_ai) && !isReadOnly}
                  canManageAutomation={(isOwnerOrAdmin || permissions.reviews_automation) && !isReadOnly}
                />
              ) : effectivePage === 'invoices' ? (
                isPageGated('invoices') ? (
                  <PlanGatewall page="invoices" onUpgrade={() => setActivePage('subscription')} />
                ) : (
                <InvoicesPage
                  accountId={activeAccount?.id ?? ''}
                  accountShortId={activeAccount?.short_id ?? null}
                  stores={stores}
                  initialInvoiceShortId={initialInvoiceShortId}
                  onInvoiceUrlConsumed={() => setInitialInvoiceShortId(null)}
                />
                )
              ) : effectivePage === 'admin' ? (
                <AdminPage
                  platformRole={platformRole}
                  initialStats={adminStats}
                  initialAccounts={adminAccounts}
                  onStatsLoaded={setAdminStats}
                  onAccountsLoaded={setAdminAccounts}
                />
              ) : effectivePage === 'glossary' ? (
                <GlossaryPage />
              ) : effectivePage === 'diary' ? (
                <DiaryPage
                  userId={session?.user?.id ?? ''}
                  userEmail={session?.user?.email ?? ''}
                  userName={profileUserName || (session?.user?.email ?? '')}
                />
              ) : effectivePage === 'finance_report' ? (
                <FinanceReportPage
                  accountId={activeAccount?.id ?? ''}
                  stores={stores}
                />
              ) : effectivePage === 'subscription' ? (
                <SubscriptionPage
                  activeAccount={activeAccount}
                  activeOverride={effectiveOverride}
                  onAccountRefresh={() => void reloadAccounts()}
                />
              ) : (
                <StoresPage stores={stores} archivedStores={archivedStores} onOpenCreate={handleOpenStoreCreate} onEdit={handleOpenStoreEdit} onDelete={removeStore} onSync={handleSyncStore} onRestore={restoreStore} canManage={permissions.stores_manage && !isReadOnly} canDelete={(isOwnerOrAdmin || permissions.stores_delete) && !isReadOnly} canSync={(permissions.stores_manage || isOwnerOrAdmin || permissions.stores_sync) && !isReadOnly} />
              )
            ) : null}
          </div>
        </main>
      </div>

      <TripFormModal
        open={tripModalOpen}
        onClose={() => setTripModalOpen(false)}
        onSubmit={addTrip}
        carrierNames={carrierNames}
      />

      <ShipmentFormModal
        open={shipmentModalOpen}
        stores={stores}
        onClose={() => setShipmentModalOpen(false)}
        onSubmit={addShipment}
      />

      <AccountFormModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        onSubmit={handleCreateAccount}
      />

      <DeleteAccountModal
        open={deleteAccountModalOpen}
        accountName={pendingDeleteAccount?.name ?? ''}
        isSubmitting={isDeletingAccount}
        error={deleteAccountError}
        password={deleteAccountPassword}
        onPasswordChange={setDeleteAccountPassword}
        onClose={() => {
          if (!isDeletingAccount) {
            setDeleteAccountModalOpen(false)
            setDeleteAccountPassword('')
            setDeleteAccountError(null)
          }
        }}
        onConfirm={() => void handleConfirmDeleteActiveCompany()}
      />

      <StoreFormModal
        open={storeModalOpen}
        initialValues={editingStore ? { name: editingStore.name, marketplace: editingStore.marketplace, store_code: editingStore.store_code, supplier: editingStore.supplier ?? '', supplier_full: editingStore.supplier_full ?? '', address: editingStore.address ?? '', inn: editingStore.inn ?? '' } : undefined}
        hasApiKey={Boolean(editingStore?.api_key)}
        onClose={() => { setStoreModalOpen(false); setEditingStore(null) }}
        onSubmit={(values) => editingStore ? updateStore(editingStore.id, values) : addStore(values)}
      />

      <EditAccountModal
        open={editAccountModalOpen}
        account={editingAccount}
        onClose={() => { setEditAccountModalOpen(false); setEditingAccount(null) }}
        onSubmit={async (name, logoUrl) => { if (editingAccount) await updateAccount(editingAccount.id, name, logoUrl) }}
      />

      <ProfileModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        userEmail={session?.user?.email ?? ''}
        userName={profileUserName}
        userId={session?.user?.id ?? ''}
        onNameChange={(name) => setProfileUserName(name)}
      />
    </div>
  )
}

export default App
