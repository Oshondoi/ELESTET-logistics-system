// A display-only request timestamp, never a credential or an OTP validity check.
// Kept in RedirectTo so resends/recovery do not depend on stale user metadata.
export const EMAIL_REQUEST_PREFIX = 'https://elestet.net/auth-email/'

export function createEmailCodeRequest() {
  const requestedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return { requestedAt, redirectTo: EMAIL_REQUEST_PREFIX + requestedAt }
}

export function formatEmailCodeRequestTime(value: string) {
  return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}, ${value.slice(11, 19)} UTC`
}
