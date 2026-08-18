import type { DbTransaction, DbRecipient, DbCorrelation, DbStoreTransaction, DbReward, DbVoucher, DbGroupExpense } from "./firestore-db"

interface CachedData {
  transactions: DbTransaction[]
  recipients: DbRecipient[]
  correlations: DbCorrelation[]
  sources: { id: string }[]
  storeTransactions: DbStoreTransaction[]
  rewards: DbReward[]
  vouchers: DbVoucher[]
  groupExpenses: DbGroupExpense[]
  updatedAt: number
}

const DB_NAME = "gpay-data-cache"
const STORE_NAME = "data"
const CACHE_KEY = "firestore-data"
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getCachedData(): Promise<CachedData | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const req = tx.objectStore(STORE_NAME).get(CACHE_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function setCachedData(data: CachedData): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      tx.objectStore(STORE_NAME).put(data, CACHE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve() // non-critical
    })
  } catch {
    // non-critical
  }
}
