interface TopbarProps {
  title: 'Главная' | 'Фулфилмент' | 'Логистика' | 'Магазины' | 'Товары' | 'Роли'
}

export const Topbar = ({ title }: TopbarProps) => (
  <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-4">
    <div className="flex items-center gap-3">
      <div className="text-xl font-semibold tracking-tight text-slate-900">{title}</div>
    </div>

    <div className="flex items-center gap-2">
      <button
        type="button"
        className="flex h-7 items-center rounded-xl border border-slate-200 px-3 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
      >
        0 сом
      </button>
      <button
        type="button"
        aria-label="Уведомления"
        className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
      >
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 5a4 4 0 0 0-4 4v2.5c0 .8-.3 1.6-.9 2.2L6 15h12l-1.1-1.3a3 3 0 0 1-.9-2.2V9a4 4 0 0 0-4-4Z" />
          <path d="M10 18a2 2 0 0 0 4 0" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Профиль"
        className="flex items-center gap-2 rounded-2xl bg-white px-1 py-1 hover:bg-slate-50"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700">
          C
        </span>
        <span className="text-left">
          <span className="block text-sm font-medium leading-none text-slate-900">Профиль</span>
          <span className="block text-xs text-slate-500">Аккаунт</span>
        </span>
      </button>
    </div>
  </div>
)
