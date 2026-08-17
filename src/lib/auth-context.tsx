import * as React from "react"
import {
  auth,
  googleProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from "@/lib/firebase"

interface AuthState {
  user: User | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthCtx = React.createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<User | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser)
      setLoading(false)
    })
    return unsub
  }, [])

  const signInWithGoogle = React.useCallback(async () => {
    await signInWithPopup(auth, googleProvider)
  }, [])

  const signOut = React.useCallback(async () => {
    await fbSignOut(auth)
  }, [])

  return (
    <AuthCtx.Provider value={{ user, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = React.useContext(AuthCtx)
  if (!ctx) throw new Error("useAuth must be inside AuthProvider")
  return ctx
}
