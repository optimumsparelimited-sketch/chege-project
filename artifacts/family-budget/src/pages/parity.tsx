import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { GitCompare, Search } from "lucide-react";

// ── Parity data ───────────────────────────────────────────────────────────────
// Keep this in sync with PARITY.md at the repo root.
// When you add or change a feature on either platform, update the relevant row
// here AND in PARITY.md (they must stay identical).
//
// Status values: "done" | "partial" | "missing"
//   done    = fully implemented
//   partial = partially implemented or in progress
//   missing = not yet implemented

type Status = "done" | "partial" | "missing";

interface ParityItem {
  feature: string;
  category: string;
  web: Status;
  mobile: Status;
  note?: string;
}

export const PARITY_ITEMS: ParityItem[] = [
  // ── Core screens ──────────────────────────────────────────────────────────
  {
    category: "Core screens",
    feature: "Dashboard / Home",
    web: "done",
    mobile: "done",
    note: "Web: charts & quick-action forms. Mobile: summary cards, bank balance, activity preview",
  },
  {
    category: "Core screens",
    feature: "Monthly budget overview",
    web: "done",
    mobile: "done",
    note: "Web: pie chart + category cards. Mobile: budget tab with category cards",
  },
  {
    category: "Core screens",
    feature: "Full activity feed screen",
    web: "done",
    mobile: "missing",
    note: "Mobile shows a 5-item dashboard preview; full feed screen is a pending task",
  },
  {
    category: "Core screens",
    feature: "Settings screen",
    web: "done",
    mobile: "missing",
    note: "Mobile Settings screen is a pending task",
  },
  {
    category: "Core screens",
    feature: "Platform parity page",
    web: "done",
    mobile: "missing",
    note: "This page is web-only",
  },

  // ── Expenses ──────────────────────────────────────────────────────────────
  {
    category: "Expenses",
    feature: "Expense list",
    web: "done",
    mobile: "done",
    note: "Mobile: hidden History tab reachable from the dashboard",
  },
  {
    category: "Expenses",
    feature: "Log an expense",
    web: "done",
    mobile: "done",
    note: "Web: inline form. Mobile: dedicated add-expense screen",
  },
  {
    category: "Expenses",
    feature: "Edit an expense (incl. payer correction)",
    web: "done",
    mobile: "done",
    note: "Both support editing all fields including payer",
  },
  {
    category: "Expenses",
    feature: "Delete an expense",
    web: "done",
    mobile: "done",
    note: "Both support deletion with confirmation",
  },
  {
    category: "Expenses",
    feature: "Recurring expense flag",
    web: "done",
    mobile: "done",
    note: "Both allow marking an expense as recurring",
  },
  {
    category: "Expenses",
    feature: "Apply prior-month recurring expenses",
    web: "done",
    mobile: "missing",
    note: "Mobile apply-from-prior-month is a pending task",
  },
  {
    category: "Expenses",
    feature: "Calendar date picker on expenses",
    web: "done",
    mobile: "missing",
    note: "Mobile uses arrow controls (prev/next day); calendar picker is a pending task",
  },

  // ── Budget ────────────────────────────────────────────────────────────────
  {
    category: "Budget",
    feature: "Category budget viewing",
    web: "done",
    mobile: "done",
    note: "Both show spend vs. budget per category",
  },
  {
    category: "Budget",
    feature: "Edit category limits",
    web: "done",
    mobile: "missing",
    note: "Web-only",
  },
  {
    category: "Budget",
    feature: "Balance mismatch alert",
    web: "partial",
    mobile: "missing",
    note: "Web surface is a pending task",
  },

  // ── Contributions ─────────────────────────────────────────────────────────
  {
    category: "Contributions",
    feature: "Record a deposit / contribution",
    web: "done",
    mobile: "done",
    note: "Both support recording monthly contributions per person",
  },
  {
    category: "Contributions",
    feature: "Contributor summary",
    web: "done",
    mobile: "done",
    note: "Both show per-person contributed / target / spent / net",
  },
  {
    category: "Contributions",
    feature: "Month navigation (prev / next)",
    web: "done",
    mobile: "done",
    note: "Both support browsing past months",
  },
  {
    category: "Contributions",
    feature: "Month-jump picker",
    web: "done",
    mobile: "done",
    note: "Both have a 24-month jump picker",
  },

  // ── Savings goals ─────────────────────────────────────────────────────────
  {
    category: "Savings goals",
    feature: "Savings goals list (active & completed)",
    web: "done",
    mobile: "done",
    note: "Both show active and completed goals",
  },
  {
    category: "Savings goals",
    feature: "Create a savings goal",
    web: "done",
    mobile: "done",
    note: "Both support goal creation with name, target, and optional deadline",
  },
  {
    category: "Savings goals",
    feature: "Goal deadline",
    web: "done",
    mobile: "done",
    note: "Both include a deadline picker on create / edit",
  },
  {
    category: "Savings goals",
    feature: "Edit a goal (name / target / deadline)",
    web: "done",
    mobile: "done",
    note: "Both support editing; mobile also renames completed goals",
  },
  {
    category: "Savings goals",
    feature: "Delete a goal",
    web: "done",
    mobile: "done",
    note: "Both support deletion with confirmation",
  },
  {
    category: "Savings goals",
    feature: "Contribute to a single goal",
    web: "done",
    mobile: "done",
    note: "Both support per-goal contributions",
  },
  {
    category: "Savings goals",
    feature: "Cascade / waterfall contribution",
    web: "done",
    mobile: "missing",
    note: "Web distributes across all goals in priority order; mobile is single-goal only",
  },
  {
    category: "Savings goals",
    feature: "Goal completion badge",
    web: "done",
    mobile: "done",
    note: "Web: badge on goal card. Mobile: 'Goal reached!' label; completed goals omit contribute button",
  },
  {
    category: "Savings goals",
    feature: "Goal history with date filters",
    web: "done",
    mobile: "done",
    note: "Both show per-goal contribution history with month / range filters",
  },
  {
    category: "Savings goals",
    feature: "Display correction reason in history",
    web: "partial",
    mobile: "partial",
    note: "Reason is captured on both platforms but not yet shown in history — pending task",
  },
  {
    category: "Savings goals",
    feature: "Balance correction (edit current amount)",
    web: "done",
    mobile: "done",
    note: "Both allow correcting current amount; large corrections (>50%) require a reason",
  },

  // ── Bank ──────────────────────────────────────────────────────────────────
  {
    category: "Bank",
    feature: "Bank account balance display",
    web: "done",
    mobile: "done",
    note: "Both show current balance; mobile shows it on dashboard card and bank tab",
  },
  {
    category: "Bank",
    feature: "Bank transactions list",
    web: "done",
    mobile: "done",
    note: "Both show deposit / disbursement transaction history",
  },
  {
    category: "Bank",
    feature: "Record a bank deposit",
    web: "done",
    mobile: "done",
    note: "Both support recording deposits with optional member / description",
  },
  {
    category: "Bank",
    feature: "Record a disbursement",
    web: "done",
    mobile: "done",
    note: "Both support recording disbursements",
  },
  {
    category: "Bank",
    feature: "Delete a bank transaction",
    web: "done",
    mobile: "missing",
    note: "Web-only; mobile bank screen has no delete action — pending task",
  },
  {
    category: "Bank",
    feature: "Date selection on bank transactions",
    web: "done",
    mobile: "missing",
    note: "Mobile always uses today's date — pending task",
  },

  // ── Members & auth ────────────────────────────────────────────────────────
  {
    category: "Members & auth",
    feature: "Authentication (sign-in)",
    web: "done",
    mobile: "done",
    note: "Both use Replit Auth / deep-link token flow",
  },
  {
    category: "Members & auth",
    feature: "Add / remove partner",
    web: "done",
    mobile: "missing",
    note: "Settings page on web; no equivalent on mobile",
  },
  {
    category: "Members & auth",
    feature: "Dark mode",
    web: "done",
    mobile: "done",
    note: "Both respect the system theme",
  },
];

