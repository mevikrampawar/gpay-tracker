import * as React from "react"
import { Gift, Ticket, BadgeCheck, CircleDollarSign, Clock3, Upload, ArrowRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ExportButton } from "@/components/export-button"
import { useData } from "@/lib/data-context"
import { formatINR, monthLabel, dateTimeLabel } from "@/lib/format"
import { Bar, BarChart, XAxis, YAxis, ResponsiveContainer } from "recharts"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { navigate } from "@/lib/router"

export function RewardsPage() {
  const { cashback, vouchers, loading } = useData()

  if (!loading && cashback.length === 0 && vouchers.length === 0) {
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

  const total = cashback.reduce((s, c) => s + c.amount, 0)
  const avg = total / Math.max(1, cashback.length)

  const byMonth = React.useMemo(() => {
    const acc = new Map<string, { label: string; value: number; count: number }>()
    for (const c of cashback) {
      const key = `${c.year}-${String(c.month).padStart(2, "0")}`
      const cur = acc.get(key) ?? { label: monthLabel(c.year, c.month), value: 0, count: 0 }
      cur.value += c.amount
      cur.count++
      acc.set(key, cur)
    }
    return [...acc.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [cashback])

  const now = Date.now()
  const vouchersWithStatus = vouchers.map((v) => {
    const exp = v.expiryTimestamp ? new Date(v.expiryTimestamp).getTime() : null
    const expired = exp !== null && exp < now
    const expiringSoon = exp !== null && !expired && exp - now < 30 * 86400000
    return { ...v, exp, expired, expiringSoon }
  })

  const activeCount = vouchersWithStatus.filter((v) => !v.expired).length
  const expiredCount = vouchersWithStatus.filter((v) => v.expired).length
  const expiringSoonCount = vouchersWithStatus.filter((v) => v.expiringSoon).length
  const biggestVoucher = vouchersWithStatus.reduce((s, v) => {
    const n = v.details.match(/₹\s?([\d,.]+)/)?.[1]
    return n ? Math.max(s, parseFloat(n.replace(/,/g, ""))) : s
  }, 0)

  const [voucherFilter, setVoucherFilter] = React.useState<"all" | "active" | "expiring" | "expired">("all")

  const filteredVouchers = vouchersWithStatus.filter((v) => {
    if (voucherFilter === "active") return !v.expired && !v.expiringSoon
    if (voucherFilter === "expiring") return v.expiringSoon
    if (voucherFilter === "expired") return v.expired
    return true
  })

  const VOUCHER_TABS: { key: typeof voucherFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: vouchers.length },
    { key: "active", label: "Active", count: activeCount - expiringSoonCount },
    { key: "expiring", label: "Expiring soon", count: expiringSoonCount },
    { key: "expired", label: "Expired", count: expiredCount },
  ]

  const cashbackExport = cashback.map((c) => ({
    Date: dateTimeLabel(c.year, c.month, new Date(c.ts).getUTCDate(), 0, 0),
    Amount: c.amount,
    Currency: c.currency,
    Description: c.description ?? "",
  }))

  const voucherExport = filteredVouchers.map((v) => ({
    Code: v.code,
    Summary: v.summary,
    Details: v.details,
    Expiry: v.expiryTimestamp ?? "",
    Status: v.expired ? "Expired" : v.expiringSoon ? "Expiring soon" : "Active",
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Rewards" description="Cashback earned and voucher coupons collected" icon={Gift}>
        <ExportButton
          filename="gpay-rewards"
          rows={[...cashbackExport, ...voucherExport]}
          jsonData={{ cashback, vouchers }}
          columns={[
            { header: "Type", value: (r) => ("Code" in r ? "Voucher" : "Cashback") },
            { header: "Date", value: (r) => String(r.Date ?? "") },
            { header: "Amount", value: (r) => ("Amount" in r ? Number(r.Amount) : "") },
            { header: "Summary", value: (r) => String(r.Summary ?? r.Description ?? "") },
            { header: "Code", value: (r) => String(r.Code ?? "") },
            { header: "Expiry", value: (r) => String(r.Expiry ?? "") },
            { header: "Status", value: (r) => String(r.Status ?? "") },
          ]}
          label="Export rewards"
        />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CircleDollarSign className="size-3.5" /> Total cashback
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatINR(total)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Cashback events</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{cashback.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Avg reward</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatINR(Math.round(avg))}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Vouchers active</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">{activeCount}</span>
            <span className="text-base text-muted-foreground"> / {vouchers.length}</span>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="cashback">
        <TabsList>
          <TabsTrigger value="cashback">Cashback</TabsTrigger>
          <TabsTrigger value="vouchers">Vouchers ({vouchers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="cashback" className="mt-4 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Cashback over time</CardTitle>
              <CardDescription>Rewards credited per month</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={{ value: { label: "Cashback", color: "var(--chart-2)" } }} className="h-56">
                <ResponsiveContainer>
                  <BarChart data={byMonth}>
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} />
                    <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `₹${v}`} />
                    <ChartTooltip cursor={{ fill: "var(--color-muted)", opacity: 0.3 }} content={<ChartTooltipContent formatter={(v) => formatINR(Number(v))} />} />
                    <Bar dataKey="value" name="value" fill="var(--color-value)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BadgeCheck className="size-4 text-muted-foreground" /> Cashback history
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {[...cashback].reverse().map((c, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <div className="flex-1">
                      <span className="font-medium">{c.description ?? "Google Pay Rewards"}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {dateTimeLabel(c.year, c.month, new Date(c.ts).getUTCDate(), 0, 0)}
                      </span>
                    </div>
                    <Badge variant="secondary" className="font-semibold">{formatINR(c.amount)}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vouchers" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Ticket className="size-4 text-muted-foreground" /> Voucher coupons
                </CardTitle>
                <CardDescription>
                  {activeCount} active · {expiredCount} expired
                  {biggestVoucher > 0 && ` · largest offer ${formatINR(biggestVoucher, true)}`}
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5">
                {VOUCHER_TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setVoucherFilter(t.key)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      voucherFilter === t.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {t.label}
                    <span className={cn("ml-1 tabular-nums", voucherFilter === t.key ? "text-primary-foreground/70" : "text-muted-foreground/60")}>
                      {t.count}
                    </span>
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredVouchers.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <Clock3 className="size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No vouchers in this filter.</p>
                </div>
              )}
              <div className="divide-y">
                {filteredVouchers.map((v) => (
                  <div key={v.code} className="flex items-start gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{v.summary || "Voucher"}</span>
                        <Badge
                          variant={v.expired ? "outline" : v.expiringSoon ? "secondary" : "default"}
                          className={
                            v.expired
                              ? "text-muted-foreground line-through"
                              : v.expiringSoon
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                : ""
                          }
                        >
                          {v.expired ? "Expired" : v.expiringSoon ? "Expiring soon" : "Active"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{v.details}</p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{v.code}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {v.expiryTimestamp
                        ? dateTimeLabel(
                            new Date(v.expiryTimestamp).getUTCFullYear(),
                            new Date(v.expiryTimestamp).getUTCMonth() + 1,
                            new Date(v.expiryTimestamp).getUTCDate(),
                            0,
                            0
                          ).split(",")[0]
                        : "No expiry"}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
