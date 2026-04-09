import { supabase } from '../lib/supabase'
import type { Account } from '../types'

export const fetchAccountsFromSupabase = async () => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase.from('accounts').select('*').order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as Account[]
}

export const createAccountWithOwnerInSupabase = async (name: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase.rpc('create_account_with_owner', {
    p_account_name: name.trim(),
  })

  if (error) throw error
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

export const deleteAccountInSupabase = async (accountId: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { error } = await supabase.from('account_members').delete().eq('account_id', accountId)

  if (error) throw error

  const { error: deleteAccountError } = await supabase.from('accounts').delete().eq('id', accountId)

  if (deleteAccountError) throw deleteAccountError
}
