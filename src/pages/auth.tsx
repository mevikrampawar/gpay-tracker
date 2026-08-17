import * as React from "react"
import { Sparkles } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"

export function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [isSignUp, setIsSignUp] = React.useState(false)
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      if (isSignUp) await signUp(email, password)
      else await signIn(email, password)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes("auth/invalid-credential")) setError("Invalid email or password")
      else if (msg.includes("auth/email-already-in-use")) setError("Email already registered — try signing in")
      else if (msg.includes("auth/weak-password")) setError("Password must be at least 6 characters")
      else if (msg.includes("auth/user-not-found")) setError("No account with this email — try sign up")
      else if (msg.includes("auth/wrong-password")) setError("Wrong password")
      else if (msg.includes("auth/too-many-requests")) setError("Too many attempts — wait a minute")
      else setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="size-5 text-primary" />
          </div>
          <CardTitle className="text-lg">Personal Trans Tracker</CardTitle>
          <CardDescription>
            {isSignUp ? "Create your account" : "Sign in to your account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Working…" : isSignUp ? "Sign up" : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setIsSignUp(!isSignUp); setError("") }}
            >
              {isSignUp ? "Already have an account? Sign in" : "No account? Sign up"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
