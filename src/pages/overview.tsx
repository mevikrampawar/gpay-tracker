import * as React from "react"
import {
  ArrowLeftRight,
  ReceiptText,
  Users,
  TrendingUp,
  ExternalLink,
  Sparkles,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
} from "recharts"
import { PageHeader } from "@/components/page-header"
import { KpiCard } from "@/components/kpi-card"
import { InsightsGrid } from "@/components/insight-card"
import { TypeBadge } from "@/components/transaction-badges"
import { useData } from "@/lib/data-context"
import {
  computeTotals,
  monthlySeries,
  buildRecipientStats,
} from "@/lib/analytics"
import { buildInsights, oldestMonthLabel, latestMonthLabel } from "@/lib/insights"
import { classifyName } from "@/lib/classify"
import { formatINR, formatINRFull, monthLabel, dateTimeLabel, weekdayName } from "@/lib/format"
import { useRecipientOverrides } from "@/lib/recipient-overrides"
import { navigate } from "@/lib/router"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Upload, ArrowRight } from "lucide-react"
import type { UpiTransaction } from "@/lib/data-context"

const CHART_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)", "var(--color-chart-6)", "var(--color-chart-7)"]

export function OverviewPage() {
  const { transactions, loading, pendingCorrelations } = useData()
  const { overrides } = useRecipientOverrides()
  const [detailTx, setDetailTx] = React.useState<UpiTransaction | null>(null)

  const totals = React.useMemo(() => computeTotals(transactions), [transactions])
  const monthly = React.useMemo(() => monthlySeries(transactions), [transactions])
  const recipients = React.useMemo(
    () => buildRecipientStats(transactions, overrides),
    [transactions, overrides]
  )

  const insights = React.useMemo(
    () => buildInsights(transactions, overrides),
    [transactions, overrides]
  )

  const monthlyChartData = React.useMemo(
    () =>
      monthly.map((m) => ({
        ...m,
        monthLabel: monthLabel(m.year, m.month),
        net: m.inflow - m.outflow - m.sent,
      })),
    [monthly]
  )

  const paidSpark = monthly.map((m) => m.outflow)
  const inflowSpark = monthly.map((m) => m.inflow)
  const netSpark = monthly.map((m) => m.inflow - m.outflow - m.sent)
  const countSpark = monthly.map((m) => m.count)

  const momDelta = React.useMemo(() => {
    if (monthly.length < 2) return undefined
    const a = monthly[monthly.length - 2]
    const b = monthly[monthly.length - 1]
    if (!a.outflow) return undefined
    return Math.round(((b.outflow - a.outflow) / a.outflow) * 100)
  }, [monthly])

  const recent = React.useMemo(
    () =>
      [...transactions]
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, 10),
    []
  )

  const outflowByClass = React.useMemo(() => {
    const acc: Record<string, number> = {}
    for (const t of transactions) {
      if (t.type !== "Paid" || !t.nameKey) continue
      const cls = overrides[t.nameKey] ?? classifyName(t.name, t.nameKey)
      acc[cls] = (acc[cls] ?? 0) + t.amount
    }
    const order = ["Merchant", "Person", "Platform", "Atm", "Google"]
    return order
      .map((k) => ({ name: k, value: Math.round(acc[k] ?? 0) }))
      .filter((d) => d.value > 0)
  }, [overrides])

  const outflowTotal = outflowByClass.reduce((s, d) => s + d.value, 0)

  const topRecipients = recipients.slice(0, 8)
  const unknownCount = transactions.filter((t) => t.name === null).length

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description={`${oldestMonthLabel(transactions)} – ${latestMonthLabel(transactions)} · complete visibility into your Google Pay activity`}
        icon={ReceiptText}
      />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Auto insights</h2>
            <span className="text-xs text-muted-foreground">calculated from {totals.count.toLocaleString()} transactions</span>
          </div>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => navigate("/analytics")}>
            Deep dive <ExternalLink />
          </Button>
        </div>
        <InsightsGrid insights={insights} limit={4} />
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-4">
        <a href="#/transactions" className="block">
          <KpiCard
            kpi={{
              label: "Total Paid",
              value: formatINR(totals.outflow),
              sub: `${totals.paidCount.toLocaleString()} transactions · avg ${formatINR(Math.round(totals.avgOutflow))}`,
              icon: TrendingUp,
              accent: "down",
              spark: paidSpark,
              sparkColor: "var(--chart-5)",
              delta: momDelta,
              deltaLabel: "Outflow change vs previous month",
            }}
          />
        </a>
        <a href="#/transactions" className="block">
          <KpiCard
            kpi={{
              label: "Total Received",
              value: formatINR(totals.inflow),
              sub: `${totals.receivedCount.toLocaleString()} transactions`,
              icon: ArrowLeftRight,
              accent: "up",
              spark: inflowSpark,
              sparkColor: "var(--chart-2)",
            }}
          />
        </a>
        <a href="#/transactions" className="block">
          <KpiCard
            kpi={{
              label: "Net Flow",
              value: formatINR(totals.net),
              sub: "Received minus paid & sent",
              icon: ArrowLeftRight,
              accent: totals.net >= 0 ? "up" : "down",
              spark: netSpark,
              sparkColor: totals.net >= 0 ? "var(--chart-2)" : "var(--chart-5)",
            }}
          />
        </a>
        <a href="#/transactions" className="block">
          <KpiCard
            kpi={{
              label: "Total Transfers",
              value: formatINR(totals.sent),
              sub: `${totals.sentCount.toLocaleString()} bank transfers`,
              icon: ArrowLeftRight,
              accent: "neutral",
            }}
          />
        </a>
        <a href="#/transactions" className="block">
          <KpiCard
            kpi={{
              label: "Transactions",
              value: totals.count.toLocaleString(),
              sub: `since ${oldestMonthLabel(transactions)}`,
              icon: ReceiptText,
              accent: "neutral",
              spark: countSpark,
              sparkColor: "var(--chart-1)",
            }}
          />
        </a>
        <a href="#/recipients" className="block">
          <KpiCard
            kpi={{
              label: "Unique Recipients",
              value: totals.uniqueCounterparties.toLocaleString(),
              sub: `${totals.uniqueMerchants.toLocaleString()} merchants`,
              icon: Users,
              accent: "neutral",
            }}
          />
        </a>
      </div>

      {unknownCount > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Unknown Transactions</p>
                <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">{unknownCount}</p>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {pendingCorrelations} pending reviews
                </p>
              </div>
              <a href="#/ai" className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700">
                Review &rarr;
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly Cash Flow</CardTitle>
            <CardDescription>
              Paid, received and bank transfers per month
            </CardDescription>
          </CardHeader>
          <CardContent>
            {monthlyChartData.length === 0 ? (
              <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                No data available
              </div>
            ) : (
            <ChartContainer
              config={{
                outflow: { label: "Paid", color: "var(--chart-5)" },
                inflow: { label: "Received", color: "var(--chart-2)" },
                sent: { label: "Sent", color: "var(--chart-3)" },
                net: { label: "Net", color: "var(--chart-1)" },
              }}
              className="h-72"
            >
              <ResponsiveContainer>
                <AreaChart data={monthlyChartData}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => formatINR(Number(v), true)} width={56} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent formatter={(v) => formatINR(Number(v))} />}
                  />
                  <Area dataKey="outflow" name="Paid" type="monotone" fill="var(--color-outflow)" fillOpacity={0.18} stroke="var(--color-outflow)" stackId="1" />
                  <Area dataKey="inflow" name="Received" type="monotone" fill="var(--color-inflow)" fillOpacity={0.18} stroke="var(--color-inflow)" stackId="2" />
                  <Area dataKey="sent" name="Sent" type="monotone" fill="var(--color-sent)" fillOpacity={0.18} stroke="var(--color-sent)" stackId="3" />
                  <Area dataKey="net" name="Net" type="monotone" fill="transparent" stroke="var(--color-net)" strokeWidth={1.5} strokeDasharray="4 3" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where money goes</CardTitle>
            <CardDescription>Paid amount by entity type</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <div className="relative h-48 w-full">
              <ChartContainer config={{}} className="h-full w-full">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={outflowByClass}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={82}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {outflowByClass.map((entry, i) => (
                        <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip
                      content={<ChartTooltipContent formatter={(v, name) => [`${formatINR(Number(v))} (${name})`, "Outflow"]} />}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </ChartContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs text-muted-foreground">Total paid</span>
                <span className="text-xl font-semibold tabular-nums">{formatINR(outflowTotal, true)}</span>
              </div>
            </div>
            <div className="grid w-full grid-cols-2 gap-2">
              {outflowByClass.map((d, i) => {
                const pct = outflowTotal ? Math.round((d.value / outflowTotal) * 100) : 0
                return (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="flex-1 truncate text-muted-foreground">{d.name}</span>
                    <span className="font-medium tabular-nums">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Top Recipients</CardTitle>
              <CardDescription>By total amount paid</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/recipients")}>
              View all <ExternalLink />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {topRecipients.map((r, i) => {
              const pct = totals.outflow ? (r.outflow / totals.outflow) * 100 : 0
              return (
                <button
                  key={r.nameKey}
                  onClick={() => navigate(`/recipients?name=${encodeURIComponent(r.nameKey)}`)}
                  className="group flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="w-5 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <span className="w-8 truncate text-xs text-muted-foreground">{r.cls}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/70 transition-all group-hover:bg-primary"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{formatINR(r.outflow, true)}</span>
                  <span className="hidden w-16 text-right text-xs text-muted-foreground tabular-nums sm:block">
                    {r.count} tx
                  </span>
                </button>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest 10 transactions</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/transactions")}>
            All transactions <ExternalLink />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {recent.map((t) => (
            <button
              key={t.id}
              onClick={() => setDetailTx(t)}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
            >
              <TypeBadge type={t.type} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.name ?? (t.type === "Sent" ? "Bank transfer" : "—")}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {dateTimeLabel(t.year, t.month, t.day, t.hour, t.minute)} · {t.method ?? "—"}
                </div>
              </div>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  t.type === "Received" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
                )}
              >
                {t.type === "Received" ? "+" : "−"}{formatINR(t.amount)}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!detailTx} onOpenChange={(o) => { if (!o) setDetailTx(null) }}>
        {detailTx && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TypeBadge type={detailTx.type} />
                {detailTx.name ?? (detailTx.type === "Sent" ? "Bank transfer" : "Unnamed")}
              </DialogTitle>
              <DialogDescription>
                {dateTimeLabel(detailTx.year, detailTx.month, detailTx.day, detailTx.hour, detailTx.minute)} · {weekdayName(detailTx.weekday)}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 text-sm">
              <div className="flex items-baseline justify-between rounded-lg border bg-muted/40 p-4">
                <span className="text-muted-foreground">Amount</span>
                <span
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    detailTx.type === "Received" ? "text-emerald-600 dark:text-emerald-400" : ""
                  )}
                >
                  {detailTx.type === "Received" ? "+" : "−"}{formatINRFull(detailTx.amount)}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Type</dt>
                  <dd className="font-medium">{detailTx.type}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Status</dt>
                  <dd className="font-medium">{detailTx.status ?? "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Payment method</dt>
                  <dd className="font-medium">{detailTx.method ?? "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Reference</dt>
                  <dd className="break-all font-mono text-xs">{detailTx.id}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Description</dt>
                  <dd>{detailTx.note}</dd>
                </div>
              </dl>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
