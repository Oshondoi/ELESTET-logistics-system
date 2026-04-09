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
