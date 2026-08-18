/**
 * Firestore data layer — replaces Supabase entirely.
 *
 * Data model (per-user subcollections):
 *   users/{uid}/transactions/{id}
 *   users/{uid}/recipients/{id}       (doc id = canonical_name)
 *   users/{uid}/correlations/{id}
 *   users/{uid}/sources/{id}           (doc id = content_hash)
 *   users/{uid}/source_records/{id}
 */

import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  orderBy,
  limit as fbLimit,
  onSnapshot,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore"
import { db } from "@/lib/firebase"

/* ------------------------------------------------------------------ */
/*  Types (same shapes as before, minus server-generated fields)        */
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
  // joined from recipients (client-side)
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

export interface DbSource {
  id: string
  kind: string
  label: string
  file_name: string
  content_hash: string
  raw_record_count: number
}

/* ------------------------------------------------------------------ */
/*  Collection helpers                                                  */
/* ------------------------------------------------------------------ */

function col(userId: string, name: string) {
  return collection(db, "users", userId, name)
}

function docRef(userId: string, coll: string, id: string) {
  return doc(db, "users", userId, coll, id)
}

/* ------------------------------------------------------------------ */
/*  Reads                                                               */
/* ------------------------------------------------------------------ */

export async function getTransactions(userId: string, max = 10000): Promise<DbTransaction[]> {
  const snap = await getDocs(
    query(col(userId, "transactions"), orderBy("occurred_at", "desc"), fbLimit(max))
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbTransaction))
}

export async function getRecipients(userId: string): Promise<DbRecipient[]> {
  const snap = await getDocs(
    query(col(userId, "recipients"), orderBy("canonical_name"))
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbRecipient))
}

export async function getCorrelations(userId: string, max = 50000): Promise<DbCorrelation[]> {
  const snap = await getDocs(
    query(col(userId, "correlations"), fbLimit(max))
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbCorrelation))
}

export async function getSources(userId: string): Promise<{ id: string }[]> {
  const snap = await getDocs(col(userId, "sources"))
  return snap.docs.map((d) => ({ id: d.id }))
}

export async function getSourceByHash(
  userId: string,
  hash: string
): Promise<{ id: string }[]> {
  const docSnap = await getDoc(docRef(userId, "sources", hash))
  return docSnap.exists() ? [{ id: docSnap.id }] : []
}

export async function getRecipientByName(
  userId: string,
  canonicalName: string
): Promise<DbRecipient[]> {
  const docSnap = await getDoc(docRef(userId, "recipients", canonicalName))
  return docSnap.exists()
    ? [{ id: docSnap.id, ...docSnap.data() } as DbRecipient]
    : []
}

/* ------------------------------------------------------------------ */
/*  Writes                                                              */
/* ------------------------------------------------------------------ */

/** Insert a source. Uses content_hash as doc ID for natural dedup. */
export async function insertSource(
  userId: string,
  data: Omit<DbSource, "id">
): Promise<DbSource> {
  const id = data.content_hash
  await setDoc(docRef(userId, "sources", id), data)
  return { id, ...data }
}

/** Insert a recipient. Uses canonical_name as doc ID. */
export async function insertRecipient(
  userId: string,
  data: Omit<DbRecipient, "id">
): Promise<DbRecipient> {
  const id = data.canonical_name
  await setDoc(docRef(userId, "recipients", id), data)
  return { id, ...data }
}

/** Batch-insert source records. Returns the inserted docs with IDs. */
export async function insertSourceRecords(
  userId: string,
  rows: Omit<DbSourceRecord, "id">[]
): Promise<DbSourceRecord[]> {
  const BATCH = 500
  const results: DbSourceRecord[] = []

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const wb = writeBatch(db)
    const refs: { ref: ReturnType<typeof doc>; data: Omit<DbSourceRecord, "id"> }[] = []

    for (const row of batch) {
      const ref = doc(col(userId, "source_records"))
      refs.push({ ref, data: row })
      wb.set(ref, row)
    }
    await wb.commit()
    results.push(...refs.map((r) => ({ id: r.ref.id, ...r.data })))
  }
  return results
}

