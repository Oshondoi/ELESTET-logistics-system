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

type DiscussionAgreement = 'discussion' | 'agreed' | 'implemented'
type DiscussionItemState = 'agreed' | 'implemented' | `agreed:${string}` | `implemented:${string}`
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
  indent?: number
  codeKey?: string
  parentKey?: string
}

interface DiscussionSection {
  key: string
  legacyKey: string
  label: string
  identity: string
  ownSignature: string
  agreementSignature: string
  tokens: DiscussionToken[]
  itemKeys: string[]
  rows: DiscussionRowMeta[]
  codes: DiscussionCodeMeta[]
}

const stableKey = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

type DiscussionOrigin = 'unchanged' | 'new' | 'changed' | 'moved' | 'moved-changed'

interface DiscussionRowMeta {
  key: string
  legacyKey: string
  signature: string
  sectionKey: string
}

interface DiscussionCodeMeta {
  key: string
  signature: string
  sectionKey: string
  parentKey: string
}

interface DiscussionComparison {
  sectionOrigins: Map<string, DiscussionOrigin>
  rowOrigins: Map<string, DiscussionOrigin>
  codeOrigins: Map<string, DiscussionOrigin>
  previousSectionByCurrent: Map<string, DiscussionSection>
  previousRowByCurrent: Map<string, DiscussionRowMeta>
}

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU')
const stripOrdinal = (value: string) => value.replace(/^\s*\d+\s*[.)]\s*/, '').trim()
const sectionIdentity = (value: string) => normalizeText(stripOrdinal(value))
const rowIdentity = (value: string) => normalizeText(value.replace(/^\s*\d+\s*[.)]\s*/, ''))
const indentation = (value: string) => value.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0

const parseDiscussion = (content: string): DiscussionSection[] => {
  const tokens: DiscussionToken[] = []
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  let paragraph: string[] = []
  let code: string[] | null = null
  let codeIndent = 0
  let index = 0
  const flushParagraph = () => {
    if (paragraph.length === 0) return
    tokens.push({ kind: 'paragraph', value: paragraph.join('\n'), index: index++ })
    paragraph = []
  }
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      flushParagraph()
      if (code) {
        tokens.push({ kind: 'code', value: code.join('\n'), index: index++, indent: codeIndent })
        code = null
      } else {
        code = []
        codeIndent = indentation(line)
      }
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
      tokens.push({ kind: `heading-${heading[1].length}`, value: heading[2], index: index++ })
      continue
    }
    const bullet = line.match(/^(\s*)-\s+(.+)$/)
    const numbered = line.match(/^(\s*)(\d+)\.\s+(.+)$/)
    if (bullet || numbered) {
      flushParagraph()
      tokens.push({ kind: 'row', value: bullet ? bullet[2] : numbered![3], index: index++, indent: (bullet ? bullet[1] : numbered![1]).replace(/\t/g, '  ').length, parentKey: bullet ? `bullet:${bullet[2]}` : `numbered:${numbered![2]}\t${numbered![3]}` })
      continue
    }
    if (line.startsWith('> ')) {
      flushParagraph()
      tokens.push({ kind: 'quote', value: line.slice(2), index: index++ })
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  if (code) tokens.push({ kind: 'code', value: code.join('\n'), index: index++, indent: codeIndent })

  const sections: DiscussionSection[] = []
  const occurrences = new Map<string, number>()
  const createSection = (label: string, key: string, legacyKey: string): DiscussionSection => ({ key, legacyKey, label, identity: sectionIdentity(label), ownSignature: '', agreementSignature: '', tokens: [], itemKeys: [], rows: [], codes: [] })
  let current = createSection('', 'block-intro', 'block-intro')
  let lastRowKey: string | null = null
  sections.push(current)
  tokens.forEach((token) => {
    if (token.kind === 'heading-2') {
      const identity = sectionIdentity(token.value)
      const baseKey = `block-${stableKey(identity)}`
      const occurrence = occurrences.get(baseKey) ?? 0
      occurrences.set(baseKey, occurrence + 1)
      const legacyBaseKey = `block-${stableKey(token.value)}`
      current = createSection(token.value, `${baseKey}-${occurrence}`, `${legacyBaseKey}-${occurrence}`)
      sections.push(current)
      lastRowKey = null
    }
    if (token.kind === 'row') {
      const signature = rowIdentity(token.value)
      const baseKey = `${current.key}-row-${stableKey(signature)}`
      const occurrence = occurrences.get(baseKey) ?? 0
      occurrences.set(baseKey, occurrence + 1)
      token.itemKey = `${baseKey}-${occurrence}`
      current.itemKeys.push(token.itemKey)
      const legacyBaseKey = `${current.legacyKey}-row-${stableKey(token.parentKey || `bullet:${token.value}`)}`
      const legacyOccurrence = occurrences.get(legacyBaseKey) ?? 0
      occurrences.set(legacyBaseKey, legacyOccurrence + 1)
      current.rows.push({ key: token.itemKey, legacyKey: `${legacyBaseKey}-${legacyOccurrence}`, signature, sectionKey: current.key })
      lastRowKey = token.itemKey
    } else if (token.kind === 'code') {
      const signature = normalizeText(token.value)
      const parentKey = (token.indent ?? 0) > 0 && lastRowKey ? lastRowKey : current.key
      const baseKey = `${parentKey}-code-${stableKey(signature)}`
      const occurrence = occurrences.get(baseKey) ?? 0
      occurrences.set(baseKey, occurrence + 1)
      token.parentKey = parentKey
      token.codeKey = `${baseKey}-${occurrence}`
      current.codes.push({ key: token.codeKey, signature, sectionKey: current.key, parentKey })
    } else if (token.kind !== 'row') {
      const ownValue = token.kind === 'heading-2' ? sectionIdentity(token.value) : normalizeText(token.value)
      current.ownSignature += `${token.kind}:${ownValue}\n`
      if (token.kind !== 'heading-2' && token.kind !== 'code') current.agreementSignature += `${token.kind}:${ownValue}\n`
      if (token.kind === 'heading-1' || token.kind === 'heading-3' || token.kind === 'heading-4' || token.kind === 'paragraph' || token.kind === 'quote') lastRowKey = null
    }
    current.tokens.push(token)
  })
  return sections.filter((section) => section.tokens.length > 0)
}

