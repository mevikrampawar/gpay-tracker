#!/usr/bin/env node
/**
 * Extracts structured transaction entries from a Google Pay PDF statement
 * (produced via the GPay app "Statement" export) and writes them to
 * src/data/statement-entries.json so scripts/build-data.mjs can correlate
 * them against the (unnamed) My Activity transactions.
 *
 * Requires `pdftotext` (from poppler) on PATH.
 *
 * Usage: node scripts/extract-statement.mjs <statement.pdf>
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function parseAmount(s) {
  const m = String(s ?? "").match(/₹\s?([\d,]+(?:\.\d+)?)/)
  if (!m) return null
  return Math.round(parseFloat(m[1].replace(/,/g, "")) * 100) / 100
}

function parseStatement(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const entries = []
  let cur = null

  for (const line of lines) {
    if (!line) continue
    if (/^Page \d+ of \d+$/i.test(line) || /^Transaction statement$/i.test(line)) {
      cur = null
      continue
    }
    if (/^\d{2} [A-Z][a-z]{2}, \d{4}\s+/.test(line)) {
      const dm = line.match(/^(\d{2}) ([A-Z][a-z]{2}), (\d{4})/)
      if (!dm) continue
      const day = parseInt(dm[1], 10)
      const month = MONTHS.indexOf(dm[2]) + 1
      const year = parseInt(dm[3], 10)
      const amount = parseAmount(line)
      let rawName = null
      let type = null
      if (/Self transfer to /.test(line)) {
        type = "Sent"
        rawName = line.match(/Self transfer to (.+?)₹/)?.[1]?.trim() ?? null
      } else if (/Paid to /.test(line)) {
        type = "Paid"
        rawName = line.match(/Paid to (.+?)₹/)?.[1]?.trim() ?? null
      } else if (/Received from /.test(line)) {
        type = "Received"
        rawName = line.match(/Received from (.+?)₹/)?.[1]?.trim() ?? null
      }
      if (type && amount !== null) {
        cur = { year, month, day, hour: null, minute: null, type, rawName, amount, upiId: null, bank: null }
        entries.push(cur)
      } else {
        cur = null
      }
      continue
    }
    if (!cur) continue
    const tm = line.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i)
    if (tm) {
      let h = parseInt(tm[1], 10)
      if (/PM/i.test(tm[3]) && h !== 12) h += 12
      if (/AM/i.test(tm[3]) && h === 12) h = 0
      cur.hour = h
      cur.minute = parseInt(tm[2], 10)
      const u = line.match(/UPI Transaction ID: (\d+)/i)
      if (u) cur.upiId = u[1]
      continue
    }
    const um = line.match(/^UPI Transaction ID: (\d+)$/i)
    if (um) {
      cur.upiId = um[1]
      continue
    }
    const bm = line.match(/^(Paid by|Paid to) (.+)$/i)
    if (bm) {
      cur.bank = bm[2].trim()
      continue
    }
  }

  return entries.filter((e) => e.hour !== null)
}

const pdfPath = process.argv[2]
if (!pdfPath) {
  console.error("Usage: node scripts/extract-statement.mjs <statement.pdf>")
  process.exit(1)
}

let text
try {
  text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" })
} catch (err) {
  console.error("Failed to run pdftotext. Is poppler installed? (brew install poppler)", err.message)
  process.exit(1)
}

const entries = parseStatement(text)

const outFile = resolve(ROOT, "src", "data", "statement-entries.json")
writeFileSync(outFile, JSON.stringify({ source: basename(pdfPath), entries }, null, 2), "utf8")

const byType = {}
for (const e of entries) byType[e.type] = (byType[e.type] ?? 0) + 1
console.log(`Parsed ${entries.length} entries from ${basename(pdfPath)}:`, byType)
console.log(`Wrote ${outFile}`)
