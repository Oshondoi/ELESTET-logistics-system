import { useEffect, useMemo, useState } from 'react'
import { carrierOptions, paymentStatuses, shipmentStatuses, warehouseOptions } from '../../lib/constants'
import { formatDateInputValue } from '../../lib/utils'
import { createShipmentDraft } from '../../services/shipmentService'
import type { Shipment, ShipmentFormValues, Store } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'

interface ShipmentEditModalProps {
  open: boolean
  stores: Store[]
  shipments: Shipment[]
  onClose: () => void
  onSubmit: (values: ShipmentFormValues) => Promise<unknown>
}

const defaultStatus = shipmentStatuses[0]
const defaultPaymentStatus = paymentStatuses[0]
const defaultCarrier = carrierOptions[0]
const defaultWarehouse = warehouseOptions[0]

export const ShipmentEditModal = ({
  open,
  stores,
  shipments,
  onClose,
  onSubmit,
}: ShipmentEditModalProps) => {
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

  useEffect(() => {
    if (values.status === 'Прибыл' && !values.arrival_date) {
      setValues((current) => ({
        ...current,
        arrival_date: formatDateInputValue(new Date().toISOString()),
      }))
    }
  }, [values.status, values.arrival_date])

  const trackingPreview = useMemo(() => {
    if (!values.store_id) return 'TRK-?'

    return createShipmentDraft(values.store_id, shipments).tracking_code
  }, [values.store_id, shipments])

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
      title="Редактирование поставки"
      footer={
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} className="w-full sm:w-auto">
            Отмена
          </Button>
          <Button type="submit" form="shipment-edit-form" className="w-full sm:w-auto">
            Сохранить изменения
          </Button>
        </div>
      }
    >
      <form id="shipment-edit-form" className="grid min-w-0 gap-5" onSubmit={handleSubmit}>
        <div className="min-w-0 rounded-xl border border-dashed border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
          Предварительный Tracking ID: <span className="font-semibold">{trackingPreview}</span>
        </div>

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
          <Input
            label="Количество единиц в коробках"
            type="number"
            min={0}
            value={values.units_qty}
            onChange={(event) => handleChange('units_qty', Number(event.target.value))}
          />
          <Input
            label="Сумма единиц"
            type="number"
            min={0}
            value={values.units_total}
            onChange={(event) => handleChange('units_total', Number(event.target.value))}
          />
          <Input
            label="Приехало коробов по факту"
            type="number"
            min={0}
            value={values.arrived_box_qty}
            onChange={(event) => handleChange('arrived_box_qty', Number(event.target.value))}
          />
          <Input
            label="Дата поставки МП"
            type="date"
            value={values.planned_marketplace_delivery_date}
            onChange={(event) =>
              handleChange('planned_marketplace_delivery_date', event.target.value)
            }
          />
          <Input
            label="Дата прибытия"
            type="date"
            value={values.arrival_date}
            onChange={(event) => handleChange('arrival_date', event.target.value)}
            hint='При статусе "Прибыл" дата подставляется автоматически, но её можно изменить.'
          />
          <Select
            label="Статус"
            value={values.status}
            onChange={(event) => handleChange('status', event.target.value as ShipmentFormValues['status'])}
            options={shipmentStatuses.map((status) => ({ label: status, value: status }))}
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
