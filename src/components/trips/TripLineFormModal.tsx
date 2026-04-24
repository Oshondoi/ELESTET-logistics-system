import { useEffect, useState } from 'react'
import { shipmentStatuses, paymentStatuses } from '../../lib/constants'
import type { Store, TripLineFormValues, TripWithLines } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'

interface TripLineFormModalProps {
  open: boolean
  stores: Store[]
  onClose: () => void
  onSubmit: (values: TripLineFormValues) => Promise<void>
  initialValues?: TripLineFormValues
  warehouseNames?: string[]
  /** Если передан — показывает селект «Рейс» первым полем (режим создания без привязки к рейсу) */
  trips?: TripWithLines[]
  onSubmitWithTrip?: (tripId: string, values: TripLineFormValues) => Promise<void>
}

const makeDefaults = (stores: Store[], warehouses: string[]): TripLineFormValues => ({
  store_id: stores[0]?.id ?? '',
  destination_warehouse: warehouses[0] ?? '',
  box_qty: 0,
  units_qty: 0,
  units_total: 0,
  arrived_box_qty: 0,
  weight: 0,
  planned_marketplace_delivery_date: '',
  reception_date: '',
  arrival_date: '',
  shipped_date: '',
  status: 'Ожидает отправки',
  payment_status: 'Не оплачено',
  comment: '',
})

export const TripLineFormModal = ({ open, stores, onClose, onSubmit, initialValues, warehouseNames, trips, onSubmitWithTrip }: TripLineFormModalProps) => {
  const isEdit = Boolean(initialValues)
  const warehouses = warehouseNames ?? []
  const [values, setValues] = useState<TripLineFormValues>(() => initialValues ?? makeDefaults(stores, warehouses))
  const [selectedTripId, setSelectedTripId] = useState<string>(() => trips?.[0]?.id ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setValues(initialValues ?? makeDefaults(stores, warehouses))
      setSelectedTripId(trips?.[0]?.id ?? '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialValues, stores])

  const set = <K extends keyof TripLineFormValues>(key: K, value: TripLineFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setIsSubmitting(true)
    setSubmitError(null)
    const submit = trips && onSubmitWithTrip
      ? onSubmitWithTrip(selectedTripId, values)
      : onSubmit(values)
    void submit
      .then(() => {
        setValues(makeDefaults(stores, warehouses))
        onClose()
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
              ? String((err as { message: unknown }).message)
              : String(err)
        setSubmitError(msg)
      })
      .finally(() => setIsSubmitting(false))
  }

  const storeOptions = stores.map((s) => ({
    label: s.store_code ? `${s.name} (${s.store_code})` : s.name,
    value: s.id,
  }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Редактировать поставку' : 'Новая поставка'}
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Отмена
          </Button>
          <Button type="submit" form="trip-line-form" disabled={isSubmitting || !values.store_id || (Boolean(trips) && !selectedTripId)}>
            {isSubmitting ? 'Сохранение…' : (isEdit ? 'Сохранить' : 'Добавить поставку')}
          </Button>
        </div>
      }
    >
      <form id="trip-line-form" className="grid min-w-0 gap-5" onSubmit={handleSubmit}>
        {trips && (
          <Select
            label="Рейс"
            value={selectedTripId}
            onChange={(e) => setSelectedTripId(e.target.value)}
            options={trips.map((t) => ({
              label: t.trip_number ? `Рейс ${t.trip_number}` : `Черновик-${t.draft_number}`,
              value: t.id,
            }))}
          />
        )}
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Select
            label="Магазин"
            value={values.store_id}
            onChange={(e) => set('store_id', e.target.value)}
            options={storeOptions}
          />
          <Select
            label="Склад назначения"
            value={values.destination_warehouse}
            onChange={(e) => set('destination_warehouse', e.target.value)}
            options={warehouses.map((w) => ({ label: w, value: w }))}
          />
          <Input
            label="Коробов"
            type="number"
            min={0}
            value={values.box_qty}
            onChange={(e) => set('box_qty', Number(e.target.value))}
          />
          <Input
            label="Единиц"
            type="number"
            min={0}
            value={values.units_qty}
            onChange={(e) => set('units_qty', Number(e.target.value))}
          />
          <Input
            label="Вес (кг)"
            type="number"
            min={0}
            step={0.1}
            value={values.weight}
            onChange={(e) => set('weight', Number(e.target.value))}
          />
          <Input
            label="Дата приёма"
            type="date"
            value={values.reception_date}
            onChange={(e) => set('reception_date', e.target.value)}
          />
          <Input
            label="Прибыл"
            type="date"
            value={values.arrival_date}
            onChange={(e) => set('arrival_date', e.target.value)}
          />
          <Input
            label="Отгружено"
            type="date"
            value={values.shipped_date}
            onChange={(e) => set('shipped_date', e.target.value)}
          />
          <Input
            label="Дата МП"
            type="date"
            value={values.planned_marketplace_delivery_date}
            onChange={(e) => set('planned_marketplace_delivery_date', e.target.value)}
          />
          <Select
            label="Статус"
            value={values.status}
            onChange={(e) => set('status', e.target.value as TripLineFormValues['status'])}
            options={shipmentStatuses.map((s) => ({ label: s, value: s }))}
          />
          <Select
            label="Статус оплаты"
            value={values.payment_status}
            onChange={(e) => set('payment_status', e.target.value as TripLineFormValues['payment_status'])}
            options={paymentStatuses.map((s) => ({ label: s, value: s }))}
          />
        </div>

        <Textarea
          label="Комментарий"
          placeholder="Заметка по поставке"
          className="min-h-[72px] resize-none"
          value={values.comment}
          onChange={(e) => set('comment', e.target.value)}
        />
        {submitError && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{submitError}</p>
        )}
      </form>
    </Modal>
  )
}
