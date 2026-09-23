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
  boxNumbers: number[]
  errors: string[]
}

export interface FulfillmentBoxExcelImportRow {
  barcode: string
  qty: number
  box_number: number
}

export interface WbBoxCodeExcelRow {
  sourceRow: number
  boxNumber: number
  code: string
  externalCode: string
}

export interface WbBoxCodeExcelParseResult {
  rows: WbBoxCodeExcelRow[]
  errors: string[]
  sheetName: string | null
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

const WB_BOX_CODE_HEADERS = ['ШК короба', 'ШК ВБ'] as const
const WB_EXTERNAL_BOX_CODE_HEADERS = [
  'ШК короба для печати в стороннем сервисе',
  'ШК ВБ для других сервисов',
] as const

const normalizeWbBoxCode = (value: unknown): string => String(value ?? '').trim()

/**
 * Finds the two WB box-code columns by header. Every other column is ignored,
 * allowing the original WB workbook, a two-column copy or a larger hybrid
 * report to be imported without manual cleanup.
 */
export async function parseWbBoxCodesImportFile(file: File): Promise<WbBoxCodeExcelParseResult> {
  if (!/\.xlsx?$/i.test(file.name)) {
    return { rows: [], errors: ['Поддерживаются только файлы Excel .xlsx и .xls.'], sheetName: null }
  }
  if (file.size > 20 * 1024 * 1024) {
    return { rows: [], errors: ['Excel-файл больше 20 МБ.'], sheetName: null }
  }
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
  if (workbook.SheetNames.length === 0) {
    return { rows: [], errors: ['В Excel-файле нет листов.'], sheetName: null }
  }
  if (workbook.SheetNames.length !== 1) {
    return { rows: [], errors: [`В файле должен быть ровно один лист. Найдено: ${workbook.SheetNames.length}.`], sheetName: null }
  }

  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  // raw:false keeps the displayed text and prevents numeric-looking WB codes
  // from being coerced into JavaScript numbers.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  })
  const headerMatches: Array<{ rowIndex: number; codeIndex: number; externalCodeIndex: number }> = []
  const duplicateHeaderRows: number[] = []

  matrix.forEach((source, rowIndex) => {
    const headers = source.map(normalizeHeader)
    const codeIndexes = headers
      .map((header, index) => WB_BOX_CODE_HEADERS.some((candidate) => header === normalizeHeader(candidate)) ? index : -1)
      .filter((index) => index >= 0)
    const externalIndexes = headers
      .map((header, index) => WB_EXTERNAL_BOX_CODE_HEADERS.some((candidate) => header === normalizeHeader(candidate)) ? index : -1)
      .filter((index) => index >= 0)
    if (codeIndexes.length > 1 || externalIndexes.length > 1) duplicateHeaderRows.push(rowIndex + 1)
    if (codeIndexes.length === 1 && externalIndexes.length === 1 && codeIndexes[0] !== externalIndexes[0]) {
      headerMatches.push({ rowIndex, codeIndex: codeIndexes[0], externalCodeIndex: externalIndexes[0] })
    }
  })

  if (duplicateHeaderRows.length > 0) {
    return { rows: [], errors: [`Нужные заголовки повторяются в строке ${duplicateHeaderRows.join(', ')}.`], sheetName }
  }
  if (headerMatches.length === 0) {
    return {
      rows: [],
      errors: ['Не найдены обе обязательные колонки: «ШК короба» и «ШК короба для печати в стороннем сервисе».'],
      sheetName,
    }
  }
  if (headerMatches.length > 1) {
    return {
      rows: [],
      errors: [`Найдено несколько возможных строк заголовков: ${headerMatches.map((match) => match.rowIndex + 1).join(', ')}.`],
      sheetName,
    }
  }

  const [{ rowIndex: headerRowIndex, codeIndex, externalCodeIndex }] = headerMatches
  const rows: WbBoxCodeExcelRow[] = []
  const errors: string[] = []
  const firstRowByCode = new Map<string, number>()
  const firstRowByExternalCode = new Map<string, number>()

  matrix.slice(headerRowIndex + 1).forEach((source, offset) => {
    const sourceRow = headerRowIndex + offset + 2
    const codeCell = worksheet[XLSX.utils.encode_cell({ r: sourceRow - 1, c: codeIndex })]
    const externalCell = worksheet[XLSX.utils.encode_cell({ r: sourceRow - 1, c: externalCodeIndex })]
    const code = normalizeWbBoxCode(source[codeIndex])
    const externalCode = normalizeWbBoxCode(source[externalCodeIndex])
    if (codeCell?.f || externalCell?.f || codeCell?.t === 'e' || externalCell?.t === 'e') {
      errors.push(`Строка ${sourceRow}: ШК WB должны быть обычным текстом, без формул и ошибок Excel.`)
      return
    }
    if (!code && !externalCode) return
    if (!code || !externalCode) {
      errors.push(`Строка ${sourceRow}: заполните оба ШК WB.`)
      return
    }
    if (code.length > 512 || externalCode.length > 512) {
      errors.push(`Строка ${sourceRow}: ШК WB слишком длинный.`)
      return
    }
    const duplicateRow = firstRowByCode.get(code)
    if (duplicateRow !== undefined) {
      errors.push(`Строка ${sourceRow}: ШК короба «${code}» уже указан в строке ${duplicateRow}.`)
      return
    }
    firstRowByCode.set(code, sourceRow)
    const duplicateExternalRow = firstRowByExternalCode.get(externalCode)
    if (duplicateExternalRow !== undefined) {
      errors.push(`Строка ${sourceRow}: ШК для печати «${externalCode}» уже указан в строке ${duplicateExternalRow}.`)
      return
    }
    firstRowByExternalCode.set(externalCode, sourceRow)
    rows.push({ sourceRow, boxNumber: rows.length + 1, code, externalCode })
  })

  if (rows.length === 0 && errors.length === 0) {
    errors.push('В найденных колонках нет ни одного ШК короба WB.')
  }
  return { rows, errors, sheetName }
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
  if (!firstSheetName) return { rows: [], boxNumbers: [], errors: ['В Excel-файле нет листов.'] }

  const worksheet = workbook.Sheets[firstSheetName]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  })
  if (matrix.length === 0) return { rows: [], boxNumbers: [], errors: ['Excel-файл пустой.'] }

  const headers = (matrix[0] ?? []).map(normalizeHeader)
  const indexes = REQUIRED_HEADERS.map((header) => headers.indexOf(normalizeHeader(header)))
  const missingHeaders = REQUIRED_HEADERS.filter((_, index) => indexes[index] < 0)
  if (missingHeaders.length > 0) {
    return { rows: [], boxNumbers: [], errors: [`Не найдены обязательные колонки: ${missingHeaders.join(', ')}.`] }
  }

  const [barcodeIndex, qtyIndex, boxIndex] = indexes
  const rows: FulfillmentBoxExcelRow[] = []
  const boxNumbers = new Set<number>()
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
    // Строка только с номером означает короб без содержимого. Существующий
    // короб она не очищает, а отсутствующий — создаёт пустым.
    if (!boxEmpty && barcodeEmpty && qtyEmpty) {
      const boxNumber = normalizeIntegerCell(boxValue)
      if (boxNumber === null || boxNumber < 1 || boxNumber > 2_147_483_647) {
        errors.push(`Строка ${sourceRow}: номер короба должен быть положительным целым числом.`)
        return
      }
      boxNumbers.add(boxNumber)
      return
    }
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
    boxNumbers.add(boxNumber)
    rows.push({ sourceRow, barcode, qty, boxNumber })
  })

  if (boxNumbers.size === 0 && errors.length === 0) errors.push('В файле нет ни одного номера короба для загрузки.')
  return { rows, boxNumbers: [...boxNumbers].sort((left, right) => left - right), errors }
}

export function aggregateFulfillmentBoxExcelRows(
  rows: FulfillmentBoxExcelRow[],
  boxNumbers: number[] = [],
): FulfillmentBoxExcelImportRow[] {
  const aggregated = new Map<string, FulfillmentBoxExcelImportRow>()
  const boxesWithContent = new Set<number>()
  rows.forEach((row) => {
    boxesWithContent.add(row.boxNumber)
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
  boxNumbers.forEach((boxNumber) => {
    if (boxesWithContent.has(boxNumber)) return
    aggregated.set(`${boxNumber}:`, { barcode: '', qty: 0, box_number: boxNumber })
  })
  return [...aggregated.values()].sort((left, right) =>
    left.box_number - right.box_number || left.barcode.localeCompare(right.barcode),
  )
}
