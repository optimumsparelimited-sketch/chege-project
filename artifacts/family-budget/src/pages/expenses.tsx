import { useState, useEffect } from "react";

// Expense priority tiers from the budget document
const EXPENSE_TIERS = [
  {
    tier: 1, label: "Survival Essentials",
    bar: "bg-red-500", badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    categories: ["Rent", "Food", "School fees", "Nanny salary", "Water & electricity"],
  },
  {
    tier: 2, label: "Health & Education",
    bar: "bg-orange-400", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
    categories: ["Medical outpatient", "Medical insurance", "Uniform replenishment"],
  },
  {
    tier: 3, label: "Daily Household",
    bar: "bg-yellow-400", badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
    categories: ["Household supplies", "Kids clothes"],
  },
  {
    tier: 4, label: "Connectivity & Care",
    bar: "bg-blue-400", badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    categories: ["Wifi/data", "Grooming"],
  },
  {
    tier: 5, label: "Discretionary",
    bar: "bg-muted-foreground/50", badge: "bg-muted text-muted-foreground",
    categories: ["Entertainment", "Pocket money"],
  },
];

import {
  useGetExpenses, useGetBudgetCategories, useGetMembers,
  useCreateExpense, useDeleteExpense, useUpdateExpense, useApplyRecurringExpenses,
  useGetDashboardSummary, useGetDashboardCategoryBreakdown,
  getGetExpensesQueryKey, getGetDashboardSummaryQueryKey,
  getGetDashboardCategoryBreakdownQueryKey, getGetDashboardActivityQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatKes, formatDate, formatMonthYear } from "@/lib/utils";
