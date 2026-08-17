/**
 * Pure helper for deriving per-contributor totals from a goal's contribution
 * history.  Extracted from goals.tsx so it can be unit-tested in isolation and
 * reused across screens.
 *
 * Balance-correction rows are intentionally excluded from every contributor's
 * total — corrections should not inflate the person who triggered them, and
 * should not surface as a phantom "System" contributor in the summary strip.
 *
 * Detection rule: ALL rows with a non-null `note` are corrections.
 *   - The PATCH handler writes note = "Manual adjustment" (the sentinel) when
 *     no explicit reason is supplied.
 *   - When the caller supplies a `reason` field the handler writes that custom
 *     string instead — it is still a balance correction, not a real contribution.
 *   - Regular contributions always have note = null.
 *
 * Therefore the filter is `c.note == null` (excludes both the sentinel and any
 * custom-reason string), rather than checking for the exact sentinel value.
 */

/** Sentinel note written by the PATCH /savings-goals/:id balance-correction handler. */
export const MANUAL_ADJUSTMENT_NOTE = 'Manual adjustment';

/**
 * Returns true when a contribution row is a balance correction (manual
 * adjustment with or without a custom reason) that should be excluded from
 * contributor totals.
 *
 * Any row with a non-null note is a correction — regular contributions always
 * have note === null.
 */
export function isCorrectionRow(row: { note?: string | null }): boolean {
  return row.note != null;
}

/** Minimal fields the helpers need — the generics preserve the full input type. */
export interface ContributionRow {
  amount: number;
  note?: string | null;
  contributorName?: string | null;
  createdAt: string;
}

export interface ContributorTotal {
  name: string;
  total: number;
}

/** Coerce a Date, ISO string, or null/undefined to a Date object, or null. */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Filter `contributions` to only rows within the inclusive [filterStart, filterEnd]
 * date range.  Either bound can be a Date object, an ISO string, or null/undefined
 * to leave that side open.  Time components are normalised so the start is the
 * very beginning of filterStart's day and the end is the very last millisecond
 * of filterEnd's day.
 *
 * Generic over T so callers get back the same concrete type they passed in —
 * preserving all fields (including `id`) on the contribution rows.
 */
export function applyDateFilter<T extends ContributionRow>(
  contributions: T[],
  filterStart?: Date | string | null,
  filterEnd?: Date | string | null,
): T[] {
  return contributions.filter((c) => {
    const date = new Date(c.createdAt);
    const start = toDate(filterStart);
    if (start) {
      start.setHours(0, 0, 0, 0);
      if (date < start) return false;
    }
    const end = toDate(filterEnd);
    if (end) {
      end.setHours(23, 59, 59, 999);
      if (date > end) return false;
    }
    return true;
  });
}

/**
 * Derive per-contributor totals from a goal's contribution history.
 *
 * Rules:
 *   1. Balance-correction rows (any row with a non-null note) are excluded
 *      everywhere — they do not contribute to any person's total and do not
 *      create a contributor entry in the summary strip.  This covers both the
 *      default "Manual adjustment" sentinel and any caller-supplied custom
 *      reason string; see `isCorrectionRow` for details.
 *   2. Date filtering (filterStart / filterEnd) is applied before summing
 *      but after the correction-exclusion pass that builds the unique name set.
 *      This means a person who has only correction rows in the chosen date
 *      range still does not appear in the strip.
 *   3. The summary strip is only shown when there are ≥ 2 distinct real
 *      contributors (showContributorFilter).  When fewer are present the
 *      function returns an empty array.
 *
 * @param contributions  Full (unfiltered) contribution list for the goal.
 * @param filterStart    Optional lower date bound (Date, ISO string, or null).
 * @param filterEnd      Optional upper date bound (Date, ISO string, or null).
 * @returns              Array of { name, total } entries, or [] when the strip
 *                       should not be shown.
 */
export function deriveContributorTotals<T extends ContributionRow>(
  contributions: T[],
  filterStart?: Date | string | null,
  filterEnd?: Date | string | null,
): ContributorTotal[] {
  // Step 1: build the unique real-contributor set from the FULL list (no date
  // filter) so that a person who made contributions outside the date window is
  // still treated as a known contributor, keeping the strip visible.
  const uniqueContributors = Array.from(
    new Set(
      contributions
        .filter((c) => !isCorrectionRow(c))
        .map((c) => c.contributorName ?? 'Unknown'),
    ),
  );

  // Strip is only meaningful when more than one real contributor exists.
  if (uniqueContributors.length < 2) return [];

  // Step 2: apply date filter — correction rows may fall inside the window
  // but are excluded in step 3.
  const dateFiltered = applyDateFilter(contributions, filterStart, filterEnd);

  // Step 3: sum real contributions per person within the date window.
  return uniqueContributors.map((name) => ({
    name,
    total: dateFiltered
      .filter(
        (c) =>
          !isCorrectionRow(c) &&
          (c.contributorName ?? 'Unknown') === name,
      )
      .reduce((sum, c) => sum + c.amount, 0),
  }));
}
