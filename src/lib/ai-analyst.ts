import type { UpiTransaction } from "@/lib/data-context"
import { computeTotals } from "@/lib/analytics"
import { dateLabel } from "@/lib/format"
import type { RecipientEdits, TxNames } from "@/lib/recipient-edits"

/* ------------------------------------------------------------------ */
/*  Local on-device AI: name suggestions for unknown transactions       */
/* ------------------------------------------------------------------ */

export interface UnknownSuggestion {
  txId: string
  name: string
  confidence: number
  reason: string
  amount: number
  type: string
  ts: string
  method: string | null
}


export function suggestUnknownNames(
  tx: UpiTransaction[],
  edits: RecipientEdits,
  txNames: TxNames
): UnknownSuggestion[] {
  // Signature -> dominant recipient name, for named transactions.
  const sig = new Map<string, Map<string, number>>()
  const amountOnly = new Map<string, Map<string, number>>()
  const amountMethod = new Map<string, Map<string, number>>()
  for (const t of tx) {
    if (!t.name || !t.nameKey) continue
    const key = resolveKeyOr(t.nameKey, edits)
    const name = edits[key]?.name?.trim() || t.name
    const bucket = Math.floor(t.hour / 3) * 3
    const mk = `${t.amount}|${t.method ?? "?"}|${bucket}|${t.weekday}`
    if (!sig.has(mk)) sig.set(mk, new Map())
    sig.get(mk)!.set(name, (sig.get(mk)!.get(name) ?? 0) + 1)

    const ak = `${t.amount}`
    if (!amountOnly.has(ak)) amountOnly.set(ak, new Map())
    amountOnly.get(ak)!.set(name, (amountOnly.get(ak)!.get(name) ?? 0) + 1)

    const amk = `${t.amount}|${t.method ?? "?"}`
    if (!amountMethod.has(amk)) amountMethod.set(amk, new Map())
    amountMethod.get(amk)!.set(name, (amountMethod.get(amk)!.get(name) ?? 0) + 1)
  }

  const dominant = (map: Map<string, number>, minShare: number) => {
    const total = [...map.values()].reduce((s, n) => s + n, 0)
    const [name, count] = [...map.entries()].sort((a, b) => b[1] - a[1])[0]
    if (!name || count < 2) return null
    if (count / total < minShare) return null
    return { name, count, total }
  }

  const out: UnknownSuggestion[] = []
  for (const t of tx) {
    if (t.name !== null || t.nameKey !== null) continue
    if (txNames[t.id]) continue

    const bucket = Math.floor(t.hour / 3) * 3
    const mk = `${t.amount}|${t.method ?? "?"}|${bucket}|${t.weekday}`
    const fromSig = dominant(sig.get(mk) ?? new Map(), 0.6)
    if (fromSig) {
      const confidence = Math.min(0.8, 0.55 + fromSig.count * 0.04)
      out.push({
        txId: t.id,
        name: fromSig.name,
        confidence,
        reason: `${fromSig.name} is the usual recipient for ₹${t.amount} on ${
          ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][t.weekday]
        }s ${t.method ? `(${t.method})` : ""} — ${fromSig.count} similar payments`,
        amount: t.amount,
        type: t.type,
        ts: t.ts,
        method: t.method,
      })
      continue
    }

    const fromAm = dominant(amountMethod.get(`${t.amount}|${t.method ?? "?"}`) ?? new Map(), 0.7)
    if (fromAm) {
      out.push({
        txId: t.id,
        name: fromAm.name,
        confidence: 0.5,
        reason: `₹${t.amount} ${t.method ? `via ${t.method} ` : ""}almost always goes to ${fromAm.name} (${fromAm.count}×)`,
        amount: t.amount,
        type: t.type,
        ts: t.ts,
        method: t.method,
      })
      continue
    }

    const fromAmt = dominant(amountOnly.get(String(t.amount)) ?? new Map(), 0.85)
    if (fromAmt) {
      out.push({
        txId: t.id,
        name: fromAmt.name,
        confidence: 0.4,
        reason: `₹${t.amount} payments usually go to ${fromAmt.name} (${fromAmt.count}×)`,
        amount: t.amount,
        type: t.type,
        ts: t.ts,
        method: t.method,
      })
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence)
}

function resolveKeyOr(k: string, edits: RecipientEdits): string {
  let cur = k
  for (const [ek, e] of Object.entries(edits)) {
    if ((e.aliases ?? []).includes(cur)) {
      cur = ek
      break
    }
  }
  const seen = new Set<string>()
  while (edits[cur]?.linkedTo && !seen.has(cur)) {
    seen.add(cur)
    cur = edits[cur]!.linkedTo!
  }
  return cur
}

/* ------------------------------------------------------------------ */
/*  Narrative analysis                                                  */
/* ------------------------------------------------------------------ */

export interface AiPoint {
  icon: string
  text: string
}

export interface AiNarrative {
  title: string
  summary: string
  points: AiPoint[]
}

export function buildAiNarrative(
  tx: UpiTransaction[],
  recipientsCount: number,
  unknownCount: number,
  suggestibleHigh: number,
  statementMatched: number,
  avgMonthlySpend: number,
  lastMonthSpend: number,
  lastMonthLabel: string
): AiNarrative {
  const totals = computeTotals(tx)
  const points: AiPoint[] = []

  const top = [...tx]
    .filter((t) => t.type === "Paid" && t.name)
    .sort((a, b) => b.amount - a.amount)[0]

  if (top?.name) {
    points.push({
      icon: "maximize",
      text: `Your biggest single payment ever was ${top.name ? `₹${top.amount.toLocaleString("en-IN")} to ${top.name}` : `₹${top.amount.toLocaleString("en-IN")}`} on ${dateLabel(top.year, top.month, top.day)}.`,
    })
  }

  const share = totals.outflow ? (totals.paidCount ? totals.outflow / Math.max(1, totals.paidCount) : 0) : 0
  points.push({
    icon: "activity",
    text: `Across ${totals.count.toLocaleString()} transactions you moved ₹${totals.outflow.toLocaleString("en-IN")} out and ₹${totals.inflow.toLocaleString("en-IN")} in — an average of ₹${Math.round(share).toLocaleString("en-IN")} per outgoing payment.`,
  })

  points.push({
    icon: "users",
    text: `You've transacted with ${recipientsCount.toLocaleString()} distinct entities, split into merchants, people, platforms, ATMs and Google services.`,
  })

  points.push({
    icon: "trending-up",
    text: `${lastMonthLabel} spending was ₹${lastMonthSpend.toLocaleString("en-IN")}, against a lifetime average of about ₹${avgMonthlySpend.toLocaleString("en-IN")} a month.`,
  })

  if (statementMatched > 0) {
    points.push({
      icon: "file-check",
      text: `I correlated your Feb–Jul 2026 GPay statement and used it to name ${statementMatched.toLocaleString()} previously unnamed transactions.`,
    })
  }

  if (unknownCount > 0) {
    points.push({
      icon: "help-circle",
      text: `${unknownCount.toLocaleString()} transactions still have no recipient name. ${suggestibleHigh.toLocaleString()} of them have a high-confidence suggestion I can apply for you.`,
    })
  }

  const summary = `Your Google Pay history spans ${totals.count.toLocaleString()} UPI transactions with a net cash flow of ₹${(
    totals.inflow - totals.outflow - totals.sent
  ).toLocaleString("en-IN")} across the whole period.`

  return {
    title: "Your money story",
    summary,
    points,
  }
}

/* ------------------------------------------------------------------ */
/*  Explainer: why some transactions are unknown                        */
/* ------------------------------------------------------------------ */

export interface ExplainBlock {
  heading: string
  body: string
}

export const WHY_UNKNOWN: ExplainBlock[] = [
  {
    heading: "Google's export only keeps the name when it recorded one",
    body:
      "The Takeout 'My Activity' file stores a recipient name only when the note Google captured included one. For many payments the note is just 'Paid ₹500.00' or 'Received ₹60.00' — no counterparty at all — so nothing to display.",
  },
  {
    heading: "QR / collect / link payments often carry no saved name",
    body:
      "When you scan a QR code, pay a collect request or use a payment link, Google Pay frequently records only the amount, time and funding bank. The merchant's name lives on the merchant's side, not in your export.",
  },
  {
    heading: "Received money is usually anonymous in the export",
    body:
      "Incoming 'Received ₹X' entries are especially bare — Google deliberately strips the sender from My Activity for privacy. That's why nearly all unnamed transactions are Received.",
  },
  {
    heading: "That's why amount search was your only lever",
    body:
      "With no name in the data, there is literally nothing for a name search to match against — searching by amount, date and method is the only reliable way to find an unknown transaction. Once a name is attached (statement correlation, my suggestions, or your own edit), it becomes instantly searchable by name everywhere.",
  },
  {
    heading: "How we fix it here",
    body:
      "1) Your Feb–Jul 2026 statement was correlated automatically. 2) This page's AI suggests names using patterns (same amount+time+method → same recipient). 3) You can name transactions yourself, rename recipients, add aliases and merge duplicates — all stored locally, all instantly reflected across the dashboard.",
  },
]
