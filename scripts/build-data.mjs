#!/usr/bin/env node
/**
 * Builds src/data/bundle.ts from the raw Google Takeout files in the parent folder.
 *
 * Inputs (relative to this repo's parent):
 *   - My Activity/My Activity.html          -> UPI transactions (Paid / Received / Sent)
 *   - Google transactions/*.csv             -> Store & subscription purchases
 *   - Rewards earned/Cashback Rewards.csv   -> Cashback / rewards earned
 *   - Rewards earned/Voucher Rewards.json   -> Voucher coupons
 *   - Group expenses/Group expenses.json    -> Split / group expenses
 *
 * Output: src/data/bundle.ts (a TypeScript module so the dashboard works from a
 * static build with no network calls and no runtime fetching).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const DATA_ROOT = resolve(ROOT, "..")

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const round = (n) => Math.round(n * 100) / 100

function parseIndianAmount(s) {
  const m = String(s ?? "").match(/[\d,]+(?:\.\d+)?/)
  if (!m) return null
  return round(parseFloat(m[0].replace(/,/g, "")))
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Parse "Aug 17, 2026, 2:25:55 AM IST" (with non-breaking spaces) -> Date */
function parseISTDate(raw) {
  if (!raw) return null
  const s = String(raw).replace(/\u202f/g, " ").trim()
  const m = s.match(
    /([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i
  )
  if (!m) return null
  const [, mon, day, year, hr, min, sec, ap] = m
  const month = MONTHS.indexOf(mon)
  if (month === -1) return null
  let hour = parseInt(hr, 10)
  if (ap.toUpperCase() === "PM" && hour !== 12) hour += 12
  if (ap.toUpperCase() === "AM" && hour === 12) hour = 0
  // Build a UTC date that, when rendered in IST, shows the same wall-clock time.
  return new Date(Date.UTC(year, month, day, hour, min, parseInt(sec ?? "0", 10)) - 5.5 * 3600000)
}

/** Convert a full name to a stable grouping key. */
function nameKey(name) {
  if (!name) return ""
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bs\s+o\b/g, " ")
    .replace(/\b(mr|mrs|ms|miss|master|dr|shri|smt|sri)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Title-case a raw (usually UPPERCASE) counterparty string. */
function prettyName(raw) {
  let s = String(raw ?? "")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/_+$/, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!s) return ""
  const words = s.split(" ")
  let out = words
    .map((w, i) => {
      if (/^[A-Z]{2,}$/.test(w)) {
        const lower = w.toLowerCase()
        const special = {
          "s": "S", "o": "O", "and": "And", "&": "&", "mc": "MC", "sbi": "SBI",
          "iri": "IRI", "amazon": "Amazon", "zomato": "Zomato", "netflix": "Netflix",
          "jio": "Jio", "irctc": "IRCTC", "upi": "UPI", "paytm": "Paytm",
          "the": "The", "at": "AT",
        }
        if (special[lower]) return special[lower]
        if (i === 0) return lower.charAt(0).toUpperCase() + lower.slice(1)
        return lower
      }
      return w
    })
    .join(" ")
  // Keep known brand casing
  const brandFixes = [
    [/^McDonalds$/i, "McDonald's"],
    [/^Amazon Pay/i, "Amazon Pay"],
  ]
  for (const [re, fix] of brandFixes) {
    out = out.replace(re, fix)
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  1. My Activity.html -> UPI transactions                            */
/* ------------------------------------------------------------------ */

function parseMyActivity(htmlPath) {
  const html = readFileSync(htmlPath, "utf8")
  const blocks = html.match(/<div class="outer-cell[^"]*">.*?<\/div><\/div><\/div>/gs) ?? []
  const out = []
  let skipped = 0

  for (const b of blocks) {
    const m = b.match(
      /content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">(.*?)<br>(.*?)<br><\/div>/s
    )
    if (!m) {
      skipped++
      continue
    }
    const note = m[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim()
    const dateStr = m[2].replace(/<[^>]+>/g, "").trim()

    const sm = b.match(/Details:<\/b><br>&emsp;(\S+)<br>&emsp;(\w+)/)
    const detailId = sm ? sm[1] : null
    const status = sm ? sm[2] : null

    // Skip non-transaction entries (e.g. "Loan application data for L&T Finance")
    if (/loan application data/i.test(note)) {
      skipped++
      continue
    }

    const typeMatch = note.match(/^(Paid|Received|Sent)\s+₹([\d,]+(?:\.\d+)?)\s*(.*)$/)
    if (!typeMatch) {
      skipped++
      continue
    }
    const type = typeMatch[1]
    const amount = round(parseFloat(typeMatch[2].replace(/,/g, "")))
    const rest = typeMatch[3].trim()

    let counterparty = null
    let method = null

    if (type === "Paid") {
      // "to NAME using METHOD" | "to NAME" | "using METHOD"
      let toPart = rest
      const um = rest.match(/^(.*?)\s+using\s+(.+)$/)
      if (um) {
        toPart = um[1].trim()
        method = um[2].trim()
      }
      if (/^to\s+/i.test(toPart)) counterparty = toPart.replace(/^to\s+/i, "").trim()
    } else if (type === "Received") {
      const fm = rest.match(/^from\s+(.+)$/)
      if (fm) counterparty = fm[1].trim()
    } else if (type === "Sent") {
      const um = rest.match(/^using\s+(.+)$/)
      if (um) method = um[1].trim()
    }

    const dt = parseISTDate(dateStr)
    if (!dt) {
      skipped++
      continue
    }

    const rawName = counterparty ? prettyName(counterparty) : null
    out.push({
      id: detailId ?? `act-${out.length + 1}`,
      ts: dt.toISOString(),
      year: dt.getUTCFullYear(),
      month: dt.getUTCMonth() + 1,
      day: dt.getUTCDate(),
      hour: dt.getUTCHours(),
      minute: dt.getUTCMinutes(),
      weekday: dt.getUTCDay(),
      type,
      amount,
      name: rawName,
      nameKey: rawName ? nameKey(rawName) : null,
      method: method,
      status: status ?? null,
      note,
    })
  }
  out.sort((a, b) => a.ts.localeCompare(b.ts))
  return { transactions: out, skipped }
}

/**
 * Correlate the bank statement (src/data/statement-entries.json, produced by
 * scripts/extract-statement.mjs from a Google Pay "statement" PDF) against the
 * unnamed UPI transactions from My Activity.html.
 *
 * The Takeout export does not carry the 12-digit UPI reference, so matching is
 * done on date + type + amount, disambiguated by wall-clock time (IST) within a
 * ±5 minute window.
 */
function applyStatementNames(transactions) {
  const stPath = join(ROOT, "src", "data", "statement-entries.json")
  if (!existsSync(stPath)) return { transactions, applied: 0 }

  const entries = JSON.parse(readFileSync(stPath, "utf8")).entries ?? []
  const stKey = new Map()
  for (const e of entries) {
    const k = `${e.year}-${e.month}-${e.day}|${e.type}|${e.amount}`
    if (!stKey.has(k)) stKey.set(k, [])
    stKey.get(k).push(e)
  }

  const istMinOf = (t) => {
    const d = new Date(new Date(t.ts).getTime() + 5.5 * 3600000)
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      min: d.getUTCHours() * 60 + d.getUTCMinutes(),
    }
  }

  let applied = 0
  for (const t of transactions) {
    if (t.name !== null) continue
    const ist = istMinOf(t)
    const cands = stKey.get(`${ist.year}-${ist.month}-${ist.day}|${t.type}|${t.amount}`) ?? []
    if (cands.length === 0) continue

    let best = null
    let bestDiff = 1e9
    let tie = false
    for (const c of cands) {
      const d = Math.abs((c.hour * 60 + c.minute) - ist.min)
      if (d < bestDiff) {
        bestDiff = d
        best = c
        tie = false
      } else if (d === bestDiff) {
        tie = true
      }
    }
    if (!best || tie || bestDiff > 5 || !best.rawName) continue

    const name = prettyName(best.rawName)
    t.name = name
    t.nameKey = nameKey(name)
    applied++
  }
  return { transactions, applied }
}

/* ------------------------------------------------------------------ */
/*  2. Google transactions CSV (store purchases)                       */
/* ------------------------------------------------------------------ */

function parseCsvLine(line) {
  const cells = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += c
    } else if (c === '"') {
      inQ = true
    } else if (c === ",") {
      cells.push(cur)
      cur = ""
    } else {
      cur += c
    }
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

function parseStoreTransactions(dirPath) {
  const files = readdirSync(dirPath).filter((f) => f.endsWith(".csv"))
  const out = []
  for (const f of files) {
    const text = readFileSync(join(dirPath, f), "utf8")
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) continue
    const headers = parseCsvLine(lines[0])
    const get = (row, h) => {
      const i = headers.indexOf(h)
      return i === -1 ? "" : row[i]
    }
    for (const line of lines.slice(1)) {
      const row = parseCsvLine(line)
      const amount = parseIndianAmount(get(row, "Amount"))
      if (amount === null) continue
      const dt = parseISTDate(get(row, "Time"))
      out.push({
        id: get(row, "Transaction ID") || null,
        ts: dt ? dt.toISOString() : null,
        year: dt ? dt.getUTCFullYear() : null,
        month: dt ? dt.getUTCMonth() + 1 : null,
        description: get(row, "Description") || null,
        product: get(row, "Product") || null,
        paymentMethod: get(row, "Payment method") || null,
        status: get(row, "Status") || null,
        amount,
      })
    }
  }
  out.sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""))
  return out
}

/* ------------------------------------------------------------------ */
/*  3. Cashback rewards CSV                                            */
/* ------------------------------------------------------------------ */

function parseCashback(csvPath) {
  const text = readFileSync(csvPath, "utf8")
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const out = []
  for (const line of lines.slice(1)) {
    const [date, currency, reward, desc] = parseCsvLine(line)
    const dt = new Date(date)
    if (isNaN(dt.getTime())) continue
    out.push({
      ts: dt.toISOString(),
      year: dt.getUTCFullYear(),
      month: dt.getUTCMonth() + 1,
      currency: currency || "INR",
      amount: round(parseFloat(reward || "0")),
      description: desc || null,
    })
  }
  out.sort((a, b) => a.ts.localeCompare(b.ts))
  return out
}

/* ------------------------------------------------------------------ */
/*  4. Voucher rewards JSON                                            */
/* ------------------------------------------------------------------ */

function parseVouchers(jsonPath) {
  const raw = readFileSync(jsonPath, "utf8")
  const content = raw.startsWith(")]}'") ? raw.slice(raw.indexOf("\n")) : raw
  const data = JSON.parse(content)
  const list = data.couponRewardExportRecord ?? []
  return list.map((v) => ({
    code: v.code,
    summary: (v.summary || "").trim(),
    details: (v.details || "").trim(),
    expiryTimestamp: v.expiryTimestamp ? new Date(v.expiryTimestamp).toISOString() : null,
  }))
}

/* ------------------------------------------------------------------ */
/*  5. Group expenses JSON                                             */
/* ------------------------------------------------------------------ */

function parseGroupExpenses(jsonPath) {
  const raw = readFileSync(jsonPath, "utf8")
  const data = JSON.parse(raw)
  const list = data.Group_expenses ?? []
  return list.map((g) => ({
    id: `${g.group_name}-${g.creation_time}`,
    groupName: g.group_name,
    creator: g.creator,
    state: g.state,
    title: (g.title || "").trim(),
    createdAt: g.creation_time,
    totalAmount: parseIndianAmount(g.total_amount),
    items: (g.items ?? []).map((it) => ({
      amount: parseIndianAmount(it.amount),
      state: it.state,
      payer: it.payer,
    })),
  }))
}

/* ------------------------------------------------------------------ */
/*  Build & write                                                      */
/* ------------------------------------------------------------------ */

const activity = parseMyActivity(join(DATA_ROOT, "My Activity", "My Activity.html"))
const namedActivity = applyStatementNames(activity.transactions)
const store = parseStoreTransactions(join(DATA_ROOT, "Google transactions"))
const cashback = parseCashback(join(DATA_ROOT, "Rewards earned", "Cashback Rewards.csv"))
const vouchers = parseVouchers(join(DATA_ROOT, "Rewards earned", "Voucher Rewards.json"))
const groupExpenses = parseGroupExpenses(join(DATA_ROOT, "Group expenses", "Group expenses.json"))

const bundle = {
  meta: {
    generatedAt: new Date().toISOString(),
    note: "Generated by scripts/build-data.mjs from Google Pay Takeout data. Do not edit by hand.",
    statementMatched: namedActivity.applied,
  },
  transactions: namedActivity.transactions,
  storeTransactions: store,
  cashback,
  vouchers,
  groupExpenses,
}

const outFile = join(ROOT, "src", "data", "bundle.ts")
const ts = `// Generated by scripts/build-data.mjs — do not edit by hand.
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
  type: TransactionType
  amount: number
  name: string | null
  nameKey: string | null
  method: string | null
  status: string | null
  note: string
}

export interface StoreTransaction {
  id: string | null
  ts: string | null
  year: number | null
  month: number | null
  description: string | null
  product: string | null
  paymentMethod: string | null
  status: string | null
  amount: number
}

export interface CashbackReward {
  ts: string
  year: number
  month: number
  currency: string
  amount: number
  description: string | null
}

export interface Voucher {
  code: string
  summary: string
  details: string
  expiryTimestamp: string | null
}

export interface GroupExpenseItem {
  amount: number | null
  state: string
  payer: string
}

export interface GroupExpense {
  id: string
  groupName: string
  creator: string
  state: string
  title: string
  createdAt: string
  totalAmount: number | null
  items: GroupExpenseItem[]
}

export interface DataBundle {
  meta: { generatedAt: string; note: string; statementMatched?: number }
  transactions: UpiTransaction[]
  storeTransactions: StoreTransaction[]
  cashback: CashbackReward[]
  vouchers: Voucher[]
  groupExpenses: GroupExpense[]
}

export const bundle: DataBundle = ${JSON.stringify(bundle, null, 0)}
`

writeFileSync(outFile, ts, "utf8")
console.log(
  [
    `transactions: ${activity.transactions.length} (${activity.skipped} skipped, ${namedActivity.applied} named from statement)`,
    `storeTransactions: ${store.length}`,
    `cashback: ${cashback.length}`,
    `vouchers: ${vouchers.length}`,
    `groupExpenses: ${groupExpenses.length}`,
  ].join("\n")
)
console.log(`Wrote ${outFile} (${(ts.length / 1024).toFixed(0)} KB)`)
