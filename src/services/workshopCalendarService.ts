export type WorkshopOccupancy = {
  id: string
  title: string
  planStart: string
  planEnd: string
  factStart: string | null
  factEnd: string | null
}

const storageKey = (accountId: string) => `elestet-workshop-calendar:${accountId}`

function isOccupancy(value: unknown): value is WorkshopOccupancy {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<WorkshopOccupancy>
  return typeof row.id === 'string'
    && typeof row.title === 'string'
    && typeof row.planStart === 'string'
    && typeof row.planEnd === 'string'
    && (row.factStart == null || typeof row.factStart === 'string')
    && (row.factEnd == null || typeof row.factEnd === 'string')
}

export function loadWorkshopOccupancies(accountId: string): WorkshopOccupancy[] {
  if (!accountId) return []
  try {
    const raw = window.localStorage.getItem(storageKey(accountId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isOccupancy)
  } catch {
    return []
  }
}

export function saveWorkshopOccupancies(accountId: string, items: WorkshopOccupancy[]) {
  window.localStorage.setItem(storageKey(accountId), JSON.stringify(items))
}
