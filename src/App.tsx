import { useEffect, useMemo, useState } from 'react'
import { AccountFormModal } from './components/accounts/AccountFormModal'
import { DeleteAccountModal } from './components/accounts/DeleteAccountModal'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { TripFormModal } from './components/trips/TripFormModal'
import { ShipmentFormModal } from './components/shipments/ShipmentFormModal'
import { StoreFormModal } from './components/stores/StoreFormModal'
import { Button } from './components/ui/Button'
import { Input } from './components/ui/Input'
import { Modal } from './components/ui/Modal'
import { useAccounts } from './hooks/useAccounts'
import { useAppData } from './hooks/useAppData'
import { useAuth } from './hooks/useAuth'
import { useRoles } from './hooks/useRoles'
import { isSupabaseConfigured } from './lib/supabase'
import { AuthPage } from './pages/AuthPage'
import { HomePage } from './pages/HomePage'
import { FulfillmentPage } from './pages/FulfillmentPage'
import { ProductsPage } from './pages/ProductsPage'
import { RolesPage } from './pages/RolesPage'
import { ShipmentsPage } from './pages/ShipmentsPage'
import { StoresPage } from './pages/StoresPage'
import { DirectoriesPage } from './pages/DirectoriesPage'
import { StickersPage } from './pages/StickersPage'
import type { Shipment, ShipmentWithStore } from './types'

type PageKey = 'home' | 'fulfillment' | 'shipments' | 'stores' | 'directories' | 'products' | 'roles' | 'stickers'
const ACTIVE_PAGE_STORAGE_KEY = 'elestet-active-page'
const ACTIVE_ACCOUNT_STORAGE_KEY = 'elestet-active-account-id'
const ACTIVE_STORE_ID_STORAGE_KEY = 'elestet-active-store-id'

const toRawShipments = (shipments: ShipmentWithStore[]): Shipment[] =>
  shipments.map(({ store, ...shipment }) => shipment)

interface EditAccountModalProps {
  open: boolean
  account: import('./types').Account | null
  onClose: () => void
  onSubmit: (name: string) => Promise<void>
}

