import { useState } from "react";
import { useGetDashboardCategoryBreakdown } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatKes, formatMonthYear } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Loader2, Calendar, Target } from "lucide-react";

export default function Budget() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  
  const { data: breakdown, isLoading } = useGetDashboardCategoryBreakdown({ month, year });

  const handlePrevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  // Group by priority
  const priorityMap: Record<number, string> = {
    1: "Survival Essentials",
    2: "Health & Education",
    3: "Household",
    4: "Connectivity & Grooming",
    5: "Discretionary"
  };

  const groupedBreakdown = breakdown ? breakdown.reduce((acc, item) => {
    if (!acc[item.priority]) acc[item.priority] = [];
    acc[item.priority].push(item);
    return acc;
  }, {} as Record<number, typeof breakdown>) : {};

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Budget Breakdown</h1>
          <p className="text-muted-foreground mt-1">Detailed view of every category limit.</p>
        </div>
        
        <div className="flex items-center gap-4 bg-card rounded-xl p-1 border shadow-sm">
          <Button variant="ghost" size="icon" onClick={handlePrevMonth} className="h-10 w-10 rounded-lg hover:bg-muted">
            <ArrowLeft className="h-5 w-5 text-foreground/70" />
          </Button>
          <div className="w-36 text-center font-semibold font-display flex items-center justify-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            {formatMonthYear(month, year)}
          </div>
          <Button variant="ghost" size="icon" onClick={handleNextMonth} className="h-10 w-10 rounded-lg hover:bg-muted" disabled={month === now.getMonth() + 1 && year === now.getFullYear()}>
            <ArrowRight className="h-5 w-5 text-foreground/70" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-20">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        </div>
      ) : !breakdown ? (
        <div className="text-center p-10">Failed to load data</div>
      ) : (
        <div className="space-y-8">
          {[1, 2, 3, 4, 5].map(priority => {
            const items = groupedBreakdown[priority];
            if (!items || items.length === 0) return null;
            
            const groupTotal = items.reduce((s, i) => s + i.budgetAmount, 0);
            const groupSpent = items.reduce((s, i) => s + i.spentAmount, 0);

            return (
              <div key={priority} className="space-y-4">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
                    <Target className="w-5 h-5 text-secondary" />
                    Tier {priority}: {priorityMap[priority]}
                  </h2>
                  <div className="text-sm font-medium text-muted-foreground">
                    {formatKes(groupSpent)} / {formatKes(groupTotal)}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {items.map(cat => {
                    const isOver = cat.percentUsed > 100;
                    const isNear = cat.percentUsed > 85 && !isOver;
                    
                    return (
                      <Card key={cat.category} className="border-none shadow-sm bg-card hover:shadow-md transition-shadow">
                        <CardContent className="p-5 space-y-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <h3 className="font-semibold text-lg text-foreground">{cat.category}</h3>
                              <p className="text-sm text-muted-foreground">Limit: {formatKes(cat.budgetAmount)}</p>
                            </div>
                            <div className="text-right">
                              <p className={`font-display font-bold text-lg ${isOver ? 'text-destructive' : 'text-primary'}`}>
                                {formatKes(cat.spentAmount)}
                              </p>
                              <p className="text-xs font-medium text-muted-foreground">
                                {isOver ? (
                                  <span className="text-destructive">Over by {formatKes(Math.abs(cat.remaining))}</span>
                                ) : (
                                  <span>{formatKes(cat.remaining)} left</span>
                                )}
                              </p>
                            </div>
                          </div>
                          
                          <div className="space-y-1.5">
                            <Progress 
                              value={Math.min(cat.percentUsed, 100)} 
                              indicatorColor={isOver ? 'hsl(var(--destructive))' : isNear ? 'hsl(var(--secondary))' : cat.color || 'hsl(var(--primary))'}
                              className="h-2"
                            />
                            <div className="flex justify-end text-xs font-medium text-muted-foreground">
                              {Math.round(cat.percentUsed)}%
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}