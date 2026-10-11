import { useId, useRef, useState } from 'react'

// One native input preserves paste, autofill, selection, Backspace and form Enter.
// The six visual cells are decorative, not six separate tab stops.
export function EmailCodeInput({ value, onChange, label = 'Код из письма', disabled = false, className = '' }: {
  value: string
  onChange: (value: string) => void
  label?: string
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [position, setPosition] = useState(0)
  const normalize = (text: string) => text.replace(/\D/g, '').slice(0, 6)
  return <div className={className}>
    <label htmlFor={id} className="mb-2 block text-sm text-slate-800">{label}</label>
    <div className={`relative w-full ${disabled ? 'opacity-60' : ''}`}>
      <div aria-hidden="true" className="grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }, (_, index) => <div key={index}
          data-code-cell
          className={`flex aspect-square min-w-0 items-center justify-center rounded-xl border-2 bg-white text-[clamp(24px,6vw,36px)] font-extrabold leading-none text-black tabular-nums ${focused && Math.min(position, 5) === index ? 'border-blue-600 ring-2 ring-blue-100' : 'border-slate-300'}`}>
          {value[index] || ''}
        </div>)}
      </div>
      <input ref={input} id={id} type="text" inputMode="numeric" autoComplete="one-time-code"
        placeholder="Шестизначный код" pattern="[0-9]{6}" maxLength={6} required disabled={disabled}
        value={value} className="absolute inset-0 h-full w-full cursor-text opacity-0"
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onSelect={event => setPosition(event.currentTarget.selectionStart ?? value.length)}
        onChange={event => onChange(normalize(event.target.value))}
        onPaste={event => {
          event.preventDefault()
          const digits = normalize(event.clipboardData.getData('text'))
          if (!digits) return
          onChange(digits)
          requestAnimationFrame(() => { input.current?.setSelectionRange(digits.length, digits.length); setPosition(digits.length) })
        }}
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          const index = Math.max(0, Math.min(5, Math.floor((event.clientX - rect.left) / (rect.width / 6))))
          const start = Math.min(index, value.length)
          event.currentTarget.setSelectionRange(start, Math.min(start + 1, value.length))
          setPosition(start)
        }} />
    </div>
  </div>
}
