import type { PaymentStatus, ShipmentStatus, TripStatus } from '../types'

export const shipmentStatuses: ShipmentStatus[] = [
  'Формируется',
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

export const tripStatuses: TripStatus[] = [
  'Формируется',
  'Отправлен',
  'Прибыл',
  'Завершён',
]

export const marketplaceOptions = ['Wildberries']

export const carrierOptions = [
  'Asia Cargo',
  'Карго KG',
  'WB Логистика',
  'Деловые Линии',
  'СДЭК',
]

export const warehouseOptions = [
  'Коледино',
  'Электросталь',
  'Казань',
  'Краснодар',
  'Новосибирск',
  'Екатеринбург',
  'Хабаровск',
]
