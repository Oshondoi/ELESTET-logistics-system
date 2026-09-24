import { useCallback, useEffect, useMemo, useState } from 'react'
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

type DiscussionItemStates = Record<string, 'agreed'>

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

const getDiscussionNavigation = (content: string) => {
  const items: Array<{ key: string; label: string }> = []
  const keyOccurrences = new Map<string, number>()
  let inCode = false

  content.replace(/\r\n/g, '\n').split('\n').forEach((line) => {
    if (line.trim().startsWith('```')) {
      inCode = !inCode
      return
    }
    if (inCode) return
    const heading = line.match(/^##\s+(.+)$/)
    if (!heading) return
    const baseKey = `block-${stableKey(heading[1])}`
    const occurrence = keyOccurrences.get(baseKey) ?? 0
    keyOccurrences.set(baseKey, occurrence + 1)
    items.push({ key: `${baseKey}-${occurrence}`, label: heading[1] })
  })

  return items
}

function DiscussionContent({
  content,
  previousContent,
  anchorPrefix,
  itemStates = {},
  onItemStatesChange,
  busy = false,
}: {
  content: string
  previousContent?: string | null
  anchorPrefix?: string
  itemStates?: DiscussionItemStates
  onItemStatesChange?: (states: DiscussionItemStates) => void
  busy?: boolean
}) {
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

  const updateSection = (section: DiscussionSection) => {
    if (!onItemStatesChange || busy) return
    const isAgreed = itemStates[section.key] === 'agreed'
    const next = { ...itemStates }
    if (isAgreed) {
      delete next[section.key]
      section.itemKeys.forEach((key) => delete next[key])
    } else {
      next[section.key] = 'agreed'
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
    if (allRowsAgreed) next[section.key] = 'agreed'
    else delete next[section.key]
    onItemStatesChange(next)
  }

  return (
    <div className="space-y-2 text-sm leading-6 text-slate-600">
      {sections.map((section) => {
        const agreed = itemStates[section.key] === 'agreed'
        const isNewSection = Boolean(previousKeys && !previousKeys.has(section.key))
        return (
          <section id={anchorPrefix ? `${anchorPrefix}-${section.key}` : undefined} key={section.key} className={`scroll-mt-5 rounded-2xl border px-3 py-2.5 transition ${agreed ? 'border-emerald-200 bg-emerald-50/50' : isNewSection ? 'border-blue-200 bg-blue-50' : 'border-amber-200 bg-amber-50/35'}`}>
            <div className="mb-1.5 flex items-center justify-end gap-2">
              {isNewSection && <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase text-blue-700">Добавлено</span>}
              {onItemStatesChange ? (
                <button type="button" disabled={busy} onClick={() => updateSection(section)} className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase transition disabled:cursor-wait disabled:opacity-50 ${agreed ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}>
                  {agreed ? 'Согласовано' : 'В обсуждении'}
                </button>
              ) : (
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${agreed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{agreed ? 'Согласовано' : 'В обсуждении'}</span>
              )}
            </div>
            <div className="space-y-1.5">
              {section.tokens.map((block) => {
                if (block.kind === 'heading-1') return <h2 key={block.index} className="pt-2 text-xl font-bold text-slate-900 first:pt-0">{block.value}</h2>
                if (block.kind === 'heading-2') return <h3 key={block.index} className="text-base font-bold text-slate-900">{block.value}</h3>
                if (block.kind === 'heading-3' || block.kind === 'heading-4') return <h4 key={block.index} className="pt-2 text-sm font-bold text-slate-800">{block.value}</h4>
                if (block.kind === 'code') return <pre key={block.index} className="overflow-x-auto whitespace-pre-wrap rounded-2xl bg-slate-950 px-4 py-3 font-mono text-xs leading-5 text-slate-200">{block.value}</pre>
                if (block.kind === 'bullet' && block.itemKey) {
                  const rowAgreed = itemStates[block.itemKey] === 'agreed'
                  const isNewRow = Boolean(previousKeys && !previousKeys.has(block.itemKey))
                  return <button key={block.index} type="button" disabled={!onItemStatesChange || busy} onClick={() => updateRow(section, block.itemKey!)} className={`flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left transition ${rowAgreed ? 'bg-emerald-100/80 text-emerald-900' : isNewRow ? 'bg-blue-50 text-blue-800 ring-1 ring-inset ring-blue-200' : 'bg-amber-100/70 text-amber-900'} ${onItemStatesChange ? 'cursor-pointer hover:brightness-[0.98]' : 'cursor-default'}`}><span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${rowAgreed ? 'border-emerald-500 bg-emerald-500 text-white' : isNewRow ? 'border-blue-400 bg-white text-transparent' : 'border-amber-400 bg-white text-transparent'}`}>✓</span><span className="flex-1">{block.value}</span>{isNewRow && <span className="mt-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold uppercase text-blue-700">Новое</span>}</button>
                }
                if (block.kind === 'numbered' && block.itemKey) {
                  const [number, value] = block.value.split('\t')
                  const rowAgreed = itemStates[block.itemKey] === 'agreed'
                  const isNewRow = Boolean(previousKeys && !previousKeys.has(block.itemKey))
                  return <button key={block.index} type="button" disabled={!onItemStatesChange || busy} onClick={() => updateRow(section, block.itemKey!)} className={`flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left transition ${rowAgreed ? 'bg-emerald-100/80 text-emerald-900' : isNewRow ? 'bg-blue-50 text-blue-800 ring-1 ring-inset ring-blue-200' : 'bg-amber-100/70 text-amber-900'} ${onItemStatesChange ? 'cursor-pointer hover:brightness-[0.98]' : 'cursor-default'}`}><span className={`flex min-w-6 items-center justify-center rounded px-1 text-xs font-bold ${rowAgreed ? 'bg-emerald-500 text-white' : isNewRow ? 'bg-blue-100 text-blue-800' : 'bg-amber-200 text-amber-800'}`}>{number}.</span><span className="flex-1">{value}</span>{isNewRow && <span className="mt-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold uppercase text-blue-700">Новое</span>}</button>
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

export function DiscussionsTab() {
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

  const active = discussions.filter((item) => item.status === 'active')
  const completed = discussions.filter((item) => item.status === 'completed')
  const visible = view === 'active' ? active : completed

  const startEditing = (discussion: Discussion) => {
    setEditing(discussion)
    setEditTitle(discussion.title)
    setEditContent(discussion.content)
    setError('')
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
    const { error: saveError } = await (supabase as any)
      .from('tz_discussions')
      .update({
        title: editTitle.trim(),
        content: editContent.trim(),
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

  const saveItemStates = async (discussion: Discussion, itemStates: DiscussionItemStates) => {
    if (!supabase || itemStatesSavingId) return
    const previous = discussion.item_states || {}
    setItemStatesSavingId(discussion.id)
    setError('')
    setDiscussions((current) => current.map((item) => item.id === discussion.id ? { ...item, item_states: itemStates } : item))
    const { error: saveError } = await (supabase as any)
      .from('tz_discussions')
      .update({ item_states: itemStates, updated_at: new Date().toISOString() })
      .eq('id', discussion.id)
      .eq('status', 'active')
    if (saveError) {
      setDiscussions((current) => current.map((item) => item.id === discussion.id ? { ...item, item_states: previous } : item))
      setError(saveError.message || 'Не удалось сохранить состояние пунктов')
    } else await load()
    setItemStatesSavingId(null)
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-fit items-center rounded-xl bg-slate-100 p-1">
          <button type="button" onClick={() => setView('active')} className={`h-8 rounded-lg px-4 text-sm font-medium transition ${view === 'active' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            Актуальный{active.length > 0 ? ` (${active.length})` : ''}
          </button>
          <button type="button" onClick={() => setView('completed')} className={`h-8 rounded-lg px-4 text-sm font-medium transition ${view === 'completed' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            Завершённые{completed.length > 0 ? ` (${completed.length})` : ''}
          </button>
        </div>
        <p className="text-xs text-slate-400">«Снять ответ» фиксирует финальную версию и переносит её в архив.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Загрузка...</div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {view === 'active' ? 'Актуального ответа пока нет.' : 'Завершённых обсуждений пока нет.'}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((discussion) => {
            const expanded = view === 'active' || expandedIds.has(discussion.id)
            return (
              <article key={discussion.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
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
                    <button type="button" onClick={() => void openHistory(discussion)} className="h-8 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700">
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
                        <button type="button" onClick={() => startEditing(discussion)} className="h-8 rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700">Редактировать</button>
                        <button type="button" disabled={saving} onClick={() => void completeDiscussion(discussion)} className="h-8 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50">Снять ответ</button>
                      </>
                    )}
                  </div>
                </header>
                {expanded && <div className="px-5 py-5 sm:px-7"><DiscussionContent content={discussion.content} previousContent={discussion.status === 'active' ? previousContentByDiscussion[discussion.id] : null} itemStates={discussion.item_states} onItemStatesChange={discussion.status === 'active' ? (states) => void saveItemStates(discussion, states) : undefined} busy={itemStatesSavingId === discussion.id} /></div>}
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
        const anchorPrefix = `history-${selected.id}`
        const scrollToPoint = (key: string) => {
          document.getElementById(`${anchorPrefix}-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
                        <button key={revision.id} type="button" onClick={() => setSelectedRevision(revision.revision_no)} className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${selected.revision_no === revision.revision_no ? 'border-violet-200 bg-white shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-white'}`}>
                          <div className="flex items-center justify-between gap-2"><span className={`text-sm font-semibold ${selected.revision_no === revision.revision_no ? 'text-violet-700' : 'text-slate-700'}`}>Редакция {revision.revision_no}</span>{revision.is_current && <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-600">Текущая</span>}</div>
                          <p className="mt-1 text-[11px] text-slate-400">{formatDate(revision.saved_at)}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">{revision.status === 'active' ? 'Была актуальной' : 'Была завершённой'}</p>
                        </button>
                      ))}
                    </div>
                  </aside>
                  <nav className="min-h-0 overflow-y-auto border-r border-slate-100 bg-white px-2 py-3" aria-label="Навигация по пунктам редакции">
                    <div className="flex flex-col items-center gap-1.5">
                      {navigationItems.map((item, index) => (
                        <button key={item.key} type="button" onClick={() => scrollToPoint(item.key)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-xs font-bold text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                          {item.label.match(/^(\d+)/)?.[1] ?? index + 1}
                        </button>
                      ))}
                    </div>
                  </nav>
                  <main className="min-h-0 scroll-smooth overflow-y-auto px-5 py-5 sm:px-7">
                    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
                      <h3 className="text-base font-bold text-slate-900">{selected.title}</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Редакция {selected.revision_no}</span>
                    </div>
                    <DiscussionContent content={selected.content} itemStates={selected.item_states} anchorPrefix={anchorPrefix} />
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
