import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'

interface Discussion {
  id: string
  discussion_key: string
  title: string
  content: string
  status: 'active' | 'completed'
  revision_no: number
  position: number
  created_at: string
  updated_at: string
  completed_at: string | null
  item_states: DiscussionItemStates
}

type DiscussionItemState = 'agreed' | `agreed:${string}`
type DiscussionItemStates = Record<string, DiscussionItemState>

interface DiscussionRevision {
  id: string
  discussion_id: string
  revision_no: number
  title: string
  content: string
  status: 'active' | 'completed'
  completed_at: string | null
  saved_at: string
  item_states: DiscussionItemStates
  is_current?: boolean
}

type DiscussionView = 'active' | 'completed'

const formatDate = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace(',', '')
}

interface DiscussionToken {
  kind: string
  value: string
  index: number
  itemKey?: string
}

interface DiscussionSection {
  key: string
  tokens: DiscussionToken[]
  itemKeys: string[]
}

const stableKey = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const getDiscussionItemKeys = (content: string) => {
  const keys = new Set<string>()
  const keyOccurrences = new Map<string, number>()
  let currentSectionKey = 'block-intro'
  let inCode = false
  keys.add(currentSectionKey)

  content.replace(/\r\n/g, '\n').split('\n').forEach((line) => {
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      return
    }
    if (inCode) return

    const heading = line.match(/^##\s+(.+)$/)
    if (heading) {
      const baseKey = `block-${stableKey(heading[1])}`
      const occurrence = keyOccurrences.get(baseKey) ?? 0
      keyOccurrences.set(baseKey, occurrence + 1)
      currentSectionKey = `${baseKey}-${occurrence}`
      keys.add(currentSectionKey)
      return
    }

    const bullet = line.match(/^\s*-\s+(.+)$/)
    const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/)
    if (!bullet && !numbered) return
    const kind = bullet ? 'bullet' : 'numbered'
    const value = bullet ? bullet[1] : `${numbered![1]}\t${numbered![2]}`
    const baseKey = `${currentSectionKey}-row-${stableKey(`${kind}:${value}`)}`
    const occurrence = keyOccurrences.get(baseKey) ?? 0
    keyOccurrences.set(baseKey, occurrence + 1)
    keys.add(`${baseKey}-${occurrence}`)
  })

  return keys
}

interface DiscussionSectionMeta {
  key: string
  label: string
  signature: string
  itemKeys: string[]
  rowSignatures: string[]
}

const getDiscussionSectionMeta = (content: string) => {
  const items: DiscussionSectionMeta[] = []
  const keyOccurrences = new Map<string, number>()
  let current: DiscussionSectionMeta = { key: 'block-intro', label: '', signature: '', itemKeys: [], rowSignatures: [] }
  items.push(current)
  let inCode = false

  content.replace(/\r\n/g, '\n').split('\n').forEach((line) => {
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      current.signature += `${line}\n`
      return
    }
    const heading = !inCode ? line.match(/^##\s+(.+)$/) : null
    if (heading) {
      const baseKey = `block-${stableKey(heading[1])}`
      const occurrence = keyOccurrences.get(baseKey) ?? 0
      keyOccurrences.set(baseKey, occurrence + 1)
      current = { key: `${baseKey}-${occurrence}`, label: heading[1], signature: `${line}\n`, itemKeys: [], rowSignatures: [] }
      items.push(current)
      return
    }
    current.signature += `${line}\n`
    if (inCode) return
    const bullet = line.match(/^\s*-\s+(.+)$/)
    const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/)
    if (!bullet && !numbered) return
    const kind = bullet ? 'bullet' : 'numbered'
    const value = bullet ? bullet[1] : `${numbered![1]}\t${numbered![2]}`
    const rowSignature = `${kind}:${value}`
    const baseKey = `${current.key}-row-${stableKey(rowSignature)}`
    const occurrence = keyOccurrences.get(baseKey) ?? 0
    keyOccurrences.set(baseKey, occurrence + 1)
    current.itemKeys.push(`${baseKey}-${occurrence}`)
    current.rowSignatures.push(rowSignature)
  })

  return items.filter((item) => item.signature.trim().length > 0)
}

type DiscussionRowOrigin = 'unchanged' | 'changed' | 'new'

const getDiscussionRowOrigins = (
  current: DiscussionSectionMeta,
  previous: DiscussionSectionMeta | undefined,
) => {
  const result = new Map<string, DiscussionRowOrigin>()
  if (!previous) {
    current.itemKeys.forEach((key) => result.set(key, 'new'))
    return result
  }

  const currentRows = current.rowSignatures
  const previousRows = previous.rowSignatures
  const lengths = Array.from({ length: previousRows.length + 1 }, () => Array<number>(currentRows.length + 1).fill(0))
  for (let previousIndex = previousRows.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let currentIndex = currentRows.length - 1; currentIndex >= 0; currentIndex -= 1) {
      lengths[previousIndex][currentIndex] = previousRows[previousIndex] === currentRows[currentIndex]
        ? lengths[previousIndex + 1][currentIndex + 1] + 1
        : Math.max(lengths[previousIndex + 1][currentIndex], lengths[previousIndex][currentIndex + 1])
    }
  }

  const matches: Array<[number, number]> = []
  let previousIndex = 0
  let currentIndex = 0
  while (previousIndex < previousRows.length && currentIndex < currentRows.length) {
    if (previousRows[previousIndex] === currentRows[currentIndex]) {
      matches.push([previousIndex, currentIndex])
      result.set(current.itemKeys[currentIndex], 'unchanged')
      previousIndex += 1
      currentIndex += 1
    } else if (lengths[previousIndex + 1][currentIndex] >= lengths[previousIndex][currentIndex + 1]) previousIndex += 1
    else currentIndex += 1
  }

  const anchors: Array<[number, number]> = [[-1, -1], ...matches, [previousRows.length, currentRows.length]]
  for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
    const [previousStart, currentStart] = anchors[anchorIndex - 1]
    const [previousEnd, currentEnd] = anchors[anchorIndex]
    const unmatchedPreviousCount = previousEnd - previousStart - 1
    const unmatchedCurrentCount = currentEnd - currentStart - 1
    const changedCount = Math.min(unmatchedPreviousCount, unmatchedCurrentCount)
    for (let offset = 1; offset <= unmatchedCurrentCount; offset += 1) {
      result.set(current.itemKeys[currentStart + offset], offset <= changedCount ? 'changed' : 'new')
    }
  }
  return result
}

