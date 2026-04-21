import { Card } from '../components/ui/Card'

export const ImportPage = () => {
  return (
    <Card className="overflow-hidden rounded-3xl">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
        <span className="text-sm font-semibold text-slate-900">Импорт</span>
        <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-500">WB API</span>
      </div>
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-violet-400" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M12 3v13" />
            <path d="m8 12 4 4 4-4" />
            <path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">Импорт из Wildberries</p>
          <p className="mt-1 text-xs text-slate-400">Подключите WB API для загрузки стикеров и данных о товарах</p>
        </div>
        <button
          type="button"
          disabled
          className="mt-2 cursor-not-allowed rounded-xl bg-violet-100 px-4 py-2 text-xs font-medium text-violet-400"
        >
          В разработке
        </button>
      </div>
    </Card>
  )
}
