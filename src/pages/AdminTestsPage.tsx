import { useState } from 'react'
import { playScannerSound } from '../lib/scannerSound'
import type { SuccessSoundVariant } from '../lib/scannerSound'

const previews = [
  { id: 'beep', label: 'Пик', description: 'Короткий чёткий сканерный сигнал без звона.' },
  { id: 'ding', label: 'Динь', description: 'Один звонкий удар с коротким затуханием.' },
  { id: 'knock', label: 'Тук', description: 'Короткий сухой стук без звона.' },
  { id: 'plop', label: 'Плюк', description: 'Мягкий электронный звук с понижением тона.' },
] satisfies Array<{ id: SuccessSoundVariant; label: string; description: string }>

export function AdminTestsPage() {
  const [error, setError] = useState('')
  async function testSound(success: boolean, variant: SuccessSoundVariant = 'current') {
    setError('')
    if (!await playScannerSound(success, variant)) {
      setError('Браузер не смог включить звук. Проверьте разрешение на звук и повторите проверку.')
    }
  }

  return (
    <section className="min-h-full w-full min-w-0">
      <div role="tablist" aria-label="Разделы тестов" className="border-b border-slate-200">
        <button type="button" role="tab" id="scan-sounds-tab" aria-selected="true" aria-controls="scan-sounds-panel"
          className="border-b-2 border-violet-500 px-4 pb-3 font-medium text-violet-600">
          Звуки скана
        </button>
      </div>
      <div role="tabpanel" id="scan-sounds-panel" aria-labelledby="scan-sounds-tab" className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-lg font-semibold text-slate-900">Проверка звуков сканера</h2>
        <p className="mt-2 text-sm text-slate-500">Те же сигналы, что при рабочем сканировании. Проверка не создаёт сканы и не отправляет данные в WB.</p>
        <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">Сигналы громкие. Перед первой проверкой уменьшите громкость колонок или наушников.</p>
        <div className="mt-6 flex flex-wrap gap-4">
          <button type="button" onClick={() => void testSound(true)} className="rounded-2xl bg-emerald-600 px-8 py-4 font-semibold text-white hover:bg-emerald-700">Удачный</button>
          <button type="button" onClick={() => void testSound(false)} className="rounded-2xl bg-rose-600 px-8 py-4 font-semibold text-white hover:bg-rose-700">Ошибка</button>
        </div>
        <div className="mt-6 border-t border-slate-200 pt-5">
          <h3 className="font-semibold text-slate-900">Варианты успеха</h3>
          <p className="mt-2 text-sm text-slate-500">Только для сравнения — рабочий сигнал успеха пока прежний.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {previews.map(preview => (
              <div key={preview.id} className="flex flex-col items-start rounded-2xl bg-slate-50 p-4">
                <p className="mb-4 flex-1 text-sm text-slate-600">{preview.description}</p>
                <button type="button" onClick={() => void testSound(true, preview.id)} className="rounded-2xl bg-blue-600 px-8 py-4 font-semibold text-white hover:bg-blue-700">{preview.label}</button>
              </div>
            ))}
          </div>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-rose-600">{error}</p>}
      </div>
    </section>
  )
}
