import { Button } from '../ui/Button'

interface HeaderProps {
  activePage: 'shipments' | 'stores'
}

const pageNames = {
  shipments: 'Поставки',
  stores: 'Магазины',
}

export const Header = ({ activePage }: HeaderProps) => (
  <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-5">
    <div className="flex items-center gap-3">
      <div className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-600">ELESTET</div>
      <div className="hidden h-4 w-px bg-slate-200 sm:block" />
      <div className="text-sm text-slate-500">{pageNames[activePage]}</div>
    </div>
    <div className="flex items-center gap-2">
      <div className="hidden rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 md:block">
        Аккаунт: <span className="font-medium text-slate-900">ELESTET Logistics</span>
      </div>
      <Button variant="secondary" className="px-3 py-1.5 text-xs">
        Auth позже
      </Button>
    </div>
  </header>
)
