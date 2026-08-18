import * as React from "react"
import {
  LayoutDashboard,
  ReceiptText,
  Users,
  BarChart3,
  Store,
  Gift,
  Split,
  BrainCircuit,
  Sparkles,
  Upload,
  HelpCircle,
  Search,
  Moon,
  Sun,
  Monitor,
  CircleUser,
  Loader2,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { CommandPalette } from "@/components/command-palette"
import { navigate, useRoute } from "@/lib/router"
import { computeTotals, buildRecipientStats } from "@/lib/analytics"
import { formatINR } from "@/lib/format"
import { useRecipientOverrides } from "@/lib/recipient-overrides"
import { useData } from "@/lib/data-context"
import { getIncompleteJobs, deleteJob, type UploadJob } from "@/lib/upload-queue"

export const NAV_ITEMS = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/transactions", label: "Transactions", icon: ReceiptText },
  { path: "/recipients", label: "Recipients", icon: Users },
  { path: "/analytics", label: "Analytics", icon: BarChart3 },
  { path: "/store", label: "Store & Subscriptions", icon: Store },
  { path: "/rewards", label: "Rewards", icon: Gift },
  { path: "/groups", label: "Group Expenses", icon: Split },
  { path: "/neural", label: "Neural Dashboard", icon: BrainCircuit },
  { path: "/ai", label: "AI Analyst", icon: Sparkles },
  { path: "/upload", label: "Upload Data", icon: Upload },
  { path: "/help", label: "Help Guide", icon: HelpCircle },
]

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
        {theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />}
        <span className="sr-only">Toggle theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarNav({ path }: { path: string }) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Finance Intelligence</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = path === item.path
            return (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton
                  isActive={active}
                  onClick={() => {
                    navigate(item.path)
                    setOpenMobile(false)
                  }}
                >
                  <Icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function TopBar({ path, onOpenPalette }: { path: string; onOpenPalette: () => void }) {
  const active = NAV_ITEMS.find((n) => n.path === path)
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger />
      <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
        <h2 className="truncate text-sm font-semibold">{active?.label ?? "Overview"}</h2>
      </div>
      <div className="flex flex-1 items-center gap-2 sm:flex-none">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground sm:w-64"
          onClick={onOpenPalette}
        >
          <Search />
          <span className="flex-1 text-left">Search recipients…</span>
          <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">
            ⌘K
          </kbd>
        </Button>
      </div>
      <ThemeToggle />
    </header>
  )
}

function SidebarFooterCard() {
  const { setOpenMobile } = useSidebar()
  const { transactions } = useData()
  const { overrides } = useRecipientOverrides()
  const totals = React.useMemo(() => computeTotals(transactions), [transactions])
  const recipientCount = React.useMemo(
    () => buildRecipientStats(transactions, overrides).length,
    [transactions, overrides]
  )
  return (
    <SidebarFooter>
      <div
        className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 p-3 text-xs"
        onClick={() => {
          navigate("/recipients")
          setOpenMobile(false)
        }}
        role="button"
      >
        <div className="flex items-center gap-2 font-medium">
          <CircleUser className="size-4 text-muted-foreground" />
          Recipients tracked
        </div>
        <div className="text-muted-foreground">
          {recipientCount.toLocaleString()} entities · {totals.uniqueMerchants.toLocaleString()} merchants
        </div>
      </div>
    </SidebarFooter>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = useRoute()
  const { transactions } = useData()
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [incompleteJobs, setIncompleteJobs] = React.useState<UploadJob[]>([])
  const pathRef = React.useRef(path)
  pathRef.current = path

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  React.useEffect(() => {
    getIncompleteJobs().then(setIncompleteJobs)
  }, [])

  React.useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        getIncompleteJobs().then(setIncompleteJobs)
      }
    }
    document.addEventListener("visibilitychange", handler)
    return () => document.removeEventListener("visibilitychange", handler)
  }, [])

  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ReceiptText className="size-4" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">GPay Insights</span>
              <span className="text-[11px] text-muted-foreground">
                {formatINR(computeTotals(transactions).outflow, true)} lifetime outflow
              </span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav path={path} />
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooterCard />
      </Sidebar>
      <SidebarInset>
        <TopBar path={path} onOpenPalette={() => setPaletteOpen(true)} />
        <div className="mx-auto w-full max-w-[1400px] p-4 md:p-6">
          {incompleteJobs.length > 0 && incompleteJobs.map(job => (
            <div key={job.id} className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 mb-4">
              <div className="flex items-center gap-3">
                <Loader2 className="size-4 animate-spin text-amber-500" />
                <div>
                  <p className="text-sm font-medium">Upload in progress: {job.fileName}</p>
                  <p className="text-xs text-muted-foreground">Phase: {job.phase}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => navigate("/upload")}>
                  Resume
                </Button>
                <Button size="sm" variant="ghost" onClick={async () => {
                  await deleteJob(job.id)
                  setIncompleteJobs(prev => prev.filter(j => j.id !== job.id))
                }}>
                  Cancel
                </Button>
              </div>
            </div>
          ))}
          {children}
        </div>
      </SidebarInset>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarProvider>
  )
}
