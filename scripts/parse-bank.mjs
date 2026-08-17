/**
 * Parse HDFC bank XLS statements into a normalized JSON format.
 *
 * HDFC format:
 *   - Rows before header: bank info (account no, name, etc.)
 *   - Header row: Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance
 *   - Data rows: DD/MM/YY | narration text | 16-digit ref | DD/MM/YY | amount | amount | balance
 *
 * Narration patterns:
 *   UPI-NAME-VPA-BANKCODE-REF-UPI  → UPI payment
 *   NEFT-SENDER-REF                  → NEFT
 *   IMPS-SENDER-REF                  → IMPS
 *   RTGS-SENDER-REF                  → RTGS
 *   ACH D-SENDER-REF                 → Auto-debit
 *   ACH C-SENDER-REF                 → Auto-credit
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import XLSX from "xlsx"

export interface BankTx {
  date: string          // YYYY-MM-DD (IST)
  dateRaw: string       // DD/MM/YY
  narration: string
  refNo: string         // raw 16-digit ref
  upiRef: string | null // 12-digit UPI ref extracted from narration
  upiName: string | null // sender/recipient name from narration
  withdrawal: number | null
  deposit: number | null
  balance: number | null
  source: string        // filename
}

const BANK_DIR = join(import.meta.dirname ?? process.cwd(), "..", "Bank Statements")

function parseDate(d: string): string | null {
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  if (!m) return null
  const yy = parseInt(m[3])
  const yyyy = yy > 50 ? 1900 + yy : 2000 + yy
  return `${yyyy}-${m[2]}-${m[1]}`
}

function extractUpiInfo(narration: string): { ref: string | null; name: string | null } {
  // UPI-SENDER NAME-VPA-BANKCODE-REF-UPI
  const m = narration.match(/^UPI-([^-]+?)-([^-]*?@[^-]+)-([A-Z0-9]+)-(\d{12})-UPI$/i)
  if (m) return { ref: m[4], name: m[1].trim() }

  // UPI-SENDER-VPA-REF (older format)
  const m2 = narration.match(/^UPI-([^-]+?)-[^\d]*(\d{12})/i)
  if (m2) return { ref: m2[2], name: m2[1].trim() }

  // UPI with Paytm QR
  const m3 = narration.match(/^UPI-([^-]+?)-PAYTMQR[^\d]*(\d{12})/i)
  if (m3) return { ref: m3[2], name: m3[1].trim() }

  return { ref: null, name: null }
}

function parseSheet(filePath: string): BankTx[] {
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1 })

  const startIdx = rows.findIndex(
    (r) => r[0] === "Date" && r[1] === "Narration"
  )
  if (startIdx < 0) {
    console.warn(`  No header found in ${filePath}`)
    return []
  }

  const txs: BankTx[] = []
  for (let i = startIdx + 2; i < rows.length; i++) {
    const r = rows[i]
    if (!r || !r[0] || r[0] === "********") continue
    if (typeof r[0] !== "string" || !r[0].match(/^\d{2}\/\d{2}\/\d{2}/)) continue

    const date = parseDate(r[0])
    if (!date) continue

    const narration = String(r[1] || "")
    const refNo = String(r[2] || "")
    const withdrawal = r[4] != null ? Number(r[4]) : null
    const deposit = r[5] != null ? Number(r[5]) : null
    const balance = r[6] != null ? Number(r[6]) : null

    const { ref: upiRef, name: upiName } = extractUpiInfo(narration)

    txs.push({
      date,
      dateRaw: r[0] as string,
      narration,
      refNo,
      upiRef,
      upiName,
      withdrawal,
      deposit,
      balance,
      source: filePath.split("/").pop()!,
    })
  }
  return txs
}

export function parseAllBankStatements(): BankTx[] {
  const files = readdirSync(BANK_DIR)
    .filter((f) => f.endsWith(".xls") || f.endsWith(".xlsx"))
    .sort()

  const all: BankTx[] = []
  for (const f of files) {
    const txs = parseSheet(join(BANK_DIR, f))
    console.log(`  ${f}: ${txs.length} transactions`)
    all.push(...txs)
  }
  return all
}

/* ---- CLI entry ---- */
if (process.argv[1]?.endsWith("parse-bank.mjs")) {
  console.log("Parsing HDFC bank statements…")
  const txs = parseAllBankStatements()
  writeFileSync("/tmp/bank_txs.json", JSON.stringify(txs, null, 2))
  console.log(`\nTotal: ${txs.length} transactions saved to /tmp/bank_txs.json`)
  console.log(`UPI txs: ${txs.filter((t) => t.upiRef).length}`)
  console.log(`Debits: ${txs.filter((t) => t.withdrawal).length}`)
  console.log(`Credits: ${txs.filter((t) => t.deposit).length}`)
}
