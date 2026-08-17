import { useState } from "react";
import {
  useGetDashboardSummary,
  useGetDashboardActivity,
  useGetDashboardCategoryBreakdown,
  useGetDashboardTrends,
  useGetSavingsGoals,
  useGetBudgetCategories,
  useGetMembers,
  useCreateExpense,
  useCreateContribution,
  useContributeToSavingsGoal,
  useCascadeContribute,
  useGetJointAccount,
  getGetDashboardSummaryQueryKey,
  getGetDashboardActivityQueryKey,
  getGetSavingsGoalsQueryKey,
  getGetContributionsQueryKey,
  getGetExpensesQueryKey,
  type SavingsGoal,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatKes, formatDate } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ArrowUpRight, ArrowDownRight, Wallet, Activity as ActivityIcon,
  Plus, TrendingUp, Target, Loader2, X, ChevronRight, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACTIVITY_TYPE } from "@/lib/activityTypes";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type QuickAction = "none" | "income" | "expense" | "goal";

const CHEGE_ID = "63497598";
const LYDIAH_ID = "63570605";

// ── Quick Action: Make a Bank Deposit ────────────────────────────────────────
function IncomeForm({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [forUserId, setForUserId] = useState<string>(CHEGE_ID);
  const createContribution = useCreateContribution();
  const qc = useQueryClient();
  const { toast } = useToast();
  const now = new Date();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    try {
      await createContribution.mutateAsync({
        data: { amount: amt, month: now.getMonth() + 1, year: now.getFullYear(), note: note || undefined, forUserId },
      });
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
      qc.invalidateQueries({ queryKey: getGetContributionsQueryKey() });
      const who = forUserId === CHEGE_ID ? "Chege" : "Lydiah";
      toast({ title: "Deposit recorded", description: `${who} · ${formatKes(amt)} added to this month.` });
      onDone();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not record deposit." });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Person picker */}
      <div className="space-y-1.5">
        <label className="text-sm font-semibold text-foreground">Who is depositing?</label>
        <div className="grid grid-cols-2 gap-2">
          {[{ id: CHEGE_ID, name: "Chege" }, { id: LYDIAH_ID, name: "Lydiah" }].map(({ id, name }) => (
            <button key={id} type="button" onClick={() => setForUserId(id)}
              className={`py-3 rounded-xl border text-sm font-semibold transition-colors ${forUserId === id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:bg-muted/40"}`}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">Amount (KES)</label>
          <Input type="number" placeholder="e.g. 50000" value={amount} onChange={e => setAmount(e.target.value)} min="1" required className="h-12 bg-card text-base" autoFocus />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">Note <span className="text-muted-foreground font-normal">(optional)</span></label>
          <Input placeholder="e.g. Salary, rental…" value={note} onChange={e => setNote(e.target.value)} className="h-12 bg-card" />
        </div>
      </div>
      <div className="flex gap-3">
        <Button type="submit" className="h-12 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex-1 text-base" disabled={createContribution.isPending}>
          {createContribution.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Make Deposit
        </Button>
        <Button type="button" variant="ghost" className="h-12" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

// ── Quick Action: Log Expense ────────────────────────────────────────────────
function ExpenseForm({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const { data: categories = [] } = useGetBudgetCategories();
  const { data: members = [] } = useGetMembers();
  const createExpense = useCreateExpense();
  const qc = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || !description || !paidBy) return;
    try {
      await createExpense.mutateAsync({
        data: { amount: amt, description, category: category, paidById: paidBy, date: new Date().toISOString().split('T')[0] },
      });
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
      qc.invalidateQueries({ queryKey: getGetExpensesQueryKey() });
      toast({ title: "Expense logged", description: `${formatKes(amt)} — ${description}` });
      onDone();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not log expense." });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">Amount (KES)</label>
          <Input type="number" placeholder="e.g. 2500" value={amount} onChange={e => setAmount(e.target.value)} min="1" required className="h-11 bg-card text-base" autoFocus />
        </div>
        <div className="space-y-1.5 lg:col-span-1">
          <label className="text-sm font-semibold text-foreground">Description</label>
          <Input placeholder="What was it for?" value={description} onChange={e => setDescription(e.target.value)} required className="h-11 bg-card" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">Category <span className="text-muted-foreground font-normal">(optional)</span></label>
          <select value={category} onChange={e => setCategory(e.target.value)} className="w-full h-11 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">Pick a category</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">
            Paid by <span className="text-destructive">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {members.map((m) => {
              const name = m.userName?.split(" ")[0] ?? "Member";
              return (
                <button key={m.userId} type="button" onClick={() => setPaidBy(m.userId)}
                  className={`h-11 rounded-lg border text-sm font-semibold transition-colors ${paidBy === m.userId ? "bg-primary text-primary-foreground border-primary" : "bg-card border-input text-foreground hover:bg-muted/40"}`}>
                  {name}
                </button>
              );
            })}
          </div>
          {!paidBy && <p className="text-xs text-muted-foreground">Choose who paid before saving.</p>}
        </div>
      </div>
      <div className="flex gap-3">
        <Button type="submit" className="h-11 px-6 rounded-xl bg-amber-600 hover:bg-amber-700 text-white" disabled={createExpense.isPending}>
          {createExpense.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Log Expense
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

// ── Quick Action: Save to Goal ───────────────────────────────────────────────
function GoalForm({ goals, onDone }: { goals: SavingsGoal[] | undefined; onDone: () => void }) {
  const activeGoals = goals?.filter(g => !g.isCompleted) ?? [];
  const [amount, setAmount] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState<"cascade" | number>(
    activeGoals.length === 1 ? activeGoals[0].id : "cascade"
  );
  const [cascadeResult, setCascadeResult] = useState<{ goalName: string; allocated: number; completed: boolean }[]>([]);
  const contributeToGoal = useContributeToSavingsGoal();
  const cascadeContribute = useCascadeContribute();
  const qc = useQueryClient();
  const { toast } = useToast();

  const isPending = contributeToGoal.isPending || cascadeContribute.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) return;

    try {
      if (selectedGoalId === "cascade") {
        const result = await cascadeContribute.mutateAsync({ data: { amount: amt } });
        setCascadeResult(result.allocations);
        const completed = result.allocations.filter(a => a.completed).length;
        toast({
          title: `${formatKes(amt)} distributed`,
          description: completed > 0 ? `${completed} goal${completed > 1 ? "s" : ""} completed! 🎉` : `Spread across ${result.allocations.length} goal${result.allocations.length !== 1 ? "s" : ""}.`,
        });
      } else {
        const goal = activeGoals.find(g => g.id === selectedGoalId);
        await contributeToGoal.mutateAsync({ id: selectedGoalId, data: { amount: amt } });
        toast({ title: "Saved!", description: `${formatKes(amt)} added to "${goal?.name}".` });
        onDone();
      }
      qc.invalidateQueries({ queryKey: getGetSavingsGoalsQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not save to goal." });
    }
  };

  if (activeGoals.length === 0) {
    return (
      <div className="flex items-center gap-4">
        <p className="text-sm text-muted-foreground">No active savings goals yet.</p>
        <Link href="/savings-goals"><Button variant="outline" size="sm" className="rounded-lg" onClick={onDone}>Create a goal →</Button></Link>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
      </div>
    );
  }

  if (cascadeResult.length > 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">How it was split</p>
        {cascadeResult.map((a, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <ChevronRight className="w-4 h-4 text-primary shrink-0" />
            <span className="flex-1 font-medium text-foreground">{a.goalName}</span>
            <span className="font-bold text-primary">{formatKes(a.allocated)}</span>
            {a.completed && <span className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-full font-semibold">Complete! 🎉</span>}
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={onDone} className="mt-1">Done</Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">Goal</label>
          <select
            value={selectedGoalId}
            onChange={e => setSelectedGoalId(e.target.value === "cascade" ? "cascade" : Number(e.target.value))}
            className="w-full h-11 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {activeGoals.length > 1 && <option value="cascade">Distribute across all goals (waterfall)</option>}
            {activeGoals.map(g => {
              const needed = g.targetAmount - g.currentAmount;
              return <option key={g.id} value={g.id}>{g.name} — {formatKes(needed)} needed</option>;
            })}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">Amount (KES)</label>
          <Input type="number" placeholder="e.g. 10000" value={amount} onChange={e => setAmount(e.target.value)} min="1" required className="h-11 bg-card text-base" autoFocus />
        </div>
      </div>
      <div className="flex gap-3">
        <Button type="submit" className="h-11 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white" disabled={isPending}>
          {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Save
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [activeAction, setActiveAction] = useState<QuickAction>("none");

  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary({ month, year });
  const { data: activity, isLoading: isActivityLoading } = useGetDashboardActivity();
  const { data: breakdown, isLoading: isBreakdownLoading } = useGetDashboardCategoryBreakdown({ month, year });
  const { data: trends, isLoading: isTrendsLoading } = useGetDashboardTrends({ months: 6 });
  const { data: goals } = useGetSavingsGoals();
  const { data: bankAccount } = useGetJointAccount();

  // Compute this-month totals from the transactions array
  const monthlyDeposited = bankAccount?.transactions
    .filter(t => {
      const d = new Date(t.date);
      return t.type === "deposit" && d.getFullYear() === year && d.getMonth() + 1 === month;
    })
    .reduce((s, t) => s + t.amount, 0) ?? 0;
  const monthlyDisbursed = bankAccount?.transactions
    .filter(t => {
      const d = new Date(t.date);
      return t.type === "disbursement" && d.getFullYear() === year && d.getMonth() + 1 === month;
    })
    .reduce((s, t) => s + t.amount, 0) ?? 0;

  const activeGoals = goals?.filter((g) => !g.isCompleted) ?? [];
  const nearestGoal = activeGoals.length > 0
    ? activeGoals.slice().sort((a, b) => {
        if (a.deadline && b.deadline) return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        return (b.currentAmount / b.targetAmount) - (a.currentAmount / a.targetAmount);
      })[0]
    : null;

  const toggle = (action: QuickAction) =>
    setActiveAction(prev => prev === action ? "none" : action);

  if (isSummaryLoading || isActivityLoading || isBreakdownLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-20 bg-muted rounded-2xl"></div>
        <div className="h-48 bg-muted rounded-2xl"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-64 bg-muted rounded-2xl"></div>
          <div className="h-64 bg-muted rounded-2xl"></div>
        </div>
      </div>
    );
  }

  if (!summary || !activity || !breakdown) return null;

  const percentSpent = summary.totalBudget > 0 ? (summary.totalSpent / summary.totalBudget) * 100 : 0;
  const isOverBudget = percentSpent > 100;
  const overBudgetCategories = breakdown.filter(b => b.percentUsed > 100);

  const chartData = breakdown
    .filter(b => b.spentAmount > 0)
    .sort((a, b) => b.spentAmount - a.spentAmount)
    .slice(0, 5)
    .map(b => ({ name: b.category, value: b.spentAmount, color: b.color || "hsl(var(--primary))" }));
  if (breakdown.filter(b => b.spentAmount > 0).length > 5) {
    chartData.push({ name: "Others", value: breakdown.filter(b => b.spentAmount > 0).sort((a,b) => b.spentAmount - a.spentAmount).slice(5).reduce((s,b) => s + b.spentAmount, 0), color: "hsl(var(--muted-foreground))" });
  }

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Family Overview</h1>
        <p className="text-muted-foreground mt-1">
          {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(now)}
        </p>
      </div>

      {/* ── Quick Actions ── */}
      <Card className="border-none shadow-md overflow-hidden">
        <CardContent className="p-0">
          {/* Action buttons row */}
          <div className="grid grid-cols-3 divide-x divide-border/50">
            {[
              { key: "income" as const, label: "Bank Deposit", icon: "💰", active: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-400" },
              { key: "expense" as const, label: "Log Expense",   icon: "📋", active: "bg-amber-50 dark:bg-amber-950/40",   text: "text-amber-700 dark:text-amber-400" },
              { key: "goal" as const,   label: "Save to Goal",  icon: "🎯", active: "bg-blue-50 dark:bg-blue-950/40",     text: "text-blue-700 dark:text-blue-400" },
            ].map(({ key, label, icon, active, text }) => (
              <button
                key={key}
                onClick={() => toggle(key)}
                className={`flex flex-col items-center justify-center gap-1.5 py-5 px-3 transition-colors font-medium text-sm sm:text-base ${activeAction === key ? `${active} ${text}` : "hover:bg-muted/40 text-foreground"}`}
              >
                <span className="text-2xl">{icon}</span>
                <span>{label}</span>
                {activeAction === key && <X className="w-3.5 h-3.5 mt-0.5 opacity-60" />}
              </button>
            ))}
          </div>

          {/* Expanded form */}
          {activeAction !== "none" && (
            <div className="border-t border-border/50 p-6 bg-muted/20">
              {activeAction === "income"  && <IncomeForm  onDone={() => setActiveAction("none")} />}
              {activeAction === "expense" && <ExpenseForm onDone={() => setActiveAction("none")} />}
              {activeAction === "goal"    && <GoalForm goals={goals} onDone={() => setActiveAction("none")} />}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Over-budget alert */}
      {overBudgetCategories.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-destructive font-bold text-sm">!</span>
          </div>
          <div>
            <p className="font-semibold text-destructive">Over budget in {overBudgetCategories.length} {overBudgetCategories.length === 1 ? "category" : "categories"}</p>
            <p className="text-sm text-destructive/80 mt-0.5">
              {overBudgetCategories.map(c => `${c.category} (+${formatKes(Math.abs(c.remaining))})`).join(" · ")}
            </p>
          </div>
        </div>
      )}

      {/* Hero Card */}
      <Card className="bg-primary text-primary-foreground border-none shadow-lg overflow-hidden relative">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
        <CardContent className="p-8 md:p-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-4 relative z-10">
            <div className="space-y-2">
              <p className="text-primary-foreground/80 font-medium">Total Budget</p>
              <p className="text-lg font-medium text-primary-foreground/70 tracking-wide">{formatKes(summary.totalBudget)}</p>
            </div>
            <div className="space-y-2">
              <p className="text-primary-foreground/80 font-medium">Total Spent</p>
              <p className="text-lg font-medium text-primary-foreground/70 tracking-wide">{formatKes(summary.totalSpent)}</p>
            </div>
            <div className="space-y-2 md:text-right">
              <p className="text-primary-foreground/80 font-medium">Remaining</p>
              <p className={`text-lg font-medium tracking-wide ${isOverBudget ? "text-destructive-foreground bg-destructive inline-block px-3 rounded-lg" : "text-primary-foreground/70"}`}>
                {formatKes(summary.remaining)}
              </p>
            </div>
          </div>
          <div className="mt-8">
            <div className="flex justify-between text-sm mb-2 text-primary-foreground/80 font-medium">
              <span>{Math.round(percentSpent)}% spent</span>
              <span>{isOverBudget ? "Over Budget" : "On Track"}</span>
            </div>
            <div className="h-3 w-full bg-black/20 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-1000 ${isOverBudget ? "bg-destructive" : "bg-secondary"}`} style={{ width: `${Math.min(percentSpent, 100)}%` }} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bank Account Balance Card */}
      <Link href="/bank">
        <Card className="border-none shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-shadow group">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Bank Account</p>
                  <p className="text-xs text-muted-foreground">Shared joint account</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Balance</p>
                <p className="text-2xl font-display font-bold text-sky-600 dark:text-sky-400">
                  {bankAccount ? formatKes(bankAccount.balance) : "—"}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Deposited</p>
                <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                  +{formatKes(monthlyDeposited)}
                </p>
                <p className="text-xs text-muted-foreground">this month</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Disbursed</p>
                <p className="text-lg font-semibold text-rose-600 dark:text-rose-400">
                  -{formatKes(monthlyDisbursed)}
                </p>
                <p className="text-xs text-muted-foreground">this month</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Contributions */}
        <Card className="border-none shadow-md overflow-hidden">
          <CardHeader className="bg-muted/30 border-b border-border/50 pb-4">
            <div className="flex items-center gap-2"><Wallet className="w-5 h-5 text-secondary" /><CardTitle className="text-xl">Contributions</CardTitle></div>
            <CardDescription>Target vs Contributed for this month</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {[
              { name: "Chege",  contributed: summary.chegeContributed,  target: summary.chegeTarget,  color: "bg-primary" },
              { name: "Lydiah", contributed: summary.lydiahContributed, target: summary.lydiahTarget, color: "bg-secondary" },
            ].map(({ name, contributed, target, color }) => (
              <div key={name} className="space-y-3">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="font-semibold text-foreground text-lg">{name}</p>
                    <p className="text-sm text-muted-foreground">Target: {formatKes(target)}</p>
                  </div>
                  <p className="font-display font-bold text-xl text-primary">{formatKes(contributed)}</p>
                </div>
                <div className="h-2.5 w-full bg-secondary/20 rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full transition-all duration-1000`} style={{ width: `${Math.min((contributed / target) * 100 || 0, 100)}%` }} />
                </div>
              </div>
            ))}
            <Link href="/contributions" className="text-sm font-medium text-primary hover:underline block pt-2">View contribution history →</Link>
          </CardContent>
        </Card>

        {/* Category Breakdown Chart */}
        <Card className="border-none shadow-md overflow-hidden">
          <CardHeader className="bg-muted/30 border-b border-border/50 pb-4">
            <div className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-secondary" /><CardTitle className="text-xl">Top Spending</CardTitle></div>
            <CardDescription>Where the money is going</CardDescription>
          </CardHeader>
          <CardContent className="p-6 h-[300px] flex items-center justify-center">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chartData} cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={2} dataKey="value" stroke="none">
                    {chartData.map((_, i) => <Cell key={i} fill={chartData[i].color} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatKes(v)} contentStyle={{ borderRadius: "0.75rem", border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground">No expenses recorded this month yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Savings Goals */}
      {nearestGoal && (
        <Card className="border-none shadow-md overflow-hidden">
          <CardHeader className="bg-muted/30 border-b border-border/50 pb-4 flex flex-row items-center justify-between">
            <div>
              <div className="flex items-center gap-2"><Target className="w-5 h-5 text-secondary" /><CardTitle className="text-xl">Savings Goals</CardTitle></div>
              <CardDescription>{activeGoals.length} active goal{activeGoals.length !== 1 ? "s" : ""}</CardDescription>
            </div>
            <Link href="/savings-goals" className="text-sm font-medium text-primary hover:underline">View all →</Link>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-1">
                <p className="font-semibold text-foreground">{nearestGoal.name}</p>
                {nearestGoal.deadline && (
                  <p className="text-xs text-muted-foreground">by {new Date(nearestGoal.deadline).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</p>
                )}
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-bold text-foreground">{formatKes(nearestGoal.currentAmount)}</span>
                <span className="text-muted-foreground">of {formatKes(nearestGoal.targetAmount)}</span>
              </div>
              <div className="h-3 w-full bg-secondary/20 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-700" style={{ width: `${Math.min((nearestGoal.currentAmount / nearestGoal.targetAmount) * 100, 100)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground text-right">{Math.round((nearestGoal.currentAmount / nearestGoal.targetAmount) * 100)}% reached</p>
            </div>
            {activeGoals.length > 1 && <p className="text-xs text-muted-foreground mt-4">+{activeGoals.length - 1} more goal{activeGoals.length - 1 !== 1 ? "s" : ""} in progress</p>}
          </CardContent>
        </Card>
      )}

      {/* 6-Month Trend */}
      <Card className="border-none shadow-md overflow-hidden">
        <CardHeader className="bg-muted/30 border-b border-border/50 pb-4">
          <div className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-secondary" /><CardTitle className="text-xl">6-Month Trend</CardTitle></div>
          <CardDescription>Monthly total spending</CardDescription>
        </CardHeader>
        <CardContent className="p-6 h-[280px]">
          {isTrendsLoading ? <div className="h-full bg-muted/30 rounded-xl animate-pulse" /> : trends && trends.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trends} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip formatter={(v: number) => [formatKes(v), "Spent"]} contentStyle={{ borderRadius: "0.75rem", border: "none", boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)" }} />
                <Bar dataKey="totalSpent" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-muted-foreground">No trend data yet.</div>}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card className="border-none shadow-md overflow-hidden">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-base font-bold text-foreground">Recent Activity</p>
            <Link href="/activity" className="text-xs font-medium text-primary hover:underline">View all</Link>
          </div>
          {activity.length > 0 ? (
            <div className="space-y-1">
              {activity.slice(0, 6).map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.type === ACTIVITY_TYPE.EXPENSE ? "bg-muted-foreground/40" : "bg-primary"}`} />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{item.description}</p>
                      <p className="text-xs text-muted-foreground">{item.userName} · {formatDate(item.date)}</p>
                    </div>
                  </div>
                  <p className={`text-sm font-medium whitespace-nowrap ml-3 ${item.type === ACTIVITY_TYPE.EXPENSE ? "text-foreground/70" : "text-primary"}`}>
                    {item.type === ACTIVITY_TYPE.EXPENSE ? "-" : "+"}{formatKes(item.amount)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No recent activity.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
