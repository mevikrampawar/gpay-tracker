import type { UpiTransaction, StoreTransaction, CashbackReward, GroupExpense } from "@/data/bundle"
import { buildRecipientStats, type RecipientOverrides } from "@/lib/analytics"
import { classifyName } from "@/lib/classify"
import { formatINR, monthLabel, dateLabel, weekdayName, monthKey } from "@/lib/format"

export type InsightTone = "blue" | "green" | "amber" | "violet" | "rose" | "neutral"

export interface Insight {
  id: string
  icon: string
  tone: InsightTone
  title: string
  body: string
  href?: string
  cta?: string
  priority: number
}

function findLatestTx(tx: UpiTransaction[], pred: (t: UpiTransaction) => boolean): UpiTransaction | null {
  let best: UpiTransaction | null = null
  for (const t of tx) {
    if (!pred(t)) continue
    if (!best || t.ts > best.ts) best = t
  }
  return best
}

export function buildInsights(
  tx: UpiTransaction[],
  overrides: RecipientOverrides,
  store: StoreTransaction[],
  cashback: CashbackReward[],
  groups: GroupExpense[],
  statementMatched = 0
): Insight[] {
  const out: Insight[] = []

  const maxPaid = tx.filter((t) => t.type === "Paid").sort((a, b) => b.amount - a.amount)[0]
  if (maxPaid) {
    out.push({
      id: "largest-payment",
      icon: "maximize",
      tone: "rose",
      title: `Largest payment: ${formatINR(maxPaid.amount)}`,
      body: `${maxPaid.name ?? "Someone"} on ${dateLabel(maxPaid.year, maxPaid.month, maxPaid.day)} · ${maxPaid.method ?? "no method listed"}`,
      href: "/transactions",
      cta: "View transactions",
      priority: 95,
    })
  }

  const maxReceived = tx.filter((t) => t.type === "Received").sort((a, b) => b.amount - a.amount)[0]
  if (maxReceived) {
    out.push({
      id: "largest-receipt",
      icon: "arrow-down-to-line",
      tone: "green",
      title: `Largest receipt: ${formatINR(maxReceived.amount)}`,
      body: `Credited on ${dateLabel(maxReceived.year, maxReceived.month, maxReceived.day)}`,
      href: "/transactions",
      cta: "View transactions",
      priority: 40,
    })
  }

  const recipients = buildRecipientStats(tx, overrides)
  const top = recipients[0]
  if (top && top.outflow > 0) {
    const totalOut = recipients.reduce((s, r) => s + r.outflow, 0)
    const share = totalOut ? Math.round((top.outflow / totalOut) * 100) : 0
    out.push({
      id: "top-recipient",
      icon: "user-round",
      tone: "violet",
      title: `Top recipient: ${top.name}`,
      body: `${formatINR(top.outflow)} paid across ${top.count} transactions · ${share}% of all spend`,
      href: `/recipients?name=${encodeURIComponent(top.nameKey)}`,
      cta: "View profile",
      priority: 90,
    })
  }

  const daily = new Map<string, { amount: number; count: number; date: string }>()
  for (const t of tx) {
    if (t.type !== "Paid") continue
    const key = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`
    const c = daily.get(key) ?? { amount: 0, count: 0, date: `${t.year}-${t.month}-${t.day}` }
    c.amount += t.amount
    c.count++
    daily.set(key, c)
  }
  const busiest = [...daily.values()].sort((a, b) => b.amount - a.amount)[0]
  if (busiest) {
    const [y, mo, d] = busiest.date.split("-").map(Number)
    out.push({
      id: "busiest-day",
      icon: "calendar",
      tone: "blue",
      title: `Busiest day: ${formatINR(busiest.amount)}`,
      body: `${dateLabel(y, mo, d)} · ${busiest.count} payments in a single day`,
      href: "/analytics",
      cta: "Explore trends",
      priority: 60,
    })
  }

  const byMonth = new Map<string, number>()
  for (const t of tx) {
    if (t.type !== "Paid") continue
    const key = monthKey(t.year, t.month)
    byMonth.set(key, (byMonth.get(key) ?? 0) + t.amount)
  }
  const monthKeys = [...byMonth.keys()].sort()
  const last3 = monthKeys.slice(-3).reduce((s, k) => s + (byMonth.get(k) ?? 0), 0) / 3
  const prev3 = monthKeys.slice(-6, -3).reduce((s, k) => s + (byMonth.get(k) ?? 0), 0) / 3
  if (last3 > 0 && prev3 > 0) {
    const delta = ((last3 - prev3) / prev3) * 100
    const rising = delta > 5
    out.push({
      id: "run-rate",
      icon: "trending-up",
      tone: rising ? "rose" : "green",
      title: `Monthly run-rate ${formatINR(Math.round(last3))}`,
      body: `${rising ? "Up" : "Down"} ${Math.abs(Math.round(delta))}% vs the previous 3 months`,
      href: "/analytics",
      cta: "See trends",
      priority: 75,
    })
  }

  const frequent = [...recipients].sort((a, b) => b.count - a.count)[0]
  if (frequent && frequent.count >= 3) {
    out.push({
      id: "frequent",
      icon: "repeat",
      tone: "neutral",
      title: `Most frequent: ${frequent.name}`,
      body: `${frequent.count} transactions total — check if this is a subscription`,
      href: `/recipients?name=${encodeURIComponent(frequent.nameKey)}`,
      cta: "View profile",
      priority: 35,
    })
  }

  const atms = tx
    .filter((t) => t.type === "Paid")
    .filter((t) => t.nameKey && (overrides[t.nameKey] ?? classifyName(t.name, t.nameKey)) === "Atm")
    .reduce((s, t) => s + t.amount, 0)
  if (atms > 0) {
    out.push({
      id: "atm",
      icon: "banknote",
      tone: "amber",
      title: `ATM cash withdrawn: ${formatINR(atms)}`,
      body: "Classified as cash withdrawals across your history",
      href: "/recipients?type=Atm",
      cta: "View ATM recipients",
      priority: 30,
    })
  }

  const receivedByPair = new Map<string, number[]>()
  for (const t of tx) {
    if (t.type !== "Received" || !t.nameKey) continue
    const k = `${t.nameKey}|${t.amount}`
    if (!receivedByPair.has(k)) receivedByPair.set(k, [])
    receivedByPair.get(k)!.push(new Date(t.ts).getTime())
  }
  const refundPairs = new Set<string>()
  for (const t of tx) {
    if (t.type !== "Paid" || !t.nameKey) continue
    const k = `${t.nameKey}|${t.amount}`
    const times = receivedByPair.get(k)
    if (!times) continue
    const tTime = new Date(t.ts).getTime()
    if (times.some((r) => Math.abs(r - tTime) <= 7 * 86400000)) refundPairs.add(k)
  }
  if (refundPairs.size > 0) {
    out.push({
      id: "refunds",
      icon: "rotate-ccw",
      tone: "green",
      title: `${refundPairs.size} money-back pair${refundPairs.size > 1 ? "s" : ""} detected`,
      body: "Same amount paid and received back from the same person within 7 days",
      href: "/recipients",
      cta: "Browse recipients",
      priority: 65,
    })
  }

  if (statementMatched > 0) {
    out.push({
      id: "statement-match",
      icon: "file-check",
      tone: "blue",
      title: `${statementMatched} transactions named from your statement`,
      body: "Feb–Jul 2026 GPay statement was correlated to unnamed history",
      href: "/transactions",
      cta: "Explore",
      priority: 40,
    })
  }

  const cashbackTotal = cashback.reduce((s, c) => s + c.amount, 0)
  if (cashbackTotal > 0) {
    out.push({
      id: "cashback",
      icon: "gift",
      tone: "green",
      title: `Earned ${formatINR(cashbackTotal)} in rewards`,
      body: `${cashback.length} cashback credits · ${cashback.length ? formatINR(Math.round(cashbackTotal / cashback.length)) : "₹0"} average`,
      href: "/rewards",
      cta: "View rewards",
      priority: 45,
    })
  }

  const storeSubs = store.filter((t) => t.status === "Complete" && /membership|super chat/i.test(t.description ?? ""))
  if (storeSubs.length > 0) {
    const v = storeSubs.reduce((s, t) => s + t.amount, 0)
    out.push({
      id: "store-subs",
      icon: "refresh-cw",
      tone: "violet",
      title: `${storeSubs.length} store membership${storeSubs.length > 1 ? "s" : ""}`,
      body: `Approx ${formatINR(v)} on memberships / super chats in the Play store`,
      href: "/store",
      cta: "View store",
      priority: 50,
    })
  }

  let groupNet = 0
  let groupItems = 0
  for (const g of groups) {
    for (const it of g.items) {
      if (it.payer !== "Vikram Pawar") continue
      if (it.state === "PAID_RECEIVED") groupNet += it.amount ?? 0
      else {
        groupNet -= it.amount ?? 0
        groupItems++
      }
    }
  }
  if (groupNet !== 0) {
    out.push({
      id: "group-position",
      icon: "split",
      tone: groupNet < 0 ? "amber" : "green",
      title: groupNet < 0 ? `You still owe ${formatINR(-groupNet)}` : `You are owed ${formatINR(groupNet)}`,
      body: groupNet < 0
        ? `${groupItems} pending share${groupItems > 1 ? "s" : ""} across group expenses`
        : "All your group shares are settled up",
      href: "/groups",
      cta: "Settlements",
      priority: 55,
    })
  }

  const hourCount = new Map<number, number>()
  for (const t of tx) {
    if (t.type !== "Paid") continue
    hourCount.set(t.hour, (hourCount.get(t.hour) ?? 0) + 1)
  }
  const peakHour = [...hourCount.entries()].sort((a, b) => b[1] - a[1])[0]
  if (peakHour) {
    const h = peakHour[0]
    const ampm = h >= 12 ? "PM" : "AM"
    const hr = h % 12 === 0 ? 12 : h % 12
    out.push({
      id: "peak-hour",
      icon: "clock",
      tone: "blue",
      title: `Peak payment hour: ${hr}:00 ${ampm}`,
      body: `${peakHour[1]} payments happen then — mostly ${weekdayName(
        [...new Set(tx.filter((t) => t.type === "Paid" && t.hour === h).map((t) => t.weekday))][0]
      )}s`,
      href: "/analytics",
      cta: "See when you spend",
      priority: 25,
    })
  }

  return out.sort((a, b) => b.priority - a.priority)
}

export function latestMonthLabel(tx: UpiTransaction[]): string {
  let last: UpiTransaction | null = null
  for (const t of tx) if (!last || t.ts > last.ts) last = t
  if (!last) return "never"
  return monthLabel(last.year, last.month)
}

export function oldestMonthLabel(tx: UpiTransaction[]): string {
  let first: UpiTransaction | null = null
  for (const t of tx) if (!first || t.ts < first.ts) first = t
  if (!first) return "never"
  return monthLabel(first.year, first.month)
}

export function findLatestTransaction(tx: UpiTransaction[]): UpiTransaction | null {
  return findLatestTx(tx, () => true)
}
