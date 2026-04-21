import { useEffect, useState } from 'react'
import { marketplaceOptions } from '../../lib/constants'
import type { StoreFormValues } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'

interface StoreFormModalProps {
  open: boolean
  initialValues?: StoreFormValues
  hasApiKey?: boolean
  onClose: () => void
  onSubmit: (values: StoreFormValues) => Promise<unknown>
}

const DEFAULT_VALUES: StoreFormValues = {
  name: '',
  marketplace: 'Wildberries',
  store_code: '',
  api_key: '',
}

export const StoreFormModal = ({ open, initialValues, hasApiKey, onClose, onSubmit }: StoreFormModalProps) => {
  const [values, setValues] = useState<StoreFormValues>(initialValues ?? DEFAULT_VALUES)
  const [changingKey, setChangingKey] = useState(false)

  useEffect(() => {
    if (open) {
      setValues(initialValues ?? DEFAULT_VALUES)
      setChangingKey(false)
    }
  }, [open, initialValues])

  const isEditing = Boolean(initialValues)

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    // В режиме редактирования — передаём api_key только если пользователь ввёл новый
    const submitValues: StoreFormValues = {
      ...values,
      api_key: (isEditing && !changingKey) ? undefined : (values.api_key?.trim() || undefined),
    }
    void onSubmit(submitValues).then(() => {
      onClose()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? 'Редактировать магазин' : 'Новый магазин'}
      description={isEditing ? undefined : 'Если store_code не указан, система сгенерирует уникальный код автоматически.'}
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
          value={values.store_code ?? ''}
          onChange={(event) =>
            setValues((current) => ({ ...current, store_code: event.target.value.toUpperCase() }))
          }
          hint="Можно оставить пустым — код будет сгенерирован автоматически."
        />

        {/* API ключ */}
        {isEditing ? (
          <div className="flex flex-col gap-2 text-sm text-slate-700">
            <span className="font-medium">API ключ WB</span>
            {changingKey ? (
              <>
                <Input
                  label=""
                  type="password"
                  placeholder="Введите новый API ключ"
                  value={values.api_key ?? ''}
                  onChange={(e) => setValues((c) => ({ ...c, api_key: e.target.value }))}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => { setChangingKey(false); setValues((c) => ({ ...c, api_key: '' })) }}
                  className="self-start text-xs text-slate-400 hover:text-slate-600 transition"
                >
                  Отмена
                </button>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-mono tracking-widest text-slate-300"
                  style={{ userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none' } as React.CSSProperties}
                  onCopy={(e) => e.preventDefault()}
                  onCut={(e) => e.preventDefault()}
                  aria-label="API ключ скрыт"
                >
                  {hasApiKey ? '••••••••••••••••••••••••' : 'Не задан'}
                </div>
                <button
                  type="button"
                  onClick={() => setChangingKey(true)}
                  className="whitespace-nowrap text-sm text-blue-500 transition hover:text-blue-700"
                >
                  Изменить
                </button>
              </div>
            )}
          </div>
        ) : (
          <Input
            label="API ключ WB"
            type="password"
            placeholder="Вставьте ключ из личного кабинета WB"
            value={values.api_key ?? ''}
            onChange={(e) => setValues((c) => ({ ...c, api_key: e.target.value }))}
            autoComplete="new-password"
            hint="Необязательно. После сохранения ключ нельзя будет прочитать."
          />
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit">{isEditing ? 'Сохранить' : 'Создать магазин'}</Button>
        </div>
      </form>
    </Modal>
  )
}
