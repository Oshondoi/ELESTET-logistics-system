export type UserMessageKind = 'error' | 'success' | 'info'

export const USER_MESSAGE_DURATION: Record<UserMessageKind, number> = {
  error: 10_000,
  info: 8_000,
  success: 6_000,
}

const translations: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'Неверная почта или пароль.'],
  [/email not confirmed/i, 'Почта ещё не подтверждена. Откройте письмо и подтвердите регистрацию.'],
  [/user already registered|already been registered/i, 'Пользователь с такой почтой уже зарегистрирован.'],
  [/signup.*disabled/i, 'Регистрация новых пользователей временно отключена.'],
  [/password should be at least|password.*too short/i, 'Пароль слишком короткий.'],
  [/rate limit|too many requests|over_request_rate_limit/i, 'Слишком много запросов. Подождите немного и повторите попытку.'],
  [/failed to fetch|networkerror|network request failed|load failed/i, 'Нет связи с сервером. Проверьте интернет и повторите попытку.'],
  [/jwt.*expired|token.*expired/i, 'Сессия истекла. Войдите в систему снова.'],
  [/invalid refresh token|refresh token.*not found/i, 'Сессия завершена. Войдите в систему снова.'],
  [/no_permission|permission denied|not authorized|unauthorized/i, 'Недостаточно прав для выполнения действия.'],
  [/row-level security|violates row level security/i, 'Недостаточно прав для изменения этих данных.'],
  [/duplicate key|unique constraint|already exists/i, 'Такая запись уже существует.'],
  [/timeout|timed out/i, 'Сервер не успел ответить. Повторите попытку.'],
  [/\bHTTP\s*401\b/i, 'Сессия истекла. Войдите в систему снова.'],
  [/\bHTTP\s*403\b|\bWB\s*403\b/i, 'Нет доступа к операции. Проверьте права и API-ключ магазина.'],
  [/\bHTTP\s*404\b|\bWB\s*404\b/i, 'Запрошенные данные не найдены. Обновите страницу и повторите попытку.'],
  [/\bHTTP\s*409\b|\bWB\s*409\b/i, 'Действие конфликтует с уже изменёнными данными. Обновите страницу и повторите попытку.'],
  [/\bHTTP\s*429\b|\bWB\s*429\b/i, 'Wildberries временно ограничил частоту запросов. Подождите и повторите попытку.'],
  [/\b(?:HTTP|WB|DB)\s*5\d\d\b/i, 'Сервис временно недоступен. Повторите попытку позже.'],
]

function fallback(kind: UserMessageKind) {
  if (kind === 'success') return 'Действие выполнено успешно.'
  if (kind === 'info') return 'Операция выполняется. Пожалуйста, подождите.'
  return 'Не удалось выполнить действие. Повторите попытку. Если ошибка повторится, обратитесь к администратору.'
}

/** Преобразует серверный или технический текст в понятное уведомление для пользователя. */
export function toUserMessage(input: unknown, kind: UserMessageKind = 'error'): string {
  let message = input instanceof Error ? input.message : String(input ?? '')
  message = message
    .replace(/^\s*(?:error|ошибка)\s*:\s*/i, '')
    .replace(/^.*?message["']?\s*:\s*["']?/i, '')
    .replace(/["'}]+\s*$/g, '')
    .trim()

  if (!message) return fallback(kind)

  for (const [pattern, translation] of translations) {
    if (pattern.test(message)) return translation
  }

  const damaged = /\?{2,}|�|(?:Р.|С.){4,}/u.test(message)
  if (damaged) {
    if (/QR/i.test(message) && /WB/i.test(message)) {
      return 'Не удалось обработать QR-код WB. Проверьте, что баркод товара соответствует выбранному заказу.'
    }
    if (/КИЗ/i.test(message)) return 'Не удалось обработать КИЗ. Проверьте код и повторите сканирование.'
    return fallback(kind)
  }

  const hasCyrillic = /[А-Яа-яЁё]/u.test(message)
  const looksTechnical = /^(?:TypeError|PostgrestError|FunctionsHttpError|AuthApiError)|\b(?:SQLSTATE|PGRST\d+|ECONN|fetch|JSON)\b/i.test(message)
  if (!hasCyrillic && looksTechnical) return fallback(kind)
  if (!hasCyrillic && /[A-Za-z]/.test(message)) return fallback(kind)

  return message
}
