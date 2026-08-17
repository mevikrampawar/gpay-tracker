import * as React from "react"
import { BrainCircuit, RefreshCw, Pause, Play, Users, Upload, ArrowRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Sparkline } from "@/components/sparkline"
import { useData } from "@/lib/data-context"
import { buildRecipientStats, type RecipientStat } from "@/lib/analytics"
import { useRecipientOverrides } from "@/lib/recipient-overrides"
import { formatINR, dateLabel } from "@/lib/format"
import type { CounterpartyClass } from "@/lib/classify"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

const CLASS_COLOR: Record<CounterpartyClass, string> = {
  Merchant: "var(--chart-1)",
  Person: "var(--chart-2)",
  Platform: "var(--chart-3)",
  Atm: "var(--chart-4)",
  Google: "var(--chart-5)",
}

const CLASS_ORDER: CounterpartyClass[] = ["Merchant", "Person", "Platform", "Atm", "Google"]

const W = 940
const H = 560
const CX = W / 2
const CY = H / 2

interface NodeData {
  r: RecipientStat
  x: number
  y: number
  size: number
  color: string
}

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function layout(nodes: RecipientStat[], seed: number, maxSpend: number): NodeData[] {
  const rng = seeded(seed)
  const list: NodeData[] = nodes.map((r) => {
    const spend = Math.max(r.outflow, r.inflow)
    const size = 6 + (spend / maxSpend) * 16
    return { r, x: 0, y: 0, size, color: CLASS_COLOR[r.cls] }
  })

  const n = list.length
  if (n === 0) return list

  for (let i = 0; i < n; i++) {
    const spend = Math.max(list[i].r.outflow, list[i].r.inflow)
    const targetR = 70 + (spend / maxSpend) * 150 + rng() * 30
    const ang = (i / n) * Math.PI * 2 + rng() * 0.6
    list[i].x = CX + Math.cos(ang) * targetR
    list[i].y = CY + Math.sin(ang) * targetR
  }

  const pos = list.map((nd) => ({ x: nd.x, y: nd.y, vx: 0, vy: 0 }))
  for (let it = 0; it < 140; it++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x
        const dy = pos[i].y - pos[j].y
        const d2 = Math.max(dx * dx + dy * dy, 400)
        const f = (9000 / d2) * 1.2
        const d = Math.sqrt(d2)
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        pos[i].vx += fx
        pos[i].vy += fy
        pos[j].vx -= fx
        pos[j].vy -= fy
      }
    }
    for (let i = 0; i < n; i++) {
      const spend = Math.max(list[i].r.outflow, list[i].r.inflow)
      const targetR = 60 + (spend / maxSpend) * 170
      const dx = CX - pos[i].x
      const dy = CY - pos[i].y
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const pull = (d - targetR) * 0.012
      pos[i].vx += (dx / d) * pull
      pos[i].vy += (dy / d) * pull
      pos[i].vx *= 0.82
      pos[i].vy *= 0.82
      pos[i].x += pos[i].vx
      pos[i].y += pos[i].vy
      pos[i].x = Math.max(24, Math.min(W - 24, pos[i].x))
      pos[i].y = Math.max(24, Math.min(H - 24, pos[i].y))
    }
  }
  list.forEach((nd, i) => {
    nd.x = pos[i].x
    nd.y = pos[i].y
  })
  return list
}

function edgePath(x1: number, y1: number, x2: number, y2: number, dir: 1 | -1) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
  const ox = (-dy / len) * 18 * dir
  const oy = (dx / len) * 18 * dir
  return `M ${x1} ${y1} Q ${mx + ox} ${my + oy} ${x2} ${y2}`
}

