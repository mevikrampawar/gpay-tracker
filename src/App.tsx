import { AuthProvider, useAuth } from "@/lib/auth-context"
import { DataProvider } from "@/lib/data-context"
import { AppShell } from "@/components/app-shell"
import { useRoute } from "@/lib/router"
import { OverviewPage } from "@/pages/overview"
import { TransactionsPage } from "@/pages/transactions"
import { RecipientsPage } from "@/pages/recipients"
import { AnalyticsPage } from "@/pages/analytics"
import { StorePage } from "@/pages/store"
import { RewardsPage } from "@/pages/rewards"
import { GroupsPage } from "@/pages/groups"
import { NeuralPage } from "@/pages/neural"
import { AiPage } from "@/pages/ai"
import { UploadPage } from "@/pages/upload"
import { HelpPage } from "@/pages/help"
import { AuthPage } from "@/pages/auth"

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
      return <OverviewPage />
  }
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
        <PageRouter />
      </AppShell>
    </DataProvider>
  )
}

export function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}

export default App
