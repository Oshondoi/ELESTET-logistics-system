import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PhotoThumb } from '../ui/PhotoThumb'
import {
  describeOrder,
  formatBoxRanges,
  planWorkshop,
  workshopGapNumbers,
  type WorkshopOrderLine,
  type WorkshopPlanVariant,
} from '../../lib/workshopPlan'
import {
  fetchKizOrderSources,
  kizPhotoUrl,
  kizProductMatches,
  kizSizeRows,
  type KizWbProduct,
} from '../../services/kizLinkService'
import {
  addWorkshopShells,
  completeWorkshop,
  confirmWorkshopSupply,
  fetchWorkshop,
  reopenWorkshop,
  scanWorkshopBox,
  startWorkshop,
  type WorkshopBox,
  type WorkshopState,
} from '../../services/workshopService'

type WarehouseOption = { id: string; name: string }

type Props = {
  batchId: string
  storeId: string | null
  pipelineStageId: string | null
  warehouses: WarehouseOption[]
  enabled: boolean
  mode?: 'scan' | 'plan'
  showLauncher?: boolean
  onClose?: () => void
  onSupplyCreated: () => Promise<void> | void
}

const TIER_TITLE: Record<WorkshopPlanVariant['tier'], string> = {
  ideal: 'Идеально',
  covered: 'Без минуса',
  short: 'С минусом',
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

function formatPieces(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return String(Math.round(value))
}

export function WorkshopPacking({
  batchId,
  storeId,
  pipelineStageId,
  warehouses,
  enabled,
  mode = 'scan',
  showLauncher = true,
  onClose,
  onSupplyCreated,
}: Props) {
  const [open, setOpen] = useState(!showLauncher)
  const close = () => {
    setOpen(false)
    onClose?.()
  }
  const [state, setState] = useState<WorkshopState>({ pool: null, boxes: [] })
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [jump, setJump] = useState('')
  const [scan, setScan] = useState('')
  const [gaps, setGaps] = useState<number[] | null>(null)
  const [products, setProducts] = useState<KizWbProduct[]>([])
  const [productQuery, setProductQuery] = useState('')
  const [manualBarcode, setManualBarcode] = useState('')
  const [lines, setLines] = useState<WorkshopOrderLine[]>([])
  const [variants, setVariants] = useState<WorkshopPlanVariant[] | null>(null)
  const [planNote, setPlanNote] = useState<string | null>(null)
  const [picked, setPicked] = useState(0)
  const [warehouseId, setWarehouseId] = useState('')
  const scanRef = useRef<HTMLInputElement>(null)
  const scanQueue = useRef(Promise.resolve())

  const reload = async () => {
    const next = await fetchWorkshop(batchId)
    setState(next)
    return next
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchWorkshop(batchId)
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, batchId])

  useEffect(() => {
    if (!open || !storeId || products.length > 0) return
    let cancelled = false
    void fetchKizOrderSources(storeId)
      .then((sources) => {
        if (!cancelled) setProducts(sources.products)
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message || 'Не удалось загрузить товары')
      })
    return () => {
      cancelled = true
    }
  }, [open, storeId, products.length])

  const boxByNumber = useMemo(() => {
    const map = new Map<number, WorkshopBox>()
    for (const box of state.boxes) map.set(box.box_number, box)
    return map
  }, [state.boxes])

  const nameByBarcode = useMemo(() => {
    const map = new Map<string, string>()
    for (const product of products) {
      const name = product.name?.trim() || product.vendor_code || `Артикул ${product.nm_id}`
      for (const row of kizSizeRows(product)) {
        if (row.barcode && row.barcode !== '—') map.set(row.barcode, `${name} · ${row.techSize}`)
      }
    }
    return map
  }, [products])

  const numbers = useMemo(() => {
    if (state.pool?.active) {
      return Array.from({ length: state.pool.issued_count }, (_, index) => index + 1)
    }
    return state.boxes
      .filter((box) => box.items.length > 0)
      .map((box) => box.box_number)
  }, [state])

  const filledNumbers = useMemo(
    () => state.boxes.filter((box) => box.items.length > 0).map((box) => box.box_number),
    [state.boxes],
  )

  const freeBoxes = useMemo(
    () => state.boxes.filter((box) => box.supply_id == null && box.items.length > 0),
    [state.boxes],
  )

  const stockByBarcode = useMemo(() => {
    const map = new Map<string, number>()
    for (const box of freeBoxes) {
      for (const item of box.items) map.set(item.barcode, (map.get(item.barcode) ?? 0) + item.qty)
    }
    return map
  }, [freeBoxes])

  const described = useMemo(() => describeOrder(lines), [lines])
  const liveError = described.error === 'Добавьте товары' ? null : described.error
  const targetByBarcode = useMemo(() => {
    const map = new Map<string, { pieces: number | null; percent: number | null }>()
    for (const target of described.targets) map.set(target.barcode, target)
    return map
  }, [described.targets])

  const matches = useMemo(() => {
    const query = productQuery.trim()
    if (!query) return []
    return products.filter((product) => kizProductMatches(product, query)).slice(0, 40)
  }, [products, productQuery])

  const selectedBox = selected == null ? undefined : boxByNumber.get(selected)
  const selectedTaken = Boolean(selectedBox?.supply_id)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не получилось. Повторите.')
    } finally {
      setBusy(false)
    }
  }

  const chooseBox = (number: number) => {
    setSelected(number)
    setNotice(null)
    setTimeout(() => scanRef.current?.focus(), 0)
  }

  const stepBox = (delta: number) => {
    if (numbers.length === 0) return
    if (selected == null) {
      chooseBox(delta > 0 ? numbers[0] : numbers[numbers.length - 1])
      return
    }
    const next = numbers[numbers.indexOf(selected) + delta]
    if (next != null) chooseBox(next)
  }

  const submitScan = (raw: string) => {
    const barcode = raw.trim()
    setScan('')
    if (!state.pool?.active || barcode.length < 4) return
    if (selected == null) {
      setNotice('Сначала выберите короб')
      return
    }
    if (selectedTaken) {
      setNotice('Этот короб уже в поставке')
      return
    }
    const productName = nameByBarcode.get(barcode) ?? ''
    const boxNumber = selected
    scanQueue.current = scanQueue.current.then(async () => {
      try {
        await scanWorkshopBox(batchId, boxNumber, barcode, productName)
        await reload()
        setNotice(productName ? `${productName} · 1 шт.` : `${barcode} · 1 шт.`)
        setError(null)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Не получилось записать скан')
      }
    })
  }

  const askComplete = () => {
    const missing = workshopGapNumbers(filledNumbers)
    if (missing.length > 0) {
      setGaps(missing)
      return
    }
    void run(async () => {
      await completeWorkshop(batchId)
      setNotice('Пустые короба убраны. Номера заполненных на месте.')
    })
  }

  const addLine = (barcode: string, name: string) => {
    if (!barcode || barcode === '—') return
    setLines((current) => {
      if (current.some((line) => line.barcode === barcode)) return current
      return [...current, { barcode, name, mode: 'pieces', amount: 0 }]
    })
    setVariants(null)
    setPlanNote(null)
  }

  const searchPlan = () => {
    if (described.error || described.targets.length === 0) {
      setPlanNote(described.error ?? 'Добавьте товары')
      setVariants(null)
      return
    }
    const found = planWorkshop(
      freeBoxes.map((box) => ({
        boxNumber: box.box_number,
        lines: box.items.map((item) => ({ barcode: item.barcode, qty: item.qty })),
      })),
      described.targets,
    )
    setVariants(found)
    setPicked(0)
    setPlanNote(found.length === 0 ? 'Подходящих свободных коробов нет.' : null)
  }

  const confirmPlan = () => {
    const variant = variants?.[picked]
    const warehouse = warehouses.find((item) => item.id === warehouseId)
    if (!variant || !warehouse) return
    void run(async () => {
      await confirmWorkshopSupply(
        batchId,
        variant.boxNumbers,
        warehouse.id,
        warehouse.name,
        pipelineStageId,
      )
      await onSupplyCreated()
      setVariants(null)
      setNotice(`Поставка на ${warehouse.name} собрана. В ней короба 1–${variant.boxNumbers.length}.`)
    })
  }

  if (!enabled && showLauncher) return null

  return (
    <>
      {showLauncher && <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-700">Сбор в цехе</div>
            <div className="mt-1 text-xs text-slate-500">
              Свои номера коробов. Сканируют в цехе, поставку собирают здесь же. Старые поставки ниже не меняются.
            </div>
          </div>
          <button type="button" className="elestet-btn elestet-btn-primary" onClick={() => setOpen(true)}>
            Открыть
          </button>
        </div>
      </div>}
      {open && createPortal(
        <div className="fixed inset-0 z-[160] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className={`my-4 w-full rounded-2xl bg-white shadow-xl ${mode === 'scan' ? 'max-w-lg' : 'max-w-5xl'}`}>
            <div className="flex items-center justify-end gap-2 px-4 pt-4">
              {mode === 'plan' && <div className="mr-auto text-base font-semibold text-slate-800">Поставка</div>}
              {mode === 'scan' && !state.pool && (
                <button type="button" className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600" disabled={busy} onClick={() => void run(() => startWorkshop(batchId))}>
                  100 коробов
                </button>
              )}
              {mode === 'scan' && state.pool?.active && (
                <>
                  <button type="button" className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600" disabled={busy} onClick={() => void run(() => addWorkshopShells(batchId))}>
                    +50
                  </button>
                  <button type="button" className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600" disabled={busy} onClick={askComplete}>
                    Завершить
                  </button>
                </>
              )}
              {mode === 'scan' && state.pool && !state.pool.active && (
                <button type="button" className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600" disabled={busy} onClick={() => void run(() => reopenWorkshop(batchId))}>
                  Продолжить
                </button>
              )}
              <button type="button" className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600" onClick={close}>Закрыть</button>
            </div>

            {error && <div className="mx-4 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            {loading && <div className="px-5 py-6 text-sm text-slate-500">Загрузка…</div>}

            {!loading && mode === 'scan' && state.pool && (
              <div className="px-6 pb-6 pt-2">
                <div className="flex items-center justify-center gap-6">
                  <button type="button" className="flex h-12 w-12 items-center justify-center rounded-full text-3xl text-slate-400 hover:bg-slate-100" onClick={() => stepBox(-1)} aria-label="Предыдущий короб">‹</button>
                  <div className="min-w-[7rem] text-center text-7xl font-semibold leading-none text-slate-900">{selected ?? '—'}</div>
                  <button type="button" className="flex h-12 w-12 items-center justify-center rounded-full text-3xl text-slate-400 hover:bg-slate-100" onClick={() => stepBox(1)} aria-label="Следующий короб">›</button>
                </div>
                {selectedBox?.supply_id && (
                  <div className="mt-2 text-center text-sm text-amber-700">
                    Поставка {selectedBox.supply_number ?? '—'}{selectedBox.supply_box_number ? `, короб ${selectedBox.supply_box_number}` : ''}
                  </div>
                )}
                <form
                  className="mt-4 flex justify-center"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const number = Number(jump)
                    if (!Number.isInteger(number) || !numbers.includes(number)) {
                      setNotice('Такого короба нет')
                      return
                    }
                    chooseBox(number)
                    setJump('')
                  }}
                >
                  <input
                    data-workshop-scan="1"
                    className="h-10 w-28 rounded-xl border border-slate-200 text-center text-sm outline-none focus:border-blue-300"
                    inputMode="numeric"
                    placeholder="Номер"
                    value={jump}
                    onChange={(event) => setJump(event.target.value.replace(/\D/g, ''))}
                  />
                </form>
                <input
                  ref={scanRef}
                  data-workshop-scan="1"
                  className="mt-4 h-12 w-full rounded-xl border border-slate-200 px-3 text-center text-lg outline-none focus:border-blue-300"
                  placeholder="Скан"
                  value={scan}
                  disabled={!state.pool.active || selectedTaken}
                  onChange={(event) => setScan(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      submitScan(scan)
                    }
                  }}
                />
                {notice && <div className="mt-2 text-center text-sm text-slate-600">{notice}</div>}
                <div className="mt-4 space-y-1">
                  {(selectedBox?.items ?? []).map((item) => (
                    <div key={item.barcode} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-slate-700">{item.product_name || item.barcode}</span>
                      <span className="font-medium text-slate-800">{item.qty}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!loading && mode === 'plan' && (
              <div className="space-y-4 px-5 py-4">
                {notice && <div className="text-sm text-slate-600">{notice}</div>}
                <input
                  className="elestet-search w-full"
                  placeholder="Артикул WB, артикул продавца, штрихкод или название"
                  value={productQuery}
                  onChange={(event) => setProductQuery(event.target.value)}
                />
                {matches.length > 0 && (
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 p-2">
                    {matches.flatMap((product) => {
                      const name = product.name?.trim() || product.vendor_code || `Артикул ${product.nm_id}`
                      return kizSizeRows(product).map((row) => (
                        <button
                          key={row.rowKey}
                          type="button"
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-50"
                          onClick={() => addLine(row.barcode, `${name} · ${row.techSize}`)}
                        >
                          <PhotoThumb url={kizPhotoUrl(product.photos)} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-slate-800">{name}</span>
                            <span className="block text-xs text-slate-500">
                              {row.techSize} · {row.barcode}
                              {product.vendor_code ? ` · ${product.vendor_code}` : ''}
                            </span>
                          </span>
                        </button>
                      ))
                    })}
                  </div>
                )}
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const barcode = manualBarcode.trim()
                    if (barcode.length < 4) return
                    addLine(barcode, nameByBarcode.get(barcode) || barcode)
                    setManualBarcode('')
                  }}
                >
                  <input
                    className="elestet-search flex-1"
                    placeholder="Или введите штрихкод"
                    value={manualBarcode}
                    onChange={(event) => setManualBarcode(event.target.value)}
                  />
                  <button type="submit" className="elestet-btn">Добавить</button>
                </form>
                {lines.length > 0 && (
                  <div className="space-y-2">
                    {lines.map((line) => {
                      const target = targetByBarcode.get(line.barcode)
                      const piecesValue = line.mode === 'pieces' ? String(line.amount || '') : formatPieces(target?.pieces ?? null).replace('—', '')
                      const percentValue = line.mode === 'percent' ? String(line.amount || '') : (target?.percent == null ? '' : String(Math.round(target.percent * 10) / 10))
                      return (
                        <div key={line.barcode} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm text-slate-800">{line.name}</div>
                              <div className="text-xs text-slate-500">
                                {line.barcode}
                                {stockByBarcode.has(line.barcode) ? ` · в свободных коробах ${stockByBarcode.get(line.barcode)} шт.` : ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="text-xs text-slate-400"
                              onClick={() => {
                                setLines((current) => current.filter((item) => item.barcode !== line.barcode))
                                setVariants(null)
                              }}
                            >
                              Убрать
                            </button>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="text-xs text-slate-500">
                              Штуки {line.mode === 'pieces' ? '· задано' : ''}
                              <input
                                className="elestet-search mt-1 w-full"
                                inputMode="numeric"
                                value={piecesValue}
                                onChange={(event) => {
                                  const amount = Number(event.target.value.replace(',', '.'))
                                  setLines((current) => current.map((item) => (
                                    item.barcode === line.barcode
                                      ? { ...item, mode: 'pieces', amount: Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0 }
                                      : item
                                  )))
                                  setVariants(null)
                                }}
                              />
                            </label>
                            <label className="text-xs text-slate-500">
                              Процент {line.mode === 'percent' ? '· задано' : ''}
                              <input
                                className="elestet-search mt-1 w-full"
                                inputMode="decimal"
                                value={percentValue}
                                onChange={(event) => {
                                  const amount = Number(event.target.value.replace(',', '.'))
                                  setLines((current) => current.map((item) => (
                                    item.barcode === line.barcode
                                      ? { ...item, mode: 'percent', amount: Number.isFinite(amount) ? Math.max(0, amount) : 0 }
                                      : item
                                  )))
                                  setVariants(null)
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {liveError && <div className="text-sm text-rose-700">{liveError}</div>}
                <button type="button" className="elestet-btn elestet-btn-primary" disabled={Boolean(liveError)} onClick={searchPlan}>
                  Найти короба
                </button>
                {planNote && <div className="text-sm text-slate-600">{planNote}</div>}
                {variants && variants.length > 0 && (
                  <div className="space-y-3">
                    {warehouses.length === 0 && <div className="text-sm text-amber-700">Нет складов FBO.</div>}
                    <label className="block text-xs text-slate-500">
                      Склад
                      <select
                        className="elestet-search mt-1 w-full"
                        value={warehouseId}
                        onChange={(event) => setWarehouseId(event.target.value)}
                      >
                        <option value="">Выберите склад</option>
                        {warehouses.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                        ))}
                      </select>
                    </label>
                    {variants.map((variant, index) => (
                      <div
                        key={variant.tier}
                        className={`rounded-2xl border p-4 ${picked === index ? 'border-slate-900' : 'border-slate-200'}`}
                      >
                        <button type="button" className="w-full text-left" onClick={() => setPicked(index)}>
                          <div className="text-sm font-semibold text-slate-800">{TIER_TITLE[variant.tier]}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            Старые номера {formatBoxRanges(variant.boxNumbers)} станут в поставке 1–{variant.boxNumbers.length}.
                            {' '}Коробов: {variant.boxNumbers.length}.
                          </div>
                        </button>
                        <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-3 text-[11px] text-slate-400">
                          <span>Товар</span>
                          <span>штуки: заказ / факт</span>
                          <span>%: заказ / факт</span>
                        </div>
                        <div className="mt-1 space-y-1">
                          {variant.rows.map((row) => (
                            <div key={row.barcode || row.name} className="grid grid-cols-[1fr_auto_auto] gap-3 text-sm">
                              <span className="text-slate-700">{row.name}</span>
                              <span className="text-slate-500">
                                {formatPieces(row.orderedPieces)} / {formatPieces(row.pieces)} шт.
                              </span>
                              <span className="text-slate-500">
                                {formatPercent(row.orderedPercent)} / {formatPercent(row.percent)}
                              </span>
                            </div>
                          ))}
                        </div>
                        {picked === index && (
                          <button
                            type="button"
                            className="elestet-btn elestet-btn-primary mt-3"
                            disabled={busy || !warehouseId}
                            onClick={confirmPlan}
                          >
                            Собрать поставку
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {gaps && (
            <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-900/40 p-4">
              <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                <div className="text-base font-semibold text-slate-800">Есть пропуски</div>
                <p className="mt-2 text-sm text-slate-600">
                  Пропущены короба: {gaps.slice(0, 20).join(', ')}{gaps.length > 20 ? ` и ещё ${gaps.length - 20}` : ''}.
                  Пустые не сохранятся, номера заполненных не изменятся. Завершить всё равно?
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" className="elestet-btn" onClick={() => setGaps(null)}>Вернуться</button>
                  <button
                    type="button"
                    className="elestet-btn elestet-btn-primary"
                    disabled={busy}
                    onClick={() => {
                      setGaps(null)
                      void run(async () => {
                        await completeWorkshop(batchId)
                        setNotice('Сбор завершён. Пустые короба убраны, номера заполненных на месте.')
                      })
                    }}
                  >
                    Всё равно завершить
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
