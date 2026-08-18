/**
 * Browser-compatible parser for Google Takeout "My Activity.html".
 *
 * Mirrors scripts/build-data.mjs but runs in the browser with no Node.js APIs.
 * Extracts UPI transactions (Paid / Received / Sent) from the HTML export.
 */

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const round = (n: number) => Math.round(n * 100) / 100

/** Parse "Aug 17, 2026, 2:25:55 AM IST" (with non-breaking spaces) -> Date */
function parseISTDate(raw: string): Date | null {
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
  return new Date(Date.UTC(parseInt(year), month, parseInt(day), hour, parseInt(min), parseInt(sec ?? "0", 10)) - 5.5 * 3600000)
}

/** Convert a full name to a stable grouping key. */
export function nameKey(name: string): string {
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
function prettyName(raw: string): string {
  let s = String(raw ?? "")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/_+$/, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!s) return ""
  const words = s.split(" ")
  const out = words
    .map((w, i) => {
      if (/^[A-Z]{2,}$/.test(w)) {
        const lower = w.toLowerCase()
        const special: Record<string, string> = {
          s: "S", o: "O", and: "And", "&": "&", mc: "MC", sbi: "SBI",
          iri: "IRI", amazon: "Amazon", zomato: "Zomato", netflix: "Netflix",
          jio: "Jio", irctc: "IRCTC", upi: "UPI", paytm: "Paytm",
          the: "The", at: "AT",
        }
        if (special[lower]) return special[lower]
        if (i === 0) return lower.charAt(0).toUpperCase() + lower.slice(1)
        return lower
      }
      return w
    })
    .join(" ")
  return out.replace(/^McDonalds$/i, "McDonald's").replace(/^Amazon Pay/i, "Amazon Pay")
}

export class PasswordRequiredError extends Error {
  constructor() {
    super("File is password-protected")
    this.name = "PasswordRequiredError"
  }
}

/* ------------------------------------------------------------------ */
/*  Parsed transaction type                                            */
/* ------------------------------------------------------------------ */

export type TransactionType = "Paid" | "Received" | "Sent"

export interface ParsedTransaction {
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

/* ------------------------------------------------------------------ */
/*  HTML parser                                                        */
/* ------------------------------------------------------------------ */

export function parseMyActivityHtml(html: string): {
  transactions: ParsedTransaction[]
  skipped: number
} {
  const blocks = html.match(/<div class="outer-cell[^"]*">.*?<\/div><\/div><\/div>/gs) ?? []
  const out: ParsedTransaction[] = []
  let skipped = 0

  for (const b of blocks) {
    const m = b.match(
      /content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">(.*?)<br>(.*?)<br><\/div>/s
    )
    if (!m) { skipped++; continue }

    const note = m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()
    const dateStr = m[2].replace(/<[^>]+>/g, "").trim()

    const sm = b.match(/Details:<\/b><br>&emsp;(\S+)<br>&emsp;(\w+)/)
    const detailId = sm ? sm[1] : null
    const status = sm ? sm[2] : null

    if (/loan application data/i.test(note)) { skipped++; continue }

    const typeMatch = note.match(/^(Paid|Received|Sent)\s+₹([\d,]+(?:\.\d+)?)\s*(.*)$/)
    if (!typeMatch) { skipped++; continue }

    const type = typeMatch[1] as TransactionType
    const amount = round(parseFloat(typeMatch[2].replace(/,/g, "")))
    const rest = typeMatch[3].trim()

    let counterparty: string | null = null
    let method: string | null = null

    if (type === "Paid") {
      let toPart = rest
      const um = rest.match(/^(.*?)\s+using\s+(.+)$/)
      if (um) { toPart = um[1].trim(); method = um[2].trim() }
      if (/^to\s+/i.test(toPart)) counterparty = toPart.replace(/^to\s+/i, "").trim()
    } else if (type === "Received") {
      const fm = rest.match(/^from\s+(.+)$/)
      if (fm) counterparty = fm[1].trim()
    } else if (type === "Sent") {
      const um = rest.match(/^using\s+(.+)$/)
      if (um) method = um[1].trim()
    }

    const dt = parseISTDate(dateStr)
    if (!dt) { skipped++; continue }

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
      method,
      status: status ?? null,
      note,
    })
  }

  out.sort((a, b) => a.ts.localeCompare(b.ts))
  return { transactions: out, skipped }
}

