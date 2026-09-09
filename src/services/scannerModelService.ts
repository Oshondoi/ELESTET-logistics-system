import { supabase } from '../lib/supabase'

export type ScannerConnectionType = 'keyboard' | 'web_serial'
export type ScannerModelStatus = 'draft' | 'active' | 'archived'

export type ScannerSetupCode = {
  label: string
  value: string
  format: 'CODE128' | 'QR'
}

export type ScannerSerialOptions = {
  baudRate: number
  dataBits: 7 | 8
  stopBits: 1 | 2
  parity: 'none' | 'even' | 'odd'
  flowControl: 'none' | 'hardware'
}

export type ScannerModelProfile = {
  id: string
  brand: string
  model: string
  displayName: string
  connectionType: ScannerConnectionType
  status: ScannerModelStatus
  serialOptions: ScannerSerialOptions
  scanOptions: Record<string, unknown>
  setupBarcodes: ScannerSetupCode[]
  restoreBarcodes: ScannerSetupCode[]
  instructions: string
  warningText: string
  profileVersion: number
  sortOrder: number
  usageCount: number
  createdAt: string | null
  updatedAt: string | null
}

export type ScannerModelInput = Omit<
  ScannerModelProfile,
  'displayName' | 'profileVersion' | 'usageCount' | 'createdAt' | 'updatedAt'
>

const ACTIVE_SCANNER_CACHE_KEY = 'elestet_fbs_scanner_catalog_v1'

const DEFAULT_SERIAL_OPTIONS: ScannerSerialOptions = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
}

type ScannerModelRow = {
  id?: unknown
  brand?: unknown
  model?: unknown
  display_name?: unknown
  connection_type?: unknown
  status?: unknown
  serial_options?: unknown
  scan_options?: unknown
  setup_barcodes?: unknown
  restore_barcodes?: unknown
  instructions?: unknown
  warning_text?: unknown
  profile_version?: unknown
  sort_order?: unknown
  usage_count?: unknown
  created_at?: unknown
  updated_at?: unknown
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeSerialOptions(value: unknown): ScannerSerialOptions {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const dataBits = finiteNumber(source.dataBits, 8)
  const stopBits = finiteNumber(source.stopBits, 1)
  const parity = source.parity
  const flowControl = source.flowControl
  return {
    baudRate: Math.max(1, Math.trunc(finiteNumber(source.baudRate, 9600))),
    dataBits: dataBits === 7 ? 7 : 8,
    stopBits: stopBits === 2 ? 2 : 1,
    parity: parity === 'even' || parity === 'odd' ? parity : 'none',
    flowControl: flowControl === 'hardware' ? 'hardware' : 'none',
  }
}

function normalizeSetupCodes(value: unknown): ScannerSetupCode[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const source = item as Record<string, unknown>
    const label = typeof source.label === 'string' ? source.label.trim() : ''
    const codeValue = typeof source.value === 'string' ? source.value : ''
    if (!label || !codeValue) return []
    return [{ label, value: codeValue, format: source.format === 'QR' ? 'QR' as const : 'CODE128' as const }]
  })
}

function normalizeScannerModel(row: ScannerModelRow, defaultStatus: ScannerModelStatus): ScannerModelProfile | null {
  if (typeof row.id !== 'string' || typeof row.brand !== 'string' || typeof row.model !== 'string') return null
  const displayName = typeof row.display_name === 'string' && row.display_name.trim()
    ? row.display_name.trim()
    : `${row.brand.trim()} ${row.model.trim()}`.trim()
  if (!displayName) return null
  const connectionType: ScannerConnectionType = row.connection_type === 'web_serial' ? 'web_serial' : 'keyboard'
  const status: ScannerModelStatus = row.status === 'draft' || row.status === 'archived' ? row.status : defaultStatus
  return {
    id: row.id,
    brand: row.brand.trim(),
    model: row.model.trim(),
    displayName,
    connectionType,
    status,
    serialOptions: normalizeSerialOptions(row.serial_options),
    scanOptions: row.scan_options && typeof row.scan_options === 'object' && !Array.isArray(row.scan_options)
      ? row.scan_options as Record<string, unknown>
      : {},
    setupBarcodes: normalizeSetupCodes(row.setup_barcodes),
    restoreBarcodes: normalizeSetupCodes(row.restore_barcodes),
    instructions: typeof row.instructions === 'string' ? row.instructions : '',
    warningText: typeof row.warning_text === 'string' ? row.warning_text : '',
    profileVersion: Math.max(1, Math.trunc(finiteNumber(row.profile_version, 1))),
    sortOrder: Math.trunc(finiteNumber(row.sort_order, 100)),
    usageCount: Math.max(0, Math.trunc(finiteNumber(row.usage_count, 0))),
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
  }
}

function normalizeScannerModels(rows: unknown, defaultStatus: ScannerModelStatus) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => normalizeScannerModel((row ?? {}) as ScannerModelRow, defaultStatus))
    .filter((row): row is ScannerModelProfile => row !== null)
}

export function readCachedActiveScannerModels(): ScannerModelProfile[] {
  try {
    return normalizeScannerModels(JSON.parse(localStorage.getItem(ACTIVE_SCANNER_CACHE_KEY) ?? '[]'), 'active')
      .filter((model) => model.status === 'active')
  } catch {
    return []
  }
}

export async function fetchActiveScannerModels(): Promise<ScannerModelProfile[]> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await (supabase as any).rpc('get_fbs_scanner_models')
  if (error) throw new Error(error.message || 'Не удалось загрузить каталог сканеров')
  const models = normalizeScannerModels(data, 'active').filter((model) => model.status === 'active')
  localStorage.setItem(ACTIVE_SCANNER_CACHE_KEY, JSON.stringify(models.map((model) => ({
    id: model.id,
    brand: model.brand,
    model: model.model,
    display_name: model.displayName,
    connection_type: model.connectionType,
    status: model.status,
    serial_options: model.serialOptions,
    scan_options: model.scanOptions,
    setup_barcodes: model.setupBarcodes,
    restore_barcodes: model.restoreBarcodes,
    instructions: model.instructions,
    warning_text: model.warningText,
    profile_version: model.profileVersion,
    sort_order: model.sortOrder,
    updated_at: model.updatedAt,
  }))))
  return models
}

export async function adminFetchScannerModels(): Promise<ScannerModelProfile[]> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await (supabase as any).rpc('admin_get_fbs_scanner_models')
  if (error) throw new Error(error.message || 'Не удалось загрузить каталог сканеров')
  return normalizeScannerModels(data, 'draft')
}

export async function adminSaveScannerModel(input: ScannerModelInput): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await (supabase as any).rpc('admin_upsert_fbs_scanner_model', {
    p_id: input.id || null,
    p_brand: input.brand,
    p_model: input.model,
    p_connection_type: input.connectionType,
    p_status: input.status,
    p_serial_options: input.serialOptions,
    p_scan_options: input.scanOptions,
    p_setup_barcodes: input.setupBarcodes,
    p_restore_barcodes: input.restoreBarcodes,
    p_instructions: input.instructions,
    p_warning_text: input.warningText,
    p_sort_order: input.sortOrder,
  })
  if (error) throw new Error(error.message || 'Не удалось сохранить модель сканера')
}

export async function adminArchiveScannerModel(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { error } = await (supabase as any).rpc('admin_archive_fbs_scanner_model', { p_id: id })
  if (error) throw new Error(error.message || 'Не удалось архивировать модель сканера')
}
