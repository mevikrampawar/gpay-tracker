/**
 * Upload orchestrator — ties parsing, dedup, and Firestore insert together.
 *
 * Each upload function follows a 4-phase flow with IndexedDB persistence:
 *   1. HASH + STORE:  Hash file, create source in Firestore, persist job in IDB
 *   2. PARSE:         Parse file into ParsedTransaction[], persist in IDB
 *   3. CORRELATE:     Run correlation engine against existing DB data, persist in IDB
 *   4. WRITE:         Batch-write to Firestore, delete job from IDB
 *
 * If the page reloads mid-upload, the job is resumed from the last persisted phase.
 */

import JSZip from "jszip"
import {
  parseMyActivityHtml,
  parseBankCsv,
  parseBankXlsx,
  parseStoreTransactionsCsv,
  parseCashbackRewards,
  parseVoucherRewards,
  parseGroupExpenses,
  nameKey,
  PasswordRequiredError,
  type ParsedTransaction,
  type StoreTransaction,
  type CashbackReward,
  type Voucher,
  type GroupExpense,
} from "@/lib/parse-takeout"
export { PasswordRequiredError }
import { findCorrelations, buildCorrelationRows, type CorrelationCandidate } from "@/lib/correlate"
import {
  getSourceByHash,
  getTransactions,
  insertSource,
  insertSourceRecords,
  insertRecipient,
  insertTransactions,
  insertCorrelations,
  insertStoreTransactions,
  insertRewards,
  insertVouchers,
  insertGroupExpenses,
  updateTransaction,
  getRecipientByName,
  type DbTransaction,
} from "@/lib/firestore-db"
import {
  hashContent,
  enqueueJob,
  getJob,
  updateJob,
  completeJob,
  type UploadJob,
} from "@/lib/upload-queue"

export { type UploadJob, getIncompleteJobs, deleteJob } from "@/lib/upload-queue"

/**
 * Parse Indian DD/MM/YY date format.
 * HDFC bank statements use DD/MM/YY, not MM/DD/YY.
 */
function parseIndianDate(dateStr: string): Date | null {
  const trimmed = dateStr.trim()
  const parts = trimmed.split("/")
  if (parts.length < 3) return null

  const [dd, mm, yy] = parts
  const day = parseInt(dd, 10)
  const month = parseInt(mm, 10)
  let year = parseInt(yy, 10)
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null

  // Handle 2-digit years
  if (year < 100) year += 2000

  // Validate ranges
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  const dt = new Date(year, month - 1, day)
  // Verify the date is valid (handles Feb 30, etc.)
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null

  return dt
}

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
/*  Shared: build UploadResult from job + counts                       */
/* ------------------------------------------------------------------ */

function buildResult(
  job: UploadJob,
  counts: {
    totalParsed: number
    skipped?: number
    inserted: number
    exactMatches: number
    pendingMatches: number
    errors: string[]
  }
): UploadResult {
  return {
    sourceId: job.sourceId ?? "",
    sourceLabel: job.fileName,
    sourceKind: job.fileKind === "takeout" ? "takeout" : "bank_csv",
    totalParsed: counts.totalParsed,
    skipped: counts.skipped ?? 0,
    inserted: counts.inserted,
    exactMatches: counts.exactMatches,
    pendingMatches: counts.pendingMatches,
    errors: counts.errors,
  }
}

/* ------------------------------------------------------------------ */
/*  Upload Takeout ZIP                                                 */
/* ------------------------------------------------------------------ */