const textSimilarity = (left: string, right: string) => {
  if (left === right) return 1
  const leftWords = new Set(left.split(/\s+/).filter(Boolean))
  const rightWords = new Set(right.split(/\s+/).filter(Boolean))
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length
  const union = new Set([...leftWords, ...rightWords]).size
  return union ? intersection / union : 0
}

const compareDiscussion = (current: DiscussionSection[], previous: DiscussionSection[] | null): DiscussionComparison => {
  const result: DiscussionComparison = { sectionOrigins: new Map(), rowOrigins: new Map(), codeOrigins: new Map(), previousSectionByCurrent: new Map(), previousRowByCurrent: new Map() }
  if (!previous) {
    current.forEach((section) => {
      result.sectionOrigins.set(section.key, 'new')
      section.rows.forEach((row) => result.rowOrigins.set(row.key, 'new'))
      section.codes.forEach((code) => result.codeOrigins.set(code.key, 'new'))
    })
    return result
  }

  const unusedPreviousSections = new Set(previous)
  current.forEach((section) => {
    const match = [...unusedPreviousSections].find((candidate) => candidate.identity === section.identity)
    if (match) {
      unusedPreviousSections.delete(match)
      result.previousSectionByCurrent.set(section.key, match)
    }
  })
  const unmatchedCurrentSections = current.filter((section) => !result.previousSectionByCurrent.has(section.key))
  unmatchedCurrentSections.forEach((section) => {
    const candidates = [...unusedPreviousSections]
    if (candidates.length === 0) return
    const currentIndex = current.indexOf(section)
    const match = candidates.sort((left, right) => Math.abs(previous.indexOf(left) - currentIndex) - Math.abs(previous.indexOf(right) - currentIndex))[0]
    unusedPreviousSections.delete(match)
    result.previousSectionByCurrent.set(section.key, match)
  })
  current.forEach((section) => {
    const match = result.previousSectionByCurrent.get(section.key)
    result.sectionOrigins.set(section.key, !match ? 'new' : match.ownSignature === section.ownSignature ? 'unchanged' : 'changed')
  })

  const previousRows = previous.flatMap((section) => section.rows)
  const unusedPreviousRows = new Set(previousRows)
  const currentRows = current.flatMap((section) => section.rows)
  const expectedPreviousSection = (row: DiscussionRowMeta) => result.previousSectionByCurrent.get(row.sectionKey)?.key
  const bindRow = (row: DiscussionRowMeta, match: DiscussionRowMeta, origin: DiscussionOrigin) => {
    unusedPreviousRows.delete(match)
    result.previousRowByCurrent.set(row.key, match)
    result.rowOrigins.set(row.key, origin)
  }
  currentRows.forEach((row) => {
    const parentKey = expectedPreviousSection(row)
    const match = [...unusedPreviousRows].find((candidate) => candidate.sectionKey === parentKey && candidate.signature === row.signature)
    if (match) bindRow(row, match, 'unchanged')
  })
  currentRows.filter((row) => !result.rowOrigins.has(row.key)).forEach((row) => {
    const match = [...unusedPreviousRows].find((candidate) => candidate.signature === row.signature)
    if (match) bindRow(row, match, 'moved')
  })
  currentRows.filter((row) => !result.rowOrigins.has(row.key)).forEach((row) => {
    const parentKey = expectedPreviousSection(row)
    const candidates = [...unusedPreviousRows].filter((candidate) => candidate.sectionKey === parentKey)
    const match = candidates.sort((left, right) => textSimilarity(row.signature, right.signature) - textSimilarity(row.signature, left.signature))[0]
    if (match && textSimilarity(row.signature, match.signature) >= 0.35) bindRow(row, match, 'changed')
  })
  currentRows.filter((row) => !result.rowOrigins.has(row.key)).forEach((row) => {
    const candidates = [...unusedPreviousRows]
    const match = candidates.sort((left, right) => textSimilarity(row.signature, right.signature) - textSimilarity(row.signature, left.signature))[0]
    if (match && textSimilarity(row.signature, match.signature) >= 0.55) bindRow(row, match, 'moved-changed')
    else result.rowOrigins.set(row.key, 'new')
  })

  const previousCodes = previous.flatMap((section) => section.codes)
  const unusedPreviousCodes = new Set(previousCodes)
  const currentCodes = current.flatMap((section) => section.codes)
  const previousParentForCode = (code: DiscussionCodeMeta) => {
    if (code.parentKey === code.sectionKey) return result.previousSectionByCurrent.get(code.sectionKey)?.key
    return result.previousRowByCurrent.get(code.parentKey)?.key
  }
  const bindCode = (code: DiscussionCodeMeta, match: DiscussionCodeMeta, origin: DiscussionOrigin) => {
    unusedPreviousCodes.delete(match)
    result.codeOrigins.set(code.key, origin)
  }
  currentCodes.forEach((code) => {
    const parentKey = previousParentForCode(code)
    const match = [...unusedPreviousCodes].find((candidate) => candidate.parentKey === parentKey && candidate.signature === code.signature)
    if (match) bindCode(code, match, 'unchanged')
  })
  currentCodes.filter((code) => !result.codeOrigins.has(code.key)).forEach((code) => {
    const match = [...unusedPreviousCodes].find((candidate) => candidate.signature === code.signature)
    if (match) bindCode(code, match, 'moved')
  })
  currentCodes.filter((code) => !result.codeOrigins.has(code.key)).forEach((code) => {
    const parentKey = previousParentForCode(code)
    const candidates = [...unusedPreviousCodes].filter((candidate) => candidate.parentKey === parentKey)
    const match = candidates.sort((left, right) => textSimilarity(code.signature, right.signature) - textSimilarity(code.signature, left.signature))[0]
    if (match && textSimilarity(code.signature, match.signature) >= 0.35) bindCode(code, match, 'changed')
  })
  currentCodes.filter((code) => !result.codeOrigins.has(code.key)).forEach((code) => {
    const candidates = [...unusedPreviousCodes]
    const match = candidates.sort((left, right) => textSimilarity(code.signature, right.signature) - textSimilarity(code.signature, left.signature))[0]
    if (match && textSimilarity(code.signature, match.signature) >= 0.55) bindCode(code, match, 'moved-changed')
    else result.codeOrigins.set(code.key, 'new')
  })
  return result
}

