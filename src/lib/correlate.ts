/**
 * Transaction correlation & dedup engine.
 *
 * Rules (conservative — never auto-merge ambiguous matches):
 *
 * 1. EXACT_ID: Same external_id (UPI ref) from different sources
 *    → 100% sure → auto-link (confidence: 1.0, match_method: 'exact_id')
 *
 * 2. AMOUNT_DATE_NAME: Same amount + date + recipient from different sources,
 *    but NO shared external_id → assume DIFFERENT transactions.
 *    → Create a pending correlation (confidence: 0.6, match_method: 'amount_date_name')
 *    → Queue for user approval (status: 'pending')
 *
 * 3. Everything else → no correlation created.
 *
 * The engine NEVER auto-accepts ambiguous matches. User must approve all
 * non-exact correlations.
 */

import type { DbTransaction, DbSourceRecord, DbCorrelation } from "@/lib/data-context"
import type { ParsedTransaction } from "@/lib/parse-takeout"

/* ------------------------------------------------------------------ */
/*  Match confidence thresholds                                         */
/* ------------------------------------------------------------------ */

/** Only auto-accept correlations at this confidence (exact UPI ref). */
export const AUTO_ACCEPT_THRESHOLD = 0.99

/** Minimum confidence to even suggest a correlation. */
export const SUGGEST_THRESHOLD = 0.5

/* ------------------------------------------------------------------ */
/*  Matching functions                                                  */
/* ------------------------------------------------------------------ */

/** Extract a normalised external ID for comparison. */
function normExternalId(id: string | null): string | null {
  if (!id) return null
  const s = id.trim().toLowerCase()
  // Skip generic IDs like "act-123"
  if (/^act-\d+$/.test(s)) return null
  return s
}

/** Same day check (ignoring time). */
function sameDay(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  )
}

/** Amount within tolerance (exact paise match for UPI). */
function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < 1 // < 1 paise tolerance
}

/** Name similarity — exact canonical key match after normalising. */
function sameRecipient(
  nameA: string | null,
  nameKeyA: string | null,
  nameB: string | null,
  nameKeyB: string | null
): boolean {
  // If both have nameKeys, compare canonical keys
  if (nameKeyA && nameKeyB) return nameKeyA === nameKeyB
  // If only one has a nameKey, compare lowercase trimmed names
  if (nameA && nameB) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    return norm(nameA) === norm(nameB)
  }
  // Both null → could be same (both unknown)
  if (!nameA && !nameB) return true
  return false
}

/* ------------------------------------------------------------------ */
/*  Correlation candidates                                              */
/* ------------------------------------------------------------------ */

export interface CorrelationCandidate {
  /** The existing DB transaction to link to. */
  existingTx: DbTransaction
  /** The new source record that matches. */
  newRecord: ParsedTransaction
  /** Match confidence 0–1. */
  confidence: number
  /** How we matched. */
  matchMethod: "exact_id" | "amount_date_name"
  /** Human-readable reason. */
  reason: string
}

/**
 * Compare a batch of new (parsed) transactions against existing DB transactions.
 *
 * Returns:
 * - exactMatches: pairs that share an external_id → auto-link
 * - pendingMatches: same amount+date+name but no shared ID → queue for approval
 * - newOnly: transactions with no match at all → insert as new
 */
export function findCorrelations(
  newTx: ParsedTransaction[],
  existingTx: DbTransaction[]
): {
  exactMatches: CorrelationCandidate[]
  pendingMatches: CorrelationCandidate[]
  newOnly: ParsedTransaction[]
} {
  const exactMatches: CorrelationCandidate[] = []
  const pendingMatches: CorrelationCandidate[] = []
  const newOnly: ParsedTransaction[] = []

  // Index existing transactions by external_id for O(1) lookup
  const byExtId = new Map<string, DbTransaction>()
  for (const tx of existingTx) {
    const eid = normExternalId(tx.external_id)
    if (eid) byExtId.set(eid, tx)
  }

  // Index existing by (day, amount, type) for fuzzy matching
  const byDayAmtType = new Map<string, DbTransaction[]>()
  for (const tx of existingTx) {
    const day = new Date(tx.occurred_at).toISOString().slice(0, 10)
    const key = `${day}|${tx.amount_paise}|${tx.type}`
    const arr = byDayAmtType.get(key) ?? []
    arr.push(tx)
    byDayAmtType.set(key, arr)
  }

  for (const n of newTx) {
    // Skip failed/cancelled transactions
    if (n.status && /^(failed|cancelled)$/i.test(n.status)) {
      newOnly.push(n)
      continue
    }

    // Step 1: Exact external_id match
    const eid = normExternalId(n.id)
    if (eid) {
      const existing = byExtId.get(eid)
      if (existing) {
        exactMatches.push({
          existingTx: existing,
          newRecord: n,
          confidence: 1.0,
          matchMethod: "exact_id",
          reason: `Same UPI ref: ${n.id}`,
        })
        continue
      }
    }

    // Step 2: Same amount + date + type + recipient from different source
    const day = n.ts.slice(0, 10)
    const txType = n.type.toLowerCase() as "paid" | "received" | "sent"
    const key = `${day}|${Math.round(n.amount * 100)}|${txType}`
    const candidates = byDayAmtType.get(key) ?? []

    let bestCandidate: DbTransaction | null = null
    let bestConfidence = 0

    for (const c of candidates) {
      // Must NOT share external_id (that would be exact match above)
      if (eid && normExternalId(c.external_id) === eid) continue

      // Check recipient name match
      if (!sameRecipient(n.name, n.nameKey, c.recipients?.display_name ?? null, null)) continue

      // Same amount + same day + same type + same recipient
      // Confidence: 0.6 (conservative — different sources, no shared ID)
      const confidence = 0.6
      if (confidence > bestConfidence) {
        bestConfidence = confidence
        bestCandidate = c
      }
    }

    if (bestCandidate && bestConfidence >= SUGGEST_THRESHOLD) {
      pendingMatches.push({
        existingTx: bestCandidate,
        newRecord: n,
        confidence: bestConfidence,
        matchMethod: "amount_date_name",
        reason: `Same amount (${n.amount}), date (${day}), recipient (${n.name ?? "?"}), but no shared UPI ref`,
      })
      continue
    }

    // No match found → new transaction
    newOnly.push(n)
  }

  return { exactMatches, pendingMatches, newOnly }
}

/* ------------------------------------------------------------------ */
/*  Build correlation rows for Supabase insert                          */
/* ------------------------------------------------------------------ */

export function buildCorrelationRows(
  matches: CorrelationCandidate[],
  getSourceRecordId: (tx: ParsedTransaction) => string | null
): Omit<DbCorrelation, "id" | "user_id">[] {
  return matches.map((m) => ({
    transaction_id: m.existingTx.id,
    source_record_id: getSourceRecordId(m.newRecord) ?? "",
    confidence: m.confidence,
    match_method: m.matchMethod,
    status: m.matchMethod === "exact_id" ? ("accepted" as const) : ("pending" as const),
    decided_at: m.matchMethod === "exact_id" ? new Date().toISOString() : null,
  }))
}
