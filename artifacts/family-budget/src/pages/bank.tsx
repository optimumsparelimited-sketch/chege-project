import { useState } from "react";
import {
  useGetJointAccount, useCreateDeposit, useCreateDisbursement, useDeleteJointAccountTransaction,
  useGetMembers, useGetBudgetCategories, getGetJointAccountQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatKes, formatDate } from "@/lib/utils";
import { Trash2, Plus, ArrowDownLeft, ArrowUpRight, Loader2, Landmark, TrendingUp, TrendingDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Bank() {
  const { user } = useAuth();
  const { data: account, isLoading } = useGetJointAccount();
  const { data: members } = useGetMembers();
  const { data: categories } = useGetBudgetCategories();
  const createDeposit = useCreateDeposit();
  const createDisbursement = useCreateDisbursement();
  const deleteTx = useDeleteJointAccountTransaction();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"deposit" | "disbursement" | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [madeById, setMadeById] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetJointAccountQueryKey() });

  const resetForm = () => {
    setAmount(""); setDescription(""); setDate(new Date().toISOString().split("T")[0]);
    setMadeById(""); setExpenseCategory(""); setMode(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !description || !date) return;
    try {
      if (mode === "deposit") {
        await createDeposit.mutateAsync({
          data: { amount: Number(amount), description, date, madeById: madeById || undefined },
        });
        toast({ title: "Deposit recorded" });
      } else {
        await createDisbursement.mutateAsync({
          data: { amount: Number(amount), description, date, expenseCategory: expenseCategory || undefined },
        });
        toast({ title: "Disbursement recorded" });
      }
      resetForm();
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not save transaction." });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this transaction?")) return;
    try {
      await deleteTx.mutateAsync({ id });
      toast({ title: "Transaction deleted" });
      invalidate();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not delete transaction." });
    }
  };

  const isPending = createDeposit.isPending || createDisbursement.isPending;

  return (
    <div className="space-y-8 pb-12 max-w-2xl">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Bank Account</h1>
        <p className="text-muted-foreground mt-1">Track deposits and disbursements from the shared bank account.</p>
      </div>

      {/* Balance card */}
      <Card className="border-none shadow-md bg-primary text-primary-foreground">
        <CardContent className="p-6">
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-8 h-8 animate-spin opacity-70" /></div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Landmark className="w-6 h-6 opacity-80" />
                <p className="text-sm font-medium opacity-80">Running Balance</p>
              </div>
              <p className="text-4xl font-display font-bold">{formatKes(account?.balance ?? 0)}</p>
              <div className="flex gap-6 pt-2 border-t border-primary-foreground/20">
                <div>
                  <p className="text-xs opacity-70 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Total In</p>
                  <p className="text-lg font-semibold font-mono">{formatKes(account?.totalDeposits ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs opacity-70 flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Total Out</p>
                  <p className="text-lg font-semibold font-mono">{formatKes(account?.totalDisbursements ?? 0)}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action buttons / form */}
      {!mode ? (
        <div className="flex gap-3">
          <Button onClick={() => setMode("deposit")} className="h-12 px-6 rounded-xl flex-1">
            <ArrowDownLeft className="w-5 h-5 mr-2" /> Deposit
          </Button>
          <Button onClick={() => setMode("disbursement")} variant="outline" className="h-12 px-6 rounded-xl flex-1">
            <ArrowUpRight className="w-5 h-5 mr-2" /> Disburse
          </Button>
        </div>
      ) : (
        <Card className="border-none shadow-md bg-accent/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-display">
              {mode === "deposit" ? "Record Deposit" : "Record Disbursement"}
            </CardTitle>
            <CardDescription>
              {mode === "deposit"
                ? "Money going into the bank account."
                : "Money going out of the bank account."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">Amount (KES)</label>
                  <Input type="number" placeholder="e.g. 20000" value={amount}
                    onChange={e => setAmount(e.target.value)} required min="1" className="h-12 text-lg bg-card" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">Date</label>
                  <Input type="date" value={date} onChange={e => setDate(e.target.value)} required className="h-12 bg-card" />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-semibold text-foreground">Description</label>
                  <Input placeholder={mode === "deposit" ? "e.g. Salary deposit" : "e.g. Paid school fees"}
                    value={description} onChange={e => setDescription(e.target.value)} required className="h-12 bg-card" />
                </div>
                {mode === "deposit" && (
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-semibold text-foreground">Deposited by</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[{ id: "63497598", name: "Chege" }, { id: "63570605", name: "Lydiah" }, { id: "bank", name: "Bank" }].map(({ id, name }) => (
                        <button key={id} type="button" onClick={() => setMadeById(id)}
                          className={`h-12 rounded-xl border text-base font-semibold transition-colors ${madeById === id ? "bg-primary text-primary-foreground border-primary" : "bg-card border-input text-foreground hover:bg-muted/40"}`}>
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {mode === "disbursement" && (
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-semibold text-foreground">Expense category <span className="font-normal text-muted-foreground">(optional)</span></label>
                    <select
                      className="flex h-12 w-full rounded-md border border-input bg-card px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)}>
                      <option value="">Not linked to an expense category</option>
                      {categories?.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <Button type="button" variant="outline" onClick={resetForm} className="h-12 px-6">Cancel</Button>
                <Button type="submit" disabled={isPending} className="h-12 px-8">
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Transaction list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-10 h-10 text-primary animate-spin" /></div>
      ) : !account?.transactions?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <Landmark className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">No transactions yet</p>
          <p className="text-sm mt-1">Record a deposit or disbursement above.</p>
        </div>
      ) : (
        <Card className="border-none shadow-md overflow-hidden">
          <div className="divide-y divide-border/50">
            {account.transactions.map((tx) => {
              const isDeposit = tx.type === "deposit";
              return (
                <div key={tx.id} className="p-4 sm:p-5 flex items-center justify-between gap-4 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isDeposit ? "bg-green-100" : "bg-red-100"}`}>
                      {isDeposit
                        ? <ArrowDownLeft className="w-5 h-5 text-green-600" />
                        : <ArrowUpRight className="w-5 h-5 text-destructive" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{tx.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isDeposit ? `Deposited by ${tx.madeByName ?? "Unknown"}` : (tx.expenseCategory ? `→ ${tx.expenseCategory}` : "Disbursement")}
                        {" · "}{formatDate(tx.date)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className={`font-display font-bold text-lg ${isDeposit ? "text-green-600" : "text-destructive"}`}>
                      {isDeposit ? "+" : "-"}{formatKes(tx.amount)}
                    </p>
                    <Button variant="ghost" size="icon"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-9 w-9"
                      onClick={() => handleDelete(tx.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
