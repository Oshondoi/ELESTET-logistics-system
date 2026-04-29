import JsBarcode from 'jsbarcode'
import jsPDF from 'jspdf'

/**
 * Генерирует PDF со штрихкодами WB-поставки.
 * Каждый штрихкод повторяется quantity раз. Размер стикера 58×40 мм (стандарт WB).
 */
export function buildWbBarcodesPdf(
  barcodes: { barcode: string; quantity: number }[],
  supplyId: string,
): Blob {
  const items = barcodes.flatMap((b) => Array(Math.max(1, b.quantity)).fill(b.barcode) as string[])

  const W_MM = 58
  const H_MM = 40
  const pdf = new jsPDF({ unit: 'mm', format: [W_MM, H_MM], orientation: 'landscape' })

  items.forEach((code, idx) => {
    if (idx > 0) pdf.addPage([W_MM, H_MM], 'landscape')

    const safeCode = code.replace(/[^0-9]/g, '')
    const canvas = document.createElement('canvas')
    try {
      JsBarcode(canvas, safeCode, {
        format: safeCode.length === 13 ? 'EAN13' : 'CODE128',
        height: 80,
        width: 2,
        displayValue: true,
        fontSize: 18,
        margin: 4,
      })
    } catch {
      // если штрихкод не EAN13 — пробуем CODE128
      try {
        JsBarcode(canvas, safeCode, {
          format: 'CODE128',
          height: 80,
          width: 2,
          displayValue: true,
          fontSize: 18,
          margin: 4,
        })
      } catch {
        return
      }
    }

    const dataUrl = canvas.toDataURL('image/png')
    // Поставка — мелким шрифтом сверху
    pdf.setFontSize(7)
    pdf.text(`Поставка ${supplyId}`, 2, 4)
    // Штрихкод
    pdf.addImage(dataUrl, 'PNG', 2, 6, W_MM - 4, H_MM - 10)
  })

  return pdf.output('blob')
}
