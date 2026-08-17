import { Store, ArrowRight } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { navigate } from "@/lib/router"

export function StorePage() {

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Store & Subscriptions"
        description="Google Play, YouTube and other digital purchases made through Google Pay"
        icon={Store}
      />
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
          <Store className="size-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold">Coming soon</h2>
        <p className="text-sm text-muted-foreground">Store purchase tracking will be available after the next data upload</p>
        <Button onClick={() => navigate("/upload")}>
          Upload Data <ArrowRight />
        </Button>
      </div>
    </div>
  )
}
