import { supabase } from '../lib/supabase'
import { ensureAuthenticatedSession, refreshAuthenticatedSession } from '../lib/authSession'

export async function invokeFbs(storeId: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  if (!supabase) throw new Error('Supabase не настроен')
  const sbUrl = import.meta.env.VITE_SUPABASE_URL as string
  const sbKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const requestBody = JSON.stringify({ ...body, store_id: storeId })
  const send = (token: string) => fetch(`${sbUrl}/functions/v1/wb-fbs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: sbKey,
      },
      body: requestBody,
    })

  let session = await ensureAuthenticatedSession()
  let response = await send(session.access_token)
  if (response.status === 401) {
    session = await refreshAuthenticatedSession()
    response = await send(session.access_token)
  }
  const data = await response.json() as Record<string, any>
  if (!response.ok || data?.error) throw new Error(String(data?.error || `HTTP ${response.status}`))
  return data
}