const normalizeItemStates = (content: string, itemStates: DiscussionItemStates | null | undefined): DiscussionItemStates => {
  const source = itemStates || {}
  const normalized: DiscussionItemStates = {}
  parseDiscussion(content).forEach((section) => {
    section.rows.forEach((row) => {
      const rowState = source[row.key] ?? source[row.legacyKey]
      if (rowState === 'agreed' || rowState === 'implemented') normalized[row.key] = rowState
    })
    const sectionState = source[section.key] ?? source[section.legacyKey]
    const currentAgreementHash = stableKey(section.agreementSignature)
    const legacyOwnHash = stableKey(section.ownSignature)
    if (sectionState === 'implemented' || sectionState === `implemented:${currentAgreementHash}` || sectionState === `implemented:${legacyOwnHash}`) normalized[section.key] = `implemented:${currentAgreementHash}`
    else if (sectionState === 'agreed' || sectionState === `agreed:${currentAgreementHash}` || sectionState === `agreed:${legacyOwnHash}`) normalized[section.key] = `agreed:${currentAgreementHash}`
  })
  return normalized
}

const getDiscussionNavigation = (content: string) => parseDiscussion(content).filter((item) => item.key !== 'block-intro')

type DiscussionPointTone = 'implemented' | 'revised-implemented' | 'agreed' | 'revised-agreed' | 'revised-discussion' | 'discussion'

