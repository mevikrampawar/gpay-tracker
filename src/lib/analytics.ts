import type { UpiTransaction } from "@/data/bundle"
import { classifyName, type CounterpartyClass } from "@/lib/classify"
import { monthKey } from "@/lib/format"
import { enrichTransactions, type RecipientEdits, type TxNames } from "@/lib/recipient-edits"

export interface Totals {
  outflow: number
  inflow: number
  sent: number
  net: number
  count: number
  paidCount: number
  receivedCount: number
  sentCount: number
  avgOutflow: number
  maxOutflow: number
  maxInflow: number
  uniqueCounterparties: number
  uniqueMerchants: number
}

export function computeTotals(tx: UpiTransaction[]): Totals {
  let outflow = 0, inflow = 0, sent = 0, maxOutflow = 0, maxInflow = 0
  let paidCount = 0, receivedCount = 0, sentCount = 0
  const names = new Set<string>()
  const merchants = new Set<string>()
  for (const t of tx) {
    if (t.nameKey) {
      names.add(t.nameKey)
      if (classifyName(t.name, t.nameKey) === "Merchant") merchants.add(t.nameKey)
    }
    if (t.type === "Paid") {
      outflow += t.amount
      paidCount++
      if (t.amount > maxOutflow) maxOutflow = t.amount
    } else if (t.type === "Received") {
      inflow += t.amount
      receivedCount++
      if (t.amount > maxInflow) maxInflow = t.amount
    } else {
      sent += t.amount
      sentCount++
    }
  }
  return {
    outflow, inflow, sent,
    net: inflow - outflow - sent,
    count: tx.length,
    paidCount, receivedCount, sentCount,
    avgOutflow: paidCount ? outflow / paidCount : 0,
    maxOutflow, maxInflow,
    uniqueCounterparties: names.size,
    uniqueMerchants: merchants.size,
  }
}

export interface MonthPoint {
  key: string
  year: number
  month: number
  outflow: number
  inflow: number
  sent: number
  count: number
  paidCount: number
}

export function monthlySeries(tx: UpiTransaction[]): MonthPoint[] {
  const map = new Map<string, MonthPoint>()
  for (const t of tx) {
    const key = monthKey(t.year, t.month)
    let p = map.get(key)
    if (!p) {
      p = { key, year: t.year, month: t.month, outflow: 0, inflow: 0, sent: 0, count: 0, paidCount: 0 }
      map.set(key, p)
    }
    p.count++
    if (t.type === "Paid") {
      p.outflow += t.amount
      p.paidCount++
    } else if (t.type === "Received") p.inflow += t.amount
    else p.sent += t.amount
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export interface YearPoint {
  year: number
  outflow: number
  inflow: number
  sent: number
  count: number
}

export function yearlySeries(tx: UpiTransaction[]): YearPoint[] {
  const map = new Map<number, YearPoint>()
  for (const t of tx) {
    let p = map.get(t.year)
    if (!p) {
      p = { year: t.year, outflow: 0, inflow: 0, sent: 0, count: 0 }
      map.set(t.year, p)
    }
    p.count++
    if (t.type === "Paid") p.outflow += t.amount
    else if (t.type === "Received") p.inflow += t.amount
    else p.sent += t.amount
  }
  return [...map.values()].sort((a, b) => a.year - b.year)
}

export interface RecipientStat {
  name: string
  nameKey: string
  cls: CounterpartyClass
  override: CounterpartyClass | null
  count: number
  outflow: number
  inflow: number
  net: number
  avg: number
  max: number
  firstTs: string
  lastTs: string
  monthsActive: number
  monthlySpend: { key: string; amount: number }[]
  methods: { method: string; count: number }[]
}

export interface RecipientOverrides {
  [nameKey: string]: CounterpartyClass
}

export function buildRecipientStats(
  tx: UpiTransaction[],
  overrides: RecipientOverrides = {},
  edits: RecipientEdits = {},
  txNames: TxNames = {}
): RecipientStat[] {
  const enriched = enrichTransactions(tx, edits, txNames)
  const map = new Map<string, RecipientStat>()
  const spend = new Map<string, Map<string, number>>()
  const methodMap = new Map<string, Map<string, number>>()

  for (const t of enriched) {
    if (t.isUnknown || !t.name || !t.nameKey) continue
    const key = t.nameKey
    let s = map.get(key)
    if (!s) {
      const cls = edits[key]?.cls ?? overrides[key] ?? classifyName(t.name, key)
      s = {
        name: t.name,
        nameKey: key,
        cls,
        override: overrides[key] ?? null,
        count: 0,
        outflow: 0,
        inflow: 0,
        net: 0,
        avg: 0,
        max: 0,
        firstTs: t.ts,
        lastTs: t.ts,
        monthsActive: 0,
        monthlySpend: [],
        methods: [],
      }
      map.set(key, s)
    }
    s.count++
    if (t.ts < s.firstTs) s.firstTs = t.ts
    if (t.ts > s.lastTs) s.lastTs = t.ts
    if (t.type === "Paid") {
      s.outflow += t.amount
      if (t.amount > s.max) s.max = t.amount
      const mkey = monthKey(t.year, t.month)
      let mm = spend.get(key)
      if (!mm) {
        mm = new Map()
        spend.set(key, mm)
      }
      mm.set(mkey, (mm.get(mkey) ?? 0) + t.amount)
      if (t.method) {
        let meth = methodMap.get(key)
        if (!meth) {
          meth = new Map()
          methodMap.set(key, meth)
        }
        meth.set(t.method, (meth.get(t.method) ?? 0) + 1)
      }
    } else if (t.type === "Received") {
      s.inflow += t.amount
    }
    s.net = s.inflow - s.outflow
  }

  for (const s of map.values()) {
    const mm = spend.get(s.nameKey)
    if (mm) {
      s.monthsActive = mm.size
      s.monthlySpend = [...mm.entries()]
        .map(([key, amount]) => ({ key, amount }))
        .sort((a, b) => a.key.localeCompare(b.key))
    }
    const meth = methodMap.get(s.nameKey)
    if (meth) {
      s.methods = [...meth.entries()]
        .map(([method, count]) => ({ method, count }))
        .sort((a, b) => b.count - a.count)
    }
    s.avg = s.count ? s.outflow / s.count : 0
  }

  return [...map.values()].sort((a, b) => b.outflow - a.outflow)
}

export interface Breakdown {
  key: string
  label: string
  value: number
  count: number
}

export function breakdownBy(tx: UpiTransaction[], field: "method" | "name"): Breakdown[] {
  const map = new Map<string, { value: number; count: number }>()
  for (const t of tx) {
    if (t.type !== "Paid") continue
    const key = field === "method" ? t.method ?? "Unknown" : t.nameKey ?? "Unknown"
    if (!key) continue
    const cur = map.get(key) ?? { value: 0, count: 0 }
    cur.value += t.amount
    cur.count++
    map.set(key, cur)
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, label: key, value: v.value, count: v.count }))
    .sort((a, b) => b.value - a.value)
}

