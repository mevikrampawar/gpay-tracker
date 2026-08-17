import * as React from "react"
import { ReceiptText, Search, Filter, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Users, X, Upload, ArrowRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ExportButton } from "@/components/export-button"
import { TypeBadge } from "@/components/transaction-badges"
import { useData } from "@/lib/data-context"
import type { UpiTransaction } from "@/data/bundle"
import { formatINR, formatINRFull, dateTimeLabel, weekdayName, isWithinPeriod } from "@/lib/format"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

type SortKey = "ts" | "amount" | "name"
type SortDir = "asc" | "desc"

interface Filters {
  q: string
  type: "All" | "Paid" | "Received" | "Sent"
  range: "all" | "30d" | "90d" | "1y" | "ytd"
  method: "All" | string
  min: string
  max: string
}

const DEFAULT_FILTERS: Filters = {
  q: "",
  type: "All",
  range: "all",
  method: "All",
  min: "",
  max: "",
}

const PAGE_SIZES = [25, 50, 100, 250]

function methodsList(transactions: UpiTransaction[]): string[] {
  const s = new Set<string>()
  for (const t of transactions) {
    if (t.method) s.add(t.method)
    else s.add("(no method)")
  }
  return [...s].sort()
}

function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[₹,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function filterTransactions(tx: UpiTransaction[], f: Filters): UpiTransaction[] {
  const q = normalizeSearch(f.q)
  return tx.filter((t) => {
    if (f.type !== "All" && t.type !== f.type) return false
    if (f.range === "30d" && !isWithinPeriod(t.ts, 30)) return false
    if (f.range === "90d" && !isWithinPeriod(t.ts, 90)) return false
    if (f.range === "1y" && !isWithinPeriod(t.ts, 365)) return false
    if (f.range === "ytd") {
      const now = new Date()
      const tDate = new Date(t.ts)
      const start = new Date(now.getFullYear(), 0, 1)
      if (tDate < start) return false
    }
    if (f.method !== "All") {
      const m = t.method ?? "(no method)"
      if (m !== f.method) return false
    }
    if (f.min !== "") {
      const min = parseFloat(f.min)
      if (!isNaN(min) && t.amount < min) return false
    }
    if (f.max !== "") {
      const max = parseFloat(f.max)
      if (!isNaN(max) && t.amount > max) return false
    }
    if (q) {
      const hay = normalizeSearch(
        `${t.name ?? ""} ${t.note} ${t.method ?? ""} ${t.id} ${t.amount.toLocaleString("en-IN")} ${t.amount}`
      )
      if (!hay.includes(q)) return false
    }
    return true
  })
}

function sortTransactions(tx: UpiTransaction[], key: SortKey, dir: SortDir): UpiTransaction[] {
  const mult = dir === "asc" ? 1 : -1
  return [...tx].sort((a, b) => {
    if (key === "ts") return mult * a.ts.localeCompare(b.ts)
    if (key === "amount") return mult * (a.amount - b.amount)
    const na = a.name ?? "zzz"
    const nb = b.name ?? "zzz"
    return mult * na.localeCompare(nb)
  })
}

function TransactionDetail({ t }: { t: UpiTransaction }) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <TypeBadge type={t.type} />
          {t.name ?? (t.type === "Sent" ? "Bank transfer" : "Unnamed")}
        </DialogTitle>
        <DialogDescription>
          {dateTimeLabel(t.year, t.month, t.day, t.hour, t.minute)} · {weekdayName(t.weekday)}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 text-sm">
        <div className="flex items-baseline justify-between rounded-lg border bg-muted/40 p-4">
          <span className="text-muted-foreground">Amount</span>
          <span
            className={cn(
              "text-2xl font-semibold tabular-nums",
              t.type === "Received" ? "text-emerald-600 dark:text-emerald-400" : ""
            )}
          >
            {t.type === "Received" ? "+" : "−"}{formatINRFull(t.amount)}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <dt className="text-xs text-muted-foreground">Type</dt>
            <dd className="font-medium">{t.type}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="font-medium">{t.status ?? "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Payment method</dt>
            <dd className="font-medium">{t.method ?? "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Reference</dt>
            <dd className="break-all font-mono text-xs">{t.id}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Description</dt>
            <dd>{t.note}</dd>
          </div>
        </dl>
      </div>
    </DialogContent>
  )
}

export function TransactionsPage() {
  const { transactions, loading } = useData()
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS)
  const [sortKey, setSortKey] = React.useState<SortKey>("ts")
  const [sortDir, setSortDir] = React.useState<SortDir>("desc")
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)
  const [selected, setSelected] = React.useState<UpiTransaction | null>(null)

  const methods = React.useMemo(() => methodsList(transactions), [transactions])

  const filtered = React.useMemo(() => {
    const f = filterTransactions(transactions, filters)
    return sortTransactions(f, sortKey, sortDir)
  }, [transactions, filters, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)

  React.useEffect(() => {
    setPage(0)
  }, [filters, sortKey, sortDir, pageSize])

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((p) => ({ ...p, [key]: value }))

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir(key === "name" ? "asc" : "desc")
    }
  }

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (col !== sortKey) return <ArrowUpDown className="size-3 text-muted-foreground" />
    return sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
  }

  const totals = React.useMemo(() => {
    const t = { Paid: 0, Received: 0, Sent: 0, count: 0 }
    for (const x of filtered) {
      t[x.type] += x.amount
      t.count++
    }
    return t
  }, [filtered])

  const activeFilterCount = React.useMemo(
    () =>
      (filters.q.trim() !== "" ? 1 : 0) +
      (filters.type !== "All" ? 1 : 0) +
      (filters.range !== "all" ? 1 : 0) +
      (filters.method !== "All" ? 1 : 0) +
      (filters.min !== "" ? 1 : 0) +
      (filters.max !== "" ? 1 : 0),
    [filters]
  )

  const exportRows = React.useMemo(
    () =>
      filtered.map((t) => ({
        Date: dateTimeLabel(t.year, t.month, t.day, t.hour, t.minute),
        Type: t.type,
        Amount: t.amount,
        Recipient: t.name ?? "",
        Method: t.method ?? "",
        Status: t.status ?? "",
        Reference: t.id,
        Description: t.note,
      })),
    [filtered]
  )

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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Transactions"
        description={`${transactions.length.toLocaleString()} UPI transactions · search, filter, sort and export`}
        icon={ReceiptText}
      >
        <ExportButton
          filename="gpay-transactions"
          rows={exportRows}
          jsonData={filtered}
          columns={[
            { header: "Date", value: (r) => String(r.Date) },
            { header: "Type", value: (r) => String(r.Type) },
            { header: "Amount", value: (r) => Number(r.Amount) },
            { header: "Recipient", value: (r) => String(r.Recipient) },
            { header: "Method", value: (r) => String(r.Method) },
            { header: "Status", value: (r) => String(r.Status) },
            { header: "Reference", value: (r) => String(r.Reference) },
            { header: "Description", value: (r) => String(r.Description) },
          ]}
          label={filtered.length === transactions.length ? "Export all" : `Export ${filtered.length.toLocaleString()}`}
        />
      </PageHeader>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["All", "Paid", "Received", "Sent"] as const).map((t) => {
            const active = filters.type === t
            return (
              <button
                key={t}
                onClick={() => setFilter("type", t)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                )}
              >
                {t === "All" ? "All types" : t}
                <span className={cn("ml-1.5 tabular-nums", active ? "text-primary-foreground/70" : "text-muted-foreground/60")}>
                  {t === "All"
                    ? transactions.length.toLocaleString()
                    : transactions.filter((x) => x.type === t).length.toLocaleString()}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search recipient, description, reference…"
              value={filters.q}
              onChange={(e) => setFilter("q", e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filters.type} onValueChange={(v) => setFilter("type", v as Filters["type"])}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(["All", "Paid", "Received", "Sent"] as const).map((t) => (
                    <SelectItem key={t} value={t}>{t === "All" ? "All types" : t}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={filters.range} onValueChange={(v) => setFilter("range", v as Filters["range"])}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="1y">Last 12 months</SelectItem>
                  <SelectItem value="ytd">Year to date</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={filters.method} onValueChange={(v) => setFilter("method", v ?? "All")}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="All">All methods</SelectItem>
                  {methods.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <Input
            className="w-28"
            type="number"
            placeholder="Min ₹"
            value={filters.min}
            onChange={(e) => setFilter("min", e.target.value)}
          />
          <Input
            className="w-28"
            type="number"
            placeholder="Max ₹"
            value={filters.max}
            onChange={(e) => setFilter("max", e.target.value)}
          />
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span><span className="font-semibold text-foreground">{totals.count.toLocaleString()}</span> shown</span>
            <span>Paid <span className="font-semibold text-foreground tabular-nums">{formatINR(totals.Paid, true)}</span></span>
            <span>Received <span className="font-semibold text-foreground tabular-nums">{formatINR(totals.Received, true)}</span></span>
            <span>Sent <span className="font-semibold text-foreground tabular-nums">{formatINR(totals.Sent, true)}</span></span>
          </div>
        </div>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-7 w-fit gap-1 px-1 text-xs text-muted-foreground" onClick={() => setFilters(DEFAULT_FILTERS)}>
            <X /> Clear all filters ({activeFilterCount})
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-sm font-medium">
            {filtered.length.toLocaleString()} transactions
            {Object.values(filters).some((v) => v !== "" && v !== "All") && " · filtered"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("ts")}>
                  <span className="flex items-center gap-1">Date <SortIcon col="ts" /></span>
                </TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">Recipient <SortIcon col="name" /></span>
                </TableHead>
                <TableHead className="hidden md:table-cell">Method</TableHead>
                <TableHead className="cursor-pointer select-none text-right" onClick={() => toggleSort("amount")}>
                  <span className="flex items-center justify-end gap-1">Amount <SortIcon col="amount" /></span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 p-0">
                    <Empty>
                      <EmptyMedia>
                        <ReceiptText />
                      </EmptyMedia>
                      <EmptyHeader>
                        <EmptyTitle>No transactions found</EmptyTitle>
                        <EmptyDescription>
                          Adjust your filters or search to see more results.
                        </EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <Button variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
                          Clear filters
                        </Button>
                      </EmptyContent>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {pageRows.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(t)}
                >
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {dateTimeLabel(t.year, t.month, t.day, t.hour, t.minute)}
                  </TableCell>
                  <TableCell><TypeBadge type={t.type} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="font-medium">{t.name ?? (t.type === "Sent" ? "Bank transfer" : "—")}</div>
                        {t.note !== t.name && (
                          <div className="truncate text-xs text-muted-foreground">{t.note}</div>
                        )}
                      </div>
                      {t.nameKey && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          title="Open recipient profile"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (t.nameKey) navigate(`/recipients?name=${encodeURIComponent(t.nameKey)}`)
                          }}
                        >
                          <Users className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {t.method ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        t.type === "Received" ? "text-emerald-600 dark:text-emerald-400" : ""
                      )}
                    >
                      {t.type === "Received" ? "+" : "−"}{formatINR(t.amount)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows per page</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {filtered.length === 0 ? "0" : (safePage * pageSize + 1).toLocaleString()}–
            {Math.min((safePage + 1) * pageSize, filtered.length).toLocaleString()} of{" "}
            {filtered.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft />
            </Button>
            <Badge variant="secondary" className="min-w-12 justify-center">
              {safePage + 1} / {pageCount}
            </Badge>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        {selected && <TransactionDetail t={selected} />}
      </Dialog>
    </div>
  )
}