const rowAgreement = (state: DiscussionItemState | undefined): DiscussionAgreement => {
  if (state === 'implemented') return 'implemented'
  if (state === 'agreed') return 'agreed'
  return 'discussion'
}

const sectionOwnAgreement = (item: DiscussionSection, state: DiscussionItemState | undefined): DiscussionAgreement => {
  const signature = stableKey(item.agreementSignature)
  if (state === 'implemented' || state === `implemented:${signature}`) return 'implemented'
  if (state === 'agreed' || state === `agreed:${signature}`) return 'agreed'
  return 'discussion'
}

const sectionAgreement = (item: DiscussionSection, itemStates: DiscussionItemStates): DiscussionAgreement => {
  if (item.itemKeys.length === 0) return sectionOwnAgreement(item, itemStates[item.key])
  const rowStatuses = item.itemKeys.map((key) => rowAgreement(itemStates[key]))
  if (rowStatuses.every((status) => status === 'implemented')) return 'implemented'
  if (rowStatuses.every((status) => status !== 'discussion')) return 'agreed'
  return 'discussion'
}

const agreementLabel = (agreement: DiscussionAgreement) => {
  if (agreement === 'implemented') return 'Реализовано'
  if (agreement === 'agreed') return 'Согласовано'
  return 'В обсуждении'
}

const getDiscussionPointTone = (
  item: DiscussionSection,
  itemStates: DiscussionItemStates,
  origin: DiscussionOrigin,
): DiscussionPointTone => {
  const agreement = sectionAgreement(item, itemStates)
  const revised = origin !== 'unchanged'
  if (agreement === 'implemented') return revised ? 'revised-implemented' : 'implemented'
  if (agreement === 'agreed') return revised ? 'revised-agreed' : 'agreed'
  return revised ? 'revised-discussion' : 'discussion'
}

const toneFor = (origin: DiscussionOrigin, agreement: DiscussionAgreement): DiscussionPointTone => {
  const revised = origin !== 'unchanged'
  if (agreement === 'implemented') return revised ? 'revised-implemented' : 'implemented'
  if (agreement === 'agreed') return revised ? 'revised-agreed' : 'agreed'
  return revised ? 'revised-discussion' : 'discussion'
}