function NeuronDetail({ node, onOpen }: { node: NodeData; onOpen: () => void }) {
  const r = node.r
  const spend = Math.max(r.outflow, r.inflow)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="truncate text-sm">{r.name}</CardTitle>
          <Badge variant="outline" className="mt-1">{r.cls}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onOpen}>
          <Users /> Profile
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted/40 p-2">
            <div className="text-[11px] text-muted-foreground">Outflow</div>
            <div className="font-semibold tabular-nums">{formatINR(r.outflow, true)}</div>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <div className="text-[11px] text-muted-foreground">Inflow</div>
            <div className="font-semibold tabular-nums">{formatINR(r.inflow, true)}</div>
          </div>
          <div className="rounded-lg bg-muted/40 p-2">
            <div className="text-[11px] text-muted-foreground">Net</div>
            <div className={cn("font-semibold tabular-nums", r.net < 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>
              {formatINR(r.net, true)}
            </div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {r.count} transactions · avg {formatINR(r.avg, true)} · largest {formatINR(r.max, true)}
        </div>
        <div className="text-xs text-muted-foreground">
          Last seen {dateLabel(Number(r.lastTs.slice(0, 4)), Number(r.lastTs.slice(5, 7)), Number(r.lastTs.slice(8, 10)))} · active {r.monthsActive} months
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">6-month spend ({formatINR(spend, true)} total)</div>
          <Sparkline data={r.monthlySpend.map((m) => m.amount)} width={220} height={34} stroke={node.color} />
        </div>
      </CardContent>
    </Card>
  )
}

