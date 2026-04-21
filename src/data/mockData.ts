import type {
  Account,
  Profile,
  Shipment,
  ShipmentStatusHistory,
  Store,
} from '../types'

export const mockProfile: Profile = {
  id: 'profile-1',
  user_id: 'user-1',
  full_name: 'Азамат Нурбеков',
  short_id: 1,
  created_at: '2026-04-09T08:30:00.000Z',
}

export const mockAccount: Account = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'ELESTET Logistics',
  created_at: '2026-04-09T08:30:00.000Z',
}

export const mockStores: Store[] = [
  {
    id: 'store-1',
    account_id: '11111111-1111-1111-1111-111111111111',
    store_code: 'A4821',
    name: 'WB Бишкек',
    marketplace: 'Wildberries',
    created_at: '2026-04-09T08:30:00.000Z',
  },
  {
    id: 'store-2',
    account_id: '11111111-1111-1111-1111-111111111111',
    store_code: 'T1045',
    name: 'WB Алматы',
    marketplace: 'Wildberries',
    created_at: '2026-04-10T08:30:00.000Z',
  },
]

export const mockShipments: Shipment[] = [
  {
    id: 'shipment-1',
    account_id: '11111111-1111-1111-1111-111111111111',
    store_id: 'store-1',
    tracking_number: 14,
    tracking_code: 'TRK-14',
    carrier: 'Asia Cargo',
    destination_warehouse: 'Коледино',
    box_qty: 42,
    units_qty: 320,
    units_total: 960,
    arrived_box_qty: 18,
    planned_marketplace_delivery_date: '2026-04-18',
    arrival_date: null,
    status: 'В пути',
    payment_status: 'Частично оплачено',
    comment: 'Основной рейс по весенней партии',
    created_at: '2026-04-11T09:00:00.000Z',
    updated_at: '2026-04-12T11:00:00.000Z',
  },
  {
    id: 'shipment-2',
    account_id: '11111111-1111-1111-1111-111111111111',
    store_id: 'store-2',
    tracking_number: 7,
    tracking_code: 'TRK-7',
    carrier: 'Silk Route',
    destination_warehouse: 'Электросталь',
    box_qty: 25,
    units_qty: 180,
    units_total: 540,
    arrived_box_qty: 25,
    planned_marketplace_delivery_date: '2026-04-16',
    arrival_date: '2026-04-14',
    status: 'Прибыл',
    payment_status: 'Оплачено',
    comment: 'Прибыл на консолидационный склад',
    created_at: '2026-04-09T10:00:00.000Z',
    updated_at: '2026-04-14T12:00:00.000Z',
  },
]

export const mockShipmentStatusHistory: ShipmentStatusHistory[] = [
  {
    id: 'history-1',
    shipment_id: 'shipment-1',
    old_status: 'Ожидает отправки',
    new_status: 'В пути',
    changed_at: '2026-04-12T11:00:00.000Z',
    changed_by: 'user-1',
  },
  {
    id: 'history-2',
    shipment_id: 'shipment-2',
    old_status: 'В пути',
    new_status: 'Прибыл',
    changed_at: '2026-04-14T12:00:00.000Z',
    changed_by: 'user-1',
  },
]
