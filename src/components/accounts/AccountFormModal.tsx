import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'

interface AccountFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (name: string) => Promise<unknown>
}

const initialValues = {
  name: '',
  inn: '',
}

export const AccountFormModal = ({ open, onClose, onSubmit }: AccountFormModalProps) => {
  const [values, setValues] = useState(initialValues)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setValues(initialValues)
      setError(null)
      setIsSubmitting(false)
    }
  }, [open])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!values.name.trim()) {
      setError('Введите название компании')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await onSubmit(values.name)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось создать компанию')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Добавить компанию"
      description="Создание новой компании внутри текущего пользователя."
    >
      <form className="grid gap-4" onSubmit={handleSubmit}>
        <Input
          label="Название компании"
          placeholder='Например, ОсОО "АЭРОН"'
          value={values.name}
          onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
          required
        />
        <Input
          label="ИНН"
          placeholder="Например, 00602202610081"
          value={values.inn}
          onChange={(event) => setValues((current) => ({ ...current, inn: event.target.value }))}
        />

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            Создать компанию
          </Button>
        </div>
      </form>
    </Modal>
  )
}
