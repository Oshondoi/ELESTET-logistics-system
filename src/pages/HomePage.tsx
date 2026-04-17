import { Card } from '../components/ui/Card'
import type { Shipment, ShipmentWithStore, Store } from '../types'

interface HomePageProps {
  shipments: ShipmentWithStore[]
  rawShipments: Shipment[]
  stores: Store[]
}

const StatCard = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
  <Card className="rounded-3xl p-4">
    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">{label}</div>
    <div className="mt-1.5 text-2xl font-semibold text-slate-900">{value}</div>
    <div className="mt-1 text-xs text-slate-500">{hint}</div>
  </Card>
)

export const HomePage = ({ shipments, rawShipments, stores }: HomePageProps) => {
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
      <div className="grid gap-3 xl:grid-cols-4">
        <StatCard label="Всего поставок" value={String(shipments.length)} hint={nextPreview} />
        <StatCard label="В пути" value={String(inTransit)} hint="Активные рейсы в движении" />
        <StatCard label="Коробов" value={String(totalBoxes)} hint={`Статус "Прибыл": ${arrived}`} />
        <StatCard
          label="Всего магазинов"
          value={String(stores.length)}
          hint="store_code уникален глобально, а tracking_number уникален в рамках магазина."
        />
      </div>
    </div>
  )
}
