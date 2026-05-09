import * as XLSX from 'xlsx'
import type { FulfillmentSupplyWithBoxes } from '../types'

/**
 * Шаблон 1 — Добавление товаров в поставку WB
 * Колонки: Баркод | Количество
 * Один баркод = одна строка, кол-во суммируется по всем коробам
 */
export function downloadGoodsTemplate(supply: FulfillmentSupplyWithBoxes, filename = 'товары.xlsx'): void {
  const map = new Map<string, number>()
  for (const box of supply.boxes) {
    for (const item of box.items) {
      map.set(item.barcode, (map.get(item.barcode) ?? 0) + item.qty)
    }
  }

  const rows: (string | number)[][] = [
    ['Баркод', 'Количество'],
    ...Array.from(map.entries()).map(([b, q]) => [b, q]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 20 }, { wch: 14 }]
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
  const sortedCodes = [...wbBoxCodes].sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10) || 0
    const nb = parseInt(b.replace(/\D/g, ''), 10) || 0
    return na - nb
  })

  const sortedBoxes = [...supply.boxes].sort((a, b) => a.box_number - b.box_number)

  const rows: (string | number)[][] = [
    ['Баркод товара', 'Кол-во товаров', 'ШК короба', 'Срок годности'],
  ]

  for (let i = 0; i < sortedBoxes.length; i++) {
    const box = sortedBoxes[i]
    const wbCode = sortedCodes[i] ?? ''
    for (const item of box.items) {
      rows.push([item.barcode, item.qty, wbCode, ''])
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 16 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}
