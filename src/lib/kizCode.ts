const GS = '\u001d'

export function normalizeKizCode(value: string): string {
  let code = value
    .replace(/[\r\n\t]+$/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')

  // Стандартный идентификатор типа символики, который добавляют USB/BT-сканеры.
  if (/^\][A-Za-z]\d/.test(code)) code = code.slice(3)

  // Часть сканеров передаёт стартовый FNC1 как ведущий ASCII 29. Это метка
  // символики, а не разделитель внутри полезных GS1-данных.
  code = code.replace(/^\u001d+/, '')

  // Некоторые приложения камеры возвращают человекочитаемые AI в скобках.
  const humanReadable = /^\(01\)(\d{14})\(21\)([\s\S]+)$/.exec(code)
  if (humanReadable) code = `01${humanReadable[1]}21${humanReadable[2]}`

  // Некоторые аппаратные сканеры удаляют внутренние GS (ASCII 29) и отдают
  // российский КМ одной плоской строкой. Для точной структуры LP RF безопасно
  // восстанавливаем разделители: serial(13) + 91 + key(4) + 92 + crypto.
  const flattenedRussianCode = /^01(\d{14})21([!-~]{13})91([!-~]{4})92([!-~]+)$/.exec(code)
  if (flattenedRussianCode) {
    code = `01${flattenedRussianCode[1]}21${flattenedRussianCode[2]}${GS}91${flattenedRussianCode[3]}${GS}92${flattenedRussianCode[4]}`
  }

  // Часть GS1 DataMatrix, выпускаемых для товаров лёгкой промышленности,
  // сканеры ZXing возвращают как напечатанный под кодом идентификатор:
  // 14 цифр GTIN + 13 символов серийного номера, без текстовых AI 01 и 21.
  // Восстанавливаем каноническую форму только для этой точной структуры.
  const compactIdentificationCode = /^(\d{14})([!-~]{13})$/.exec(code)
  if (compactIdentificationCode) {
    code = `01${compactIdentificationCode[1]}21${compactIdentificationCode[2]}`
  }
  return code
}

export function isValidGtin14(gtin: string): boolean {
  if (!/^\d{14}$/.test(gtin)) return false
  let sum = 0
  for (let index = 0; index < 13; index += 1) {
    sum += Number(gtin[index]) * (index % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === Number(gtin[13])
}

export function kizValidationError(value: string): string | null {
  const code = normalizeKizCode(value)
  if (code.length < 19 || code.length > 135) {
    return 'Это не КИЗ: код должен содержать GS1-данные товара и серийный номер.'
  }

  const match = /^01(\d{14})21([\s\S]+)$/.exec(code)
  if (!match) return 'Это не КИЗ: ожидается DataMatrix в формате 01 + GTIN + 21 + серийный номер.'
  if (!isValidGtin14(match[1])) return 'КИЗ содержит некорректный GTIN товара. Проверьте DataMatrix и повторите сканирование.'

  const parts = match[2].split(GS)
  const serial = parts[0]
  if (serial.length < 1 || serial.length > 20 || !/^[!-~]+$/.test(serial)) {
    return 'КИЗ содержит некорректный серийный номер. Повторите сканирование DataMatrix.'
  }
  // WB is the source of truth for the cryptographic part. Locally we only make
  // sure a scanner did not lose a GS separator or insert control garbage.
  if (parts.slice(1).some((part) => part.length === 0 || !/^[!-~]+$/.test(part))) {
    return 'КИЗ передан не полностью: проверьте GS-разделители и повторите сканирование DataMatrix.'
  }
  return null
}

export function kizGtin(value: string): string | null {
  const match = /^01(\d{14})21/.exec(normalizeKizCode(value))
  return match?.[1] ?? null
}
