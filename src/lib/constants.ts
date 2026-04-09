import type { PaymentStatus, ShipmentStatus } from '../types'

export const shipmentStatuses: ShipmentStatus[] = [
  'Ожидает отправки',
  'В пути',
  'Прибыл',
  'Отгружен',
]

export const paymentStatuses: PaymentStatus[] = [
  'Не оплачено',
  'Частично оплачено',
  'Оплачено',
]

export const marketplaceOptions = ['Wildberries', 'Ozon', 'Kaspi']
