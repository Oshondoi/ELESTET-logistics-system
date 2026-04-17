import { useState } from 'react'
import { warehouseOptions, shipmentStatuses, paymentStatuses } from '../../lib/constants'
import type { Store, TripLineFormValues } from '../../types'
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
}

const makeDefaults = (stores: Store[]): TripLineFormValues => ({
  store_id: stores[0]?.id ?? '',
  destination_warehouse: warehouseOptions[0],
  box_qty: 0,
  units_qty: 0,
  units_total: 0,
  arrived_box_qty: 0,
  planned_marketplace_delivery_date: '',
  arrival_date: '',
  status: 'Ожидает отправки',
  payment_status: 'Не оплачено',
  comment: '',
})

export const TripLineFormModal = ({ open, stores, onClose, onSubmit }: TripLineFormModalProps) => {
  const [values, setValues] = useState<TripLineFormValues>(() => makeDefaults(stores))
  const [isSubmitting, setIsSubmitting] = useState(false)

  const set = <K extends keyof TripLineFormValues>(key: K, value: TripLineFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setIsSubmitting(true)
    void onSubmit(values)
      .then(() => {
        setValues(makeDefaults(stores))
        onClose()
      })
      .finally(() => setIsSubmitting(false))
  }

  const storeOptions = stores.map((s) => ({
    label: s.store_code ? `${s.name} (${s.store_code})` : s.name,
    value: s.id,
  }))

  return (
    <Modal open={open} onClose={onClose} title="Новая поставка">
      <form className="grid min-w-0 gap-5" onSubmit={handleSubmit}>
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
            options={warehouseOptions.map((w) => ({ label: w, value: w }))}
          />
          <Input
            label="Коробов"
            type="number"
            min={0}
            value={values.box_qty}
            onChange={(e) => set('box_qty', Number(e.target.value))}
          />
          <Input
            label="Единиц (план)"
            type="number"
            min={0}
            value={values.units_qty}
            onChange={(e) => set('units_qty', Number(e.target.value))}
          />
          <Input
            label="Единиц (итого)"
            type="number"
            min={0}
            value={values.units_total}
            onChange={(e) => set('units_total', Number(e.target.value))}
          />
          <Input
            label="Плановая дата доставки"
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

        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 pt-4 pb-1 sm:-mx-6 sm:px-6">
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting || !values.store_id}>
              {isSubmitting ? 'Сохранение...' : 'Добавить поставку'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
