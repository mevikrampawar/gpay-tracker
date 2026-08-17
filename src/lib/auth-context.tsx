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
  authError: string | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  retryMint: () => Promise<void>
  clearAuthError: () => void
}

const AuthCtx = React.createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [supabaseReady, setSupabaseReady] = React.useState(() => !!getSupabaseJwt())
  const [authError, setAuthError] = React.useState<string | null>(null)

  const doMint = React.useCallback(async (fbUser: User) => {
    try {
      setAuthError(null)
      const token = await fbUser.getIdToken(true)
      const sj = await mintSupabaseToken(token)
      setSupabaseJwt(sj)
      setSupabaseReady(true)
      setAuthError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("auth-exchange failed:", msg)
      clearSupabaseJwt()
      setSupabaseReady(false)
      setAuthError(`Supabase connection failed: ${msg}`)
    }
  }, [])

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser)
      if (fbUser) {
        await doMint(fbUser)
      } else {
        clearSupabaseJwt()
        setSupabaseReady(false)
        setAuthError(null)
      }
      setLoading(false)
    })
    return unsub
  }, [doMint])

  const signInWithGoogle = React.useCallback(async () => {
    await signInWithPopup(auth, googleProvider)
  }, [])

  const retryMint = React.useCallback(async () => {
    const fbUser = auth.currentUser
    if (fbUser) await doMint(fbUser)
  }, [doMint])

  const signOut = React.useCallback(async () => {
    await fbSignOut(auth)
    clearSupabaseJwt()
    setSupabaseReady(false)
    setAuthError(null)
  }, [])

  const clearAuthError = React.useCallback(() => setAuthError(null), [])

  return (
    <AuthCtx.Provider value={{ user, loading, supabaseReady, authError, signInWithGoogle, signOut, retryMint, clearAuthError }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = React.useContext(AuthCtx)
  if (!ctx) throw new Error("useAuth must be inside AuthProvider")
  return ctx
}
