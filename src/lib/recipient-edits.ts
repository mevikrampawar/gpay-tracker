import * as React from "react"
import type { CounterpartyClass } from "@/lib/classify"
import type { UpiTransaction } from "@/lib/data-context"
import { nameKey } from "@/lib/parse-takeout"

/**
 * Recipient editing & relations.
 *
 * Beyond auto-detected names and the class override (localStorage), you can now:
 *   - rename a recipient (custom display name),
 *   - attach aliases (other names that belong to the same entity),
 *   - link/merge one recipient into another (linkedTo),
 *   - name an individual unknown transaction (txNames).
 *
 * Everything is stored locally (no network), so the dashboard stays fully offline.
 */

export { nameKey }

export interface RecipientEdit {
  /** Custom display name. */
  name?: string
  /** Other nameKeys that belong to this same recipient. */
  aliases?: string[]
  /** Merge this recipient into another nameKey. */
  linkedTo?: string
  /** Classification override. */
  cls?: CounterpartyClass
}

/** Follow linkedTo chains + aliases to the canonical nameKey of an entity. */

export type RecipientEdits = Record<string, RecipientEdit>

/** txId -> display name for transactions that had no recipient name. */
export type TxNames = Record<string, string>

const EDITS_KEY = "gpay_recipient_edits_v1"
const TXNAMES_KEY = "gpay_tx_names_v1"

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null ? parsed : fallback
  } catch {
    return fallback
  }
}

/** Follow linkedTo chains + aliases to the canonical nameKey of an entity. */
export function resolveKey(nameKeyIn: string | null, edits: RecipientEdits): string | null {
  if (!nameKeyIn) return null
  let cur = nameKeyIn
  for (const [k, e] of Object.entries(edits)) {
    if ((e.aliases ?? []).includes(cur)) {
      cur = k
      break
    }
  }
  const seen = new Set<string>()
  while (edits[cur]?.linkedTo && !seen.has(cur)) {
    seen.add(cur)
    cur = edits[cur]!.linkedTo!
  }
  return cur || null
}

/** Effective display name for a canonical key. */
export function displayName(canonicalKey: string, fallbackName: string, edits: RecipientEdits): string {
  const custom = edits[canonicalKey]?.name?.trim()
  return custom || fallbackName
}

/** Which nameKeys point at (or merge into) the given canonical key. */
export function linkedNames(canonicalKey: string, edits: RecipientEdits): string[] {
  const out: string[] = []
  for (const [k, e] of Object.entries(edits)) {
    if (k === canonicalKey) {
      out.push(...(e.aliases ?? []))
      continue
    }
    if (resolveKey(k, edits) === canonicalKey) out.push(k)
  }
  return [...new Set(out)]
}

export interface EnrichedTx extends UpiTransaction {
  /** True when no name was known and none has been attached. */
  isUnknown: boolean
  /** Canonical key after aliases/merges. */
  canonicalKey: string | null
}

/**
 * Produce transactions with effective name/nameKey applied:
 *   tx-level names -> recipient renames -> alias/merge resolution.
 */
export function enrichTransactions(
  tx: UpiTransaction[],
  edits: RecipientEdits,
  txNames: TxNames
): EnrichedTx[] {
  return tx.map((t) => {
    let rawKey = t.nameKey
    let rawName = t.name
    const custom = txNames[t.id]
    if (custom) {
      rawKey = nameKey(custom)
      rawName = custom.trim()
    }
    if (!rawKey || !rawName) {
      return { ...t, isUnknown: true, canonicalKey: null }
    }
    const canonical = resolveKey(rawKey, edits) ?? rawKey
    return {
      ...t,
      name: displayName(canonical, rawName, edits),
      nameKey: canonical,
      isUnknown: false,
      canonicalKey: canonical,
    }
  })
}

export function useRecipientEdits() {
  const [edits, setEdits] = React.useState<RecipientEdits>(() => readJSON(EDITS_KEY, {}))
  const [txNames, setTxNames] = React.useState<TxNames>(() => readJSON(TXNAMES_KEY, {}))

  React.useEffect(() => {
    try {
      localStorage.setItem(EDITS_KEY, JSON.stringify(edits))
    } catch { /* ignore quota */ }
  }, [edits])

  React.useEffect(() => {
    try {
      localStorage.setItem(TXNAMES_KEY, JSON.stringify(txNames))
    } catch { /* ignore quota */ }
  }, [txNames])

  const setEdit = React.useCallback((key: string, patch: Partial<RecipientEdit>) => {
    setEdits((prev) => {
      const next = { ...prev }
      const merged = { ...(next[key] ?? {}), ...patch }
      // Prune empty edits
      if (!merged.name && !merged.aliases?.length && !merged.linkedTo && !merged.cls) {
        delete next[key]
      } else {
        next[key] = merged
      }
      return next
    })
  }, [])

  const removeEdit = React.useCallback((key: string) => {
    setEdits((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  /** Merge srcKey into targetKey (srcKey transactions get regrouped under targetKey). */
  const mergeInto = React.useCallback((srcKey: string, targetKey: string) => {
    if (!srcKey || !targetKey || srcKey === targetKey) return
    setEdits((prev) => {
      const next = { ...prev }
      const src = next[srcKey] ?? {}
      delete next[srcKey]
      const tgt = next[targetKey] ?? {}
      next[targetKey] = {
        ...tgt,
        aliases: [...new Set([...(tgt.aliases ?? []), srcKey])],
      }
      // If src had a name that differs, keep it as an alias too.
      if (src.name && src.name.trim().toLowerCase() !== (tgt.name ?? targetKey).toLowerCase()) {
        next[targetKey] = { ...next[targetKey], aliases: [...(next[targetKey].aliases ?? []), nameKey(src.name)] }
      }
      return next
    })
  }, [])

  const setTxName = React.useCallback((txId: string, name: string | null) => {
    setTxNames((prev) => {
      const next = { ...prev }
      if (name && name.trim()) next[txId] = name.trim()
      else delete next[txId]
      return next
    })
  }, [])

  const clearTxNames = React.useCallback(() => setTxNames({}), [])

  return {
    edits,
    txNames,
    setEdit,
    removeEdit,
    mergeInto,
    setTxName,
    clearTxNames,
  }
}

export type UseRecipientEdits = ReturnType<typeof useRecipientEdits>
