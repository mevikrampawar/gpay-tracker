import * as React from "react"
import { Split, Users, CircleDollarSign, AlertCircle, Wallet, Upload, ArrowRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ExportButton } from "@/components/export-button"
import { useData } from "@/lib/data-context"
import type { GroupExpense } from "@/data/bundle"
import { formatINR, formatINRFull, dateTimeLabel } from "@/lib/format"
import { downloadCSV } from "@/lib/export-utils"
import { cn } from "@/lib/utils"
import { navigate } from "@/lib/router"

function stateBadge(state: string) {
  const map: Record<string, { label: string; cls: string }> = {
    COMPLETED: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
    ONGOING: { label: "Ongoing", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
    CLOSED: { label: "Closed", cls: "bg-muted text-muted-foreground border-border" },
  }
  const m = map[state] ?? { label: state, cls: "bg-muted text-muted-foreground border-border" }
  return <Badge variant="outline" className={m.cls}>{m.label}</Badge>
}

function GroupCard({ group }: { group: GroupExpense }) {
  const unpaid = group.items.filter((i) => i.state === "UNPAID")
  const settled = group.items.filter((i) => i.state === "PAID_RECEIVED").reduce((s, i) => s + (i.amount ?? 0), 0)

  const memberSummary = React.useMemo(() => {
    const acc = new Map<string, { paid: number; unpaid: number }>()
    for (const it of group.items) {
      const cur = acc.get(it.payer) ?? { paid: 0, unpaid: 0 }
      if (it.state === "PAID_RECEIVED") cur.paid += it.amount ?? 0
      else cur.unpaid += it.amount ?? 0
      acc.set(it.payer, cur)
    }
    return [...acc.entries()].sort((a, b) => b[1].paid - a[1].paid)
  }, [group])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              {group.groupName}
              {group.title && <span className="text-muted-foreground">· {group.title}</span>}
            </CardTitle>
            <CardDescription>
              Created {dateTimeLabel(
                new Date(group.createdAt).getUTCFullYear(),
                new Date(group.createdAt).getUTCMonth() + 1,
                new Date(group.createdAt).getUTCDate(),
                new Date(group.createdAt).getUTCHours(),
                new Date(group.createdAt).getUTCMinutes()
              ).split(",")[0]}{" "}
              by {group.creator} · {group.items.length} members
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {stateBadge(group.state)}
            <span className="text-lg font-semibold tabular-nums">{formatINR(group.totalAmount ?? 0)}</span>
          </div>
        </div>
        {group.totalAmount ? (
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500/70 transition-all"
                style={{ width: `${Math.min(100, (settled / group.totalAmount) * 100)}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatINR(settled, true)} of {formatINR(group.totalAmount, true)} settled
            </span>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {memberSummary.map(([payer, s]) => (
            <div key={payer} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <Wallet className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{payer}</span>
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">{formatINR(s.paid, true)}</span>
              {s.unpaid > 0 && (
                <span className="tabular-nums text-amber-600 dark:text-amber-400">
                  owes {formatINR(s.unpaid, true)}
                </span>
              )}
            </div>
          ))}
        </div>
        {unpaid.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="size-3.5 shrink-0" />
            {unpaid.length} pending {unpaid.length === 1 ? "payment" : "payments"}:{" "}
            {unpaid.map((u) => `${u.payer} (${formatINR(u.amount ?? 0)})`).join(", ")}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function GroupsPage() {
  const { groupExpenses, loading } = useData()

  if (!loading && groupExpenses.length === 0) {
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

  const totals = React.useMemo(() => {
    let value = 0, open = 0, completed = 0
    const members = new Map<string, { paid: number; unpaid: number }>()
    for (const g of groupExpenses) {
      value += g.totalAmount ?? 0
      if (g.state === "COMPLETED") completed++
      else open++
      for (const it of g.items) {
        const cur = members.get(it.payer) ?? { paid: 0, unpaid: 0 }
        if (it.state === "PAID_RECEIVED") cur.paid += it.amount ?? 0
        else cur.unpaid += it.amount ?? 0
        members.set(it.payer, cur)
      }
    }
    const me = members.get("Vikram Pawar")
    const youNet = (me?.paid ?? 0) - (me?.unpaid ?? 0)
    return { value, open, completed, members: [...members.entries()].sort((a, b) => b[1].paid - a[1].paid), youNet }
  }, [groupExpenses])

  const exportRows = groupExpenses.flatMap((g) =>
    g.items.map((it) => ({
      Group: g.groupName,
      Title: g.title,
      State: g.state,
      Payer: it.payer,
      Amount: it.amount ?? 0,
      PaymentState: it.state,
      Created: g.createdAt,
    }))
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Group Expenses"
        description="Split bills, settlements and who owes whom"
        icon={Split}
      >
        <ExportButton
          filename="gpay-group-expenses"
          rows={exportRows}
          jsonData={groupExpenses}
          columns={[
            { header: "Group", value: (r) => String(r.Group) },
            { header: "Title", value: (r) => String(r.Title) },
            { header: "State", value: (r) => String(r.State) },
            { header: "Payer", value: (r) => String(r.Payer) },
            { header: "Amount", value: (r) => Number(r.Amount) },
            { header: "Payment state", value: (r) => String(r.PaymentState) },
            { header: "Created", value: (r) => String(r.Created) },
          ]}
        />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Groups</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{groupExpenses.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total split value</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{formatINR(totals.value)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Completed</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {totals.completed}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Pending / ongoing</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {totals.open}
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CircleDollarSign className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">
                {totals.youNet >= 0 ? "You are owed money" : "You owe money"}
              </div>
              <div className="text-xs text-muted-foreground">
                Net position across all {groupExpenses.length} groups
              </div>
            </div>
          </div>
          <span
            className={cn(
              "text-2xl font-semibold tabular-nums",
              totals.youNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
            )}
          >
            {totals.youNet >= 0 ? "+" : "−"}{formatINRFull(Math.abs(totals.youNet))}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CircleDollarSign className="size-4 text-muted-foreground" /> Settlement ledger
            </CardTitle>
            <CardDescription>Per member: settled vs outstanding across all groups</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCSV(
                "gpay-settlements.csv",
                ["Member", "Paid / received", "Outstanding", "Net position"],
                totals.members.map(([name, s]) => [name, s.paid, s.unpaid, s.paid - s.unpaid])
              )
            }
          >
            Export ledger
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {totals.members.map(([name, s]) => {
              const net = s.paid - s.unpaid
              return (
                <div key={name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <span className="font-medium">{name}</span>
                    {name === "Vikram Pawar" && (
                      <Badge variant="secondary" className="ml-2">You</Badge>
                    )}
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="text-xs text-muted-foreground">Settled</div>
                    <div className="font-medium tabular-nums">{formatINRFull(s.paid)}</div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="text-xs text-muted-foreground">Outstanding</div>
                    <div className="tabular-nums text-amber-600 dark:text-amber-400">{s.unpaid > 0 ? formatINRFull(s.unpaid) : "—"}</div>
                  </div>
                  <div className="w-28 text-right">
                    <div className="text-xs text-muted-foreground">Net</div>
                    <div
                      className={cn(
                        "font-semibold tabular-nums",
                        net > 0 ? "text-emerald-600 dark:text-emerald-400" : net < 0 ? "text-destructive" : ""
                      )}
                    >
                      {net > 0 ? "+" : ""}{formatINRFull(net)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="size-4" />
        {groupExpenses.length} groups · {totals.members.length} unique members
      </div>

      <div className="grid gap-4">
        {groupExpenses.map((g, i) => (
          <GroupCard key={`${g.id}-${i}`} group={g} />
        ))}
      </div>
    </div>
  )
}
