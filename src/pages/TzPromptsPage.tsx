import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TzPrompt {
  id: string
  title: string
  content: string
  is_done: boolean
  position: number
  created_at: string
}

interface TzTask {
  id: string
  text: string
  is_done: boolean
  position: number
  created_at: string
}

function TasksTab() {
  const [tasks, setTasks] = useState<TzTask[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadTasks = useCallback(async () => {
    if (!supabase) {
      setError('Нет подключения к базе данных')
      setLoading(false)
      return
    }

    setError('')
    const { data, error: loadError } = await (supabase as any)
      .from('tz_tasks')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })

    if (loadError) setError(loadError.message || 'Не удалось загрузить задачи')
    else setTasks((data || []) as TzTask[])
    setLoading(false)
  }, [])

  useEffect(() => { void loadTasks() }, [loadTasks])

  const addTask = async () => {
    const cleanText = text.trim()
    if (!supabase || !cleanText || saving) return

    setSaving(true)
    setError('')
    const maxPosition = tasks.length > 0
      ? Math.max(...tasks.map((task) => task.position)) + 1
      : 0
    const { data, error: saveError } = await (supabase as any)
      .from('tz_tasks')
      .insert({ text: cleanText, position: maxPosition })
      .select('*')
      .single()

    if (saveError) setError(saveError.message || 'Не удалось сохранить задачу')
    else {
      setTasks((prev) => [...prev, data as TzTask])
      setText('')
    }
    setSaving(false)
  }

  const toggleTask = async (task: TzTask) => {
    if (!supabase) return
    const nextDone = !task.is_done
    setTasks((prev) => prev.map((item) => (
      item.id === task.id ? { ...item, is_done: nextDone } : item
    )))

    const { error: toggleError } = await (supabase as any)
      .from('tz_tasks')
      .update({
        is_done: nextDone,
        completed_at: nextDone ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.id)

    if (toggleError) {
      setTasks((prev) => prev.map((item) => (
        item.id === task.id ? { ...item, is_done: task.is_done } : item
      )))
      setError(toggleError.message || 'Не удалось изменить задачу')
    }
  }

  const deleteTask = async (task: TzTask) => {
    if (!supabase || !window.confirm('Удалить эту задачу?')) return
    const { error: deleteError } = await (supabase as any)
      .from('tz_tasks')
      .delete()
      .eq('id', task.id)

    if (deleteError) setError(deleteError.message || 'Не удалось удалить задачу')
    else setTasks((prev) => prev.filter((item) => item.id !== task.id))
  }

  const activeCount = tasks.filter((task) => !task.is_done).length
  const doneCount = tasks.length - activeCount

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
        <div className="flex items-end gap-3">
          <textarea
            id="new-tz-task"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void addTask()
              }
            }}
            rows={1}
            placeholder="Напишите задачу..."
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
          <button
            type="button"
            title="Сортировка задач — скоро"
            aria-label="Сортировка задач — скоро"
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-600"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6h12M4 6h.01M12 12h8M4 12h4M16 18h4M4 18h8" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => void addTask()}
            disabled={!text.trim() || saving}
            className="h-10 rounded-xl bg-violet-500 px-5 text-sm font-semibold text-white transition hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Добавить'}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-slate-500">
        <span>{activeCount} активных</span>
        <span>{doneCount} выполненных</span>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-slate-400">Загрузка...</div>
      ) : tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          Задач пока нет. Добавьте первую задачу выше.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`group flex items-start gap-2.5 rounded-xl border px-3 py-1.5 transition ${
                task.is_done
                  ? 'border-slate-200 bg-slate-50'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
              }`}
            >
              <button
                type="button"
                onClick={() => void toggleTask(task)}
                title={task.is_done ? 'Вернуть в работу' : 'Отметить выполненной'}
                className={`mt-0.5 flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border transition ${
                  task.is_done
                    ? 'border-violet-500 bg-violet-500 text-white'
                    : 'border-slate-300 bg-white hover:border-violet-400'
                }`}
              >
                {task.is_done && (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>

              <p className={`min-w-0 flex-1 whitespace-pre-wrap text-sm leading-5 ${
                task.is_done ? 'text-slate-400 line-through' : 'text-slate-800'
              }`}>
                {task.text}
              </p>

              <button
                type="button"
                onClick={() => void deleteTask(task)}
                title="Удалить задачу"
                className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 focus:opacity-100"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6M9 6V4h6v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── PromptCard ───────────────────────────────────────────────────────────────

function PromptCard({
  prompt,
  onEdit,
  onDelete,
  onToggleDone,
}: {
  prompt: TzPrompt
  onEdit: (p: TzPrompt) => void
  onDelete: (id: string) => void
  onToggleDone: (p: TzPrompt) => void
}) {
  return (
    <div
      className={`rounded-2xl border p-4 transition ${
        prompt.is_done
          ? 'border-emerald-100 bg-emerald-50/40 opacity-60'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Done toggle */}
        <button
          type="button"
          onClick={() => onToggleDone(prompt)}
          title={prompt.is_done ? 'Пометить активным' : 'Пометить выполненным'}
          className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition ${
            prompt.is_done
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-slate-300 hover:border-emerald-400'
          }`}
        >
          {prompt.is_done && (
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div
            className={`text-sm font-semibold ${
              prompt.is_done ? 'text-slate-400 line-through' : 'text-slate-800'
            }`}
          >
            {prompt.title}
          </div>
          {prompt.content && (
            <div
              className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${
                prompt.is_done ? 'text-slate-400' : 'text-slate-600'
              }`}
            >
              {prompt.content}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(prompt)}
            title="Редактировать"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => void onDelete(prompt.id)}
            title="Удалить"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-500"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TzPromptsPage ────────────────────────────────────────────────────────────

export function TzPromptsPage() {
  const [activeTab, setActiveTab] = useState<'prompts' | 'tasks'>(() => {
    const savedTab = localStorage.getItem('elestet-tz-prompts-active-tab')
    return savedTab === 'tasks' || savedTab === 'prompts' ? savedTab : 'tasks'
  })
  const [prompts, setPrompts] = useState<TzPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [showDone, setShowDone] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<TzPrompt | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data } = await (supabase as any)
      .from('tz_prompts')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
    if (data) setPrompts(data as TzPrompt[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    localStorage.setItem('elestet-tz-prompts-active-tab', activeTab)
  }, [activeTab])

  const openAdd = () => {
    setEditing(null)
    setFormTitle('')
    setFormContent('')
    setModalOpen(true)
  }

  const openEdit = (p: TzPrompt) => {
    setEditing(p)
    setFormTitle(p.title)
    setFormContent(p.content)
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!supabase || !formTitle.trim()) return
    setSaving(true)
    if (editing) {
      await (supabase as any).from('tz_prompts').update({
        title: formTitle.trim(),
        content: formContent.trim(),
        updated_at: new Date().toISOString(),
      }).eq('id', editing.id)
    } else {
      const maxPos = prompts.length > 0 ? Math.max(...prompts.map((p) => p.position)) + 1 : 0
      await (supabase as any).from('tz_prompts').insert({
        title: formTitle.trim(),
        content: formContent.trim(),
        position: maxPos,
      })
    }
    setSaving(false)
    setModalOpen(false)
    void load()
  }

  const handleToggleDone = async (p: TzPrompt) => {
    if (!supabase) return
    await (supabase as any)
      .from('tz_prompts')
      .update({ is_done: !p.is_done, updated_at: new Date().toISOString() })
      .eq('id', p.id)
    setPrompts((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_done: !x.is_done } : x)))
  }

  const handleDelete = async (id: string) => {
    if (!supabase) return
    if (!window.confirm('Удалить промпт?')) return
    await (supabase as any).from('tz_prompts').delete().eq('id', id)
    setPrompts((prev) => prev.filter((x) => x.id !== id))
  }

  const active = prompts.filter((p) => !p.is_done)
  const done = prompts.filter((p) => p.is_done)

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Загрузка...
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex w-fit items-center rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setActiveTab('tasks')}
          className={`h-8 cursor-pointer rounded-lg px-4 text-sm font-medium transition ${
            activeTab === 'tasks'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Задачи
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('prompts')}
          className={`h-8 cursor-pointer rounded-lg px-4 text-sm font-medium transition ${
            activeTab === 'prompts'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Промпты ТЗ
        </button>
      </div>

      {activeTab === 'tasks' ? <TasksTab /> : (
      <>
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">
            {active.length} {active.length === 1 ? 'активный' : active.length < 5 ? 'активных' : 'активных'}
          </span>
          {done.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className={`flex h-7 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition ${
                showDone
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {showDone ? (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              )}
              {showDone ? 'Скрыть выполненные' : `Выполненные (${done.length})`}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={openAdd}
          className="flex h-8 items-center gap-1.5 rounded-xl bg-violet-500 px-3 text-xs font-semibold text-white transition hover:bg-violet-600"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Добавить промпт
        </button>
      </div>

      {/* ── Active list ── */}
      {active.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
          Нет активных промптов. Нажмите «Добавить промпт».
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {active.map((p) => (
            <PromptCard
              key={p.id}
              prompt={p}
              onEdit={openEdit}
              onDelete={handleDelete}
              onToggleDone={handleToggleDone}
            />
          ))}
        </div>
      )}

      {/* ── Done list ── */}
      {showDone && done.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium text-slate-400">
              Выполненные ({done.length})
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="flex flex-col gap-3">
            {done.map((p) => (
              <PromptCard
                key={p.id}
                prompt={p}
                onEdit={openEdit}
                onDelete={handleDelete}
                onToggleDone={handleToggleDone}
              />
            ))}
          </div>
        </>
      )}

      {/* ── Add / Edit Modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="flex w-full max-w-xl flex-col rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-800">
                {editing ? 'Редактировать промпт' : 'Новый промпт'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-4 p-6">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Заголовок *</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Название промпта или задачи..."
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) void handleSave() }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-600">Текст промпта</label>
                <textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="Детали, инструкции, шаги, что не забыть..."
                  rows={9}
                  className="resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!formTitle.trim() || saving}
                className="rounded-xl bg-violet-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-600 disabled:opacity-50"
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  )
}