const getDiscussionNavigation = (content: string) => getDiscussionSectionMeta(content).filter((item) => item.key !== 'block-intro')

type DiscussionPointTone = 'agreed' | 'changed' | 'discussion'

const getDiscussionPointTone = (
  item: DiscussionSectionMeta,
  itemStates: DiscussionItemStates,
  previousByKey: Map<string, DiscussionSectionMeta> | null,
): DiscussionPointTone => {
  const previous = previousByKey?.get(item.key)
  const changed = Boolean(previousByKey && (!previous || previous.signature !== item.signature))
  const state = itemStates[item.key]
  if (state === `agreed:${stableKey(item.signature)}` || (!changed && state === 'agreed')) return 'agreed'
  return changed ? 'changed' : 'discussion'
}

const pointNavigationClass = (tone: DiscussionPointTone, active: boolean) => {
  if (tone === 'agreed') return active
    ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100'
  if (tone === 'changed') return active
    ? 'border-blue-700 bg-blue-700 text-white shadow-sm'
    : 'border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-400 hover:bg-blue-100'
  return active
    ? 'border-amber-600 bg-amber-600 text-white shadow-sm'
    : 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100'
}

function FullscreenIcon({ active = false }: { active?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={active ? 'M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5' : 'M4 9V4h5m11 5V4h-5M4 15v5h5m11-5v5h-5'} />
    </svg>
  )
}

function CopyRowIcon({ copied = false }: { copied?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={copied ? 'm5 12 4 4L19 6' : 'M9 8.25V6.75A2.75 2.75 0 0 1 11.75 4h5.5A2.75 2.75 0 0 1 20 6.75v5.5A2.75 2.75 0 0 1 17.25 15h-1.5M6.75 9h5.5A2.75 2.75 0 0 1 15 11.75v5.5A2.75 2.75 0 0 1 12.25 20h-5.5A2.75 2.75 0 0 1 4 17.25v-5.5A2.75 2.75 0 0 1 6.75 9Z'} />
    </svg>
  )
}

const reconcileItemStatesAfterEdit = (
  previousContent: string,
  nextContent: string,
  itemStates: DiscussionItemStates,
) => {
  const previousByKey = new Map(getDiscussionSectionMeta(previousContent).map((section) => [section.key, section]))
  const nextStates: DiscussionItemStates = {}
  getDiscussionSectionMeta(nextContent).forEach((section) => {
    const previous = previousByKey.get(section.key)
    if (!previous) return
    if (previous.signature === section.signature && itemStates[section.key]) nextStates[section.key] = itemStates[section.key]
    const previousRowKeys = new Set(previous.itemKeys)
    section.itemKeys.forEach((key) => {
      if (previousRowKeys.has(key) && itemStates[key] === 'agreed') nextStates[key] = 'agreed'
    })
  })
  return nextStates
}

