import * as React from "react"
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Loader2,
  RotateCcw,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/page-header"
import { uploadTakeoutZip, uploadBankCsv, uploadBankXlsx, type UploadResult } from "@/lib/source-upload"
import { useAuth } from "@/lib/auth-context"
import { useData } from "@/lib/data-context"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

type Phase = "idle" | "uploading" | "done" | "error"

export function UploadPage() {
  const { user } = useAuth()
  const { dbTransactions, refresh } = useData()

  const [phase, setPhase] = React.useState<Phase>("idle")
  const [dragging, setDragging] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [statusMsg, setStatusMsg] = React.useState("")
  const [result, setResult] = React.useState<UploadResult | null>(null)
  const [fileName, setFileName] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  const reset = () => {
    setPhase("idle")
    setProgress(0)
    setStatusMsg("")
    setResult(null)
    setFileName("")
  }

  const handleFile = async (file: File) => {
    if (!user) return
    setFileName(file.name)
    setPhase("uploading")
    setProgress(0)
    setStatusMsg("Starting upload…")

    try {
      const isZip = file.name.toLowerCase().endsWith(".zip")
      const isCsv = file.name.toLowerCase().endsWith(".csv")
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")

      if (!isZip && !isCsv && !isXlsx) {
        setPhase("error")
        setStatusMsg("Unsupported file type. Please upload a .zip, .csv, .xlsx, or .xls file.")
        return
      }

      const uploadFn = isZip ? uploadTakeoutZip : isXlsx ? uploadBankXlsx : uploadBankCsv
      const uploadResult = await uploadFn(file, user.uid, dbTransactions, (pct, msg) => {
        setProgress(pct)
        setStatusMsg(msg)
      })

      setResult(uploadResult)
      setPhase("done")
      await refresh()
    } catch (err) {
      setPhase("error")
      setStatusMsg(err instanceof Error ? err.message : "Upload failed. Please try again.")
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }

  const onDragLeave = () => setDragging(false)

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Upload Data"
        description="Import Google Takeout archives or bank statements (CSV/XLSX/XLS)"
        icon={Upload}
      />

      {phase === "idle" && (
        <Card
          className={cn(
            "cursor-pointer border-2 border-dashed transition-colors",
            dragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          )}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => inputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
              <Upload className="size-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-lg font-medium">Drop your file here</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Supports Google Takeout <Badge variant="secondary">.zip</Badge>,
                bank statements <Badge variant="secondary">.csv</Badge>,{" "}
                <Badge variant="secondary">.xlsx</Badge> or{" "}
                <Badge variant="secondary">.xls</Badge>
              </p>
            </div>
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              <FileText className="mr-2 size-4" />
              Browse files
            </Button>
          </CardContent>
        </Card>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".zip,.csv,.xlsx,.xls"
        className="hidden"
        onChange={onFileSelect}
      />

      {phase === "uploading" && (
        <Card>
          <CardContent className="flex flex-col gap-4 py-8">
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-primary" />
              <span className="text-sm font-medium">{fileName}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">{statusMsg}</p>
          </CardContent>
        </Card>
      )}

      {phase === "done" && result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-green-500" />
              Upload Complete
            </CardTitle>
            <CardDescription>{result.sourceLabel}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Inserted" value={result.inserted} />
              <StatCard label="Exact Matches" value={result.exactMatches} />
              <StatCard label="Pending Review" value={result.pendingMatches} />
              <StatCard label="Skipped" value={result.skipped + result.errors.length} />
            </div>
            {result.errors.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="flex flex-col gap-1">
                  {result.errors.map((e, i) => (
                    <span key={i}>{e}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => navigate("/")}>
                View Dashboard
                <ArrowRight className="ml-2 size-4" />
              </Button>
              <Button variant="outline" onClick={reset}>
                <RotateCcw className="mr-2 size-4" />
                Upload Another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {phase === "error" && (
        <Card className="border-destructive/50">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <AlertCircle className="size-10 text-destructive" />
            <p className="text-sm text-muted-foreground">{statusMsg}</p>
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="mr-2 size-4" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-bold">{value.toLocaleString()}</span>
    </div>
  )
}
