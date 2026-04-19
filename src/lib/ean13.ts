/** Вычисляет контрольную цифру EAN-13 для первых 12 цифр */
const calcCheckDigit = (digits12: string): number => {
  const sum = digits12.split('').reduce((acc, d, i) => {
    const n = parseInt(d, 10)
    return acc + (i % 2 === 0 ? n : n * 3)
  }, 0)
  return (10 - (sum % 10)) % 10
}

/** Генерирует валидный EAN-13. Префикс 200 — внутренние/частные коды */
export const generateEAN13 = (): string => {
  const prefix = '200'
  let body = ''
  for (let i = 0; i < 9; i++) {
    body += Math.floor(Math.random() * 10).toString()
  }
  const base = prefix + body
  const check = calcCheckDigit(base)
  return base + check
}

/** Проверяет что строка является валидным EAN-13 */
export const isValidEAN13 = (code: string): boolean => {
  if (!/^\d{13}$/.test(code)) return false
  const check = calcCheckDigit(code.slice(0, 12))
  return check === parseInt(code[12], 10)
}
