import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

interface CreateCompanyPageProps {
  onCreateCompany: (name: string) => Promise<unknown>
}

export const CreateCompanyPage = ({ onCreateCompany }: CreateCompanyPageProps) => {
  const [companyName, setCompanyName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!companyName.trim()) {
      setError('Введите название компании')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await onCreateCompany(companyName)
      setCompanyName('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось создать компанию')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-[460px] rounded-[28px] border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-6">
          <div className="text-[24px] font-bold tracking-tight text-slate-900">Создайте компанию</div>
          <div className="mt-2 text-sm leading-6 text-slate-500">
            Без компании в систему дальше не пускаем. Сначала создайте первую компанию, потом сможете добавить
            магазины и начать работу.
          </div>
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <Input
            label="Название компании"
            placeholder='Например, ОсОО "АЭРОН"'
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            required
          />

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}

          <Button type="submit" className="mt-2 w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Создание...' : 'Создать компанию'}
          </Button>
        </form>
      </div>
    </div>
  )
}
