/**
 * Открывает новую вкладку с EAN-13 штрихкодами для печати.
 * Использует JsBarcode через CDN — без npm-зависимостей.
 */
export function openBarcodePrintPage(barcodes: { barcode: string; quantity: number }[]) {
  const items = barcodes.flatMap((b) => Array(b.quantity).fill(b.barcode) as string[])

  if (items.length === 0) {
    return
  }

  const svgs = items
    .map((_, i) => `<div class="sticker"><svg id="bc${i}"></svg></div>`)
    .join('\n')

  const scripts = items
    .map((code, i) => {
      const safeCode = code.replace(/[^0-9]/g, '')
      return `JsBarcode("#bc${i}", "${safeCode}", {format:"EAN13",height:70,displayValue:true,fontSize:13,margin:5});`
    })
    .join('\n    ')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Штрихкоды WB</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
  <style>
    body { margin: 0; padding: 10px; font-family: Arial, sans-serif; background: #fff; }
    .sticker { display: inline-block; margin: 6px; padding: 8px; border: 1px solid #e5e7eb; text-align: center; vertical-align: top; }
    svg { display: block; }
    @media print {
      @page { margin: 5mm; }
      body { padding: 0; }
      .sticker { break-inside: avoid; border: none; margin: 2px; padding: 4px; }
    }
  </style>
</head>
<body>
  ${svgs}
  <script>
    window.addEventListener('load', function() {
      ${scripts}
    });
  <\/script>
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
