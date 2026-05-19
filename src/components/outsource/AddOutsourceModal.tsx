import { useState } from 'react'
import { sendPartnerRequest } from '../../services/outsourceService'

interface AddOutsourceModalProps {
  accountId: string
  onClose: () => void
  onSuccess: () => void
}

export default function AddOutsourceModal({ accountId, onClose, onSuccess }: AddOutsourceModalProps) {
  const [shortId, setShortId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    const id = parseInt(shortId.trim(), 10)
    if (!shortId.trim() || isNaN(id) || id <= 0) {
      setError('Введите корректный C-ID компании')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await sendPartnerRequest(accountId, id)
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess(true)
        setTimeout(() => {
          onSuccess()
          onClose()
        }, 1500)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка при отправке запроса')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
            <div>
              <h2 className="text-white font-semibold text-lg">Добавить партнёра</h2>
              <p className="text-white/40 text-xs">Аутсорс-компания по C-ID</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-white font-medium">Запрос отправлен!</p>
              <p className="text-white/50 text-sm text-center">
                Компания получит уведомление и сможет принять или отклонить запрос.
              </p>
            </div>
          ) : (
            <>
              <p className="text-white/60 text-sm">
                Введите C-ID компании, которую хотите добавить как аутсорс-партнёра.
                После принятия запроса вы сможете назначать их на этапы партий.
              </p>

              <div>
                <label className="block text-white/60 text-sm mb-2">C-ID компании</label>
                <div className="flex items-center gap-2">
                  <span className="text-white/40 font-mono text-sm shrink-0">C-</span>
                  <input
                    type="number"
                    min="1"
                    value={shortId}
                    onChange={e => { setShortId(e.target.value); setError(null) }}
                    onKeyDown={e => e.key === 'Enter' && void handleSubmit()}
                    placeholder="12345"
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5
                               text-white placeholder-white/30 text-sm
                               focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50
                               [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    autoFocus
                  />
                </div>
                {error && (
                  <p className="mt-2 text-red-400 text-sm flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {error}
                  </p>
                )}
              </div>

              <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3">
                <p className="text-violet-300 text-xs">
                  C-ID компании можно найти на странице Настройки → Компания.
                  Компания увидит ваш запрос в разделе Роли → Аутсорс.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="flex items-center justify-end gap-3 px-6 pb-6">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 text-sm transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={loading || !shortId.trim()}
              className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50
                         disabled:cursor-not-allowed text-white text-sm font-medium transition-colors
                         flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Отправка...
                </>
              ) : (
                'Отправить запрос'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
