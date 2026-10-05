import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { normalizeLogoCrop, squareCrop, rectangleCrop, validateLogoFile } from '../../lib/logoCrop'
import { LogoCropEditor } from './LogoCropEditor'

export function CompanyBrandSettings({ accountId }: { accountId: string }) {
  const [allowed,setAllowed]=useState(false), [loading,setLoading]=useState(true), [busy,setBusy]=useState(false)
  const [name,setName]=useState(''), [title,setTitle]=useState(''), [original,setOriginal]=useState<string|null>(null)
  const [src,setSrc]=useState<string|null>(null), [file,setFile]=useState<File|null>(null)
  const [square,setSquare]=useState(squareCrop), [rectangle,setRectangle]=useState(rectangleCrop)
  const [message,setMessage]=useState(''), [failed,setFailed]=useState(false)
  const lock=useRef(false)
  useEffect(()=>{
    let cancelled=false
    async function load() {
      if(!supabase) return
      try {
        const permission=await supabase.rpc('can_manage_company_brand' as never,{p_account_id:accountId} as never)
        if(permission.error) throw permission.error
        if(cancelled) return
        setAllowed(Boolean(permission.data))
        if(!permission.data) return
        const {data,error}=await supabase.from('company_brand_assets' as never).select('*').eq('account_id',accountId).maybeSingle()
        if(error) throw error
        if(cancelled || !data) return
        const row=data as unknown as {brand_name:string;tab_title:string;original_path:string|null;square_crop:typeof square;rectangle_crop:typeof rectangle}
        setName(row.brand_name);setTitle(row.tab_title);setOriginal(row.original_path)
        setSquare(normalizeLogoCrop(row.square_crop,true));setRectangle(normalizeLogoCrop(row.rectangle_crop,false))
        if(row.original_path){
          const download=await supabase.storage.from('brand-originals').download(row.original_path)
          if(download.error)throw download.error
          const stored=new File([download.data],'original',{type:download.data.type})
          await validateLogoFile(stored)
          if(!cancelled)setSrc(URL.createObjectURL(stored))
        }
      } catch {if(!cancelled){setFailed(true);setMessage('Не удалось загрузить настройки бренда.')}}
      finally {if(!cancelled)setLoading(false)}
    }
    void load();return()=>{cancelled=true}
  },[accountId])
  useEffect(()=>()=>{if(src)URL.revokeObjectURL(src)},[src])
  async function choose(next?:File){
    if(!next || busy)return
    setBusy(true);setMessage('')
    try {await validateLogoFile(next);setFile(next);setSrc(URL.createObjectURL(next));setSquare(squareCrop);setRectangle(rectangleCrop)}
    catch(e){setFailed(true);setMessage(e instanceof Error?e.message:'Ошибка файла')}
    finally{setBusy(false)}
  }
  async function save(e:React.FormEvent){
    e.preventDefault();if(!supabase||lock.current)return
    lock.current=true;setBusy(true);setMessage('');setFailed(false)
    try {
      let path=original
      if(file){
        path=`${accountId}/${crypto.randomUUID()}`
        const upload=await supabase.storage.from('brand-originals').upload(path,file,{contentType:file.type,upsert:false})
        if(upload.error)throw upload.error
        // A failed metadata save can retry without uploading the original again.
        setOriginal(path);setFile(null)
      }
      const {error}=await supabase.from('company_brand_assets' as never).upsert({account_id:accountId,brand_name:name.trim(),tab_title:title.trim(),original_path:path,square_crop:square,rectangle_crop:rectangle,updated_at:new Date().toISOString()} as never)
      if(error)throw error
      setMessage('Оригинал и настройки сохранены. Обрезки можно менять без повторной загрузки.')
    }catch{setFailed(true);setMessage('Не удалось сохранить настройки. Попробуйте ещё раз.')}
    finally{lock.current=false;setBusy(false)}
  }
  if(loading)return <p className="text-sm text-slate-500">Загрузка настроек бренда…</p>
  if(!allowed)return message?<p role="alert">{message}</p>:null
  return <section className="rounded-3xl border bg-white p-5">
    <h2 className="text-lg font-semibold">Свой бренд — оформление</h2>
    <p className="mt-2 text-sm text-slate-500">Настройки сохраняются отдельно от оплаты. Сохранение не подключает платную опцию.</p>
    <form className="mt-4 grid gap-4" onSubmit={e=>void save(e)}>
      <label className="text-sm">Название бренда<input className="mt-1 w-full rounded-xl border p-3" maxLength={100} value={name} disabled={busy} onChange={e=>setName(e.target.value)} /></label>
      <label className="text-sm">Заголовок вкладки<input className="mt-1 w-full rounded-xl border p-3" maxLength={150} value={title} disabled={busy} onChange={e=>setTitle(e.target.value)} /></label>
      <label className="text-sm">Оригинал логотипа — PNG, JPG, WebP или SVG до 2 МБ<input className="mt-2 block w-full" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={busy} onChange={e=>void choose(e.target.files?.[0])} /></label>
      {src&&<div className="grid gap-4 sm:grid-cols-2"><LogoCropEditor src={src} label="Квадратный" value={square} onChange={setSquare} square disabled={busy}/><LogoCropEditor src={src} label="Прямоугольный" value={rectangle} onChange={setRectangle} disabled={busy}/></div>}
      <div aria-live="polite" className={`h-16 overflow-auto text-sm ${failed?'text-red-600':'text-emerald-700'}`}>{message}</div>
      <button disabled={busy} className="rounded-xl bg-blue-600 p-3 font-semibold text-white disabled:opacity-50">{busy?'Сохранение…':'Сохранить оформление'}</button>
    </form>
  </section>
}