const originLabel = (origin: DiscussionOrigin, section = false) => {
  if (origin === 'new') return section ? 'Добавлено' : 'Новое'
  if (origin === 'changed') return 'Изменено'
  if (origin === 'moved') return 'Перемещено'
  if (origin === 'moved-changed') return 'Перемещено и изменено'
  return null
}

const pointNavigationClass = (tone: DiscussionPointTone, active: boolean) => {
  if (tone === 'implemented') return active
    ? 'border-slate-700 bg-slate-700 text-white shadow-sm'
    : 'border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-500 hover:bg-slate-200'
  if (tone === 'revised-implemented') return active
    ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
    : 'border-slate-400 bg-slate-200 text-slate-800 hover:border-slate-600 hover:bg-slate-300'
  if (tone === 'agreed') return active
    ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100'
  if (tone === 'revised-agreed') return active
    ? 'border-blue-700 bg-blue-700 text-white shadow-sm'
    : 'border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-400 hover:bg-blue-100'
  if (tone === 'revised-discussion') return active
    ? 'border-violet-700 bg-violet-700 text-white shadow-sm'
    : 'border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100'
  return active
    ? 'border-amber-600 bg-amber-600 text-white shadow-sm'
    : 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100'
}

const discussionSurfaceClass = (tone: DiscussionPointTone) => {
  if (tone === 'implemented') return 'border-slate-300 bg-slate-100'
  if (tone === 'revised-implemented') return 'border-slate-400 bg-slate-200/80'
  if (tone === 'agreed') return 'border-emerald-200 bg-emerald-50'
  if (tone === 'revised-agreed') return 'border-blue-200 bg-blue-50'
  if (tone === 'revised-discussion') return 'border-violet-200 bg-violet-50'
  return 'border-amber-200 bg-amber-50'
}

const discussionRowClass = (tone: DiscussionPointTone) => {
  if (tone === 'implemented') return 'bg-slate-200/80 text-slate-800'
  if (tone === 'revised-implemented') return 'bg-slate-300/80 text-slate-900 ring-1 ring-inset ring-slate-400'
  if (tone === 'agreed') return 'bg-emerald-100/80 text-emerald-900'
  if (tone === 'revised-agreed') return 'bg-blue-100/80 text-blue-900'
  if (tone === 'revised-discussion') return 'bg-violet-100/70 text-violet-900 ring-1 ring-inset ring-violet-200'
  return 'bg-amber-100/70 text-amber-900'
}

const discussionBadgeClass = (tone: DiscussionPointTone) => {
  if (tone === 'implemented') return 'bg-slate-200 text-slate-700'
  if (tone === 'revised-implemented') return 'bg-slate-300 text-slate-900'
  if (tone === 'agreed') return 'bg-emerald-100 text-emerald-700'
  if (tone === 'revised-agreed') return 'bg-blue-100 text-blue-700'
  if (tone === 'revised-discussion') return 'bg-violet-100 text-violet-700'
  return 'bg-amber-100 text-amber-700'
}

