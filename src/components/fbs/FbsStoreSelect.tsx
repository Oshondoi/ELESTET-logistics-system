import { getStoreSelectorLabel } from '../../lib/storeDisplay'
import type { Store } from '../../types'

interface FbsStoreSelectProps {
  value: string
  stores: Array<Pick<Store, 'id' | 'name' | 'supplier' | 'supplier_full' | 'store_code'> & { teksher_login?: string | null }>
  onChange: (storeId: string) => void
  disabled?: boolean
  groupConnected?: boolean
}

export const FbsStoreSelect = ({ value, stores, onChange, disabled = false, groupConnected = false }: FbsStoreSelectProps) => {
  const byLabel = (left: (typeof stores)[number], right: (typeof stores)[number]) =>
    getStoreSelectorLabel(left).localeCompare(getStoreSelectorLabel(right), 'ru')
  const connected = groupConnected ? stores.filter((store) => store.teksher_login).sort(byLabel) : []
  const disconnected = groupConnected ? stores.filter((store) => !store.teksher_login).sort(byLabel) : []
  const option = (store: (typeof stores)[number]) => (
    <option key={store.id} value={store.id}>{getStoreSelectorLabel(store)}</option>
  )
  return (
    <label className="space-y-1.5 text-xs font-semibold text-slate-600">
      <span className="block">Магазин</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-9 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400 disabled:bg-slate-50 disabled:text-slate-400"
      >
        <option value="">Выберите магазин</option>
        {groupConnected ? (
          <>
            {connected.length > 0 && <optgroup label="Подключены к Teksher">{connected.map(option)}</optgroup>}
            {disconnected.length > 0 && <optgroup label="Без Teksher">{disconnected.map(option)}</optgroup>}
          </>
        ) : stores.map(option)}
      </select>
    </label>
  )
}
