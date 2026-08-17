/**
 * Unit tests for the contributorTotals helper
 * (artifacts/mobile-budget/utils/contributorTotals.ts)
 *
 * These tests import and exercise the *actual* exported functions used by
 * goals.tsx so that any regression in the real implementation is caught here.
 *
 * Core invariants verified:
 *   1. Balance-correction rows (ANY row with a non-null note) are excluded from
 *      every contributor's total, no matter who triggered the correction.
 *      This covers both the default "Manual adjustment" sentinel AND any
 *      caller-supplied custom-reason string — the PATCH handler writes
 *      `note: reason ?? "Manual adjustment"`, so custom-reason rows are still
 *      corrections, not real contributions.
 *   2. A contributor whose only rows are corrections does not appear in the
 *      summary strip at all.
 *   3. Date-range narrowing (filterStart / filterEnd) still gives the correct
 *      per-person total while continuing to exclude correction rows.
 *   4. The strip is omitted (empty array) when fewer than 2 real contributors
 *      exist.
 */

import { describe, it, expect } from "vitest";
import {
  deriveContributorTotals,
  applyDateFilter,
  isCorrectionRow,
  MANUAL_ADJUSTMENT_NOTE,
} from "../contributorTotals.js";
import type { ContributionRow } from "../contributorTotals.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function row(
  opts: Partial<ContributionRow> & { amount: number; contributorName: string },
): ContributionRow {
  return {
    note: null,
    createdAt: "2024-03-01T10:00:00Z",
    ...opts,
  };
}

function adjustment(
  opts: Partial<ContributionRow> & { amount: number; contributorName: string },
): ContributionRow {
  return row({ note: MANUAL_ADJUSTMENT_NOTE, ...opts });
}

