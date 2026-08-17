import * as React from "react"
import { Users, Search, ChevronRight, Download, Pin, PinOff, ChevronLeft, Upload, ArrowRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Bar, BarChart, XAxis, YAxis, ResponsiveContainer } from "recharts"
import { TypeBadge } from "@/components/transaction-badges"
import { ClassBadge } from "@/components/transaction-badges"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ExportButton } from "@/components/export-button"
import { Sparkline } from "@/components/sparkline"
import { useData } from "@/lib/data-context"
import type { UpiTransaction } from "@/data/bundle"
import { buildRecipientStats, type RecipientStat } from "@/lib/analytics"
import type { CounterpartyClass } from "@/lib/classify"
import { useRecipientOverrides } from "@/lib/recipient-overrides"
import { formatINR, monthLabel, dateTimeLabel } from "@/lib/format"
import { navigate } from "@/lib/router"
import { downloadCSV } from "@/lib/export-utils"
import { cn } from "@/lib/utils"

type SortKey = "outflow" | "count" | "avg" | "max" | "name" | "lastTs" | "inflow"
type SortDir = "asc" | "desc"

const CLASS_OPTIONS: { value: CounterpartyClass | "Auto"; label: string }[] = [
  { value: "Auto", label: "Auto-detect" },
  { value: "Merchant", label: "Merchant" },
  { value: "Person", label: "Person" },
  { value: "Platform", label: "Platform" },
  { value: "Atm", label: "ATM" },
  { value: "Google", label: "Google" },
]

function getQueryName(): string | null {
  const m = window.location.hash.match(/[?&]name=([^&]+)/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return null
  }
}

function RecipientDetail({
  stat,
  setOverride,
  transactions,
}: {
  stat: RecipientStat
  setOverride: ReturnType<typeof useRecipientOverrides>["setOverride"]
  transactions: UpiTransaction[]
}) {
  const txs = React.useMemo(
    () =>
      transactions
        .filter((t) => t.nameKey === stat.nameKey)
        .sort((a, b) => b.ts.localeCompare(a.ts)),
    [transactions, stat.nameKey]
  )

  const chartData = stat.monthlySpend.map((m) => ({
    ...m,
    label: monthLabel(Number(m.key.split("-")[0]), Number(m.key.split("-")[1])),
  }))

  return (
    <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
      <SheetHeader className="border-b p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <SheetTitle className="flex items-center gap-2">
              {stat.name}
              <ClassBadge cls={stat.cls} />
            </SheetTitle>
            <SheetDescription>
              {stat.count.toLocaleString()} transactions · active {stat.monthsActive} months · last seen {dateTimeLabel(
                new Date(stat.lastTs).getUTCFullYear(),
                new Date(stat.lastTs).getUTCMonth() + 1,
                new Date(stat.lastTs).getUTCDate(),
                new Date(stat.lastTs).getUTCHours(),
                new Date(stat.lastTs).getUTCMinutes()
              )}
            </SheetDescription>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Classify as</span>
          <Select
            value={stat.override ?? "Auto"}
            onValueChange={(v) =>
              setOverride(stat.nameKey, v === "Auto" ? null : (v as CounterpartyClass))
            }
          >
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {CLASS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => downloadCSV(`${stat.nameKey}-transactions.csv`, [
              "Date", "Type", "Amount", "Method", "Status", "Reference",
            ], txs.map((t) => [
              dateTimeLabel(t.year, t.month, t.day, t.hour, t.minute),
              t.type,
              t.amount,
              t.method ?? "",
              t.status ?? "",
              t.id,
            ]))}
          >
            <Download data-icon="inline-start" /> CSV
          </Button>
        </div>
      </SheetHeader>

      <div className="grid grid-cols-4 gap-px border-b bg-border">
        <div className="bg-card p-3">
          <div className="text-xs text-muted-foreground">Paid</div>
          <div className="text-lg font-semibold tabular-nums">{formatINR(stat.outflow, true)}</div>
        </div>
        <div className="bg-card p-3">
          <div className="text-xs text-muted-foreground">Received</div>
          <div className="text-lg font-semibold tabular-nums">{formatINR(stat.inflow, true)}</div>
        </div>
        <div className="bg-card p-3">
          <div className="text-xs text-muted-foreground">Avg / tx</div>
          <div className="text-lg font-semibold tabular-nums">{formatINR(stat.avg, true)}</div>
        </div>
        <div className="bg-card p-3">
          <div className="text-xs text-muted-foreground">Largest</div>
          <div className="text-lg font-semibold tabular-nums">{formatINR(stat.max, true)}</div>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div>
          <h3 className="mb-2 text-sm font-medium">Monthly spend</h3>
          <ChartContainer config={{ a: { label: "Spend", color: "var(--chart-1)" } }} className="h-40">
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} minTickGap={20} />
                <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v) => formatINR(Number(v), true)} />
                <ChartTooltip
                  cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                  content={<ChartTooltipContent formatter={(v) => formatINR(Number(v))} />}
                />
                <Bar dataKey="amount" fill="var(--color-a)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </div>

        {stat.methods.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Payment methods</h3>
            <div className="flex flex-wrap gap-2">
              {stat.methods.map((m) => (
                <Badge key={m.method} variant="secondary">
                  {m.method} · {m.count}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-sm font-medium">All transactions</h3>
          <div className="flex flex-col">
            {txs.slice(0, 40).map((t) => (
              <div key={t.id} className="flex items-center gap-3 border-b py-2 text-sm last:border-0">
                <TypeBadge type={t.type} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">
                    {dateTimeLabel(t.year, t.month, t.day, t.hour, t.minute)}
                  </div>
                </div>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    t.type === "Received" ? "text-emerald-600 dark:text-emerald-400" : ""
                  )}
                >
                  {t.type === "Received" ? "+" : "−"}{formatINR(t.amount)}
                </span>
              </div>
            ))}
            {txs.length > 40 && (
              <p className="pt-2 text-center text-xs text-muted-foreground">
                +{txs.length - 40} more — use Transactions page for the full view
              </p>
            )}
          </div>
        </div>
      </div>
    </SheetContent>
  )
}

