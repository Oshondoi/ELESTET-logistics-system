import { Card } from '../components/ui/Card'
import type { Shipment, ShipmentWithStore, Store } from '../types'

interface HomePageProps {
  shipments: ShipmentWithStore[]
  rawShipments: Shipment[]
  stores: Store[]
  hasAccount?: boolean
  onCreateCompany?: () => void
}

const StatCard = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
  <Card className="rounded-3xl p-4">
    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">{label}</div>
    <div className="mt-1.5 text-2xl font-semibold text-slate-900">{value}</div>
    <div className="mt-1 text-xs text-slate-500">{hint}</div>
  </Card>
)

export const HomePage = ({ shipments, rawShipments, stores, hasAccount = true, onCreateCompany }: HomePageProps) => {
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

  if (!hasAccount) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-3xl">🏢</div>
        <div className="text-lg font-semibold text-slate-800">Создайте компанию, чтобы начать работу</div>
        <div className="mt-2 max-w-sm text-sm text-slate-500">
          Без компании разделы системы недоступны. Создайте первую компанию — это займёт несколько секунд.
        </div>
        {onCreateCompany && (
          <button
            onClick={onCreateCompany}
            className="mt-6 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 active:scale-95 transition-all"
          >
            Создать компанию
          </button>
        )}
      </div>
    )
  }

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
