import type { Trip, TripLine } from '../types'
import { writeLogisticsActivity } from './logisticsActivityService'

export const tripLabel = (trip: Pick<Trip, 'trip_number' | 'draft_number'>) =>
  trip.trip_number ? `Рейс ${trip.trip_number}` : `Черновик-${trip.draft_number}`

export const lineLabel = (line: Pick<TripLine, 'shipment_number'>) =>
  `Поставка S-${line.shipment_number}`

const fmt = (value: unknown) => (value == null || value === '' ? '—' : String(value))

export async function logLogisticsChange(
  accountId: string,
  opts: {
    tripId?: string | null
    tripLineId?: string | null
    message: string
    fieldKey?: string
    oldValue?: string | null
    newValue?: string | null
    actorLabel?: string
  },
): Promise<void> {
  await writeLogisticsActivity({
    accountId,
    tripId: opts.tripId ?? null,
    tripLineId: opts.tripLineId ?? null,
    message: opts.message,
    fieldKey: opts.fieldKey ?? null,
    oldValue: opts.oldValue ?? null,
    newValue: opts.newValue ?? null,
    actorLabel: opts.actorLabel,
  })
}

export async function logFieldChanges(
  accountId: string,
  scope: { tripId: string; tripLineId?: string; prefix: string; actorLabel?: string },
  changes: Array<{ key: string; label: string; previous: unknown; nextValue: unknown }>,
): Promise<void> {
  for (const change of changes) {
    if (fmt(change.previous) === fmt(change.nextValue)) continue
    await logLogisticsChange(accountId, {
      tripId: scope.tripId,
      tripLineId: scope.tripLineId ?? null,
      fieldKey: change.key,
      oldValue: fmt(change.previous),
      newValue: fmt(change.nextValue),
      message: `${scope.prefix}: ${change.label} — было ${fmt(change.previous)}, стало ${fmt(change.nextValue)}`,
      actorLabel: scope.actorLabel,
    })
  }
}

export function customFieldChanges(
  oldFields: Record<string, unknown> | null | undefined,
  updatedFields: Record<string, unknown>,
): Array<{ key: string; label: string; previous: unknown; nextValue: unknown }> {
  const previousFields = oldFields ?? {}
  const keys = new Set([...Object.keys(previousFields), ...Object.keys(updatedFields)])
  const changes: Array<{ key: string; label: string; previous: unknown; nextValue: unknown }> = []
  for (const key of keys) {
    const prev = previousFields[key]
    const nextVal = updatedFields[key]
    if (JSON.stringify(prev) !== JSON.stringify(nextVal)) {
      changes.push({
        key: `custom.${key}`,
        label: `Доп. поле «${key}»`,
        previous: prev,
        nextValue: nextVal,
      })
    }
  }
  return changes
}
