interface FbsWarehouseOption {
  value: string | number
  label: string
}

interface FbsWarehouseSelectProps {
  value: string | number
  options: FbsWarehouseOption[]
  onChange: (value: string) => void
  ariaLabel?: string
  title?: string
}

export const FbsWarehouseSelect = ({
  value,
  options,
  onChange,
  ariaLabel,
  title,
}: FbsWarehouseSelectProps) => (
  <label className="space-y-1.5 text-xs font-semibold text-slate-600">
    <span className="block">На склад WB</span>
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      title={title}
      className="h-9 min-w-[280px] max-w-[380px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-violet-400"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
)