export function NeuralPage() {
  const { transactions, loading } = useData()
  const { overrides } = useRecipientOverrides()
  const [classFilter, setClassFilter] = React.useState<"All" | CounterpartyClass>("All")
  const [topN, setTopN] = React.useState(45)
  const [showInflow, setShowInflow] = React.useState(true)
  const [animating, setAnimating] = React.useState(true)
  const [seed, setSeed] = React.useState(7)
  const [selected, setSelected] = React.useState<NodeData | null>(null)

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

  const stats = React.useMemo(() => buildRecipientStats(transactions, overrides), [transactions, overrides])

  const pool = React.useMemo(() => {
    const filtered = stats.filter((r) => (classFilter === "All" ? true : r.cls === classFilter))
    return [...filtered]
      .filter((r) => r.outflow > 0 || r.inflow > 0)
      .sort((a, b) => Math.max(b.outflow, b.inflow) - Math.max(a.outflow, a.inflow))
      .slice(0, topN)
  }, [stats, classFilter, topN])

  const maxSpend = React.useMemo(
    () => Math.max(1, ...pool.map((r) => Math.max(r.outflow, r.inflow))),
    [pool]
  )

  const nodes = React.useMemo(() => layout(pool, seed, maxSpend), [pool, seed, maxSpend])
  const maxEdge = React.useMemo(
    () => Math.max(1, ...pool.map((r) => Math.max(r.outflow, r.inflow))),
    [pool]
  )

  const visible = React.useMemo(
    () => new Set(nodes.map((nd) => nd.r.nameKey)),
    [nodes]
  )

  const background = { background: "radial-gradient(ellipse at center, color-mix(in oklab, var(--chart-2) 10%, transparent) 0%, transparent 62%)" }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Neural dashboard" description="Your payment network — who you send money to and who sends it back" icon={BrainCircuit}>
        <Button variant="outline" size="sm" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>
          <RefreshCw /> Regenerate layout
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(["All", ...CLASS_ORDER] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setClassFilter(c)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    classFilter === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  )}
                >
                  {c === "All" ? "All" : c}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Top</span>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value))}
                className="w-28 accent-primary"
              />
              <span className="w-8 tabular-nums">{topN}</span>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showInflow} onCheckedChange={setShowInflow} />
              Inflow
            </label>
            <Button variant="ghost" size="icon-sm" onClick={() => setAnimating((a) => !a)} title={animating ? "Pause animation" : "Play animation"}>
              {animating ? <Pause /> : <Play />}
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              {nodes.length} nodes · drag-free · click a node
            </span>
          </div>

          <div className="relative overflow-hidden rounded-xl border" style={background}>
            <svg viewBox={`0 0 ${W} ${H}`} className="h-[340px] w-full sm:h-[460px]" role="img" aria-label="Payment network graph">
              <defs>
                <pattern id="neural-grid" width="26" height="26" patternUnits="userSpaceOnUse">
                  <circle cx="1.5" cy="1.5" r="1.2" className="fill-foreground/10" />
                </pattern>
                <radialGradient id="neural-glow">
                  <stop offset="0%" stopColor="var(--chart-2)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--chart-2)" stopOpacity="0" />
                </radialGradient>
              </defs>
              <rect width={W} height={H} fill="url(#neural-grid)" />
              <circle cx={CX} cy={CY} r="170" fill="url(#neural-glow)" className="pointer-events-none" />

              {nodes.map((nd) => {
                if (nd.r.outflow > 0) {
                  const width = 1 + 4 * (nd.r.outflow / maxEdge)
                  return (
                    <path
                      key={`out-${nd.r.nameKey}`}
                      d={edgePath(CX, CY, nd.x, nd.y, 1)}
                      fill="none"
                      stroke={nd.color}
                      strokeWidth={width}
                      strokeOpacity={0.4}
                    />
                  )
                }
                return null
              })}
              {showInflow &&
                nodes.map((nd) => {
                  if (nd.r.inflow > 0) {
                    const width = 1 + 3 * (nd.r.inflow / maxEdge)
                    return (
                      <path
                        key={`in-${nd.r.nameKey}`}
                        d={edgePath(nd.x, nd.y, CX, CY, -1)}
                        fill="none"
                        stroke={nd.color}
                        strokeWidth={width}
                        strokeOpacity={0.35}
                        strokeDasharray="5 7"
                        className={animating ? "neural-dash" : ""}
                      />
                    )
                  }
                  return null
                })}

              <g
                className="neural-pulse"
                onClick={() => setSelected(null)}
                style={{ cursor: "pointer" }}
              >
                <circle r="28" className="fill-primary/10" />
                <circle r="24" fill="var(--chart-2)" stroke="var(--chart-2)" strokeWidth="2" />
                <text
                  textAnchor="middle"
                  dy="6"
                  fontSize="20"
                  fontWeight="700"
                  fill="white"
                  className="select-none"
                  style={{ paintOrder: "stroke", stroke: "var(--chart-2)", strokeWidth: 3, strokeLinejoin: "round" }}
                >
                  You
                </text>
              </g>

              {nodes.map((nd) => (
                <g
                  key={nd.r.nameKey}
                  transform={`translate(${nd.x} ${nd.y})`}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelected(nd)
                  }}
                >
                  {selected?.r.nameKey === nd.r.nameKey && (
                    <circle r={nd.size + 5} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" className="animate-pulse" />
                  )}
                  <g className="neural-node">
                    <circle
                      r={nd.size}
                      fill={nd.color}
                      fillOpacity="0.85"
                      stroke={nd.color}
                      strokeWidth="1.5"
                    />
                    <text
                      textAnchor="middle"
                      dy={nd.size + 11}
                      fontSize="9.5"
                      fontWeight="500"
                      fill="currentColor"
                      className="pointer-events-none select-none"
                      style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3, strokeLinejoin: "round" }}
                    >
                      {nd.r.name.length > 18 ? nd.r.name.slice(0, 17) + "…" : nd.r.name}
                    </text>
                  </g>
                </g>
              ))}
            </svg>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Legend</span>
            {CLASS_ORDER.map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: CLASS_COLOR[c] }} />
                {c}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-current" /> solid = money out
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded bg-current" style={{ backgroundImage: "repeating-linear-gradient(90deg,currentColor 0 3px,transparent 3px 6px)" }} /> dashed = money in
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top connections</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {nodes.slice(0, 12).map((nd, i) => (
                <button
                  key={nd.r.nameKey}
                  onClick={() => setSelected(nd)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted",
                    selected?.r.nameKey === nd.r.nameKey && "bg-muted"
                  )}
                >
                  <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="size-2.5 rounded-full" style={{ background: nd.color }} />
                  <span className="min-w-0 flex-1 truncate text-sm">{nd.r.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{nd.r.count} tx</span>
                  <span className="w-24 text-right text-sm font-medium tabular-nums">
                    {formatINR(Math.max(nd.r.outflow, nd.r.inflow), true)}
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
        <div>
          {selected && visible.has(selected.r.nameKey) ? (
            <NeuronDetail
              node={selected}
              onOpen={() => navigate(`/recipients?name=${encodeURIComponent(selected.r.nameKey)}`)}
            />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <BrainCircuit className="size-8 opacity-40" />
                <p>Click a node to inspect a connection</p>
                <p className="text-xs">Node size = money moved · color = entity class</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
