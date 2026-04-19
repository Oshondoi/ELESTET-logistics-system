import { useEffect, useState } from 'react'
import type { StickerFormValues, StickerTemplate } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Textarea'

const defaultValues = (): StickerFormValues => ({
  name: '',
  composition: '',
  article: '',
  brand: '',
  size: '',
  color: '',
  supplier: '',
  supplier_address: '',
  production_date: '',
  country: 'Кыргызстан',
  copies: 1,
})

interface StickerFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (values: StickerFormValues) => Promise<unknown>
  initialValues?: StickerTemplate
}

export const StickerFormModal = ({ open, onClose, onSubmit, initialValues }: StickerFormModalProps) => {
  const isEdit = Boolean(initialValues)
  const [values, setValues] = useState<StickerFormValues>(defaultValues())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setError(null)
      if (initialValues) {
        setValues({
          name: initialValues.name,
          composition: initialValues.composition ?? '',
          article: initialValues.article ?? '',
          brand: initialValues.brand ?? '',
          size: initialValues.size ?? '',
          color: initialValues.color ?? '',
          supplier: initialValues.supplier ?? '',
          supplier_address: initialValues.supplier_address ?? '',
          production_date: initialValues.production_date ?? '',
          country: initialValues.country,
          copies: initialValues.copies,
        })
      } else {
        setValues(defaultValues())
      }
    }
  }, [open, initialValues])

  const set = <K extends keyof StickerFormValues>(key: K, value: StickerFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!values.name.trim()) { setError('Наименование обязательно'); return }
    setIsSubmitting(true)
    setError(null)
    void onSubmit(values)
      .then(() => { setValues(defaultValues()); onClose() })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка'))
      .finally(() => setIsSubmitting(false))
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Редактировать стикер' : 'Новый стикер'}>
      <form className="grid min-w-0 gap-4" onSubmit={handleSubmit}>

        <Input
          label="Наименование товара *"
          placeholder="Рубашка женская"
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
        />

        <Input
          label="Состав"
          placeholder="95% хлопок, 5% эластин"
          value={values.composition}
          onChange={(e) => set('composition', e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Артикул"
            placeholder="123456789"
            value={values.article}
            onChange={(e) => set('article', e.target.value)}
          />
          <Input
            label="Бренд"
            placeholder="IIStyle"
            value={values.brand}
            onChange={(e) => set('brand', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Размер"
            placeholder="48"
            value={values.size}
            onChange={(e) => set('size', e.target.value)}
          />
          <Input
            label="Цвет"
            placeholder="Черный"
            value={values.color}
            onChange={(e) => set('color', e.target.value)}
          />
        </div>

        <Input
          label="Поставщик"
          placeholder="ИП Алиева А. А."
          value={values.supplier}
          onChange={(e) => set('supplier', e.target.value)}
        />

        <Input
          label="Адрес поставщика"
          placeholder="ул. Кара-Дарыя, 1/2, г. Бишкек, КР"
          value={values.supplier_address}
          onChange={(e) => set('supplier_address', e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Дата производства"
            placeholder="01.01.26"
            value={values.production_date}
            onChange={(e) => set('production_date', e.target.value)}
          />
          <Input
            label="Страна"
            placeholder="Кыргызстан"
            value={values.country}
            onChange={(e) => set('country', e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Кол-во копий</label>
          <input
            type="number"
            min={1}
            max={999}
            value={values.copies}
            onChange={(e) => set('copies', Math.max(1, parseInt(e.target.value) || 1))}
            className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400"
          />
        </div>

        {error && <p className="text-xs text-rose-500">{error}</p>}

        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 pt-4 pb-1 sm:-mx-6 sm:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={onClose} className="w-full sm:w-auto">
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting
                ? (isEdit ? 'Сохранение…' : 'Создание…')
                : (isEdit ? 'Сохранить' : 'Создать стикер')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
