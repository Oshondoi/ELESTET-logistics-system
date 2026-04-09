import { useState } from 'react'
import { marketplaceOptions } from '../../lib/constants'
import type { StoreFormValues } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'

interface StoreFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (values: StoreFormValues) => Promise<unknown>
}

export const StoreFormModal = ({ open, onClose, onSubmit }: StoreFormModalProps) => {
  const [values, setValues] = useState<StoreFormValues>({
    name: '',
    marketplace: 'Wildberries',
    store_code: '',
  })

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void onSubmit(values).then(() => {
      setValues({
        name: '',
        marketplace: 'Wildberries',
        store_code: '',
      })
      onClose()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый магазин"
      description="Если store_code не указан, система сгенерирует уникальный код автоматически."
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <Input
          label="Название"
          placeholder="Например, WB Москва"
          value={values.name}
          onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
          required
        />
        <Select
          label="Маркетплейс"
          value={values.marketplace}
          onChange={(event) =>
            setValues((current) => ({ ...current, marketplace: event.target.value }))
          }
          options={marketplaceOptions.map((item) => ({ label: item, value: item }))}
        />
        <Input
          label="Store Code"
          placeholder="Например, A4821"
          value={values.store_code}
          onChange={(event) =>
            setValues((current) => ({ ...current, store_code: event.target.value.toUpperCase() }))
          }
          hint="Формат: 1 заглавная буква + 4 цифры. Можно оставить пустым."
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit">Создать магазин</Button>
        </div>
      </form>
    </Modal>
  )
}
