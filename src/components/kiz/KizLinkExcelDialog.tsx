import { useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { kizSizeRows, saveKizBarcodeLink, type KizBarcodeLink, type KizGtinCard, type KizWbProduct } from '../../services/kizLinkService'
import { downloadKizLinkTemplate, parseKizLinkExcel, planKizLinkWrites, type KizLinkExcelRow } from '../../lib/kizLinkExcel'

export function KizLinkExcelDialog({
  storeId,
  products,
  gtins,
  links,
  onClose,
  onApplied,
}: {
  storeId: string
  products: KizWbProduct[]
  gtins: KizGtinCard[]
  links: KizBarcodeLink[]
  onClose: () => void
  onApplied: () => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<KizLinkExcelRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState<'template' | 'read' | 'save' | null>(null)

  const knownBarcodes = new Set(products.flatMap((product) => kizSizeRows(product).map((row) => row.barcode)).filter((barcode) => barcode && barcode !== '—'))
  const knownGtins = new Set(gtins.map((card) => card.gtin))
  const checked = rows.flatMap((row) => {
    const rowErrors: string[] = []
    if (!knownBarcodes.has(row.barcode)) rowErrors.push(`Строка ${row.sourceRow}: баркод ${row.barcode} не найден среди размеров этого магазина.`)
    if (!knownGtins.has(row.gtin)) rowErrors.push(`Строка ${row.sourceRow}: GTIN ${row.gtin} нет среди товаров Teksher. Сначала обновите товары КИЗ.`)
    return rowErrors
  })
  const plan = planKizLinkWrites(rows, links.map((link) => ({ barcode: link.wb_barcode, gtin: link.gtin })))
  const blocked = errors.length > 0 || checked.length > 0 || plan.errors.length > 0 || rows.length === 0

  async function download() {
    setBusy('template')
    setErrors([])
    try { await downloadKizLinkTemplate() }
    catch { setErrors(['Не удалось скачать шаблон Excel.']) }
    finally { setBusy(null) }
  }

  async function read(file: File) {
    setBusy('read')
    setRows([])
    setErrors([])
    setFileName(file.name)
    try {
      const parsed = await parseKizLinkExcel(file)
      setErrors(parsed.errors)
      if (parsed.errors.length === 0) setRows(parsed.rows)
    } catch {
      setErrors(['Не удалось прочитать Excel-файл.'])
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function apply() {
    if (blocked || busy) return
    setBusy('save')
    setErrors([])
    try {
      for (const row of plan.order) await saveKizBarcodeLink(storeId, row.barcode, row.gtin)
      await onApplied()
      onClose()
    } catch (failure: unknown) {
      setErrors([failure instanceof Error ? failure.message : 'Не удалось записать связки.'])
    } finally {
      setBusy(null)
    }
  }

  const messages = [...errors, ...checked, ...plan.errors]

  return (
    <Modal
      open
      onClose={onClose}
      title="Действия с Excel"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50">Закрыть</button>
          <button type="button" disabled={blocked || Boolean(busy)} onClick={() => void apply()} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy === 'save' ? 'Связываем…' : 'Связать'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void read(file) }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" disabled={Boolean(busy)} onClick={() => void download()} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left hover:border-emerald-400 disabled:opacity-50">
            <span className="block text-sm font-black text-emerald-800">Скачать шаблон</span>
            <span className="mt-1 block text-xs leading-relaxed text-emerald-700">Две колонки: сначала «Баркод», затем «GTIN».</span>
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()} className="rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-slate-400 disabled:opacity-50">
            <span className="block text-sm font-black text-slate-800">Загрузить Excel</span>
            <span className="mt-1 block text-xs leading-relaxed text-slate-500">Один лист, до 20 МБ. Баркод и GTIN — текстом.</span>
          </button>
        </div>
        {fileName && <p className="truncate text-sm font-medium text-slate-700">{fileName}</p>}
        {messages.length > 0 && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-bold">Excel не применён</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">{messages.map((message) => <li key={message}>{message}</li>)}</ul>
          </div>
        )}
        {rows.length > 0 && messages.length === 0 && (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Будет связано: {plan.order.length}. Уже такие же: {rows.length - plan.order.length}.</p>
            <div className="max-h-64 overflow-y-auto">
              {rows.map((row) => (
                <div key={`${row.sourceRow}-${row.barcode}`} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 text-sm last:border-0">
                  <span className="font-mono text-xs text-slate-500">{row.barcode}</span>
                  <span className="font-mono text-xs text-emerald-700">{row.gtin}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
