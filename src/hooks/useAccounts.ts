import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  createAccountWithOwnerInSupabase,
  deleteAccountWithOwnerInSupabase,
  fetchAccountsFromSupabase,
} from '../services/accountService'
import type { Account } from '../types'

export const useAccounts = (enabled: boolean) => {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!enabled || !isSupabaseConfigured) {
      setAccounts([])
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const nextAccounts = await fetchAccountsFromSupabase()
      setAccounts(nextAccounts)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Ошибка загрузки компаний')
    } finally {
      setIsLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  const createAccount = async (name: string) => {
    const account = await createAccountWithOwnerInSupabase(name)
    setAccounts((current) => [account, ...current])
    return account
  }

  const deleteAccount = async (accountId: string) => {
    await deleteAccountWithOwnerInSupabase(accountId)
    setAccounts((current) => current.filter((account) => account.id !== accountId))
  }

  return {
    accounts,
    isLoading,
    error,
    createAccount,
    deleteAccount,
    reload,
  }
}
