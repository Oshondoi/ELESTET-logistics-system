export type MemberRole = 'owner' | 'admin' | 'manager' | 'operator' | 'viewer'

// ─── Товары ───────────────────────────────────────────────────

export interface Product {
  id: string
  account_id: string
  store_id: string
  nm_id: number          // WB артикул (nmID)
  vendor_code: string | null
  name: string | null
  brand: string | null
  category: string | null
  color: string | null
  composition: string | null
  country: string | null
  barcodes: string[]
  photos: unknown | null
  sizes: unknown | null
  raw_data: unknown | null
  synced_at: string
  created_at: string
}

export interface StoreSyncLog {
  id: string
  store_id: string
  synced_at: string
  products_count: number | null
  status: 'ok' | 'error'
  error_message: string | null
}

export interface SyncResult {
  success: boolean
  count: number
}

// ─── Роли / Доступы ───────────────────────────────────────────

export interface RolePermissions {
  shipments_view: boolean
  shipments_manage: boolean
  stores_view: boolean
  stores_manage: boolean
  directories_view: boolean
  directories_manage: boolean
  stickers_view: boolean
  stickers_manage: boolean
  roles_manage: boolean
  members_manage: boolean
}

export const DEFAULT_PERMISSIONS: RolePermissions = {
  shipments_view: false,
  shipments_manage: false,
  stores_view: false,
  stores_manage: false,
  directories_view: false,
  directories_manage: false,
  stickers_view: false,
  stickers_manage: false,
  roles_manage: false,
  members_manage: false,
}

export const FULL_PERMISSIONS: RolePermissions = {
  shipments_view: true,
  shipments_manage: true,
  stores_view: true,
  stores_manage: true,
  directories_view: true,
  directories_manage: true,
  stickers_view: true,
  stickers_manage: true,
  roles_manage: true,
  members_manage: true,
}

export interface Role {
  id: string
  account_id: string
  name: string
  permissions: RolePermissions
  assigned_user_id?: string | null
  assigned_user_name?: string | null
  assigned_user_email?: string | null
  assigned_user_short_id?: number | null
  created_at: string
}

export interface RoleFormValues {
  name: string
  permissions: RolePermissions
  assigned_user_id?: string | null
}

export interface ResolvedUser {
  user_id: string
  email: string
  full_name: string
  short_id: number
}

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
  short_id: number
  created_at: string
}

export interface Account {
  id: string
  name: string
  created_at: string
  my_role?: MemberRole
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
  api_key?: string | null
  supplier?: string | null
  address?: string | null
  inn?: string | null
  ai_prompt?: string | null
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
  api_key?: string
  supplier?: string
  address?: string
  inn?: string
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
  custom_fields: Record<string, unknown>
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
  weight: number | null
  planned_marketplace_delivery_date: string | null
  arrival_date: string | null
  reception_date: string | null
  shipped_date: string | null
  status: ShipmentStatus
  payment_status: PaymentStatus
  invoice_photo_urls: string[]
  comment: string
  custom_fields: Record<string, unknown>
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
  weight: number
  planned_marketplace_delivery_date: string
  arrival_date: string
  reception_date: string
  shipped_date: string
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
  icon_wash: boolean
  icon_iron: boolean
  icon_no_bleach: boolean
  icon_no_tumble_dry: boolean
  icon_eac: boolean
  created_at: string
}

export interface StickerBundleItem {
  sticker_id: string
  copies: number
}

export interface StickerBundle {
  id: string
  account_id: string
  name: string
  items: StickerBundleItem[]
  created_at: string
}

export interface StickerFormValues {
  barcode: string
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
  icon_wash: boolean
  icon_iron: boolean
  icon_no_bleach: boolean
  icon_no_tumble_dry: boolean
  icon_eac: boolean
}

// ─── Отзывы WB ────────────────────────────────────────────────

export type AiReplyStatus = 'none' | 'generated' | 'sent'
export type AiTone = 'polite' | 'neutral' | 'friendly' | 'professional'
export type AiProvider = 'openai' | 'claude'
export type AiModel = 'gpt-4o-mini' | 'gpt-4o' | 'gpt-3.5-turbo'
export type ClaudeModel = 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001' | 'claude-opus-4-7'

export interface AiSettings {
  account_id: string
  provider: AiProvider
  openai_key: string
  model: AiModel
  claude_key: string
  claude_model: ClaudeModel
  tone: AiTone
  system_prompt: string | null
  updated_at: string
}

export interface AiSettingsFormValues {
  provider: AiProvider
  openai_key: string
  model: AiModel
  claude_key: string
  claude_model: ClaudeModel
  tone: AiTone
  system_prompt: string
}

export interface WbFeedbackRow {
  id: string
  store_id: string
  account_id: string
  data: WbFeedback
  is_answered: boolean
  ai_reply: string | null
  ai_reply_status: AiReplyStatus
  reply_sent_at: string | null
  synced_at: string
}

export interface WbFeedback {
  id: string
  text: string
  productValuation: number // 1–5
  createdDate: string
  userName: string | null
  isAnswered: boolean
  answer?: { text: string } | null
  productDetails?: {
    nmId: number
    productName: string
    imtId?: number
    supplierArticle?: string
    brandName?: string
    category?: string
    color?: string
  } | null
  photoLinks?: { fullSize: string; miniSize: string }[] | null
}

export interface ReviewTemplate {
  id: string
  account_id: string
  name: string
  text: string
  trigger_ratings: number[]   // [] = any rating
  trigger_keywords: string[]  // [] = no keyword filter
  is_auto: boolean
  sort_order: number
  created_at: string
}

export interface ReviewTemplateFormValues {
  name: string
  text: string
  trigger_ratings: number[]
  trigger_keywords: string[]
  is_auto: boolean
}

export interface AiPrompt {
  id: string
  account_id: string
  store_id: string | null
  type: 'system' | 'store'
  title: string
  content: string
  sort_order: number
  created_at: string
}

export interface AiPromptFormValues {
  title: string
  content: string
}
