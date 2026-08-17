import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useGetContributions, useCreateContribution, useGetDashboardSummary,
  getGetContributionsQueryKey, getGetDashboardSummaryQueryKey, getGetDashboardActivityQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatKes, formatDate, formatMonthYear } from "@/lib/utils";
import { Loader2, ArrowLeft, ArrowRight, PiggyBank, Calendar, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const CHEGE_ID = "63497598";
const LYDIAH_ID = "63570605";

const INCOME_SOURCES: Record<string, { label: string; amount: number }[]> = {
  [CHEGE_ID]: [
    { label: "Ujenzi Salary", amount: 76140 },
    { label: "Rental Income", amount: 150000 },
    { label: "Optimum", amount: 40954 },
  ],
  [LYDIAH_ID]: [
    { label: "EISH", amount: 50000 },
  ],
};

const MEMBER_NAMES: Record<string, string> = {
  [CHEGE_ID]: "Chege",
  [LYDIAH_ID]: "Lydiah",
};

const CONTRIBUTIONS_MONTH_KEY = "contributions-month-pref";

export default function Contributions() {
  const now = new Date();
  const [, navigate] = useLocation();
  const [month, setMonth] = useState(() => {
    try {
      const raw = localStorage.getItem(CONTRIBUTIONS_MONTH_KEY);
      if (raw) { const p = JSON.parse(raw); if (typeof p?.month === "number") return p.month; }
    } catch {}
    return now.getMonth() + 1;
  });
  const [year, setYear] = useState(() => {
    try {
      const raw = localStorage.getItem(CONTRIBUTIONS_MONTH_KEY);
      if (raw) { const p = JSON.parse(raw); if (typeof p?.year === "number") return p.year; }
    } catch {}
    return now.getFullYear();
  });

  useEffect(() => {
    try { localStorage.setItem(CONTRIBUTIONS_MONTH_KEY, JSON.stringify({ month, year })); } catch {}
  }, [month, year]);

  // Deposit form state
  const [showForm, setShowForm] = useState(false);
  const [forUserId, setForUserId] = useState(CHEGE_ID);
  const [selectedSource, setSelectedSource] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customNote, setCustomNote] = useState("");

  const { data: contributions, isLoading } = useGetContributions({ month, year });
  const { data: summary } = useGetDashboardSummary({ month, year });
  const createContribution = useCreateContribution();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetContributionsQueryKey({ month, year }) });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey({ month, year }) });
    queryClient.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
  };

  const handlePrevMonth = () => {
    if (month === 1) { setMonth(12); setYear(year - 1); } else setMonth(month - 1);
  };
  const handleNextMonth = () => {
    if (month === 12) { setMonth(1); setYear(year + 1); } else setMonth(month + 1);
  };

  const sources = INCOME_SOURCES[forUserId] ?? [];
  const isOther = selectedSource === "other";
  const selectedSourceObj = sources.find(s => s.label === selectedSource);
  const finalAmount = isOther ? Number(customAmount) : (selectedSourceObj?.amount ?? 0);

  const resetForm = () => {
    setShowForm(false);
    setSelectedSource("");
    setCustomAmount("");
    setCustomNote("");
  };

  const handlePersonChange = (id: string) => {
    setForUserId(id);
    setSelectedSource(""); // reset source when person changes
    setCustomAmount("");
    setCustomNote("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSource || finalAmount <= 0) return;
    try {
      await createContribution.mutateAsync({
        data: {
          amount: finalAmount,
          month,
          year,
          note: isOther ? (customNote || "Other") : selectedSource,
          forUserId,
        },
      });
      const who = MEMBER_NAMES[forUserId] ?? "Member";
      toast({ title: "Deposit recorded", description: `${who} · ${formatKes(finalAmount)}` });
      resetForm();
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to record deposit." });
    }
  };

  return (
    <div className="space-y-6 pb-16 w-full">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Contributions</h1>
          <p className="text-base text-muted-foreground mt-0.5">Track income towards the joint budget.</p>
        </div>
        {/* Month picker */}
        <div className="flex items-center gap-1 bg-card rounded-xl p-1 border shadow-sm self-start">
          <Button variant="ghost" size="icon" onClick={handlePrevMonth} className="h-10 w-10 rounded-lg hover:bg-muted">
            <ArrowLeft className="h-4 w-4 text-foreground/70" />
          </Button>
          <div className="flex items-center gap-1.5 px-1">
            <Calendar className="w-4 h-4 text-primary shrink-0" />
            <select
              value={`${year}-${String(month).padStart(2, "0")}`}
              onChange={e => {
                const [y, m] = e.target.value.split("-").map(Number);
                setYear(y); setMonth(m);
              }}
              className="font-semibold text-sm text-foreground bg-transparent border-none outline-none cursor-pointer"
            >
              {Array.from({ length: 24 }, (_, i) => {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const m = d.getMonth() + 1; const y = d.getFullYear();
                return (
                  <option key={`${y}-${m}`} value={`${y}-${String(m).padStart(2, "0")}`}>
                    {formatMonthYear(m, y)}
                  </option>
                );
              })}
            </select>
          </div>
          <Button variant="ghost" size="icon" onClick={handleNextMonth} className="h-10 w-10 rounded-lg hover:bg-muted"
            disabled={month === now.getMonth() + 1 && year === now.getFullYear()}>
            <ArrowRight className="h-4 w-4 text-foreground/70" />
          </Button>
        </div>
      </div>

      {/* Member summary cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { id: CHEGE_ID, name: "Chege", contributed: summary.chegeContributed, spent: summary.chegeSpent ?? 0, net: summary.chegeNet ?? 0, target: summary.chegeTarget, colorClass: "text-primary", bgClass: "bg-primary/10", barClass: "bg-primary" },
            { id: LYDIAH_ID, name: "Lydiah", contributed: summary.lydiahContributed, spent: summary.lydiahSpent ?? 0, net: summary.lydiahNet ?? 0, target: summary.lydiahTarget, colorClass: "text-secondary", bgClass: "bg-secondary/10", barClass: "bg-secondary" },
          ].map(({ name, contributed, spent, net, target, colorClass, bgClass, barClass }) => {
            const pct = target > 0 ? Math.min((contributed / target) * 100, 100) : 0;
            const netPos = net >= 0;
            return (
              <Card key={name} className="border-none shadow-md overflow-hidden">
                <CardContent className={`p-5 space-y-3 bg-gradient-to-br ${bgClass} to-transparent`}>
                  <div className="flex justify-between items-center">
                    <h3 className="font-display font-bold text-xl text-foreground">{name}</h3>
                    <p className="text-sm text-muted-foreground">Target: {formatKes(target)}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center bg-background/50 rounded-xl p-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">In</p>
                      <p className={`text-base font-bold font-mono ${colorClass}`}>{formatKes(contributed)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Out</p>
                      <p className="text-base font-bold font-mono text-destructive">{formatKes(spent)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Net</p>
                      <p className={`text-base font-bold font-mono ${netPos ? "text-green-600" : "text-destructive"}`}>
                        {netPos ? "+" : ""}{formatKes(net)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <div className="h-2 w-full bg-muted/40 rounded-full overflow-hidden">
                      <div className={`h-full ${barClass} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 text-right">
                      {Math.round(pct)}% · {formatKes(Math.max(target - contributed, 0))} to go
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Make a Deposit */}
      {showForm ? (
        <Card className="border-none shadow-md">
          <CardContent className="p-5">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <h3 className="text-lg font-bold font-display text-foreground">Make a Bank Deposit</h3>
                <Button type="button" variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
              </div>

              {/* Who */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Who is depositing?</label>
                <div className="grid grid-cols-2 gap-2">
                  {[{ id: CHEGE_ID, name: "Chege" }, { id: LYDIAH_ID, name: "Lydiah" }].map(({ id, name }) => (
                    <button
                      key={id} type="button" onClick={() => handlePersonChange(id)}
                      className={`py-3 rounded-xl border text-base font-semibold transition-colors ${forUserId === id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:bg-muted/40"}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Source dropdown */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Where is the money from?</label>
                <div className="relative">
                  <select
                    value={selectedSource}
                    onChange={e => {
                      setSelectedSource(e.target.value);
                      setCustomAmount("");
                    }}
                    required
                    className="w-full h-12 rounded-xl border border-input bg-card px-4 pr-10 text-base text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="" disabled>Select source…</option>
                    {sources.map(s => (
                      <option key={s.label} value={s.label}>
                        {s.label} — {formatKes(s.amount)}
                      </option>
                    ))}
                    <option value="other">Other / Custom amount</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Amount — auto-filled for known sources, editable for Other */}
              {selectedSource && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">Amount (KES)</label>
                  {isOther ? (
                    <Input
                      type="number" placeholder="e.g. 20000" value={customAmount}
                      onChange={e => setCustomAmount(e.target.value)} required min="1"
                      className="h-12 text-lg bg-background"
                      autoFocus
                    />
                  ) : (
                    <div className="h-12 rounded-xl border border-input bg-muted/30 px-4 flex items-center">
                      <span className="text-lg font-bold text-primary">{formatKes(selectedSourceObj?.amount ?? 0)}</span>
                      <span className="text-sm text-muted-foreground ml-2">(full target amount)</span>
                    </div>
                  )}
                </div>
              )}

              {/* Note — only for Other */}
              {isOther && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">Note <span className="font-normal text-muted-foreground">(optional)</span></label>
                  <Input
                    type="text" placeholder="e.g. Bonus, side hustle…" value={customNote}
                    onChange={e => setCustomNote(e.target.value)} className="h-12 bg-background"
                  />
                </div>
              )}

              <Button
                type="submit"
                disabled={!selectedSource || finalAmount <= 0 || createContribution.isPending}
                className="w-full h-12 text-base"
              >
                {createContribution.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Record Deposit
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-3 p-4 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-semibold text-base shadow-md"
        >
          + Make a Bank Deposit
        </button>
      )}

      {/* History */}
      <Card className="border-none shadow-md overflow-hidden">
        {isLoading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : !contributions || contributions.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
              <PiggyBank className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <p className="text-base font-medium text-foreground">No deposits this month yet</p>
            <p className="text-sm mt-1">Tap "Make a Bank Deposit" to add one.</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border/30">
              {contributions.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-base text-foreground">{item.userName}</p>
                    <p className="text-sm text-muted-foreground">{item.note || "—"} · {formatDate(item.createdAt)}</p>
                  </div>
                  <p className="font-display font-bold text-primary whitespace-nowrap text-base shrink-0">
                    +{formatKes(item.amount)}
                  </p>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 bg-muted/30 flex justify-between items-center border-t border-border/30">
              <span className="text-sm text-muted-foreground">{contributions.length} {contributions.length === 1 ? "entry" : "entries"}</span>
              <span className="font-bold text-primary">{formatKes(contributions.reduce((s, c) => s + c.amount, 0))}</span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
