import { useState, useEffect } from "react";
import {
  useGetSavingsGoals,
  useCreateSavingsGoal,
  useUpdateSavingsGoal,
  useDeleteSavingsGoal,
  useContributeToSavingsGoal,
  useCascadeContribute,
  getGetSavingsGoalsQueryKey,
  useGetSavingsGoalContributions,
} from "@workspace/api-client-react";
import type { SavingsGoal, CascadeContributeAllocation } from "@workspace/api-client-react";

interface SavingsGoalContribution {
  id: number;
  goalId: number;
  amount: number;
  note?: string | null;
  createdByUserId: string;
  contributorName: string;
  createdAt: string;
}
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatKes } from "@/lib/utils";
import {
  getChipRange,
  filterByDateRange,
  computeContributorTotals,
} from "@/lib/goal-history-utils";
import type { QuickChip as GoalQuickChip } from "@/lib/goal-history-utils";
import {
  Plus,
  Loader2,
  Target,
  CheckCircle2,
  Pencil,
  Trash2,
  Calendar,
  Trophy,
  ArrowUp,
  ArrowDown,
  Sparkles,
  ChevronRight,
  History,
  User,
  SlidersHorizontal,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

function GoalProgress({ current, target }: { current: number; target: number }) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="font-semibold text-foreground">{formatKes(current)}</span>
        <span className="text-muted-foreground">of {formatKes(target)}</span>
      </div>
      <div className="h-3 w-full bg-secondary/20 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${pct >= 100 ? "bg-emerald-500" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground text-right">{Math.round(pct)}% reached</p>
    </div>
  );
}

type QuickChip = GoalQuickChip;

const QUICK_CHIPS: { id: QuickChip; label: string }[] = [
  { id: "this-month", label: "This Month" },
  { id: "last-month", label: "Last Month" },
  { id: "last-3-months", label: "Last 3 Months" },
  { id: "this-year", label: "This Year" },
];

interface GoalFilterState {
  fromDate: string;
  toDate: string;
  activeChip: QuickChip | null;
}

const DEFAULT_FILTER: GoalFilterState = { fromDate: "", toDate: "", activeChip: null };

const FILTERS_STORAGE_KEY = "goal-history-filters";

function loadFiltersFromStorage(): Record<number, GoalFilterState> {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<number, GoalFilterState>;
  } catch {
    return {};
  }
}

function saveFiltersToStorage(filters: Record<number, GoalFilterState>) {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // localStorage unavailable — silently skip
  }
}

