// Supabase Edge Function: auth-exchange
// Takes a Firebase ID token, verifies it, and mints a Supabase-compatible JWT.
// This bridges Firebase Auth → Supabase RLS so auth.uid() = Firebase user UID.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const SUPABASE_JWT_SECRET = Deno.env.get("JWT_SECRET")!
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") || "personal-trans-tracker"

/* ---- tiny JWT helpers (no deps) ---- */

function base64urlToBytes(b64: string): Uint8Array {
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))
  const raw = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + pad)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function importRsaKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "verify",
  ])
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(secret)
  return crypto.subtle.importKey("raw", enc, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
}

async function fetchFirebasePublicKeys(): Promise<Map<string, JsonWebKey>> {
  const res = await fetch(
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
  )
  if (!res.ok) throw new Error(`Failed to fetch Firebase public keys: ${res.status}`)
  const map = new Map<string, JsonWebKey>()
  const x509s = (await res.json()) as Record<string, string>
  for (const [kid, pem] of Object.entries(x509s)) {
    const certLines = pem.replace(/-----BEGIN CERTIFICATE-----/, "").replace(/-----END CERTIFICATE-----/, "").replace(/\s/g, "")
    const raw = atob(certLines)
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
    const der = new Uint8Array([48, 130, 1, 34, 48, 130, 1, 19, ...bytes.slice(33)])
    map.set(kid, { kty: "RSA", alg: "RS256", use: "sig", ext: true })
  }
  return map
}

// cache keys for 1h
let _keysCache: { keys: Map<string, JsonWebKey>; ts: number } | null = null

async function getFirebaseKey(kid: string): Promise<CryptoKey> {
  if (!_keysCache || Date.now() - _keysCache.ts > 3_600_000) {
    _keysCache = { keys: await fetchFirebasePublicKeys(), ts: Date.now() }
  }
  const jwk = _keysCache.keys.get(kid)
  if (!jwk) throw new Error(`Unknown Firebase key ID: ${kid}`)
  return importRsaKey(jwk)
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "authorization,content-type",
      },
    })
  }

  try {
    const { token } = (await req.json()) as { token?: string }
    if (!token) return json({ error: "missing token" }, 400)

    // 1. Decode header + payload (no verify yet — we need the kid)
    const [headerB64, payloadB64, sigB64] = token.split(".")
    if (!headerB64 || !payloadB64 || !sigB64) return json({ error: "malformed token" }, 400)

    const header = JSON.parse(new TextDecoder().decode(base64urlToBytes(headerB64)))
    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(payloadB64)))

    // 2. Verify Firebase ID token
    if (payload.aud !== FIREBASE_PROJECT_ID) {
      return json({ error: "wrong project" }, 401)
    }
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
      return json({ error: "token expired" }, 401)
    }
    if (!payload.user_id && !payload.sub) {
      return json({ error: "no user id" }, 401)
    }

    const key = await getFirebaseKey(header.kid)
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64urlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    )
    if (!valid) return json({ error: "invalid signature" }, 401)

    // 3. Mint Supabase-compatible HS256 JWT
    const uid = payload.user_id ?? payload.sub
    const now = Math.floor(Date.now() / 1000)
    const jwtHeader = { alg: "HS256", typ: "JWT" }
    const jwtPayload = {
      aud: "authenticated",
      exp: now + 60 * 60 * 24 * 7, // 7 days
      iat: now,
      sub: uid,
      email: payload.email ?? null,
      role: "authenticated",
      iss: "supabase",
    }

    const h = bytesToBase64url(new TextEncoder().encode(JSON.stringify(jwtHeader)))
    const p = bytesToBase64url(new TextEncoder().encode(JSON.stringify(jwtPayload)))
    const sigInput = `${h}.${p}`
    const hmacKey = await importHmacKey(SUPABASE_JWT_SECRET)
    const sig = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(sigInput))
    const supabaseJwt = `${sigInput}.${bytesToBase64url(new Uint8Array(sig))}`

    return json({ access_token: supabaseJwt, expires_in: 60 * 60 * 24 * 7 }, 200, {
      "Access-Control-Allow-Origin": "*",
    })
  } catch (e) {
    console.error("auth-exchange error", e)
    return json({ error: String(e) }, 500, { "Access-Control-Allow-Origin": "*" })
  }
})

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  })
}
