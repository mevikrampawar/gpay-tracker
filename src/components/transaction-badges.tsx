import { Badge } from "@/components/ui/badge"
import type { TransactionType } from "@/data/bundle"
import type { CounterpartyClass } from "@/lib/classify"

export function TypeBadge({ type }: { type: TransactionType }) {
  const map: Record<TransactionType, { label: string; cls: string }> = {
    Paid: { label: "Paid", cls: "bg-destructive/10 text-destructive border-destructive/20" },
    Received: { label: "Received", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
    Sent: { label: "Sent", cls: "bg-muted text-muted-foreground border-border" },
  }
  const m = map[type]
  return <Badge variant="outline" className={m.cls}>{m.label}</Badge>
}

export function ClassBadge({ cls }: { cls: CounterpartyClass }) {
  const map: Record<CounterpartyClass, { label: string; cls: string }> = {
    Merchant: { label: "Merchant", cls: "bg-primary/10 text-primary border-primary/20" },
    Person: { label: "Person", cls: "bg-muted text-muted-foreground border-border" },
    Atm: { label: "ATM", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
    Google: { label: "Google", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" },
    Platform: { label: "Platform", cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20" },
  }
  const m = map[cls]
  return <Badge variant="outline" className={m.cls}>{m.label}</Badge>
}

export function StoreStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Complete: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    Cancelled: "bg-muted text-muted-foreground border-border",
    Refunded: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  }
  return (
    <Badge variant="outline" className={map[status] ?? "bg-muted text-muted-foreground border-border"}>
      {status}
    </Badge>
  )
}
