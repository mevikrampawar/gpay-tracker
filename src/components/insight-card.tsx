import {
  ArrowDownToLine,
  ArrowRight,
  Banknote,
  Calendar,
  Clock,
  FileCheck,
  Gift,
  Maximize,
  RefreshCw,
  Repeat,
  RotateCcw,
  Split,
  TrendingUp,
  UserRound,
  Sparkles,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { navigate } from "@/lib/router"
import type { Insight, InsightTone } from "@/lib/insights"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = {
  maximize: Maximize,
  "arrow-down-to-line": ArrowDownToLine,
  "user-round": UserRound,
  calendar: Calendar,
  "trending-up": TrendingUp,
  repeat: Repeat,
  banknote: Banknote,
  gift: Gift,
  "refresh-cw": RefreshCw,
  split: Split,
  clock: Clock,
  sparkles: Sparkles,
  "rotate-ccw": RotateCcw,
  "file-check": FileCheck,
}

const TONES: Record<InsightTone, { chip: string; glow: string }> = {
  blue: {
    chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    glow: "from-sky-500/15",
  },
  green: {
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    glow: "from-emerald-500/15",
  },
  amber: {
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    glow: "from-amber-500/15",
  },
  violet: {
    chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    glow: "from-violet-500/15",
  },
  rose: {
    chip: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    glow: "from-rose-500/15",
  },
  neutral: {
    chip: "bg-muted text-muted-foreground",
    glow: "from-muted",
  },
}

export function InsightCard({ insight }: { insight: Insight }) {
  const Icon = ICONS[insight.icon] ?? Sparkles
  const tone = TONES[insight.tone] ?? TONES.neutral
  return (
    <Card className="group relative overflow-hidden">
      <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b to-transparent", tone.glow)} />
      <CardContent className="relative flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <div className={cn("flex size-7 items-center justify-center rounded-md", tone.chip)}>
            <Icon className="size-4" />
          </div>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {insight.id.split("-").slice(0, 2).join(" ")}
          </span>
        </div>
        <h3 className="text-sm font-semibold leading-snug">{insight.title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{insight.body}</p>
        {insight.href && (
          <Button
            variant="ghost"
            size="sm"
            className="-mx-1 -mb-1 mt-auto h-7 w-fit gap-1 px-1 text-xs"
            onClick={() => navigate(insight.href!)}
          >
            {insight.cta ?? "Explore"} <ArrowRight className="size-3.5" />
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function InsightsGrid({ insights, limit }: { insights: Insight[]; limit?: number }) {
  const list = limit ? insights.slice(0, limit) : insights
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {list.map((i) => (
        <InsightCard key={i.id} insight={i} />
      ))}
    </div>
  )
}
