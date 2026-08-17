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
import { formatINR, monthLabel, dateTimeLabel } from "@/lib/format"
import { useRecipientOverrides } from "@/lib/recipient-overrides"
import { navigate } from "@/lib/router"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Upload, ArrowRight } from "lucide-react"

const CHART_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)", "var(--color-chart-6)", "var(--color-chart-7)"]

export function OverviewPage() {
  const { transactions, loading } = useData()
  const { overrides } = useRecipientOverrides()

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
        <KpiCard
          kpi={{
            label: "Total Transfers",
            value: formatINR(totals.sent),
            sub: `${totals.sentCount.toLocaleString()} bank transfers`,
            icon: ArrowLeftRight,
            accent: "neutral",
          }}
        />
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
        <KpiCard
          kpi={{
            label: "Unique Recipients",
            value: totals.uniqueCounterparties.toLocaleString(),
            sub: `${totals.uniqueMerchants.toLocaleString()} merchants`,
            icon: Users,
            accent: "neutral",
          }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly Cash Flow</CardTitle>
            <CardDescription>
              Paid, received and bank transfers per month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                a: { label: "Paid", color: "var(--chart-5)" },
                b: { label: "Received", color: "var(--chart-2)" },
                c: { label: "Sent", color: "var(--chart-3)" },
                n: { label: "Net", color: "var(--chart-1)" },
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
                  <Area dataKey="a" name="Paid" type="monotone" fill="var(--color-a)" fillOpacity={0.18} stroke="var(--color-a)" stackId="1" />
                  <Area dataKey="b" name="Received" type="monotone" fill="var(--color-b)" fillOpacity={0.18} stroke="var(--color-b)" stackId="2" />
                  <Area dataKey="c" name="Sent" type="monotone" fill="var(--color-c)" fillOpacity={0.18} stroke="var(--color-c)" stackId="3" />
                  <Area dataKey="n" name="Net" type="monotone" fill="transparent" stroke="var(--color-n)" strokeWidth={1.5} strokeDasharray="4 3" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
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
              onClick={() => navigate("/transactions")}
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
    </div>
  )
}
