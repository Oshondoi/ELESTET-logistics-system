import { kizHasCryptoTail, kizIdentity, normalizeKizCode } from './kizCode'

export type ParsedPrintFile = {
  full: string[]
  short: number
}

function fileText(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/\^GS/g, '\u001d')
    .replace(/\\u001d/gi, '\u001d')
    .replace(/<GS>/gi, '\u001d')
}

export function parsePrintFile(value: string): ParsedPrintFile {
  const text = fileText(value)
  const fullPattern = /01\d{14}21[!-~]{13}(?:\u001d91[!-~]{4}\u001d92[!-~]+|91[!-~]{4}92[!-~]+)/g
  const shortPattern = /01\d{14}21[!-~]{13}/g
  const full = new Map<string, string>()
  for (const match of text.match(fullPattern) ?? []) {
    const code = normalizeKizCode(match)
    if (!kizHasCryptoTail(code)) continue
    const identity = kizIdentity(code)
    if (!identity) continue
    full.set(`${identity.gtin}:${identity.serial}`, code)
  }
  let short = 0
  for (const match of text.match(shortPattern) ?? []) {
    const identity = kizIdentity(match)
    if (!identity || full.has(`${identity.gtin}:${identity.serial}`)) continue
    short += 1
  }
  return { full: [...full.values()], short }
}

export function parsePrintFileBytes(bytes: Uint8Array): ParsedPrintFile {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const latin = new TextDecoder('iso-8859-1').decode(bytes)
  return parsePrintFile(`${utf8}\n${latin}`)
}