const discussionCodeBorderClass = (tone: DiscussionPointTone) => {
  if (tone === 'implemented') return 'border-l-slate-500'
  if (tone === 'revised-implemented') return 'border-l-slate-700'
  if (tone === 'agreed') return 'border-l-emerald-500'
  if (tone === 'revised-agreed') return 'border-l-blue-500'
  if (tone === 'revised-discussion') return 'border-l-violet-500'
  return 'border-l-amber-500'
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
  const previous = parseDiscussion(previousContent)
  const nextSections = parseDiscussion(nextContent)
  const comparison = compareDiscussion(nextSections, previous)
  const nextStates: DiscussionItemStates = {}
  nextSections.forEach((section) => {
    const previousSection = comparison.previousSectionByCurrent.get(section.key)
    section.rows.forEach((row) => {
      const previousRow = comparison.previousRowByCurrent.get(row.key)
      const previousRowState = previousRow ? itemStates[previousRow.key] : undefined
      const origin = comparison.rowOrigins.get(row.key)
      if ((origin === 'unchanged' || origin === 'moved') && (previousRowState === 'agreed' || previousRowState === 'implemented')) nextStates[row.key] = previousRowState
    })
    const agreementHash = stableKey(section.agreementSignature)
    if (section.itemKeys.length > 0) {
      const rowStatuses = section.itemKeys.map((key) => rowAgreement(nextStates[key]))
      if (rowStatuses.every((status) => status === 'implemented')) nextStates[section.key] = `implemented:${agreementHash}`
      else if (rowStatuses.every((status) => status !== 'discussion')) nextStates[section.key] = `agreed:${agreementHash}`
      return
    }
    const ownTextUnchanged = previousSection?.agreementSignature === section.agreementSignature
    if (!previousSection || !ownTextUnchanged) return
    const previousAgreement = sectionOwnAgreement(previousSection, itemStates[previousSection.key])
    if (previousAgreement === 'implemented') nextStates[section.key] = `implemented:${agreementHash}`
    else if (previousAgreement === 'agreed') nextStates[section.key] = `agreed:${agreementHash}`
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
  previousContent: string | null
  anchorPrefix?: string
  itemStates?: DiscussionItemStates
  onItemStatesChange?: (states: DiscussionItemStates) => void
  busy?: boolean
  fullscreenSectionKey?: string | null
  onToggleSectionFullscreen?: (sectionKey: string) => void
}) {
  const [copiedItemKey, setCopiedItemKey] = useState<string | null>(null)
  const sections = useMemo(() => parseDiscussion(content), [content])
  const previousSections = useMemo(() => previousContent === null ? null : parseDiscussion(previousContent), [previousContent])
  const comparison = useMemo(() => compareDiscussion(sections, previousSections), [sections, previousSections])
  const currentSectionsByKey = useMemo(() => new Map(sections.map((section) => [section.key, section])), [sections])

  const updateSection = (section: DiscussionSection) => {
    if (!onItemStatesChange || busy) return
    const currentSection = currentSectionsByKey.get(section.key)
    if (!currentSection || sectionAgreement(currentSection, itemStates) === 'implemented') return
    const currentAgreement = sectionAgreement(currentSection, itemStates)
    const agreementState: DiscussionItemState = `agreed:${stableKey(currentSection.agreementSignature)}`
    const next = { ...itemStates }
    if (currentAgreement === 'agreed') {
      delete next[section.key]
      section.itemKeys.forEach((key) => { if (next[key] === 'agreed') delete next[key] })
    } else {
      next[section.key] = agreementState
      section.itemKeys.forEach((key) => { if (next[key] !== 'implemented') next[key] = 'agreed' })
    }
    onItemStatesChange(next)
  }

  const updateRow = (section: DiscussionSection, itemKey: string) => {
    if (!onItemStatesChange || busy) return
    const next = { ...itemStates }
    if (next[itemKey] === 'implemented') return
    if (next[itemKey] === 'agreed') delete next[itemKey]
    else next[itemKey] = 'agreed'
    const currentSection = currentSectionsByKey.get(section.key)
    const rowStatuses = section.itemKeys.map((key) => rowAgreement(next[key]))
    if (currentSection && rowStatuses.every((status) => status === 'implemented')) next[section.key] = `implemented:${stableKey(currentSection.agreementSignature)}`
    else if (currentSection && rowStatuses.every((status) => status !== 'discussion')) next[section.key] = `agreed:${stableKey(currentSection.agreementSignature)}`
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
        const sectionOrigin = comparison.sectionOrigins.get(section.key) ?? 'new'
        const sectionOriginLabel = originLabel(sectionOrigin, true)
        const agreement = currentSection ? sectionAgreement(currentSection, itemStates) : 'discussion'
        const sectionTone = toneFor(sectionOrigin, agreement)
        const sectionFullscreen = fullscreenSectionKey === section.key
        return (
          <section
            id={anchorPrefix ? `${anchorPrefix}-${section.key}` : undefined}
            key={section.key}
            data-discussion-section-key={section.key}
            className={`scroll-mt-5 border transition ${sectionFullscreen ? 'flex h-screen w-screen min-h-0 flex-col overflow-hidden rounded-none border-0 px-6 py-4' : 'rounded-2xl px-3 py-2.5'} ${discussionSurfaceClass(sectionTone)}`}
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
              {sectionOriginLabel && <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${discussionBadgeClass(sectionTone)}`}>{sectionOriginLabel}</span>}
              {onItemStatesChange && agreement !== 'implemented' ? (
                <button type="button" disabled={busy} onClick={() => updateSection(section)} className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase transition hover:brightness-95 disabled:cursor-wait disabled:opacity-50 ${discussionBadgeClass(sectionTone)}`}>
                  {agreementLabel(agreement)}
                </button>
              ) : (
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${discussionBadgeClass(sectionTone)}`}>{agreementLabel(agreement)}</span>
              )}
            </div>
            <div className={`space-y-1.5 ${sectionFullscreen ? 'min-h-0 flex-1 overflow-y-auto scroll-smooth pr-2' : ''}`}>
              {section.tokens.map((block) => {
                if (block.kind === 'heading-1') return <h2 key={block.index} className="pt-2 text-xl font-bold text-slate-900 first:pt-0">{block.value}</h2>
                if (block.kind === 'heading-2') return <h3 key={block.index} className="text-base font-bold text-slate-900">{block.value}</h3>
                if (block.kind === 'heading-3' || block.kind === 'heading-4') return <h4 key={block.index} className="pt-2 text-sm font-bold text-slate-800">{block.value}</h4>
                if (block.kind === 'code' && block.codeKey) {
                  const codeOrigin = comparison.codeOrigins.get(block.codeKey) ?? 'new'
                  const codeAgreement = block.parentKey === section.key ? agreement : rowAgreement(itemStates[block.parentKey || ''])
                  return <pre key={block.index} className={`overflow-x-auto whitespace-pre-wrap rounded-2xl border-l-[12px] bg-slate-950 px-4 py-3 font-mono text-xs leading-5 text-slate-200 ${discussionCodeBorderClass(toneFor(codeOrigin, codeAgreement))}`}>{block.value}</pre>
                }
                if (block.kind === 'row' && block.itemKey) {
                  const rowStatus = rowAgreement(itemStates[block.itemKey])
                  const rowOrigin = comparison.rowOrigins.get(block.itemKey) ?? 'new'
                  const rowOriginLabel = originLabel(rowOrigin)
                  const rowTone = toneFor(rowOrigin, rowStatus)
                  const canToggle = Boolean(onItemStatesChange && !busy && rowStatus !== 'implemented')
                  return <div key={block.index} role={canToggle ? 'checkbox' : undefined} aria-checked={canToggle ? rowStatus === 'agreed' : undefined} aria-disabled={onItemStatesChange ? busy || rowStatus === 'implemented' : undefined} tabIndex={canToggle ? 0 : undefined} onClick={canToggle ? () => updateRow(section, block.itemKey!) : undefined} onKeyDown={canToggle ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); updateRow(section, block.itemKey!) } } : undefined} className={`flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left transition ${discussionRowClass(rowTone)} ${canToggle ? 'cursor-pointer hover:brightness-[0.98]' : 'cursor-default'}`}>{rowStatus !== 'implemented' && <span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${rowStatus === 'agreed' ? rowTone === 'revised-agreed' ? 'border-blue-500 bg-blue-500 text-white' : 'border-emerald-500 bg-emerald-500 text-white' : rowTone === 'revised-discussion' ? 'border-violet-400 bg-white text-transparent' : 'border-amber-400 bg-white text-transparent'}`}>✓</span>}<button type="button" onClick={(event) => { event.stopPropagation(); void copyRowText(block.itemKey!, block.value) }} onKeyDown={(event) => event.stopPropagation()} title={copiedItemKey === block.itemKey ? 'Скопировано' : 'Скопировать текст подпункта'} aria-label={copiedItemKey === block.itemKey ? 'Текст скопирован' : 'Скопировать текст подпункта'} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition ${copiedItemKey === block.itemKey ? discussionBadgeClass(rowTone) : 'text-current opacity-55 hover:bg-white/70 hover:opacity-100'}`}><CopyRowIcon copied={copiedItemKey === block.itemKey} /></button><span className="min-w-0 flex-1">{block.value}</span><span className="mt-0.5 flex shrink-0 flex-wrap justify-end gap-1">{rowOriginLabel && <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${discussionBadgeClass(rowTone)}`}>{rowOriginLabel}</span>}<span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${discussionBadgeClass(rowTone)}`}>{agreementLabel(rowStatus)}</span></span></div>
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
  const [previousContentByDiscussion, setPreviousContentByDiscussion] = useState<Record<string, string | null>>({})
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
      const loadedDiscussions = (data || []).map((item: Discussion) => ({ ...item, item_states: normalizeItemStates(item.content, item.item_states) }))
      setDiscussions(loadedDiscussions)
      if (loadedDiscussions.length > 0) {
        const { data: revisionData, error: revisionError } = await (supabase as any)
          .from('tz_discussion_revisions')
          .select('discussion_id, content, revision_no')
          .in('discussion_id', loadedDiscussions.map((item: Discussion) => item.id))
          .order('revision_no', { ascending: false })
        if (revisionError) {
          setDiscussions([])
          setPreviousContentByDiscussion({})
          setError(revisionError.message || 'Не удалось загрузить историю обсуждений')
        } else {
          const previousByDiscussion: Record<string, string | null> = {}
          loadedDiscussions.forEach((discussion: Discussion) => {
            previousByDiscussion[discussion.id] = (revisionData || []).find((revision: { discussion_id: string; content: string }) => revision.discussion_id === discussion.id && revision.content !== discussion.content)?.content ?? null
          })
          setPreviousContentByDiscussion(previousByDiscussion)
        }
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
    if (completeError) setError(completeError.message || 'Не удалось завершить редакцию')
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
    } else setRevisions((data || []).map((item: DiscussionRevision) => ({ ...item, item_states: normalizeItemStates(item.content, item.item_states) })))
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
            const previousContent = previousContentByDiscussion[discussion.id] ?? null
            const navigationComparison = compareDiscussion(parseDiscussion(discussion.content), previousContent === null ? null : parseDiscussion(previousContent))
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
                        <button type="button" disabled={saving || itemStatesDirty} title={itemStatesDirty ? 'Сначала сохраните или отмените отметки' : undefined} onClick={() => void completeDiscussion(discussion)} className="h-8 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Завершить редакцию</button>
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
                          }} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold transition ${pointNavigationClass(getDiscussionPointTone(item, effectiveItemStates, navigationComparison.sectionOrigins.get(item.key) ?? 'new'), selectedPointKey === item.key)}`}>
                            {item.label.match(/^(\d+)/)?.[1] ?? index + 1}
                          </button>
                        ))}
                      </div>
                    </nav>}
                    <div id={`discussion-content-${discussion.id}`} onScroll={(event) => trackActivePoint(event.currentTarget)} className="min-h-0 min-w-0 scroll-smooth overflow-y-auto px-5 py-3 sm:px-7"><DiscussionContent content={discussion.content} previousContent={previousContent} itemStates={effectiveItemStates} onItemStatesChange={discussion.status === 'active' ? (states) => stageItemStates(discussion, states) : undefined} busy={itemStatesSavingId === discussion.id} anchorPrefix={anchorPrefix} fullscreenSectionKey={fullscreenSectionKey} onToggleSectionFullscreen={discussion.status === 'active' ? (sectionKey) => void toggleSectionFullscreen(discussion.id, sectionKey) : undefined} /></div>
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
        const historyComparison = compareDiscussion(parseDiscussion(selected.content), previousVersionContent === null ? null : parseDiscussion(previousVersionContent))
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
                        <button id={`discussion-history-nav-${item.key}`} key={item.key} type="button" onClick={() => scrollToPoint(item.key)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold transition ${pointNavigationClass(getDiscussionPointTone(item, selected.item_states, historyComparison.sectionOrigins.get(item.key) ?? 'new'), activeHistoryPointKey === item.key)}`}>
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
