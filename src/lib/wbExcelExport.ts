import * as XLSX from 'xlsx'
import type { FulfillmentSupplyWithBoxes } from '../types'
import { applyExcelWorksheetStandards } from './excelStandards'

const buildGoodsRows = (supply: FulfillmentSupplyWithBoxes): (string | number)[][] => {
  const map = new Map<string, number>()
  for (const box of supply.boxes) {
    for (const item of box.items) map.set(item.barcode, (map.get(item.barcode) ?? 0) + item.qty)
  }
  return [
    ['Баркод', 'Количество'],
    ...Array.from(map.entries()).map(([barcode, quantity]) => [barcode, quantity]),
  ]
}

export const buildWbBoxesRows = (supply: FulfillmentSupplyWithBoxes): (string | number)[][] => {
  const boxes = [...supply.boxes].sort((left, right) => left.box_number - right.box_number)
  if (boxes.length === 0) throw new Error('В поставке нет коробов.')
  const codes = boxes.map((box) => box.wb_barcode?.trim() ?? '')
  const externalCodes = boxes.map((box) => box.wb_external_barcode?.trim() ?? '')
  const missing = boxes
    .filter((_, index) => !codes[index] || !externalCodes[index])
    .map((box) => box.box_number)
  if (missing.length > 0) {
    throw new Error(`Отсутствуют ШК WB для коробов: ${missing.map((number) => `№${number}`).join(', ')}.`)
  }
  const rows: (string | number)[][] = [[
    'Баркод товара',
    'Кол-во товаров',
    'ШК короба',
    'Срок годности',
    'ШК короба для печати в стороннем сервисе',
  ]]
  boxes.forEach((box, index) => {
    const wbCode = codes[index]
    const externalCode = externalCodes[index]
    if (box.items.length === 0) {
      rows.push(['', 0, wbCode, '', externalCode])
      return
    }
    box.items.forEach((item) => rows.push([item.barcode, item.qty, wbCode, '', externalCode]))
  })
  return rows
}

/**
 * Шаблон 1 — Добавление товаров в поставку WB
 * Колонки: Баркод | Количество
 * Один баркод = одна строка, кол-во суммируется по всем коробам
 */
export function downloadGoodsTemplate(supply: FulfillmentSupplyWithBoxes, filename = 'товары_barcode.xlsx'): void {
  const rows = buildGoodsRows(supply)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  applyExcelWorksheetStandards(XLSX.utils, ws)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}

/**
 * Шаблон 2 — Распределение товаров по коробам
 * Колонки: Баркод товара | Кол-во товаров | ШК короба | Срок годности | ШК короба для печати в стороннем сервисе
 * Both WB code columns come only from the verified Excel mapping stored on
 * each ELESTET box. API package order is never used here.
 */
export function downloadBoxesTemplate(
  supply: FulfillmentSupplyWithBoxes,
  filename = 'короба_Box.xlsx',
): void {
  const rows = buildWbBoxesRows(supply)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  applyExcelWorksheetStandards(XLSX.utils, ws)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}

export function downloadAllTemplates(
  supply: FulfillmentSupplyWithBoxes,
  filename = 'товары_и_короба_barcode_Box.xlsx',
): void {
  const workbook = XLSX.utils.book_new()
  const goodsSheet = XLSX.utils.aoa_to_sheet(buildGoodsRows(supply))
  const boxesSheet = XLSX.utils.aoa_to_sheet(buildWbBoxesRows(supply))
  applyExcelWorksheetStandards(XLSX.utils, goodsSheet)
  applyExcelWorksheetStandards(XLSX.utils, boxesSheet)
  XLSX.utils.book_append_sheet(workbook, goodsSheet, 'По баркодам')
  XLSX.utils.book_append_sheet(workbook, boxesSheet, 'По коробам')
  XLSX.writeFile(workbook, filename)
}
