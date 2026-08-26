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
      const { data, error } = await (supabase as any)
        .from('role_assignments')
        .select('roles!inner(permissions, account_id)')
        .eq('account_id', accountId)
        .eq('user_id', userId)

      if (error) throw error
      if (data?.length) {
        const combined = { ...DEFAULT_PERMISSIONS }
        for (const assignment of data as Array<{ roles: { permissions: Partial<RolePermissions> } }>) {
          for (const [key, enabled] of Object.entries(assignment.roles.permissions ?? {})) {
            if (enabled && key in combined) combined[key as keyof RolePermissions] = true
          }
        }
        setPermissions(combined)
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

  return { permissions, isLoading, isOwnerOrAdmin }
}
