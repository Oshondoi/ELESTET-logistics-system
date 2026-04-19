import { useEffect, useState } from 'react'
import { carrierOptions } from '../../lib/constants'
import type { TripFormValues } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { Textarea } from '../ui/Textarea'

interface TripFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (values: TripFormValues) => Promise<unknown>
  initialValues?: TripFormValues
  carrierNames?: string[]
}

const defaults = (carriers: string[]): TripFormValues => ({
  carrier: carriers[0] ?? '',
  comment: '',
  departure_date: '',
})

export const TripFormModal = ({ open, onClose, onSubmit, initialValues, carrierNames }: TripFormModalProps) => {
  const isEdit = Boolean(initialValues)
  const carriers = carrierNames ?? []
  const [values, setValues] = useState<TripFormValues>(initialValues ?? defaults(carriers))
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setValues(initialValues ?? defaults(carriers))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialValues])

  const set = <K extends keyof TripFormValues>(key: K, value: TripFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setIsSubmitting(true)
    void onSubmit(values)
      .then(() => {
        setValues(defaults(carriers))
        onClose()
      })
      .finally(() => setIsSubmitting(false))
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Редактировать рейс' : 'Новый рейс'}>
      <form className="grid min-w-0 gap-5" onSubmit={handleSubmit}>
        <Select
          label="Перевозчик"
          value={values.carrier}
          onChange={(e) => set('carrier', e.target.value)}
          options={carriers.map((c) => ({ label: c, value: c }))}
        />

        {isEdit && (
          <Input
            label="Дата отправки"
            type="date"
            value={values.departure_date ?? ''}
            onChange={(e) => set('departure_date', e.target.value)}
          />
        )}

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
              {isSubmitting ? (isEdit ? 'Сохранение…' : 'Создание…') : (isEdit ? 'Сохранить' : 'Создать рейс')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
