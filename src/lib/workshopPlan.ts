export type WorkshopPlanBox = {
  boxNumber: number
  lines: Array<{ barcode: string; qty: number }>
}

export type WorkshopOrderLine = {
  barcode: string
  name: string
  mode: 'pieces' | 'percent'
  amount: number
}

export type WorkshopTarget = {
  barcode: string
  name: string
  pieces: number | null
  percent: number | null
}

export type WorkshopPlanRow = {
  barcode: string
  name: string
  orderedPieces: number | null
  orderedPercent: number | null
  pieces: number
  percent: number
}

export type WorkshopPlanTier = 'ideal' | 'covered' | 'short'

export type WorkshopPlanVariant = {
  tier: WorkshopPlanTier
  boxNumbers: number[]
  extraPieces: number
  shortPieces: number
  rows: WorkshopPlanRow[]
}

const TIER_ORDER: WorkshopPlanTier[] = ['ideal', 'covered', 'short']
const ENUM_LIMIT = 16
const PERCENT_EXACT = 1
const PERCENT_SHORT = 0.5

export function workshopGapNumbers(filled: number[]): number[] {
  if (filled.length === 0) return []
  const have = new Set(filled)
  const max = Math.max(...filled)
  const gaps: number[] = []
  for (let number = 1; number < max; number += 1) {
    if (!have.has(number)) gaps.push(number)
  }
  return gaps
}

export function formatBoxRanges(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let start = sorted[0]
  let previous = sorted[0]
  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index]
    if (current === previous + 1) {
      previous = current
      continue
    }
    parts.push(start === previous ? String(start) : `${start}–${previous}`)
    start = current
    previous = current
  }
  return parts.join(', ')
}

function largestRemainder(total: number, weights: number[]): number[] {
  if (total <= 0 || weights.length === 0) return weights.map(() => 0)
  const sum = weights.reduce((acc, weight) => acc + weight, 0)
  if (sum <= 0) return weights.map(() => 0)
  const raw = weights.map((weight) => (total * weight) / sum)
  const floors = raw.map((value) => Math.floor(value))
  let left = total - floors.reduce((acc, value) => acc + value, 0)
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const item of order) {
    if (left <= 0) break
    floors[item.index] += 1
    left -= 1
  }
  return floors
}

export function describeOrder(lines: WorkshopOrderLine[]): { error: string | null; targets: WorkshopTarget[] } {
  const usable = lines.filter((line) => line.barcode.trim() && line.amount > 0)
  if (usable.length === 0) return { error: 'Добавьте товары', targets: [] }
  const seen = new Set<string>()
  for (const line of usable) {
    if (seen.has(line.barcode)) return { error: 'Один товар указан дважды', targets: [] }
    seen.add(line.barcode)
  }
  const percentLines = usable.filter((line) => line.mode === 'percent')
  const pieceLines = usable.filter((line) => line.mode === 'pieces')
  if (percentLines.some((line) => line.amount > 100)) {
    return { error: 'Процент одной строки больше 100', targets: [] }
  }
  const percentSum = percentLines.reduce((acc, line) => acc + line.amount, 0)
  if (percentSum > 100) return { error: 'Проценты больше 100', targets: [] }
  if (pieceLines.length > 0 && percentSum >= 100) {
    return { error: 'Проценты вместе со штуками должны быть меньше 100', targets: [] }
  }

  if (pieceLines.length === 0) {
    return {
      error: null,
      targets: percentLines.map((line) => ({
        barcode: line.barcode,
        name: line.name,
        pieces: null,
        percent: line.amount,
      })),
    }
  }

  const pieceSum = pieceLines.reduce((acc, line) => acc + line.amount, 0)
  let total = pieceSum
  let percentPieces: number[] = []
  if (percentLines.length > 0) {
    const whole = pieceSum / (1 - percentSum / 100)
    total = Math.max(pieceSum, Math.round(whole))
    let budget = total - pieceSum
    if (budget === 0) {
      budget = percentLines.length
      total = pieceSum + budget
    }
    percentPieces = largestRemainder(budget, percentLines.map((line) => line.amount))
  }

  const targets: WorkshopTarget[] = []
  for (const line of pieceLines) {
    targets.push({
      barcode: line.barcode,
      name: line.name,
      pieces: line.amount,
      percent: total > 0 ? (line.amount / total) * 100 : 0,
    })
  }
  percentLines.forEach((line, index) => {
    targets.push({
      barcode: line.barcode,
      name: line.name,
      pieces: percentPieces[index] ?? 0,
      percent: line.amount,
    })
  })
  return { error: null, targets }
}

