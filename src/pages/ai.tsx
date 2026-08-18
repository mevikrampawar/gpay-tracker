import * as React from "react"
import {
  BrainCircuit,
  Sparkles,
  Maximize,
  Activity,
  Users,
  TrendingUp,
  FileCheck,
  HelpCircle,
  Check,
  SkipForward,
  Pencil,
  Tag,
  Upload,
  ArrowRight,
  type LucideIcon,
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useData } from "@/lib/data-context"
import { monthlySeries } from "@/lib/analytics"
import {
  suggestUnknownNames,
  buildAiNarrative,
  WHY_UNKNOWN,
  type UnknownSuggestion,
} from "@/lib/ai-analyst"
import { useRecipientEdits } from "@/lib/recipient-edits"
import { dateTimeLabel, monthLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import { navigate } from "@/lib/router"

const POINT_ICONS: Record<string, LucideIcon> = {
  maximize: Maximize,
  activity: Activity,
  users: Users,
  "trending-up": TrendingUp,
  "file-check": FileCheck,
  "help-circle": HelpCircle,
}

function confidenceColor(c: number) {
  if (c >= 0.9) return "bg-emerald-500"
  if (c >= 0.7) return "bg-sky-500"
  if (c >= 0.5) return "bg-amber-500"
  return "bg-muted-foreground"
}

export function AiPage() {
  const { transactions, loading } = useData()
  const { edits, txNames, setTxName } = useRecipientEdits()
  const [skipped, setSkipped] = React.useState<Set<string>>(new Set())
  const [editing, setEditing] = React.useState<UnknownSuggestion | null>(null)
  const [draftName, setDraftName] = React.useState("")
  const [limit, setLimit] = React.useState(40)

  const unknownCount = React.useMemo(
    () => transactions.filter((t) => t.name === null).length,
    [transactions]
  )

  const suggestions = React.useMemo(() => {
    try {
      return suggestUnknownNames(transactions, edits, txNames)
    } catch {
      return [] as UnknownSuggestion[]
    }
  }, [transactions, edits, txNames])

  const pending = suggestions.filter((s) => !txNames[s.txId] && !skipped.has(s.txId))
  const highConfidence = pending.filter((s) => s.confidence >= 0.9)

  const monthly = React.useMemo(() => monthlySeries(transactions), [transactions])
  const avgMonthlySpend = React.useMemo(() => {
    const paid = monthly.map((m) => m.outflow)
    if (!paid.length) return 0
    return Math.round(paid.reduce((a, b) => a + b, 0) / paid.length)
  }, [monthly])
  const lastMonth = monthly[monthly.length - 1]

  const narrative = React.useMemo(() => {
    const n = buildAiNarrative(
      transactions,
      0,
      unknownCount,
      highConfidence.length,
      0,
      avgMonthlySpend,
      lastMonth?.outflow ?? 0,
      lastMonth ? monthLabel(lastMonth.year, lastMonth.month) : "this month"
    )
    n.points.unshift({
      icon: "activity",
      text: `I analysed ${transactions.length.toLocaleString()} UPI transactions to build this picture.`,
    })
    return n
  }, [unknownCount, highConfidence.length, avgMonthlySpend, lastMonth, transactions])

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

  const applyName = (s: UnknownSuggestion, name: string) => {
    setTxName(s.txId, name)
  }

  const applyAllHigh = () => {
    for (const s of highConfidence) setTxName(s.txId, s.name)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="AI Analyst"
        description="Local on-device intelligence — pattern analysis, auto-naming of unknown transactions and explanations"
        icon={BrainCircuit}
      >
        <Button size="sm" onClick={applyAllHigh} disabled={highConfidence.length === 0}>
          <Sparkles /> Apply {highConfidence.length} high-confidence names
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Transactions analysed</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {transactions.length.toLocaleString()}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">Unknown transactions</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {unknownCount.toLocaleString()}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium text-muted-foreground">High-confidence suggestions</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{highConfidence.length.toLocaleString()}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 text-primary" /> {narrative.title}
          </CardTitle>
          <CardDescription>{narrative.summary}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {narrative.points.map((p, i) => {
            const Icon = POINT_ICONS[p.icon] ?? Sparkles
            return (
              <div key={i} className="flex items-start gap-3 rounded-lg bg-muted/40 p-3 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="text-foreground/90">{p.text}</span>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Tag className="size-4 text-primary" /> Name unknown transactions
            </CardTitle>
            <CardDescription>
              {pending.length.toLocaleString()} suggestions waiting · apply the ones you trust, skip the rest
            </CardDescription>
          </div>
          {pending.length > limit && (
            <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 40)}>
              Show {Math.min(pending.length - limit, 40)} more
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {pending.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <Sparkles className="size-6 opacity-40" />
              <p>All suggestions have been applied or skipped.</p>
            </div>
          )}
          {pending.slice(0, limit).map((s) => (
            <div key={s.txId} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1 basis-52">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant={s.confidence >= 0.9 ? "default" : "secondary"}>
                    {Math.round(s.confidence * 100)}%
                  </Badge>
                  <span className="text-xs text-muted-foreground">{s.type}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  ₹{s.amount.toLocaleString("en-IN")} · {dateTimeLabel(
                    new Date(s.ts).getUTCFullYear(),
                    new Date(s.ts).getUTCMonth() + 1,
                    new Date(s.ts).getUTCDate(),
                    new Date(s.ts).getUTCHours(),
                    new Date(s.ts).getUTCMinutes()
                  )}
                  {s.method ? ` · ${s.method}` : ""}
                </div>
                <div className="mt-1 text-xs text-muted-foreground/80">{s.reason}</div>
                {s.matchEvidence && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.matchEvidence.split(" · ").map((e, i) => (
                      <span key={i} className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        {e}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", confidenceColor(s.confidence))} style={{ width: `${s.confidence * 100}%` }} />
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="xs" variant="outline" onClick={() => setEditing(s)}>
                  <Pencil /> Edit
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setSkipped((p) => new Set(p).add(s.txId))}>
                  <SkipForward /> Skip
                </Button>
                <Button size="xs" onClick={() => applyName(s, s.name)}>
                  <Check /> Apply
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <HelpCircle className="size-4 text-primary" /> Why are some transactions unknown?
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {WHY_UNKNOWN.map((b) => (
            <div key={b.heading}>
              <h3 className="text-sm font-semibold">{b.heading}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{b.body}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        {editing && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Name this transaction</DialogTitle>
              <DialogDescription>
                ₹{editing.amount.toLocaleString("en-IN")} · {dateTimeLabel(
                  new Date(editing.ts).getUTCFullYear(),
                  new Date(editing.ts).getUTCMonth() + 1,
                  new Date(editing.ts).getUTCDate(),
                  new Date(editing.ts).getUTCHours(),
                  new Date(editing.ts).getUTCMinutes()
                )}
                <br />
                Suggested: <span className="font-medium text-foreground">{editing.name}</span>
              </DialogDescription>
            </DialogHeader>
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Recipient name"
              autoFocus
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setTxName(editing.txId, editing.name)
                  setEditing(null)
                }}
              >
                Use suggestion
              </Button>
              <Button
                disabled={!draftName.trim()}
                onClick={() => {
                  setTxName(editing.txId, draftName)
                  setDraftName("")
                  setEditing(null)
                }}
              >
                Save name
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
