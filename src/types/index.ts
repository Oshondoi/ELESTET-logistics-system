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
  // Логистика
  shipments_view: boolean
  shipments_manage: boolean
  shipments_delete_any: boolean
  shipments_delete_trip: boolean
  shipments_manage_payments: boolean
  // Магазины
  stores_view: boolean
  stores_manage: boolean
  stores_delete: boolean
  stores_sync: boolean
  // Справочники
  directories_view: boolean
  directories_manage: boolean
  directories_delete: boolean
  // Стикеры
  stickers_view: boolean
  stickers_manage: boolean
  stickers_delete: boolean
  stickers_import: boolean
  // Отзывы
  reviews_view: boolean
  reviews_manage: boolean
  reviews_ai: boolean
  reviews_automation: boolean
  // Фулфилмент
  fulfillment_view: boolean
  fulfillment_manage: boolean
  fulfillment_otk_assign: boolean
  fulfillment_stage_jump: boolean
  fulfillment_packing_autoadd: boolean
  fulfillment_supply_delete_locked: boolean
  // Администрирование
  roles_manage: boolean
  members_manage: boolean
}

export const DEFAULT_PERMISSIONS: RolePermissions = {
  shipments_view: false,
  shipments_manage: false,
  shipments_delete_any: false,
  shipments_delete_trip: false,
  shipments_manage_payments: false,
  stores_view: false,
  stores_manage: false,
  stores_delete: false,
  stores_sync: false,
  directories_view: false,
  directories_manage: false,
  directories_delete: false,
  stickers_view: false,
  stickers_manage: false,
  stickers_delete: false,
  stickers_import: false,
  reviews_view: false,
  reviews_manage: false,
  reviews_ai: false,
  reviews_automation: false,
  fulfillment_view: false,
  fulfillment_manage: false,
  fulfillment_otk_assign: false,
  fulfillment_stage_jump: false,
  fulfillment_packing_autoadd: false,
  fulfillment_supply_delete_locked: false,
  roles_manage: false,
  members_manage: false,
}

export const FULL_PERMISSIONS: RolePermissions = {
  shipments_view: true,
  shipments_manage: true,
  shipments_delete_any: true,
  shipments_delete_trip: true,
  shipments_manage_payments: true,
  stores_view: true,
  stores_manage: true,
  stores_delete: true,
  stores_sync: true,
  directories_view: true,
  directories_manage: true,
  directories_delete: true,
  stickers_view: true,
  stickers_manage: true,
  stickers_delete: true,
  stickers_import: true,
  reviews_view: true,
  reviews_manage: true,
  reviews_ai: true,
  reviews_automation: true,
  fulfillment_view: true,
  fulfillment_manage: true,
  fulfillment_otk_assign: true,
  fulfillment_stage_jump: true,
  fulfillment_packing_autoadd: true,
  fulfillment_supply_delete_locked: true,
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
  | 'Формируется'
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
  deleted_at?: string | null
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
  supplier_full?: string | null
  address?: string | null
  deleted_at?: string | null
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
  supplier_full?: string
  address?: string
  inn?: string
}

export interface Carrier {
  id: string
  account_id: string
  name: string
  phone?: string | null
  contact_person?: string | null
  notes?: string | null
  owner_user_id?: string | null
  created_at: string
}

export interface Warehouse {
  id: string
  account_id: string | null
  name: string
  is_system: boolean
  created_at: string
}

export interface CarrierTariff {
  id: string
  account_id: string
  carrier_id: string
  warehouse_id: string
  price_per_box: number | null
  price_per_kg: number | null
}

export interface WbUnloadTariff {
  id: string
  account_id: string
  warehouse_id: string
  price_per_box: number
}

export interface FulfillmentWorkTariff {
  id: string
  account_id: string
  stage: string
  name: string
  price_per_unit: number
  currency: string
  created_at: string
}

