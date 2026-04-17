import type { PaymentStatus, ShipmentStatus, TripStatus } from '../types'

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

export const tripStatuses: TripStatus[] = [
  'Формируется',
  'Отправлен',
  'Прибыл',
  'Завершён',
]

export const marketplaceOptions = ['Wildberries', 'Ozon', 'Kaspi']

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
