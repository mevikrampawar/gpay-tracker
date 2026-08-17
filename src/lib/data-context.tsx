import * as React from "react"
import { useAuth } from "@/lib/auth-context"
import {
  getTransactions,
  getRecipients,
  getCorrelations,
  getSources,
} from "@/lib/firestore-db"
import type {
  DbTransaction as RawDbTransaction,
  DbRecipient,
  DbCorrelation,
} from "@/lib/firestore-db"

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type { RawDbTransaction as DbTransaction, DbRecipient, DbCorrelation }

export type TransactionType = "Paid" | "Received" | "Sent"

export interface UpiTransaction {
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
  hasData: boolean
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  sourceCount: number
  pendingCorrelations: number
}

const DataCtx = React.createContext<DataState | null>(null)

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [dbTx, setDbTx] = React.useState<RawDbTransaction[]>([])
  const [recipients, setRecipients] = React.useState<DbRecipient[]>([])
  const [correlations, setCorr] = React.useState<DbCorrelation[]>([])
  const [sourceCount, setSourceCount] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (!user) {
      setDbTx([])
      setRecipients([])
      setCorr([])
      setSourceCount(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const errors: string[] = []
    const [tx, rec, corr, sources] = await Promise.all([
      getTransactions(user.uid).catch((e: unknown) => { errors.push(`transactions: ${e}`); return [] as RawDbTransaction[] }),
      getRecipients(user.uid).catch((e: unknown) => { errors.push(`recipients: ${e}`); return [] as DbRecipient[] }),
      getCorrelations(user.uid).catch((e: unknown) => { errors.push(`correlations: ${e}`); return [] as DbCorrelation[] }),
      getSources(user.uid).catch((e: unknown) => { errors.push(`sources: ${e}`); return [] as { id: string }[] }),
    ])
    setDbTx(tx)
    setRecipients(rec)
    setCorr(corr)
    setSourceCount(sources.length)
    if (errors.length > 0) {
      setError(errors.join("; "))
    }
    setLoading(false)
  }, [user])

  React.useEffect(() => {
    refresh()
  }, [refresh])

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

  return (
    <DataCtx.Provider value={{
      dbTransactions: dbTx,
      transactions,
      recipients,
      correlations,
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