export interface AccountCurrency {
  id: string
  account_id: string
  code: string
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
  arrived_at: string | null
  finished_at: string | null
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
  waiting_at: string | null
  transit_at: string | null
  status: ShipmentStatus
  payment_status: PaymentStatus
  invoice_photo_urls: string[]
  sticker_file_urls: string[]
  combined_sticker_urls: string[]
  wb_supply_id: string | null
  wb_cargo_type: number | null
  wb_acceptance_date: string | null
  wb_package_codes: string[]
  wb_pass_url: string | null
  wb_pass_urls: string[]
  comment: string
  custom_fields: Record<string, unknown>
  created_at: string
  updated_at: string
  deleted_at?: string | null
  fulfillment_batch_id?: string | null
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
export type ClaudeModel = 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001' | 'claude-opus-4-7' | 'claude-3-7-sonnet-20250219' | 'claude-3-5-sonnet-20241022' | 'claude-3-5-haiku-20241022'

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
  pros?: string | null
  cons?: string | null
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

// ─── Фулфилмент ───────────────────────────────────────────────

export type FulfillmentStage = 'reception' | 'otk' | 'marking' | 'packing' | 'logistics' | 'done'
export type FulfillmentBatchStatus = 'active' | 'done' | 'cancelled'

export interface FulfillmentSettings {
  id: string
  account_id: string
  stage_otk: boolean
  stage_marking: boolean
  stage_packing: boolean
  stage_logistics: boolean
  created_at: string
  updated_at: string
}

export interface FulfillmentBatch {
  id: string
  account_id: string
  store_id: string | null
  name: string
  status: FulfillmentBatchStatus
  current_stage: FulfillmentStage
  stage_otk: boolean
  stage_marking: boolean
  stage_packing: boolean
  stage_logistics: boolean
  trip_id: string | null
  trip_line_id: string | null
  comment: string | null
  otk_discrepancy: number | null
  created_at: string
  updated_at: string
  created_by: string | null
  deleted_at: string | null
}

export interface FulfillmentItem {
  id: string
  batch_id: string
  barcode: string
  product_name: string | null
  size: string | null
  article: string | null
  qty_received: number
  qty_otk: number | null
  qty_marked: number | null
  qty_packed: number | null
  boxes: number | null
  notes: string | null
  sort_order: number
  created_at: string
}

export interface FulfillmentStageLog {
  id: string
  batch_id: string
  stage: FulfillmentStage
  completed_at: string
  completed_by: string | null
  notes: string | null
}

export interface FulfillmentBatchWithItems extends FulfillmentBatch {
  items: FulfillmentItem[]
}

export interface FulfillmentOtkLog {
  id: string
  batch_id: string
  user_id: string
  user_email: string
  user_name: string | null
  performer_user_id: string | null
  performer_name: string
  tariff: string
  qty: number
  qty_defect: number
  notes: string | null
  photo_urls: string[]
  created_at: string
  updated_at: string | null
  deleted_at: string | null
}

export interface FulfillmentMarkingLog extends FulfillmentOtkLog {
  barcode: string | null
  item_id: string | null
}

export interface FulfillmentOtkLogHistory {
  id: string
  log_id: string
  user_id: string
  user_email: string
  user_name?: string | null
  action: 'created' | 'updated' | 'deleted'
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown>
  created_at: string
}

export interface FulfillmentMarkingLogHistory {
  id: string
  log_id: string
  user_id: string
  user_email: string
  user_name?: string | null
  action: 'created' | 'updated' | 'deleted'
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown>
  created_at: string
}

// ─── Формирование коробов ─────────────────────────────────────

export interface FulfillmentSupply {
  id: string
  batch_id: string
  account_id: string
  warehouse_id: string | null
  warehouse_name: string
  trip_id: string | null
  trip_line_id: string | null
  created_by: string | null
  created_at: string
  _local?: boolean
}

export interface FulfillmentBox {
  id: string
  supply_id: string
  account_id: string
  box_number: number
  status: 'open' | 'closed'
  created_at: string
  _local?: boolean
}

export interface FulfillmentBoxItem {
  id: string
  box_id: string
  account_id: string
  barcode: string
  item_id: string | null
  product_name: string | null
  qty: number
  created_at: string
  _local?: boolean
  _info?: {
    nm_id: number | null
    name: string | null
    vendor_code: string | null
    category: string | null
    color: string | null
    brand: string | null
    size: string | null
  }
}

export interface FulfillmentBoxWithItems extends FulfillmentBox {
  items: FulfillmentBoxItem[]
}

export interface FulfillmentSupplyWithBoxes extends FulfillmentSupply {
  boxes: FulfillmentBoxWithItems[]
}
