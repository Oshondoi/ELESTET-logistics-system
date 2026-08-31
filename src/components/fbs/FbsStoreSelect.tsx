import { getStoreSelectorLabel } from '../../lib/storeDisplay'
import type { Store } from '../../types'

interface FbsStoreSelectProps {
  value: string
  stores: Array<Pick<Store, 'id' | 'name' | 'supplier' | 'supplier_full' | 'store_code'>>
  onChange: (storeId: string) => void
}

export const FbsStoreSelect = ({ value, stores, onChange }: FbsStoreSelectProps) => (
  <label className="space-y-1.5 text-xs font-semibold text-slate-600">
    <span className="block">Магазин</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400"
    >
      {stores.map((store) => (
        <option key={store.id} value={store.id}>{getStoreSelectorLabel(store)}</option>
      ))}
    </select>
  </label>
)
