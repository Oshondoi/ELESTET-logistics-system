const GS = '\u001d'

export function normalizeKizCode(value: string): string {
  let code = value
    .replace(/[\r\n\t]+$/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')

  // Стандартный идентификатор типа символики, который добавляют USB/BT-сканеры.
  if (/^\][A-Za-z]\d/.test(code)) code = code.slice(3)

  // Некоторые приложения камеры возвращают человекочитаемые AI в скобках.
  const humanReadable = /^\(01\)(\d{14})\(21\)([\s\S]+)$/.exec(code)
  if (humanReadable) code = `01${humanReadable[1]}21${humanReadable[2]}`
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
  if (parts.slice(1).some((part) => !/^\d{2,4}[!-~]+$/.test(part))) {
    return 'КИЗ содержит повреждённый криптографический хвост. Повторите сканирование DataMatrix.'
  }
  return null
}

export function kizGtin(value: string): string | null {
  const match = /^01(\d{14})21/.exec(normalizeKizCode(value))
  return match?.[1] ?? null
}

export function kizMatchesProductBarcode(kiz: string, barcode: string | null | undefined): boolean {
  if (!barcode || !/^\d{13,14}$/.test(barcode)) return true
  const gtin = kizGtin(kiz)
  if (!gtin) return false
  return barcode.length === 13 ? gtin === `0${barcode}` : gtin === barcode
}
