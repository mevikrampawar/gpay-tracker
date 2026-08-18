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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PageHeader } from "@/components/page-header"
import { uploadTakeoutZip, uploadBankCsv, uploadBankXlsx, uploadStoreCsv, uploadCashbackCsv, uploadVoucherJson, uploadGroupExpensesJson, type UploadResult, PasswordRequiredError } from "@/lib/source-upload"
import { useAuth } from "@/lib/auth-context"
import { useData } from "@/lib/data-context"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

type Phase = "idle" | "uploading" | "done" | "error"

export function UploadPage() {
  const { user } = useAuth()
  const { refresh } = useData()

  const [phase, setPhase] = React.useState<Phase>("idle")
  const [dragging, setDragging] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [statusMsg, setStatusMsg] = React.useState("")
  const [result, setResult] = React.useState<UploadResult | null>(null)
  const [fileName, setFileName] = React.useState("")
  const [progressLogs, setProgressLogs] = React.useState<Array<{ time: number; message: string }>>([])
  const [passwordModal, setPasswordModal] = React.useState<{ open: boolean; error: boolean }>({ open: false, error: false })
  const [passwordInput, setPasswordInput] = React.useState("")
  const [uploadKind, setUploadKind] = React.useState<"auto" | "takeout" | "bank" | "store" | "cashback" | "vouchers" | "group_expenses">("auto")
  const pendingFileRef = React.useRef<File | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const reset = () => {
    setPhase("idle")
    setProgress(0)
    setStatusMsg("")
    setResult(null)
    setFileName("")
    setProgressLogs([])
    setUploadKind("auto")
  }

  const handleFile = async (file: File, password?: string) => {
    if (!user) return
    setFileName(file.name)
    setPhase("uploading")
    setProgress(0)
    setProgressLogs([])
    setStatusMsg("Starting upload…")

    try {
      const isZip = file.name.toLowerCase().endsWith(".zip")
      const isCsv = file.name.toLowerCase().endsWith(".csv")
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")
      const isJson = file.name.toLowerCase().endsWith(".json")

      if (!isZip && !isCsv && !isXlsx && !isJson) {
        setPhase("error")
        setStatusMsg("Unsupported file type. Please upload a .zip, .csv, .xlsx, .xls, or .json file.")
        return
      }

      const uploadFn = (() => {
        if (uploadKind === "takeout") return uploadTakeoutZip
        if (uploadKind === "bank") return isXlsx ? uploadBankXlsx : uploadBankCsv
        if (uploadKind === "store") return uploadStoreCsv
        if (uploadKind === "cashback") return uploadCashbackCsv
        if (uploadKind === "vouchers") return uploadVoucherJson
        if (uploadKind === "group_expenses") return uploadGroupExpensesJson
        // Auto-detect
        if (isZip) return uploadTakeoutZip
        if (isXlsx) return uploadBankXlsx
        if (isJson) return uploadGroupExpensesJson
        return uploadBankCsv
      })()
      const uploadResult = await uploadFn(file, user.uid, (pct, log) => {
        setProgress(pct)
        setProgressLogs(prev => {
          if (prev.length > 0 && prev[prev.length - 1].message === log) return prev
          return [...prev, { time: Date.now(), message: log }]
        })
      }, isXlsx ? password : undefined)

      setResult(uploadResult)
      setPhase("done")
      await refresh()
    } catch (err) {
      if (err instanceof PasswordRequiredError) {
        const wasRetry = passwordInput.length > 0
        pendingFileRef.current = file
        setPasswordModal({ open: true, error: wasRetry })
        if (!wasRetry) setPasswordInput("")
        setPhase("idle")
        return
      }
      setPhase("error")
      setStatusMsg(err instanceof Error ? err.message : "Upload failed. Please try again.")
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (phase === "uploading") return
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (phase !== "uploading") setDragging(true)
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
        <>
          <div className="mb-4">
            <label className="text-sm font-medium mb-2 block">What are you uploading?</label>
            <Select value={uploadKind} onValueChange={(v) => setUploadKind(v)}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect (recommended)</SelectItem>
                <SelectItem value="takeout">Google Takeout (ZIP)</SelectItem>
                <SelectItem value="bank">Bank Statement (CSV/XLSX)</SelectItem>
                <SelectItem value="store">Store Transactions (CSV)</SelectItem>
                <SelectItem value="cashback">Cashback Rewards (CSV)</SelectItem>
                <SelectItem value="vouchers">Voucher Rewards (JSON)</SelectItem>
                <SelectItem value="group_expenses">Group Expenses (JSON)</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
              <p className="text-lg font-medium">
                <span className="hidden sm:inline">Drop your file here</span>
                <span className="sm:hidden">Tap to select a file</span>
              </p>
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
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".zip,.csv,.xlsx,.xls,.json"
        className="hidden"
        onChange={onFileSelect}
      />

      {phase === "uploading" && (
        <Card>
          <CardContent className="flex flex-col gap-4 py-6">
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

            <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/30 p-3">
              {progressLogs.map((entry, i) => (
                <div key={i} className="flex items-start gap-2 py-1 text-sm">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-green-500" />
                  <span className="text-muted-foreground">{entry.message}</span>
                </div>
              ))}
              {progressLogs.length === 0 && (
                <div className="flex items-center gap-2 py-1 text-sm">
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                  <span className="text-muted-foreground">Starting...</span>
                </div>
              )}
            </div>

            <Button variant="outline" size="sm" onClick={() => { setPhase("idle"); setProgressLogs([]) }}>
              Cancel
            </Button>
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
            {(result.storeCount ?? 0) > 0 || (result.rewardsCount ?? 0) > 0 || (result.vouchersCount ?? 0) > 0 || (result.groupExpensesCount ?? 0) > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(result.storeCount ?? 0) > 0 && <StatCard label="Store Transactions" value={result.storeCount!} />}
                {(result.rewardsCount ?? 0) > 0 && <StatCard label="Cashback Rewards" value={result.rewardsCount!} />}
                {(result.vouchersCount ?? 0) > 0 && <StatCard label="Voucher Rewards" value={result.vouchersCount!} />}
                {(result.groupExpensesCount ?? 0) > 0 && <StatCard label="Group Expenses" value={result.groupExpensesCount!} />}
              </div>
            ) : null}
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

      <Dialog open={passwordModal.open} onOpenChange={(open) => setPasswordModal(prev => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Protected File</DialogTitle>
            <DialogDescription>
              This file is password-protected. Enter the password to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              type="password"
              placeholder="Enter password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && passwordInput.trim()) {
                  setPasswordModal({ open: false, error: false })
                  if (pendingFileRef.current) {
                    handleFile(pendingFileRef.current, passwordInput.trim())
                  }
                }
              }}
            />
            {passwordModal.error && (
              <p className="text-sm text-destructive">Incorrect password. Please try again.</p>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!passwordInput.trim()}
                onClick={() => {
                  setPasswordModal({ open: false, error: false })
                  if (pendingFileRef.current) {
                    handleFile(pendingFileRef.current, passwordInput.trim())
                  }
                }}
              >
                Unlock
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPasswordModal({ open: false, error: false })}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
