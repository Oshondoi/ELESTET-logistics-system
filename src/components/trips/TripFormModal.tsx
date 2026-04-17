import { useState } from 'react'
import { carrierOptions } from '../../lib/constants'
import type { TripFormValues } from '../../types'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'

interface TripFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (values: TripFormValues) => Promise<unknown>
}

const defaults: TripFormValues = {
  carrier: carrierOptions[0],
  comment: '',
}

export const TripFormModal = ({ open, onClose, onSubmit }: TripFormModalProps) => {
  const [values, setValues] = useState<TripFormValues>(defaults)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const set = <K extends keyof TripFormValues>(key: K, value: TripFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setIsSubmitting(true)
    void onSubmit(values)
      .then(() => {
        setValues(defaults)
        onClose()
      })
      .finally(() => setIsSubmitting(false))
  }

  return (
    <Modal open={open} onClose={onClose} title="Новый рейс">
      <form className="grid min-w-0 gap-5" onSubmit={handleSubmit}>
        <Select
          label="Перевозчик"
          value={values.carrier}
          onChange={(e) => set('carrier', e.target.value)}
          options={carrierOptions.map((c) => ({ label: c, value: c }))}
        />

        <Textarea
          label="Комментарий"
          placeholder="Заметка по рейсу"
          className="min-h-[80px] resize-none"
          value={values.comment}
          onChange={(e) => set('comment', e.target.value)}
        />

        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 pt-4 pb-1 sm:-mx-6 sm:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose} className="w-full sm:w-auto">
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? 'Создание…' : 'Создать рейс'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
