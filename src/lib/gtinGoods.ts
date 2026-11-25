export type GtinGoodsFields = {
  article: string
  color: string
  size: string
}

const SIZE_WORD = /(?:\d{1,2}X{1,3}[SML]|X{1,3}[SML]|[SML]|XS)/i

function clean(value: string): string {
  return value.replace(/^[,\s]+|[,\s]+$/g, '').replace(/^цвет\s+/i, '').trim()
}

// Название GTIN в Teksher часто одно: «АРТ.Мфлис003 цвет серый 5XL» или «АРТ.2540 кофе, р. XL».
export function parseGtinGoodsName(value: string): GtinGoodsFields {
  const empty = { article: '', color: '', size: '' }
  const text = value.trim()
  if (!text) return empty

  let body = text
  let size = ''
  const marked = /^(.*?)(?:,\s*|\s+)[рp]\.\s*(\S+)\s*$/i.exec(text)
  if (marked) {
    body = marked[1]
    size = marked[2]
  } else {
    const tail = new RegExp(`^(.*\\S)\\s+(${SIZE_WORD.source})$`, 'i').exec(text)
    if (tail) {
      body = tail[1]
      size = tail[2]
    }
  }

  const articleMatch = /^(?:арт|art)\.?\s*(\S+)\s*(.*)$/i.exec(body.trim())
  if (!articleMatch && !size) return empty
  const article = articleMatch?.[1]?.replace(/[.,]$/, '') ?? ''
  const color = clean(articleMatch?.[2] ?? (article ? '' : body))
  return { article, color, size: size.trim() }
}
