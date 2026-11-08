import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import {
  DAY_WIDTH,
  addMonths,
  clipToRange,
  defaultRange,
  diffDays,
  eachDay,
  formatISODate,
  formatRuDate,
  isWeekend,
  monthLabel,
  parseISODate,
  startOfDay,
  weekdayLabel,
  type CalendarRange,
} from '../lib/workshopCalendar'
import {
  deleteWorkshopOccupancy,
  fetchWorkshopOccupancies,
  upsertWorkshopOccupancy,
  type WorkshopOccupancy,
} from '../services/workshopCalendarService'

const LANE_HEIGHT = 46
const BAR_HEIGHT = 20
const FACT_SHIFT_X = 6
const FACT_SHIFT_Y = 8
const PLAN_COLOR = '#2563eb'
const FACT_COLOR = '#6d28d9'

type EditorState = {
  id: string | null
  title: string
  planStart: string
  planEnd: string
  factStart: string
  factEnd: string
}

type CameraMode = 'today' | 'start' | 'preserve'

function emptyEditor(day = formatISODate(startOfDay(new Date()))): EditorState {
  return { id: null, title: '', planStart: day, planEnd: day, factStart: '', factEnd: '' }
}

function editorFromItem(item: WorkshopOccupancy): EditorState {
  return {
    id: item.id,
    title: item.title,
    planStart: item.planStart,
    planEnd: item.planEnd,
    factStart: item.factStart ?? '',
    factEnd: item.factEnd ?? '',
  }
}

function validate(editor: EditorState): string | null {
  const title = editor.title.trim()
  if (!title) return 'Введите название занятости.'
  if (!editor.planStart || !editor.planEnd) return 'Укажите обе даты плана.'
  if (editor.planEnd < editor.planStart) return 'Дата конца плана раньше даты начала.'
  const hasFactStart = Boolean(editor.factStart)
  const hasFactEnd = Boolean(editor.factEnd)
  if (hasFactStart !== hasFactEnd) return 'Для факта нужны обе даты, либо оставьте оба поля пустыми.'
  if (hasFactStart && hasFactEnd && editor.factEnd < editor.factStart) return 'Дата конца факта раньше даты начала.'
  return null
}

function barStyle(startIndex: number, endIndex: number, shiftX = 0) {
  const left = startIndex * DAY_WIDTH + 3 + shiftX
  const width = Math.max((endIndex - startIndex + 1) * DAY_WIDTH - 6, 8)
  return { left, width }
}

