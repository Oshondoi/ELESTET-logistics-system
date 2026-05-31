import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

export type PlatformRole = 'user' | 'support' | 'admin' | 'superadmin'

interface UsePlatformRoleResult {
  platformRole: PlatformRole
  isSuperAdmin: boolean  // только superadmin
  isAdmin: boolean       // admin + superadmin (управление клиентами)
  isSupport: boolean     // support + admin + superadmin (читает AdminPage)
  isLoading: boolean
}

export function usePlatformRole(userId: string | null | undefined): UsePlatformRoleResult {
  const [platformRole, setPlatformRole] = useState<PlatformRole>('user')
  const [isLoading, setIsLoading] = useState(Boolean(userId && isSupabaseConfigured))

  useEffect(() => {
    if (!userId || !isSupabaseConfigured || !supabase) {
      setPlatformRole('user')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    void (supabase as any).rpc('get_my_platform_role').then(
      ({ data, error }: { data: string | null; error: unknown }) => {
        if (!error && data) setPlatformRole(data as PlatformRole)
        setIsLoading(false)
      }
    )
  }, [userId])

  return {
    platformRole,
    isSuperAdmin: platformRole === 'superadmin',
    isAdmin: platformRole === 'admin' || platformRole === 'superadmin',
    isSupport: platformRole === 'support' || platformRole === 'admin' || platformRole === 'superadmin',
    isLoading,
  }
}
