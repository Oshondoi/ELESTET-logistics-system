import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '../ui/Card'
import {
  adminArchiveScannerModel,
  adminFetchScannerModels,
  adminSaveScannerModel,
} from '../../services/scannerModelService'
import type {
  ScannerConnectionType,
  ScannerModelInput,
  ScannerModelProfile,
  ScannerModelStatus,
  ScannerSetupCode,
} from '../../services/scannerModelService'

const STATUS_LABELS: Record<ScannerModelStatus, string> = {
  draft: 'Черновик',
  active: 'Опубликован',
  archived: 'В архиве',
}

const STATUS_COLORS: Record<ScannerModelStatus, string> = {
  draft: 'bg-amber-100 text-amber-700',
  active: 'bg-emerald-100 text-emerald-700',
  archived: 'bg-slate-100 text-slate-500',
}

type ScannerForm = ScannerModelInput & {
  setupCodesText: string
  restoreCodesText: string
}

function emptyForm(): ScannerForm {
  return {
    id: '',
    brand: '',
    model: '',
    connectionType: 'keyboard',
    status: 'draft',
    serialOptions: {
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    },
    scanOptions: { maxPacketLength: 4096, packetTerminator: 'cr_lf' },
    setupBarcodes: [],
    restoreBarcodes: [],
    instructions: '',
    warningText: '',
    sortOrder: 100,
    setupCodesText: '',
    restoreCodesText: '',
  }
}

function codesToText(codes: ScannerSetupCode[]) {
  return codes.map((code) => `${code.format} | ${code.label} | ${code.value}`).join('\n')
}

function textToCodes(value: string): ScannerSetupCode[] {
  return value.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return []
    const parts = trimmed.split('|').map((part) => part.trim())
    const hasFormat = parts[0]?.toUpperCase() === 'QR' || parts[0]?.toUpperCase() === 'CODE128'
    const format = hasFormat && parts[0]?.toUpperCase() === 'QR' ? 'QR' as const : 'CODE128' as const
    const label = hasFormat ? parts[1] : parts.length > 1 ? parts[0] : `Шаг ${index + 1}`
    const codeValue = hasFormat ? parts.slice(2).join('|').trim() : parts.length > 1 ? parts.slice(1).join('|').trim() : trimmed
    if (!codeValue) return []
    return [{ label: label || `Шаг ${index + 1}`, value: codeValue, format }]
  })
}

