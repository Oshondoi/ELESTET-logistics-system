import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export class SessionExpiredError extends Error {
  constructor() {
    super('Сессия входа истекла. Войдите в систему заново')
    this.name = 'SessionExpiredError'
  }
}

const isUnauthorized = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const status = Number((error as { status?: unknown }).status)
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase()
  return status === 401 || status === 403 || message.includes('jwt') || message.includes('token')
}

let verifiedAt = 0
let verification: Promise<Session> | null = null

export async function clearExpiredSession(): Promise<never> {
  if (supabase) await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  throw new SessionExpiredError()
}

async function verifyAuthenticatedSession(): Promise<Session> {
  if (!supabase) throw new Error('Supabase не настроен')

  const { data: stored } = await supabase.auth.getSession()
  if (!stored.session) throw new SessionExpiredError()

  const { error: userError } = await supabase.auth.getUser()
  if (!userError) {
    const { data: current } = await supabase.auth.getSession()
    verifiedAt = Date.now()
    return current.session ?? stored.session
  }

  if (!isUnauthorized(userError)) throw userError

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !refreshed.session) return clearExpiredSession()
  verifiedAt = Date.now()
  return refreshed.session
}

export async function ensureAuthenticatedSession(): Promise<Session> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new SessionExpiredError()
  if (Date.now() - verifiedAt < 60_000) return data.session
  if (!verification) {
    verification = verifyAuthenticatedSession().finally(() => { verification = null })
  }
  return verification
}

export async function refreshAuthenticatedSession(): Promise<Session> {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data.session) return clearExpiredSession()
  verifiedAt = Date.now()
  return data.session
}
