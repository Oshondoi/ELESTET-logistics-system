import { Card } from '../components/ui/Card'
import { ShipmentTable } from '../components/shipments/ShipmentTable'
import { Button } from '../components/ui/Button'
import type { Shipment, ShipmentWithStore, Store } from '../types'

interface ShipmentsPageProps {
  shipments: ShipmentWithStore[]
  rawShipments: Shipment[]
  stores: Store[]
  onOpenCreate: () => void
}

const StatCard = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
  <Card className="rounded-3xl p-4">
    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">{label}</div>
    <div className="mt-1.5 text-2xl font-semibold text-slate-900">{value}</div>
    <div className="mt-1 text-xs text-slate-500">{hint}</div>
  </Card>
)

export const ShipmentsPage = ({
  shipments,
  rawShipments,
  stores,
  onOpenCreate,
}: ShipmentsPageProps) => {
  const totalBoxes = shipments.reduce((sum, shipment) => sum + shipment.box_qty, 0)
  const inTransit = shipments.filter((shipment) => shipment.status === 'В пути').length
  const arrived = shipments.filter((shipment) => shipment.status === 'Прибыл').length

  const nextPreview = stores[0]
    ? `Следующий для ${stores[0].name}: TRK-${
        rawShipments
          .filter((shipment) => shipment.store_id === stores[0].id)
          .reduce((max, shipment) => Math.max(max, shipment.tracking_number), 0) + 1
      }`
    : 'Сначала создайте магазин'

  return (
    <div className="space-y-4">
      <Card className="rounded-3xl p-2.5">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid gap-2.5 md:grid-cols-2 xl:flex">
            <div className="flex h-10 min-w-[220px] items-center rounded-2xl bg-slate-100 px-4 text-sm text-slate-400">
              Поиск по Tracking ID, магазину, перевозчику
            </div>
            <div className="flex h-10 min-w-[170px] items-center justify-between rounded-2xl bg-slate-100 px-4 text-sm text-slate-600">
              <span>Все статусы</span>
              <span>▾</span>
            </div>
            <div className="flex h-10 min-w-[170px] items-center justify-between rounded-2xl bg-slate-100 px-4 text-sm text-slate-600">
              <span>Сортировка</span>
              <span>▾</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <Button variant="secondary" className="rounded-2xl px-4 py-2.5 shadow-sm">
              Обновить
            </Button>
            <Button className="rounded-2xl px-5 py-2.5 shadow-sm" onClick={onOpenCreate}>
              + Создать поставку
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 xl:grid-cols-3">
        <StatCard label="Всего поставок" value={String(shipments.length)} hint={nextPreview} />
        <StatCard label="В пути" value={String(inTransit)} hint="Активные рейсы в движении" />
        <StatCard label="Коробов" value={String(totalBoxes)} hint={`Статус "Прибыл": ${arrived}`} />
      </div>

      <ShipmentTable shipments={shipments} />
    </div>
  )
}
