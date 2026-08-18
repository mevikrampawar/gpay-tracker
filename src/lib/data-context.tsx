import * as React from "react"
import { useAuth } from "@/lib/auth-context"
import {
  getTransactions,
  getRecipients,
  getCorrelations,
  getSources,
  getStoreTransactions,
  getRewards,
  getVouchers,
  getGroupExpenses,
  updateTransaction,
  subscribeTransactions,
  subscribeRecipients,
  subscribeCorrelations,
  subscribeSources,
  subscribeStoreTransactions,
  subscribeRewards,
  subscribeVouchers,
  subscribeGroupExpenses,
} from "@/lib/firestore-db"
import type {
  DbTransaction as RawDbTransaction,
  DbRecipient,
  DbCorrelation,
  DbStoreTransaction,
  DbReward,
  DbVoucher,
  DbGroupExpense,
} from "@/lib/firestore-db"
import { getCachedData, setCachedData } from "./data-cache"

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type { RawDbTransaction as DbTransaction, DbRecipient, DbCorrelation, DbStoreTransaction, DbReward, DbVoucher, DbGroupExpense }

export type TransactionType = "Paid" | "Received" | "Sent"

export interface UpiTransaction {
  dbId: string
  id: string
  ts: string
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
  type: "Paid" | "Received" | "Sent"
  amount: number
  name: string | null
  nameKey: string | null
  method: string | null
  status: string | null
  note: string
}

/* ------------------------------------------------------------------ */
/*  Convert DbTransaction → UpiTransaction (join with recipients)       */
/* ------------------------------------------------------------------ */

function dbTxToUpiTx(t: RawDbTransaction, recipientsMap: Map<string, DbRecipient>): UpiTransaction {
  const dt = new Date(t.occurred_at)
  const ist = new Date(dt.getTime() + 5.5 * 3600000)
  const typeMap: Record<string, UpiTransaction["type"]> = { paid: "Paid", received: "Received", sent: "Sent" }

  const recipient = t.counterparty_id ? recipientsMap.get(t.counterparty_id) ?? null : null

  return {
    dbId: t.id,
    id: t.external_id ?? t.id,
    ts: t.occurred_at,
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    weekday: ist.getUTCDay(),
    type: typeMap[t.type] ?? "Paid",
    amount: t.amount_paise / 100,
    name: recipient?.display_name ?? recipient?.canonical_name ?? null,
    nameKey: recipient?.canonical_name ?? null,
    method: t.method,
    status: t.status,
    note: t.note ?? "",
  }
}

/* ------------------------------------------------------------------ */
/*  Data context                                                       */
/* ------------------------------------------------------------------ */

export interface DataState {
  dbTransactions: RawDbTransaction[]
  transactions: UpiTransaction[]
  recipients: DbRecipient[]
  correlations: DbCorrelation[]
  storeTransactions: DbStoreTransaction[]
  rewards: DbReward[]
  vouchers: DbVoucher[]
  groupExpenses: DbGroupExpense[]
  hasData: boolean
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  sourceCount: number
  pendingCorrelations: number
  updateTx: (txId: string, data: Partial<Omit<RawDbTransaction, "id">>) => Promise<void>
}

