import { formatEmailCodeRequestTime } from '../../lib/emailCodeRequest'

export function EmailCodeRequestHint({ requestedAt }: { requestedAt?: string | null }) {
  return <p className="mt-2 text-sm text-slate-500" data-testid="email-code-request-hint">
    {requestedAt && <>Код запрошен: {formatEmailCodeRequestTime(requestedAt)}. </>}
    Откройте последнее письмо от ELESTET{requestedAt ? ' с этой отметкой времени' : ''}.
  </p>
}