export function RecipientsPage() {
  const { transactions, loading } = useData()
  const { overrides, setOverride, clearOverrides } = useRecipientOverrides()
  const [q, setQ] = React.useState("")

  if (!loading && transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
          <Upload className="size-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">No data yet</h2>
        <p className="text-sm text-muted-foreground">Upload your Google Pay Takeout to get started</p>
        <Button onClick={() => navigate("/upload")}>
          Upload Data <ArrowRight />
        </Button>
      </div>
    )
  }
  const [classFilter, setClassFilter] = React.useState<"All" | CounterpartyClass>("All")
  const [sortKey, setSortKey] = React.useState<SortKey>("outflow")
  const [sortDir, setSortDir] = React.useState<SortDir>("desc")
  const [selectedKey, setSelectedKey] = React.useState<string | null>(getQueryName())
  const [page, setPage] = React.useState(0)
  const PAGE_SIZE = 100
  const [pinned, setPinned] = React.useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("gpay_pinned_recipients") ?? "[]")
    } catch {
      return []
    }
  })

  const all = React.useMemo(
    () =>       buildRecipientStats(transactions, overrides),
    [transactions, overrides]
  )

  React.useEffect(() => {
    const onHash = () => setSelectedKey(getQueryName())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const togglePin = (nameKey: string) => {
    setPinned((p) => {
      const next = p.includes(nameKey) ? p.filter((x) => x !== nameKey) : [...p, nameKey]
      try {
        localStorage.setItem("gpay_pinned_recipients", JSON.stringify(next))
      } catch { /* ignore */ }
      return next
    })
  }

  const filtered = React.useMemo(() => {
    const qq = q.trim().toLowerCase()
    const rows = all.filter((r) => {
      if (classFilter !== "All" && r.cls !== classFilter) return false
      if (qq && !`${r.name} ${r.nameKey} ${r.cls}`.toLowerCase().includes(qq)) return false
      return true
    })
    const mult = sortDir === "asc" ? 1 : -1
    return rows.sort((a, b) => {
      if (sortKey === "name") return mult * a.name.localeCompare(b.name)
      if (sortKey === "lastTs") return mult * a.lastTs.localeCompare(b.lastTs)
      return mult * (a[sortKey] - b[sortKey])
    })
  }, [all, q, classFilter, sortKey, sortDir])

  const pinnedFirst = React.useMemo(
    () => [...filtered].sort((a, b) => Number(pinned.includes(b.nameKey)) - Number(pinned.includes(a.nameKey))),
    [filtered, pinned]
  )

  const pageCount = Math.max(1, Math.ceil(pinnedFirst.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = pinnedFirst.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  React.useEffect(() => {
    setPage(0)
  }, [q, classFilter, sortKey, sortDir])

  const totalPaid = all.reduce((s, r) => s + r.outflow, 0)

  const classCounts = React.useMemo(() => {
    const acc: Record<"All" | CounterpartyClass, number> = { All: all.length, Merchant: 0, Person: 0, Platform: 0, Atm: 0, Google: 0 }
    for (const r of all) acc[r.cls]++
    return acc
  }, [all])

  const sparkByKey = React.useMemo(() => {
    const map = new Map<string, number[]>()
    for (const r of all) map.set(r.nameKey, r.monthlySpend.slice(-6).map((m) => m.amount))
    return map
  }, [all])

  const selected = selectedKey ? all.find((r) => r.nameKey === selectedKey) ?? null : null

  const SortBtn = ({ col, label, className }: { col: SortKey; label: string; className?: string }) => (
    <button
      className={cn("flex items-center gap-1 select-none hover:text-foreground", className)}
      onClick={() => {
        if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
        else {
          setSortKey(col)
          setSortDir(col === "name" || col === "lastTs" ? "asc" : "desc")
        }
      }}
    >
      {label}
      <span className={cn("text-[10px]", sortKey === col ? "text-foreground" : "text-muted-foreground")}>
        {sortKey === col ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  )

  const exportRows = filtered.map((r) => ({
    Recipient: r.name,
    Type: r.cls,
    Transactions: r.count,
    TotalPaid: r.outflow,
    TotalReceived: r.inflow,
    AvgPerTx: Math.round(r.avg),
    Largest: r.max,
    ActiveMonths: r.monthsActive,
    FirstSeen: r.firstTs,
    LastSeen: r.lastTs,
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Recipients"
        description="Every person, merchant and platform you've transacted with — ranked and analysable"
        icon={Users}
      >
        <ExportButton
          filename="gpay-recipients"
          rows={exportRows}
          jsonData={filtered}
          columns={[
            { header: "Recipient", value: (r) => String(r.Recipient) },
            { header: "Type", value: (r) => String(r.Type) },
            { header: "Transactions", value: (r) => Number(r.Transactions) },
            { header: "Total Paid", value: (r) => Number(r.TotalPaid) },
            { header: "Total Received", value: (r) => Number(r.TotalReceived) },
            { header: "Avg per tx", value: (r) => Number(r.AvgPerTx) },
            { header: "Largest", value: (r) => Number(r.Largest) },
            { header: "Active months", value: (r) => Number(r.ActiveMonths) },
            { header: "First seen", value: (r) => String(r.FirstSeen) },
            { header: "Last seen", value: (r) => String(r.LastSeen) },
          ]}
          label="Export recipients"
        />
      </PageHeader>

      <div className="flex flex-wrap items-center gap-1.5">
        {(["All", "Merchant", "Person", "Platform", "Atm", "Google"] as const).map((c) => {
          const active = classFilter === c
          const label = c === "Atm" ? "ATM" : c
          return (
            <button
              key={c}
              onClick={() => setClassFilter(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted"
              )}
            >
              {label}
              <span className={cn("ml-1.5 tabular-nums", active ? "text-primary-foreground/70" : "text-muted-foreground/60")}>
                {classCounts[c].toLocaleString()}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search recipients or merchants…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={classFilter} onValueChange={(v) => setClassFilter(v as "All" | CounterpartyClass)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="All">All types</SelectItem>
              <SelectItem value="Merchant">Merchant</SelectItem>
              <SelectItem value="Person">Person</SelectItem>
              <SelectItem value="Platform">Platform</SelectItem>
              <SelectItem value="Atm">ATM</SelectItem>
              <SelectItem value="Google">Google</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={clearOverrides} disabled={Object.keys(overrides).length === 0}>
          Reset classifications
        </Button>
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium">
            {filtered.length.toLocaleString()} of {all.length.toLocaleString()} recipients ·{" "}
            <span className="text-muted-foreground">
              {formatINR(totalPaid, true)} total paid · click a row for full analysis
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium"><SortBtn col="name" label="Recipient" /></th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium text-right"><SortBtn col="outflow" label="Paid" className="justify-end w-full" /></th>
                  <th className="px-3 py-2 font-medium text-right"><SortBtn col="inflow" label="Received" className="justify-end w-full" /></th>
                  <th className="px-3 py-2 font-medium text-right"><SortBtn col="count" label="Txs" className="justify-end w-full" /></th>
                  <th className="px-3 py-2 font-medium text-right"><SortBtn col="avg" label="Avg" className="justify-end w-full" /></th>
                  <th className="px-3 py-2 font-medium text-right"><SortBtn col="max" label="Max" className="justify-end w-full" /></th>
                  <th className="hidden px-3 py-2 font-medium text-center xl:table-cell" title="Last 6 months spend">6mo</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell"><SortBtn col="lastTs" label="Last seen" /></th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pinnedFirst.length === 0 && (
                  <tr>
                    <td colSpan={11} className="h-48 p-0">
                      <Empty>
                        <EmptyMedia><Users /></EmptyMedia>
                        <EmptyHeader>
                          <EmptyTitle>No recipients match</EmptyTitle>
                          <EmptyDescription>Try a different search or clear the type filter.</EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button variant="outline" size="sm" onClick={() => { setQ(""); setClassFilter("All") }}>
                            Clear filters
                          </Button>
                        </EmptyContent>
                      </Empty>
                    </td>
                  </tr>
                )}
                {pageRows.map((r, i) => (
                  <tr
                    key={r.nameKey}
                    className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50"
                    onClick={() => navigate(`/recipients?name=${encodeURIComponent(r.nameKey)}`)}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {pinned.includes(r.nameKey) ? <Pin className="size-3 text-primary" /> : safePage * PAGE_SIZE + i + 1}
                    </td>
                    <td className="max-w-56 px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{r.name}</span>
                        {r.override && <span className="text-[10px] text-primary">(override)</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <ClassBadge cls={r.cls} />
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" />}>
                            <ChevronRight />
                            <span className="sr-only">Change type</span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuLabel>Classify as</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {CLASS_OPTIONS.map((o) => (
                              <DropdownMenuItem key={o.value} onClick={() => setOverride(r.nameKey, o.value === "Auto" ? null : o.value)}>
                                {o.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatINR(r.outflow, true)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {r.inflow > 0 ? formatINR(r.inflow, true) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{r.count}</td>
                    <td className="hidden px-3 py-2 text-right text-muted-foreground tabular-nums sm:table-cell">
                      {formatINR(Math.round(r.avg), true)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{formatINR(r.max, true)}</td>
                    <td className="hidden px-3 py-2 xl:table-cell">
                      <div className="flex justify-center">
                        <Sparkline
                          data={sparkByKey.get(r.nameKey) ?? []}
                          width={72}
                          height={22}
                          stroke="var(--chart-1)"
                        />
                      </div>
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground tabular-nums md:table-cell">
                      {dateTimeLabel(
                        new Date(r.lastTs).getUTCFullYear(),
                        new Date(r.lastTs).getUTCMonth() + 1,
                        new Date(r.lastTs).getUTCDate(),
                        new Date(r.lastTs).getUTCHours(),
                        new Date(r.lastTs).getUTCMinutes()
                      ).split(",")[0]}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePin(r.nameKey)
                        }}
                        title={pinned.includes(r.nameKey) ? "Unpin" : "Pin to top"}
                      >
                        {pinned.includes(r.nameKey) ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {safePage + 1} of {pageCount.toLocaleString()} · {pinnedFirst.length.toLocaleString()} recipients
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft className="size-4" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) navigate("/recipients")
        }}
      >
        {selected && <RecipientDetail stat={selected} setOverride={setOverride} transactions={transactions} />}
      </Sheet>
    </div>
  )
}
