/**
 * Upload orchestrator — ties parsing, dedup, and Supabase insert together.
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
import { restGet, restPost } from "@/lib/supabase"
import type { DbTransaction, DbRecipient, DbSourceRecord } from "@/lib/data-context"

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
/*  Ensure recipient exists in recipients table                          */
/* ------------------------------------------------------------------ */

async function ensureRecipient(
  _userId: string,
  rawName: string | null
): Promise<string | null> {
  if (!rawName) return null
  const key = nameKey(rawName)
  if (!key) return null

  // Try to find existing
  const existing = await restGet<DbRecipient[]>(
    `recipients?select=id&canonical_name=eq.${encodeURIComponent(key)}&limit=1`
  )
  if (existing.length > 0) return existing[0].id

  // Create new
  const created = await restPost<DbRecipient[]>(
    "recipients",
    [{
      canonical_name: key,
      display_name: rawName,
      kind: "auto",
    }]
  )
  return created[0]?.id ?? null
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

  // 1. Extract ZIP
  const zip = await JSZip.loadAsync(file)

  // 2. Find My Activity.html
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

  // 3. Hash the file for dedup
  const fileData = await file.arrayBuffer()
  const contentHash = await hashContent(fileData)

  // Check if this exact file was already imported
  const existingSources = await restGet<{ id: string }[]>(
    `sources?select=id&content_hash=eq.${contentHash}&limit=1`
  )
  if (existingSources.length > 0) {
    result.errors.push("This file was already imported (same content hash). Skipping.")
    return result
  }

  // 4. Create source record
  const [source] = await restPost<{ id: string }[]>(
    "sources",
    [{
      kind: "takeout",
      label: file.name,
      file_name: file.name,
      content_hash: contentHash,
      raw_record_count: parsedTx.length,
    }]
  )
  result.sourceId = source.id

  onProgress?.(55, "Running correlation engine…")

  // 5. Run correlation engine
  const { exactMatches, pendingMatches, newOnly } = findCorrelations(parsedTx, existingTx)

  result.exactMatches = exactMatches.length
  result.pendingMatches = pendingMatches.length

  onProgress?.(65, `Inserting ${newOnly.length} new transactions…`)

  // 6. Insert source records (all parsed transactions)
  const sourceRecords = parsedTx.map((t, i) => ({
    source_id: source.id,
    row_index: i,
    raw: t as unknown as Record<string, unknown>,
  }))

  // Batch insert source records (500 at a time)
  const BATCH = 500
  const insertedRecords: DbSourceRecord[] = []
  for (let i = 0; i < sourceRecords.length; i += BATCH) {
    const batch = sourceRecords.slice(i, i + BATCH)
    const recs = await restPost<DbSourceRecord[]>("source_records", batch)
    insertedRecords.push(...recs)
  }

  // Build a map from parsed tx id → source_record id
  const recordIdMap = new Map<string, string>()
  for (let i = 0; i < insertedRecords.length; i++) {
    recordIdMap.set(parsedTx[i].id, insertedRecords[i].id)
  }

  onProgress?.(75, "Creating recipients & inserting transactions…")

  // 7. Insert new transactions
  const txRows: Record<string, unknown>[] = []
  const recipientCache = new Map<string, string | null>()

  for (const t of newOnly) {
    // Ensure recipient exists
    if (t.name && !recipientCache.has(t.nameKey ?? "")) {
      const rid = await ensureRecipient(userId, t.name)
      recipientCache.set(t.nameKey ?? "", rid)
    }

    const direction = t.type === "Received" ? "in" : "out"
    txRows.push({
      occurred_at: t.ts,
      amount_paise: Math.round(t.amount * 100),
      direction,
      type: t.type.toLowerCase(),
      method: t.method,
      status: t.status,
      external_id: t.id,
      counterparty_id: recipientCache.get(t.nameKey ?? "") ?? null,
      note: t.note,
    })
  }

  // Batch insert transactions
  const insertedTx: DbTransaction[] = []
  for (let i = 0; i < txRows.length; i += BATCH) {
    const batch = txRows.slice(i, i + BATCH)
    const txs = await restPost<DbTransaction[]>("transactions", batch)
    insertedTx.push(...txs)
  }

  result.inserted = insertedTx.length

  onProgress?.(85, "Creating correlations…")

  // 8. Create correlations for exact matches
  const corrRows = buildCorrelationRows(exactMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  // Also create pending correlations for fuzzy matches
  const pendingCorrRows = buildCorrelationRows(pendingMatches, (pt) => recordIdMap.get(pt.id) ?? null)

  const allCorrRows = [...corrRows, ...pendingCorrRows].filter((r) => r.source_record_id)
  if (allCorrRows.length > 0) {
    await restPost("correlations", allCorrRows)
  }

  // 9. Auto-apply names from exact matches to existing transactions
  for (const m of exactMatches) {
    if (!m.newRecord.name) continue
    // Update the existing transaction's counterparty if it was null
    if (!m.existingTx.counterparty_id) {
      const rid = await ensureRecipient(userId, m.newRecord.name)
      if (rid) {
        await restPost("transactions", [{
          id: m.existingTx.id,
          counterparty_id: rid,
        }])
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
  _userId: string,
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

  // Hash for dedup
  const fileData = await file.arrayBuffer()
  const contentHash = await hashContent(fileData)
  const existingSources = await restGet<{ id: string }[]>(
    `sources?select=id&content_hash=eq.${contentHash}&limit=1`
  )
  if (existingSources.length > 0) {
    result.errors.push("This file was already imported (same content hash). Skipping.")
    return result
  }

  // Create source
  const [source] = await restPost<{ id: string }[]>(
    "sources",
    [{
      kind: "bank_csv",
      label: file.name,
      file_name: file.name,
      content_hash: contentHash,
      raw_record_count: bankTx.length,
    }]
  )
  result.sourceId = source.id

  // Insert source records
  const sourceRecords = bankTx.map((t, i) => ({
    source_id: source.id,
    row_index: i,
    raw: t as unknown as Record<string, unknown>,
  }))

  const BATCH = 500
  const insertedRecords: DbSourceRecord[] = []
  for (let i = 0; i < sourceRecords.length; i += BATCH) {
    const batch = sourceRecords.slice(i, i + BATCH)
    const recs = await restPost<DbSourceRecord[]>("source_records", batch)
    insertedRecords.push(...recs)
  }

  // Convert bank tx to ParsedTransaction format for correlation
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

  // Insert new bank transactions
  const txRows: Record<string, unknown>[] = []
  for (const t of newOnly) {
    const direction = t.type === "Received" ? "in" : "out"
    txRows.push({
      occurred_at: t.ts,
      amount_paise: Math.round(t.amount * 100),
      direction,
      type: t.type.toLowerCase(),
      method: t.method,
      status: t.status,
      external_id: t.id,
      counterparty_id: null,
      note: t.note,
    })
  }

  const insertedTx: DbTransaction[] = []
  for (let i = 0; i < txRows.length; i += BATCH) {
    const batch = txRows.slice(i, i + BATCH)
    const txs = await restPost<DbTransaction[]>("transactions", batch)
    insertedTx.push(...txs)
  }

  result.inserted = insertedTx.length

  // Create correlations
  const recordIdMap = new Map<string, string>()
  for (let i = 0; i < insertedRecords.length; i++) {
    recordIdMap.set(converted[i].id, insertedRecords[i].id)
  }

  const corrRows = buildCorrelationRows(exactMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  const pendingCorrRows = buildCorrelationRows(pendingMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  const allCorrRows = [...corrRows, ...pendingCorrRows].filter((r) => r.source_record_id)
  if (allCorrRows.length > 0) {
    await restPost("correlations", allCorrRows)
  }

  onProgress?.(100, `Done! ${result.inserted} new, ${result.exactMatches} linked, ${result.pendingMatches} pending review.`)
  return result
}

/* ------------------------------------------------------------------ */
/*  Upload bank XLSX                                                    */
/* ------------------------------------------------------------------ */

export async function uploadBankXlsx(
  file: File,
  _userId: string,
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

  // Hash for dedup
  const fileData = await file.arrayBuffer()
  const contentHash = await hashContent(fileData)
  const existingSources = await restGet<{ id: string }[]>(
    `sources?select=id&content_hash=eq.${contentHash}&limit=1`
  )
  if (existingSources.length > 0) {
    result.errors.push("This file was already imported (same content hash). Skipping.")
    return result
  }

  // Create source
  const [source] = await restPost<{ id: string }[]>(
    "sources",
    [{
      kind: "bank_csv",
      label: file.name,
      file_name: file.name,
      content_hash: contentHash,
      raw_record_count: bankTx.length,
    }]
  )
  result.sourceId = source.id

  // Insert source records
  const sourceRecords = bankTx.map((t, i) => ({
    source_id: source.id,
    row_index: i,
    raw: t as unknown as Record<string, unknown>,
  }))

  const BATCH = 500
  const insertedRecords: DbSourceRecord[] = []
  for (let i = 0; i < sourceRecords.length; i += BATCH) {
    const batch = sourceRecords.slice(i, i + BATCH)
    const recs = await restPost<DbSourceRecord[]>("source_records", batch)
    insertedRecords.push(...recs)
  }

  // Convert bank tx to ParsedTransaction format for correlation
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

  // Insert new bank transactions
  const txRows: Record<string, unknown>[] = []
  for (const t of newOnly) {
    const direction = t.type === "Received" ? "in" : "out"
    txRows.push({
      occurred_at: t.ts,
      amount_paise: Math.round(t.amount * 100),
      direction,
      type: t.type.toLowerCase(),
      method: t.method,
      status: t.status,
      external_id: t.id,
      counterparty_id: null,
      note: t.note,
    })
  }

  const insertedTx: DbTransaction[] = []
  for (let i = 0; i < txRows.length; i += BATCH) {
    const batch = txRows.slice(i, i + BATCH)
    const txs = await restPost<DbTransaction[]>("transactions", batch)
    insertedTx.push(...txs)
  }

  result.inserted = insertedTx.length

  // Create correlations
  const recordIdMap = new Map<string, string>()
  for (let i = 0; i < insertedRecords.length; i++) {
    recordIdMap.set(converted[i].id, insertedRecords[i].id)
  }

  const corrRows = buildCorrelationRows(exactMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  const pendingCorrRows = buildCorrelationRows(pendingMatches, (pt) => recordIdMap.get(pt.id) ?? null)
  const allCorrRows = [...corrRows, ...pendingCorrRows].filter((r) => r.source_record_id)
  if (allCorrRows.length > 0) {
    await restPost("correlations", allCorrRows)
  }

  onProgress?.(100, `Done! ${result.inserted} new, ${result.exactMatches} linked, ${result.pendingMatches} pending review.`)
  return result
}