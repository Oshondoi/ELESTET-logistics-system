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
