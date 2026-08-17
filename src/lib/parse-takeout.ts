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
  return new Date(Date.UTC(year, month, day, hour, min, parseInt(sec ?? "0", 10)) - 5.5 * 3600000)
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
