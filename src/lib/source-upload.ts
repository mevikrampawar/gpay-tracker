/**
 * Upload orchestrator — ties parsing, dedup, and Firestore insert together.
 *
 * Flow:
 *   1. User drops a ZIP (Takeout) or individual files (CSV, XLS)
 *   2. Files are extracted and parsed client-side
 *   3. Correlation engine checks for duplicates against existing DB data
 *   4. New transactions are inserted; exact matches are linked; fuzzy matches queued
 *   5. Data context is refreshed
 */

import JSZip from "jszip"
import { parseMyActivityHtml, parseBankCsv, parseBankXlsx, nameKey, type ParsedTransaction } from "@/lib/parse-takeout"
import { findCorrelations, buildCorrelationRows } from "@/lib/correlate"
import {
  getSourceByHash,
  insertSource,
  insertSourceRecords,
  insertRecipient,
  insertTransactions,
  insertCorrelations,
  updateTransaction,
  getRecipientByName,
  type DbTransaction,
} from "@/lib/firestore-db"

/* ------------------------------------------------------------------ */
/*  Upload result                                                      */
/* ------------------------------------------------------------------ */

export interface UploadResult {
  sourceId: string
  sourceLabel: string
  sourceKind: "takeout" | "bank_csv"
  totalParsed: number
  skipped: number
  inserted: number
  exactMatches: number
  pendingMatches: number
  errors: string[]
}

/* ------------------------------------------------------------------ */
/*  Content hashing (simple — for dedup at file level)                  */
/* ------------------------------------------------------------------ */

