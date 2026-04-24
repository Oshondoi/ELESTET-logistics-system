import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { DEFAULT_PERMISSIONS, FULL_PERMISSIONS } from '../types'
import type { MemberRole, RolePermissions } from '../types'

export const useMyPermissions = (
  accountId: string | null,
  userId: string | null,
  myRole: MemberRole | undefined,
) => {
  const isOwnerOrAdmin = myRole === 'owner' || myRole === 'admin'

  const [permissions, setPermissions] = useState<RolePermissions>(
    isOwnerOrAdmin ? FULL_PERMISSIONS : DEFAULT_PERMISSIONS,
  )
  const [isLoading, setIsLoading] = useState(!isOwnerOrAdmin)

  const load = useCallback(async () => {
    if (myRole === 'owner' || myRole === 'admin') {
      setPermissions(FULL_PERMISSIONS)
      setIsLoading(false)
      return
    }

    if (!accountId || !userId || !isSupabaseConfigured || !supabase) {
      setPermissions(DEFAULT_PERMISSIONS)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const { data } = await supabase
        .from('roles')
        .select('permissions')
        .eq('account_id', accountId)
        .eq('assigned_user_id', userId)
        .limit(1)
        .maybeSingle()

      if (data?.permissions) {
        setPermissions({
          ...DEFAULT_PERMISSIONS,
          ...(data.permissions as Partial<RolePermissions>),
        })
      } else {
        setPermissions(DEFAULT_PERMISSIONS)
      }
    } catch {
      setPermissions(DEFAULT_PERMISSIONS)
    } finally {
      setIsLoading(false)
    }
  }, [accountId, userId, myRole])

  useEffect(() => {
    void load()
  }, [load])

  return { permissions, isLoading }
}
