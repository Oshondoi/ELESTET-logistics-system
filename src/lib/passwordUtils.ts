export const PASSWORD_PATTERN = /^(?=.*\d)[A-Za-z\d]{6,}$/
export const PASSWORD_ERROR = 'Пароль: минимум 6 символов, только буквы и цифры, хотя бы 1 цифра.'

export const validatePassword = (password: string): string | null => {
  if (!PASSWORD_PATTERN.test(password)) return PASSWORD_ERROR
  return null
}

export const normalizePassword = (password: string): string => password.toLowerCase()

export const passwordsMatch = (password: string, confirmation: string): boolean => (
  normalizePassword(password) === normalizePassword(confirmation)
)