async function hashContent(data: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

/* ------------------------------------------------------------------ */
/*  Ensure recipient exists in Firestore                                */
/* ------------------------------------------------------------------ */

async function ensureRecipient(
  userId: string,
  rawName: string | null
): Promise<string | null> {
  if (!rawName) return null
  const key = nameKey(rawName)
  if (!key) return null

  const existing = await getRecipientByName(userId, key)
  if (existing.length > 0) return existing[0].id

  const created = await insertRecipient(userId, {
    canonical_name: key,
    display_name: rawName,
    kind: "auto",
    notes: null,
  })
  return created.id
}

/* ------------------------------------------------------------------ */
/*  Main upload function                                               */
/* ------------------------------------------------------------------ */

export async function uploadTakeoutZip(
  file: File,
  userId: string,
  existingTx: DbTransaction[],
  onProgress?: (pct: number, msg: string) => void
): Promise<UploadResult> {
  const result: UploadResult = {
    sourceId: "",
    sourceLabel: file.name,
    sourceKind: "takeout",
    totalParsed: 0,
    skipped: 0,
    inserted: 0,
    exactMatches: 0,
    pendingMatches: 0,
    errors: [],
  }

  onProgress?.(5, "Reading ZIP file…")

  const zip = await JSZip.loadAsync(file)
  const activityFile = zip.file(/My Activity\.html$/i)?.[0]
  if (!activityFile) {
    result.errors.push("Could not find 'My Activity.html' inside the ZIP. Make sure you're uploading your Google Takeout ZIP.")
    return result
  }

  onProgress?.(20, "Parsing Google Pay activity…")

  const activityHtml = await activityFile.async("text")
  const { transactions: parsedTx, skipped } = parseMyActivityHtml(activityHtml)
  result.totalParsed = parsedTx.length
  result.skipped = skipped

  onProgress?.(40, `Found ${parsedTx.length} transactions. Checking for duplicates…`)

  const fileData = await file.arrayBuffer()
  const contentHash = await hashContent(fileData)

  const existingSources = await getSourceByHash(userId, contentHash)
  if (existingSources.length > 0) {
    result.errors.push("This file was already imported (same content hash). Skipping.")
    return result
  }

  const source = await insertSource(userId, {
    kind: "takeout",
    label: file.name,
    file_name: file.name,
    content_hash: contentHash,
    raw_record_count: parsedTx.length,
  })
  result.sourceId = source.id

  onProgress?.(55, "Running correlation engine…")

  const { exactMatches, pendingMatches, newOnly } = findCorrelations(parsedTx, existingTx)
  result.exactMatches = exactMatches.length
  result.pendingMatches = pendingMatches.length

  onProgress?.(65, `Inserting ${newOnly.length} new transactions…`)

  const sourceRecords = parsedTx.map((t, i) => ({
    source_id: source.id,
    row_index: i,
    raw: t as unknown as Record<string, unknown>,
  }))

  const insertedRecords = await insertSourceRecords(userId, sourceRecords)

  const recordIdMap = new Map<string, string>()
  for (let i = 0; i < insertedRecords.length; i++) {
    recordIdMap.set(parsedTx[i].id, insertedRecords[i].id)
  }

  onProgress?.(75, "Creating recipients & inserting transactions…")

  const txRows: Omit<DbTransaction, "id" | "recipients">[] = []
  const recipientCache = new Map<string, string | null>()

  for (const t of newOnly) {
    if (t.name && !recipientCache.has(t.nameKey ?? "")) {
      const rid = await ensureRecipient(userId, t.name)
      recipientCache.set(t.nameKey ?? "", rid)
    }

    const direction = t.type === "Received" ? "in" : "out"
    txRows.push({
      occurred_at: t.ts,
      amount_paise: Math.round(t.amount * 100),
      direction,
      type: t.type.toLowerCase() as "paid" | "received" | "sent",
      method: t.method,
      status: t.status,
      external_id: t.id,
      counterparty_id: recipientCache.get(t.nameKey ?? "") ?? null,
      note: t.note,
    })
  }

  const insertedTx = await insertTransactions(userId, txRows)
  result.inserted = insertedTx.length

  onProgress?.(85, "Creating correlations…")

  const corrRows = buildCorrelationRows(exactMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  const pendingCorrRows = buildCorrelationRows(pendingMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  const allCorrRows = [...corrRows, ...pendingCorrRows].filter((r) => r.source_record_id)
  if (allCorrRows.length > 0) {
    await insertCorrelations(userId, allCorrRows)
  }

  for (const m of exactMatches) {
    if (!m.newRecord.name) continue
    if (!m.existingTx.counterparty_id) {
      const rid = await ensureRecipient(userId, m.newRecord.name)
      if (rid) {
        await updateTransaction(userId, m.existingTx.id, { counterparty_id: rid })
      }
    }
  }

  onProgress?.(100, `Done! ${result.inserted} new, ${result.exactMatches} linked, ${result.pendingMatches} pending review.`)
  return result
}

/* ------------------------------------------------------------------ */
/*  Upload bank CSV                                                    */
/* ------------------------------------------------------------------ */

export async function uploadBankCsv(
  file: File,
  userId: string,
  existingTx: DbTransaction[],
  onProgress?: (pct: number, msg: string) => void
): Promise<UploadResult> {
  const result: UploadResult = {
    sourceId: "",
    sourceLabel: file.name,
    sourceKind: "bank_csv",
    totalParsed: 0,
    skipped: 0,
    inserted: 0,
    exactMatches: 0,
    pendingMatches: 0,
    errors: [],
  }

  onProgress?.(10, "Reading CSV file…")

  const text = await file.text()
  const bankTx = parseBankCsv(text)
  result.totalParsed = bankTx.length

  if (bankTx.length === 0) {
    result.errors.push("No transactions found in CSV. Expected HDFC bank statement format.")
    return result
  }

  onProgress?.(30, `Found ${bankTx.length} bank transactions. Checking for duplicates…`)

  const fileData = await file.arrayBuffer()
  const contentHash = await hashContent(fileData)
  const existingSources = await getSourceByHash(userId, contentHash)
  if (existingSources.length > 0) {
    result.errors.push("This file was already imported (same content hash). Skipping.")
    return result
  }

  const source = await insertSource(userId, {
    kind: "bank_csv",
    label: file.name,
    file_name: file.name,
    content_hash: contentHash,
    raw_record_count: bankTx.length,
  })
  result.sourceId = source.id

  const sourceRecords = bankTx.map((t, i) => ({
    source_id: source.id,
    row_index: i,
    raw: t as unknown as Record<string, unknown>,
  }))

  const insertedRecords = await insertSourceRecords(userId, sourceRecords)

  const converted: ParsedTransaction[] = bankTx.map((b, i) => {
    const dt = new Date(b.date)
    const isDeposit = b.deposit !== null && b.deposit > 0
    const amount = isDeposit ? (b.deposit ?? 0) : (b.withdrawal ?? 0)
    return {
      id: b.upiRef ?? b.ref ?? `bank-${i}`,
      ts: dt.toISOString(),
      year: dt.getFullYear(),
      month: dt.getMonth() + 1,
      day: dt.getDate(),
      hour: dt.getHours(),
      minute: dt.getMinutes(),
      weekday: dt.getDay(),
      type: isDeposit ? "Received" as const : "Paid" as const,
      amount,
      name: null,
      nameKey: null,
      method: "bank_transfer",
      status: "Completed",
      note: b.narration,
    }
  })

  onProgress?.(50, "Running correlation engine…")

  const { exactMatches, pendingMatches, newOnly } = findCorrelations(converted, existingTx)
  result.exactMatches = exactMatches.length
  result.pendingMatches = pendingMatches.length

  const txRows: Omit<DbTransaction, "id" | "recipients">[] = []
  for (const t of newOnly) {
    const direction = t.type === "Received" ? "in" : "out"
    txRows.push({
      occurred_at: t.ts,
      amount_paise: Math.round(t.amount * 100),
      direction,
      type: t.type.toLowerCase() as "paid" | "received" | "sent",
      method: t.method,
      status: t.status,
      external_id: t.id,
      counterparty_id: null,
      note: t.note,
    })
  }

  const insertedTx = await insertTransactions(userId, txRows)
  result.inserted = insertedTx.length

  const recordIdMap = new Map<string, string>()
  for (let i = 0; i < insertedRecords.length; i++) {
    recordIdMap.set(converted[i].id, insertedRecords[i].id)
  }

  const corrRows = buildCorrelationRows(exactMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  const pendingCorrRows = buildCorrelationRows(pendingMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  const allCorrRows = [...corrRows, ...pendingCorrRows].filter((r) => r.source_record_id)
  if (allCorrRows.length > 0) {
    await insertCorrelations(userId, allCorrRows)
  }

  onProgress?.(100, `Done! ${result.inserted} new, ${result.exactMatches} linked, ${result.pendingMatches} pending review.`)
  return result
}

/* ------------------------------------------------------------------ */
/*  Upload bank XLSX                                                    */
/* ------------------------------------------------------------------ */

export async function uploadBankXlsx(
  file: File,
  userId: string,
  existingTx: DbTransaction[],
  onProgress?: (pct: number, msg: string) => void
): Promise<UploadResult> {
  const result: UploadResult = {
    sourceId: "",
    sourceLabel: file.name,
    sourceKind: "bank_csv",
    totalParsed: 0,
    skipped: 0,
    inserted: 0,
    exactMatches: 0,
    pendingMatches: 0,
    errors: [],
  }

  onProgress?.(10, "Reading XLSX file…")

  const bankTx = await parseBankXlsx(file)
  result.totalParsed = bankTx.length

  if (bankTx.length === 0) {
    result.errors.push("No transactions found in XLSX. Expected HDFC bank statement format.")
    return result
  }

  onProgress?.(30, `Found ${bankTx.length} bank transactions. Checking for duplicates…`)

  const fileData = await file.arrayBuffer()
  const contentHash = await hashContent(fileData)
  const existingSources = await getSourceByHash(userId, contentHash)
  if (existingSources.length > 0) {
    result.errors.push("This file was already imported (same content hash). Skipping.")
    return result
  }

  const source = await insertSource(userId, {
    kind: "bank_csv",
    label: file.name,
    file_name: file.name,
    content_hash: contentHash,
    raw_record_count: bankTx.length,
  })
  result.sourceId = source.id

  const sourceRecords = bankTx.map((t, i) => ({
    source_id: source.id,
    row_index: i,
    raw: t as unknown as Record<string, unknown>,
  }))

  const insertedRecords = await insertSourceRecords(userId, sourceRecords)

  const converted: ParsedTransaction[] = bankTx.map((b, i) => {
    const dt = new Date(b.date)
    const isDeposit = b.deposit !== null && b.deposit > 0
    const amount = isDeposit ? (b.deposit ?? 0) : (b.withdrawal ?? 0)
    return {
      id: b.upiRef ?? b.ref ?? `bank-${i}`,
      ts: dt.toISOString(),
      year: dt.getFullYear(),
      month: dt.getMonth() + 1,
      day: dt.getDate(),
      hour: dt.getHours(),
      minute: dt.getMinutes(),
      weekday: dt.getDay(),
      type: isDeposit ? "Received" as const : "Paid" as const,
      amount,
      name: null,
      nameKey: null,
      method: "bank_transfer",
      status: "Completed",
      note: b.narration,
    }
  })

  onProgress?.(50, "Running correlation engine…")

  const { exactMatches, pendingMatches, newOnly } = findCorrelations(converted, existingTx)
  result.exactMatches = exactMatches.length
  result.pendingMatches = pendingMatches.length

  const txRows: Omit<DbTransaction, "id" | "recipients">[] = []
  for (const t of newOnly) {
    const direction = t.type === "Received" ? "in" : "out"
    txRows.push({
      occurred_at: t.ts,
      amount_paise: Math.round(t.amount * 100),
      direction,
      type: t.type.toLowerCase() as "paid" | "received" | "sent",
      method: t.method,
      status: t.status,
      external_id: t.id,
      counterparty_id: null,
      note: t.note,
    })
  }

  const insertedTx = await insertTransactions(userId, txRows)
  result.inserted = insertedTx.length

  const recordIdMap = new Map<string, string>()
  for (let i = 0; i < insertedRecords.length; i++) {
    recordIdMap.set(converted[i].id, insertedRecords[i].id)
  }

  const corrRows = buildCorrelationRows(exactMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  const pendingCorrRows = buildCorrelationRows(pendingMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  const allCorrRows = [...corrRows, ...pendingCorrRows].filter((r) => r.source_record_id)
  if (allCorrRows.length > 0) {
    await insertCorrelations(userId, allCorrRows)
  }

  onProgress?.(100, `Done! ${result.inserted} new, ${result.exactMatches} linked, ${result.pendingMatches} pending review.`)
  return result
}
