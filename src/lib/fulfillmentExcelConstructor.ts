import * as XLSX from 'xlsx'
import type { FulfillmentSupplyWithBoxes } from '../types'

export const EXCEL_CONSTRUCTOR_COLUMNS = [
  { key: 'box_number', label: 'Номер короба' },
  { key: 'barcode', label: 'Баркод' },
  { key: 'qty', label: 'Количество' },
  { key: 'vendor_code', label: 'Артикул продавца' },
  { key: 'nm_id', label: 'Артикул WB' },
  { key: 'product_name', label: 'Название товара' },
  { key: 'supply_number', label: 'Номер поставки' },
  { key: 'system_barcode', label: 'Системный ШК короба' },
  { key: 'wb_barcode', label: 'ШК короба WB' },
  { key: 'wb_external_barcode', label: 'ШК для печати' },
] as const

export type ExcelConstructorColumnKey = (typeof EXCEL_CONSTRUCTOR_COLUMNS)[number]['key']

export interface ExcelConstructorProductLookup {
  vendor_code?: string | null
  nm_id?: number | null
  name?: string | null
}

export interface ExcelExportPreset {
  id: string
  account_id: string
  name: string
  columns: ExcelConstructorColumnKey[]
  created_at: string
  updated_at: string
}

const labelByKey = Object.fromEntries(
  EXCEL_CONSTRUCTOR_COLUMNS.map((column) => [column.key, column.label]),
) as Record<ExcelConstructorColumnKey, string>

export function buildConstructorRows(
  supply: FulfillmentSupplyWithBoxes,
  columns: ExcelConstructorColumnKey[],
  productByBarcode: Map<string, ExcelConstructorProductLookup>,
): string[][] {
  const header = columns.map((key) => labelByKey[key])
  const rows: string[][] = [header]
  for (const box of [...supply.boxes].sort((a, b) => a.box_number - b.box_number)) {
    for (const item of box.items) {
      const product = productByBarcode.get(item.barcode)
      const record: Record<ExcelConstructorColumnKey, string> = {
        box_number: String(box.box_number),
        barcode: item.barcode,
        qty: String(item.qty),
        vendor_code: product?.vendor_code ?? '',
        nm_id: product?.nm_id != null ? String(product.nm_id) : '',
        product_name: product?.name ?? item.product_name ?? '',
        supply_number: `S-${supply.supply_number}`,
        system_barcode: box.barcode ?? '',
        wb_barcode: box.wb_barcode ?? '',
        wb_external_barcode: box.wb_external_barcode ?? '',
      }
      rows.push(columns.map((key) => record[key]))
    }
  }
  return rows
}

export function downloadConstructorExcel(
  supply: FulfillmentSupplyWithBoxes,
  columns: ExcelConstructorColumnKey[],
  productByBarcode: Map<string, ExcelConstructorProductLookup>,
  filename: string,
): void {
  const rows = buildConstructorRows(supply, columns, productByBarcode)
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Экспорт')
  XLSX.writeFile(book, filename)
}
