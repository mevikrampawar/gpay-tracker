import * as React from "react"
import { AuthProvider, useAuth } from "@/lib/auth-context"
import { DataProvider } from "@/lib/data-context"
import { AppShell } from "@/components/app-shell"
import { useRoute, navigate } from "@/lib/router"
import { AuthPage } from "@/pages/auth"
import { Loader2Icon } from "lucide-react"

const OverviewPage = React.lazy(() => import("@/pages/overview").then(m => ({ default: m.OverviewPage })))
const TransactionsPage = React.lazy(() => import("@/pages/transactions").then(m => ({ default: m.TransactionsPage })))
const RecipientsPage = React.lazy(() => import("@/pages/recipients").then(m => ({ default: m.RecipientsPage })))
const AnalyticsPage = React.lazy(() => import("@/pages/analytics").then(m => ({ default: m.AnalyticsPage })))
const StorePage = React.lazy(() => import("@/pages/store").then(m => ({ default: m.StorePage })))
const RewardsPage = React.lazy(() => import("@/pages/rewards").then(m => ({ default: m.RewardsPage })))
const GroupsPage = React.lazy(() => import("@/pages/groups").then(m => ({ default: m.GroupsPage })))
const NeuralPage = React.lazy(() => import("@/pages/neural").then(m => ({ default: m.NeuralPage })))
const AiPage = React.lazy(() => import("@/pages/ai").then(m => ({ default: m.AiPage })))
const UploadPage = React.lazy(() => import("@/pages/upload").then(m => ({ default: m.UploadPage })))
const HelpPage = React.lazy(() => import("@/pages/help").then(m => ({ default: m.HelpPage })))
import { Button } from "@/components/ui/button"

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold text-destructive">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">{this.state.error.message}</p>
          <button
            onClick={() => { this.setState({ error: null }); location.reload() }}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function PageRouter() {
  const path = useRoute()
  const base = path.split("?")[0]
  switch (base) {
    case "/transactions":
      return <TransactionsPage />
    case "/recipients":
      return <RecipientsPage />
    case "/analytics":
      return <AnalyticsPage />
    case "/store":
      return <StorePage />
    case "/rewards":
      return <RewardsPage />
    case "/groups":
      return <GroupsPage />
    case "/neural":
      return <NeuralPage />
    case "/ai":
      return <AiPage />
    case "/upload":
      return <UploadPage />
    case "/help":
      return <HelpPage />
    default:
      return <NotFoundPage />
  }
}

function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <p className="text-6xl font-bold text-muted-foreground">404</p>
      <p className="text-lg text-muted-foreground">Page not found</p>
      <Button onClick={() => navigate("/")}>Go to Overview</Button>
    </div>
  )
}

function AppInner() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    )
  }

  if (!user) return <AuthPage />

  return (
    <DataProvider>
      <AppShell>
        <React.Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2Icon className="size-6 animate-spin text-muted-foreground" /></div>}>
          <PageRouter />
        </React.Suspense>
      </AppShell>
    </DataProvider>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
