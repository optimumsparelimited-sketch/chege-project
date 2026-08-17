import { describe, it, expect } from "vitest";
import {
  filterByDateRange,
  computeContributorTotals,
  getChipRange,
} from "../lib/goal-history-utils";
import type { GoalContribution } from "../lib/goal-history-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 1;

function makeContribution(
  overrides: Partial<GoalContribution> & { createdAt: string },
): GoalContribution {
  return {
    id: nextId++,
    goalId: 1,
    amount: 1000,
    note: null,
    createdByUserId: "user-1",
    contributorName: "Chege",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// filterByDateRange
// ---------------------------------------------------------------------------

describe("filterByDateRange", () => {
  it("returns all contributions when both bounds are empty", () => {
    const contributions = [
      makeContribution({ createdAt: "2026-01-15T10:00:00Z" }),
      makeContribution({ createdAt: "2026-06-01T08:00:00Z" }),
    ];
    expect(filterByDateRange(contributions, "", "")).toHaveLength(2);
  });

  it("filters out contributions before fromDate (inclusive boundary)", () => {
    const contributions = [
      makeContribution({ createdAt: "2026-01-31T23:59:59Z" }), // excluded
      makeContribution({ createdAt: "2026-02-01T00:00:00Z" }), // on boundary — included
      makeContribution({ createdAt: "2026-03-15T12:00:00Z" }), // included
    ];
    const result = filterByDateRange(contributions, "2026-02-01", "");
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.createdAt)).not.toContain("2026-01-31T23:59:59Z");
  });

  it("filters out contributions after toDate (inclusive boundary)", () => {
    const contributions = [
      makeContribution({ createdAt: "2026-02-28T20:00:00Z" }), // included
      makeContribution({ createdAt: "2026-02-28T23:59:59Z" }), // on boundary — included
      makeContribution({ createdAt: "2026-03-01T00:00:00Z" }), // excluded
    ];
    const result = filterByDateRange(contributions, "", "2026-02-28");
    expect(result).toHaveLength(2);
  });

  it("filters with both fromDate and toDate across month boundaries", () => {
    const contributions = [
      makeContribution({ createdAt: "2025-12-15T08:00:00Z" }), // excluded — before range
      makeContribution({ createdAt: "2026-01-10T08:00:00Z" }), // included
      makeContribution({ createdAt: "2026-02-20T08:00:00Z" }), // included
      makeContribution({ createdAt: "2026-03-01T08:00:00Z" }), // excluded — after range
    ];
    const result = filterByDateRange(contributions, "2026-01-01", "2026-02-28");
    expect(result).toHaveLength(2);
  });

  it("returns an empty array when nothing falls in range", () => {
    const contributions = [
      makeContribution({ createdAt: "2025-06-01T08:00:00Z" }),
    ];
    expect(filterByDateRange(contributions, "2026-01-01", "2026-12-31")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeContributorTotals
// ---------------------------------------------------------------------------

describe("computeContributorTotals", () => {
  it("returns an empty array for no contributions", () => {
    expect(computeContributorTotals([])).toEqual([]);
  });

  it("sums a single contributor's contributions correctly", () => {
    const contributions = [
      makeContribution({ createdAt: "2026-01-01T00:00:00Z", contributorName: "Chege", amount: 500 }),
      makeContribution({ createdAt: "2026-02-01T00:00:00Z", contributorName: "Chege", amount: 300 }),
    ];
    const totals = computeContributorTotals(contributions);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toEqual({ name: "Chege", total: 800 });
  });

  it("sums multiple contributors independently", () => {
    const contributions = [
      makeContribution({ createdAt: "2026-01-10T00:00:00Z", contributorName: "Chege", amount: 1000 }),
      makeContribution({ createdAt: "2026-01-15T00:00:00Z", contributorName: "Lydiah", amount: 2000 }),
      makeContribution({ createdAt: "2026-02-10T00:00:00Z", contributorName: "Chege", amount: 500 }),
      makeContribution({ createdAt: "2026-02-15T00:00:00Z", contributorName: "Lydiah", amount: 800 }),
    ];
    const totals = computeContributorTotals(contributions);
    const byName = Object.fromEntries(totals.map((t) => [t.name, t.total]));
    expect(byName["Chege"]).toBe(1500);
    expect(byName["Lydiah"]).toBe(2800);
  });

  it("excludes entries whose note is 'Manual adjustment' from totals", () => {
    const contributions = [
      makeContribution({ createdAt: "2026-01-01T00:00:00Z", contributorName: "Chege", amount: 1000 }),
      makeContribution({
        createdAt: "2026-01-05T00:00:00Z",
        contributorName: "Chege",
        amount: -500,
        note: "Manual adjustment",
      }),
    ];
    const totals = computeContributorTotals(contributions);
    // Only the real contribution counts; the adjustment is excluded
    expect(totals).toHaveLength(1);
    expect(totals[0]).toEqual({ name: "Chege", total: 1000 });
  });

  it("excludes all Manual adjustment entries even when mixed with multiple contributors", () => {
    const contributions = [
      makeContribution({ createdAt: "2026-01-01T00:00:00Z", contributorName: "Chege", amount: 2000 }),
      makeContribution({ createdAt: "2026-01-02T00:00:00Z", contributorName: "Lydiah", amount: 3000 }),
      makeContribution({
        createdAt: "2026-01-03T00:00:00Z",
        contributorName: "Chege",
        amount: 999,
        note: "Manual adjustment",
      }),
      makeContribution({
        createdAt: "2026-01-04T00:00:00Z",
        contributorName: "Lydiah",
        amount: -200,
        note: "Manual adjustment",
      }),
    ];
    const totals = computeContributorTotals(contributions);
    const byName = Object.fromEntries(totals.map((t) => [t.name, t.total]));
    expect(byName["Chege"]).toBe(2000);
    expect(byName["Lydiah"]).toBe(3000);
  });

  it("only counts real contributions within a date-filtered window (integration with filterByDateRange)", () => {
    const all = [
      // January contributions
      makeContribution({ createdAt: "2026-01-05T00:00:00Z", contributorName: "Chege", amount: 500 }),
      makeContribution({ createdAt: "2026-01-20T00:00:00Z", contributorName: "Lydiah", amount: 700 }),
      // February contributions (outside window)
      makeContribution({ createdAt: "2026-02-10T00:00:00Z", contributorName: "Chege", amount: 9000 }),
      makeContribution({ createdAt: "2026-02-15T00:00:00Z", contributorName: "Lydiah", amount: 8000 }),
      // Manual adjustment inside window — must be excluded
      makeContribution({
        createdAt: "2026-01-25T00:00:00Z",
        contributorName: "Chege",
        amount: -100,
        note: "Manual adjustment",
      }),
    ];

    const inJanuary = filterByDateRange(all, "2026-01-01", "2026-01-31");
    const totals = computeContributorTotals(inJanuary);
    const byName = Object.fromEntries(totals.map((t) => [t.name, t.total]));

    expect(byName["Chege"]).toBe(500);   // adjustment excluded; Feb contribution excluded
    expect(byName["Lydiah"]).toBe(700);  // Feb contribution excluded
  });
});

// ---------------------------------------------------------------------------
// getChipRange
// ---------------------------------------------------------------------------

describe("getChipRange", () => {
  // Fix reference date: 10 August 2026
  const now = new Date("2026-08-10T12:00:00Z");

  it("this-month: starts on first of current month and ends today", () => {
    const { from, to } = getChipRange("this-month", now);
    expect(from).toBe("2026-08-01");
    expect(to).toBe("2026-08-10");
  });

  it("last-month: covers all of July 2026", () => {
    const { from, to } = getChipRange("last-month", now);
    expect(from).toBe("2026-07-01");
    expect(to).toBe("2026-07-31");
  });

  it("last-3-months: starts three calendar months back", () => {
    const { from, to } = getChipRange("last-3-months", now);
    expect(from).toBe("2026-05-10");
    expect(to).toBe("2026-08-10");
  });

  it("this-year: starts on Jan 1 of current year", () => {
    const { from, to } = getChipRange("this-year", now);
    expect(from).toBe("2026-01-01");
    expect(to).toBe("2026-08-10");
  });

  it("last-month handles year boundary (January → December of previous year)", () => {
    const jan10 = new Date("2026-01-10T12:00:00Z");
    const { from, to } = getChipRange("last-month", jan10);
    expect(from).toBe("2025-12-01");
    expect(to).toBe("2025-12-31");
  });

  it("filterByDateRange respects chip range — keeps only contributions in this-month window", () => {
    const contributions = [
      makeContribution({ createdAt: "2026-07-31T23:00:00Z" }), // last month — excluded
      makeContribution({ createdAt: "2026-08-01T00:00:00Z" }), // first of this month — included
      makeContribution({ createdAt: "2026-08-10T11:59:59Z" }), // today — included
    ];
    const { from, to } = getChipRange("this-month", now);
    const result = filterByDateRange(contributions, from, to);
    expect(result).toHaveLength(2);
  });
});
