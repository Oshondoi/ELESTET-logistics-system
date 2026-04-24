export const formatDate = (value: string | null) => {
  if (!value) return '—'

  return new Date(value).toLocaleDateString('ru-RU')
}

export const formatDateInputValue = (value: string | null) => {
  if (!value) return ''

  return value.slice(0, 10)
}

export const cn = (...classNames: Array<string | false | null | undefined>) =>
  classNames.filter(Boolean).join(' ')

export const randomStoreCode = () => {
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26))
  const digits = Math.floor(1000 + Math.random() * 9000)

  return `${letter}${digits}`
}

/** Русское склонение: pluralRu(1, 'коробок', 'коробка', 'коробов') → 'коробок' */
export const pluralRu = (n: number, one: string, few: string, many: string): string => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
