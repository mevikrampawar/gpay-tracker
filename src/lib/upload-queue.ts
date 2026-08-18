/**
 * IndexedDB-backed upload queue for resilient file uploads.
 *
 * Stores file bytes + metadata so uploads can resume across page reloads.
 * No external dependencies — uses the native IndexedDB API.
 */

import type { ParsedTransaction, StoreTransaction, CashbackReward, Voucher, GroupExpense } from "./parse-takeout"
import type { CorrelationCandidate } from "./correlate"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface UploadJob {
  id: string
  fileName: string
  fileKind: "takeout" | "bank_csv" | "bank_xlsx"
  fileBytes: ArrayBuffer
  password?: string
  phase: "stored" | "parsed" | "correlated" | "written" | "error"
  parsed?: ParsedTransaction[]
  parsedStore?: StoreTransaction[]
  parsedRewards?: CashbackReward[]
  parsedVouchers?: Voucher[]
  parsedGroupExpenses?: GroupExpense[]
  correlationResult?: {
    exactMatches: CorrelationCandidate[]
    pendingMatches: CorrelationCandidate[]
    newOnly: ParsedTransaction[]
  }
  sourceId?: string
  error?: string
  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/*  IndexedDB helpers                                                  */
/* ------------------------------------------------------------------ */

const DB_NAME = "gpay-upload-queue"
const STORE_NAME = "jobs"
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  return dbPromise
}

/* ------------------------------------------------------------------ */
/*  Content hashing                                                    */
/* ------------------------------------------------------------------ */

export async function hashContent(bytes: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

/* ------------------------------------------------------------------ */
/*  Job CRUD                                                           */
/* ------------------------------------------------------------------ */

/** Store a new job (file bytes + metadata). id = content hash. */
export async function enqueueJob(params: {
  id: string
  fileName: string
  fileKind: "takeout" | "bank_csv" | "bank_xlsx"
  fileBytes: ArrayBuffer
  password?: string
}): Promise<void> {
  const db = await openDB()
  const now = Date.now()
  const job: UploadJob = {
    id: params.id,
    fileName: params.fileName,
    fileKind: params.fileKind,
    fileBytes: params.fileBytes,
    password: params.password,
    phase: "stored",
    createdAt: now,
    updatedAt: now,
  }

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(job)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Get a job by ID. */
export async function getJob(id: string): Promise<UploadJob | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

/** Update a job (partial patch, merges with existing). */
export async function updateJob(id: string, patch: Partial<UploadJob>): Promise<void> {
  const existing = await getJob(id)
  if (!existing) throw new Error(`Job ${id} not found`)

  const db = await openDB()
  const updated = { ...existing, ...patch, id, updatedAt: Date.now() }

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(updated)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Mark job as complete (delete from IDB). */
export async function completeJob(id: string): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Delete a job (cancel). */
export async function deleteJob(id: string): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Get all incomplete jobs (phase !== "written" && phase !== "error"). */
export async function getIncompleteJobs(): Promise<UploadJob[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => {
      const jobs = (req.result as UploadJob[]).filter(
        (j) => j.phase !== "written" && j.phase !== "error"
      )
      resolve(jobs)
    }
    req.onerror = () => reject(req.error)
  })
}