type Score = {
  boxNumbers: number[]
  short: number
  extra: number
  foreign: number
  error: number
}

function sortedNumbers(numbers: number[]): number[] {
  return [...numbers].sort((a, b) => a - b)
}

function lowerNumbers(left: number[], right: number[]): boolean {
  const count = Math.min(left.length, right.length)
  for (let index = 0; index < count; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index]
  }
  return left.length < right.length
}

function betterSet(left: Score, right: Score): boolean {
  if (left.short !== right.short) return left.short < right.short
  if (left.extra !== right.extra) return left.extra < right.extra
  if (left.error !== right.error) return left.error < right.error
  if (left.boxNumbers.length !== right.boxNumbers.length) return left.boxNumbers.length < right.boxNumbers.length
  return lowerNumbers(left.boxNumbers, right.boxNumbers)
}

function contents(boxes: WorkshopPlanBox[], numbers: number[]) {
  const chosen = new Set(numbers)
  const byBarcode = new Map<string, number>()
  for (const box of boxes) {
    if (!chosen.has(box.boxNumber)) continue
    for (const line of box.lines) {
      if (line.qty <= 0) continue
      byBarcode.set(line.barcode, (byBarcode.get(line.barcode) ?? 0) + line.qty)
    }
  }
  return {
    byBarcode,
    foreignOf: (ordered: Set<string>) => {
      let units = 0
      for (const [barcode, qty] of byBarcode) {
        if (!ordered.has(barcode)) units += qty
      }
      return units
    },
  }
}

function pieceScore(boxes: WorkshopPlanBox[], numbers: number[], targets: WorkshopTarget[]): Score {
  const ordered = new Set(targets.map((target) => target.barcode))
  const { byBarcode, foreignOf } = contents(boxes, numbers)
  const foreign = foreignOf(ordered)
  let short = 0
  let surplus = 0
  for (const target of targets) {
    const have = byBarcode.get(target.barcode) ?? 0
    const need = target.pieces ?? 0
    short += Math.max(0, need - have)
    surplus += Math.max(0, have - need)
  }
  return {
    boxNumbers: sortedNumbers(numbers),
    short,
    extra: surplus + foreign,
    foreign,
    error: short,
  }
}

function percentScore(boxes: WorkshopPlanBox[], numbers: number[], targets: WorkshopTarget[]): Score {
  const ordered = new Set(targets.map((target) => target.barcode))
  const { byBarcode, foreignOf } = contents(boxes, numbers)
  const foreign = foreignOf(ordered)
  let orderedUnits = 0
  for (const barcode of ordered) orderedUnits += byBarcode.get(barcode) ?? 0
  const total = orderedUnits + foreign
  let error = 0
  let short = 0
  if (total <= 0) {
    short = targets.length
    error = targets.reduce((acc, target) => acc + (target.percent ?? 0), 0)
  } else {
    for (const target of targets) {
      const actual = ((byBarcode.get(target.barcode) ?? 0) / total) * 100
      const need = target.percent ?? 0
      error += Math.abs(actual - need)
      if (actual + PERCENT_SHORT < need) short += need - actual
    }
  }
  return {
    boxNumbers: sortedNumbers(numbers),
    short,
    extra: foreign,
    foreign,
    error,
  }
}