// ---------------------------------------------------------------------------
// 1. Manual-adjustment exclusion
// ---------------------------------------------------------------------------
describe("deriveContributorTotals — manual adjustment exclusion", () => {
  it("excludes a manual-adjustment row from the responsible contributor's total", () => {
    const contributions: ContributionRow[] = [
      row({ amount: 1000, contributorName: "Alice", createdAt: "2024-03-01T10:00:00Z" }),
      row({ amount: 500, contributorName: "Bob", createdAt: "2024-03-02T10:00:00Z" }),
      // Alice triggers a balance correction; this must NOT inflate her total.
      adjustment({ amount: -200, contributorName: "Alice", createdAt: "2024-03-03T10:00:00Z" }),
    ];

    const totals = deriveContributorTotals(contributions);

    const alice = totals.find((t) => t.name === "Alice");
    const bob = totals.find((t) => t.name === "Bob");

    // Alice: 1000 only — the -200 adjustment is excluded.
    expect(alice?.total).toBe(1000);
    expect(bob?.total).toBe(500);
  });

  it("does not count a positive manual-adjustment row toward any contributor's total", () => {
    const contributions: ContributionRow[] = [
      row({ amount: 2000, contributorName: "Carol", createdAt: "2024-04-01T08:00:00Z" }),
      row({ amount: 3000, contributorName: "Dave", createdAt: "2024-04-02T08:00:00Z" }),
      // Large positive adjustment — must be invisible in totals.
      adjustment({ amount: 99999, contributorName: "Dave", createdAt: "2024-04-03T08:00:00Z" }),
    ];

    const totals = deriveContributorTotals(contributions);
    const grandTotal = totals.reduce((s, t) => s + t.total, 0);

    // 2000 + 3000 = 5000; the 99999 adjustment must be excluded.
    expect(grandTotal).toBe(5000);
  });

  it("excludes a contributor whose only rows are manual adjustments", () => {
    const contributions: ContributionRow[] = [
      row({ amount: 1000, contributorName: "Eve", createdAt: "2024-05-01T08:00:00Z" }),
      row({ amount: 500, contributorName: "Frank", createdAt: "2024-05-02T08:00:00Z" }),
      // "System" only ever records adjustments — must not appear in the strip.
      adjustment({ amount: -100, contributorName: "System", createdAt: "2024-05-03T08:00:00Z" }),
    ];

    const totals = deriveContributorTotals(contributions);
    const names = totals.map((t) => t.name);

    expect(names).not.toContain("System");
    expect(names).toContain("Eve");
    expect(names).toContain("Frank");
  });

  it("returns an empty array when the only real contributor is one person (strip requires ≥ 2)", () => {
    const contributions: ContributionRow[] = [
      row({ amount: 1000, contributorName: "Alice", createdAt: "2024-05-01T08:00:00Z" }),
      adjustment({ amount: -200, contributorName: "Alice", createdAt: "2024-05-02T08:00:00Z" }),
    ];

    // Only "Alice" is a real contributor → showContributorFilter = false.
    expect(deriveContributorTotals(contributions)).toHaveLength(0);
  });

  it("returns an empty array when every row is a manual adjustment", () => {
    const contributions: ContributionRow[] = [
      adjustment({ amount: 500, contributorName: "Alice", createdAt: "2024-05-01T08:00:00Z" }),
      adjustment({ amount: 500, contributorName: "Bob", createdAt: "2024-05-02T08:00:00Z" }),
    ];

    // No real contributor rows → uniqueContributors is empty → empty array.
    expect(deriveContributorTotals(contributions)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 1b. Custom-reason correction exclusion
//
// DECISION: Custom-reason corrections are ALSO excluded from contributor totals.
//
// Rationale: when the PATCH /savings-goals/:id handler is called with a
// `reason` field, it writes `note: reason` instead of the default sentinel
// "Manual adjustment".  The note string is still a correction marker — it is
// the *explanation* for a balance adjustment, not evidence of a genuine
// contribution.  Regular contributions always have `note: null`.
//
// Therefore the filter is `note == null` (null means real contribution), not
// `note !== MANUAL_ADJUSTMENT_NOTE` (which would let custom-reason rows through).
//
// If this test ever fails it means the filter was narrowed back to an exact
// sentinel check, which would cause custom-reason corrections to inflate
// contributor totals — an intentional regression, not an accident.
// ---------------------------------------------------------------------------
describe("deriveContributorTotals — custom-reason correction exclusion", () => {
  it("does not count a custom-reason correction toward the contributor's total", () => {
    // Decision documented: custom-reason corrections are corrections, not
    // contributions.  Their `note` is non-null (the caller's reason string),
    // so `isCorrectionRow` returns true and they are filtered out.
    const contributions: ContributionRow[] = [
      row({ amount: 2000, contributorName: "Alice", createdAt: "2024-06-01T10:00:00Z" }),
      row({ amount: 1000, contributorName: "Bob", createdAt: "2024-06-02T10:00:00Z" }),
      // Alice triggers a large correction with a custom reason — must NOT inflate her total.
      { amount: -800, note: "Emergency withdrawal approved", contributorName: "Alice", createdAt: "2024-06-03T10:00:00Z" },
    ];

    const totals = deriveContributorTotals(contributions);

    const alice = totals.find((t) => t.name === "Alice");
    const bob = totals.find((t) => t.name === "Bob");

    // Alice: 2000 only — the custom-reason -800 correction is excluded.
    expect(alice?.total).toBe(2000);
    expect(bob?.total).toBe(1000);
  });

  it("does not count a positive custom-reason correction toward any total", () => {
    // A positive custom-reason correction (e.g. an admin credit) must also be
    // excluded — it adjusts the balance but is not a real contribution.
    const contributions: ContributionRow[] = [
      row({ amount: 500, contributorName: "Carol", createdAt: "2024-06-01T10:00:00Z" }),
      row({ amount: 700, contributorName: "Dave", createdAt: "2024-06-02T10:00:00Z" }),
      { amount: 5000, note: "Admin credit — bank error refund", contributorName: "Carol", createdAt: "2024-06-03T10:00:00Z" },
    ];

    const totals = deriveContributorTotals(contributions);
    const grandTotal = totals.reduce((s, t) => s + t.total, 0);

    // 500 + 700 = 1200; the 5000 admin credit must be excluded.
    expect(grandTotal).toBe(1200);
  });

  it("excludes a contributor whose only rows are custom-reason corrections", () => {
    // A person (or system account) that has only custom-reason correction rows
    // must not appear in the summary strip at all.
    const contributions: ContributionRow[] = [
      row({ amount: 1000, contributorName: "Eve", createdAt: "2024-06-01T10:00:00Z" }),
      row({ amount: 600, contributorName: "Frank", createdAt: "2024-06-02T10:00:00Z" }),
      { amount: -400, note: "Admin override — duplicate entry removed", contributorName: "Admin", createdAt: "2024-06-03T10:00:00Z" },
    ];

    const totals = deriveContributorTotals(contributions);
    const names = totals.map((t) => t.name);

    expect(names).not.toContain("Admin");
    expect(names).toContain("Eve");
    expect(names).toContain("Frank");
  });

  it("excludes a mix of sentinel and custom-reason corrections together", () => {
    // Both the sentinel "Manual adjustment" and a custom reason string must be
    // excluded by the same `note != null` rule.
    const contributions: ContributionRow[] = [
      row({ amount: 3000, contributorName: "Grace", createdAt: "2024-07-01T10:00:00Z" }),
      row({ amount: 2000, contributorName: "Hank", createdAt: "2024-07-02T10:00:00Z" }),
      adjustment({ amount: -500, contributorName: "Grace", createdAt: "2024-07-03T10:00:00Z" }),          // sentinel
      { amount: -300, note: "Partial refund to external account", contributorName: "Hank", createdAt: "2024-07-04T10:00:00Z" },  // custom reason
    ];

    const totals = deriveContributorTotals(contributions);

    const grace = totals.find((t) => t.name === "Grace");
    const hank = totals.find((t) => t.name === "Hank");

    // Grace: 3000 only; Hank: 2000 only — both corrections excluded.
    expect(grace?.total).toBe(3000);
    expect(hank?.total).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// 1c. isCorrectionRow — unit tests for the detection predicate
// ---------------------------------------------------------------------------
describe("isCorrectionRow", () => {
  it("returns false for a real contribution (note: null)", () => {
    expect(isCorrectionRow({ note: null })).toBe(false);
  });

  it("returns false for a real contribution (note: undefined)", () => {
    expect(isCorrectionRow({ note: undefined })).toBe(false);
  });

  it("returns true for the default sentinel note", () => {
    expect(isCorrectionRow({ note: MANUAL_ADJUSTMENT_NOTE })).toBe(true);
  });

  it("returns true for a custom-reason note string", () => {
    expect(isCorrectionRow({ note: "Emergency withdrawal approved" })).toBe(true);
  });

  it("returns true for any non-empty string note", () => {
    expect(isCorrectionRow({ note: "Any correction reason" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Date-filter narrowing combined with correction exclusion
// ---------------------------------------------------------------------------
describe("deriveContributorTotals — date-filter narrowing", () => {
  /**
   * Fixture: two contributors with real contributions in January and February,
   * plus a manual-adjustment row in February.
   */
  const contributions: ContributionRow[] = [
    // January
    row({ amount: 500, contributorName: "Alice", createdAt: "2024-01-10T10:00:00Z" }),
    row({ amount: 300, contributorName: "Bob", createdAt: "2024-01-15T10:00:00Z" }),
    // February — real contributions
    row({ amount: 700, contributorName: "Alice", createdAt: "2024-02-05T10:00:00Z" }),
    row({ amount: 400, contributorName: "Bob", createdAt: "2024-02-20T10:00:00Z" }),
    // February — manual adjustment; must be excluded regardless of date filter.
    adjustment({ amount: -600, contributorName: "Alice", createdAt: "2024-02-12T10:00:00Z" }),
  ];

  it("gives correct per-person totals across the full range, excluding the adjustment", () => {
    const totals = deriveContributorTotals(contributions);

    const alice = totals.find((t) => t.name === "Alice");
    const bob = totals.find((t) => t.name === "Bob");

    // Alice: 500 + 700 = 1200 (the -600 adjustment is excluded).
    expect(alice?.total).toBe(1200);
    expect(bob?.total).toBe(700);
  });

  it("gives correct totals narrowed to January only", () => {
    const totals = deriveContributorTotals(contributions, "2024-01-01", "2024-01-31");

    const alice = totals.find((t) => t.name === "Alice");
    const bob = totals.find((t) => t.name === "Bob");

    expect(alice?.total).toBe(500);
    expect(bob?.total).toBe(300);
  });

  it("gives correct totals narrowed to February only — adjustment still excluded", () => {
    const totals = deriveContributorTotals(contributions, "2024-02-01", "2024-02-29");

    const alice = totals.find((t) => t.name === "Alice");
    const bob = totals.find((t) => t.name === "Bob");

    // Feb real: Alice 700, Bob 400 — the -600 adjustment is in Feb but excluded.
    expect(alice?.total).toBe(700);
    expect(bob?.total).toBe(400);
  });

  it("excludes contributions before filterStart", () => {
    const totals = deriveContributorTotals(contributions, "2024-02-01", null);

    expect(totals.find((t) => t.name === "Alice")?.total).toBe(700);
    expect(totals.find((t) => t.name === "Bob")?.total).toBe(400);
  });

  it("excludes contributions after filterEnd", () => {
    const totals = deriveContributorTotals(contributions, null, "2024-01-31");

    expect(totals.find((t) => t.name === "Alice")?.total).toBe(500);
    expect(totals.find((t) => t.name === "Bob")?.total).toBe(300);
  });

  it("returns zero totals (not missing entries) when date filter removes all real contributions for a person", () => {
    // filterStart after all Feb contributions → no qualifying rows for either person.
    const totals = deriveContributorTotals(contributions, "2024-02-21", null);

    // Both contributors are still in the strip (they exist in the full list),
    // but neither has any qualifying contribution in the window.
    expect(totals.find((t) => t.name === "Alice")?.total).toBe(0);
    expect(totals.find((t) => t.name === "Bob")?.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. applyDateFilter — independent date-range tests
// ---------------------------------------------------------------------------
describe("applyDateFilter", () => {
  const rows: ContributionRow[] = [
    row({ amount: 100, contributorName: "A", createdAt: "2024-01-10T00:00:00Z" }),
    row({ amount: 200, contributorName: "A", createdAt: "2024-02-15T12:00:00Z" }),
    row({ amount: 300, contributorName: "A", createdAt: "2024-03-20T23:59:59Z" }),
  ];

  it("returns all rows when no bounds are given", () => {
    expect(applyDateFilter(rows)).toHaveLength(3);
  });

  it("keeps rows on the same day as filterStart (inclusive start boundary)", () => {
    const result = applyDateFilter(rows, "2024-02-15", null);
    expect(result.map((r) => r.amount)).toEqual([200, 300]);
  });

  it("keeps rows on the same day as filterEnd (inclusive end boundary)", () => {
    const result = applyDateFilter(rows, null, "2024-02-15");
    expect(result.map((r) => r.amount)).toEqual([100, 200]);
  });

  it("keeps only rows within the date range when both bounds are given", () => {
    const result = applyDateFilter(rows, "2024-02-01", "2024-02-28");
    expect(result.map((r) => r.amount)).toEqual([200]);
  });

  it("returns empty array when no rows fall in the range", () => {
    const result = applyDateFilter(rows, "2024-04-01", "2024-04-30");
    expect(result).toHaveLength(0);
  });
});
