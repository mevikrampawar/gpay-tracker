#!/usr/bin/env node
/**
 * Seed Supabase with the current dashboard data (Google Pay Takeout bundle +
 * GPay statement PDF entries).
 *
 * Requires:
 *   VITE_SUPABASE_URL  and  SUPABASE_SERVICE_ROLE_KEY  (in .env.local)
 *   SUPABASE_USER_ID   the auth.uid() of the signed-up user (owner)
 *
 * Idempotent: re-running merges on primary keys (no duplicates).
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { bundle } from "../src/data/bundle.ts"
import { classifyName } from "../src/lib/classify.ts"
import statementData from "../src/data/statement-entries.json" with { type: "json" }

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

function loadEnv() {
  const out = {}
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  return out
}

const env = loadEnv()
const SUPABASE_URL = process.env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY
const USER_ID = process.env.SUPABASE_USER_ID ?? env.SUPABASE_USER_ID

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}
if (!USER_ID) {
  console.error("Missing SUPABASE_USER_ID — the auth.uid() that owns the data")
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const DNS_NS = Buffer.from("6ba7b811-9dad-11d1-80b4-00c04fd430c8".replace(/-/g, ""), "hex")
function uuidv5(name) {
  const hash = createHash("sha1").update(DNS_NS).update(name).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const sha256hex = (s) => createHash("sha256").update(s).digest("hex")

async function upsert(table, rows, { conflict = "id" } = {}) {
  if (rows.length === 0) return
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${conflict}`
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`upsert ${table} failed (${res.status}): ${text.slice(0, 500)}`)
    }
  }
  console.log(`  ${table}: ${rows.length.toLocaleString()} rows`)
}

/* ------------------------------------------------------------------ */
/* build payloads                                                      */
/* ------------------------------------------------------------------ */

const entries = statementData.entries ?? []

const DIR = { Paid: "out", Received: "in", Sent: "out" }
const TYPE = { Paid: "paid", Received: "received", Sent: "sent" }

const recId = (key) => uuidv5(`r:${key}`)

// recipients + aliases (from named transactions)
const recipientByName = new Map() // nameKey -> { displayName, count, aliases:Set }
for (const t of bundle.transactions) {
  if (!t.nameKey || !t.name) continue
  let r = recipientByName.get(t.nameKey)
  if (!r) {
    r = { displayName: t.name, count: 0, aliases: new Set() }
    recipientByName.set(t.nameKey, r)
  }
  r.count++
  if (t.name !== r.displayName) r.aliases.add(t.name)
}

const recipients = [...recipientByName.entries()].map(([key, r]) => ({
  id: recId(key),
  user_id: USER_ID,
  canonical_name: key,
  display_name: r.displayName,
  kind: classifyName(r.displayName, key),
}))

const recipientAliases = []
for (const [key, r] of recipientByName.entries()) {
  for (const a of r.aliases) {
    recipientAliases.push({
      id: uuidv5(`a:${recId(key)}:${a}`),
      recipient_id: recId(key),
      user_id: USER_ID,
      alias: a,
    })
  }
}

// transactions
const transactions = bundle.transactions.map((t) => ({
  id: uuidv5(`tx:${t.id}`),
  user_id: USER_ID,
  occurred_at: t.ts,
  amount_paise: Math.round(t.amount * 100),
  direction: DIR[t.type],
  type: TYPE[t.type],
  method: t.method || null,
  status: t.status || null,
  external_id: t.id || null,
  counterparty_id: t.nameKey ? recId(t.nameKey) : null,
  note: t.note || null,
}))

// sources
const takeoutHash = sha256hex(JSON.stringify(bundle.transactions)).slice(0, 24)
const sources = [
  {
    id: uuidv5("src:takeout"),
    user_id: USER_ID,
    kind: "takeout",
    label: "Google Pay Takeout (My Activity)",
    file_name: "Takeout-export.json",
    content_hash: takeoutHash,
    period_start: bundle.transactions[0]?.ts?.slice(0, 10) ?? null,
    period_end: bundle.transactions[bundle.transactions.length - 1]?.ts?.slice(0, 10) ?? null,
    raw_record_count: bundle.transactions.length,
  },
  {
    id: uuidv5("src:gpay_statement"),
    user_id: USER_ID,
    kind: "gpay_statement",
    label: "GPay statement Feb–Jul 2026",
    file_name: "gpay_statement_20260201_20260731.pdf",
    content_hash: sha256hex(JSON.stringify(entries)).slice(0, 24),
    period_start: "2026-02-01",
    period_end: "2026-07-31",
    raw_record_count: entries.length,
  },
]

const takeoutRecords = bundle.transactions.map((t, i) => ({
  id: uuidv5(`sr:takeout:${i}`),
  source_id: uuidv5("src:takeout"),
  user_id: USER_ID,
  row_index: i,
  raw: t,
}))

const stRecords = entries.map((e, i) => ({
  id: uuidv5(`sr:gpay_statement:${i}`),
  source_id: uuidv5("src:gpay_statement"),
  user_id: USER_ID,
  row_index: i,
  raw: e,
}))

// correlate statement entries -> takeout transactions (same GPay events)
const txIndex = new Map()
for (const t of bundle.transactions) {
  const ist = new Date(new Date(t.ts).getTime() + 5.5 * 3600000)
  const key = `${ist.getUTCFullYear()}-${ist.getUTCMonth() + 1}-${ist.getUTCDate()}|${t.type}|${t.amount}`
  if (!txIndex.has(key)) txIndex.set(key, [])
  txIndex.get(key).push({ t, min: ist.getUTCHours() * 60 + ist.getUTCMinutes() })
}

const correlations = []
for (let i = 0; i < entries.length; i++) {
  const e = entries[i]
  const key = `${e.year}-${e.month}-${e.day}|${e.type}|${e.amount}`
  const cands = (txIndex.get(key) ?? []).filter((c) => Math.abs(c.min - (e.hour * 60 + e.minute)) <= 5)
  if (cands.length !== 1) continue
  const tx = cands[0].t
  correlations.push({
    id: uuidv5(`corr:${uuidv5(`tx:${tx.id}`)}:${uuidv5(`sr:gpay_statement:${i}`)}`),
    transaction_id: uuidv5(`tx:${tx.id}`),
    source_record_id: uuidv5(`sr:gpay_statement:${i}`),
    confidence: 0.99,
    match_method: "date_amount",
    status: "accepted",
    user_id: USER_ID,
  })
}

/* ------------------------------------------------------------------ */
/* run                                                                */
/* ------------------------------------------------------------------ */

console.log(`Seeding ${SUPABASE_URL} as user ${USER_ID}`)
await upsert("sources", sources)
await upsert("recipients", recipients)
await upsert("recipient_aliases", recipientAliases)
await upsert("transactions", transactions)
await upsert("source_records", takeoutRecords)
await upsert("source_records", stRecords)
await upsert("correlations", correlations)
console.log(
  `Done. ${recipients.length.toLocaleString()} recipients, ${transactions.length.toLocaleString()} transactions, ${correlations.length.toLocaleString()} statement correlations.`
)
