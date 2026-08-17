/**
 * Supabase data client — talks to PostgREST using a Supabase-compatible JWT
 * minted from the user's Firebase ID token via the auth-exchange Edge Function.
 */
import { type User } from "firebase/auth"

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

/** Mint a Supabase-compatible JWT from a Firebase ID token. */
export async function mintSupabaseToken(firebaseToken: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
    body: JSON.stringify({ token: firebaseToken }),
  })
  if (!res.ok) throw new Error(`auth-exchange failed: ${res.status} ${await res.text()}`)
  const { access_token } = (await res.json()) as { access_token: string }
  return access_token
}

/** Cached Supabase JWT — set after auth-exchange, cleared on sign-out. */
let _supabaseJwt: string | null = null

export function setSupabaseJwt(token: string | null) {
  _supabaseJwt = token
  if (!token) sessionStorage.removeItem("supabase_jwt")
  else sessionStorage.setItem("supabase_jwt", token)
}

export function getSupabaseJwt(): string | null {
  if (_supabaseJwt) return _supabaseJwt
  _supabaseJwt = sessionStorage.getItem("supabase_jwt")
  return _supabaseJwt
}

export function clearSupabaseJwt() {
  _supabaseJwt = null
  sessionStorage.removeItem("supabase_jwt")
}

/* ------------------------------------------------------------------ */
/*  REST helpers (PostgREST)                                           */
/* ------------------------------------------------------------------ */

function authHeaders(): Record<string, string> {
  const jwt = getSupabaseJwt()
  return {
    apikey: SUPABASE_ANON,
    Authorization: jwt ? `Bearer ${jwt}` : `Bearer ${SUPABASE_ANON}`,
    "Content-Type": "application/json",
  }
}

export async function restGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ...authHeaders(), Prefer: "count=exact" },
  })
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function restPost<T>(path: string, rows: unknown[]): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function restPatch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export async function restDelete(path: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`DELETE ${path}: ${res.status} ${await res.text()}`)
}
