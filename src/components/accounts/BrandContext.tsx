import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export interface Brand { name:string; title:string; squareUrl:string|null; rectangleUrl:string|null; expiresAt:number }
const standard:Brand = {name:'ELESTET',title:'ELESTET Logistics',squareUrl:null,rectangleUrl:null,expiresAt:Infinity}
export const BrandContext=createContext<Brand>(standard)
export const useBrand=()=>useContext(BrandContext)

export function useResolvedBrand(accountId:string|null,token:string|null,portal:boolean) {
  const key=JSON.stringify([accountId,token,portal])
  const [state,setState]=useState<{key:string;brand:Brand}|null>(null)
  const [failedKey,setFailedKey]=useState<string|null>(null)
  const [clock,setClock]=useState(Date.now())
  const brand=state?.key===key && state.brand.expiresAt>clock ? state.brand : standard
  useEffect(()=>{
    let cancelled=false, generation=0
    async function refresh() {
      const request=++generation
      if(!supabase || (!accountId&&!token)){setState(null);return}
      try {
        const {data,error}=await supabase.rpc('resolve_company_brand' as never,{p_account_id:accountId,p_invite_token:token,p_client_portal:portal} as never)
        if(error)throw error
        const row=data as unknown as {name:string;title:string;square_path:string|null;rectangle_path:string|null;expires_at:string}|null
        const url=(path:string|null)=>path ? supabase!.storage.from('brand-renders').getPublicUrl(path).data.publicUrl : null
        if(!cancelled&&request===generation){setFailedKey(null);setState({key,brand:row?{name:row.name,title:row.title,squareUrl:url(row.square_path),rectangleUrl:url(row.rectangle_path),expiresAt:Date.parse(row.expires_at)}:standard})}
      } catch {
        // Keep an already verified brand during a temporary network error, until expiry.
        if(!cancelled&&request===generation)setFailedKey(key)
      }
      if(!cancelled)setClock(Date.now())
    }
    void refresh()
    const timer=window.setInterval(()=>void refresh(),60000)
    const wake=()=>void refresh()
    window.addEventListener('focus',wake)
    window.addEventListener('company-brand-saved',wake)
    return()=>{cancelled=true;clearInterval(timer);window.removeEventListener('focus',wake);window.removeEventListener('company-brand-saved',wake)}
  },[key,accountId,token,portal])
  useEffect(()=>{
    if(!Number.isFinite(brand.expiresAt))return
    const timer=setTimeout(()=>setClock(Date.now()),Math.min(2147483647,Math.max(0,brand.expiresAt-Date.now()+20)))
    return()=>clearTimeout(timer)
  },[brand.expiresAt,clock])
  useEffect(()=>{
    document.title=brand.title
    let icon=document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if(!icon){icon=document.createElement('link');icon.rel='icon';document.head.appendChild(icon)}
    // Branded fallback is neutral, never the ELESTET icon.
    icon.type=brand.squareUrl?'image/png':'image/svg+xml'
    icon.href=brand.squareUrl || (brand===standard?'/favicon.svg':'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>')
    return()=>{document.title=standard.title;icon!.href='/favicon.svg';icon!.type='image/svg+xml'}
  },[brand])
  return {brand,loading:Boolean(accountId||token)&&state?.key!==key,error:failedKey===key}
}

export function BrandLogo({compact=false}:{compact?:boolean}) {
  const brand=useBrand(),url=compact?brand.squareUrl:brand.rectangleUrl
  const [failed,setFailed]=useState<string|null>(null)
  return url&&failed!==url
    ? <img src={url} onError={()=>setFailed(url)} alt={brand.name} className={compact?'h-9 w-9 object-contain':'h-10 max-w-[168px] object-contain'} />
    : <span className="block truncate font-black text-slate-900">{compact?brand.name.slice(0,1):brand.name}</span>
}
