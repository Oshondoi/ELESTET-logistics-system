import { applyExcelWorksheetStandards } from './excelStandards'

export type KizLinkWrite = { barcode: string; gtin: string }

export type KizLinkExcelRow = KizLinkWrite & { sourceRow: number }

const HEADERS = ['Баркод', 'GTIN'] as const
const MAX_BYTES = 20 * 1024 * 1024

const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('ru-RU')

export function planKizLinkWrites(desired: KizLinkWrite[], current: KizLinkWrite[]) {
  const errors: string[] = []
  const seenBarcode = new Set<string>()
  const seenGtin = new Set<string>()
  desired.forEach((row) => {
    if (seenBarcode.has(row.barcode)) errors.push(`Баркод ${row.barcode} указан дважды.`)
    seenBarcode.add(row.barcode)
    if (seenGtin.has(row.gtin)) errors.push(`GTIN ${row.gtin} указан для двух баркодов.`)
    seenGtin.add(row.gtin)
  })
  if (errors.length > 0) return { order: [] as KizLinkWrite[], errors }

  const active = new Map(current.map((row) => [row.barcode, row.gtin]))
  const holder = new Map<string, string>()
  active.forEach((gtin, barcode) => holder.set(gtin, barcode))
  const left = desired.filter((row) => active.get(row.barcode) !== row.gtin)
  const order: KizLinkWrite[] = []
  while (left.length > 0) {
    const readyIndex = left.findIndex((row) => {
      const owner = holder.get(row.gtin)
      return !owner || owner === row.barcode
    })
    if (readyIndex < 0) {
      left.forEach((row) => errors.push(`GTIN ${row.gtin} уже связан с баркодом ${holder.get(row.gtin)}. Сначала снимите ту связку.`))
      return { order: [], errors }
    }
    const [row] = left.splice(readyIndex, 1)
    const previous = active.get(row.barcode)
    if (previous) holder.delete(previous)
    active.set(row.barcode, row.gtin)
    holder.set(row.gtin, row.barcode)
    order.push(row)
  }
  return { order, errors }
}

export async function downloadKizLinkTemplate() {
  const XLSX = await import('xlsx')
  const rows = [HEADERS.slice(), ...Array.from({ length: 30 }, () => ['', ''])]
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  for (let row = 1; row <= 30; row += 1) {
    for (const column of [0, 1]) {
      const address = XLSX.utils.encode_cell({ r: row, c: column })
      worksheet[address] = { t: 's', v: '', z: '@' }
    }
  }
  applyExcelWorksheetStandards(XLSX.utils, worksheet, { textColumnHeaders: [...HEADERS], minWidth: 18 })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Связка')
  XLSX.writeFile(workbook, 'Связка_баркод_GTIN.xlsx')
}

export async function parseKizLinkExcel(file: File): Promise<{ rows: KizLinkExcelRow[]; errors: string[] }> {
  if (!/\.xlsx?$/i.test(file.name)) return { rows: [], errors: ['Поддерживаются только файлы Excel .xlsx и .xls.'] }
  if (file.size > MAX_BYTES) return { rows: [], errors: ['Excel-файл больше 20 МБ.'] }
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
  if (workbook.SheetNames.length !== 1) {
    return { rows: [], errors: [`В файле должен быть ровно один лист. Найдено: ${workbook.SheetNames.length}.`] }
  }
  const sheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[sheetName]
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false, defval: '', blankrows: true })
  const headerMatches: Array<{ rowIndex: number; barcodeIndex: number; gtinIndex: number }> = []
  matrix.forEach((source, rowIndex) => {
    const headers = source.map(normalizeHeader)
    const barcodeIndex = headers.findIndex((header) => header === 'баркод')
    const gtinIndex = headers.findIndex((header) => header === 'gtin' || header === 'жтин')
    const barcodeCount = headers.filter((header) => header === 'баркод').length
    const gtinCount = headers.filter((header) => header === 'gtin' || header === 'жтин').length
    if (barcodeCount > 1 || gtinCount > 1) headerMatches.push({ rowIndex: -rowIndex - 1, barcodeIndex, gtinIndex })
    else if (barcodeIndex >= 0 && gtinIndex >= 0 && barcodeIndex !== gtinIndex) headerMatches.push({ rowIndex, barcodeIndex, gtinIndex })
  })
  if (headerMatches.some((match) => match.rowIndex < 0)) return { rows: [], errors: ['Заголовок «Баркод» или «GTIN» повторяется.'] }
  if (headerMatches.length === 0) return { rows: [], errors: ['Не найдены колонки «Баркод» и «GTIN». Первая — баркод, вторая — GTIN.'] }
  if (headerMatches.length > 1) return { rows: [], errors: ['Найдено несколько строк заголовков. Оставьте одну.'] }
  const [{ rowIndex, barcodeIndex, gtinIndex }] = headerMatches
  const rows: KizLinkExcelRow[] = []
  const errors: string[] = []
  matrix.slice(rowIndex + 1).forEach((source, offset) => {
    const sourceRow = rowIndex + offset + 2
    const barcodeCell = worksheet[XLSX.utils.encode_cell({ r: sourceRow - 1, c: barcodeIndex })]
    const gtinCell = worksheet[XLSX.utils.encode_cell({ r: sourceRow - 1, c: gtinIndex })]
    if (barcodeCell?.f || gtinCell?.f || barcodeCell?.t === 'e' || gtinCell?.t === 'e' || barcodeCell?.t === 'n' || gtinCell?.t === 'n') {
      errors.push(`Строка ${sourceRow}: баркод и GTIN должны быть текстом, без формул и числового формата.`)
      return
    }
    const barcode = String(source[barcodeIndex] ?? '').trim()
    const gtinText = String(source[gtinIndex] ?? '').trim()
    if (!barcode && !gtinText) return
    if (!barcode || !gtinText) {
      errors.push(`Строка ${sourceRow}: заполните и баркод, и GTIN.`)
      return
    }
    if (!/^\d{8,14}$/.test(gtinText)) {
      errors.push(`Строка ${sourceRow}: GTIN должен содержать от 8 до 14 цифр.`)
      return
    }
    rows.push({ sourceRow, barcode, gtin: gtinText.padStart(14, '0') })
  })
  if (rows.length === 0 && errors.length === 0) errors.push('В файле нет ни одной связки.')
  return { rows, errors }
}
