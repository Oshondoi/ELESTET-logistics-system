import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  LABEL_FIELDS,
  blocksForMode,
  blocksPastGuides,
  clampGuideSide,
  edgeGuides,
  examplePage,
  innerBox,
  labelSizeMm,
  renderSheet,
  shiftUnderGuides,
  type GuideSide,
  type LabelBlock,
  type LabelBlockType,
  type LabelGuides,
  type LabelMode,
  type LabelSizeId,
  type LabelTemplate,
} from '../../lib/labelSheet'
import { createLabelTemplate, deleteLabelTemplate, fetchLabelTemplates, saveLabelTemplate } from '../../services/labelTemplateService'

const SCALE = 8
const RULER = 22

type Snap = { blocks: LabelBlock[]; guides: LabelGuides }

const fieldClass = 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium leading-5 text-slate-900 outline-none'

function sameBlocks(a: LabelBlock[], b: LabelBlock[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sameGuides(a: LabelGuides, b: LabelGuides): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left
}

function roundGuides(guides: LabelGuides): LabelGuides {
  const round = (value: number) => Math.round(value * 10) / 10
  return { top: round(guides.top), right: round(guides.right), bottom: round(guides.bottom), left: round(guides.left) }
}

function sizeLabel(size: LabelSizeId): string {
  return size === '120x75' ? '120×75 мм' : '58×40 мм'
}

function modeLabel(mode: LabelMode): string {
  return mode === 'barcode' ? 'Штрихкод' : mode === 'kiz' ? 'КИЗ' : 'КИЗ + штрихкод'
}

function RulerMarks({ length, vertical, nearStart = false }: { length: number; vertical: boolean; nearStart?: boolean }) {
  const marks = []
  for (let mm = 0; mm <= length + 0.01; mm += 5) {
    const major = mm % 10 === 0
    marks.push(
      <span
        key={mm}
        className="absolute bg-slate-300"
        style={vertical
          ? { top: mm * SCALE, [nearStart ? 'left' : 'right']: 0, width: major ? 8 : 4, height: 1 }
          : { left: mm * SCALE, [nearStart ? 'top' : 'bottom']: 0, width: 1, height: major ? 8 : 4 }}
      />,
    )
    if (major) {
      marks.push(
        <span
          key={`n-${mm}`}
          className="absolute text-[9px] leading-none text-slate-400"
          style={vertical ? { top: mm * SCALE + 2, left: 1 } : { left: mm * SCALE + 2, top: 2 }}
        >
          {mm}
        </span>,
      )
    }
  }
  return <>{marks}</>
}

export function LabelConstructor({
  accountId,
  bindLeave,
}: {
  accountId: string
  bindLeave: (ask: (then: () => void) => void) => void
}) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [size, setSize] = useState<LabelSizeId>('58x40')
  const [mode, setMode] = useState<LabelMode>('combined')
  const [draft, setDraft] = useState<LabelTemplate | null>(null)
  const [savedName, setSavedName] = useState('')
  const [savedBlocks, setSavedBlocks] = useState<LabelBlock[]>([])
  const [savedGuides, setSavedGuides] = useState<LabelGuides>(edgeGuides())
  const [undo, setUndo] = useState<Snap[]>([])
  const [redo, setRedo] = useState<Snap[]>([])
  const [leave, setLeave] = useState<(() => void | Promise<void>) | null>(null)
  const [pendingRemove, setPendingRemove] = useState<LabelTemplate | null>(null)
  const [guidePreview, setGuidePreview] = useState<LabelGuides | null>(null)
  const [guideSide, setGuideSide] = useState<GuideSide | null>(null)
  const [guideAsk, setGuideAsk] = useState<LabelGuides | null>(null)
  const [busy, setBusy] = useState(false)
  const [minH, setMinH] = useState<number>()
  const rootRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const places = useRef(new Map<LabelBlockType, LabelBlock>())
  const guideLive = useRef<LabelGuides | null>(null)
  const guideDrag = useRef<{ side: GuideSide; origin: LabelGuides; start: number } | null>(null)
  const guideListen = useRef<(() => void) | null>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean; origin: Snap } | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const dirty = Boolean(draft && (
    draft.name.trim() !== savedName
    || !sameBlocks(draft.blocks, savedBlocks)
    || !sameGuides(draft.guides, savedGuides)
  ))

  const reload = async () => {
    setLoading(true)
    setError('')
    try {
      setTemplates(await fetchLabelTemplates(accountId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось прочитать шаблоны.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [accountId])

  useEffect(() => () => guideListen.current?.(), [])

  useEffect(() => {
    bindLeave((then) => {
      if (!dirty) then()
      else setLeave(() => then)
    })
  }, [bindLeave, dirty])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => {
      const scroller = el.closest('.overflow-y-scroll')
      if (!(scroller instanceof HTMLElement)) return
      const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      setMinH(Math.max(320, scroller.clientHeight - offset))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    const canvas = previewRef.current
    if (!draft || !canvas) return
    const drawn = renderSheet(draft, examplePage())
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = drawn.canvas.width
    canvas.height = drawn.canvas.height
    ctx.drawImage(drawn.canvas, 0, 0)
  }, [draft])

  const openDraft = (template: LabelTemplate) => {
    setDraft(template)
    setSavedName(template.name)
    setSavedBlocks(template.blocks)
    setSavedGuides(template.guides)
    setUndo([])
    setRedo([])
    setGuidePreview(null)
    setGuideSide(null)
    setGuideAsk(null)
    setError('')
    places.current = new Map()
  }

  const commit = (next: Snap) => {
    const base = draftRef.current
    if (!base) return
    setUndo((stack) => [...stack, { blocks: base.blocks, guides: base.guides }])
    setRedo([])
    setDraft({ ...base, blocks: next.blocks, guides: next.guides })
  }

  const persist = async (template: LabelTemplate) => {
    const saved = await saveLabelTemplate(template)
    setTemplates((list) => list.map((item) => item.id === saved.id ? saved : item))
    setDraft(saved)
    setSavedName(saved.name)
    setSavedBlocks(saved.blocks)
    setSavedGuides(saved.guides)
    setUndo([])
    setRedo([])
    return saved
  }

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const created = await createLabelTemplate(accountId, name, size, mode)
      setTemplates((list) => [created, ...list])
      setName('')
      openDraft(created)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать шаблон.')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      await persist(draft)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить шаблон.')
    } finally {
      setBusy(false)
    }
  }

  const saveAndLeave = async () => {
    if (!draft || !leave) return
    const next = leave
    setBusy(true)
    setError('')
    try {
      await persist(draft)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить шаблон.')
      setBusy(false)
      return
    }
    setLeave(null)
    setDraft(null)
    try {
      await next()
    } finally {
      setBusy(false)
    }
  }

  const askOpen = (template: LabelTemplate) => {
    if (draft?.id === template.id) return
    if (!dirty) openDraft(template)
    else setLeave(() => () => openDraft(template))
  }

  const askCreate = () => {
    if (busy || !name.trim()) return
    if (!dirty) void create()
    else setLeave(() => () => create())
  }

  const remove = async (template: LabelTemplate) => {
    setBusy(true)
    setError('')
    try {
      await deleteLabelTemplate(template.id)
      setTemplates((list) => list.filter((item) => item.id !== template.id))
      if (draft?.id === template.id) {
        setDraft(null)
        setUndo([])
        setRedo([])
        setLeave(null)
        setGuidePreview(null)
        setGuideSide(null)
        setGuideAsk(null)
        places.current = new Map()
      }
      setPendingRemove(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось удалить шаблон.')
    } finally {
      setBusy(false)
    }
  }

  const sheet = draft ? labelSizeMm(draft.size) : null
  const shownGuides = guidePreview ?? draft?.guides ?? edgeGuides()
  const fields = draft ? blocksForMode(draft.mode) : []

  const toggleBlock = (type: LabelBlockType) => {
    if (!draft || !sheet) return
    const existing = draft.blocks.find((block) => block.type === type)
    if (existing) {
      places.current.set(type, existing)
      commit({ blocks: draft.blocks.filter((block) => block.type !== type), guides: draft.guides })
      return
    }
    const field = LABEL_FIELDS.find((item) => item.type === type)
    if (!field) return
    const box = innerBox(sheet, draft.guides)
    if (box.w < 4 || box.h < 2) {
      setError('Между линейками нет места для этого поля.')
      return
    }
    const remembered = places.current.get(type)
    const w = Math.min(remembered?.w ?? field.w, box.w)
    const h = Math.min(remembered?.h ?? field.h, box.h)
    const x = remembered
      ? Math.max(box.x, Math.min(box.x + box.w - w, remembered.x))
      : box.x + (box.w - w) / 2
    const y = remembered
      ? Math.max(box.y, Math.min(box.y + box.h - h, remembered.y))
      : box.y + (box.h - h) / 2
    commit({
      guides: draft.guides,
      blocks: [...draft.blocks, { id: remembered?.id ?? `${type}-${Date.now()}`, type, x, y, w, h }],
    })
  }

  const onPointerDown = (event: ReactPointerEvent, block: LabelBlock) => {
    if (!draft || !sheet || guideAsk) return
    const rect = sheetRef.current?.getBoundingClientRect()
    if (!rect) return
    drag.current = {
      id: block.id,
      dx: event.clientX - rect.left - block.x * SCALE,
      dy: event.clientY - rect.top - block.y * SCALE,
      moved: false,
      origin: { blocks: draft.blocks, guides: draft.guides },
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent) => {
    const current = drag.current
    if (!current || !draft || !sheet) return
    const rect = sheetRef.current?.getBoundingClientRect()
    if (!rect) return
    const block = draft.blocks.find((item) => item.id === current.id)
    if (!block) return
    const box = innerBox(sheet, draft.guides)
    const x = Math.max(box.x, Math.min(box.x + box.w - block.w, (event.clientX - rect.left - current.dx) / SCALE))
    const y = Math.max(box.y, Math.min(box.y + box.h - block.h, (event.clientY - rect.top - current.dy) / SCALE))
    if (Math.abs(x - block.x) > 0.2 || Math.abs(y - block.y) > 0.2) current.moved = true
    setDraft({ ...draft, blocks: draft.blocks.map((item) => item.id === block.id ? { ...item, x, y } : item) })
  }

  const onPointerUp = () => {
    const current = drag.current
    drag.current = null
    if (!current?.moved || !draft) return
    setUndo((stack) => [...stack, current.origin])
    setRedo([])
  }

  const onGuideDown = (event: ReactPointerEvent, side: GuideSide) => {
    const base = draftRef.current
    if (!base || !sheet || guideAsk) return
    event.stopPropagation()
    event.preventDefault()
    guideListen.current?.()
    setGuideSide(side)
    guideDrag.current = {
      side,
      origin: base.guides,
      start: side === 'left' || side === 'right' ? event.clientX : event.clientY,
    }
    guideLive.current = base.guides
    setGuidePreview(base.guides)
    const move = (pointer: PointerEvent) => {
      const current = guideDrag.current
      const live = draftRef.current
      if (!current || !live) return
      const delta = ((current.side === 'left' || current.side === 'right' ? pointer.clientX : pointer.clientY) - current.start) / SCALE
      const next = { ...current.origin }
      if (current.side === 'top') next.top = current.origin.top + delta
      if (current.side === 'bottom') next.bottom = current.origin.bottom - delta
      if (current.side === 'left') next.left = current.origin.left + delta
      if (current.side === 'right') next.right = current.origin.right - delta
      const clamped = clampGuideSide(roundGuides(next), current.side, sheet, live.blocks)
      guideLive.current = clamped
      setGuidePreview(clamped)
    }
    const up = () => {
      guideListen.current?.()
      guideListen.current = null
      const current = guideDrag.current
      guideDrag.current = null
      const live = draftRef.current
      const next = guideLive.current
      guideLive.current = null
      if (!current || !live || !next || sameGuides(next, current.origin)) {
        setGuidePreview(null)
        setGuideSide(null)
        return
      }
      if (blocksPastGuides(live.blocks, sheet, next).length === 0) {
        commit({ blocks: live.blocks, guides: next })
        setGuidePreview(null)
        setGuideSide(null)
        return
      }
      setGuidePreview(next)
      setGuideAsk(next)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    guideListen.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }

  const confirmGuide = () => {
    if (!draft || !guideAsk || !sheet) return
    commit({ blocks: shiftUnderGuides(draft.blocks, sheet, guideAsk), guides: guideAsk })
    setGuideAsk(null)
    setGuidePreview(null)
    setGuideSide(null)
  }

  const undoStep = () => {
    const current = draftRef.current
    if (!current || undo.length === 0) return
    const previous = undo[undo.length - 1]
    setUndo((stack) => stack.slice(0, -1))
    setRedo((stack) => [...stack, { blocks: current.blocks, guides: current.guides }])
    setGuidePreview(null)
    setGuideSide(null)
    setGuideAsk(null)
    setDraft({ ...current, blocks: previous.blocks, guides: previous.guides })
  }

  const redoStep = () => {
    const current = draftRef.current
    if (!current || redo.length === 0) return
    const next = redo[redo.length - 1]
    setRedo((stack) => stack.slice(0, -1))
    setGuidePreview(null)
    setGuideSide(null)
    setGuideAsk(null)
    setUndo((stack) => [...stack, { blocks: current.blocks, guides: current.guides }])
    setDraft({ ...current, blocks: next.blocks, guides: next.guides })
  }

  return (
    <div ref={rootRef} className="flex w-full items-stretch" style={minH ? { minHeight: minH } : undefined}>
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200">
        <p className="px-3 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Шаблоны</p>
        {loading ? <p className="px-3 py-3 text-sm text-slate-400">Загрузка шаблонов…</p> : templates.length === 0 ? (
          <p className="px-3 py-3 text-sm text-slate-400">Сохранённых шаблонов нет</p>
        ) : (
          <div className="flex flex-col py-2">
            {templates.map((template) => (
              <div key={template.id} className={`flex items-start gap-1 px-2 py-1 ${draft?.id === template.id ? 'bg-blue-50' : ''}`}>
                <button type="button" onClick={() => askOpen(template)} className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
                  <p className="truncate text-sm font-medium text-slate-800">{template.name}</p>
                  <p className="truncate text-xs text-slate-400">{template.size === '120x75' ? '120×75' : '58×40'} · {modeLabel(template.mode)}</p>
                </button>
                <button type="button" disabled={busy} onClick={() => setPendingRemove(template)} className="elestet-btn elestet-btn-compact mt-1">Удалить</button>
              </div>
            ))}
          </div>
        )}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">Название
            <input value={name} onChange={(event) => setName(event.target.value)} className={`${fieldClass} w-40`} />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">Размер
            <select value={size} onChange={(event) => setSize(event.target.value as LabelSizeId)} className={fieldClass}>
              <option value="58x40">58×40 мм</option>
              <option value="120x75">120×75 мм, Ozon</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">Вид
            <select value={mode} onChange={(event) => setMode(event.target.value as LabelMode)} className={fieldClass}>
              <option value="barcode">Штрихкод</option>
              <option value="kiz">КИЗ</option>
              <option value="combined">КИЗ + штрихкод</option>
            </select>
          </label>
          <button type="button" disabled={busy || !name.trim()} onClick={askCreate} className="elestet-btn elestet-btn-primary">Создать</button>
          {draft && (
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">Шаблон
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={`${fieldClass} w-40`} />
              </label>
              <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium leading-5 text-slate-600">{sizeLabel(draft.size)}</span>
              <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium leading-5 text-slate-600">{modeLabel(draft.mode)}</span>
              <button type="button" disabled={undo.length === 0} onClick={undoStep} className="elestet-btn">Назад</button>
              <button type="button" disabled={redo.length === 0} onClick={redoStep} className="elestet-btn">Вперёд</button>
              <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="elestet-btn elestet-btn-primary">Сохранить</button>
            </div>
          )}
        </div>
        {error && <p className="mx-4 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}
        <div className="flex min-h-0 flex-1 items-stretch">
          {draft && (
            <div className="w-56 shrink-0 border-r border-slate-200 px-3 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Данные</p>
              <div className="flex flex-col">
                {fields.map((type) => {
                  const field = LABEL_FIELDS.find((item) => item.type === type)!
                  const checked = draft.blocks.some((block) => block.type === type)
                  return (
                    <label key={type} className="flex items-center gap-2 py-1.5 text-sm text-slate-700">
                      <input type="checkbox" checked={checked} onChange={() => toggleBlock(type)} className="h-4 w-4 rounded border-slate-300" />
                      <span>{field.title}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          <div className="min-w-0 flex-1">
        {draft && sheet ? (
          <div className="p-4">
            <div className="relative" style={{ width: sheet.w * SCALE + RULER * 2, height: sheet.h * SCALE + RULER * 2 }}>
              <div className="absolute overflow-hidden border-b border-slate-200 bg-slate-50" style={{ left: RULER, top: 0, width: sheet.w * SCALE, height: RULER }}>
                <RulerMarks length={sheet.w} vertical={false} />
              </div>
              <div className="absolute overflow-hidden border-t border-slate-200 bg-slate-50" style={{ left: RULER, bottom: 0, width: sheet.w * SCALE, height: RULER }}>
                <RulerMarks length={sheet.w} vertical={false} nearStart />
              </div>
              <div className="absolute overflow-hidden border-r border-slate-200 bg-slate-50" style={{ left: 0, top: RULER, width: RULER, height: sheet.h * SCALE }}>
                <RulerMarks length={sheet.h} vertical />
              </div>
              <div className="absolute overflow-hidden border-l border-slate-200 bg-slate-50" style={{ right: 0, top: RULER, width: RULER, height: sheet.h * SCALE }}>
                <RulerMarks length={sheet.h} vertical nearStart />
              </div>
              <div
                ref={sheetRef}
                className="absolute border border-slate-300 bg-white shadow-sm"
                style={{ left: RULER, top: RULER, width: sheet.w * SCALE, height: sheet.h * SCALE }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <canvas ref={previewRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                {guidePreview && guideSide && (
                  <span
                    className={`pointer-events-none absolute z-20 border-blue-500 ${guideSide === 'left' || guideSide === 'right' ? 'bottom-0 top-0 border-l' : 'left-0 right-0 border-t'}`}
                    style={guideSide === 'top'
                      ? { top: shownGuides.top * SCALE }
                      : guideSide === 'bottom'
                        ? { top: (sheet.h - shownGuides.bottom) * SCALE }
                        : guideSide === 'left'
                          ? { left: shownGuides.left * SCALE }
                          : { left: (sheet.w - shownGuides.right) * SCALE }}
                  />
                )}
                {draft.blocks.map((block) => {
                  const field = LABEL_FIELDS.find((item) => item.type === block.type)
                  return (
                    <button
                      key={block.id}
                      type="button"
                      onPointerDown={(event) => onPointerDown(event, block)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      className="absolute z-10 touch-none border border-blue-400/70 bg-white/20 text-left"
                      style={{ left: block.x * SCALE, top: block.y * SCALE, width: block.w * SCALE, height: block.h * SCALE }}
                    >
                      <span className="pointer-events-none absolute left-1 top-0 text-[10px] font-medium text-blue-700">{field?.title}</span>
                      <span
                        role="button"
                        className="absolute right-0 top-0 px-1 text-xs text-slate-500"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => toggleBlock(block.type)}
                      >×</span>
                    </button>
                  )
                })}
              </div>
              {([
                ['left', { left: RULER + shownGuides.left * SCALE, top: RULER / 2, width: 8, height: 18, cursor: 'ew-resize' }],
                ['right', { left: RULER + (sheet.w - shownGuides.right) * SCALE, top: RULER / 2, width: 8, height: 18, cursor: 'ew-resize' }],
                ['top', { left: RULER / 2, top: RULER + shownGuides.top * SCALE, width: 18, height: 8, cursor: 'ns-resize' }],
                ['bottom', { left: RULER / 2, top: RULER + (sheet.h - shownGuides.bottom) * SCALE, width: 18, height: 8, cursor: 'ns-resize' }],
              ] as Array<[GuideSide, CSSProperties]>).map(([side, style]) => (
                <span
                  key={side}
                  role="slider"
                  aria-label={side}
                  className="absolute z-30 touch-none rounded-full bg-blue-600"
                  style={{ ...style, transform: 'translate(-50%, -50%)' }}
                  onPointerDown={(event) => onGuideDown(event, side)}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="p-4 text-sm text-slate-400">Выберите шаблон слева.</p>
        )}
          </div>
        </div>
      </div>
      {leave && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-base font-semibold text-slate-900">Выйти без сохранения?</p>
            <p className="mt-1 text-sm text-slate-500">Изменения этого шаблона не запишутся.</p>
            <div className="mt-5 grid grid-cols-3 items-center gap-2">
              <button type="button" disabled={busy} onClick={() => void saveAndLeave()} className="elestet-btn elestet-btn-primary justify-self-start">Сохранить и выйти</button>
              <button type="button" onClick={() => setLeave(null)} className="elestet-btn justify-self-center">Отмена</button>
              <button type="button" onClick={() => { const next = leave; setLeave(null); setDraft(null); void next() }} className="elestet-btn justify-self-end">Выйти без сохранения</button>
            </div>
          </div>
        </div>
      )}
      {pendingRemove && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-base font-semibold text-slate-900">Удалить шаблон «{pendingRemove.name}»?</p>
            <p className="mt-1 text-sm text-slate-500">Шаблон исчезнет из списка компании.</p>
            <div className="mt-5 flex items-center justify-between gap-2">
              <button type="button" disabled={busy} onClick={() => void remove(pendingRemove)} className="elestet-btn elestet-btn-primary">Удалить</button>
              <button type="button" onClick={() => setPendingRemove(null)} className="elestet-btn">Отмена</button>
            </div>
          </div>
        </div>
      )}
      {guideAsk && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-base font-semibold text-slate-900">Сдвинуть линейку?</p>
            <p className="mt-1 text-sm text-slate-500">Элементы внутри сдвинутся автоматически под линейку.</p>
            <div className="mt-5 flex items-center justify-between gap-2">
              <button type="button" onClick={confirmGuide} className="elestet-btn elestet-btn-primary">Сдвинуть</button>
              <button type="button" onClick={() => { setGuideAsk(null); setGuidePreview(null); setGuideSide(null) }} className="elestet-btn">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
