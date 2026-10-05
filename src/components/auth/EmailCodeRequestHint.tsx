import { emailRequestNumber } from '../../lib/emailCodeRequest'

export function EmailCodeRequestHint({ requestedAt, sending = false }: { requestedAt?: string | null; sending?: boolean }) {
  const number = emailRequestNumber(requestedAt)
  return <p aria-live="polite" className="mt-2 h-16 w-full overflow-auto break-words text-lg font-bold text-black" data-testid="email-code-request-hint">
    {sending ? 'Отправка…' : number ? `Откройте письмо №${number} от ELESTET` : 'Запросите код на почту'}
  </p>
}