function isIdeal(score: Score, percentOnly: boolean): boolean {
  if (score.boxNumbers.length === 0) return false
  if (percentOnly) return score.foreign === 0 && score.error <= PERCENT_EXACT
  return score.short === 0 && score.extra === 0
}

function isCovered(score: Score): boolean {
  return score.boxNumbers.length > 0 && score.short === 0
}

function consider(best: Record<WorkshopPlanTier, Score | null>, score: Score, percentOnly: boolean) {
  if (score.boxNumbers.length === 0) return
  const tier: WorkshopPlanTier = isIdeal(score, percentOnly) ? 'ideal' : isCovered(score) ? 'covered' : 'short'
  const current = best[tier]
  if (!current || betterSet(score, current)) best[tier] = score
}

function enumerate(boxes: WorkshopPlanBox[], scoreOf: (numbers: number[]) => Score, percentOnly: boolean) {
  const best: Record<WorkshopPlanTier, Score | null> = { ideal: null, covered: null, short: null }
  const count = boxes.length
  const total = 1 << count
  for (let mask = 1; mask < total; mask += 1) {
    const numbers: number[] = []
    for (let bit = 0; bit < count; bit += 1) {
      if (mask & (1 << bit)) numbers.push(boxes[bit].boxNumber)
    }
    consider(best, scoreOf(numbers), percentOnly)
  }
  return best
}

function greedyPieces(boxes: WorkshopPlanBox[], targets: WorkshopTarget[], percentOnly: boolean) {
  const best: Record<WorkshopPlanTier, Score | null> = { ideal: null, covered: null, short: null }
  const ordered = new Set(targets.map((target) => target.barcode))
  const pure = boxes.filter((box) => box.lines.every((line) => line.qty <= 0 || ordered.has(line.barcode)))
  const remaining = new Map(targets.map((target) => [target.barcode, target.pieces ?? 0]))
  const idealNumbers: number[] = []
  const used = new Set<number>()
  while (true) {
    let pick: WorkshopPlanBox | null = null
    let pickUnits = 0
    for (const box of pure) {
      if (used.has(box.boxNumber)) continue
      let units = 0
      let fits = true
      for (const line of box.lines) {
        if (line.qty <= 0) continue
        if (line.qty > (remaining.get(line.barcode) ?? 0)) {
          fits = false
          break
        }
        units += line.qty
      }
      if (!fits || units <= 0) continue
      if (!pick || units > pickUnits || (units === pickUnits && box.boxNumber < pick.boxNumber)) {
        pick = box
        pickUnits = units
      }
    }
    if (!pick) break
    used.add(pick.boxNumber)
    idealNumbers.push(pick.boxNumber)
    for (const line of pick.lines) {
      if (line.qty <= 0) continue
      remaining.set(line.barcode, (remaining.get(line.barcode) ?? 0) - line.qty)
    }
  }
  if ([...remaining.values()].every((qty) => qty <= 0)) {
    consider(best, pieceScore(boxes, idealNumbers, targets), percentOnly)
  }

  const chosen: number[] = []
  const seen = new Set<number>()
  let guard = 0
  while (guard < 40) {
    guard += 1
    const current = pieceScore(boxes, chosen, targets)
    consider(best, current, percentOnly)
    if (current.short === 0 && chosen.length > 0) break
    let pick: { number: number; cover: number; extra: number } | null = null
    for (const box of boxes) {
      if (seen.has(box.boxNumber)) continue
      const next = pieceScore(boxes, [...chosen, box.boxNumber], targets)
      const cover = current.short - next.short
      if (cover <= 0) continue
      const extra = next.extra - current.extra
      if (
        !pick
        || cover > pick.cover
        || (cover === pick.cover && extra < pick.extra)
        || (cover === pick.cover && extra === pick.extra && box.boxNumber < pick.number)
      ) {
        pick = { number: box.boxNumber, cover, extra }
      }
    }
    if (!pick) break
    chosen.push(pick.number)
    seen.add(pick.number)
  }
  consider(best, pieceScore(boxes, chosen, targets), percentOnly)
  return best
}

