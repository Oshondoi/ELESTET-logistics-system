import { emailRequestNumber } from '../../lib/emailCodeRequest'

export function EmailCodeRequestHint({ requestedAt, sending = false, senderName = 'ELESTET' }: { requestedAt?: string | null; sending?: boolean; senderName?: string | null }) {
  const number = emailRequestNumber(requestedAt)
  return <p aria-live="polite" className="mt-2 h-16 w-full overflow-auto break-words text-lg font-bold text-black" data-testid="email-code-request-hint">
    {sending ? 'Отправка…' : number ? `Откройте письмо №${number}${senderName ? ` от ${senderName}` : ''}` : 'Запросите код на почту'}
  </p>
}
