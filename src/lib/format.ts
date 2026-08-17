const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const WEEKDAYS_FULL = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
]

export function formatINR(n: number, compact = false): string {
  if (!isFinite(n)) return "—"
  const sign = n < 0 ? "−" : ""
  const abs = Math.abs(n)
  if (compact && abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`
  if (compact && abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`
  if (compact && abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}k`
  return `${sign}₹${abs.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export function formatINRFull(n: number): string {
  return `${n < 0 ? "−" : ""}₹${Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS_SHORT[month - 1]} ${String(year).slice(2)}`
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}

export function dateTimeLabel(y: number, mo: number, d: number, h: number, mi: number): string {
  const ampm = h >= 12 ? "PM" : "AM"
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${MONTHS_SHORT[mo - 1]} ${d}, ${y}, ${hr}:${String(mi).padStart(2, "0")} ${ampm}`
}

export function dateLabel(y: number, mo: number, d: number): string {
  return `${MONTHS_SHORT[mo - 1]} ${d}, ${y}`
}

export function weekdayName(weekday: number): string {
  return WEEKDAYS_FULL[weekday]
}

export function weekdayShort(weekday: number): string {
  return WEEKDAYS[weekday]
}

export function daysAgo(tsIso: string): number {
  const now = Date.now()
  const then = new Date(tsIso).getTime()
  return Math.floor((now - then) / 86_400_000)
}

export function isWithinPeriod(tsIso: string, days: number): boolean {
  return daysAgo(tsIso) <= days
}

export function pctShare(part: number, total: number): number {
  if (!total) return 0
  return (part / total) * 100
}