function greedyPercents(boxes: WorkshopPlanBox[], targets: WorkshopTarget[]) {
  const best: Record<WorkshopPlanTier, Score | null> = { ideal: null, covered: null, short: null }
  const seeds: number[][] = [[]]
  const singles = boxes
    .map((box) => ({ box, score: percentScore(boxes, [box.boxNumber], targets) }))
    .sort((a, b) => a.score.error - b.score.error || a.box.boxNumber - b.box.boxNumber)
    .slice(0, 8)
  for (const single of singles) seeds.push([single.box.boxNumber])

  for (const seed of seeds) {
    const chosen = [...seed]
    const seen = new Set(chosen)
    let current = percentScore(boxes, chosen, targets)
    consider(best, current, true)
    let guard = 0
    while (guard < 40) {
      guard += 1
      let pick: { number: number; error: number } | null = null
      for (const box of boxes) {
        if (seen.has(box.boxNumber)) continue
        const next = percentScore(boxes, [...chosen, box.boxNumber], targets)
        if (next.error >= current.error - 0.05) continue
        if (!pick || next.error < pick.error || (next.error === pick.error && box.boxNumber < pick.number)) {
          pick = { number: box.boxNumber, error: next.error }
        }
      }
      if (!pick) break
      chosen.push(pick.number)
      seen.add(pick.number)
      current = percentScore(boxes, chosen, targets)
      consider(best, current, true)
    }
  }
  return best
}

function rowsFor(boxes: WorkshopPlanBox[], numbers: number[], targets: WorkshopTarget[]): WorkshopPlanRow[] {
  const ordered = new Set(targets.map((target) => target.barcode))
  const { byBarcode, foreignOf } = contents(boxes, numbers)
  const foreign = foreignOf(ordered)
  let orderedUnits = 0
  for (const target of targets) orderedUnits += byBarcode.get(target.barcode) ?? 0
  const total = orderedUnits + foreign
  const rows: WorkshopPlanRow[] = targets.map((target) => {
    const pieces = byBarcode.get(target.barcode) ?? 0
    return {
      barcode: target.barcode,
      name: target.name,
      orderedPieces: target.pieces,
      orderedPercent: target.percent,
      pieces,
      percent: total > 0 ? (pieces / total) * 100 : 0,
    }
  })
  if (foreign > 0) {
    rows.push({
      barcode: '',
      name: 'Другие товары в коробах',
      orderedPieces: null,
      orderedPercent: null,
      pieces: foreign,
      percent: total > 0 ? (foreign / total) * 100 : 0,
    })
  }
  return rows
}

export function planWorkshop(boxes: WorkshopPlanBox[], targets: WorkshopTarget[]): WorkshopPlanVariant[] {
  const usable = boxes
    .map((box) => ({
      boxNumber: box.boxNumber,
      lines: box.lines.filter((line) => line.barcode && line.qty > 0),
    }))
    .filter((box) => box.lines.length > 0)
    .sort((a, b) => a.boxNumber - b.boxNumber)
  if (usable.length === 0 || targets.length === 0) return []
  const percentOnly = targets.every((target) => target.pieces == null)
  const scoreOf = (numbers: number[]) => (
    percentOnly ? percentScore(usable, numbers, targets) : pieceScore(usable, numbers, targets)
  )
  const best = usable.length <= ENUM_LIMIT
    ? enumerate(usable, scoreOf, percentOnly)
    : percentOnly
      ? greedyPercents(usable, targets)
      : greedyPieces(usable, targets, false)

  const seen = new Set<string>()
  const variants: WorkshopPlanVariant[] = []
  for (const tier of TIER_ORDER) {
    const score = best[tier]
    if (!score) continue
    const key = score.boxNumbers.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    variants.push({
      tier,
      boxNumbers: score.boxNumbers,
      extraPieces: score.extra,
      shortPieces: score.short,
      rows: rowsFor(usable, score.boxNumbers, targets),
    })
  }
  return variants
}
