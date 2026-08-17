import * as React from "react"
import { restGet } from "@/lib/supabase"
import { useAuth } from "@/lib/auth-context"
import { bundle, type UpiTransaction, type StoreTransaction, type CashbackReward, type Voucher, type GroupExpense } from "@/data/bundle"

/* ------------------------------------------------------------------ */
/*  Types matching the Supabase schema                                 */
/* ------------------------------------------------------------------ */

export interface DbTransaction {
  id: string
  occurred_at: string
  amount_paise: number
  direction: "in" | "out"
  type: "paid" | "received" | "sent"
  method: string | null
  status: string | null
  external_id: string | null
  counterparty_id: string | null
  note: string | null
  recipients?: DbRecipient | null
}

export interface DbRecipient {
  id: string
  canonical_name: string
  display_name: string | null
  kind: string
  notes: string | null
}

export interface DbCorrelation {
  id: string
  transaction_id: string
  source_record_id: string
  confidence: number
  match_method: string
  status: "pending" | "accepted" | "rejected"
  decided_at: string | null
}

export interface DbSourceRecord {
  id: string
  source_id: string
  row_index: number
  raw: Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/*  Convert DbTransaction → UpiTransaction (bundle-compatible)          */
/* ------------------------------------------------------------------ */

function dbTxToUpiTx(t: DbTransaction): UpiTransaction {
  const dt = new Date(t.occurred_at)
  // Convert UTC back to IST display values
  const ist = new Date(dt.getTime() + 5.5 * 3600000)
  const typeMap: Record<string, UpiTransaction["type"]> = { paid: "Paid", received: "Received", sent: "Sent" }
  return {
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
    name: t.recipients?.display_name ?? t.recipients?.canonical_name ?? null,
    nameKey: t.recipients?.canonical_name ?? null,
    method: t.method,
    status: t.status,
    note: t.note ?? "",
  }
}

/* ------------------------------------------------------------------ */
/*  Data context                                                       */
/* ------------------------------------------------------------------ */

export interface DataState {
  /** Raw Supabase transactions */
  dbTransactions: DbTransaction[]
  /** Bundle-compatible transactions (from Supabase or fallback to bundle) */
  transactions: UpiTransaction[]
  /** Recipients from Supabase */
  recipients: DbRecipient[]
  /** Correlations from Supabase */
  correlations: DbCorrelation[]
  /** Store transactions (from bundle — not yet in Supabase) */
  storeTransactions: StoreTransaction[]
  /** Cashback rewards (from bundle) */
  cashback: CashbackReward[]
  /** Vouchers (from bundle) */
  vouchers: Voucher[]
  /** Group expenses (from bundle) */
  groupExpenses: GroupExpense[]
  /** Statement correlation count */
  statementMatched: number
  /** Whether user has any uploaded data */
  hasData: boolean
  /** True while loading from Supabase */
  loading: boolean
  /** Error message if fetch failed */
  error: string | null
  /** Re-fetch from Supabase */
  refresh: () => Promise<void>
  /** Source records count */
  sourceCount: number
  /** Pending correlations count */
  pendingCorrelations: number
}

const DataCtx = React.createContext<DataState | null>(null)

const PAGE = 1000

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { user, supabaseReady } = useAuth()
  const [dbTx, setDbTx] = React.useState<DbTransaction[]>([])
  const [recipients, setRecipients] = React.useState<DbRecipient[]>([])
  const [correlations, setCorr] = React.useState<DbCorrelation[]>([])
  const [sourceCount, setSourceCount] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (!supabaseReady || !user) {
      setDbTx([])
      setRecipients([])
      setCorr([])
      setSourceCount(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [tx, rec, corr, sources] = await Promise.all([
        restGet<DbTransaction[]>(
          `master.transactions?select=*,identity.recipients(display_name,canonical_name,kind)&order=occurred_at.desc&limit=${PAGE}`
        ),
        restGet<DbRecipient[]>(
          `identity.recipients?select=*&order=canonical_name`
        ),
        restGet<DbCorrelation[]>(
          `master.correlations?select=*&order=created_at.desc&limit=5000`
        ),
        restGet<{ id: string }[]>(
          `master.sources?select=id&limit=100`
        ),
      ])
      setDbTx(tx)
      setRecipients(rec)
      setCorr(corr)
      setSourceCount(sources.length)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [supabaseReady, user])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  // Convert DB transactions to bundle-compatible format
  const transactions = React.useMemo(() => {
    if (dbTx.length > 0) {
      return dbTx.map(dbTxToUpiTx)
    }
    // Fallback to bundle when no Supabase data
    return bundle.transactions
  }, [dbTx])

  const hasData = dbTx.length > 0 || sourceCount > 0
  const pendingCorrelations = correlations.filter((c) => c.status === "pending").length

  return (
    <DataCtx.Provider value={{
      dbTransactions: dbTx,
      transactions,
      recipients,
      correlations,
      storeTransactions: bundle.storeTransactions,
      cashback: bundle.cashback,
      vouchers: bundle.vouchers,
      groupExpenses: bundle.groupExpenses,
      statementMatched: bundle.meta.statementMatched ?? 0,
      hasData,
      loading,
      error,
      refresh,
      sourceCount,
      pendingCorrelations,
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