export function WorkshopCalendarPage({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const today = useMemo(() => startOfDay(new Date()), [])
  const todayIso = formatISODate(today)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const [rowSpace, setRowSpace] = useState(0)
  const cameraRef = useRef<CameraMode>('today')
  const scrollAdjustRef = useRef(0)
  const [applied, setApplied] = useState<CalendarRange>(() => defaultRange())
  const [draftStart, setDraftStart] = useState(applied.start)
  const [draftEnd, setDraftEnd] = useState(applied.end)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [items, setItems] = useState<WorkshopOccupancy[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const loadedAccountRef = useRef(accountId)
  if (loadedAccountRef.current !== accountId) {
    loadedAccountRef.current = accountId
    const next = defaultRange()
    setApplied(next)
    setDraftStart(next.start)
    setDraftEnd(next.end)
    setItems([])
    setIsLoading(true)
    setLoadError(null)
    setRangeError(null)
    setEditor(null)
    setEditorError(null)
    setConfirmDelete(false)
    cameraRef.current = 'today'
  }

  const rangeStart = parseISODate(applied.start)
  const rangeEnd = parseISODate(applied.end)
  const days = useMemo(() => eachDay(rangeStart, rangeEnd), [applied.start, applied.end])

  const months = useMemo(() => {
    const groups: { label: string; days: number }[] = []
    for (const day of days) {
      const label = monthLabel(day)
      const last = groups[groups.length - 1]
      if (last?.label === label) last.days += 1
      else groups.push({ label, days: 1 })
    }
    return groups
  }, [days])

  const lanes = useMemo(() => {
    const placed: { item: WorkshopOccupancy; lane: number }[] = []
    const sorted = [...items].sort((a, b) => a.planStart.localeCompare(b.planStart) || a.title.localeCompare(b.title, 'ru'))
    for (const item of sorted) {
      const starts = [item.planStart, item.factStart].filter((value): value is string => Boolean(value))
      const ends = [item.planEnd, item.factEnd].filter((value): value is string => Boolean(value))
      const union = clipToRange(
        starts.reduce((min, value) => value < min ? value : min, starts[0]),
        ends.reduce((max, value) => value > max ? value : max, ends[0]),
        rangeStart,
        rangeEnd,
      )
      if (!union) continue
      placed.push({ item, lane: placed.length })
    }
    return placed
  }, [items, applied.start, applied.end])

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    void fetchWorkshopOccupancies(accountId)
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setItems([])
          setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить занятости. Обновите страницу.')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [accountId])

  const placingRef = useRef(false)
  const [todayScroll, setTodayScroll] = useState(0)

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const header = headerRef.current
    if (!scroller || !header) return
    const measure = () => {
      const next = Math.max(0, Math.floor(scroller.clientHeight - header.offsetHeight))
      setRowSpace((current) => current === next ? current : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    observer.observe(header)
    return () => observer.disconnect()
  }, [accountId])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const place = () => {
      placingRef.current = true
      if (cameraRef.current === 'preserve') {
        scroller.scrollLeft += scrollAdjustRef.current
        scrollAdjustRef.current = 0
      } else if (cameraRef.current === 'start') {
        scroller.scrollLeft = 0
      } else {
        const start = parseISODate(applied.start)
        const todayIndex = diffDays(today, start)
        const dayCount = diffDays(parseISODate(applied.end), start) + 1
        scroller.scrollLeft = todayIndex < 0 || todayIndex >= dayCount
          ? 0
          : Math.max(0, todayIndex * DAY_WIDTH - scroller.clientWidth * 0.32)
      }
      placingRef.current = false
    }
    place()
    if (cameraRef.current === 'preserve') return
    const observer = new ResizeObserver(() => {
      if (cameraRef.current === 'preserve') return
      place()
    })
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [accountId, applied.start, applied.end, today, todayScroll])

  const saveEditor = () => {
    if (!editor || !accountId || isSaving) return
    const error = validate(editor)
    if (error) {
      setEditorError(error)
      return
    }
    const draft: WorkshopOccupancy = {
      id: editor.id ?? '',
      title: editor.title.trim(),
      planStart: editor.planStart,
      planEnd: editor.planEnd,
      factStart: editor.factStart || null,
      factEnd: editor.factEnd || null,
    }
    const companyId = accountId
    setIsSaving(true)
    setEditorError(null)
    void upsertWorkshopOccupancy(companyId, draft)
      .then((saved) => {
        if (loadedAccountRef.current !== companyId) return
        setItems((current) => editor.id ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved])
        setEditor(null)
      })
      .catch((saveError: unknown) => {
        setEditorError(saveError instanceof Error ? saveError.message : 'Не удалось записать занятость. Повторите.')
      })
      .finally(() => setIsSaving(false))
  }

  const deleteEditor = () => {
    if (!editor?.id || !accountId || isSaving) return
    const id = editor.id
    const companyId = accountId
    setIsSaving(true)
    setEditorError(null)
    void deleteWorkshopOccupancy(companyId, id)
      .then(() => {
        if (loadedAccountRef.current !== companyId) return
        setItems((current) => current.filter((item) => item.id !== id))
        setEditor(null)
        setConfirmDelete(false)
      })
      .catch((deleteError: unknown) => {
        setEditorError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить занятость. Повторите.')
      })
      .finally(() => setIsSaving(false))
  }

  const goToToday = () => {
    let start = rangeStart
    let end = rangeEnd
    for (let step = 0; today < start && step < 240; step += 1) start = addMonths(start, -1)
    for (let step = 0; today > end && step < 240; step += 1) end = addMonths(end, 1)
    if (today < start) start = today
    if (today > end) end = today
    cameraRef.current = 'today'
    scrollAdjustRef.current = 0
    const next = { start: formatISODate(start), end: formatISODate(end) }
    setDraftStart(next.start)
    setDraftEnd(next.end)
    setRangeError(null)
    setApplied(next)
    setTodayScroll((value) => value + 1)
  }

  const extendEarlier = () => {
    const nextStart = addMonths(rangeStart, -1)
    scrollAdjustRef.current = diffDays(rangeStart, nextStart) * DAY_WIDTH
    cameraRef.current = 'preserve'
    const start = formatISODate(nextStart)
    setApplied((current) => ({ ...current, start }))
    setDraftStart(start)
    setRangeError(null)
  }

  const extendLater = () => {
    const nextEnd = addMonths(rangeEnd, 1)
    scrollAdjustRef.current = 0
    cameraRef.current = 'preserve'
    const end = formatISODate(nextEnd)
    setApplied((current) => ({ ...current, end }))
    setDraftEnd(end)
    setRangeError(null)
  }

  const applyDraft = () => {
    if (!draftStart || !draftEnd) {
      setRangeError('Укажите обе даты диапазона.')
      return
    }
    if (draftEnd < draftStart) {
      setRangeError('Конец диапазона раньше начала.')
      return
    }
    const todayInside = todayIso >= draftStart && todayIso <= draftEnd
    cameraRef.current = todayInside ? 'today' : 'start'
    setApplied({ start: draftStart, end: draftEnd })
    setRangeError(null)
  }

  const resetRange = () => {
    const next = defaultRange(today)
    cameraRef.current = 'today'
    setApplied(next)
    setDraftStart(next.start)
    setDraftEnd(next.end)
    setRangeError(null)
  }

  const openCreate = (day = todayIso) => {
    if (!canManage || !accountId) return
    setEditor(emptyEditor(day))
    setEditorError(null)
    setConfirmDelete(false)
  }

  const occupiedRows = lanes.length
  const rowsFit = rowSpace > 0 && occupiedRows * LANE_HEIGHT <= rowSpace
  const laneHeight = occupiedRows === 0 || rowsFit ? (occupiedRows === 0 ? rowSpace : rowSpace / occupiedRows) : LANE_HEIGHT
  const bodyHeight = occupiedRows === 0 || rowsFit ? rowSpace : occupiedRows * LANE_HEIGHT
  const canvasWidth = days.length * DAY_WIDTH + FACT_SHIFT_X

  if (!accountId) {
    return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">Сначала выберите компанию.</div>
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-end gap-2">
        <Button type="button" variant="secondary" onClick={extendEarlier}>Раньше</Button>
        <Button type="button" variant="secondary" onClick={goToToday}>Сегодня</Button>
        <Button type="button" variant="secondary" onClick={extendLater}>Дальше</Button>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          С
          <input type="date" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-900" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          По
          <input type="date" value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-sm text-slate-900" />
        </label>
        <Button type="button" variant="secondary" onClick={applyDraft}>Показать</Button>
        <Button type="button" variant="ghost" onClick={resetRange}>Сбросить</Button>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-slate-600"><span className="h-2.5 w-4 rounded-sm" style={{ background: PLAN_COLOR }} />План</span>
          <span className="flex items-center gap-1.5 text-xs text-slate-600"><span className="h-2.5 w-4 rounded-sm" style={{ background: FACT_COLOR }} />Факт</span>
          <Button type="button" onClick={() => openCreate()} disabled={!canManage}>Занятость</Button>
        </div>
      </div>
      {rangeError ? <p className="text-sm text-rose-600">{rangeError}</p> : null}
      {loadError ? <p className="text-sm text-rose-600">{loadError}</p> : null}
      {isLoading ? <p className="text-sm text-slate-500">Загружаю занятости…</p> : null}

      <div
        ref={scrollerRef}
        onScroll={() => {
          if (!placingRef.current) cameraRef.current = 'preserve'
        }}
        className="min-h-0 w-full min-w-0 flex-1 overflow-x-auto overflow-y-auto rounded-2xl border border-slate-200 bg-white [scrollbar-gutter:stable]"
      >
        <div className="relative" style={{ width: canvasWidth }}>
          <div ref={headerRef} className="sticky top-0 z-30 bg-white">
          <div className="flex h-7 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
            {months.map((month) => (
              <div key={month.label + month.days} className="flex items-center border-r border-slate-200 px-2 capitalize" style={{ width: month.days * DAY_WIDTH }}>
                {month.label}
              </div>
            ))}
          </div>
          <div className="flex h-11 border-b border-slate-200">
            {days.map((day) => {
              const iso = formatISODate(day)
              const current = iso === todayIso
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => openCreate(iso)}
                  className={`flex shrink-0 flex-col items-center justify-center border-r border-slate-100 text-[11px] ${isWeekend(day) ? 'bg-slate-50 text-slate-400' : 'text-slate-600'} ${canManage ? 'hover:bg-blue-50' : ''}`}
                  style={{ width: DAY_WIDTH }}
                >
                  <span>{weekdayLabel(day)}</span>
                  <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${current ? 'bg-blue-600 text-white' : 'text-slate-800'}`}>{day.getDate()}</span>
                </button>
              )
            })}
          </div>
          </div>
          <div className="relative" style={{ height: bodyHeight }}>
            {days.map((day, index) => (
              <div
                key={formatISODate(day)}
                className={`absolute top-0 bottom-0 border-r border-slate-100 ${isWeekend(day) ? 'bg-slate-50' : ''}`}
                style={{ left: index * DAY_WIDTH, width: DAY_WIDTH }}
              />
            ))}
            {Array.from({ length: occupiedRows }, (_, index) => (
              <div key={index} className="absolute right-0 left-0 border-b border-slate-100" style={{ top: (index + 1) * laneHeight }} />
            ))}
            {todayIso >= applied.start && todayIso <= applied.end ? (
              <div className="absolute top-0 bottom-0 z-20 w-px bg-blue-600" style={{ left: diffDays(today, rangeStart) * DAY_WIDTH + DAY_WIDTH / 2 }} />
            ) : null}
            {lanes.map(({ item, lane }) => {
              const plan = clipToRange(item.planStart, item.planEnd, rangeStart, rangeEnd)
              const fact = item.factStart && item.factEnd ? clipToRange(item.factStart, item.factEnd, rangeStart, rangeEnd) : null
              const top = lane * laneHeight + 8
              const title = `${item.title}. План ${formatRuDate(item.planStart)} — ${formatRuDate(item.planEnd)}${item.factStart && item.factEnd ? `. Факт ${formatRuDate(item.factStart)} — ${formatRuDate(item.factEnd)}` : ''}`
              return (
                <div key={item.id}>
                  {fact ? (
                    <button
                      type="button"
                      title={title}
                      onClick={() => { setEditor(editorFromItem(item)); setEditorError(null); setConfirmDelete(false) }}
                      className="absolute z-10 rounded-md"
                      style={{ ...barStyle(fact.startIndex, fact.endIndex, FACT_SHIFT_X), top: top + FACT_SHIFT_Y, height: BAR_HEIGHT, background: FACT_COLOR }}
                    />
                  ) : null}
                  {plan ? (
                    <button
                      type="button"
                      title={title}
                      onClick={() => { setEditor(editorFromItem(item)); setEditorError(null); setConfirmDelete(false) }}
                      className="absolute z-10 truncate rounded-md px-1.5 text-left text-[11px] font-medium text-white"
                      style={{ ...barStyle(plan.startIndex, plan.endIndex), top, height: BAR_HEIGHT, background: PLAN_COLOR }}
                    >
                      {item.title}
                    </button>
                  ) : null}
                </div>
              )
            })}
            {occupiedRows === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">В этом диапазоне занятий нет.</div>
            ) : null}
          </div>
        </div>
      </div>

      <Modal
        open={editor !== null}
        title={editor?.id ? 'Занятость' : 'Новая занятость'}
        description="План рисуется спереди. Факт, если указан, виден сзади: чуть правее и ниже."
        onClose={() => setEditor(null)}
        footer={
          <div className="flex items-center justify-between gap-2">
            {editor?.id && canManage ? (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">Удалить эту занятость?</span>
                  <Button type="button" variant="secondary" onClick={deleteEditor} disabled={isSaving}>Удалить</Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>Отмена</Button>
                </div>
              ) : (
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>Удалить</Button>
              )
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditor(null)}>Закрыть</Button>
              {canManage ? <Button type="button" onClick={saveEditor} disabled={isSaving}>{isSaving ? 'Сохранение...' : 'Сохранить'}</Button> : null}
            </div>
          </div>
        }
      >
        {editor ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input label="Название" value={editor.title} disabled={!canManage} onChange={(event) => setEditor({ ...editor, title: event.target.value })} />
            </div>
            <Input label="План с" type="date" value={editor.planStart} disabled={!canManage} onChange={(event) => setEditor({ ...editor, planStart: event.target.value })} />
            <Input label="План по" type="date" value={editor.planEnd} disabled={!canManage} onChange={(event) => setEditor({ ...editor, planEnd: event.target.value })} />
            <Input label="Факт с" type="date" value={editor.factStart} disabled={!canManage} hint="Необязательно" onChange={(event) => setEditor({ ...editor, factStart: event.target.value })} />
            <Input label="Факт по" type="date" value={editor.factEnd} disabled={!canManage} hint="Необязательно" onChange={(event) => setEditor({ ...editor, factEnd: event.target.value })} />
            {editorError ? <p className="sm:col-span-2 text-sm text-rose-600">{editorError}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
