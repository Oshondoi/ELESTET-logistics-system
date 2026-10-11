import { useId, useState } from 'react'
import type { InputHTMLAttributes } from 'react'

export function PasswordInput({ label, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string }) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  return <div className="flex min-w-0 flex-col gap-2 text-sm text-slate-700">
    <label htmlFor={id} className="font-medium">{label}</label>
    <div className="relative">
      <input {...props} id={id} type={visible ? 'text' : 'password'} className="block w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 disabled:bg-slate-50" />
      <button type="button" disabled={props.disabled} aria-label={`${visible ? 'Скрыть' : 'Показать'} пароль: ${label}`} aria-pressed={visible}
        onClick={() => setVisible(current => !current)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
        {visible ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" />
        </svg> : <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
        </svg>}
      </button>
    </div>
  </div>
}
