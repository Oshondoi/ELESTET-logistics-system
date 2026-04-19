export type MemberRole = 'owner' | 'admin' | 'manager' | 'operator' | 'viewer'

export type ShipmentStatus =
  | 'Ожидает отправки'
  | 'В пути'
  | 'Прибыл'
  | 'Отгружен'

export type PaymentStatus = 'Не оплачено' | 'Частично оплачено' | 'Оплачено'

export interface Profile {
  id: string
  user_id: string
  full_name: string
  created_at: string
}

export interface Account {
  id: string
  name: string
  created_at: string
}

export interface AccountMember {
  id: string
  account_id: string
  user_id: string
  role: MemberRole
  created_at: string
}

export interface Store {
  id: string
  account_id: string
  store_code: string
  name: string
  marketplace: string
  created_at: string
}

export interface Shipment {
  id: string
  account_id: string
  store_id: string
  tracking_number: number
  tracking_code: string
  carrier: string
  destination_warehouse: string
  box_qty: number
  units_qty: number
  units_total: number
  arrived_box_qty: number
  planned_marketplace_delivery_date: string | null
  arrival_date: string | null
  status: ShipmentStatus
  payment_status: PaymentStatus
  comment: string
  created_at: string
  updated_at: string
}

export interface ShipmentStatusHistory {
  id: string
  shipment_id: string
  old_status: ShipmentStatus | null
  new_status: ShipmentStatus
  changed_at: string
  changed_by: string | null
}

export interface ShipmentWithStore extends Shipment {
  store?: Store
}

export interface ShipmentFormValues {
  store_id: string
  carrier: string
  destination_warehouse: string
  box_qty: number
  units_qty: number
  units_total: number
  arrived_box_qty: number
  planned_marketplace_delivery_date: string
  arrival_date?: string
  status: ShipmentStatus
  payment_status: PaymentStatus
  comment: string
}

export interface StoreFormValues {
  name: string
  marketplace: string
  store_code?: string
}

export interface Carrier {
  id: string
  account_id: string
  name: string
  created_at: string
}

export interface Warehouse {
  id: string
  account_id: string | null
  name: string
  is_system: boolean
  created_at: string
}

// ─── Рейсы ───────────────────────────────────────────────────

export type TripStatus = 'Формируется' | 'Отправлен' | 'Прибыл' | 'Завершён'

export interface Trip {
  id: string
  account_id: string
  draft_number: number
  trip_number: string | null
  carrier: string
  departure_date: string | null
  status: TripStatus
  payment_status: PaymentStatus
  comment: string
  created_at: string
  updated_at: string
}

export interface TripLine {
  id: string
  trip_id: string
  account_id: string
  store_id: string
  shipment_number: number
  destination_warehouse: string
  box_qty: number
  units_qty: number
  units_total: number
  arrived_box_qty: number
  planned_marketplace_delivery_date: string | null
  arrival_date: string | null
  status: ShipmentStatus
  payment_status: PaymentStatus
  invoice_photo_urls: string[]
  comment: string
  created_at: string
  updated_at: string
}

export interface TripLineWithStore extends TripLine {
  store?: Store
}

export interface TripWithLines extends Trip {
  lines: TripLineWithStore[]
}

export interface TripFormValues {
  carrier: string
  comment: string
  departure_date?: string
}

export interface TripLineFormValues {
  store_id: string
  destination_warehouse: string
  box_qty: number
  units_qty: number
  units_total: number
  arrived_box_qty: number
  planned_marketplace_delivery_date: string
  arrival_date: string
  status: ShipmentStatus
  payment_status: PaymentStatus
  comment: string
}

// ─── Стикеры ─────────────────────────────────────────────────

export interface StickerTemplate {
  id: string
  account_id: string
  barcode: string
  name: string
  composition: string | null
  article: string | null
  brand: string | null
  size: string | null
  color: string | null
  supplier: string | null
  supplier_address: string | null
  production_date: string | null
  country: string
  copies: number
  created_at: string
}

export interface StickerFormValues {
  name: string
  composition: string
  article: string
  brand: string
  size: string
  color: string
  supplier: string
  supplier_address: string
  production_date: string
  country: string
  copies: number
}
