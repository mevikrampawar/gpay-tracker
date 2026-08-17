import * as React from "react"
import { Store, ShoppingCart, RefreshCw, Upload, ArrowRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ExportButton } from "@/components/export-button"
import { StoreStatusBadge } from "@/components/transaction-badges"
import { useData } from "@/lib/data-context"
import { formatINR, dateTimeLabel } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { navigate } from "@/lib/router"

export function StorePage() {
  const { storeTransactions, loading } = useData()

  if (!loading && storeTransactions.length === 0) {
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

  const completed = storeTransactions.filter((t) => t.status === "Complete")
  const totalSpend = completed.reduce((s, t) => s + t.amount, 0)
  const cancelled = storeTransactions.filter((t) => t.status === "Cancelled")
  const cancelledValue = cancelled.reduce((s, t) => s + t.amount, 0)

  const byProduct = React.useMemo(() => {
    const acc = new Map<string, { value: number; count: number }>()
    for (const t of completed) {
      const key = t.product ?? "Other"
      const c = acc.get(key) ?? { value: 0, count: 0 }
      c.value += t.amount
      c.count++
      acc.set(key, c)
    }
    return [...acc.entries()]
      .map(([name, v]) => ({ name, value: v.value, count: v.count }))
      .sort((a, b) => b.value - a.value)
  }, [storeTransactions])

  const byStatus = React.useMemo(() => {
    const acc = new Map<string, { value: number; count: number }>()
    for (const t of storeTransactions) {
      const key = t.status ?? "Unknown"
      const c = acc.get(key) ?? { value: 0, count: 0 }
      c.value += t.amount
      c.count++
      acc.set(key, c)
    }
    return [...acc.entries()].map(([name, v]) => ({ name, value: v.value, count: v.count }))
  }, [storeTransactions])

  const exportRows = storeTransactions.map((t) => ({
    Date: t.ts ? dateTimeLabel(
      new Date(t.ts).getUTCFullYear(), new Date(t.ts).getUTCMonth() + 1, new Date(t.ts).getUTCDate(),
      new Date(t.ts).getUTCHours(), new Date(t.ts).getUTCMinutes()
    ) : "",
    Description: t.description ?? "",
    Product: t.product ?? "",
    PaymentMethod: t.paymentMethod ?? "",
    Status: t.status ?? "",
    Amount: t.amount,
    TransactionId: t.id ?? "",
  }))

  const chartColors = ["var(--color-a)", "var(--color-b)", "var(--color-c)", "var(--color-d)", "var(--color-e)"]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Store & Subscriptions"
        description="Google Play, YouTube and other digital purchases made through Google Pay"
        icon={Store}
      >
        <ExportButton
          filename="gpay-store-transactions"
          rows={exportRows}
          jsonData={storeTransactions}
          columns={[
            { header: "Date", value: (r) => String(r.Date) },
            { header: "Description", value: (r) => String(r.Description) },
            { header: "Product", value: (r) => String(r.Product) },
            { header: "Payment method", value: (r) => String(r.PaymentMethod) },
            { header: "Status", value: (r) => String(r.Status) },
            { header: "Amount", value: (r) => Number(r.Amount) },
            { header: "Transaction ID", value: (r) => String(r.TransactionId) },
          ]}
        />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">Completed spend</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{formatINR(totalSpend)}</CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">Purchases</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{completed.length}</CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">Cancelled / failed</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums">{cancelled.length}</CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">On hold (cancelled value)</CardTitle></CardHeader><CardContent className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{formatINR(cancelledValue)}</CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spend by product</CardTitle>
            <CardDescription>Google Play, YouTube, etc.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {byProduct.map((p, i) => {
              const pct = totalSpend ? (p.value / totalSpend) * 100 : 0
              return (
                <div key={p.name} className="flex items-center gap-3 text-sm">
                  <div className="w-36 shrink-0 truncate">{p.name}</div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: chartColors[i % chartColors.length] }} />
                  </div>
                  <Badge variant="secondary" className="w-20 justify-end">{formatINR(p.value, true)}</Badge>
                  <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{p.count}</span>
                </div>
              )
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Status summary</CardTitle>
            <CardDescription>Complete / cancelled / refunded</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {byStatus.map((s) => (
              <div key={s.name} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                <StoreStatusBadge status={s.name} />
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground tabular-nums">{s.count} txs</span>
                  <span className="font-semibold tabular-nums">{formatINR(s.value)}</span>
                </div>
              </div>
            ))}
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
              <ShoppingCart className="mt-0.5 size-3.5 shrink-0" />
              Cancelled transactions never deducted from your account — the shown value is the list price that was blocked then released.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <RefreshCw className="size-4 text-muted-foreground" />
          <CardTitle>Subscriptions found</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {completed.some((t) => /membership/i.test(t.description ?? "")) ? (
            completed
              .filter((t) => /membership|super chat/i.test(t.description ?? ""))
              .map((t, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div>
                    <div className="font-medium">{t.description}</div>
                    <div className="text-xs text-muted-foreground">{t.product}</div>
                  </div>
                  <Badge variant="secondary">{formatINR(t.amount)}</Badge>
                </div>
              ))
          ) : (
            <p className="text-muted-foreground">No recurring membership detected in store transactions.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
