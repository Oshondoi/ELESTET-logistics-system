export const SYSTEM_BOX_EXPORT_COLUMNS = [
  { key: 'barcode', label: 'Баркод товара', required: true },
  { key: 'qty', label: 'Кол-во товаров', required: true },
  { key: 'boxBarcode', label: 'Системный ШК короба', required: true },
  { key: 'expiryDate', label: 'Срок годности', required: true },
  { key: 'boxNumber', label: 'Номер короба', required: true },
  { key: 'wbArticle', label: 'Артикул ВБ', required: false },
  { key: 'sellerArticle', label: 'Артикул продавца', required: false },
  { key: 'productName', label: 'Название товара', required: false },
  { key: 'color', label: 'Цвет', required: false },
  { key: 'size', label: 'Размер', required: false },
] as const

export const BARCODE_EXPORT_COLUMNS = [
  { key: 'barcode', label: 'Баркод', required: true },
  { key: 'qty', label: 'Количество', required: true },
] as const

export type BoxExportColumnKey = typeof SYSTEM_BOX_EXPORT_COLUMNS[number]['key']
export type OptionalBoxExportColumnKey = Extract<
  typeof SYSTEM_BOX_EXPORT_COLUMNS[number],
  { required: false }
>['key']
export type FulfillmentExcelMode = 'boxes' | 'barcodes' | 'both'

export const BOX_EXPORT_OPTIONAL_COLUMNS = SYSTEM_BOX_EXPORT_COLUMNS.filter(
  (column): column is Extract<typeof SYSTEM_BOX_EXPORT_COLUMNS[number], { required: false }> => !column.required,
)

export const BOX_EXPORT_STORAGE_KEY = 'fulfillment_box_export_optional_columns'

export const getStoredBoxExportColumns = (): OptionalBoxExportColumnKey[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(BOX_EXPORT_STORAGE_KEY) ?? 'null')
    if (!Array.isArray(saved)) return BOX_EXPORT_OPTIONAL_COLUMNS.map((column) => column.key)
    const allowed = new Set<OptionalBoxExportColumnKey>(BOX_EXPORT_OPTIONAL_COLUMNS.map((column) => column.key))
    return saved.filter((key): key is OptionalBoxExportColumnKey => typeof key === 'string' && allowed.has(key as OptionalBoxExportColumnKey))
  } catch {
    return BOX_EXPORT_OPTIONAL_COLUMNS.map((column) => column.key)
  }
}

export const hasCompleteWbBoxCodes = (boxes: Array<{
  wb_barcode?: string | null
  wb_external_barcode?: string | null
}>): boolean => boxes.length > 0 && boxes.every(
  (box) => Boolean(box.wb_barcode?.trim()) && Boolean(box.wb_external_barcode?.trim()),
)