export interface HeatCell {
  hour: number
  weekday: number
  value: number
  count: number
}

export function hourWeekdayHeatmap(tx: UpiTransaction[]): HeatCell[] {
  const map = new Map<string, HeatCell>()
  for (const t of tx) {
    if (t.type !== "Paid") continue
    const k = `${t.weekday}-${t.hour}`
    let c = map.get(k)
    if (!c) {
      c = { hour: t.hour, weekday: t.weekday, value: 0, count: 0 }
      map.set(k, c)
    }
    c.value += t.amount
    c.count++
  }
  return [...map.values()]
}

export interface Bucket {
  key: string
  min: number
  max: number
  count: number
  value: number
}

export function amountHistogram(tx: UpiTransaction[], type: "Paid" | "Received" | "Sent" = "Paid"): Bucket[] {
  const edges = [0, 10, 20, 30, 40, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 50000, Infinity]
  const out: Bucket[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    out.push({ key: `${edges[i]}`, min: edges[i], max: edges[i + 1], count: 0, value: 0 })
  }
  for (const t of tx) {
    if (t.type !== type) continue
    const bucket = out.find((b) => t.amount >= b.min && t.amount < b.max)
    if (bucket) {
      bucket.count++
      bucket.value += t.amount
    }
  }
  return out
}

export interface RecipientCluster {
  nameKey: string
  name: string
  count: number
  outflow: number
  lastTs: string
}

/** Recipients with >=2 payments in 2+ distinct months — potential recurring bills. */
export function recurringRecipients(tx: UpiTransaction[]): RecipientCluster[] {
  const map = new Map<string, { nameKey: string; name: string; count: number; outflow: number; months: Set<string>; lastTs: string }>()
  for (const t of tx) {
    if (t.type !== "Paid" || !t.name || !t.nameKey) continue
    let c = map.get(t.nameKey)
    if (!c) {
      c = { nameKey: t.nameKey, name: t.name, count: 0, outflow: 0, months: new Set(), lastTs: t.ts }
      map.set(t.nameKey, c)
    }
    c.count++
    c.outflow += t.amount
    c.months.add(monthKey(t.year, t.month))
    if (t.ts > c.lastTs) c.lastTs = t.ts
  }
  return [...map.values()]
    .filter((c) => c.count >= 2 && c.months.size >= 2)
    .map((c) => ({
      nameKey: c.nameKey,
      name: c.name,
      count: c.count,
      outflow: c.outflow,
      lastTs: c.lastTs,
    }))
    .sort((a, b) => b.outflow - a.outflow)
}

export function percentile(tx: UpiTransaction[], p: number, type: "Paid" | "Received" | "Sent" = "Paid"): number {
  const vals = tx.filter((t) => t.type === type).map((t) => t.amount).sort((a, b) => a - b)
  if (!vals.length) return 0
  const idx = Math.min(vals.length - 1, Math.max(0, Math.ceil((p / 100) * vals.length) - 1))
  return vals[idx]
}
