import type { WorkSheet } from 'xlsx'

type XlsxUtils = typeof import('xlsx')['utils']

interface ExcelWorksheetStandardsOptions {
  headerRow?: number
  textColumnHeaders?: string[]
  textColumnIndexes?: number[]
  minWidth?: number
  maxWidth?: number
}

const IDENTIFIER_HEADER_PATTERN = /(?:^|\s|[№#])(баркод|штрих.?код|шк|артикул|заказ\s*№|номер\s+заказа|поставка\s*wb|id\s+поставки|wb\s*supply|order\s*id|nm\s*id|chrt\s*id|vendor\s*code)(?:$|\s|[№#])/i

const normalizedHeader = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('ru-RU')

const displayLength = (value: unknown) => {
  const lines = String(value ?? '').split(/\r?\n/)
  return Math.max(0, ...lines.map((line) => Array.from(line).length))
}

/**
 * Applies the global ELESTET rules to a SheetJS worksheet:
 * - identifier columns are stored as text;
 * - every column is auto-fitted to its header and content.
 */
export function applyExcelWorksheetStandards(
  utils: XlsxUtils,
  worksheet: WorkSheet,
  options: ExcelWorksheetStandardsOptions = {},
): WorkSheet {
  if (!worksheet['!ref']) return worksheet

  const range = utils.decode_range(worksheet['!ref'])
  const headerRow = options.headerRow ?? range.s.r
  const explicitHeaders = new Set((options.textColumnHeaders ?? []).map(normalizedHeader))
  const textColumns = new Set(options.textColumnIndexes ?? [])

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const headerCell = worksheet[utils.encode_cell({ r: headerRow, c: column })]
    const header = normalizedHeader(headerCell?.v)
    if (explicitHeaders.has(header) || IDENTIFIER_HEADER_PATTERN.test(header)) textColumns.add(column)
  }

  const widths: number[] = []
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = utils.encode_cell({ r: row, c: column })
      const cell = worksheet[address]
      if (!cell) continue
      if (row > headerRow && textColumns.has(column) && cell.v !== null && cell.v !== undefined && cell.v !== '') {
        cell.v = String(cell.v)
        cell.t = 's'
        delete cell.w
      }
      const length = displayLength(cell.w ?? cell.v)
      widths[column] = Math.max(widths[column] ?? 0, length)
    }
  }

  const minWidth = options.minWidth ?? 8
  const maxWidth = options.maxWidth ?? 60
  worksheet['!cols'] = Array.from(
    { length: range.e.c + 1 },
    (_, column) => ({ wch: Math.min(Math.max((widths[column] ?? minWidth) + 2, minWidth), maxWidth) }),
  )
  return worksheet
}
