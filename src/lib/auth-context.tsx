import * as React from "react"
import {
  auth,
  googleProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from "@/lib/firebase"
import { mintSupabaseToken, setSupabaseJwt, clearSupabaseJwt, getSupabaseJwt } from "@/lib/supabase"

interface AuthState {
  user: User | null
  loading: boolean
  supabaseReady: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthCtx = React.createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [supabaseReady, setSupabaseReady] = React.useState(() => !!getSupabaseJwt())

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser)
      if (fbUser) {
        try {
          const token = await fbUser.getIdToken()
          const sj = await mintSupabaseToken(token)
          setSupabaseJwt(sj)
          setSupabaseReady(true)
        } catch (e) {
          console.error("auth-exchange failed:", e)
          clearSupabaseJwt()
          setSupabaseReady(false)
        }
      } else {
        clearSupabaseJwt()
        setSupabaseReady(false)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  const signInWithGoogle = React.useCallback(async () => {
    await signInWithPopup(auth, googleProvider)
  }, [])

  const signOut = React.useCallback(async () => {
    await fbSignOut(auth)
    clearSupabaseJwt()
    setSupabaseReady(false)
  }, [])

  return (
    <AuthCtx.Provider value={{ user, loading, supabaseReady, signInWithGoogle, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = React.useContext(AuthCtx)
  if (!ctx) throw new Error("useAuth must be inside AuthProvider")
  return ctx
}