import { Trash2, Plus, ArrowLeft, ArrowRight, Loader2, Calendar, RefreshCw, Repeat, Pencil, TrendingUp, TrendingDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type Expense = {
  id: number;
  amount: number;
  category: string;
  description: string;
  notes?: string | null;
  paidById: string;
  paidByName: string;
  isRecurring: boolean;
  date: string;
};

function useExpenseForm(defaults?: Partial<Expense>, now?: Date) {
  const today = now ?? new Date();
  const [amount, setAmount] = useState(defaults?.amount?.toString() ?? "");
  const [category, setCategory] = useState(defaults?.category ?? "");
  const [description, setDescription] = useState(defaults?.description ?? "");
  const [notes, setNotes] = useState(defaults?.notes ?? "");
  const [paidById, setPaidById] = useState(defaults?.paidById ?? "");
  const [isRecurring, setIsRecurring] = useState(defaults?.isRecurring ?? false);
  const [date, setDate] = useState(defaults?.date ?? today.toISOString().split("T")[0]);
  return { amount, setAmount, category, setCategory, description, setDescription, notes, setNotes, paidById, setPaidById, isRecurring, setIsRecurring, date, setDate };
}

const EXPENSES_MONTH_KEY = "expenses-month-pref";

export default function Expenses() {
  const now = new Date();
  const { user } = useAuth();
  const [month, setMonth] = useState(() => {
    try {
      const raw = localStorage.getItem(EXPENSES_MONTH_KEY);
      if (raw) { const p = JSON.parse(raw); if (typeof p?.month === "number") return p.month; }
    } catch {}
    return now.getMonth() + 1;
  });
  const [year, setYear] = useState(() => {
    try {
      const raw = localStorage.getItem(EXPENSES_MONTH_KEY);
      if (raw) { const p = JSON.parse(raw); if (typeof p?.year === "number") return p.year; }
    } catch {}
    return now.getFullYear();
  });

  useEffect(() => {
    try { localStorage.setItem(EXPENSES_MONTH_KEY, JSON.stringify({ month, year })); } catch {}
  }, [month, year]);

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const addForm = useExpenseForm(undefined, now);
  const editForm = useExpenseForm();

  const { data: expenses, isLoading } = useGetExpenses({ month, year });
  const { data: categories } = useGetBudgetCategories();
  const { data: members } = useGetMembers();
  const { data: summary } = useGetDashboardSummary({ month, year });
  const { data: breakdown } = useGetDashboardCategoryBreakdown({ month, year });
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const applyRecurring = useApplyRecurringExpenses();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const { data: prevExpenses } = useGetExpenses({ month: prevMonth, year: prevYear });
  const recurringFromPrev = (prevExpenses ?? []).filter(e => e.isRecurring);
  const alreadyApplied = (expenses ?? []).some(e => e.isRecurring);
  const showRecurringBanner = recurringFromPrev.length > 0 && !alreadyApplied;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetExpensesQueryKey({ month, year }) });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey({ month, year }) });
    queryClient.invalidateQueries({ queryKey: getGetDashboardCategoryBreakdownQueryKey({ month, year }) });
    queryClient.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
  };

  const handlePrevMonth = () => { if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1); };
  const handleNextMonth = () => { if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1); };

  const resetAdd = () => {
    addForm.setAmount(""); addForm.setCategory(""); addForm.setDescription(""); addForm.setNotes("");
    addForm.setPaidById(""); addForm.setIsRecurring(false);
    addForm.setDate(now.toISOString().split("T")[0]);
    setIsAdding(false);
  };

  const startEdit = (expense: Expense) => {
    editForm.setAmount(expense.amount.toString());
    editForm.setCategory(expense.category);
    editForm.setDescription(expense.description);
    editForm.setNotes(expense.notes ?? "");
    editForm.setPaidById(expense.paidById);
    editForm.setIsRecurring(expense.isRecurring);
    editForm.setDate(expense.date);
    setEditingId(expense.id);
    setIsAdding(false);
  };

  const cancelEdit = () => setEditingId(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.amount || !addForm.category || !addForm.description || !addForm.date || !addForm.paidById) return;
    try {
      await createExpense.mutateAsync({
        data: {
          amount: Number(addForm.amount),
          category: addForm.category,
          description: addForm.description,
          notes: addForm.notes || undefined,
          paidById: addForm.paidById || undefined,
          isRecurring: addForm.isRecurring,
          date: addForm.date,
        }
      });
      toast({ title: "Expense recorded" });
      resetAdd();
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to record expense." });
    }
  };

  const handleUpdate = async (e: React.FormEvent, id: number) => {
    e.preventDefault();
    if (!editForm.amount || !editForm.category || !editForm.description || !editForm.date || !editForm.paidById) return;
    try {
      await updateExpense.mutateAsync({
        id,
        data: {
          amount: Number(editForm.amount),
          category: editForm.category,
          description: editForm.description,
          notes: editForm.notes || undefined,
          paidById: editForm.paidById || undefined,
          isRecurring: editForm.isRecurring,
          date: editForm.date,
        }
      });
      toast({ title: "Expense updated" });
      setEditingId(null);
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update expense." });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this expense?")) return;
    try {
      await deleteExpense.mutateAsync({ id });
      toast({ title: "Expense deleted" });
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete expense." });
    }
  };

  const handleApplyRecurring = async () => {
    try {
      const result = await applyRecurring.mutateAsync({ data: { month, year } });
      toast({ title: `${result.copied} recurring expense${result.copied === 1 ? "" : "s"} applied` });
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not apply recurring expenses." });
    }
  };

  const expenseFormFields = (
    form: ReturnType<typeof useExpenseForm>,
    isPending: boolean,
    onSubmit: (e: React.FormEvent) => void,
    onCancel: () => void,
    title: string,
    submitLabel: string,
  ) => (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex items-center justify-between border-b border-border/50 pb-4">
        <h3 className="text-xl font-bold font-display text-foreground">{title}</h3>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">Amount (KES)</label>
          <Input type="number" placeholder="e.g. 5000" value={form.amount} onChange={e => form.setAmount(e.target.value)}
            required min="1" className="h-12 text-lg bg-card" />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">Category</label>
          <select className="flex h-12 w-full rounded-md border border-input bg-card px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={form.category} onChange={e => form.setCategory(e.target.value)} required>
            <option value="" disabled>Select category...</option>
            {categories?.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          {form.category && (() => {
            const cat = breakdown?.find(b => b.category === form.category);
            return cat ? (
              <p className="text-xs text-muted-foreground pt-1">
                Spent this month: <span className="font-semibold text-foreground">{formatKes(cat.spentAmount)}</span>
                <span className="mx-1">·</span>
                <span className={cat.spentAmount >= cat.budgetAmount ? "text-destructive font-semibold" : ""}>
                  {formatKes(Math.max(0, cat.budgetAmount - cat.spentAmount))} remaining of {formatKes(cat.budgetAmount)}
                </span>
              </p>
            ) : null;
          })()}
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-semibold text-foreground">Description</label>
          <Input placeholder="e.g. Nathan's Term 2 school fees" value={form.description}
            onChange={e => form.setDescription(e.target.value)} required className="h-12 bg-card" />
        </div>

        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-semibold text-foreground">Notes <span className="font-normal text-muted-foreground">(optional)</span></label>
          <Input placeholder="Any extra details..." value={form.notes ?? ""}
            onChange={e => form.setNotes(e.target.value)} className="h-12 bg-card" />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">Date</label>
          <Input type="date" value={form.date} onChange={e => form.setDate(e.target.value)} required className="h-12 bg-card" />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-foreground">
            Paid by <span className="text-destructive">*</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(members ?? []).map((m) => {
              const name = m.userName?.split(" ")[0] ?? "Member";
              return (
                <button
                  key={m.userId} type="button" onClick={() => form.setPaidById(m.userId)}
                  className={`h-12 rounded-xl border text-base font-semibold transition-colors ${form.paidById === m.userId ? "bg-primary text-primary-foreground border-primary" : "bg-card border-input text-foreground hover:bg-muted/40"}`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {!form.paidById && (
            <p className="text-xs text-muted-foreground">Choose who paid before saving.</p>
          )}
        </div>

        <div className="md:col-span-2 flex items-center gap-3 bg-card rounded-xl p-4 border border-border/50">
          <input type="checkbox" id={`isRecurring-${title}`} checked={form.isRecurring} onChange={e => form.setIsRecurring(e.target.checked)}
            className="w-5 h-5 accent-primary rounded" />
          <div>
            <label htmlFor={`isRecurring-${title}`} className="text-sm font-semibold text-foreground cursor-pointer flex items-center gap-2">
              <Repeat className="w-4 h-4 text-primary" /> Recurring expense
            </label>
            <p className="text-xs text-muted-foreground mt-0.5">Mark to get a reminder to apply it next month (rent, fees, salaries…)</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="h-12 px-6">Cancel</Button>
        <Button type="submit" disabled={isPending} className="h-12 px-8">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Expenses</h1>
          <p className="text-muted-foreground mt-1">Track where the money is going.</p>
        </div>
        <div className="flex items-center gap-1 bg-card rounded-xl p-1 border shadow-sm">
          <Button variant="ghost" size="icon" onClick={handlePrevMonth} className="h-10 w-10 rounded-lg hover:bg-muted">
            <ArrowLeft className="h-5 w-5 text-foreground/70" />
          </Button>
          <div className="flex items-center gap-1.5 px-1">
            <Calendar className="w-4 h-4 text-primary shrink-0" />
            <select
              value={`${year}-${String(month).padStart(2, '0')}`}
              onChange={e => {
                const [y, m] = e.target.value.split('-').map(Number);
                setYear(y);
                setMonth(m);
              }}
              className="font-semibold font-display text-sm text-foreground bg-transparent border-none outline-none cursor-pointer"
            >
              {Array.from({ length: 24 }, (_, i) => {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const m = d.getMonth() + 1;
                const y = d.getFullYear();
                return (
                  <option key={`${y}-${m}`} value={`${y}-${String(m).padStart(2, '0')}`}>
                    {formatMonthYear(m, y)}
                  </option>
                );
              })}
            </select>
          </div>
          <Button variant="ghost" size="icon" onClick={handleNextMonth} className="h-10 w-10 rounded-lg hover:bg-muted"
            disabled={month === now.getMonth() + 1 && year === now.getFullYear()}>
            <ArrowRight className="h-5 w-5 text-foreground/70" />
          </Button>
        </div>
      </div>

      {/* Budget Status */}
      {summary && (
        <Card className="border-none shadow-md overflow-hidden">
          <CardContent className="p-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Budget Status — {formatMonthYear(month, year)}</p>

            {/* Expenses vs Budget */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <TrendingDown className="w-4 h-4 text-destructive" /> Expenses
                </span>
                <span className="text-sm font-mono">
                  <span className={summary.totalSpent > summary.totalBudget ? "text-destructive font-bold" : "text-foreground"}>
                    {formatKes(summary.totalSpent)}
                  </span>
                  <span className="text-muted-foreground"> / {formatKes(summary.totalBudget)}</span>
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${summary.totalSpent > summary.totalBudget ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${Math.min(100, (summary.totalSpent / summary.totalBudget) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-right">
                {summary.totalSpent > summary.totalBudget
                  ? `Over budget by ${formatKes(summary.totalSpent - summary.totalBudget)}`
                  : `${formatKes(summary.remaining)} remaining`}
              </p>
            </div>

            {/* Income vs Target */}
            <div className="space-y-2 pt-1 border-t border-border/40">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <TrendingUp className="w-4 h-4 text-green-600" /> Income
              </span>
              {[
                { name: "Chege", contributed: summary.chegeContributed, target: summary.chegeTarget },
                { name: "Lydiah", contributed: summary.lydiahContributed, target: summary.lydiahTarget },
              ].map(({ name, contributed, target }) => (
                <div key={name} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-foreground">{name}</span>
                    <span className="font-mono">
                      <span className={contributed >= target ? "text-green-600 font-bold" : "text-foreground"}>{formatKes(contributed)}</span>
                      <span className="text-muted-foreground"> / {formatKes(target)}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${contributed >= target ? "bg-green-500" : "bg-amber-400"}`}
                      style={{ width: `${Math.min(100, target > 0 ? (contributed / target) * 100 : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Individual ledgers */}
            {members && members.length > 0 && expenses && (
              <div className="space-y-3 pt-1 border-t border-border/40">
                <span className="text-sm font-semibold text-foreground">Individual Ledgers</span>
                {[
                  { name: "Chege", contributed: summary.chegeContributed, target: summary.chegeTarget },
                  { name: "Lydiah", contributed: summary.lydiahContributed, target: summary.lydiahTarget },
                ].map(({ name, contributed, target }) => {
                  const myExpenses = expenses.filter(e => e.paidByName?.toLowerCase().startsWith(name.toLowerCase()));
                  const spent = myExpenses.reduce((s, e) => s + e.amount, 0);
                  const net = contributed - spent;
                  const overSpent = spent > contributed;
                  return (
                    <div key={name} className="rounded-xl border border-border/50 bg-muted/30 p-4 space-y-2">
                      <p className="text-sm font-semibold text-foreground">{name}</p>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Income</p>
                          <p className={`text-sm font-bold font-mono ${contributed >= target ? "text-green-600" : "text-amber-500"}`}>
                            {formatKes(contributed)}
                          </p>
                          <p className="text-xs text-muted-foreground">of {formatKes(target)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Spent</p>
                          <p className="text-sm font-bold font-mono text-foreground">{formatKes(spent)}</p>
                          <p className="text-xs text-muted-foreground">{myExpenses.length} items</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Net</p>
                          <p className={`text-sm font-bold font-mono ${overSpent ? "text-destructive" : "text-green-600"}`}>
                            {overSpent ? "-" : "+"}{formatKes(Math.abs(net))}
                          </p>
                          <p className="text-xs text-muted-foreground">{overSpent ? "deficit" : "surplus"}</p>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${overSpent ? "bg-destructive" : "bg-primary"}`}
                          style={{ width: `${Math.min(100, contributed > 0 ? (spent / contributed) * 100 : 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                {/* Joint / unattributed expenses */}
                {(() => {
                  const jointExpenses = expenses.filter(e =>
                    !e.paidByName ||
                    (!e.paidByName.toLowerCase().startsWith("chege") && !e.paidByName.toLowerCase().startsWith("lydiah"))
                  );
                  if (jointExpenses.length === 0) return null;
                  const jointTotal = jointExpenses.reduce((s, e) => s + e.amount, 0);
                  return (
                    <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-foreground">Joint / Unattributed</p>
                        <p className="text-sm font-bold font-mono text-foreground">{formatKes(jointTotal)}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">{jointExpenses.length} item{jointExpenses.length !== 1 ? "s" : ""} recorded without a payer</p>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Category budget vs actual */}
            {breakdown && breakdown.length > 0 && (
              <div className="space-y-2 pt-1 border-t border-border/40">
                <span className="text-sm font-semibold text-foreground">By Category</span>
                <div className="space-y-2">
                  {breakdown.map((cat) => {
                    const over = cat.remaining < 0;
                    const pct = Math.min(100, cat.percentUsed);
                    return (
                      <div key={cat.category} className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className={`font-medium ${over ? "text-destructive" : "text-foreground"}`}>{cat.category}</span>
                          <span className="font-mono text-muted-foreground">
                            <span className={over ? "text-destructive font-bold" : "text-foreground"}>{formatKes(cat.spentAmount)}</span>
                            {" / "}{formatKes(cat.budgetAmount)}
                            <span className={`ml-1.5 ${over ? "text-destructive" : "text-muted-foreground"}`}>
                              ({over ? `+${cat.percentUsed - 100}%` : `${cat.percentUsed}%`})
                            </span>
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${over ? "bg-destructive" : pct >= 80 ? "bg-amber-400" : "bg-primary"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Category hint when form is open */}
            {(isAdding || editingId !== null) && addForm.category && breakdown && (() => {
              const cat = breakdown.find(b => b.category === addForm.category);
              if (!cat) return null;
              const over = cat.remaining < 0;
              return (
                <div className={`rounded-xl px-4 py-3 text-sm border ${over ? "bg-destructive/10 border-destructive/20" : "bg-primary/10 border-primary/20"}`}>
                  <span className="font-semibold">{cat.category}:</span>{" "}
                  {over
                    ? <span className="text-destructive">over budget by {formatKes(Math.abs(cat.remaining))}</span>
                    : <span>{formatKes(cat.remaining)} remaining of {formatKes(cat.budgetAmount)}</span>}
                  {" "}({cat.percentUsed}% used)
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Priority Tier Breakdown */}
      {breakdown && breakdown.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-display font-bold text-foreground">Priority Tiers</h2>
            <p className="text-sm text-muted-foreground mt-0.5">How spending stacks up against priority — essentials first.</p>
          </div>
          {EXPENSE_TIERS.map(({ tier, label, bar, badge, categories }) => {
            const tierCats = breakdown.filter(b => categories.some(c => b.category.toLowerCase() === c.toLowerCase()));
            const budget = tierCats.reduce((s, c) => s + c.budgetAmount, 0);
            const spent = tierCats.reduce((s, c) => s + c.spentAmount, 0);
            const remaining = budget - spent;
            const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
            const over = remaining < 0;
            return (
              <Card key={tier} className="border-none shadow-sm overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badge}`}>T{tier}</span>
                      <span className="font-semibold text-foreground text-sm">{label}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-sm font-mono font-bold ${over ? "text-destructive" : "text-foreground"}`}>
                        {formatKes(spent)}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono"> / {formatKes(budget)}</span>
                    </div>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div className={`h-full ${bar} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{Math.round(pct)}% used · {categories.join(", ")}</span>
                    <span className={over ? "text-destructive font-semibold" : ""}>
                      {over ? `Over by ${formatKes(Math.abs(remaining))}` : `${formatKes(remaining)} left`}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Recurring banner */}
      {showRecurringBanner && (
        <div className="bg-primary/10 border border-primary/20 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Repeat className="w-5 h-5 text-primary shrink-0" />
            <p className="text-sm font-medium text-foreground">
              {recurringFromPrev.length} recurring expense{recurringFromPrev.length > 1 ? "s" : ""} from last month not yet added this month.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={handleApplyRecurring} disabled={applyRecurring.isPending} className="shrink-0">
            {applyRecurring.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
            Apply
          </Button>
        </div>
      )}

      {/* Add expense form */}
      {isAdding ? (
        <Card className="border-none shadow-md bg-accent/20">
          <CardContent className="p-6">
            {expenseFormFields(addForm, createExpense.isPending, handleCreate, resetAdd, "Record New Expense", "Save Expense")}
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => { setIsAdding(true); setEditingId(null); }} className="h-12 px-6 rounded-xl shadow-sm">
          <Plus className="w-5 h-5 mr-2" /> Record Expense
        </Button>
      )}

      {/* Expense list */}
      {isLoading ? (
        <div className="flex justify-center p-20"><Loader2 className="w-10 h-10 text-primary animate-spin" /></div>
      ) : !expenses || expenses.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Calendar className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No expenses for {formatMonthYear(month, year)}</p>
          <p className="text-sm mt-1">Click "Record Expense" to add the first one.</p>
        </div>
      ) : (
        <Card className="border-none shadow-md overflow-hidden">
          <div className="divide-y divide-border/50">
            {expenses.map((expense) => (
              <div key={expense.id}>
                {editingId === expense.id ? (
                  <div className="p-5 bg-accent/20">
                    {expenseFormFields(
                      editForm,
                      updateExpense.isPending,
                      (e) => handleUpdate(e, expense.id),
                      cancelEdit,
                      "Edit Expense",
                      "Save Changes",
                    )}
                  </div>
                ) : (
                  <div className="p-4 sm:p-5 flex items-start justify-between hover:bg-muted/20 transition-colors gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-accent/60 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-primary">{expense.category.slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-foreground">{expense.description}</p>
                          {expense.isRecurring && (
                            <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                              <Repeat className="w-3 h-3" /> Recurring
                            </span>
                          )}
                        </div>
                        {expense.notes && (
                          <p className="text-sm text-muted-foreground mt-0.5 italic">"{expense.notes}"</p>
                        )}
                        <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 bg-muted rounded text-xs font-medium">{expense.category}</span>
                          <span className="w-1 h-1 rounded-full bg-border" />
                          <span>{expense.paidByName}</span>
                          <span className="w-1 h-1 rounded-full bg-border" />
                          <span>{formatDate(expense.date)}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <p className="font-display font-bold text-lg text-foreground mr-2">{formatKes(expense.amount)}</p>
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-muted"
                        onClick={() => startEdit(expense as Expense)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10 h-9 w-9"
                        onClick={() => handleDelete(expense.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="px-5 py-3 bg-muted/30 border-t border-border/50 flex justify-between items-center">
            <span className="text-sm text-muted-foreground">{expenses.length} expense{expenses.length !== 1 ? "s" : ""}</span>
            <span className="font-display font-bold text-primary">{formatKes(expenses.reduce((s, e) => s + e.amount, 0))}</span>
          </div>
        </Card>
      )}
    </div>
  );
}