// ── Status helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Status }) {
  if (status === "done") {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 font-semibold">
        ✅ Done
      </Badge>
    );
  }
  if (status === "partial") {
    return (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0 font-semibold">
        ⏳ Partial
      </Badge>
    );
  }
  return (
    <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border-0 font-semibold">
      ❌ Missing
    </Badge>
  );
}

// ── Summary stats ─────────────────────────────────────────────────────────────

function statsByPlatform(items: ParityItem[], key: "web" | "mobile") {
  const done = items.filter((i) => i[key] === "done").length;
  const partial = items.filter((i) => i[key] === "partial").length;
  const missing = items.filter((i) => i[key] === "missing").length;
  return { done, partial, missing, total: items.length };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Parity() {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | Status>("all");

  const filtered = PARITY_ITEMS.filter((item) => {
    const matchesSearch =
      search === "" ||
      item.feature.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase()) ||
      (item.note ?? "").toLowerCase().includes(search.toLowerCase());

    const matchesFilter =
      filterStatus === "all" ||
      item.web === filterStatus ||
      item.mobile === filterStatus;

    return matchesSearch && matchesFilter;
  });

  const webStats = statsByPlatform(PARITY_ITEMS, "web");
  const mobileStats = statsByPlatform(PARITY_ITEMS, "mobile");

  const categories = Array.from(new Set(filtered.map((i) => i.category)));

  return (
    <div className="space-y-8 pb-12 max-w-5xl">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Platform Parity</h1>
        <p className="text-muted-foreground mt-1">
          Current feature coverage across the web app and the mobile app.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { label: "Web App", icon: "🌐", stats: webStats },
          { label: "Mobile App", icon: "📱", stats: mobileStats },
        ].map(({ label, icon, stats }) => (
          <Card key={label} className="border-none shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">{icon}</span>
                <p className="font-semibold text-lg text-foreground">{label}</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-2xl font-display font-bold text-emerald-600 dark:text-emerald-400">
                    {stats.done}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Done</p>
                </div>
                <div>
                  <p className="text-2xl font-display font-bold text-amber-600 dark:text-amber-400">
                    {stats.partial}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Partial</p>
                </div>
                <div>
                  <p className="text-2xl font-display font-bold text-rose-600 dark:text-rose-400">
                    {stats.missing}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Missing</p>
                </div>
              </div>
              <div className="mt-4 h-2 w-full bg-muted rounded-full overflow-hidden flex gap-0.5">
                <div
                  className="bg-emerald-500 h-full rounded-l-full transition-all"
                  style={{ width: `${(stats.done / stats.total) * 100}%` }}
                />
                <div
                  className="bg-amber-400 h-full transition-all"
                  style={{ width: `${(stats.partial / stats.total) * 100}%` }}
                />
                <div
                  className="bg-rose-400 h-full rounded-r-full transition-all"
                  style={{ width: `${(stats.missing / stats.total) * 100}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="border-none shadow-md">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-primary" />
            <CardTitle>Feature Checklist</CardTitle>
          </div>
          <CardDescription>
            {PARITY_ITEMS.length} features tracked · {filtered.length} shown
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search + filter bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search features…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-10 bg-card"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {(["all", "done", "partial", "missing"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterStatus(f)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    filterStatus === f
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-foreground hover:bg-muted/40"
                  }`}
                >
                  {f === "all"
                    ? "All"
                    : f === "done"
                    ? "✅ Done"
                    : f === "partial"
                    ? "⏳ Partial"
                    : "❌ Missing"}
                </button>
              ))}
            </div>
          </div>

          {/* Table per category */}
          {categories.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No features match your filters.
            </p>
          ) : (
            <div className="space-y-6">
              {categories.map((cat) => {
                const rows = filtered.filter((i) => i.category === cat);
                return (
                  <div key={cat}>
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-1">
                      {cat}
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[38%]">Feature</TableHead>
                          <TableHead className="w-[14%]">Web</TableHead>
                          <TableHead className="w-[14%]">Mobile</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((item) => (
                          <TableRow key={item.feature}>
                            <TableCell className="font-medium text-foreground">
                              {item.feature}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={item.web} />
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={item.mobile} />
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs">
                              {item.note ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center pb-4">
        Source of truth:{" "}
        <code className="font-mono bg-muted px-1 py-0.5 rounded">PARITY.md</code> at the repo
        root. Update both files when a feature lands on either platform.
      </p>
    </div>
  );
}
