import type { FulfillmentSupplyWithBoxes } from '../types'
import { applyExcelWorksheetStandards } from './excelStandards'

export interface FulfillmentBoxExcelRow {
  sourceRow: number
  barcode: string
  qty: number
  boxNumber: number
}

export interface FulfillmentBoxExcelParseResult {
  rows: FulfillmentBoxExcelRow[]
  errors: string[]
}

export interface FulfillmentBoxExcelImportRow {
  barcode: string
  qty: number
  box_number: number
}

const REQUIRED_HEADERS = ['Баркод', 'Количество', 'Номер короба'] as const

const normalizeHeader = (value: unknown) => String(value ?? '')
  .trim()
  .toLocaleLowerCase('ru-RU')
  .replace(/ё/g, 'е')
  .replace(/\s+/g, ' ')

const cellIsEmpty = (value: unknown) => value === null || value === undefined || String(value).trim() === ''

const normalizeIntegerCell = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
  const normalized = String(value ?? '').trim().replace(/\s+/g, '').replace(',', '.')
  if (!/^\d+(?:\.0+)?$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : null
}

const normalizeBarcodeCell = (value: unknown): string => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return String(value ?? '').trim().replace(/\s+/g, '')
}

export async function downloadFulfillmentBoxImportTemplate(
  supply: FulfillmentSupplyWithBoxes,
  batchNumber: number | null,
): Promise<void> {
  const XLSX = await import('xlsx')
  const rows: (string | number)[][] = [
    [...REQUIRED_HEADERS],
    ...[...supply.boxes]
      .sort((left, right) => left.box_number - right.box_number)
      .map((box) => ['', '', box.box_number]),
  ]
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  applyExcelWorksheetStandards(XLSX.utils, worksheet, {
    textColumnHeaders: ['Баркод'],
    minWidth: 14,
  })
  worksheet['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 16 }]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Содержимое коробов')
  const safeWarehouse = supply.warehouse_name.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') || 'Поставка'
  XLSX.writeFile(workbook, `P-${batchNumber ?? 'unknown'}_S-${supply.supply_number}_${safeWarehouse}_шаблон_коробов.xlsx`)
}

export async function parseFulfillmentBoxImportFile(file: File): Promise<FulfillmentBoxExcelParseResult> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return { rows: [], errors: ['В Excel-файле нет листов.'] }

  const worksheet = workbook.Sheets[firstSheetName]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  })
  if (matrix.length === 0) return { rows: [], errors: ['Excel-файл пустой.'] }

  const headers = (matrix[0] ?? []).map(normalizeHeader)
  const indexes = REQUIRED_HEADERS.map((header) => headers.indexOf(normalizeHeader(header)))
  const missingHeaders = REQUIRED_HEADERS.filter((_, index) => indexes[index] < 0)
  if (missingHeaders.length > 0) {
    return { rows: [], errors: [`Не найдены обязательные колонки: ${missingHeaders.join(', ')}.`] }
  }

  const [barcodeIndex, qtyIndex, boxIndex] = indexes
  const rows: FulfillmentBoxExcelRow[] = []
  const errors: string[] = []

  matrix.slice(1).forEach((source, offset) => {
    const sourceRow = offset + 2
    const barcodeValue = source[barcodeIndex]
    const qtyValue = source[qtyIndex]
    const boxValue = source[boxIndex]
    const barcodeEmpty = cellIsEmpty(barcodeValue)
    const qtyEmpty = cellIsEmpty(qtyValue)
    const boxEmpty = cellIsEmpty(boxValue)

    if (barcodeEmpty && qtyEmpty && boxEmpty) return
    // Шаблон заранее содержит номера существующих коробов. Пока баркод и
    // количество не заполнены, такая строка является подсказкой, а не командой
    // очистить короб.
    if (!boxEmpty && barcodeEmpty && qtyEmpty) return
    if (barcodeEmpty || qtyEmpty || boxEmpty) {
      errors.push(`Строка ${sourceRow}: заполните баркод, количество и номер короба.`)
      return
    }

    const barcode = normalizeBarcodeCell(barcodeValue)
    const qty = normalizeIntegerCell(qtyValue)
    const boxNumber = normalizeIntegerCell(boxValue)
    if (!/^\d{13}$/.test(barcode)) {
      errors.push(`Строка ${sourceRow}: баркод должен содержать ровно 13 цифр.`)
      return
    }
    if (qty === null || qty < 1) {
      errors.push(`Строка ${sourceRow}: количество должно быть целым числом больше нуля.`)
      return
    }
    if (boxNumber === null || boxNumber < 1 || boxNumber > 2_147_483_647) {
      errors.push(`Строка ${sourceRow}: номер короба должен быть положительным целым числом.`)
      return
    }
    rows.push({ sourceRow, barcode, qty, boxNumber })
  })

  if (rows.length === 0 && errors.length === 0) errors.push('В файле нет заполненных строк для загрузки.')
  return { rows, errors }
}

export function aggregateFulfillmentBoxExcelRows(rows: FulfillmentBoxExcelRow[]): FulfillmentBoxExcelImportRow[] {
  const aggregated = new Map<string, FulfillmentBoxExcelImportRow>()
  rows.forEach((row) => {
    const key = `${row.boxNumber}:${row.barcode}`
    const existing = aggregated.get(key)
    if (existing) {
      existing.qty += row.qty
      return
    }
    aggregated.set(key, {
      barcode: row.barcode,
      qty: row.qty,
      box_number: row.boxNumber,
    })
  })
  return [...aggregated.values()].sort((left, right) =>
    left.box_number - right.box_number || left.barcode.localeCompare(right.barcode),
  )
}
