import * as React from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useData, type UpiTransaction } from "@/lib/data-context"
import { Loader2 } from "lucide-react"

interface EditTransactionSheetProps {
  transaction: UpiTransaction | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditTransactionSheet({ transaction, open, onOpenChange }: EditTransactionSheetProps) {
  const { updateTx } = useData()
  const [saving, setSaving] = React.useState(false)

  const [type, setType] = React.useState<"Paid" | "Received" | "Sent">("Paid")
  const [amount, setAmount] = React.useState("")
  const [dateStr, setDateStr] = React.useState("")
  const [method, setMethod] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [note, setNote] = React.useState("")

  React.useEffect(() => {
    if (!transaction) return
    setType(transaction.type)
    setAmount(String(transaction.amount))
    const dt = new Date(transaction.ts)
    const local = new Date(dt.getTime() + 5.5 * 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, "0")
    setDateStr(
      `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`
    )
    setMethod(transaction.method ?? "")
    setStatus(transaction.status ?? "")
    setNote(transaction.note ?? "")
  }, [transaction])

  if (!transaction) return null

  const handleSave = async () => {
    if (!transaction) return
    setSaving(true)
    try {
      const dt = new Date(dateStr)
      const utc = new Date(dt.getTime() - 5.5 * 60 * 60 * 1000)

      await updateTx(transaction.dbId, {
        type: type.toLowerCase() as "paid" | "received" | "sent",
        direction: type === "Received" ? "in" : "out",
        amount_paise: Math.round(parseFloat(amount) * 100),
        occurred_at: utc.toISOString(),
        method: method || null,
        status: status || null,
        note: note || null,
      })
      onOpenChange(false)
    } catch (err) {
      console.error("Failed to save:", err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[480px] flex flex-col">
        <SheetHeader>
          <SheetTitle>Edit Transaction</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Type</label>
            <Select value={type} onValueChange={(v) => setType(v as "Paid" | "Received" | "Sent")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Paid">Paid</SelectItem>
                <SelectItem value="Received">Received</SelectItem>
                <SelectItem value="Sent">Sent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Amount (₹)</label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Date & Time</label>
            <Input
              type="datetime-local"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Payment Method</label>
            <Input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="e.g. UPI Lite, Bank Transfer"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Status</label>
            <Input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="e.g. SUCCESS"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description / Note</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Transaction description..."
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Reference ID (read-only)</label>
            <Input value={transaction.id} disabled className="opacity-60" />
          </div>
        </div>

        <SheetFooter className="px-4 py-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
