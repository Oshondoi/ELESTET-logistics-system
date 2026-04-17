import { useEffect, useMemo, useState } from 'react'
import { AccountFormModal } from './components/accounts/AccountFormModal'
import { DeleteAccountModal } from './components/accounts/DeleteAccountModal'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { TripFormModal } from './components/trips/TripFormModal'
import { ShipmentFormModal } from './components/shipments/ShipmentFormModal'
import { StoreFormModal } from './components/stores/StoreFormModal'
import { useAccounts } from './hooks/useAccounts'
import { useAppData } from './hooks/useAppData'
import { useAuth } from './hooks/useAuth'
import { isSupabaseConfigured } from './lib/supabase'
import { AuthPage } from './pages/AuthPage'
import { HomePage } from './pages/HomePage'
import { FulfillmentPage } from './pages/FulfillmentPage'
import { RolesPage } from './pages/RolesPage'
import { ShipmentsPage } from './pages/ShipmentsPage'
import { StoresPage } from './pages/StoresPage'
import type { Shipment, ShipmentWithStore } from './types'

type PageKey = 'home' | 'fulfillment' | 'shipments' | 'stores' | 'products' | 'roles'
const ACTIVE_PAGE_STORAGE_KEY = 'elestet-active-page'
const ACTIVE_ACCOUNT_STORAGE_KEY = 'elestet-active-account-id'

const toRawShipments = (shipments: ShipmentWithStore[]): Shipment[] =>
  shipments.map(({ store, ...shipment }) => shipment)

const pageTitles: Record<PageKey, 'Главная' | 'Фулфилмент' | 'Логистика' | 'Магазины' | 'Товары' | 'Роли'> = {
  home: 'Главная',
  fulfillment: 'Фулфилмент',
  shipments: 'Логистика',
  stores: 'Магазины',
  products: 'Товары',
  roles: 'Роли',
}

function App() {
  const { session, isLoading: isAuthLoading, signIn, signOut, signUp } = useAuth()
  const [activePage, setActivePage] = useState<PageKey>(() => {
    const storedPage = window.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY)

    if (
      storedPage === 'home' ||
      storedPage === 'fulfillment' ||
      storedPage === 'shipments' ||
      storedPage === 'stores' ||
      storedPage === 'roles'
    ) {
      return storedPage
    }

    return 'home'
  })
  const [activeAccountId, setActiveAccountId] = useState<string | null>(() => {
    return window.localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY)
  })
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false)
  const [tripModalOpen, setTripModalOpen] = useState(false)
  const [storeModalOpen, setStoreModalOpen] = useState(false)
  const { accounts, isLoading: isAccountsLoading, createAccount, deleteAccount } = useAccounts(Boolean(session))
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null

  useEffect(() => {
    if (!isAccountsLoading && accounts.length > 0 && !activeAccountId) {
      setActiveAccountId(accounts[0].id)
    }
  }, [accounts, isAccountsLoading, activeAccountId])
  const {
    shipments,
    stores,
    trips,
    addShipment,
    addStore,
    addTrip,
    addTripLine,
    addInvoicePhoto,
    replaceInvoicePhoto,
    removeInvoicePhoto,
    removeTrip,
    removeTripLine,
    changeTripStatus,
    changeTripLineStatus,
    changeTripLinePaymentStatus,
    isUsingSupabase,
    isLoading,
    error,
  } = useAppData(activeAccount?.id ?? null)

  const rawShipments = useMemo(() => toRawShipments(shipments), [shipments])

  useEffect(() => {
    window.localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, activePage)
  }, [activePage])

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

  const handleDeleteActiveCompany = async () => {
    if (!activeAccount) {
      return
    }
    setDeleteAccountModalOpen(true)
  }

  const handleConfirmDeleteActiveCompany = async () => {
    if (!activeAccount) {
      return
    }

    setIsDeletingAccount(true)

    try {
      await deleteAccount(activeAccount.id)
      setActiveAccountId(null)
      setDeleteAccountModalOpen(false)
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

    setStoreModalOpen(true)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <Sidebar
          activePage={activePage}
          onSelectPage={setActivePage}
          onOpenAddCompany={() => setAccountModalOpen(true)}
          onSignOut={() => void signOut()}
          accounts={accounts}
          activeAccount={activeAccount}
          onSelectAccount={setActiveAccountId}
          onDeleteActiveCompany={() => void handleDeleteActiveCompany()}
        />

        <main className="flex flex-1 flex-col">
          <Topbar title={pageTitles[activePage]} />

          <div className="flex-1 p-3 lg:p-4">
            {!isLoading && !error ? (
              activePage === 'home' ? (
                <HomePage shipments={shipments} rawShipments={rawShipments} stores={stores} />
              ) : activePage === 'fulfillment' ? (
                <FulfillmentPage />
              ) : activePage === 'shipments' ? (
                <ShipmentsPage
                  trips={trips}
                  stores={stores}
                  onOpenCreate={handleOpenTripCreate}
                  onDeleteTrip={removeTrip}
                  onDeleteTripLine={removeTripLine}
                  onChangeTripStatus={changeTripStatus}
                  onChangeTripLineStatus={changeTripLineStatus}
                  onChangeTripLinePaymentStatus={changeTripLinePaymentStatus}
                  onAddTripLine={addTripLine}
                  onAddInvoicePhoto={addInvoicePhoto}
                  onReplaceInvoicePhoto={replaceInvoicePhoto}
                  onRemoveInvoicePhoto={removeInvoicePhoto}
                />
              ) : activePage === 'products' ? (
                <RolesPage />
              ) : activePage === 'roles' ? (
                <RolesPage />
              ) : (
                <StoresPage stores={stores} onOpenCreate={handleOpenStoreCreate} />
              )
            ) : null}
          </div>
        </main>
      </div>

      <TripFormModal
        open={tripModalOpen}
        onClose={() => setTripModalOpen(false)}
        onSubmit={addTrip}
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
        accountName={activeAccount?.name ?? ''}
        isSubmitting={isDeletingAccount}
        onClose={() => {
          if (!isDeletingAccount) {
            setDeleteAccountModalOpen(false)
          }
        }}
        onConfirm={() => void handleConfirmDeleteActiveCompany()}
      />

      <StoreFormModal
        open={storeModalOpen}
        onClose={() => setStoreModalOpen(false)}
        onSubmit={addStore}
      />
    </div>
  )
}

export default App
