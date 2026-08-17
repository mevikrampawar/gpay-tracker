import type { LucideIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Sparkline } from "@/components/sparkline"
import { cn } from "@/lib/utils"

export interface Kpi {
  label: string
  value: string
  sub?: string
  icon?: LucideIcon
  accent?: "up" | "down" | "neutral"
  hint?: string
  spark?: number[]
  sparkColor?: string
  delta?: number
  deltaLabel?: string
}

export function KpiCard({ kpi, className }: { kpi: Kpi; className?: string }) {
  const Icon = kpi.icon
  const delta = kpi.delta
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {kpi.label}
        </CardTitle>
        {Icon && (
          <div className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-semibold tracking-tight tabular-nums">
            {kpi.value}
          </span>
          {delta !== undefined && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                delta >= 0
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive"
              )}
              title={kpi.deltaLabel}
            >
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
            </span>
          )}
        </div>
        {kpi.spark && kpi.spark.length > 1 && (
          <Sparkline
            data={kpi.spark}
            width={128}
            height={30}
            stroke={kpi.sparkColor ?? "var(--chart-1)"}
            className="-mx-1 mt-0.5"
          />
        )}
        {kpi.sub && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "inline-flex h-1.5 w-1.5 rounded-full",
                kpi.accent === "up" && "bg-emerald-500",
                kpi.accent === "down" && "bg-destructive",
                kpi.accent === "neutral" && "bg-muted-foreground"
              )}
            />
            {kpi.sub}
          </div>
        )}
        {kpi.hint && <p className="text-xs text-muted-foreground">{kpi.hint}</p>}
      </CardContent>
    </Card>
  )
}
