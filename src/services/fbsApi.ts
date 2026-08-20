import { supabase } from '../lib/supabase'

export async function invokeFbs(storeId: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ''
  const sbUrl = import.meta.env.VITE_SUPABASE_URL as string
  const sbKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const response = await fetch(`${sbUrl}/functions/v1/wb-fbs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: sbKey,
    },
    body: JSON.stringify({ ...body, store_id: storeId }),
  })
  const data = await response.json() as Record<string, any>
  if (!response.ok || data?.error) throw new Error(String(data?.error || `HTTP ${response.status}`))
  return data
}
