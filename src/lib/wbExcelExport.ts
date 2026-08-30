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

const sortedWbBoxCodes = (wbBoxCodes: string[]) => [...wbBoxCodes].sort((left, right) => {
  const leftNumber = parseInt(left.replace(/\D/g, ''), 10) || 0
  const rightNumber = parseInt(right.replace(/\D/g, ''), 10) || 0
  return leftNumber - rightNumber
})

const buildBoxesRows = (supply: FulfillmentSupplyWithBoxes, wbBoxCodes: string[]): (string | number)[][] => {
  const codes = sortedWbBoxCodes(wbBoxCodes)
  const boxes = [...supply.boxes].sort((left, right) => left.box_number - right.box_number)
  const rows: (string | number)[][] = [['Баркод товара', 'Кол-во товаров', 'ШК короба', 'Срок годности']]
  boxes.forEach((box, index) => {
    const wbCode = codes[index] ?? ''
    box.items.forEach((item) => rows.push([item.barcode, item.qty, wbCode, '']))
  })
  return rows
}

/**
 * Шаблон 1 — Добавление товаров в поставку WB
 * Колонки: Баркод | Количество
 * Один баркод = одна строка, кол-во суммируется по всем коробам
 */
export function downloadGoodsTemplate(supply: FulfillmentSupplyWithBoxes, filename = 'товары.xlsx'): void {
  const rows = buildGoodsRows(supply)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  applyExcelWorksheetStandards(XLSX.utils, ws)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}

/**
 * Шаблон 2 — Распределение товаров по коробам
 * Колонки: Баркод товара | Кол-во товара | ШК короба | Срок годности
 * wbBoxCodes — список штрихкодов коробов WB (WB_XXXXXXXXX) отсортированных по возрастанию.
 * Они сопоставляются с нашими коробами по box_number (1→WB_min, 2→WB_next и т.д.)
 */
export function downloadBoxesTemplate(
  supply: FulfillmentSupplyWithBoxes,
  wbBoxCodes: string[],
  filename = 'короба.xlsx',
): void {
  const rows = buildBoxesRows(supply, wbBoxCodes)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  applyExcelWorksheetStandards(XLSX.utils, ws)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}

export function downloadAllTemplates(
  supply: FulfillmentSupplyWithBoxes,
  wbBoxCodes: string[],
  filename = 'товары_и_короба.xlsx',
): void {
  const workbook = XLSX.utils.book_new()
  const goodsSheet = XLSX.utils.aoa_to_sheet(buildGoodsRows(supply))
  const boxesSheet = XLSX.utils.aoa_to_sheet(buildBoxesRows(supply, wbBoxCodes))
  applyExcelWorksheetStandards(XLSX.utils, goodsSheet)
  applyExcelWorksheetStandards(XLSX.utils, boxesSheet)
  XLSX.utils.book_append_sheet(workbook, goodsSheet, 'По баркодам')
  XLSX.utils.book_append_sheet(workbook, boxesSheet, 'По коробам')
  XLSX.writeFile(workbook, filename)
}