/* ------------------------------------------------------------------ */
/*  HDFC Bank statement CSV parser (browser)                           */
/* ------------------------------------------------------------------ */

export interface BankTx {
  date: string
  narration: string
  ref: string
  valueDate: string
  withdrawal: number | null
  deposit: number | null
  balance: number | null
  upiRef: string | null
}

/* ------------------------------------------------------------------ */
/*  Store / Subscription transactions                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Cashback / Rewards                                                  */
/* ------------------------------------------------------------------ */

export interface CashbackReward {
  ts: string
  year: number
  month: number
  currency: string
  amount: number
  description: string | null
}

/* ------------------------------------------------------------------ */
/*  Voucher rewards                                                     */
/* ------------------------------------------------------------------ */

export interface Voucher {
  code: string
  summary: string
  details: string
  expiryTimestamp: string | null
}

/* ------------------------------------------------------------------ */
/*  Group expenses                                                      */
/* ------------------------------------------------------------------ */

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

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += c
    } else if (c === '"') inQ = true
    else if (c === ",") { cells.push(cur); cur = "" }
    else cur += c
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

export function parseBankCsv(csvText: string): BankTx[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim())
  // Find header row (contains "Date" and "Narration")
  const headerIdx = lines.findIndex((l) => /Date.*Narration/i.test(l))
  if (headerIdx === -1) return []
  const headers = parseCsvLine(lines[headerIdx])
  const get = (row: string[], h: string) => {
    const i = headers.findIndex((x) => x.toLowerCase().includes(h.toLowerCase()))
    return i === -1 ? "" : row[i] ?? ""
  }
  const round2 = (n: number) => Math.round(n * 100) / 100
  const parseAmt = (s: string): number | null => {
    const m = s.replace(/,/g, "").match(/[\d.]+/)
    return m ? round2(parseFloat(m[0])) : null
  }
  const out: BankTx[] = []
  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue
    const row = parseCsvLine(line)
    const date = get(row, "Date")
    if (!date) continue
    const narration = get(row, "Narration")
    const ref = get(row, "Chq/Ref")
    const valueDate = get(row, "Value")
    const withdrawal = parseAmt(get(row, "Withdrawal"))
    const deposit = parseAmt(get(row, "Deposit"))
    const balance = parseAmt(get(row, "Balance"))
    // Extract UPI ref from narration
    const upiMatch = narration.match(/\b(\d{12,}|[A-Za-z0-9]{16,})\b/)
    const upiRef = upiMatch ? upiMatch[1] : null
    out.push({ date, narration, ref, valueDate, withdrawal, deposit, balance, upiRef })
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  HDFC Bank statement XLSX parser (browser)                          */
/* ------------------------------------------------------------------ */

