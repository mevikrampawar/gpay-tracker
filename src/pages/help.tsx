import {
  BookOpen,
  Upload,
  Banknote,
  LayoutDashboard,
  Link2,
  Shield,
  FileText,
  ExternalLink,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Gift,
  Split,
  BrainCircuit,
  RefreshCw,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { navigate } from "@/lib/router"

function FeatureCard({
  title,
  icon: Icon,
  description,
}: {
  title: string
  icon: typeof LayoutDashboard
  description: string
}) {
  return (
    <Card className="gap-3">
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Icon className="size-4 text-primary" />
          {title}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  )
}

export function HelpPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Help Guide"
        description="Everything you need to get started with GPay Insights"
        icon={BookOpen}
      />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Getting Started</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LayoutDashboard className="size-4 text-primary" />
                What is GPay Insights?
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              GPay Insights is a personal finance dashboard that transforms your Google Pay
              transaction history into actionable insights. It provides KPIs, spending trends,
              recipient analytics, AI-powered analysis, and more — all processed locally with
              data stored securely in Supabase.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle2 className="size-4 text-primary" />
                Prerequisites
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <ul className="flex flex-col gap-2">
                <li className="flex items-start gap-2">
                  <Badge variant="secondary" className="mt-0.5 shrink-0">Required</Badge>
                  A Google Takeout export with your Google Pay data
                </li>
                <li className="flex items-start gap-2">
                  <Badge variant="outline" className="mt-0.5 shrink-0">Optional</Badge>
                  HDFC bank statement exported as CSV for cross-referencing
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Setup Steps</h2>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                1
              </span>
              Export Your Google Pay Data
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <ol className="flex flex-col gap-2 list-decimal list-inside">
              <li>
                Go to{" "}
                <a
                  href="https://takeout.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                >
                  takeout.google.com
                  <ExternalLink className="size-3" />
                </a>
              </li>
              <li>Click "Deselect all" and then select only <strong className="text-foreground">Google Pay</strong></li>
              <li>Click "Next step" and choose your export format (ZIP is default)</li>
              <li>Click "Create export" and wait for the email</li>
              <li>Download the ZIP file from the email link</li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                2
              </span>
              Upload Your Data
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <ol className="flex flex-col gap-2 list-decimal list-inside">
              <li>Navigate to the <strong className="text-foreground">Upload Data</strong> page</li>
              <li>Drag your Google Takeout ZIP file into the upload zone, or click "Browse files"</li>
              <li>Wait for processing — it may take a minute for large transaction histories</li>
              <li>Review the results summary (inserted, matched, pending)</li>
              <li>Your dashboard will automatically populate with the imported data</li>
            </ol>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => navigate("/upload")}>
              <Upload className="mr-2 size-4" />
              Go to Upload Page
              <ArrowRight className="ml-1 size-3" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                3
              </span>
              Optional — Add Bank Statements
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <ol className="flex flex-col gap-2 list-decimal list-inside">
              <li>Log in to your HDFC NetBanking portal</li>
              <li>Export your account statement as a CSV file</li>
              <li>Go to the Upload page and drop the CSV file</li>
              <li>
                The system will automatically match bank transactions to Google Pay
                transactions using UPI reference IDs
              </li>
            </ol>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Understanding the Dashboard</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard title="Overview" icon={LayoutDashboard} description="High-level KPIs, monthly spending trends, and top recipients at a glance." />
          <FeatureCard title="Transactions" icon={FileText} description="Full searchable and filterable list of all your transactions." />
          <FeatureCard title="Recipients" icon={Banknote} description="People and merchants you transact with regularly." />
          <FeatureCard title="Analytics" icon={LayoutDashboard} description="Deep-dive charts, spending trends, and category breakdowns." />
          <FeatureCard title="Rewards" icon={Gift} description="Cashback earned and vouchers received over time." />
          <FeatureCard title="Group Expenses" icon={Split} description="Split bills and settlements with friends and groups." />
          <FeatureCard title="Neural Dashboard" icon={BrainCircuit} description="AI-powered spending pattern detection and anomaly alerts." />
          <FeatureCard title="AI Analyst" icon={Sparkles} description="Narrative insights, suggestions, and financial recommendations." />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Data Correlation</h2>
        <Card>
          <CardContent className="flex flex-col gap-4 py-6 text-sm text-muted-foreground">
            <div className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 font-medium text-foreground">
                <Link2 className="size-4" />
                How Deduplication Works
              </h3>
              <ul className="flex flex-col gap-2 pl-6 list-disc">
                <li><strong className="text-foreground">Exact UPI ref matches</strong> are automatically linked across Google Pay and bank statement sources.</li>
                <li><strong className="text-foreground">Fuzzy matches</strong> (same amount + date + recipient but different UPI refs) are flagged as "Pending Review" so you can decide.</li>
                <li>Same amount, date, and recipient from different sources are treated as <strong className="text-foreground">different transactions</strong> unless they share an exact UPI reference ID.</li>
                <li>Ambiguous matches are <strong className="text-foreground">never auto-merged</strong> — you always have full control over what gets linked.</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">FAQ</h2>
        <div className="flex flex-col gap-3">
          <FaqItem
            icon={Shield}
            question="Is my data secure?"
            answer="All processing happens locally in your browser. Raw files are never sent to any server. Only the parsed transaction data is stored in your encrypted Supabase database, which is protected by Row Level Security."
          />
          <FaqItem
            icon={RefreshCw}
            question="Can I re-upload?"
            answer="Yes. Each file is hashed (SHA-256) before import. If you try to upload the exact same file again, it will be detected as a duplicate and skipped automatically."
          />
          <FaqItem
            icon={FileText}
            question="What formats are supported?"
            answer="Google Takeout ZIP files (containing My Activity.html) and HDFC bank statement CSVs. More bank formats may be added in the future."
          />
        </div>
      </section>

      <div className="flex justify-center pb-4">
        <Button onClick={() => navigate("/upload")}>
          <Upload className="mr-2 size-4" />
          Start Uploading Your Data
          <ArrowRight className="ml-2 size-4" />
        </Button>
      </div>
    </div>
  )
}

function FaqItem({
  icon: Icon,
  question,
  answer,
}: {
  icon: typeof Shield
  question: string
  answer: string
}) {
  return (
    <Card>
      <CardContent className="flex gap-3 py-4">
        <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{question}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{answer}</p>
        </div>
      </CardContent>
    </Card>
  )
}
