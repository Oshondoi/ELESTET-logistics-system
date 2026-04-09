import { formatDate } from '../../lib/utils'
import type { ShipmentWithStore } from '../../types'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'

interface ShipmentTableProps {
  shipments: ShipmentWithStore[]
}

const statusToneMap = {
  'Ожидает отправки': 'warning',
  'В пути': 'info',
  'Прибыл': 'success',
  'Отгружен': 'neutral',
} as const

const paymentToneMap = {
  'Не оплачено': 'warning',
  'Частично оплачено': 'info',
  'Оплачено': 'success',
} as const

export const ShipmentTable = ({ shipments }: ShipmentTableProps) => (
  <Card className="overflow-hidden rounded-3xl">
    <div className="overflow-x-auto">
      <table className="min-w-[1320px] divide-y divide-slate-200 text-[13px]">
        <thead className="bg-slate-50/80 text-left text-[11px] uppercase tracking-[0.14em] text-slate-400">
          <tr>
            <th className="px-3 py-2.5">Tracking ID</th>
            <th className="px-3 py-2.5">Магазин</th>
            <th className="px-3 py-2.5">Перевозчик</th>
            <th className="px-3 py-2.5">Склад назначения</th>
            <th className="px-3 py-2.5">Коробов</th>
            <th className="px-3 py-2.5">Единиц</th>
            <th className="px-3 py-2.5">Сумма единиц</th>
            <th className="px-3 py-2.5">Приехало</th>
            <th className="px-3 py-2.5">Дата МП</th>
            <th className="px-3 py-2.5">Прибытие</th>
            <th className="px-3 py-2.5">Статус</th>
            <th className="px-3 py-2.5">Оплата</th>
            <th className="px-3 py-2.5">Комментарий</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {shipments.map((shipment) => (
            <tr key={shipment.id} className="align-top text-slate-700 transition hover:bg-slate-50/70">
              <td className="px-3 py-3.5 font-semibold text-slate-900">{shipment.tracking_code}</td>
              <td className="px-3 py-3.5">
                <div className="font-medium text-slate-900">{shipment.store?.name ?? '—'}</div>
                <div className="mt-1 text-xs text-slate-400">{shipment.store?.store_code ?? '—'}</div>
              </td>
              <td className="px-3 py-3.5">{shipment.carrier}</td>
              <td className="px-3 py-3.5">{shipment.destination_warehouse}</td>
              <td className="px-3 py-3.5">{shipment.box_qty}</td>
              <td className="px-3 py-3.5">{shipment.units_qty}</td>
              <td className="px-3 py-3.5">{shipment.units_total}</td>
              <td className="px-3 py-3.5">{shipment.arrived_box_qty}</td>
              <td className="px-3 py-3.5 text-slate-600">{formatDate(shipment.planned_marketplace_delivery_date)}</td>
              <td className="px-3 py-3.5 text-slate-600">{formatDate(shipment.arrival_date)}</td>
              <td className="px-3 py-3.5">
                <Badge tone={statusToneMap[shipment.status]}>{shipment.status}</Badge>
              </td>
              <td className="px-3 py-3.5">
                <Badge tone={paymentToneMap[shipment.payment_status]}>{shipment.payment_status}</Badge>
              </td>
              <td className="max-w-[260px] px-3 py-3.5 text-slate-600">{shipment.comment || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Card>
)