const DataCtx = React.createContext<DataState | null>(null)

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [dbTx, setDbTx] = React.useState<RawDbTransaction[]>([])
  const [recipients, setRecipients] = React.useState<DbRecipient[]>([])
  const [correlations, setCorr] = React.useState<DbCorrelation[]>([])
  const [storeTransactions, setStoreTransactions] = React.useState<DbStoreTransaction[]>([])
  const [rewards, setRewards] = React.useState<DbReward[]>([])
  const [vouchers, setVouchers] = React.useState<DbVoucher[]>([])
  const [groupExpenses, setGroupExpenses] = React.useState<DbGroupExpense[]>([])
  const [sourceCount, setSourceCount] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async (showLoading = false) => {
    if (!user) {
      setDbTx([])
      setRecipients([])
      setCorr([])
      setStoreTransactions([])
      setRewards([])
      setVouchers([])
      setGroupExpenses([])
      setSourceCount(0)
      setLoading(false)
      return
    }
    if (showLoading) setLoading(true)
    setError(null)
    const errors: string[] = []
    const [tx, rec, corr, sources, store, rwds, vchrs, groups] = await Promise.all([
      getTransactions(user.uid).catch((e: unknown) => { errors.push(`transactions: ${e}`); return [] as RawDbTransaction[] }),
      getRecipients(user.uid).catch((e: unknown) => { errors.push(`recipients: ${e}`); return [] as DbRecipient[] }),
      getCorrelations(user.uid).catch((e: unknown) => { errors.push(`correlations: ${e}`); return [] as DbCorrelation[] }),
      getSources(user.uid).catch((e: unknown) => { errors.push(`sources: ${e}`); return [] as { id: string }[] }),
      getStoreTransactions(user.uid).catch((e: unknown) => { errors.push(`store: ${e}`); return [] as DbStoreTransaction[] }),
      getRewards(user.uid).catch((e: unknown) => { errors.push(`rewards: ${e}`); return [] as DbReward[] }),
      getVouchers(user.uid).catch((e: unknown) => { errors.push(`vouchers: ${e}`); return [] as DbVoucher[] }),
      getGroupExpenses(user.uid).catch((e: unknown) => { errors.push(`groups: ${e}`); return [] as DbGroupExpense[] }),
    ])
    setDbTx(tx)
    setRecipients(rec)
    setCorr(corr)
    setStoreTransactions(store)
    setRewards(rwds)
    setVouchers(vchrs)
    setGroupExpenses(groups)
    setSourceCount(sources.length)
    if (errors.length > 0) {
      setError(errors.join("; "))
    }
    setLoading(false)
    setCachedData({ transactions: tx, recipients: rec, correlations: corr, sources, storeTransactions: store, rewards: rwds, vouchers: vchrs, groupExpenses: groups, updatedAt: Date.now() })
  }, [user])

  // Initial load: serve from IDB cache, then subscribe to real-time updates
  React.useEffect(() => {
    if (!user) return
    let cancelled = false

    const load = async () => {
      // Step 1: Try cache for instant render
      const cached = await getCachedData()
      if (cancelled) return
      if (cached) {
        setDbTx(cached.transactions)
        setRecipients(cached.recipients)
        setCorr(cached.correlations)
        setStoreTransactions(cached.storeTransactions ?? [])
        setRewards(cached.rewards ?? [])
        setVouchers(cached.vouchers ?? [])
        setGroupExpenses(cached.groupExpenses ?? [])
        setSourceCount(cached.sources.length)
        setLoading(false)
      } else {
        setLoading(true)
      }

      // Step 2: Subscribe to real-time updates
      const unsubs = [
        subscribeTransactions(user.uid, (txs) => {
          if (cancelled) return
          setDbTx(txs)
          setLoading(false)
        }),
        subscribeRecipients(user.uid, (recs) => {
          if (cancelled) return
          setRecipients(recs)
        }),
        subscribeCorrelations(user.uid, (corrs) => {
          if (cancelled) return
          setCorr(corrs)
        }),
        subscribeSources(user.uid, (srcs) => {
          if (cancelled) return
          setSourceCount(srcs.length)
        }),
        subscribeStoreTransactions(user.uid, (items) => {
          if (cancelled) return
          setStoreTransactions(items)
        }),
        subscribeRewards(user.uid, (items) => {
          if (cancelled) return
          setRewards(items)
        }),
        subscribeVouchers(user.uid, (items) => {
          if (cancelled) return
          setVouchers(items)
        }),
        subscribeGroupExpenses(user.uid, (items) => {
          if (cancelled) return
          setGroupExpenses(items)
        }),
      ]

      return () => {
        cancelled = true
        unsubs.forEach((u) => u())
      }
    }

    let cleanup: (() => void) | undefined
    load().then((fn) => { if (!cancelled) cleanup = fn })
    return () => { cancelled = true; cleanup?.() }
  }, [user])

  // Debounced IDB cache update — writes 5s after last data change
  React.useEffect(() => {
    if (!user || loading) return
    const timeout = setTimeout(() => {
      setCachedData({
        transactions: dbTx,
        recipients,
        correlations,
        sources: [], // sources only tracked by count; cache stores [] as fallback
        storeTransactions,
        rewards,
        vouchers,
        groupExpenses,
        updatedAt: Date.now(),
      })
    }, 5000)
    return () => clearTimeout(timeout)
  }, [user, loading, dbTx, recipients, correlations, storeTransactions, rewards, vouchers, groupExpenses])

  const recipientsMap = React.useMemo(
    () => new Map(recipients.map((r) => [r.id, r])),
    [recipients]
  )

  const transactions = React.useMemo(
    () => dbTx.map((t) => dbTxToUpiTx(t, recipientsMap)),
    [dbTx, recipientsMap]
  )

  const hasData = dbTx.length > 0 || sourceCount > 0
  const pendingCorrelations = correlations.filter((c) => c.status === "pending").length

  const updateTx = React.useCallback(async (txId: string, data: Partial<Omit<RawDbTransaction, "id">>) => {
    if (!user) return
    await updateTransaction(user.uid, txId, data)
    refresh(false)
  }, [user, refresh])

  return (
    <DataCtx.Provider value={{
      dbTransactions: dbTx,
      transactions,
      recipients,
      correlations,
      storeTransactions,
      rewards,
      vouchers,
      groupExpenses,
      hasData,
      loading,
      error,
      refresh,
      sourceCount,
      pendingCorrelations,
      updateTx,
    }}>
      {children}
    </DataCtx.Provider>
  )
}

export function useData() {
  const ctx = React.useContext(DataCtx)
  if (!ctx) throw new Error("useData must be inside DataProvider")
  return ctx
}
