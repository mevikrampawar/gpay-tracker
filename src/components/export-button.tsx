import { Download, FileSpreadsheet, FileJson } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { downloadCSV, downloadJSON } from "@/lib/export-utils"

export interface ExportColumn {
  header: string
  value: (row: Record<string, unknown>) => string | number | null
}

export function ExportButton({
  filename,
  rows,
  columns,
  jsonData,
  label = "Export",
  disabled = false,
}: {
  filename: string
  rows: Record<string, unknown>[]
  columns: ExportColumn[]
  jsonData?: unknown
  label?: string
  disabled?: boolean
}) {
  const doCSV = () => {
    const headers = columns.map((c) => c.header)
    const data = rows.map((r) => columns.map((c) => c.value(r)))
    downloadCSV(`${filename}.csv`, headers, data)
  }
  const doJSON = () => {
    downloadJSON(`${filename}.json`, jsonData ?? rows)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>
        <Download data-icon="inline-start" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Export {rows.length.toLocaleString()} rows</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={doCSV}>
          <FileSpreadsheet /> CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={doJSON}>
          <FileJson /> JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
