import { useEffect, useState } from 'react'
import { carrierOptions, paymentStatuses, shipmentStatuses, warehouseOptions } from '../../lib/constants'
import type { ShipmentFormValues, Store } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'

interface ShipmentFormModalProps {
  open: boolean
  stores: Store[]
  onClose: () => void
  onSubmit: (values: ShipmentFormValues) => Promise<unknown>
}

const defaultStatus = shipmentStatuses[0]
const defaultPaymentStatus = paymentStatuses[0]
const defaultCarrier = carrierOptions[0]
const defaultWarehouse = warehouseOptions[0]

export const ShipmentFormModal = ({
  open,
  stores,
  onClose,
  onSubmit,
}: ShipmentFormModalProps) => {
  const [values, setValues] = useState<ShipmentFormValues>({
    store_id: stores[0]?.id ?? '',
    carrier: defaultCarrier,
    destination_warehouse: defaultWarehouse,
    box_qty: 0,
    units_qty: 0,
    units_total: 0,
    arrived_box_qty: 0,
    planned_marketplace_delivery_date: '',
    arrival_date: '',
    status: defaultStatus,
    payment_status: defaultPaymentStatus,
    comment: '',
  })

  useEffect(() => {
    if (stores.length && !values.store_id) {
      setValues((current) => ({ ...current, store_id: stores[0].id }))
    }
  }, [stores, values.store_id])

  const handleChange = <K extends keyof ShipmentFormValues>(key: K, value: ShipmentFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void onSubmit(values).then(() => {
      setValues({
        store_id: stores[0]?.id ?? '',
        carrier: defaultCarrier,
        destination_warehouse: defaultWarehouse,
        box_qty: 0,
        units_qty: 0,
        units_total: 0,
        arrived_box_qty: 0,
        planned_marketplace_delivery_date: '',
        arrival_date: '',
        status: defaultStatus,
        payment_status: defaultPaymentStatus,
        comment: '',
      })
      onClose()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новая поставка"
      footer={
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} className="w-full sm:w-auto">
            Отмена
          </Button>
          <Button type="submit" form="shipment-form" className="w-full sm:w-auto">
            Создать поставку
          </Button>
        </div>
      }
    >
      <form id="shipment-form" className="grid min-w-0 gap-5" onSubmit={handleSubmit}>
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Select
            label="Магазин"
            value={values.store_id}
            onChange={(event) => handleChange('store_id', event.target.value)}
            options={stores.map((store) => ({
              label: `${store.name} (${store.store_code})`,
              value: store.id,
            }))}
          />
          <Select
            label="Перевозчик"
            value={values.carrier}
            onChange={(event) => handleChange('carrier', event.target.value)}
            options={carrierOptions.map((c) => ({ label: c, value: c }))}
          />
          <Select
            label="Склад назначения"
            value={values.destination_warehouse}
            onChange={(event) => handleChange('destination_warehouse', event.target.value)}
            options={warehouseOptions.map((w) => ({ label: w, value: w }))}
          />
          <Input
            label="Количество коробов"
            type="number"
            min={0}
            value={values.box_qty}
            onChange={(event) => handleChange('box_qty', Number(event.target.value))}
          />
          <Select
            label="Статус оплаты"
            value={values.payment_status}
            onChange={(event) =>
              handleChange('payment_status', event.target.value as ShipmentFormValues['payment_status'])
            }
            options={paymentStatuses.map((status) => ({ label: status, value: status }))}
          />
        </div>

        <Textarea
          label="Комментарий"
          placeholder="Краткая заметка по поставке"
          className="min-h-[120px] resize-none"
          value={values.comment}
          onChange={(event) => handleChange('comment', event.target.value)}
        />
      </form>
    </Modal>
  )
}
