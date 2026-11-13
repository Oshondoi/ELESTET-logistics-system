import type { Store } from '../types'

type StoreSelectorLabelSource = Pick<Store, 'name' | 'supplier' | 'supplier_full' | 'store_code'>

export const getStoreSelectorLabel = (
  store: StoreSelectorLabelSource,
  options?: { includeStoreCode?: boolean },
): string => {
  const legalName = store.supplier?.trim() || store.supplier_full?.trim() || ''
  const storeName = store.name.trim() || 'Магазин без названия'
  const label = legalName ? `${legalName} — ${storeName}` : storeName

  return options?.includeStoreCode && store.store_code
    ? `${label} (${store.store_code})`
    : label
}
