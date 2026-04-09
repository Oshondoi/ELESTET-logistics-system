import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthCredentials {
  email: string
  password: string
}

interface SignUpCredentials extends AuthCredentials {
  fullName: string
}

const normalizePassword = (password: string) => password.toLowerCase()

export const useAuth = () => {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false)
      return
    }

    let isMounted = true

    void supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        setSession(data.session)
        setIsLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async ({ email, password }: AuthCredentials) => {
    if (!supabase) {
      throw new Error('Supabase не настроен')
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: normalizePassword(password),
    })

    if (error) {
      throw error
    }
  }

  const signUp = async ({ email, password, fullName }: SignUpCredentials) => {
    if (!supabase) {
      throw new Error('Supabase не настроен')
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password: normalizePassword(password),
      options: {
        data: {
          full_name: fullName,
        },
      },
    })

    if (error) {
      throw error
    }

    return data
  }

  const signOut = async () => {
    if (!supabase) {
      return
    }

    const { error } = await supabase.auth.signOut()

    if (error) {
      throw error
    }
  }

  return {
    session,
    isLoading,
    signIn,
    signUp,
    signOut,
  }
}
