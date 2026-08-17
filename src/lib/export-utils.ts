export function toCSV(
  headers: string[],
  rows: (string | number | null | undefined)[][]
): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return ""
    const s = String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n")
}

export function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  const blob = new Blob(["\ufeff" + toCSV(headers, rows)], { type: "text/csv;charset=utf-8" })
  triggerDownload(filename, blob)
}

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" })
  triggerDownload(filename, blob)
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
