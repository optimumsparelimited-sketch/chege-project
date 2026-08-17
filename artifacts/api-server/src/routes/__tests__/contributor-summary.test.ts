/**
 * Contract test for GET /savings-goals/:id/contributions — note field.
 *
 * The `note` field on every returned row is the only signal the client has for
 * distinguishing a regular contribution from a manual balance correction.  If
 * it is missing, the frontend filter cannot exclude adjustment rows and every
 * correction will silently inflate a contributor's summary total.
 *
 * These tests confirm the field is present and carries the correct sentinel
 * value so the client-side filtering (tested in
 * artifacts/mobile-budget/utils/__tests__/contributorTotals.test.ts against
 * the real helper) remains reliable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Mock @workspace/db
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  const makeTable = (name: string) =>
    new Proxy({}, { get: (_, prop) => ({ _table: name, _col: String(prop) }) });

  return {
    savingsGoalsTable: makeTable("savings_goals"),
    savingsGoalContributionsTable: makeTable("savings_goal_contributions"),
    usersTable: makeTable("users"),
    db: {
      select: vi.fn(),
      transaction: vi.fn(),
    },
    eq: vi.fn((col, val) => ({ _eq: { col, val } })),
    sql: vi.fn((strings: TemplateStringsArray, ...vals: unknown[]) => ({
      _sql: { strings, vals },
    })),
    desc: vi.fn((col) => ({ _desc: col })),
  };
});

import { db } from "@workspace/db";
import savingsGoalsRouter from "../savings-goals.js";

// ---------------------------------------------------------------------------
// Minimal express app
// ---------------------------------------------------------------------------
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 99 };
    next();
  });
  app.use("/", savingsGoalsRouter);
  return app;
}

type MockableDb = {
  select: ((...args: unknown[]) => unknown) & {
    mockReturnValue: (v: unknown) => void;
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /savings-goals/:id/contributions — note field contract", () => {
  const app = buildApp();
  const mockedDb = db as unknown as MockableDb;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function stubSelect(rows: object[]) {
    mockedDb.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    });
  }

  it("includes the note field on normal contribution rows (note: null)", async () => {
    stubSelect([
      {
        id: 1,
        goalId: 42,
        amount: 500,
        note: null,
        createdByUserId: 1,
        createdAt: new Date("2024-03-01T10:00:00Z"),
        contributorName: "Alice",
      },
    ]);

    const res = await request(app).get("/savings-goals/42/contributions");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    // `note` must be present even when null so the client can detect its absence.
    expect(Object.keys(res.body[0])).toContain("note");
    expect(res.body[0].note).toBeNull();
  });

  it("sets note to 'Manual adjustment' on balance-correction rows", async () => {
    stubSelect([
      {
        id: 2,
        goalId: 42,
        amount: -200,
        note: "Manual adjustment",
        createdByUserId: 1,
        createdAt: new Date("2024-03-02T11:00:00Z"),
        contributorName: "Alice",
      },
    ]);

    const res = await request(app).get("/savings-goals/42/contributions");

    expect(res.status).toBe(200);
    expect(res.body[0].note).toBe("Manual adjustment");
  });

  it("returns both real and adjustment rows with their notes intact so the client can filter", async () => {
    stubSelect([
      {
        id: 10,
        goalId: 5,
        amount: 1000,
        note: null,
        createdByUserId: 1,
        createdAt: new Date("2024-04-01T09:00:00Z"),
        contributorName: "Bob",
      },
      {
        id: 11,
        goalId: 5,
        amount: -300,
        note: "Manual adjustment",
        createdByUserId: 2,
        createdAt: new Date("2024-04-05T15:00:00Z"),
        contributorName: "Alice",
      },
      {
        id: 12,
        goalId: 5,
        amount: 500,
        note: null,
        createdByUserId: 2,
        createdAt: new Date("2024-04-10T08:00:00Z"),
        contributorName: "Alice",
      },
    ]);

    const res = await request(app).get("/savings-goals/5/contributions");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);

    // Every row must carry a `note` key.
    for (const row of res.body) {
      expect(Object.keys(row)).toContain("note");
    }

    const notes = res.body.map((r: { note: string | null }) => r.note);
    expect(notes).toContain(null);
    expect(notes).toContain("Manual adjustment");
  });

  it("preserves a caller-supplied reason note verbatim — it is distinct from the default sentinel", async () => {
    // When the PATCH handler is given an explicit `reason`, that string becomes
    // the note (not "Manual adjustment").  The client must receive it faithfully
    // so it can decide how to display or filter such rows.
    stubSelect([
      {
        id: 20,
        goalId: 7,
        amount: -150,
        note: "Emergency withdrawal approved",
        createdByUserId: 3,
        createdAt: new Date("2024-05-01T10:00:00Z"),
        contributorName: "Eve",
      },
    ]);

    const res = await request(app).get("/savings-goals/7/contributions");

    expect(res.status).toBe(200);
    expect(res.body[0].note).toBe("Emergency withdrawal approved");
  });
});
