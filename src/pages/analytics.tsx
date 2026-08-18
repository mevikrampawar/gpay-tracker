import * as React from "react"
import { BarChart3, Flame, Download, Clock, CalendarDays, Upload, ArrowRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts"
import { useData } from "@/lib/data-context"
import {
  computeTotals,
  monthlySeries,
  yearlySeries,
  breakdownBy,
  hourWeekdayHeatmap,
  amountHistogram,
  percentile,
  recurringRecipients,
} from "@/lib/analytics"
import { formatINR, monthLabel, weekdayShort, weekdayName, dateTimeLabel } from "@/lib/format"
import { useRecipientOverrides } from "@/lib/recipient-overrides"
import { classifyName } from "@/lib/classify"
import { downloadCSV } from "@/lib/export-utils"
import { navigate } from "@/lib/router"

function bucketLabel(b: { min: number; max: number }): string {
  if (b.max === Infinity) return `₹${b.min}+`
  if (b.min === 0) return `≤ ₹${b.max}`
  return `₹${b.min}–${b.max}`
}

export function AnalyticsPage() {
  const { transactions, loading } = useData()
  const { overrides } = useRecipientOverrides()
  const [view, setView] = React.useState<"monthly" | "yearly" | "cumulative">("monthly")
  const [distributionType, setDistributionType] = React.useState<"Paid" | "Received" | "Sent">("Paid")

  const totals = React.useMemo(() => computeTotals(transactions), [transactions])
  const monthly = React.useMemo(() => monthlySeries(transactions), [transactions])
  const yearly = React.useMemo(() => yearlySeries(transactions), [transactions])

  const trendData = React.useMemo(() => {
    if (view === "yearly") {
      return yearly.map((y) => ({ label: String(y.year), Paid: y.outflow, Received: y.inflow, Sent: y.sent, Net: y.inflow - y.outflow - y.sent }))
    }
    if (view === "cumulative") {
      let o = 0, i = 0, s = 0
      return monthly.map((m) => {
        o += m.outflow
        i += m.inflow
        s += m.sent
        return { label: monthLabel(m.year, m.month), Paid: o, Received: i, Sent: s, Net: i - o - s }
      })
    }
    return monthly.map((m) => ({
      label: monthLabel(m.year, m.month),
      Paid: m.outflow,
      Received: m.inflow,
      Sent: m.sent,
      Net: m.inflow - m.outflow - m.sent,
    }))
  }, [view, monthly, yearly])

  const methods = React.useMemo(() => breakdownBy(transactions, "method").slice(0, 12), [transactions])
  const methodChartData = methods.map((m) => ({ name: m.key, value: m.value, count: m.count }))

  const classBreakdown = React.useMemo(() => {
    const acc: Record<string, { value: number; count: number }> = {}
    for (const t of transactions) {
      if (t.type !== "Paid" || !t.nameKey) continue
      const cls = overrides[t.nameKey] ?? classifyName(t.name, t.nameKey)
      const c = acc[cls] ?? { value: 0, count: 0 }
      c.value += t.amount
      c.count++
      acc[cls] = c
    }
    return Object.entries(acc)
      .map(([name, v]) => ({ name, value: v.value, count: v.count }))
      .sort((a, b) => b.value - a.value)
  }, [overrides])

  const heat = React.useMemo(() => hourWeekdayHeatmap(transactions), [transactions])
  const maxHeat = React.useMemo(() => Math.max(1, ...heat.map((h) => h.value)), [heat])

  const weekdayData = React.useMemo(() => {
    const acc: Record<number, { count: number; value: number }> = {}
    for (const t of transactions) {
      if (t.type !== "Paid") continue
      const c = acc[t.weekday] ?? { count: 0, value: 0 }
      c.count++
      c.value += t.amount
      acc[t.weekday] = c
    }
    return [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      label: weekdayShort(d),
      count: acc[d]?.count ?? 0,
      value: acc[d]?.value ?? 0,
    }))
  }, [transactions])

  const hourData = React.useMemo(() => {
    const acc: Record<number, { count: number; value: number }> = {}
    for (const t of transactions) {
      if (t.type !== "Paid") continue
      const c = acc[t.hour] ?? { count: 0, value: 0 }
      c.count++
      c.value += t.amount
      acc[t.hour] = c
    }
    return Array.from({ length: 24 }, (_, h) => ({
      label: `${h}:00`,
      count: acc[h]?.count ?? 0,
      value: acc[h]?.value ?? 0,
    }))
  }, [transactions])

  const histogram = React.useMemo(() => amountHistogram(transactions, distributionType), [transactions, distributionType])
  const histData = histogram.map((b) => ({ label: bucketLabel(b), count: b.count, value: b.value }))

  const big = React.useMemo(
    () =>
      transactions
        .filter((t) => t.type === "Paid")
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 15),
    [transactions]
  )
  const bigReceived = React.useMemo(
    () =>
      transactions
        .filter((t) => t.type === "Received")
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
    [transactions]
  )

  const recurring = React.useMemo(() => recurringRecipients(transactions).slice(0, 15), [transactions])

  const peakHour = React.useMemo(() => {
    const acc = new Map<number, number>()
    for (const t of transactions) {
      if (t.type !== "Paid") continue
      acc.set(t.hour, (acc.get(t.hour) ?? 0) + 1)
    }
    return [...acc.entries()].sort((a, b) => b[1] - a[1])[0]
  }, [transactions])

  const peakWeekday = React.useMemo(() => {
    const acc = new Map<number, number>()
    for (const t of transactions) {
      if (t.type !== "Paid") continue
      acc.set(t.weekday, (acc.get(t.weekday) ?? 0) + 1)
    }
    return [...acc.entries()].sort((a, b) => b[1] - a[1])[0]
  }, [transactions])

  const p50 = percentile(transactions, 50)
  const p90 = percentile(transactions, 90)
  const p99 = percentile(transactions, 99)

  const heatDownload = () =>
    downloadCSV(
      "gpay-hour-heatmap.csv",
      ["Weekday", "Hour", "Amount", "Transactions"],
      heat.map((h) => [weekdayName(h.weekday), `${h.hour}:00`, h.value, h.count])
    )

  const COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"]

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
        title="Analytics"
        description="Deep-dive trends, distributions and behavioural patterns"
        icon={BarChart3}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">Median payment</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{formatINR(p50)}</CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">90th percentile</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{formatINR(p90)}</CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">99th percentile</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{formatINR(p99)}</CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">Biggest single payment</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{formatINR(totals.maxOutflow)}</CardContent></Card>
      </div>

      <Tabs defaultValue="trends">
        <TabsList className="overflow-x-auto flex-nowrap">
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="methods">Methods & types</TabsTrigger>
          <TabsTrigger value="when">When you spend</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Cash flow over time</CardTitle>
                <CardDescription>Monthly, yearly or cumulative</CardDescription>
              </div>
              <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
                <TabsList className="overflow-x-auto flex-nowrap">
                  <TabsTrigger value="monthly">Monthly</TabsTrigger>
                  <TabsTrigger value="yearly">Yearly</TabsTrigger>
                  <TabsTrigger value="cumulative">Cumulative</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  Paid: { label: "Paid", color: "var(--chart-5)" },
                  Received: { label: "Received", color: "var(--chart-2)" },
                  Sent: { label: "Sent", color: "var(--chart-3)" },
                  Net: { label: "Net", color: "var(--chart-1)" },
                }}
                className="h-80"
              >
                <ResponsiveContainer>
                  <ComposedChart data={trendData}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => formatINR(Number(v), true)} width={56} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(v) => formatINR(Number(v))} />} />
                    <Bar dataKey="Paid" name="Paid" fill="var(--color-Paid)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Received" name="Received" fill="var(--color-Received)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Sent" name="Sent" fill="var(--color-Sent)" radius={[3, 3, 0, 0]} />
                    <Line dataKey="Net" name="Net" type="monotone" stroke="var(--color-Net)" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="size-4 text-muted-foreground" /> Recurring recipients
              </CardTitle>
              <CardDescription>Counterparties you pay in 2+ distinct months — potential subscriptions or bills</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {recurring.map((r, i) => (
                  <button
                    key={r.nameKey}
                    onClick={() => navigate(`/recipients?name=${encodeURIComponent(r.nameKey)}`)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <span className="w-5 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.count} payments</div>
                    </div>
                    <Badge variant="secondary">{r.outflow >= 1000 ? formatINR(r.outflow, true) : formatINR(r.outflow)}</Badge>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="methods" className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Payment methods</CardTitle>
                <CardDescription>Total paid per account</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{ value: { label: "Paid", color: "var(--chart-1)" }, count: { label: "Txs", color: "var(--chart-2)" } }}
                  className="h-72"
                >
                  <ResponsiveContainer>
                    <BarChart data={methodChartData} layout="vertical">
                      <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => formatINR(Number(v), true)} />
                      <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={120} tick={{ fontSize: 11 }} />
                      <ChartTooltip cursor={{ fill: "var(--color-muted)", opacity: 0.3 }} content={<ChartTooltipContent formatter={(v) => formatINR(Number(v))} />} />
                      <Bar dataKey="value" name="value" fill="var(--color-value)" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Entity type split</CardTitle>
                <CardDescription>Paid amount by classification</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3">
                <ChartContainer config={{}} className="h-56 w-full">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={classBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2} strokeWidth={0}>
                        {classBreakdown.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatINR(Number(v))} />} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <div className="grid w-full grid-cols-2 gap-2">
                  {classBreakdown.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="flex-1 truncate text-muted-foreground">{d.name}</span>
                      <span className="font-medium tabular-nums">{formatINR(d.value, true)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Methods detail</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {methods.map((m) => (
                  <div key={m.key} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <div className="flex-1 font-medium">{m.key}</div>
                    <span className="text-muted-foreground tabular-nums">{m.count} txs</span>
                    <Badge variant="secondary">{formatINR(m.value)}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="when" className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {peakHour && (
              <Card className="flex items-center gap-3 p-4">
                <div className="flex size-9 items-center justify-center rounded-lg bg-chart-3/15 text-chart-3">
                  <Clock className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Peak payment hour</div>
                  <div className="text-xs text-muted-foreground">
                    {(() => { const h = peakHour[0]; const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}:00 ${h >= 12 ? "PM" : "AM"} · ${peakHour[1]} payments` })()}
                  </div>
                </div>
              </Card>
            )}
            {peakWeekday && (
              <Card className="flex items-center gap-3 p-4">
                <div className="flex size-9 items-center justify-center rounded-lg bg-chart-2/15 text-chart-2">
                  <CalendarDays className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Busiest day of week</div>
                  <div className="text-xs text-muted-foreground">
                    {weekdayName(peakWeekday[0])}s · {peakWeekday[1]} payments
                  </div>
                </div>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Activity heatmap</CardTitle>
                <CardDescription>Payments by hour of day × day of week (darker = more money)</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={heatDownload}>
                <Download data-icon="inline-start" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="grid min-w-[720px]" style={{ gridTemplateColumns: "auto repeat(24, 1fr)" }}>
                  <div className="h-6" />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="flex items-end justify-center pb-1 text-[10px] text-muted-foreground">
                      {h % 3 === 0 ? `${h}h` : ""}
                    </div>
                  ))}
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                    <React.Fragment key={d}>
                      <div className="flex h-8 items-center pr-2 text-xs text-muted-foreground">{weekdayShort(d)}</div>
                      {Array.from({ length: 24 }, (_, h) => {
                        const cell = heat.find((x) => x.weekday === d && x.hour === h)
                        const intensity = cell ? Math.sqrt(cell.value / maxHeat) : 0
                        return (
                          <div
                            key={h}
                            className="m-0.5 rounded"
                            style={{
                              background: cell
                                ? `color-mix(in oklab, var(--color-chart-1) ${(intensity * 100).toFixed(0)}%, transparent)`
                                : "var(--color-muted)",
                              opacity: cell ? 1 : 0.35,
                            }}
                            title={cell ? `${weekdayName(d)} ${h}:00 — ${formatINR(cell.value)} (${cell.count} txs)` : ""}
                          />
                        )
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
                <span>Less</span>
                <div className="flex gap-0.5">
                  {[0.15, 0.35, 0.55, 0.75, 1].map((o) => (
                    <span
                      key={o}
                      className="size-3 rounded-sm"
                      style={{ background: `color-mix(in oklab, var(--color-chart-1) ${o * 100}%, transparent)` }}
                    />
                  ))}
                </div>
                <span>More</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By day of week</CardTitle>
                <CardDescription>Payments and amounts</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={{ count: { label: "Transactions", color: "var(--chart-1)" } }} className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={weekdayData}>
                      <XAxis dataKey="label" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} width={32} />
                      <ChartTooltip cursor={{ fill: "var(--color-muted)", opacity: 0.3 }} content={<ChartTooltipContent />} />
                      <Bar dataKey="count" name="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>By hour of day</CardTitle>
                <CardDescription>When payments happen</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={{ count: { label: "Transactions", color: "var(--color-chart-2)" } }} className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={hourData}>
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} interval={2} />
                      <YAxis tickLine={false} axisLine={false} width={32} />
                      <ChartTooltip cursor={{ fill: "var(--color-muted)", opacity: 0.3 }} content={<ChartTooltipContent />} />
                      <Bar dataKey="count" name="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="distribution" className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Amount distribution</CardTitle>
                <CardDescription>How many transactions fall in each amount band</CardDescription>
              </div>
              <Tabs value={distributionType} onValueChange={(v) => setDistributionType(v as typeof distributionType)}>
                <TabsList className="overflow-x-auto flex-nowrap">
                  <TabsTrigger value="Paid">Paid</TabsTrigger>
                  <TabsTrigger value="Received">Received</TabsTrigger>
                  <TabsTrigger value="Sent">Sent</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              <ChartContainer config={{ count: { label: "Transactions", color: "var(--color-chart-1)" } }} className="h-64">
                <ResponsiveContainer>
                  <BarChart data={histData}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} width={40} />
                    <ChartTooltip cursor={{ fill: "var(--color-muted)", opacity: 0.3 }} content={<ChartTooltipContent />} />
                    <Bar dataKey="count" name="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Biggest payments</CardTitle>
                <CardDescription>Largest 15 outflows</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {big.map((t, i) => (
                    <button
                      key={t.id}
                      onClick={() => navigate(t.nameKey ? `/recipients?name=${encodeURIComponent(t.nameKey)}` : "/transactions")}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <span className="w-5 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{t.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {dateTimeLabel(t.year, t.month, t.day, t.hour, t.minute)}
                        </div>
                      </div>
                      <span className="font-semibold tabular-nums">{formatINR(t.amount)}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Biggest receipts</CardTitle>
                <CardDescription>Largest 10 inflows</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {bigReceived.map((t, i) => (
                    <button
                      key={t.id}
                      onClick={() => navigate(t.nameKey ? `/recipients?name=${encodeURIComponent(t.nameKey)}` : "/transactions")}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <span className="w-5 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{t.name ?? "Anonymous"}</div>
                        <div className="text-xs text-muted-foreground">
                          {dateTimeLabel(t.year, t.month, t.day, t.hour, t.minute)}
                        </div>
                      </div>
                      <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatINR(t.amount)}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
