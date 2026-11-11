interface ChromeTab<T extends string> {
  id: T
  label: string
}

interface ChromeTabsProps<T extends string> {
  tabs: ChromeTab<T>[]
  value: T
  onChange: (id: T) => void
}

export function ChromeTabs<T extends string>({ tabs, value, onChange }: ChromeTabsProps<T>) {
  return (
    <div className="flex items-end">
      {tabs.map((item) => {
        const active = value === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={
              active
                ? 'chrome-tab whitespace-nowrap text-sm font-medium text-slate-900'
                : 'mx-3 whitespace-nowrap px-3.5 py-2 text-sm font-medium text-slate-600 hover:text-slate-900'
            }
          >
            {active ? <span className="chrome-tab-face">{item.label}</span> : item.label}
          </button>
        )
      })}
    </div>
  )
}
