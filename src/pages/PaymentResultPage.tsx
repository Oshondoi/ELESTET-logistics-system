import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { getPaymentOrderStatus } from '../services/paymentService'
import type { PaymentOrderStatus } from '../services/paymentService'

const PLAN_LABELS: Record<string, string> = {
  seller: 'Селлер',
  operational: 'Операционный',
  premium: 'Премиум',
}

interface PaymentResultPageProps {
  onAccountRefresh: () => void
}

export const PaymentResultPage = ({ onAccountRefresh }: PaymentResultPageProps) => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const orderId = searchParams.get('order_id')

  const [order, setOrder] = useState<PaymentOrderStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const refreshedRef = useRef(false)

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => {
    if (!orderId) {
      setError('Не указан номер заказа')
      setLoading(false)
      return
    }

    const check = async () => {
      try {
        const status = await getPaymentOrderStatus(orderId)
        if (!status) {
          setError('Заказ не найден')
          setLoading(false)
          stopPolling()
          return
        }
        setOrder(status)
        setLoading(false)

        if (status.status === 'paid') {
          stopPolling()
          if (!refreshedRef.current) {
            refreshedRef.current = true
            onAccountRefresh()
          }
        } else if (status.status === 'failed' || status.status === 'expired' || status.status === 'cancelled') {
          stopPolling()
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка проверки статуса')
        setLoading(false)
        stopPolling()
      }
    }

    void check()
    // Опрашиваем каждые 3 секунды пока статус pending
    pollRef.current = setInterval(() => { void check() }, 3000)

    // Автоматически останавливаем опрос через 2 минуты
    const timeout = setTimeout(() => {
      stopPolling()
      setOrder((prev) => prev?.status === 'pending' ? { ...prev, status: 'expired' } : prev)
    }, 120_000)

    return () => {
      stopPolling()
      clearTimeout(timeout)
    }
  }, [orderId])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-500" />
        <p className="text-sm text-slate-500">Проверяем статус оплаты...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
        <div className="max-w-sm rounded-3xl border border-rose-100 bg-rose-50 px-8 py-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-2xl">✗</div>
          <h2 className="mb-2 text-lg font-black text-slate-800">Ошибка</h2>
          <p className="mb-6 text-sm text-slate-500">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/subscription')}
            className="rounded-xl bg-slate-700 px-6 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Вернуться к тарифам
          </button>
        </div>
      </div>
    )
  }

  if (order?.status === 'paid') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
        <div className="max-w-sm rounded-3xl border border-emerald-100 bg-emerald-50 px-8 py-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-2xl">✓</div>
          <h2 className="mb-2 text-lg font-black text-slate-800">Оплата прошла!</h2>
          <p className="mb-1 text-sm text-slate-600">
            Тариф <strong>{PLAN_LABELS[order.plan] ?? order.plan}</strong> активирован на{' '}
            <strong>{order.months} мес.</strong>
          </p>
          <p className="mb-6 text-xs text-slate-400">
            Сумма: {Number(order.amount_som).toLocaleString('ru-RU')} сом
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-xl bg-emerald-500 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
          >
            На главную
          </button>
        </div>
      </div>
    )
  }

  if (order?.status === 'pending') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-500" />
        <p className="text-sm font-medium text-slate-700">Ожидаем подтверждение оплаты...</p>
        <p className="text-xs text-slate-400">Страница обновляется автоматически</p>
      </div>
    )
  }

  // failed / expired / cancelled
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="max-w-sm rounded-3xl border border-orange-100 bg-orange-50 px-8 py-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-2xl">!</div>
        <h2 className="mb-2 text-lg font-black text-slate-800">Платёж не завершён</h2>
        <p className="mb-6 text-sm text-slate-500">
          {order?.status === 'expired' && 'Время ожидания оплаты истекло.'}
          {order?.status === 'failed' && 'Оплата не прошла. Попробуйте ещё раз.'}
          {order?.status === 'cancelled' && 'Платёж отменён.'}
        </p>
        <button
          type="button"
          onClick={() => navigate('/subscription')}
          className="rounded-xl bg-slate-700 px-6 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Попробовать снова
        </button>
      </div>
    </div>
  )
}