function GoalContributionHistory({
  goalId,
  filter,
  onFilterChange,
}: {
  goalId: number;
  filter: GoalFilterState;
  onFilterChange: (f: GoalFilterState) => void;
}) {
  const { data: contributions, isLoading } = useGetSavingsGoalContributions(goalId);
  const { fromDate, toDate, activeChip } = filter;
  const [contributorFilter, setContributorFilter] = useState<string | null>(null);

  function applyChip(chip: QuickChip) {
    if (activeChip === chip) {
      // toggle off
      onFilterChange({ fromDate: "", toDate: "", activeChip: null });
    } else {
      const range = getChipRange(chip);
      onFilterChange({ fromDate: range.from, toDate: range.to, activeChip: chip });
    }
  }

  function handleFromDateChange(value: string) {
    onFilterChange({ ...filter, fromDate: value, activeChip: null });
  }

  function handleToDateChange(value: string) {
    onFilterChange({ ...filter, toDate: value, activeChip: null });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contributions || contributions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-3">No contributions yet.</p>
    );
  }

  const dateFiltered = filterByDateRange(contributions as SavingsGoalContribution[], fromDate, toDate);

  // Per-contributor totals (excluding manual adjustments) within the date-filtered window
  const contributorTotals = computeContributorTotals(dateFiltered as SavingsGoalContribution[]);
  const hasMultipleContributors = contributorTotals.length > 1;

  const filtered = contributorFilter
    ? dateFiltered.filter((c: SavingsGoalContribution) => c.contributorName === contributorFilter)
    : dateFiltered;

  const hasFilter = fromDate || toDate;

  return (
    <div className="space-y-3">
      {/* Quick-filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip.id}
            onClick={() => applyChip(chip.id)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              activeChip === chip.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted hover:text-foreground"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Date range filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => handleFromDateChange(e.target.value)}
            className="h-7 text-xs bg-muted/40 border-border/50 px-2"
            aria-label="From date"
          />
          <span className="text-xs text-muted-foreground shrink-0">–</span>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => handleToDateChange(e.target.value)}
            className="h-7 text-xs bg-muted/40 border-border/50 px-2"
            aria-label="To date"
          />
        </div>
        {hasFilter && (
          <button
            onClick={() => onFilterChange(DEFAULT_FILTER)}
            className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
          >
            Clear
          </button>
        )}
      </div>

      {/* Per-contributor summary (only when >1 contributor) */}
      {hasMultipleContributors && (
        <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 flex flex-wrap gap-2">
          {contributorTotals.map(({ name, total }) => {
            const isActive = contributorFilter === name;
            return (
              <button
                key={name}
                onClick={() => setContributorFilter(isActive ? null : name)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : contributorFilter
                    ? "bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted hover:text-foreground hover:border-border"
                    : "bg-background text-foreground border-border/60 hover:bg-muted hover:border-border"
                }`}
              >
                <User className="w-3 h-3 shrink-0" />
                <span>{name}</span>
                <span className={isActive ? "text-primary-foreground/80" : "text-muted-foreground"}>
                  {formatKes(total)}
                </span>
              </button>
            );
          })}
          {contributorFilter && (
            <button
              onClick={() => setContributorFilter(null)}
              className="text-xs text-muted-foreground hover:text-foreground underline self-center"
            >
              Show all
            </button>
          )}
        </div>
      )}

      {/* Summary bar when filtered */}
      {hasFilter && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {filtered.length === 0 ? (
            "No contributions in this range."
          ) : (() => {
            const realContribs = filtered.filter((c: SavingsGoalContribution) => c.note == null);
            const total = realContribs.reduce((sum: number, c: SavingsGoalContribution) => sum + c.amount, 0);
            const corrections = filtered.length - realContribs.length;
            return (
              <span>
                <span className="font-medium text-foreground">{realContribs.length}</span>
                {" "}contribution{realContribs.length !== 1 ? "s" : ""}
                {corrections > 0 && (
                  <span className="text-muted-foreground/60"> +{corrections} correction{corrections !== 1 ? "s" : ""}</span>
                )}
                {" · "}
                <span className="font-medium text-foreground">{formatKes(total)}</span>
                {" "}total
              </span>
            );
          })()}
        </div>
      )}

      {filtered.length === 0 && (hasFilter || contributorFilter) ? null : (
        <div className="space-y-2">
          {filtered.map((c: SavingsGoalContribution) => {
            const isAdjustment = c.note != null;
            const isManualSentinel = c.note === "Manual adjustment";
            const customReason = isAdjustment && !isManualSentinel ? c.note : null;
            const isNegative = c.amount < 0;
            const formattedAmount = isNegative
              ? `−${formatKes(Math.abs(c.amount))}`
              : formatKes(c.amount);
            return (
              <div
                key={c.id}
                className={`flex items-center gap-3 text-sm py-1.5 border-b border-border/40 last:border-0 ${isAdjustment ? "opacity-75" : ""}`}
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {isAdjustment ? (
                    <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className={`font-medium truncate ${isAdjustment ? "text-muted-foreground" : "text-foreground"}`}>
                    {isAdjustment ? "Balance correction" : c.contributorName}
                  </span>
                  {isAdjustment && (
                    <span className="ml-1 text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5 shrink-0 max-w-[160px] truncate" title={customReason ?? "Manual adjustment"}>
                      {customReason ?? "Manual"}
                    </span>
                  )}
                </div>
                <span
                  className={`font-semibold shrink-0 ${isAdjustment ? (isNegative ? "text-destructive" : "text-muted-foreground") : "text-primary"}`}
                >
                  {formattedAmount}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(c.createdAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type GoalFormMode = "none" | "create" | { type: "edit"; goal: SavingsGoal };

interface InconsistentGoal {
  id: number;
  name: string;
  currentAmount: number;
  contributionTotal: number;
  discrepancy: number;
}

export default function SavingsGoals() {
  const { data: goals, isLoading } = useGetSavingsGoals();
  const createGoal = useCreateSavingsGoal();
  const updateGoal = useUpdateSavingsGoal();
  const contributeToGoal = useContributeToSavingsGoal();
  const cascadeContribute = useCascadeContribute();
  const deleteGoal = useDeleteSavingsGoal();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: consistencyData } = useQuery<{ ok: boolean; inconsistentGoals: InconsistentGoal[] }>({
    queryKey: ["savings-goals-consistency"],
    queryFn: () => fetch("/api/savings-goals/consistency-check").then((r) => r.json()),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const inconsistentGoals = consistencyData?.inconsistentGoals ?? [];

  const [mode, setMode] = useState<GoalFormMode>("none");
  const [expandedHistoryId, setExpandedHistoryId] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem("goal-history-expanded");
      if (raw !== null) return Number(raw);
    } catch {}
    return null;
  });
  const [goalFilters, setGoalFilters] = useState<Record<number, GoalFilterState>>(loadFiltersFromStorage);

  useEffect(() => {
    try {
      if (expandedHistoryId === null) localStorage.removeItem("goal-history-expanded");
      else localStorage.setItem("goal-history-expanded", String(expandedHistoryId));
    } catch {}
  }, [expandedHistoryId]);

  function getGoalFilter(goalId: number): GoalFilterState {
    return goalFilters[goalId] ?? DEFAULT_FILTER;
  }

  function setGoalFilter(goalId: number, f: GoalFilterState) {
    setGoalFilters((prev) => {
      const next = { ...prev, [goalId]: f };
      // Clear the entry when the filter is reset to defaults so storage stays tidy
      if (!f.fromDate && !f.toDate && !f.activeChip) {
        const { [goalId]: _removed, ...rest } = next;
        saveFiltersToStorage(rest);
        return rest;
      }
      saveFiltersToStorage(next);
      return next;
    });
  }

  // Form state
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [currentAmount, setCurrentAmount] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [contributeId, setContributeId] = useState<number | null>(null);
  const [contributeAmount, setContributeAmount] = useState("");

  // Cascade payment state
  const [showCascade, setShowCascade] = useState(false);
  const [cascadeAmount, setCascadeAmount] = useState("");
  const [cascadeOrder, setCascadeOrder] = useState<number[]>([]);
  const [cascadeResult, setCascadeResult] = useState<CascadeContributeAllocation[] | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getGetSavingsGoalsQueryKey() });

  const activeGoals = goals?.filter((g) => !g.isCompleted) ?? [];
  const completedGoals = goals?.filter((g) => g.isCompleted) ?? [];
  const isPending = createGoal.isPending || updateGoal.isPending;

  // Ordered active goals for cascade UI
  const orderedGoals =
    cascadeOrder.length > 0
      ? cascadeOrder
          .map((id) => activeGoals.find((g) => g.id === id))
          .filter(Boolean) as SavingsGoal[]
      : activeGoals;

  const openCascade = () => {
    setCascadeOrder(activeGoals.map((g) => g.id));
    setCascadeAmount("");
    setCascadeResult(null);
    setShowCascade(true);
  };

  const moveGoal = (index: number, direction: -1 | 1) => {
    const order = [...(cascadeOrder.length > 0 ? cascadeOrder : activeGoals.map((g) => g.id))];
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setCascadeOrder(order);
  };

  const handleCascade = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(cascadeAmount);
    if (!amount || amount <= 0) return;

    try {
      const result = await cascadeContribute.mutateAsync({
        data: {
          amount,
          goalIds: cascadeOrder.length > 0 ? cascadeOrder : undefined,
        },
      });
      setCascadeResult(result.allocations);
      invalidate();

      const distributed = result.allocations.reduce((s, a) => s + a.allocated, 0);
      const completed = result.allocations.filter((a) => a.completed).length;
      toast({
        title: `${formatKes(distributed)} distributed`,
        description:
          completed > 0
            ? `${completed} goal${completed > 1 ? "s" : ""} completed! 🎉`
            : `Spread across ${result.allocations.length} goal${result.allocations.length !== 1 ? "s" : ""}.`,
      });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to distribute payment." });
    }
  };

  const resetForm = () => {
    setName("");
    setTargetAmount("");
    setDeadline("");
    setCurrentAmount("");
    setCorrectionReason("");
    setMode("none");
  };

  const openCreate = () => {
    setName("");
    setTargetAmount("");
    setDeadline("");
    setCurrentAmount("");
    setCorrectionReason("");
    setMode("create");
  };

  const openEdit = (goal: SavingsGoal) => {
    setName(goal.name);
    setTargetAmount(String(goal.targetAmount));
    setDeadline(goal.deadline ?? "");
    setCurrentAmount(String(goal.currentAmount));
    setCorrectionReason("");
    setMode({ type: "edit", goal });
  };

  // Derived: big-drop warning (only in edit mode when currentAmount changed)
  const editingGoal = typeof mode === "object" && mode.type === "edit" ? mode.goal : null;
  const parsedCurrentAmount = currentAmount !== "" ? Number(currentAmount) : NaN;
  const isBigDrop =
    editingGoal !== null &&
    !isNaN(parsedCurrentAmount) &&
    editingGoal.currentAmount > 0 &&
    parsedCurrentAmount < editingGoal.currentAmount &&
    editingGoal.currentAmount - parsedCurrentAmount > editingGoal.currentAmount * 0.5;
  const dropAmount = editingGoal ? editingGoal.currentAmount - parsedCurrentAmount : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !targetAmount) return;
    try {
      if (mode === "create") {
        await createGoal.mutateAsync({ data: { name, targetAmount: Number(targetAmount), deadline: deadline || undefined } });
        toast({ title: "Goal created", description: `"${name}" has been added.` });
      } else if (typeof mode === "object" && mode.type === "edit") {
        const amountChanged = parsedCurrentAmount !== mode.goal.currentAmount && !isNaN(parsedCurrentAmount);
        await updateGoal.mutateAsync({
          id: mode.goal.id,
          data: {
            name,
            targetAmount: Number(targetAmount),
            deadline: deadline || null,
            ...(amountChanged ? { currentAmount: parsedCurrentAmount } : {}),
            ...(amountChanged && correctionReason.trim() ? { reason: correctionReason.trim() } : {}),
          },
        });
        toast({ title: "Goal updated" });
      }
      invalidate();
      resetForm();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : undefined;
      toast({ variant: "destructive", title: "Error", description: msg ?? "Something went wrong." });
    }
  };

  const handleContribute = async (e: React.FormEvent, goal: SavingsGoal) => {
    e.preventDefault();
    const amount = Number(contributeAmount);
    if (!amount || amount <= 0) return;
    try {
      await contributeToGoal.mutateAsync({ id: goal.id, data: { amount } });
      toast({ title: "Contribution added", description: `${formatKes(amount)} added to "${goal.name}".` });
      invalidate();
      setContributeId(null);
      setContributeAmount("");
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to add contribution." });
    }
  };

  const handleMarkComplete = async (goal: SavingsGoal) => {
    try {
      await updateGoal.mutateAsync({ id: goal.id, data: { isCompleted: !goal.isCompleted } });
      toast({ title: goal.isCompleted ? "Goal reopened" : "Goal completed! 🎉" });
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to update goal." });
    }
  };

  const handleDelete = async (goal: SavingsGoal) => {
    if (!confirm(`Delete goal "${goal.name}"? This cannot be undone.`)) return;
    try {
      await deleteGoal.mutateAsync({ id: goal.id });
      toast({ title: "Goal deleted" });
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete goal." });
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Savings Goals</h1>
          <p className="text-muted-foreground mt-1">
            Track shared targets — holidays, emergency funds, and more.
          </p>
        </div>
        {mode === "none" && (
          <div className="flex gap-2 flex-wrap">
            {activeGoals.length > 1 && !showCascade && (
              <Button
                variant="outline"
                onClick={openCascade}
                className="rounded-xl h-12 px-6 border-primary/30 text-primary hover:bg-primary/5"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Distribute Payment
              </Button>
            )}
            <Button
              onClick={openCreate}
              className="rounded-xl h-12 px-6 shadow-md hover:-translate-y-0.5 transition-transform"
            >
              <Plus className="w-5 h-5 mr-2" />
              New Goal
            </Button>
          </div>
        )}
      </div>

      {/* Cascade Payment Panel */}
      {showCascade && activeGoals.length > 0 && (
        <Card className="border-primary/20 shadow-md bg-primary/5">
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold font-display text-foreground flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  Distribute Payment
                </h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Enter the total amount — it fills goals in order, top to bottom.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setShowCascade(false); setCascadeResult(null); }}>
                Cancel
              </Button>
            </div>

            {/* Goal order */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Priority order — drag or use arrows
              </p>
              {orderedGoals.map((goal, i) => {
                const remaining = goal.targetAmount - goal.currentAmount;
                return (
                  <div
                    key={goal.id}
                    className="flex items-center gap-3 bg-card rounded-xl px-4 py-3 border border-border/50"
                  >
                    <span className="text-sm font-bold text-muted-foreground w-5 text-center">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{goal.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatKes(remaining)} still needed
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => moveGoal(i, -1)}
                        disabled={i === 0}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => moveGoal(i, 1)}
                        disabled={i === orderedGoals.length - 1}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Amount + submit */}
            <form onSubmit={handleCascade} className="flex gap-3 items-center">
              <Input
                type="number"
                placeholder="Total payment amount (KES)"
                value={cascadeAmount}
                onChange={(e) => { setCascadeAmount(e.target.value); setCascadeResult(null); }}
                min="1"
                required
                className="h-12 bg-card text-lg flex-1"
              />
              <Button type="submit" size="lg" className="h-12 px-6 rounded-xl shrink-0" disabled={cascadeContribute.isPending}>
                {cascadeContribute.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Distribute"}
              </Button>
            </form>

            {/* Result breakdown */}
            {cascadeResult && cascadeResult.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How it was split</p>
                {cascadeResult.map((a) => (
                  <div key={a.goalId} className="flex items-center gap-3 text-sm">
                    <ChevronRight className="w-4 h-4 text-primary shrink-0" />
                    <span className="flex-1 text-foreground font-medium truncate">{a.goalName}</span>
                    <span className="font-bold text-primary">{formatKes(a.allocated)}</span>
                    {a.completed && (
                      <span className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-full font-semibold">
                        Complete!
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create / Edit Form */}
      {mode !== "none" && (
        <Card className="border-none shadow-md bg-accent/20">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="flex items-center justify-between border-b border-border/50 pb-4">
                <h3 className="text-xl font-bold font-display text-foreground">
                  {mode === "create" ? "New Savings Goal" : "Edit Goal"}
                </h3>
                <Button type="button" variant="ghost" onClick={resetForm}>Cancel</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2 md:col-span-1">
                  <label className="text-sm font-semibold text-foreground">Goal Name</label>
                  <Input
                    placeholder="e.g. Holiday to Mombasa"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="h-12 bg-card"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">Target Amount (KES)</label>
                  <Input
                    type="number"
                    placeholder="e.g. 150000"
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    required
                    min="1"
                    className="h-12 bg-card text-lg"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">
                    Deadline <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="h-12 bg-card"
                  />
                </div>
              </div>

              {/* Current balance correction — edit mode only */}
              {mode !== "create" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">
                      Current Balance (KES){" "}
                      <span className="font-normal text-muted-foreground">(optional correction)</span>
                    </label>
                    <Input
                      type="number"
                      min="0"
                      value={currentAmount}
                      onChange={(e) => { setCurrentAmount(e.target.value); setCorrectionReason(""); }}
                      className="h-12 bg-card text-lg"
                    />
                  </div>

                  {isBigDrop && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-4 space-y-3">
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                        ⚠ This will remove {formatKes(dropAmount)} from this goal
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        That's more than 50% of the current balance. Please explain why so this correction is easy to trace later.
                      </p>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                          Reason <span className="text-red-500">*</span>
                        </label>
                        <Input
                          placeholder="e.g. Withdrew funds to cover medical bill"
                          value={correctionReason}
                          onChange={(e) => setCorrectionReason(e.target.value)}
                          className="h-10 bg-card text-sm"
                          required
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <Button
                  type="submit"
                  size="lg"
                  className="rounded-xl h-12 px-8"
                  disabled={isPending || (isBigDrop && !correctionReason.trim())}
                >
                  {isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Plus className="w-5 h-5 mr-2" />}
                  {mode === "create" ? "Create Goal" : "Save Changes"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-48 bg-muted rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {activeGoals.length === 0 && mode === "none" && (
            <Card className="border-none shadow-md">
              <CardContent className="p-12 text-center text-muted-foreground">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <Target className="w-8 h-8 text-muted-foreground/50" />
                </div>
                <p className="text-lg font-medium text-foreground">No goals yet</p>
                <p className="text-sm mt-1">Create your first savings goal to start tracking.</p>
                <Button onClick={openCreate} className="mt-6 rounded-xl">
                  <Plus className="w-4 h-4 mr-2" /> New Goal
                </Button>
              </CardContent>
            </Card>
          )}

          {inconsistentGoals.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-2 text-amber-600 font-semibold text-sm">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Balance mismatch detected on {inconsistentGoals.length} goal{inconsistentGoals.length !== 1 ? "s" : ""}
              </div>
              {inconsistentGoals.map((g) => (
                <div key={g.id} className="text-xs text-amber-700/80 pl-6">
                  <span className="font-medium">{g.name}</span>
                  {" — "}recorded {formatKes(g.currentAmount)}, contributions sum to {formatKes(g.contributionTotal)}
                  {" (off by "}{formatKes(Math.abs(g.discrepancy))}{")"}
                </div>
              ))}
              <p className="text-xs text-amber-600/70 pl-6 pt-0.5">Use the balance-correction form on each goal to reconcile.</p>
            </div>
          )}

          {activeGoals.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {activeGoals.map((goal) => (
                <Card key={goal.id} className="border-none shadow-md overflow-hidden">
                  <CardHeader className="bg-muted/30 border-b border-border/50 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Target className="w-5 h-5 text-primary shrink-0" />
                        <CardTitle className="text-lg leading-tight">{goal.name}</CardTitle>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEdit(goal)} title="Edit goal">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-emerald-600" onClick={() => handleMarkComplete(goal)} title="Mark complete">
                          <CheckCircle2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(goal)} title="Delete goal">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    {goal.deadline && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>
                          Target by{" "}
                          {new Date(goal.deadline).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}
                        </span>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="p-6 space-y-5">
                    <GoalProgress current={goal.currentAmount} target={goal.targetAmount} />

                    {goal.targetAmount > 0 && goal.currentAmount >= goal.targetAmount && (
                      <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="text-sm font-medium text-emerald-600">Goal reached! Mark it complete when ready.</span>
                      </div>
                    )}

                    {goal.targetAmount > 0 && goal.currentAmount >= goal.targetAmount ? null : contributeId === goal.id ? (
                      <form onSubmit={(e) => handleContribute(e, goal)} className="flex gap-3 items-center">
                        <Input
                          type="number"
                          placeholder="Amount to add (KES)"
                          value={contributeAmount}
                          onChange={(e) => setContributeAmount(e.target.value)}
                          min="1"
                          required
                          className="h-10 bg-muted/40"
                          autoFocus
                        />
                        <Button type="submit" size="sm" className="h-10 rounded-lg shrink-0" disabled={contributeToGoal.isPending}>
                          {contributeToGoal.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-10 rounded-lg" onClick={() => { setContributeId(null); setContributeAmount(""); }}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full h-10 rounded-xl font-semibold border-primary/20 text-primary hover:bg-primary/5"
                        onClick={() => { setContributeId(goal.id); setContributeAmount(""); }}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Contribution
                      </Button>
                    )}

                    {/* Contribution history toggle */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-8 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setExpandedHistoryId(expandedHistoryId === goal.id ? null : goal.id)}
                    >
                      <History className="w-3.5 h-3.5 mr-1.5" />
                      {expandedHistoryId === goal.id ? "Hide history" : "Show history"}
                    </Button>

                    {expandedHistoryId === goal.id && (
                      <div className="border-t border-border/40 pt-3">
                        <GoalContributionHistory
                          goalId={goal.id}
                          filter={getGoalFilter(goal.id)}
                          onFilterChange={(f) => setGoalFilter(goal.id, f)}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {completedGoals.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-500" />
                Completed Goals
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {completedGoals.map((goal) => (
                  <Card key={goal.id} className="border-none shadow-sm opacity-70 bg-muted/30">
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                          <p className="font-semibold text-foreground">{goal.name}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => handleMarkComplete(goal)} title="Reopen goal">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(goal)} title="Delete goal">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>Saved</span>
                        <span className="font-semibold text-emerald-600">
                          {formatKes(goal.currentAmount)} / {formatKes(goal.targetAmount)}
                        </span>
                      </div>

                      {/* Contribution history toggle */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full h-8 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setExpandedHistoryId(expandedHistoryId === goal.id ? null : goal.id)}
                      >
                        <History className="w-3.5 h-3.5 mr-1.5" />
                        {expandedHistoryId === goal.id ? "Hide history" : "Show history"}
                      </Button>

                      {expandedHistoryId === goal.id && (
                        <div className="border-t border-border/40 pt-3">
                          <GoalContributionHistory
                            goalId={goal.id}
                            filter={getGoalFilter(goal.id)}
                            onFilterChange={(f) => setGoalFilter(goal.id, f)}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