function DiscussionContent({
  content,
  previousContent,
  anchorPrefix,
  itemStates = {},
  onItemStatesChange,
  busy = false,
  fullscreenSectionKey,
  onToggleSectionFullscreen,
}: {
  content: string
  previousContent?: string | null
  anchorPrefix?: string
  itemStates?: DiscussionItemStates
  onItemStatesChange?: (states: DiscussionItemStates) => void
  busy?: boolean
  fullscreenSectionKey?: string | null
  onToggleSectionFullscreen?: (sectionKey: string) => void
}) {
  const [copiedItemKey, setCopiedItemKey] = useState<string | null>(null)
  const sections = useMemo(() => {
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    const result: DiscussionToken[] = []
    let code: string[] | null = null
    let paragraph: string[] = []
    let index = 0

    const flushParagraph = () => {
      if (paragraph.length === 0) return
      result.push({ kind: 'paragraph', value: paragraph.join('\n'), index: index++ })
      paragraph = []
    }

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        flushParagraph()
        if (code) {
          result.push({ kind: 'code', value: code.join('\n'), index: index++ })
          code = null
        } else code = []
        continue
      }
      if (code) {
        code.push(line)
        continue
      }
      if (!line.trim()) {
        flushParagraph()
        continue
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/)
      if (heading) {
        flushParagraph()
        result.push({ kind: `heading-${heading[1].length}`, value: heading[2], index: index++ })
        continue
      }
      const bullet = line.match(/^\s*-\s+(.+)$/)
      if (bullet) {
        flushParagraph()
        result.push({ kind: 'bullet', value: bullet[1], index: index++ })
        continue
      }
      const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/)
      if (numbered) {
        flushParagraph()
        result.push({ kind: 'numbered', value: `${numbered[1]}\t${numbered[2]}`, index: index++ })
        continue
      }
      if (line.startsWith('> ')) {
        flushParagraph()
        result.push({ kind: 'quote', value: line.slice(2), index: index++ })
        continue
      }
      paragraph.push(line)
    }
    flushParagraph()
    if (code) result.push({ kind: 'code', value: code.join('\n'), index: index++ })
    const grouped: DiscussionSection[] = []
    let current: DiscussionSection = { key: 'block-intro', tokens: [], itemKeys: [] }
    const keyOccurrences = new Map<string, number>()
    grouped.push(current)

    result.forEach((token) => {
      if (token.kind === 'heading-2') {
        const baseKey = `block-${stableKey(token.value)}`
        const occurrence = keyOccurrences.get(baseKey) ?? 0
        keyOccurrences.set(baseKey, occurrence + 1)
        current = { key: `${baseKey}-${occurrence}`, tokens: [], itemKeys: [] }
        grouped.push(current)
      }
      if (token.kind === 'bullet' || token.kind === 'numbered') {
        const baseKey = `${current.key}-row-${stableKey(`${token.kind}:${token.value}`)}`
        const occurrence = keyOccurrences.get(baseKey) ?? 0
        keyOccurrences.set(baseKey, occurrence + 1)
        token.itemKey = `${baseKey}-${occurrence}`
        current.itemKeys.push(token.itemKey)
      }
      current.tokens.push(token)
    })

    return grouped.filter((section) => section.tokens.length > 0)
  }, [content])

  const previousKeys = useMemo(() => previousContent ? getDiscussionItemKeys(previousContent) : null, [previousContent])
  const currentSectionsByKey = useMemo(() => new Map(getDiscussionSectionMeta(content).map((section) => [section.key, section])), [content])
  const previousSectionsByKey = useMemo(() => previousContent
    ? new Map(getDiscussionSectionMeta(previousContent).map((section) => [section.key, section]))
    : null, [previousContent])
  const rowOriginsByKey = useMemo(() => {
    const origins = new Map<string, DiscussionRowOrigin>()
    currentSectionsByKey.forEach((section, key) => {
      getDiscussionRowOrigins(section, previousSectionsByKey?.get(key)).forEach((origin, itemKey) => origins.set(itemKey, origin))
    })
    return origins
  }, [currentSectionsByKey, previousSectionsByKey])

  const updateSection = (section: DiscussionSection) => {
    if (!onItemStatesChange || busy) return
    const currentSection = currentSectionsByKey.get(section.key)
    const previousSection = previousSectionsByKey?.get(section.key)
    const hasRevisionChange = Boolean(previousSectionsByKey && (!previousSection || previousSection.signature !== currentSection?.signature))
    const currentAgreement: DiscussionItemState = currentSection ? `agreed:${stableKey(currentSection.signature)}` : 'agreed'
    const isAgreed = itemStates[section.key] === currentAgreement || (!hasRevisionChange && itemStates[section.key] === 'agreed')
    const next = { ...itemStates }
    if (isAgreed) {
      delete next[section.key]
      section.itemKeys.forEach((key) => delete next[key])
    } else {
      next[section.key] = currentAgreement
      section.itemKeys.forEach((key) => { next[key] = 'agreed' })
    }
    onItemStatesChange(next)
  }

  const updateRow = (section: DiscussionSection, itemKey: string) => {
    if (!onItemStatesChange || busy) return
    const next = { ...itemStates }
    if (next[itemKey] === 'agreed') delete next[itemKey]
    else next[itemKey] = 'agreed'
    const allRowsAgreed = section.itemKeys.length > 0 && section.itemKeys.every((key) => next[key] === 'agreed')
    const currentSection = currentSectionsByKey.get(section.key)
    if (allRowsAgreed) next[section.key] = currentSection ? `agreed:${stableKey(currentSection.signature)}` : 'agreed'
    else delete next[section.key]
    onItemStatesChange(next)
  }

  const copyRowText = async (itemKey: string, value: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value)
      else {
        const textarea = document.createElement('textarea')
        textarea.value = value
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        textarea.remove()
      }
      setCopiedItemKey(itemKey)
      window.setTimeout(() => setCopiedItemKey((current) => current === itemKey ? null : current), 1400)
    } catch {
      setCopiedItemKey(null)
    }
  }

  return (
    <div className="space-y-2 text-sm leading-6 text-slate-600">
      {sections.map((section) => {
        const currentSection = currentSectionsByKey.get(section.key)
        const previousSection = previousSectionsByKey?.get(section.key)
        const isNewSection = Boolean(previousSectionsByKey && !previousSection)
        const isChangedSection = Boolean(previousSection && currentSection && previousSection.signature !== currentSection.signature)
        const hasRevisionChange = isNewSection || isChangedSection
        const agreed = itemStates[section.key] === `agreed:${stableKey(currentSection?.signature || '')}` || (!hasRevisionChange && itemStates[section.key] === 'agreed')
        const sectionTone: DiscussionPointTone = agreed ? 'agreed' : hasRevisionChange ? 'changed' : 'discussion'
        const sectionFullscreen = fullscreenSectionKey === section.key
        return (
          <section
            id={anchorPrefix ? `${anchorPrefix}-${section.key}` : undefined}
            key={section.key}
            data-discussion-section-key={section.key}
            className={`scroll-mt-5 border transition ${sectionFullscreen ? 'flex h-screen w-screen min-h-0 flex-col overflow-hidden rounded-none border-0 px-6 py-4' : 'rounded-2xl px-3 py-2.5'} ${agreed ? 'border-emerald-200 bg-emerald-50' : hasRevisionChange ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50'}`}
          >
            <div className="mb-1.5 flex items-center justify-end gap-2">
              {onToggleSectionFullscreen && (
                <button
                  type="button"
                  onClick={() => onToggleSectionFullscreen(section.key)}
                  title={sectionFullscreen ? 'Вернуть пункт обсуждения в обычный вид (Esc)' : 'Открыть только этот пункт на весь экран'}
                  className="mr-auto flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white/80 px-2.5 text-[10px] font-semibold text-slate-600 transition hover:border-blue-300 hover:bg-white hover:text-blue-700"
                >
                  <FullscreenIcon active={sectionFullscreen} />
                  {sectionFullscreen ? 'Свернуть' : 'Фулл скрин'}
                </button>
              )}
              {hasRevisionChange && <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase text-blue-700">{isNewSection ? 'Добавлено' : 'Изменено'}</span>}
              {onItemStatesChange ? (
                <button type="button" disabled={busy} onClick={() => updateSection(section)} className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase transition disabled:cursor-wait disabled:opacity-50 ${agreed ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                  {agreed ? 'Согласовано' : 'В обсуждении'}
                </button>
              ) : (
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${agreed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{agreed ? 'Согласовано' : 'В обсуждении'}</span>
              )}
            </div>
            <div className={`space-y-1.5 ${sectionFullscreen ? 'min-h-0 flex-1 overflow-y-auto scroll-smooth pr-2' : ''}`}>
              {section.tokens.map((block) => {
                if (block.kind === 'heading-1') return <h2 key={block.index} className="pt-2 text-xl font-bold text-slate-900 first:pt-0">{block.value}</h2>
                if (block.kind === 'heading-2') return <h3 key={block.index} className="text-base font-bold text-slate-900">{block.value}</h3>
                if (block.kind === 'heading-3' || block.kind === 'heading-4') return <h4 key={block.index} className="pt-2 text-sm font-bold text-slate-800">{block.value}</h4>
                if (block.kind === 'code') return <pre key={block.index} className={`overflow-x-auto whitespace-pre-wrap rounded-2xl border-l-[12px] bg-slate-950 px-4 py-3 font-mono text-xs leading-5 text-slate-200 ${sectionTone === 'agreed' ? 'border-l-emerald-500' : sectionTone === 'changed' ? 'border-l-blue-500' : 'border-l-amber-500'}`}>{block.value}</pre>
                if (block.kind === 'bullet' && block.itemKey) {
                  const rowAgreed = itemStates[block.itemKey] === 'agreed'
                  const rowOrigin = rowOriginsByKey.get(block.itemKey) ?? (previousKeys?.has(block.itemKey) ? 'unchanged' : 'new')
                  const isNewRow = rowOrigin === 'new'
                  const isChangedRow = rowOrigin === 'changed'
                  const hasRowRevisionChange = isNewRow || isChangedRow
                  const canToggle = Boolean(onItemStatesChange && !busy)
                  return <div key={block.index} role={onItemStatesChange ? 'checkbox' : undefined} aria-checked={onItemStatesChange ? rowAgreed : undefined} aria-disabled={onItemStatesChange ? busy : undefined} tabIndex={canToggle ? 0 : undefined} onClick={canToggle ? () => updateRow(section, block.itemKey!) : undefined} onKeyDown={canToggle ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); updateRow(section, block.itemKey!) } } : undefined} className={`flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left transition ${rowAgreed ? 'bg-emerald-100/80 text-emerald-900' : hasRowRevisionChange ? 'bg-blue-100/70 text-blue-800 ring-1 ring-inset ring-blue-200' : 'bg-amber-100/70 text-amber-900'} ${canToggle ? 'cursor-pointer hover:brightness-[0.98]' : 'cursor-default'}`}><span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${rowAgreed ? 'border-emerald-500 bg-emerald-500 text-white' : hasRowRevisionChange ? 'border-blue-400 bg-white text-transparent' : 'border-amber-400 bg-white text-transparent'}`}>✓</span><button type="button" onClick={(event) => { event.stopPropagation(); void copyRowText(block.itemKey!, block.value) }} onKeyDown={(event) => event.stopPropagation()} title={copiedItemKey === block.itemKey ? 'Скопировано' : 'Скопировать текст подпункта'} aria-label={copiedItemKey === block.itemKey ? 'Текст скопирован' : 'Скопировать текст подпункта'} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition ${copiedItemKey === block.itemKey ? 'bg-emerald-100 text-emerald-700' : 'text-current opacity-55 hover:bg-white/70 hover:opacity-100'}`}><CopyRowIcon copied={copiedItemKey === block.itemKey} /></button><span className="min-w-0 flex-1">{block.value}</span><span className="mt-0.5 flex shrink-0 flex-wrap justify-end gap-1">{hasRowRevisionChange && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold uppercase text-blue-700">{isNewRow ? 'Новое' : 'Изменено'}</span>}<span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${rowAgreed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{rowAgreed ? 'Согласовано' : 'В обсуждении'}</span></span></div>
                }
                if (block.kind === 'numbered' && block.itemKey) {
                  const [number, value] = block.value.split('\t')
                  const rowAgreed = itemStates[block.itemKey] === 'agreed'
                  const rowOrigin = rowOriginsByKey.get(block.itemKey) ?? (previousKeys?.has(block.itemKey) ? 'unchanged' : 'new')
                  const isNewRow = rowOrigin === 'new'
                  const isChangedRow = rowOrigin === 'changed'
                  const hasRowRevisionChange = isNewRow || isChangedRow
                  const canToggle = Boolean(onItemStatesChange && !busy)
                  return <div key={block.index} role={onItemStatesChange ? 'checkbox' : undefined} aria-checked={onItemStatesChange ? rowAgreed : undefined} aria-disabled={onItemStatesChange ? busy : undefined} tabIndex={canToggle ? 0 : undefined} onClick={canToggle ? () => updateRow(section, block.itemKey!) : undefined} onKeyDown={canToggle ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); updateRow(section, block.itemKey!) } } : undefined} className={`flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left transition ${rowAgreed ? 'bg-emerald-100/80 text-emerald-900' : hasRowRevisionChange ? 'bg-blue-100/70 text-blue-800 ring-1 ring-inset ring-blue-200' : 'bg-amber-100/70 text-amber-900'} ${canToggle ? 'cursor-pointer hover:brightness-[0.98]' : 'cursor-default'}`}><span className={`flex min-w-6 items-center justify-center rounded px-1 text-xs font-bold ${rowAgreed ? 'bg-emerald-500 text-white' : hasRowRevisionChange ? 'bg-blue-100 text-blue-800' : 'bg-amber-200 text-amber-800'}`}>{number}.</span><button type="button" onClick={(event) => { event.stopPropagation(); void copyRowText(block.itemKey!, `${number}. ${value}`) }} onKeyDown={(event) => event.stopPropagation()} title={copiedItemKey === block.itemKey ? 'Скопировано' : 'Скопировать текст подпункта'} aria-label={copiedItemKey === block.itemKey ? 'Текст скопирован' : 'Скопировать текст подпункта'} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition ${copiedItemKey === block.itemKey ? 'bg-emerald-100 text-emerald-700' : 'text-current opacity-55 hover:bg-white/70 hover:opacity-100'}`}><CopyRowIcon copied={copiedItemKey === block.itemKey} /></button><span className="min-w-0 flex-1">{value}</span><span className="mt-0.5 flex shrink-0 flex-wrap justify-end gap-1">{hasRowRevisionChange && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold uppercase text-blue-700">{isNewRow ? 'Новое' : 'Изменено'}</span>}<span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${rowAgreed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{rowAgreed ? 'Согласовано' : 'В обсуждении'}</span></span></div>
                }
                if (block.kind === 'quote') return <blockquote key={block.index} className="rounded-r-xl border-l-4 border-violet-300 bg-violet-50 px-4 py-2 text-slate-700">{block.value}</blockquote>
                return <p key={block.index} className="whitespace-pre-wrap">{block.value}</p>
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function DiscussionsTab({ toolbarTarget, onDirtyChange }: { toolbarTarget?: HTMLElement | null; onDirtyChange?: (dirty: boolean) => void }) {
  const [view, setView] = useState<DiscussionView>('active')
  const [discussions, setDiscussions] = useState<Discussion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Discussion | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [historyDiscussion, setHistoryDiscussion] = useState<Discussion | null>(null)
  const [revisions, setRevisions] = useState<DiscussionRevision[]>([])
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [itemStatesSavingId, setItemStatesSavingId] = useState<string | null>(null)
  const [previousContentByDiscussion, setPreviousContentByDiscussion] = useState<Record<string, string>>({})
  const [activeHistoryPointKey, setActiveHistoryPointKey] = useState<string | null>(null)
  const [activeDiscussionPointKey, setActiveDiscussionPointKey] = useState<string | null>(null)
  const [draftItemStatesByDiscussion, setDraftItemStatesByDiscussion] = useState<Record<string, DiscussionItemStates>>({})
  const [dirtyDiscussionIds, setDirtyDiscussionIds] = useState<Set<string>>(new Set())
  const [fullscreenDiscussionId, setFullscreenDiscussionId] = useState<string | null>(null)
  const [fullscreenSectionKey, setFullscreenSectionKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) {
      setError('Нет подключения к базе данных')
      setLoading(false)
      return
    }
    setError('')
    const { data, error: loadError } = await (supabase as any)
      .from('tz_discussions')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: false })
    if (loadError) setError(loadError.message || 'Не удалось загрузить обсуждения')
    else {
      const loadedDiscussions = (data || []).map((item: Discussion) => ({ ...item, item_states: item.item_states || {} }))
      setDiscussions(loadedDiscussions)
      const activeDiscussion = loadedDiscussions.find((item: Discussion) => item.status === 'active')
      if (activeDiscussion) {
        const { data: revisionData } = await (supabase as any)
          .from('tz_discussion_revisions')
          .select('content, revision_no')
          .eq('discussion_id', activeDiscussion.id)
          .order('revision_no', { ascending: false })
        const previousContent = (revisionData || []).find((revision: { content: string }) => revision.content !== activeDiscussion.content)?.content
        setPreviousContentByDiscussion(previousContent ? { [activeDiscussion.id]: previousContent } : {})
      } else setPreviousContentByDiscussion({})
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const dirty = dirtyDiscussionIds.size > 0
    onDirtyChange?.(dirty)
    if (!dirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [dirtyDiscussionIds, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  useEffect(() => {
    const syncFullscreenState = () => {
      const element = document.fullscreenElement as HTMLElement | null
      const elementId = element?.id ?? ''
      setFullscreenDiscussionId(elementId.startsWith('discussion-card-') ? elementId.slice('discussion-card-'.length) : null)
      setFullscreenSectionKey(element?.dataset.discussionSectionKey ?? null)
    }
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

  useEffect(() => {
    if (!historyDiscussion || !activeHistoryPointKey) return
    const frame = window.requestAnimationFrame(() => {
      const navigation = document.getElementById('discussion-history-navigation')
      const activeButton = document.getElementById(`discussion-history-nav-${activeHistoryPointKey}`)
      if (!navigation || !activeButton) return
      const navigationRect = navigation.getBoundingClientRect()
      const buttonRect = activeButton.getBoundingClientRect()
      const targetTop = navigation.scrollTop + buttonRect.top - navigationRect.top - ((navigation.clientHeight - buttonRect.height) / 2)
      navigation.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeHistoryPointKey, historyDiscussion, selectedRevision])

  const active = discussions.filter((item) => item.status === 'active')
  const completed = discussions.filter((item) => item.status === 'completed')
  const visible = view === 'active' ? active : completed

  useEffect(() => {
    const discussion = discussions.find((item) => item.status === 'active')
    if (!discussion || !activeDiscussionPointKey) return
    const frame = window.requestAnimationFrame(() => {
      const navigation = document.getElementById(`discussion-navigation-${discussion.id}`)
      const activeButton = document.getElementById(`discussion-nav-${discussion.id}-${activeDiscussionPointKey}`)
      if (!navigation || !activeButton) return
      const navigationRect = navigation.getBoundingClientRect()
      const buttonRect = activeButton.getBoundingClientRect()
      const targetTop = navigation.scrollTop + buttonRect.top - navigationRect.top - ((navigation.clientHeight - buttonRect.height) / 2)
      navigation.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeDiscussionPointKey, discussions])

  const startEditing = (discussion: Discussion) => {
    setEditing(discussion)
    setEditTitle(discussion.title)
    setEditContent(discussion.content)
    setError('')
  }

  const toggleFullscreen = async (discussionId: string) => {
    const element = document.getElementById(`discussion-card-${discussionId}`)
    if (!element) return
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen()
      else {
        if (document.fullscreenElement) await document.exitFullscreen()
        await element.requestFullscreen()
      }
    } catch {
      setError('Браузер не разрешил открыть обсуждение на весь экран')
    }
  }

  const toggleSectionFullscreen = async (discussionId: string, sectionKey: string) => {
    const element = document.getElementById(`discussion-${discussionId}-${sectionKey}`)
    if (!element) return
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen()
      else await element.requestFullscreen()
    } catch {
      setError('Браузер не разрешил открыть пункт обсуждения на весь экран')
    }
  }

  const closeEditing = () => {
    if (saving) return
    setEditing(null)
    setEditTitle('')
    setEditContent('')
  }

  const saveEditing = async () => {
    if (!supabase || !editing || !editTitle.trim() || !editContent.trim() || saving) return
    setSaving(true)
    setError('')
    const nextContent = editContent.trim()
    const nextItemStates = reconcileItemStatesAfterEdit(editing.content, nextContent, editing.item_states || {})
    const { error: saveError } = await (supabase as any)
      .from('tz_discussions')
      .update({
        title: editTitle.trim(),
        content: nextContent,
        item_states: nextItemStates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editing.id)
      .eq('status', 'active')
    if (saveError) setError(saveError.message || 'Не удалось обновить ответ')
    else {
      setEditing(null)
      await load()
    }
    setSaving(false)
  }

  const completeDiscussion = async (discussion: Discussion) => {
    if (!supabase || saving) return
    if (!window.confirm('Снять этот ответ и перенести его в завершённые? Финальная версия сохранится в истории.')) return
    setSaving(true)
    setError('')
    const now = new Date().toISOString()
    const { error: completeError } = await (supabase as any)
      .from('tz_discussions')
      .update({ status: 'completed', completed_at: now, updated_at: now })
      .eq('id', discussion.id)
      .eq('status', 'active')
    if (completeError) setError(completeError.message || 'Не удалось снять ответ')
    else {
      await load()
      setView('completed')
    }
    setSaving(false)
  }

  const restoreDiscussion = async (discussion: Discussion) => {
    if (!supabase || saving) return
    if (active.length > 0) {
      setError('Сначала снимите текущий актуальный ответ. Одновременно актуальным может быть только один ответ.')
      return
    }
    if (!window.confirm('Вернуть этот ответ в актуальные? Завершённая версия останется в истории.')) return
    setSaving(true)
    setError('')
    const { error: restoreError } = await (supabase as any)
      .from('tz_discussions')
      .update({ status: 'active', completed_at: null, updated_at: new Date().toISOString() })
      .eq('id', discussion.id)
      .eq('status', 'completed')
    if (restoreError) setError(restoreError.message || 'Не удалось вернуть ответ в актуальные')
    else {
      await load()
      setView('active')
    }
    setSaving(false)
  }

  const openHistory = async (discussion: Discussion) => {
    if (!supabase) return
    setHistoryDiscussion(discussion)
    setHistoryLoading(true)
    setRevisions([])
    setSelectedRevision(discussion.revision_no)
    setActiveHistoryPointKey(getDiscussionNavigation(discussion.content)[0]?.key ?? null)
    setError('')
    const { data, error: historyError } = await (supabase as any)
      .from('tz_discussion_revisions')
      .select('id, discussion_id, revision_no, title, content, status, completed_at, saved_at, item_states')
      .eq('discussion_id', discussion.id)
      .order('revision_no', { ascending: false })
    if (historyError) {
      setError(historyError.message || 'Не удалось загрузить версии ответа')
      setHistoryDiscussion(null)
    } else setRevisions((data || []).map((item: DiscussionRevision) => ({ ...item, item_states: item.item_states || {} })))
    setHistoryLoading(false)
  }

  const stageItemStates = (discussion: Discussion, itemStates: DiscussionItemStates) => {
    setDraftItemStatesByDiscussion((current) => ({ ...current, [discussion.id]: itemStates }))
    setDirtyDiscussionIds((current) => new Set(current).add(discussion.id))
  }

  const discardItemStates = (discussionId: string) => {
    setDraftItemStatesByDiscussion((current) => {
      const next = { ...current }
      delete next[discussionId]
      return next
    })
    setDirtyDiscussionIds((current) => {
      const next = new Set(current)
      next.delete(discussionId)
      return next
    })
  }

  const saveItemStates = async (discussion: Discussion) => {
    const itemStates = draftItemStatesByDiscussion[discussion.id]
    if (!supabase || !itemStates || itemStatesSavingId) return
    setItemStatesSavingId(discussion.id)
    setError('')
    const { error: saveError } = await (supabase as any)
      .from('tz_discussions')
      .update({ item_states: itemStates, updated_at: new Date().toISOString() })
      .eq('id', discussion.id)
      .eq('status', 'active')
    if (saveError) {
      setError(saveError.message || 'Не удалось сохранить состояние пунктов')
    } else {
      discardItemStates(discussion.id)
      await load()
    }
    setItemStatesSavingId(null)
  }

  const changeView = (nextView: DiscussionView) => {
    if (nextView === view) return
    if (dirtyDiscussionIds.size > 0 && !window.confirm('Несохранённые отметки будут отменены. Продолжить?')) return
    setDraftItemStatesByDiscussion({})
    setDirtyDiscussionIds(new Set())
    setView(nextView)
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const viewControls = (
    <div className="flex w-fit items-center rounded-xl bg-slate-100 p-1">
      <button type="button" onClick={() => changeView('active')} className={`h-8 rounded-lg px-4 text-sm font-medium transition ${view === 'active' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
        Актуальный{active.length > 0 ? ` (${active.length})` : ''}
      </button>
      <button type="button" onClick={() => changeView('completed')} className={`h-8 rounded-lg px-4 text-sm font-medium transition ${view === 'completed' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
        Завершённые{completed.length > 0 ? ` (${completed.length})` : ''}
      </button>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {toolbarTarget ? createPortal(viewControls, toolbarTarget) : <div className="mb-3 flex justify-end">{viewControls}</div>}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Загрузка...</div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {view === 'active' ? 'Актуального ответа пока нет.' : 'Завершённых обсуждений пока нет.'}
        </div>
      ) : (
        <div className={`min-h-0 flex-1 ${view === 'active' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
          {visible.map((discussion) => {
            const expanded = view === 'active' || expandedIds.has(discussion.id)
            const navigationItems = getDiscussionNavigation(discussion.content)
            const previousNavigationByKey = previousContentByDiscussion[discussion.id]
              ? new Map(getDiscussionSectionMeta(previousContentByDiscussion[discussion.id]).map((item) => [item.key, item]))
              : null
            const anchorPrefix = `discussion-${discussion.id}`
            const selectedPointKey = activeDiscussionPointKey ?? navigationItems[0]?.key
            const showPointNavigation = discussion.status === 'active'
            const effectiveItemStates = draftItemStatesByDiscussion[discussion.id] ?? discussion.item_states
            const itemStatesDirty = dirtyDiscussionIds.has(discussion.id)
            const isFullscreen = fullscreenDiscussionId === discussion.id
            const trackActivePoint = (container: HTMLElement) => {
              if (navigationItems.length === 0) return
              const containerTop = container.getBoundingClientRect().top
              let activeKey = navigationItems[0].key
              navigationItems.forEach((item) => {
                const section = document.getElementById(`${anchorPrefix}-${item.key}`)
                if (section && section.getBoundingClientRect().top - containerTop <= 28) activeKey = item.key
              })
              if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) activeKey = navigationItems[navigationItems.length - 1].key
              setActiveDiscussionPointKey((current) => current === activeKey ? current : activeKey)
            }
            const scrollToPoint = (key: string) => {
              setActiveDiscussionPointKey(key)
              const container = document.getElementById(`discussion-content-${discussion.id}`)
              const section = document.getElementById(`${anchorPrefix}-${key}`)
              if (!container || !section) return
              const targetTop = container.scrollTop + section.getBoundingClientRect().top - container.getBoundingClientRect().top
              container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
            }
            return (
              <article id={`discussion-card-${discussion.id}`} key={discussion.id} className={`${isFullscreen ? 'flex h-screen w-screen min-h-0 flex-col overflow-hidden rounded-none border-0' : 'rounded-2xl border border-slate-200 shadow-sm'} bg-white ${discussion.status === 'active' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'mb-3'}`}>
                <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">{discussion.title}</h2>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${discussion.status === 'active' ? 'bg-violet-50 text-violet-600' : 'bg-emerald-50 text-emerald-600'}`}>
                        {discussion.status === 'active' ? 'Актуальный' : 'Завершён'}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Редакция {discussion.revision_no}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Обновлён {formatDate(discussion.updated_at)}{discussion.completed_at ? ` · снят ${formatDate(discussion.completed_at)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {itemStatesDirty && discussion.status === 'active' && <>
                      <span className="hidden text-[11px] font-medium text-amber-600 xl:inline">Есть несохранённые отметки</span>
                      <button type="button" disabled={itemStatesSavingId === discussion.id} onClick={() => discardItemStates(discussion.id)} className="h-8 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">Отменить</button>
                      <button type="button" disabled={itemStatesSavingId === discussion.id} onClick={() => void saveItemStates(discussion)} className="h-8 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-50">{itemStatesSavingId === discussion.id ? 'Сохранение...' : 'Сохранить'}</button>
                    </>}
                    {discussion.status === 'active' && <button type="button" onClick={() => void toggleFullscreen(discussion.id)} title={isFullscreen ? 'Вернуть поле обсуждения в обычный вид (Esc)' : 'Развернуть поле обсуждения на весь экран'} className="flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                      <FullscreenIcon active={isFullscreen} />
                      {isFullscreen ? 'Свернуть' : 'Фулл скрин'}
                    </button>}
                    <button type="button" disabled={itemStatesDirty} title={itemStatesDirty ? 'Сначала сохраните или отмените отметки' : undefined} onClick={() => void openHistory(discussion)} className="h-8 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
                      Версии ({discussion.revision_no})
                    </button>
                    {discussion.status === 'completed' && (
                      <>
                        <button type="button" onClick={() => toggleExpanded(discussion.id)} className="h-8 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50">
                          {expanded ? 'Свернуть' : 'Открыть'}
                        </button>
                        <button type="button" disabled={saving || active.length > 0} title={active.length > 0 ? 'Сначала снимите текущий актуальный ответ' : 'Вернуть ответ в актуальные'} onClick={() => void restoreDiscussion(discussion)} className="h-8 rounded-xl bg-violet-500 px-3 text-xs font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40">
                          Вернуть в актуальные
                        </button>
                      </>
                    )}
                    {discussion.status === 'active' && (
                      <>
                        <button type="button" disabled={itemStatesDirty} title={itemStatesDirty ? 'Сначала сохраните или отмените отметки' : undefined} onClick={() => startEditing(discussion)} className="h-8 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-40">Редактировать</button>
                        <button type="button" disabled={saving || itemStatesDirty} title={itemStatesDirty ? 'Сначала сохраните или отмените отметки' : undefined} onClick={() => void completeDiscussion(discussion)} className="h-8 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Снять ответ</button>
                      </>
                    )}
                  </div>
                </header>
                {expanded && (
                  <div className={`${showPointNavigation ? 'grid grid-cols-[52px_minmax(0,1fr)]' : ''} min-h-0 flex-1 overflow-hidden`}>
                    {showPointNavigation && <nav id={`discussion-navigation-${discussion.id}`} className="min-h-0 overflow-y-auto scroll-smooth border-r border-slate-100 bg-white px-2 py-3" aria-label="Навигация по пунктам обсуждения">
                      <div className="flex flex-col items-center gap-1.5">
                        {navigationItems.map((item, index) => (
                          <button id={`discussion-nav-${discussion.id}-${item.key}`} key={item.key} type="button" onClick={() => {
                            scrollToPoint(item.key)
                          }} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold transition ${pointNavigationClass(getDiscussionPointTone(item, effectiveItemStates, previousNavigationByKey), selectedPointKey === item.key)}`}>
                            {item.label.match(/^(\d+)/)?.[1] ?? index + 1}
                          </button>
                        ))}
                      </div>
                    </nav>}
                    <div id={`discussion-content-${discussion.id}`} onScroll={(event) => trackActivePoint(event.currentTarget)} className="min-h-0 min-w-0 scroll-smooth overflow-y-auto px-5 py-3 sm:px-7"><DiscussionContent content={discussion.content} previousContent={discussion.status === 'active' ? previousContentByDiscussion[discussion.id] : null} itemStates={effectiveItemStates} onItemStatesChange={discussion.status === 'active' ? (states) => stageItemStates(discussion, states) : undefined} busy={itemStatesSavingId === discussion.id} anchorPrefix={anchorPrefix} fullscreenSectionKey={fullscreenSectionKey} onToggleSectionFullscreen={discussion.status === 'active' ? (sectionKey) => void toggleSectionFullscreen(discussion.id, sectionKey) : undefined} /></div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
              <div><h2 className="text-base font-bold text-slate-900">Редактировать актуальный ответ</h2><p className="mt-0.5 text-xs text-slate-400">Предыдущая редакция сохранится автоматически.</p></div>
              <button type="button" onClick={closeEditing} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Закрыть">×</button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Заголовок</span><input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Текст ответа</span><textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} className="min-h-[58vh] w-full resize-y rounded-xl border border-slate-200 px-4 py-3 font-mono text-sm leading-6 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button type="button" onClick={closeEditing} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Отмена</button>
              <button type="button" onClick={() => void saveEditing()} disabled={saving || !editTitle.trim() || !editContent.trim()} className="rounded-xl bg-violet-500 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-600 disabled:opacity-50">{saving ? 'Сохранение...' : 'Сохранить редакцию'}</button>
            </div>
          </div>
        </div>
      )}

      {historyDiscussion && (() => {
        const currentRevision: DiscussionRevision = {
          id: `current-${historyDiscussion.id}`,
          discussion_id: historyDiscussion.id,
          revision_no: historyDiscussion.revision_no,
          title: historyDiscussion.title,
          content: historyDiscussion.content,
          status: historyDiscussion.status,
          completed_at: historyDiscussion.completed_at,
          saved_at: historyDiscussion.updated_at,
          item_states: historyDiscussion.item_states || {},
          is_current: true,
        }
        const versions = [currentRevision, ...revisions]
          .sort((left, right) => right.revision_no - left.revision_no)
        const selected = versions.find((item) => item.revision_no === selectedRevision) ?? currentRevision
        const navigationItems = getDiscussionNavigation(selected.content)
        const selectedVersionIndex = versions.findIndex((item) => item.id === selected.id)
        const previousVersionContent = versions
          .slice(selectedVersionIndex + 1)
          .find((item) => item.content !== selected.content)?.content ?? null
        const previousHistoryNavigationByKey = previousVersionContent
          ? new Map(getDiscussionSectionMeta(previousVersionContent).map((item) => [item.key, item]))
          : null
        const anchorPrefix = `history-${selected.id}`
        const scrollToPoint = (key: string) => {
          setActiveHistoryPointKey(key)
          document.getElementById(`${anchorPrefix}-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        const selectHistoryRevision = (revision: DiscussionRevision) => {
          setSelectedRevision(revision.revision_no)
          setActiveHistoryPointKey(getDiscussionNavigation(revision.content)[0]?.key ?? null)
          document.getElementById('discussion-history-content')?.scrollTo({ top: 0, behavior: 'smooth' })
        }
        const trackActiveHistoryPoint = (container: HTMLElement) => {
          if (navigationItems.length === 0) return
          const containerTop = container.getBoundingClientRect().top
          let activeKey = navigationItems[0].key
          navigationItems.forEach((item) => {
            const section = document.getElementById(`${anchorPrefix}-${item.key}`)
            if (section && section.getBoundingClientRect().top - containerTop <= 72) activeKey = item.key
          })
          if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) activeKey = navigationItems[navigationItems.length - 1].key
          setActiveHistoryPointKey((current) => current === activeKey ? current : activeKey)
        }
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
            <div className="flex h-[90vh] w-[80vw] max-w-none flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
                <div><h2 className="text-base font-bold text-slate-900">История версий</h2><p className="mt-0.5 text-xs text-slate-400">{historyDiscussion.title}</p></div>
                <button type="button" onClick={() => setHistoryDiscussion(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Закрыть">×</button>
              </div>
              {historyLoading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Загрузка версий...</div>
              ) : (
                <div className="grid min-h-0 flex-1 grid-cols-[220px_52px_minmax(0,1fr)] lg:grid-cols-[260px_56px_minmax(0,1fr)]">
                  <aside className="min-h-0 overflow-y-auto scroll-smooth border-r border-slate-100 bg-slate-50 p-3">
                    <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Версии</p>
                    <div className="space-y-1.5">
                      {versions.map((revision) => (
                        <button key={revision.id} type="button" onClick={() => selectHistoryRevision(revision)} className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${selected.revision_no === revision.revision_no ? 'border-violet-200 bg-white shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-white'}`}>
                          <div className="flex items-center justify-between gap-2"><span className={`text-sm font-semibold ${selected.revision_no === revision.revision_no ? 'text-violet-700' : 'text-slate-700'}`}>Редакция {revision.revision_no}</span>{revision.is_current && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-600">Текущая</span>}</div>
                          <p className="mt-1 text-[11px] text-slate-400">{formatDate(revision.saved_at)}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">{revision.status === 'active' ? 'Была актуальной' : 'Была завершённой'}</p>
                        </button>
                      ))}
                    </div>
                  </aside>
                  <nav id="discussion-history-navigation" className="min-h-0 overflow-y-auto scroll-smooth border-r border-slate-100 bg-white px-2 py-3" aria-label="Навигация по пунктам редакции">
                    <div className="flex flex-col items-center gap-1.5">
                      {navigationItems.map((item, index) => (
                        <button id={`discussion-history-nav-${item.key}`} key={item.key} type="button" onClick={() => scrollToPoint(item.key)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold transition ${pointNavigationClass(getDiscussionPointTone(item, selected.item_states, previousHistoryNavigationByKey), activeHistoryPointKey === item.key)}`}>
                          {item.label.match(/^(\d+)/)?.[1] ?? index + 1}
                        </button>
                      ))}
                    </div>
                  </nav>
                  <main id="discussion-history-content" onScroll={(event) => trackActiveHistoryPoint(event.currentTarget)} className="min-h-0 scroll-smooth overflow-y-auto px-5 py-5 sm:px-7">
                    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
                      <h3 className="text-base font-bold text-slate-900">{selected.title}</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Редакция {selected.revision_no}</span>
                    </div>
                    <DiscussionContent content={selected.content} previousContent={previousVersionContent} itemStates={selected.item_states} anchorPrefix={anchorPrefix} />
                  </main>
                </div>
              )}
              <div className="flex shrink-0 justify-end border-t border-slate-100 px-6 py-4">
                <button type="button" onClick={() => setHistoryDiscussion(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Закрыть</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
