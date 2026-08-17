import { Gift, ArrowRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { navigate } from "@/lib/router"

export function RewardsPage() {

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Rewards"
        description="Cashback earned and voucher coupons collected"
        icon={Gift}
      />
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
          <Gift className="size-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">Coming soon</h2>
        <p className="text-sm text-muted-foreground">Rewards tracking will be available after the next data upload</p>
        <Button onClick={() => navigate("/upload")}>
          Upload Data <ArrowRight />
        </Button>
      </div>
    </div>
  )
}
