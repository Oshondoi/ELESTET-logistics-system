import { supabase } from '../lib/supabase'
import type { Account } from '../types'

export const fetchAccountsFromSupabase = async () => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  // Пробуем RPC get_my_accounts (возвращает my_role)
  const { data, error } = await supabase.rpc('get_my_accounts')

  if (!error) return (data ?? []) as Account[]

  // Fallback: прямой select через RLS (если SQL-патч ещё не применён)
  const { data: fallbackData, error: fallbackError } = await supabase
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false })

  if (fallbackError) throw fallbackError
  return (fallbackData ?? []) as Account[]
}

export const createAccountWithOwnerInSupabase = async (name: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase.rpc('create_account_with_owner', {
    p_account_name: name.trim(),
  })

  if (error) throw new Error(error.message)
  return data as Account
}

export const deleteAccountWithOwnerInSupabase = async (accountId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase.rpc('delete_account_with_owner', {
    p_account_id: accountId,
  })

  if (error) throw error
  return Boolean(data)
}

export const updateAccountInSupabase = async (
  accountId: string,
  name: string,
  logoUrl?: string | null,
) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = { name: name.trim() }
  if (logoUrl !== undefined) payload.logo_url = logoUrl

  const { data, error } = await supabase
    .from('accounts')
    .update(payload)
    .eq('id', accountId)
    .select()
    .single()

  if (error) throw error
  return data as import('../types').Account
}

export const deleteAccountInSupabase = async (accountId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { error } = await supabase.from('account_members').delete().eq('account_id', accountId)

  if (error) throw error

  const { error: deleteAccountError } = await supabase.from('accounts').delete().eq('id', accountId)

  if (deleteAccountError) throw deleteAccountError
}

export const fetchArchivedAccountsFromSupabase = async () => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase.rpc('get_my_archived_accounts')

  if (error) throw error
  return (data ?? []) as import('../types').Account[]
}

export const restoreAccountInSupabase = async (accountId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { error } = await supabase.rpc('restore_account', { p_account_id: accountId })

  if (error) throw error
}