const EditAccountModal = ({ open, account, onClose, onSubmit }: EditAccountModalProps) => {
  const [name, setName] = useState(account?.name ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setName(account?.name ?? ''); setError(null) }
  }, [open, account])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Введите название'); return }
    setIsSubmitting(true)
    setError(null)
    try {
      await onSubmit(name.trim())
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
  roles: 'Роли',
  stickers: 'Стикеры',
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
      storedPage === 'directories' ||
      storedPage === 'products' ||
      storedPage === 'roles' ||
      storedPage === 'stickers'
    ) {
      return storedPage
    }

    return 'home'
  })
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
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false)
  const [tripModalOpen, setTripModalOpen] = useState(false)
  const [storeModalOpen, setStoreModalOpen] = useState(false)
  const [editingStore, setEditingStore] = useState<import('./types').Store | null>(null)
  const [editingAccount, setEditingAccount] = useState<import('./types').Account | null>(null)
  const [editAccountModalOpen, setEditAccountModalOpen] = useState(false)
  const { accounts, isLoading: isAccountsLoading, createAccount, deleteAccount, updateAccount } = useAccounts(Boolean(session))
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null
  const { roles, isLoading: isRolesLoading, addRole, updateRole, removeRole, cloneRoleToAccount } = useRoles(activeAccount?.id ?? null)

  useEffect(() => {
    if (!isAccountsLoading && accounts.length > 0 && !activeAccountId) {
      setActiveAccountId(accounts[0].id)
    }
  }, [accounts, isAccountsLoading, activeAccountId])

  const {
    shipments,
    stores,
    trips,
    carriers,
    warehouses,
    stickers,
    addShipment,
    addStore,
    updateStore,
    removeStore,
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
    editTrip,
    editTripLine,
    addCarrier,
    removeCarrier,
    renameCarrier,
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

  const pendingDeleteAccount = accounts.find((a) => a.id === pendingDeleteAccountId) ?? null

  const handleDeleteCompany = (id: string) => {
    setPendingDeleteAccountId(id)
    setDeleteAccountModalOpen(true)
  }

  const handleConfirmDeleteActiveCompany = async () => {
    if (!pendingDeleteAccountId) return
    setIsDeletingAccount(true)
    try {
      await deleteAccount(pendingDeleteAccountId)
      if (activeAccountId === pendingDeleteAccountId) setActiveAccountId(null)
      setPendingDeleteAccountId(null)
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
    // API возвращает только: name, sid, tin, tradeMark — адреса нет
    await updateStore(store.id, {
      name: store.name,
      marketplace: store.marketplace,
      store_code: store.store_code,
      supplier: (data.name ?? store.supplier ?? '').trim(),
      address: store.address ?? '',
    })
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
          onDeleteActiveCompany={handleDeleteCompany}
          onEditCompany={(account) => { setEditingAccount(account); setEditAccountModalOpen(true) }}
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
                  carrierNames={carrierNames}
                  warehouseNames={warehouseNames}
                  onOpenCreate={handleOpenTripCreate}
                  onDeleteTrip={removeTrip}
                  onDeleteTripLine={removeTripLine}
                  onChangeTripStatus={changeTripStatus}
                  onChangeTripLineStatus={changeTripLineStatus}
                  onChangeTripLinePaymentStatus={changeTripLinePaymentStatus}
                  onEditTrip={editTrip}
                  onEditTripLine={editTripLine}
                  onAddTripLine={addTripLine}
                  onAddInvoicePhoto={addInvoicePhoto}
                  onReplaceInvoicePhoto={replaceInvoicePhoto}
                  onRemoveInvoicePhoto={removeInvoicePhoto}
                />
              ) : activePage === 'stores' ? (
                <StoresPage stores={stores} onOpenCreate={handleOpenStoreCreate} onEdit={handleOpenStoreEdit} onDelete={removeStore} onSync={handleSyncStore} />
              ) : activePage === 'directories' ? (
                <DirectoriesPage
                  carriers={carriers}
                  warehouses={warehouses}
                  onAddCarrier={addCarrier}
                  onDeleteCarrier={removeCarrier}
                  onRenameCarrier={renameCarrier}
                  onAddWarehouse={addWarehouse}
                  onDeleteWarehouse={removeWarehouse}
                  onRenameWarehouse={renameWarehouse}
                />
              ) : activePage === 'products' ? (
                <ProductsPage stores={stores} activeAccountId={activeAccount?.id ?? ''} selectedStoreId={activeStoreId} onStoreChange={setActiveStoreId} />
              ) : activePage === 'roles' ? (
                <RolesPage
                  roles={roles}
                  accounts={accounts}
                  activeAccountId={activeAccount?.id ?? ''}
                  isLoading={isRolesLoading}
                  onAdd={addRole}
                  onUpdate={updateRole}
                  onDelete={removeRole}
                  onClone={cloneRoleToAccount}
                />
              ) : activePage === 'stickers' ? (
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
                />
              ) : (
                <StoresPage stores={stores} onOpenCreate={handleOpenStoreCreate} onEdit={handleOpenStoreEdit} onDelete={removeStore} onSync={handleSyncStore} />
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
        onClose={() => {
          if (!isDeletingAccount) {
            setDeleteAccountModalOpen(false)
          }
        }}
        onConfirm={() => void handleConfirmDeleteActiveCompany()}
      />

      <StoreFormModal
        open={storeModalOpen}
        initialValues={editingStore ? { name: editingStore.name, marketplace: editingStore.marketplace, store_code: editingStore.store_code, supplier: editingStore.supplier ?? '', address: editingStore.address ?? '' } : undefined}
        hasApiKey={Boolean(editingStore?.api_key)}
        onClose={() => { setStoreModalOpen(false); setEditingStore(null) }}
        onSubmit={(values) => editingStore ? updateStore(editingStore.id, values) : addStore(values)}
      />

      <EditAccountModal
        open={editAccountModalOpen}
        account={editingAccount}
        onClose={() => { setEditAccountModalOpen(false); setEditingAccount(null) }}
        onSubmit={async (name) => { if (editingAccount) await updateAccount(editingAccount.id, name) }}
      />
    </div>
  )
}

export default App
