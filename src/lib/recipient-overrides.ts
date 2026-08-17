import * as React from "react"
import type { CounterpartyClass } from "@/lib/classify"

export type RecipientOverrides = Record<string, CounterpartyClass>

const STORAGE_KEY = "gpay_recipient_overrides_v1"

function readOverrides(): RecipientOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function useRecipientOverrides() {
  const [overrides, setOverrides] = React.useState<RecipientOverrides>(readOverrides)

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
    } catch {
      /* ignore quota errors */
    }
  }, [overrides])

  const setOverride = React.useCallback((nameKey: string, cls: CounterpartyClass | null) => {
    setOverrides((prev) => {
      const next = { ...prev }
      if (cls) next[nameKey] = cls
      else delete next[nameKey]
      return next
    })
  }, [])

  const clearOverrides = React.useCallback(() => setOverrides({}), [])

  return { overrides, setOverride, clearOverrides }
}
