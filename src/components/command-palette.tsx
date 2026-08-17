import * as React from "react"
import {
  Users,
  ReceiptText,
  ArrowRight,
  LayoutDashboard,
  BarChart3,
  Store,
  Gift,
  Split,
  BrainCircuit,
  Sparkles,
} from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { buildRecipientStats } from "@/lib/analytics"
import { buildInsights } from "@/lib/insights"
import { useData } from "@/lib/data-context"
import { useRecipientOverrides } from "@/lib/recipient-overrides"
import { formatINR } from "@/lib/format"
import { navigate } from "@/lib/router"

const NAV = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/transactions", label: "Transactions explorer", icon: ReceiptText },
  { path: "/recipients", label: "Recipients directory", icon: Users },
  { path: "/analytics", label: "Analytics", icon: BarChart3 },
  { path: "/store", label: "Store & subscriptions", icon: Store },
  { path: "/rewards", label: "Rewards", icon: Gift },
  { path: "/groups", label: "Group expenses", icon: Split },
  { path: "/neural", label: "Neural dashboard", icon: BrainCircuit },
  { path: "/ai", label: "AI Analyst", icon: Sparkles },
]

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { transactions } = useData()
  const { overrides } = useRecipientOverrides()
  const [query, setQuery] = React.useState("")

  React.useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const recipients = React.useMemo(
    () => buildRecipientStats(transactions, overrides).slice(0, 50),
    [transactions, overrides]
  )

  const insights = React.useMemo(
    () => buildInsights(transactions, overrides).slice(0, 6),
    [transactions, overrides]
  )

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return recipients
    return recipients
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.nameKey.includes(q) ||
          r.cls.toLowerCase().includes(q)
      )
      .slice(0, 30)
  }, [query, recipients])

  const go = (path: string) => {
    onOpenChange(false)
    navigate(path)
  }

  const matchingInsights = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return insights.filter((i) => `${i.title} ${i.body}`.toLowerCase().includes(q))
  }, [query, insights])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search recipients, merchants, insights…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Recipients">
          {filtered.map((r) => (
            <CommandItem
              key={r.nameKey}
              value={`${r.name} ${r.cls}`}
              onSelect={() => go(`/recipients?name=${encodeURIComponent(r.nameKey)}`)}
            >
              <Users />
              <div className="flex flex-1 items-center justify-between gap-2">
                <span className="truncate">{r.name}</span>
                <span className="text-xs text-muted-foreground">
                  {r.cls} · {formatINR(r.outflow, true)} · {r.count} txs
                </span>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
        {matchingInsights.length > 0 && (
          <CommandGroup heading="Insights">
            {matchingInsights.map((i) => (
              <CommandItem key={i.id} value={i.title} onSelect={() => i.href && go(i.href)}>
                <Sparkles />
                <span className="flex-1 truncate">{i.title}</span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Navigate">
          {NAV.map((n) => (
            <CommandItem key={n.path} value={n.label} onSelect={() => go(n.path)}>
              <n.icon />
              {n.label}
              <ArrowRight className="ml-auto size-3.5 text-muted-foreground" />
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
