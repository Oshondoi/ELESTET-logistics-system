import type { LogoCrop } from '../../lib/logoCrop'

export function LogoCropEditor({ src, label, value, onChange, square = false, disabled = false }: {
  src: string; label: string; value: LogoCrop; onChange: (crop: LogoCrop) => void; square?: boolean; disabled?: boolean
}) {
  return <fieldset disabled={disabled} className="min-w-0 rounded-2xl border p-4">
    <legend className="px-2 text-sm font-semibold">{label}</legend>
    <div className="mx-auto w-full max-w-[240px] overflow-hidden rounded-xl border bg-slate-100" style={{ aspectRatio: value.aspect }}>
      <img draggable={false} src={src} alt={`${label}: предпросмотр`} className="h-full w-full object-cover" style={{ objectPosition: `${value.x}% ${value.y}%`, transform: `scale(${value.zoom})`, transformOrigin: `${value.x}% ${value.y}%` }} />
    </div>
    {(['x','y','zoom',...(!square ? ['aspect'] : [])] as (keyof LogoCrop)[]).map(key => <label key={key} className="mt-3 block text-xs">
      {{x:'По горизонтали',y:'По вертикали',zoom:'Масштаб',aspect:'Пропорции'}[key]}
      <input aria-label={`${label}: ${{x:'По горизонтали',y:'По вертикали',zoom:'Масштаб',aspect:'Пропорции'}[key]}`} className="mt-1 w-full" type="range" min={key==='zoom'?1:key==='aspect'?1.5:0} max={key==='zoom'||key==='aspect'?5:100} step={key==='zoom'||key==='aspect'?0.05:1} value={value[key]} onChange={e=>onChange({...value,[key]:Number(e.target.value)})} />
    </label>)}
    <button type="button" className="mt-3 text-sm text-blue-600" onClick={()=>onChange({x:50,y:50,zoom:1,aspect:square?1:3})}>Сбросить обрезку</button>
  </fieldset>
}
