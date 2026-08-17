/**
 * Pure utility functions for GoalContributionHistory.
 * Extracted so they can be unit-tested without a DOM or real API.
 */

export interface GoalContribution {
  id: number;
  goalId: number;
  amount: number;
  note?: string | null;
  createdByUserId: string;
  contributorName: string;
  createdAt: string;
}

export type QuickChip = "this-month" | "last-month" | "last-3-months" | "this-year";

/**
 * Return YYYY-MM-DD boundaries for a quick-filter chip, relative to `now`.
 */
export function getChipRange(
  chip: QuickChip,
  now: Date = new Date(),
): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed

  if (chip === "this-month") {
    return { from: fmt(new Date(y, m, 1)), to: fmt(now) };
  }
  if (chip === "last-month") {
    const firstOfLastMonth = new Date(y, m - 1, 1);
    const lastOfLastMonth = new Date(y, m, 0);
    return { from: fmt(firstOfLastMonth), to: fmt(lastOfLastMonth) };
  }
  if (chip === "last-3-months") {
    const threeMonthsAgo = new Date(y, m - 3, now.getDate());
    return { from: fmt(threeMonthsAgo), to: fmt(now) };
  }
  // this-year
  return { from: fmt(new Date(y, 0, 1)), to: fmt(now) };
}

/**
 * Filter contributions to those whose createdAt falls within [fromDate, toDate].
 * Both bounds are optional (empty string = unbounded).
 */
export function filterByDateRange(
  contributions: GoalContribution[],
  fromDate: string,
  toDate: string,
): GoalContribution[] {
  return contributions.filter((c) => {
    const date = new Date(c.createdAt);
    if (fromDate && date < new Date(`${fromDate}T00:00:00.000`)) return false;
    if (toDate && date > new Date(`${toDate}T23:59:59.999`)) return false;
    return true;
  });
}

/**
 * Compute per-contributor totals, excluding all balance-correction entries
 * (any entry whose note is non-null, including the "Manual adjustment" sentinel
 * and custom-reason corrections).
 */
export function computeContributorTotals(
  contributions: GoalContribution[],
): { name: string; total: number }[] {
  const map = new Map<string, number>();
  for (const c of contributions) {
    if (c.note != null) continue; // skip all corrections
    map.set(c.contributorName, (map.get(c.contributorName) ?? 0) + c.amount);
  }
  const result: { name: string; total: number }[] = [];
  map.forEach((total, name) => result.push({ name, total }));
  return result;
}
