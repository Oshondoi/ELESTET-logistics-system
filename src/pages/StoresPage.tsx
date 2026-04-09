import { StoreList } from '../components/stores/StoreList'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import type { Store } from '../types'

interface StoresPageProps {
  stores: Store[]
  onOpenCreate: () => void
}

export const StoresPage = ({ stores, onOpenCreate }: StoresPageProps) => (
  <div className="space-y-4">
    <Card className="rounded-3xl p-2.5">
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex h-10 min-w-[260px] items-center rounded-2xl bg-slate-100 px-4 text-sm text-slate-400">
          Поиск по названию магазина или store code
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary" className="rounded-2xl px-4 py-2.5">
            Обновить
          </Button>
          <Button className="rounded-2xl px-5 py-2.5" onClick={onOpenCreate}>
            + Создать магазин
          </Button>
        </div>
      </div>
    </Card>

    <Card className="rounded-3xl p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Всего магазинов</div>
      <div className="mt-1.5 text-2xl font-semibold text-slate-900">{stores.length}</div>
      <div className="mt-1 text-xs text-slate-500">
        store_code уникален глобально, а tracking_number уникален в рамках магазина.
      </div>
    </Card>

    <StoreList stores={stores} />
  </div>
)