/** Batch-insert transactions. Returns the inserted docs with IDs. */
export async function insertTransactions(
  userId: string,
  rows: Omit<DbTransaction, "id" | "recipients">[]
): Promise<DbTransaction[]> {
  const BATCH = 500
  const results: DbTransaction[] = []

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const wb = writeBatch(db)
    const refs: { ref: ReturnType<typeof doc>; data: Omit<DbTransaction, "id" | "recipients"> }[] = []

    for (const row of batch) {
      const ref = doc(col(userId, "transactions"))
      refs.push({ ref, data: row })
      wb.set(ref, row)
    }
    await wb.commit()
    results.push(...refs.map((r) => ({ id: r.ref.id, ...r.data } as DbTransaction)))
  }
  return results
}

/** Batch-insert correlations. */
export async function insertCorrelations(
  userId: string,
  rows: Omit<DbCorrelation, "id">[]
): Promise<void> {
  const BATCH = 500
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const wb = writeBatch(db)
    for (const row of batch) {
      const ref = doc(col(userId, "correlations"))
      wb.set(ref, row)
    }
    await wb.commit()
  }
}

/** Update a single transaction (e.g., set counterparty_id). */
export async function updateTransaction(
  userId: string,
  txId: string,
  data: Partial<Omit<DbTransaction, "id">>
): Promise<void> {
  await updateDoc(docRef(userId, "transactions", txId), data as DocumentData)
}

/* ------------------------------------------------------------------ */
/*  Store Transactions                                                  */
/* ------------------------------------------------------------------ */

export interface DbStoreTransaction {
  id: string
  ts: string | null
  year: number | null
  month: number | null
  description: string | null
  product: string | null
  payment_method: string | null
  status: string | null
  amount_paise: number
  source_id: string | null
}

export async function getStoreTransactions(userId: string, max = 5000): Promise<DbStoreTransaction[]> {
  const snap = await getDocs(query(col(userId, "store_transactions"), fbLimit(max)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbStoreTransaction))
}

export async function insertStoreTransactions(
  userId: string,
  rows: Omit<DbStoreTransaction, "id">[]
): Promise<{ id: string }[]> {
  if (rows.length === 0) return []
  const refs: { id: string; ref: DocumentReference }[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const batch = writeBatch(db)
    const chunk = rows.slice(i, i + 500)
    for (const row of chunk) {
      const ref = doc(col(userId, "store_transactions"))
      batch.set(ref, row)
      refs.push({ id: ref.id, ref })
    }
    await batch.commit()
  }
  return refs.map((r) => ({ id: r.id }))
}

/* ------------------------------------------------------------------ */
/*  Rewards                                                             */
/* ------------------------------------------------------------------ */

export interface DbReward {
  id: string
  ts: string
  year: number
  month: number
  currency: string
  amount_paise: number
  description: string | null
  source_id: string | null
}

export async function getRewards(userId: string, max = 5000): Promise<DbReward[]> {
  const snap = await getDocs(query(col(userId, "rewards"), fbLimit(max)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbReward))
}

export async function insertRewards(
  userId: string,
  rows: Omit<DbReward, "id">[]
): Promise<{ id: string }[]> {
  if (rows.length === 0) return []
  const refs: { id: string; ref: DocumentReference }[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const batch = writeBatch(db)
    const chunk = rows.slice(i, i + 500)
    for (const row of chunk) {
      const ref = doc(col(userId, "rewards"))
      batch.set(ref, row)
      refs.push({ id: ref.id, ref })
    }
    await batch.commit()
  }
  return refs.map((r) => ({ id: r.id }))
}

/* ------------------------------------------------------------------ */
/*  Vouchers                                                            */
/* ------------------------------------------------------------------ */

export interface DbVoucher {
  id: string
  code: string
  summary: string
  details: string
  expiry_timestamp: string | null
  source_id: string | null
}

