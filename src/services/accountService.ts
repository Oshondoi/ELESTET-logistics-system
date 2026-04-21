import { supabase } from '../lib/supabase'
import type { Account } from '../types'

export const fetchAccountsFromSupabase = async () => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase.rpc('get_my_accounts')

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

export const updateAccountInSupabase = async (accountId: string, name: string) => {
  if (!supabase) {
    throw new Error('Supabase client is not configured')
  }

  const { data, error } = await supabase
    .from('accounts')
    .update({ name: name.trim() })
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