export async function uploadTakeoutZip(
  file: File,
  userId: string,
  onProgress?: (pct: number, log: string) => void
): Promise<UploadResult> {
  const fileBytes = await file.arrayBuffer()
  const contentHash = await hashContent(fileBytes)
  const contentHashCopy = new Uint8Array(fileBytes).buffer

  // Check for existing source in Firestore (dedup)
  const existingSources = await getSourceByHash(userId, contentHash)
  if (existingSources.length > 0) {
    return buildResult(
      { id: contentHash, fileName: file.name, fileKind: "takeout", fileBytes: contentHashCopy, phase: "stored", createdAt: Date.now(), updatedAt: Date.now() },
      { totalParsed: 0, skipped: 0, inserted: 0, exactMatches: 0, pendingMatches: 0, errors: ["This file was already imported (same content hash). Skipping."] }
    )
  }

  // Check IDB for existing job
  let job = await getJob(contentHash)
  if (!job) {
    await enqueueJob({ id: contentHash, fileName: file.name, fileKind: "takeout", fileBytes: contentHashCopy })
    job = (await getJob(contentHash))!
  }

  // --- Phase 1: STORED (already done above) ---

  // --- Phase 2: PARSE ---
  let parsedTx: ParsedTransaction[] = []
  let parsedStore: StoreTransaction[] = []
  let parsedRewards: CashbackReward[] = []
  let parsedVouchers: Voucher[] = []
  let parsedGroupExpenses: GroupExpense[] = []
  let skipped = 0
  if (job.phase === "stored") {
    onProgress?.(20, "Extracting and parsing Google Pay activity…")
    try {
      const zip = await JSZip.loadAsync(job.fileBytes)
      const activityFile = zip.file(/My Activity\.html$/i)?.[0]
      if (!activityFile) {
        await updateJob(job.id, { phase: "error", error: "Could not find 'My Activity.html' inside the ZIP." })
        return buildResult(job, { totalParsed: 0, inserted: 0, exactMatches: 0, pendingMatches: 0, errors: ["Could not find 'My Activity.html' inside the ZIP. Make sure you're uploading your Google Takeout ZIP."] })
      }

      const activityHtml = await activityFile.async("text")
      const parsed = parseMyActivityHtml(activityHtml)
      parsedTx = parsed.transactions
      skipped = parsed.skipped

      // Parse Store/Subscriptions CSV
      const storeFile = zip.file(/Google transactions\/.*\.csv$/i)?.[0]
      if (storeFile) {
        const csvText = await storeFile.async("text")
        parsedStore = parseStoreTransactionsCsv(csvText)
      }

      // Parse Cashback Rewards CSV
      const cashbackFile = zip.file(/Cashback Rewards\.csv$/i)?.[0]
      if (cashbackFile) {
        const csvText = await cashbackFile.async("text")
        parsedRewards = parseCashbackRewards(csvText)
      }

      // Parse Voucher Rewards JSON
      const voucherFile = zip.file(/Voucher Rewards\.json$/i)?.[0]
      if (voucherFile) {
        const jsonText = await voucherFile.async("text")
        parsedVouchers = parseVoucherRewards(jsonText)
      }

      // Parse Group Expenses JSON
      const groupFile = zip.file(/Group expenses\.json$/i)?.[0]
      if (groupFile) {
        const jsonText = await groupFile.async("text")
        parsedGroupExpenses = parseGroupExpenses(jsonText)
      }

      await updateJob(job.id, {
        phase: "parsed",
        parsed: parsedTx,
        parsedStore,
        parsedRewards,
        parsedVouchers,
        parsedGroupExpenses,
      })
      job = (await getJob(job.id))!
      onProgress?.(40, `Parsed ${parsedTx.length} transactions, ${parsedStore.length} store, ${parsedRewards.length} rewards, ${parsedVouchers.length} vouchers, ${parsedGroupExpenses.length} group expenses (${skipped} skipped).`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateJob(job.id, { phase: "error", error: msg })
      throw err
    }
  } else {
    parsedTx = job.parsed ?? []
    parsedStore = job.parsedStore ?? []
    parsedRewards = job.parsedRewards ?? []
    parsedVouchers = job.parsedVouchers ?? []
    parsedGroupExpenses = job.parsedGroupExpenses ?? []
    skipped = 0
  }

  // --- Phase 3: CORRELATE ---
  let exactMatches: CorrelationCandidate[] = []
  let pendingMatches: CorrelationCandidate[] = []
  let newOnly: ParsedTransaction[] = []
  if (job.phase === "parsed") {
    onProgress?.(50, "Running correlation engine…")
    try {
      const existingTx = await getTransactions(userId)
      const corr = findCorrelations(parsedTx, existingTx)
      exactMatches = corr.exactMatches
      pendingMatches = corr.pendingMatches
      newOnly = corr.newOnly

      await updateJob(job.id, {
        phase: "correlated",
        correlationResult: { exactMatches, pendingMatches, newOnly },
      })
      job = (await getJob(job.id))!
      onProgress?.(60, `Correlation complete: ${newOnly.length} new, ${exactMatches.length} exact, ${pendingMatches.length} pending.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateJob(job.id, { phase: "error", error: msg })
      throw err
    }
  } else {
    exactMatches = job.correlationResult?.exactMatches ?? []
    pendingMatches = job.correlationResult?.pendingMatches ?? []
    newOnly = job.correlationResult?.newOnly ?? []
  }

  // --- Phase 4: WRITE ---
  if (job.phase === "correlated") {
    onProgress?.(70, `Inserting ${newOnly.length} new transactions…`)
    try {
      const source = await insertSource(userId, {
        kind: "takeout",
        label: job.fileName,
        file_name: job.fileName,
        content_hash: contentHash,
        raw_record_count: parsedTx.length,
      })
      await updateJob(job.id, { sourceId: source.id })
      job = (await getJob(job.id))!

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

      onProgress?.(80, "Creating recipients & inserting transactions…")
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

      onProgress?.(90, "Creating correlations…")
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

      onProgress?.(92, "Writing store transactions, rewards, vouchers & group expenses…")
      // Write store transactions
      if (parsedStore.length > 0) {
        const storeRows = parsedStore.map((t) => ({
          ts: t.ts, year: t.year, month: t.month,
          description: t.description, product: t.product,
          payment_method: t.paymentMethod, status: t.status,
          amount_paise: Math.round(t.amount * 100),
          source_id: source.id,
        }))
        await insertStoreTransactions(userId, storeRows)
      }
      // Write rewards
      if (parsedRewards.length > 0) {
        const rewardRows = parsedRewards.map((r) => ({
          ts: r.ts, year: r.year, month: r.month,
          currency: r.currency, amount_paise: Math.round(r.amount * 100),
          description: r.description, source_id: source.id,
        }))
        await insertRewards(userId, rewardRows)
      }
      // Write vouchers
      if (parsedVouchers.length > 0) {
        const voucherRows = parsedVouchers.map((v) => ({
          code: v.code, summary: v.summary, details: v.details,
          expiry_timestamp: v.expiryTimestamp, source_id: source.id,
        }))
        await insertVouchers(userId, voucherRows)
      }
      // Write group expenses
      if (parsedGroupExpenses.length > 0) {
        const groupRows = parsedGroupExpenses.map((g) => ({
          group_name: g.groupName, creator: g.creator, state: g.state,
          title: g.title, created_at: g.createdAt,
          total_amount_paise: g.totalAmount ? Math.round(g.totalAmount * 100) : null,
          items: g.items, source_id: source.id,
        }))
        await insertGroupExpenses(userId, groupRows)
      }

      await completeJob(job.id)

      const result = buildResult(job, {
        totalParsed: parsedTx.length,
        skipped,
        inserted: insertedTx.length,
        exactMatches: exactMatches.length,
        pendingMatches: pendingMatches.length,
        errors: [],
      })
      onProgress?.(100, `Done! ${result.inserted} transactions, ${parsedStore.length} store, ${parsedRewards.length} rewards, ${parsedVouchers.length} vouchers, ${parsedGroupExpenses.length} group expenses imported.`)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateJob(job.id, { phase: "error", error: msg })
      throw err
    }
  }

  // Job was already written (resume from terminal state)
  return buildResult(job, {
    totalParsed: parsedTx.length,
    skipped,
    inserted: 0,
    exactMatches: exactMatches.length,
    pendingMatches: pendingMatches.length,
    errors: [],
  })
}

/* ------------------------------------------------------------------ */
/*  Upload bank CSV                                                    */
/* ------------------------------------------------------------------ */

export async function uploadBankCsv(
  file: File,
  userId: string,
  onProgress?: (pct: number, log: string) => void
): Promise<UploadResult> {
  const fileBytes = await file.arrayBuffer()
  const contentHash = await hashContent(fileBytes)
  const contentHashCopy = new Uint8Array(fileBytes).buffer

  const existingSources = await getSourceByHash(userId, contentHash)
  if (existingSources.length > 0) {
    return buildResult(
      { id: contentHash, fileName: file.name, fileKind: "bank_csv", fileBytes: contentHashCopy, phase: "stored", createdAt: Date.now(), updatedAt: Date.now() },
      { totalParsed: 0, inserted: 0, exactMatches: 0, pendingMatches: 0, errors: ["This file was already imported (same content hash). Skipping."] }
    )
  }

  let job = await getJob(contentHash)
  if (!job) {
    await enqueueJob({ id: contentHash, fileName: file.name, fileKind: "bank_csv", fileBytes: contentHashCopy })
    job = (await getJob(contentHash))!
  }

  // --- Phase 2: PARSE ---
  let parsedTx: ParsedTransaction[] = []
  let bankTxCount = 0
  if (job.phase === "stored") {
    onProgress?.(10, "Parsing CSV file…")
    try {
      const text = new TextDecoder().decode(job.fileBytes)
      const bankTx = parseBankCsv(text)
      bankTxCount = bankTx.length

      if (bankTx.length === 0) {
        await updateJob(job.id, { phase: "error", error: "No transactions found in CSV." })
        return buildResult(job, { totalParsed: 0, inserted: 0, exactMatches: 0, pendingMatches: 0, errors: ["No transactions found in CSV. Expected HDFC bank statement format."] })
      }

      parsedTx = []
      for (let i = 0; i < bankTx.length; i++) {
        try {
          const b = bankTx[i]
          const dt = parseIndianDate(b.date)
          if (!dt || isNaN(dt.getTime())) continue
          const isDeposit = b.deposit !== null && b.deposit > 0
          const amount = isDeposit ? (b.deposit ?? 0) : (b.withdrawal ?? 0)
          parsedTx.push({
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
          })
        } catch {
          continue
        }
      }

      await updateJob(job.id, { phase: "parsed", parsed: parsedTx })
      job = (await getJob(job.id))!
      onProgress?.(30, `Parsed ${parsedTx.length} bank transactions.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateJob(job.id, { phase: "error", error: msg })
      throw err
    }
  } else {
    parsedTx = job.parsed ?? []
    bankTxCount = parsedTx.length
  }

  // --- Phase 3: CORRELATE ---
  let exactMatches: CorrelationCandidate[] = []
  let pendingMatches: CorrelationCandidate[] = []
  let newOnly: ParsedTransaction[] = []
  if (job.phase === "parsed") {
    onProgress?.(45, "Running correlation engine…")
    try {
      const existingTx = await getTransactions(userId)
      const corr = findCorrelations(parsedTx, existingTx)
      exactMatches = corr.exactMatches
      pendingMatches = corr.pendingMatches
      newOnly = corr.newOnly

      await updateJob(job.id, {
        phase: "correlated",
        correlationResult: { exactMatches, pendingMatches, newOnly },
      })
      job = (await getJob(job.id))!
      onProgress?.(55, `Correlation complete: ${newOnly.length} new, ${exactMatches.length} exact, ${pendingMatches.length} pending.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateJob(job.id, { phase: "error", error: msg })
      throw err
    }
  } else {
    exactMatches = job.correlationResult?.exactMatches ?? []
    pendingMatches = job.correlationResult?.pendingMatches ?? []
    newOnly = job.correlationResult?.newOnly ?? []
  }

  // --- Phase 4: WRITE ---
  if (job.phase === "correlated") {
    onProgress?.(65, `Inserting ${newOnly.length} new transactions…`)
    try {
      const source = await insertSource(userId, {
        kind: "bank_csv",
        label: job.fileName,
        file_name: job.fileName,
        content_hash: contentHash,
        raw_record_count: bankTxCount,
      })
      await updateJob(job.id, { sourceId: source.id })
      job = (await getJob(job.id))!

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

      onProgress?.(75, "Inserting transactions…")
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

      onProgress?.(85, "Creating correlations…")
      const corrRows = buildCorrelationRows(exactMatches, (pt) => recordIdMap.get(pt.id) ?? null)
      const pendingCorrRows = buildCorrelationRows(pendingMatches, (pt) => recordIdMap.get(pt.id) ?? null)
      const allCorrRows = [...corrRows, ...pendingCorrRows].filter((r) => r.source_record_id)
      if (allCorrRows.length > 0) {
        await insertCorrelations(userId, allCorrRows)
      }

      await completeJob(job.id)

      const result = buildResult(job, {
        totalParsed: parsedTx.length,
        inserted: insertedTx.length,
        exactMatches: exactMatches.length,
        pendingMatches: pendingMatches.length,
        errors: [],
      })
      onProgress?.(100, `Done! ${result.inserted} new, ${result.exactMatches} linked, ${result.pendingMatches} pending review.`)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateJob(job.id, { phase: "error", error: msg })
      throw err
    }
  }

  return buildResult(job, {
    totalParsed: parsedTx.length,
    inserted: 0,
    exactMatches: exactMatches.length,
    pendingMatches: pendingMatches.length,
    errors: [],
  })
}

/* ------------------------------------------------------------------ */
/*  Upload bank XLSX                                                   */
/* ------------------------------------------------------------------ */

export async function uploadBankXlsx(
  file: File,
  userId: string,
  onProgress?: (pct: number, log: string) => void,
  password?: string
): Promise<UploadResult> {
  const fileBytes = await file.arrayBuffer()
  const contentHash = await hashContent(fileBytes)
  const contentHashCopy = new Uint8Array(fileBytes).buffer

  const existingSources = await getSourceByHash(userId, contentHash)
  if (existingSources.length > 0) {
    return buildResult(
      { id: contentHash, fileName: file.name, fileKind: "bank_xlsx", fileBytes: contentHashCopy, phase: "stored", createdAt: Date.now(), updatedAt: Date.now() },
      { totalParsed: 0, inserted: 0, exactMatches: 0, pendingMatches: 0, errors: ["This file was already imported (same content hash). Skipping."] }
    )
  }

  let job = await getJob(contentHash)
  if (!job) {
    await enqueueJob({ id: contentHash, fileName: file.name, fileKind: "bank_xlsx", fileBytes: contentHashCopy, password })
    job = (await getJob(contentHash))!
  }

  // --- Phase 2: PARSE ---
  let parsedTx: ParsedTransaction[] = []
  let bankTxCount = 0
  if (job.phase === "stored") {
    onProgress?.(10, "Parsing XLSX file…")
    try {
      const xlsxFile = new File([job.fileBytes], job.fileName)
      const bankTx = await parseBankXlsx(xlsxFile, job.password ?? password)
      bankTxCount = bankTx.length

      if (bankTx.length === 0) {
        await updateJob(job.id, { phase: "error", error: "No transactions found in XLSX." })
        return buildResult(job, { totalParsed: 0, inserted: 0, exactMatches: 0, pendingMatches: 0, errors: ["No transactions found in XLSX. Expected HDFC bank statement format."] })
      }

      parsedTx = []
      for (let i = 0; i < bankTx.length; i++) {
        try {
          const b = bankTx[i]
          const dt = parseIndianDate(b.date)
          if (!dt || isNaN(dt.getTime())) continue
          const isDeposit = b.deposit !== null && b.deposit > 0
          const amount = isDeposit ? (b.deposit ?? 0) : (b.withdrawal ?? 0)
          parsedTx.push({
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
          })
        } catch {
          continue
        }
      }

      await updateJob(job.id, { phase: "parsed", parsed: parsedTx })
      job = (await getJob(job.id))!
      onProgress?.(30, `Parsed ${parsedTx.length} bank transactions.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateJob(job.id, { phase: "error", error: msg })
      throw err
    }
  } else {
    parsedTx = job.parsed ?? []
    bankTxCount = parsedTx.length
  }

  // --- Phase 3: CORRELATE ---
  let exactMatches: CorrelationCandidate[] = []
  let pendingMatches: CorrelationCandidate[] = []
  let newOnly: ParsedTransaction[] = []
  if (job.phase === "parsed") {
    onProgress?.(45, "Running correlation engine…")
    try {
      const existingTx = await getTransactions(userId)
      const corr = findCorrelations(parsedTx, existingTx)
      exactMatches = corr.exactMatches
      pendingMatches = corr.pendingMatches
      newOnly = corr.newOnly

      await updateJob(job.id, {
        phase: "correlated",
        correlationResult: { exactMatches, pendingMatches, newOnly },
      })
      job = (await getJob(job.id))!
      onProgress?.(55, `Correlation complete: ${newOnly.length} new, ${exactMatches.length} exact, ${pendingMatches.length} pending.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateJob(job.id, { phase: "error", error: msg })
      throw err
    }
  } else {
    exactMatches = job.correlationResult?.exactMatches ?? []
    pendingMatches = job.correlationResult?.pendingMatches ?? []
    newOnly = job.correlationResult?.newOnly ?? []
  }

  // --- Phase 4: WRITE ---
  if (job.phase === "correlated") {
    onProgress?.(65, `Inserting ${newOnly.length} new transactions…`)
    try {
      const source = await insertSource(userId, {
        kind: "bank_csv",
        label: job.fileName,
        file_name: job.fileName,
        content_hash: contentHash,
        raw_record_count: bankTxCount,
      })
      await updateJob(job.id, { sourceId: source.id })
      job = (await getJob(job.id))!

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

      onProgress?.(75, "Inserting transactions…")
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

      onProgress?.(85, "Creating correlations…")
      const corrRows = buildCorrelationRows(exactMatches, (pt) => recordIdMap.get(pt.id) ?? null)
      const pendingCorrRows = buildCorrelationRows(pendingMatches, (pt) => recordIdMap.get(pt.id) ?? null)
      const allCorrRows = [...corrRows, ...pendingCorrRows].filter((r) => r.source_record_id)
      if (allCorrRows.length > 0) {
        await insertCorrelations(userId, allCorrRows)
      }

      await completeJob(job.id)

      const result = buildResult(job, {
        totalParsed: parsedTx.length,
        inserted: insertedTx.length,
        exactMatches: exactMatches.length,
        pendingMatches: pendingMatches.length,
        errors: [],
      })
      onProgress?.(100, `Done! ${result.inserted} new, ${result.exactMatches} linked, ${result.pendingMatches} pending review.`)
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateJob(job.id, { phase: "error", error: msg })
      throw err
    }
  }

  return buildResult(job, {
    totalParsed: parsedTx.length,
    inserted: 0,
    exactMatches: exactMatches.length,
    pendingMatches: pendingMatches.length,
    errors: [],
  })
}