export async function parseBankXlsx(file: File, password?: string): Promise<BankTx[]> {
  const XLSX = await import("xlsx")
  const buf = await file.arrayBuffer()
  let wb
  try {
    wb = XLSX.read(buf, { type: "array", password: password || "" })
  } catch (e) {
    if (e instanceof Error && (e.message.includes("password") || e.message.includes("Password"))) {
      throw new PasswordRequiredError()
    }
    throw e
  }
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []

  // Read all rows as raw arrays to find the real header row
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
  if (allRows.length === 0) return []

  // Find header row: contains both "Date" and "Narration" (case-insensitive)
  const headerIdx = allRows.findIndex((row) =>
    row.some((cell) => String(cell).trim().toLowerCase() === "date") &&
    row.some((cell) => String(cell).toLowerCase().includes("narration"))
  )
  if (headerIdx === -1) return []

  const headers = allRows[headerIdx].map((h) => String(h).trim())
  const dataRows = allRows.slice(headerIdx + 1)

  // Find column indices by fuzzy matching
  const findIdx = (h: string) =>
    headers.findIndex((k) => k.toLowerCase().includes(h.toLowerCase()))

  const dateIdx = findIdx("Date")
  const narrIdx = findIdx("Narration")
  const refIdx = findIdx("Chq")
  const valIdx = findIdx("Value")
  const wdIdx = findIdx("Withdrawal")
  const depIdx = findIdx("Deposit")
  const balIdx = findIdx("Balance")

  const getCell = (row: unknown[], idx: number) =>
    idx === -1 ? "" : String(row[idx] ?? "").trim()

  const parseAmt = (v: unknown): number | null => {
    const s = String(v).replace(/,/g, "")
    const m = s.match(/[\d.]+/)
    return m ? Math.round(parseFloat(m[0]) * 100) / 100 : null
  }

  const out: BankTx[] = []
  for (const row of dataRows) {
    const date = getCell(row, dateIdx)
    if (!date) continue
    const narration = getCell(row, narrIdx)
    const ref = getCell(row, refIdx)
    const valueDate = getCell(row, valIdx)
    const withdrawal = parseAmt(row[wdIdx])
    const deposit = parseAmt(row[depIdx])
    const balance = parseAmt(row[balIdx])
    const upiMatch = narration.match(/\b(\d{12,}|[A-Za-z0-9]{16,})\b/)
    const upiRef = upiMatch ? upiMatch[1] : null
    out.push({ date, narration, ref, valueDate, withdrawal, deposit, balance, upiRef })
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  Store transactions CSV parser                                       */
/* ------------------------------------------------------------------ */

function parseIndianAmount(s: string): number | null {
  const m = String(s ?? "").match(/[\d,]+(?:\.\d+)?/)
  if (!m) return null
  return round(parseFloat(m[0].replace(/,/g, "")))
}

export function parseStoreTransactionsCsv(csvText: string): StoreTransaction[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0])
  const get = (row: string[], h: string) => {
    const i = headers.indexOf(h)
    return i === -1 ? "" : row[i]
  }
  const out: StoreTransaction[] = []
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
  out.sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""))
  return out
}

/* ------------------------------------------------------------------ */
/*  Cashback rewards CSV parser                                         */
/* ------------------------------------------------------------------ */

export function parseCashbackRewards(csvText: string): CashbackReward[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim())
  const out: CashbackReward[] = []
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
/*  Voucher rewards JSON parser                                         */
/* ------------------------------------------------------------------ */

export function parseVoucherRewards(jsonText: string): Voucher[] {
  const content = jsonText.startsWith(")]}'") ? jsonText.slice(jsonText.indexOf("\n")) : jsonText
  const data = JSON.parse(content)
  const list: Array<{ code: string; summary?: string; details?: string; expiryTimestamp?: string }> =
    data.couponRewardExportRecord ?? []
  return list.map((v) => ({
    code: v.code,
    summary: (v.summary || "").trim(),
    details: (v.details || "").trim(),
    expiryTimestamp: v.expiryTimestamp ? new Date(v.expiryTimestamp).toISOString() : null,
  }))
}

/* ------------------------------------------------------------------ */
/*  Group expenses JSON parser                                          */
/* ------------------------------------------------------------------ */

export function parseGroupExpenses(jsonText: string): GroupExpense[] {
  const data = JSON.parse(jsonText)
  const list: Array<{
    group_name: string
    creator: string
    state: string
    title?: string
    creation_time: string
    total_amount?: string
    items?: Array<{ amount?: string; state: string; payer: string }>
  }> = data.Group_expenses ?? []
  return list.map((g) => ({
    id: `${g.group_name}-${g.creation_time}`,
    groupName: g.group_name,
    creator: g.creator,
    state: g.state,
    title: (g.title || "").trim(),
    createdAt: g.creation_time,
    totalAmount: parseIndianAmount(g.total_amount ?? ""),
    items: (g.items ?? []).map((it) => ({
      amount: parseIndianAmount(it.amount ?? ""),
      state: it.state,
      payer: it.payer,
    })),
  }))
}
