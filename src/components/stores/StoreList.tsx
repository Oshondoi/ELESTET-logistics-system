import type { Store } from '../../types'
import { Card } from '../ui/Card'

interface StoreListProps {
  stores: Store[]
}

export const StoreList = ({ stores }: StoreListProps) => (
  <Card className="overflow-hidden rounded-3xl">
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/80 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
          <tr>
            <th className="px-3 py-2.5">Название</th>
            <th className="px-3 py-2.5">Маркетплейс</th>
            <th className="px-3 py-2.5">Store Code</th>
            <th className="px-3 py-2.5">Создан</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {stores.map((store) => (
            <tr key={store.id} className="transition hover:bg-slate-50/70">
              <td className="px-3 py-3.5 font-medium text-slate-900">{store.name}</td>
              <td className="px-3 py-3.5 text-slate-600">{store.marketplace}</td>
              <td className="px-3 py-3.5 font-semibold text-slate-900">{store.store_code}</td>
              <td className="px-3 py-3.5 text-slate-600">
                {new Date(store.created_at).toLocaleDateString('ru-RU')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Card>
)