function formFromModel(model: ScannerModelProfile): ScannerForm {
  return {
    id: model.id,
    brand: model.brand,
    model: model.model,
    connectionType: model.connectionType,
    status: model.status,
    serialOptions: { ...model.serialOptions },
    scanOptions: { ...model.scanOptions },
    setupBarcodes: [...model.setupBarcodes],
    restoreBarcodes: [...model.restoreBarcodes],
    instructions: model.instructions,
    warningText: model.warningText,
    sortOrder: model.sortOrder,
    setupCodesText: codesToText(model.setupBarcodes),
    restoreCodesText: codesToText(model.restoreBarcodes),
  }
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function connectionLabel(value: ScannerConnectionType) {
  return value === 'web_serial' ? 'COM через браузер' : 'Обычный USB (клавиатура)'
}

export function ScannerModelsAdminTab() {
  const [models, setModels] = useState<ScannerModelProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<ScannerForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [archivingId, setArchivingId] = useState('')

  const loadModels = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setModels(await adminFetchScannerModels())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить каталог сканеров')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadModels() }, [loadModels])

  const filteredModels = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru-RU')
    if (!query) return models
    return models.filter((model) => `${model.brand} ${model.model} ${STATUS_LABELS[model.status]}`.toLocaleLowerCase('ru-RU').includes(query))
  }, [models, search])

  const save = async (status: 'draft' | 'active') => {
    if (!form || saving) return
    const brand = form.brand.trim()
    const modelName = form.model.trim()
    if (!brand || !modelName) {
      setFormError('Укажите бренд и модель сканера')
      return
    }

    const setupBarcodes = textToCodes(form.setupCodesText)
    const restoreBarcodes = textToCodes(form.restoreCodesText)
    if (status === 'active' && !window.confirm(`Опубликовать «${brand} ${modelName}» для выбора пользователями?`)) return

    setSaving(true)
    setFormError('')
    try {
      await adminSaveScannerModel({
        id: form.id,
        brand,
        model: modelName,
        connectionType: form.connectionType,
        status,
        serialOptions: form.serialOptions,
        scanOptions: {
          ...form.scanOptions,
          maxPacketLength: Math.max(256, Math.trunc(Number(form.scanOptions.maxPacketLength) || 4096)),
        },
        setupBarcodes,
        restoreBarcodes,
        instructions: form.instructions.trim(),
        warningText: form.warningText.trim(),
        sortOrder: Math.trunc(Number(form.sortOrder) || 100),
      })
      setForm(null)
      await loadModels()
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить модель')
    } finally {
      setSaving(false)
    }
  }

  const archive = async (model: ScannerModelProfile) => {
    if (archivingId || !window.confirm(
      model.usageCount > 0
        ? `Убрать «${model.displayName}» из выбора? У ${model.usageCount} сессий сохранена эта модель; их история останется.`
        : `Убрать «${model.displayName}» из выбора пользователей?`,
    )) return
    setArchivingId(model.id)
    setError('')
    try {
      await adminArchiveScannerModel(model.id)
      await loadModels()
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Не удалось архивировать модель')
    } finally {
      setArchivingId('')
    }
  }

  const identityLocked = Boolean(form?.id && form.status !== 'draft')

  return (
    <>
      <Card className="overflow-hidden rounded-3xl">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по бренду или модели..."
              className="h-10 w-full rounded-xl border border-transparent bg-slate-100 pl-9 pr-4 text-sm outline-none focus:border-violet-200 focus:bg-white focus:ring-2 focus:ring-violet-100"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void loadModels()} disabled={loading} className="h-10 rounded-xl border border-slate-200 px-4 text-sm text-slate-600 disabled:opacity-40">Обновить</button>
            <button type="button" onClick={() => { setForm(emptyForm()); setFormError('') }} className="h-10 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700">+ Добавить сканер</button>
          </div>
        </div>

        {error && <div className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-600">{error}</div>}
        {loading && models.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">Загрузка каталога…</div>
        ) : filteredModels.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">Сканеры не найдены</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/70 text-[10px] uppercase tracking-[0.1em] text-slate-400">
                <tr>
                  <th className="px-5 py-3">Сканер</th>
                  <th className="px-4 py-3">Подключение</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3">Профиль</th>
                  <th className="px-4 py-3">Использований</th>
                  <th className="px-4 py-3">Обновлён</th>
                  <th className="sticky right-0 border-l border-slate-100 bg-slate-50 px-4 py-3 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredModels.map((model) => (
                  <tr key={model.id} className="bg-white hover:bg-slate-50/60">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-slate-800">{model.displayName}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{model.brand} · {model.model}</div>
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-600">{connectionLabel(model.connectionType)}</td>
                    <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[model.status]}`}>{STATUS_LABELS[model.status]}</span></td>
                    <td className="px-4 py-4 text-xs text-slate-600">v{model.profileVersion}<div className="mt-0.5 text-slate-400">Кодов: {model.setupBarcodes.length}</div></td>
                    <td className="px-4 py-4 text-xs font-semibold text-slate-600">{model.usageCount}</td>
                    <td className="px-4 py-4 text-xs text-slate-500">{formatDateTime(model.updatedAt)}</td>
                    <td className="sticky right-0 border-l border-slate-100 bg-white px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => { setForm(formFromModel(model)); setFormError('') }} className="h-9 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-violet-200 hover:text-violet-700">Редактировать</button>
                        {model.status !== 'archived' && (
                          <button type="button" disabled={archivingId === model.id} onClick={() => void archive(model)} className="h-9 rounded-xl border border-rose-200 px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40">В архив</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {form && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onClick={() => { if (!saving) setForm(null) }} role="dialog" aria-modal="true" aria-label="Профиль сканера">
          <form className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-3xl" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void save(form.status === 'active' ? 'active' : 'draft') }}>
            <header className="flex items-start justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{form.id ? form.status === 'archived' ? 'Архивный сканер' : 'Редактирование сканера' : 'Новый сканер'}</h3>
                <p className="mt-1 text-xs text-slate-500">Настройки из опубликованного профиля сразу появятся в модалке КИЗ.</p>
              </div>
              <button type="button" disabled={saving} onClick={() => setForm(null)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 disabled:opacity-40">×</button>
            </header>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              <section>
                <h4 className="mb-3 text-sm font-bold text-slate-800">Название</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-500">Бренд
                    <input value={form.brand} disabled={identityLocked} onChange={(event) => setForm({ ...form, brand: event.target.value.slice(0, 80) })} placeholder="Например, Winson" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-violet-400 disabled:bg-slate-100" />
                  </label>
                  <label className="text-xs text-slate-500">Модель
                    <input value={form.model} disabled={identityLocked} onChange={(event) => setForm({ ...form, model: event.target.value.slice(0, 120) })} placeholder="Например, WNI-S744/Y" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800 outline-none focus:border-violet-400 disabled:bg-slate-100" />
                  </label>
                </div>
                {identityLocked && <p className="mt-2 text-[11px] text-slate-400">Название опубликованной модели зафиксировано, чтобы не сломать уже выбранные устройства.</p>}
              </section>

              <section className="border-t border-slate-100 pt-5">
                <h4 className="mb-3 text-sm font-bold text-slate-800">Подключение</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-500">Режим
                    <select value={form.connectionType} onChange={(event) => setForm({ ...form, connectionType: event.target.value as ScannerConnectionType })} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-violet-400">
                      <option value="keyboard">Обычный USB (как клавиатура)</option>
                      <option value="web_serial">COM через Chrome/Edge</option>
                    </select>
                  </label>
                  <label className="text-xs text-slate-500">Порядок в списке
                    <input type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-400" />
                  </label>
                </div>

                {form.connectionType === 'web_serial' && (
                  <div className="mt-3 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-4">
                    <label className="text-[11px] text-slate-500">Скорость
                      <input type="number" min="1" value={form.serialOptions.baudRate} onChange={(event) => setForm({ ...form, serialOptions: { ...form.serialOptions, baudRate: Number(event.target.value) } })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs" />
                    </label>
                    <label className="text-[11px] text-slate-500">Биты
                      <select value={form.serialOptions.dataBits} onChange={(event) => setForm({ ...form, serialOptions: { ...form.serialOptions, dataBits: Number(event.target.value) as 7 | 8 } })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="8">8</option><option value="7">7</option></select>
                    </label>
                    <label className="text-[11px] text-slate-500">Стоп-биты
                      <select value={form.serialOptions.stopBits} onChange={(event) => setForm({ ...form, serialOptions: { ...form.serialOptions, stopBits: Number(event.target.value) as 1 | 2 } })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="1">1</option><option value="2">2</option></select>
                    </label>
                    <label className="text-[11px] text-slate-500">Чётность
                      <select value={form.serialOptions.parity} onChange={(event) => setForm({ ...form, serialOptions: { ...form.serialOptions, parity: event.target.value as 'none' | 'even' | 'odd' } })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="none">Нет</option><option value="even">Чётная</option><option value="odd">Нечётная</option></select>
                    </label>
                    <label className="text-[11px] text-slate-500">Управление потоком
                      <select value={form.serialOptions.flowControl} onChange={(event) => setForm({ ...form, serialOptions: { ...form.serialOptions, flowControl: event.target.value as 'none' | 'hardware' } })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="none">Нет</option><option value="hardware">Аппаратное</option></select>
                    </label>
                    <label className="text-[11px] text-slate-500">Конец скана
                      <select value={typeof form.scanOptions.packetTerminator === 'string' ? form.scanOptions.packetTerminator : 'cr_lf'} onChange={(event) => setForm({ ...form, scanOptions: { ...form.scanOptions, packetTerminator: event.target.value } })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"><option value="cr_lf">CR или LF</option><option value="cr">CR</option><option value="lf">LF</option><option value="tab">Tab</option><option value="etx">ETX</option></select>
                    </label>
                    <label className="text-[11px] text-slate-500">Пакет, байт
                      <input type="number" min="256" value={Number(form.scanOptions.maxPacketLength) || 4096} onChange={(event) => setForm({ ...form, scanOptions: { ...form.scanOptions, maxPacketLength: Number(event.target.value) } })} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-xs" />
                    </label>
                  </div>
                )}
              </section>

              <section className="border-t border-slate-100 pt-5">
                <h4 className="mb-1 text-sm font-bold text-slate-800">Настроечные штрихкоды</h4>
                <p className="mb-3 text-[11px] text-slate-400">Один шаг на строку: CODE128 | Название | значение или QR | Название | значение. ELESTET сам построит изображение.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-500">Включение нужного режима
                    <textarea value={form.setupCodesText} onChange={(event) => setForm({ ...form, setupCodesText: event.target.value })} rows={5} placeholder={'CODE128 | 1. Войти в настройки | @SET\nQR | 2. Включить режим | КОД'} className="mt-1 w-full resize-y rounded-xl border border-slate-200 p-3 font-mono text-xs outline-none focus:border-violet-400" />
                  </label>
                  <label className="text-xs text-slate-500">Возврат обычного режима
                    <textarea value={form.restoreCodesText} onChange={(event) => setForm({ ...form, restoreCodesText: event.target.value })} rows={5} placeholder={'CODE128 | 1. Войти в настройки | @SET\nCODE128 | 2. Вернуть USB | КОД'} className="mt-1 w-full resize-y rounded-xl border border-slate-200 p-3 font-mono text-xs outline-none focus:border-violet-400" />
                  </label>
                </div>
              </section>

              <section className="border-t border-slate-100 pt-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-500">Инструкция пользователю
                    <textarea value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value.slice(0, 4000) })} rows={4} className="mt-1 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-violet-400" />
                  </label>
                  <label className="text-xs text-slate-500">Предупреждение
                    <textarea value={form.warningText} onChange={(event) => setForm({ ...form, warningText: event.target.value.slice(0, 2000) })} rows={4} className="mt-1 w-full resize-y rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-violet-400" />
                  </label>
                </div>
              </section>

              {formError && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{formError}</div>}
            </div>

            <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4 sm:px-6">
              <button type="button" disabled={saving} onClick={() => setForm(null)} className="h-11 rounded-xl border border-slate-200 px-4 text-sm text-slate-600 disabled:opacity-40">Отмена</button>
              {(!form.id || form.status === 'draft') && (
                <button type="button" disabled={saving} onClick={() => void save('draft')} className="h-11 rounded-xl border border-violet-200 px-4 text-sm font-semibold text-violet-700 disabled:opacity-40">Сохранить черновик</button>
              )}
              <button type="button" disabled={saving} onClick={() => void save('active')} className="h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40">
                {saving ? 'Сохраняем…' : form.status === 'active' ? 'Сохранить изменения' : form.status === 'archived' ? 'Опубликовать снова' : 'Опубликовать'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  )
}