export async function getVouchers(userId: string, max = 5000): Promise<DbVoucher[]> {
  const snap = await getDocs(query(col(userId, "vouchers"), fbLimit(max)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbVoucher))
}

export async function insertVouchers(
  userId: string,
  rows: Omit<DbVoucher, "id">[]
): Promise<{ id: string }[]> {
  if (rows.length === 0) return []
  const refs: { id: string; ref: DocumentReference }[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const batch = writeBatch(db)
    const chunk = rows.slice(i, i + 500)
    for (const row of chunk) {
      const ref = doc(col(userId, "vouchers"))
      batch.set(ref, row)
      refs.push({ id: ref.id, ref })
    }
    await batch.commit()
  }
  return refs.map((r) => ({ id: r.id }))
}

/* ------------------------------------------------------------------ */
/*  Group Expenses                                                      */
/* ------------------------------------------------------------------ */

export interface DbGroupExpense {
  id: string
  group_name: string
  creator: string
  state: string
  title: string
  created_at: string
  total_amount_paise: number | null
  items: Array<{ amount: number | null; state: string; payer: string }>
  source_id: string | null
}

export async function getGroupExpenses(userId: string, max = 5000): Promise<DbGroupExpense[]> {
  const snap = await getDocs(query(col(userId, "group_expenses"), fbLimit(max)))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbGroupExpense))
}

export async function insertGroupExpenses(
  userId: string,
  rows: Omit<DbGroupExpense, "id">[]
): Promise<{ id: string }[]> {
  if (rows.length === 0) return []
  const refs: { id: string; ref: DocumentReference }[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const batch = writeBatch(db)
    const chunk = rows.slice(i, i + 500)
    for (const row of chunk) {
      const ref = doc(col(userId, "group_expenses"))
      batch.set(ref, row)
      refs.push({ id: ref.id, ref })
    }
    await batch.commit()
  }
  return refs.map((r) => ({ id: r.id }))
}

/* ------------------------------------------------------------------ */
/*  Real-time subscriptions                                             */
/* ------------------------------------------------------------------ */

export function subscribeTransactions(
  userId: string,
  callback: (txs: DbTransaction[]) => void,
  max = 10000
): () => void {
  return onSnapshot(
    query(col(userId, "transactions"), orderBy("occurred_at", "desc"), fbLimit(max)),
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbTransaction)))
    }
  )
}

export function subscribeRecipients(
  userId: string,
  callback: (recs: DbRecipient[]) => void
): () => void {
  return onSnapshot(
    query(col(userId, "recipients"), orderBy("canonical_name")),
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbRecipient)))
    }
  )
}

export function subscribeCorrelations(
  userId: string,
  callback: (corr: DbCorrelation[]) => void,
  max = 50000
): () => void {
  return onSnapshot(
    query(col(userId, "correlations"), fbLimit(max)),
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbCorrelation)))
    }
  )
}

export function subscribeSources(
  userId: string,
  callback: (src: { id: string }[]) => void
): () => void {
  return onSnapshot(
    col(userId, "sources"),
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id })))
    }
  )
}

export function subscribeStoreTransactions(
  userId: string,
  callback: (items: DbStoreTransaction[]) => void,
  max = 5000
): () => void {
  return onSnapshot(
    query(col(userId, "store_transactions"), fbLimit(max)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbStoreTransaction)))
  )
}

export function subscribeRewards(
  userId: string,
  callback: (items: DbReward[]) => void,
  max = 5000
): () => void {
  return onSnapshot(
    query(col(userId, "rewards"), fbLimit(max)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbReward)))
  )
}

export function subscribeVouchers(
  userId: string,
  callback: (items: DbVoucher[]) => void,
  max = 5000
): () => void {
  return onSnapshot(
    query(col(userId, "vouchers"), fbLimit(max)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbVoucher)))
  )
}

export function subscribeGroupExpenses(
  userId: string,
  callback: (items: DbGroupExpense[]) => void,
  max = 5000
): () => void {
  return onSnapshot(
    query(col(userId, "group_expenses"), fbLimit(max)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DbGroupExpense)))
  )
}
