export type PairableOperation = {
  id: string
  operationId: string
  operationType?: string
  type?: string
  kmsCount?: number
  codesCount?: number
  createdAt?: string
  createdDate?: string
  productGroupCode?: string | null
}

const ORDER_TYPES = new Set(['MARK_CODE_ORDER', 'EMISSION'])
const MARKING_TYPES = new Set(['MARKING', 'UTILISATION'])

function kindOf(operation: PairableOperation): 'order' | 'marking' | 'other' {
  const type = (operation.operationType ?? operation.type ?? '').toUpperCase()
  if (ORDER_TYPES.has(type)) return 'order'
  if (MARKING_TYPES.has(type)) return 'marking'
  return 'other'
}

function timeOf(operation: PairableOperation): number {
  const time = Date.parse(operation.createdAt ?? operation.createdDate ?? '')
  return Number.isNaN(time) ? 0 : time
}

function countOf(operation: PairableOperation): number | null {
  const count = operation.kmsCount ?? operation.codesCount
  return count == null || Number.isNaN(count) ? null : count
}

function sameGoods(left: PairableOperation, right: PairableOperation): boolean {
  const leftGroup = (left.productGroupCode ?? '').trim()
  const rightGroup = (right.productGroupCode ?? '').trim()
  return !leftGroup || !rightGroup || leftGroup === rightGroup
}

function idOf(operation: PairableOperation): string {
  return operation.operationId || operation.id
}

// Нанесение — более поздний статус пары. Заказ остаётся при нём, а не на своей старой дате.
export function arrangeOperationPairs<T extends PairableOperation>(operations: T[]): T[] {
  const orders = new Map<number, T[]>()
  const markings: T[] = []
  const singles: T[] = []

  for (const operation of operations) {
    const count = countOf(operation)
    const kind = kindOf(operation)
    if (count == null || kind === 'other') {
      singles.push(operation)
      continue
    }
    if (kind === 'order') {
      const bucket = orders.get(count) ?? []
      bucket.push(operation)
      orders.set(count, bucket)
      continue
    }
    markings.push(operation)
  }

  for (const bucket of orders.values()) bucket.sort((left, right) => timeOf(left) - timeOf(right) || idOf(left).localeCompare(idOf(right)))
  markings.sort((left, right) => timeOf(left) - timeOf(right) || idOf(left).localeCompare(idOf(right)))

  const used = new Set<string>()
  const blocks: Array<{ at: number; rows: T[] }> = []

  for (const marking of markings) {
    const count = countOf(marking) ?? 0
    const candidates = (orders.get(count) ?? []).filter((order) => (
      !used.has(idOf(order)) && timeOf(order) <= timeOf(marking) && sameGoods(order, marking)
    ))
    const order = candidates.length > 0 ? candidates[candidates.length - 1] : null
    if (order) used.add(idOf(order))
    blocks.push({ at: timeOf(marking), rows: order ? [marking, order] : [marking] })
  }

  for (const bucket of orders.values()) {
    for (const order of bucket) {
      if (used.has(idOf(order))) continue
      blocks.push({ at: timeOf(order), rows: [order] })
    }
  }
  for (const single of singles) blocks.push({ at: timeOf(single), rows: [single] })

  blocks.sort((left, right) => right.at - left.at || idOf(left.rows[0]).localeCompare(idOf(right.rows[0])))
  return blocks.flatMap((block) => block.rows)
}

export function pageOperationRows<T extends PairableOperation>(
  rows: T[],
  page: number,
  pageSize: number,
): { items: T[]; pages: number; offset: number } {
  const starts: number[] = []
  let index = 0
  while (index < rows.length) {
    starts.push(index)
    let take = Math.min(pageSize, rows.length - index)
    const cut = index + take
    if (cut < rows.length && isPairCut(rows[cut - 1], rows[cut])) take += 1
    index += Math.max(take, 1)
  }
  const pageCount = Math.max(starts.length, 1)
  const safePage = Math.min(Math.max(page, 0), pageCount - 1)
  const offset = starts[safePage] ?? 0
  const next = starts[safePage + 1] ?? rows.length
  return { items: rows.slice(offset, next), pages: pageCount, offset }
}

function isPairCut(left: PairableOperation | undefined, right: PairableOperation | undefined): boolean {
  if (!left || !right) return false
  const leftKind = kindOf(left)
  const rightKind = kindOf(right)
  const count = countOf(left)
  return count != null
    && count === countOf(right)
    && leftKind === 'marking'
    && rightKind === 'order'
    && sameGoods(left, right)
}
