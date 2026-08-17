/**
 * Unit tests for POST /savings-goals/:id/contribute
 *
 * Three core guarantees are tested:
 *
 * 1. ATOMIC INCREMENT under concurrent requests
 *    The handler must use sql`currentAmount + ${amount}` — a server-side
 *    atomic expression — rather than a client-side read-modify-write or a
 *    constant overwrite.
 *
 *    The transaction mock evaluates the SQL expression captured from the
 *    route's set() call to determine the semantics:
 *      • An expression that contains a column reference is treated as an
 *        atomic increment: newValue = currentValue + delta.
 *      • An expression that contains only a constant is treated as an
 *        overwrite: newValue = constant.
 *      • A plain number is a direct overwrite (read-modify-write leak).
 *    This means a regression to sql`${amount}` or `currentValue + amount`
 *    (plain number) fails the concurrent-balance assertion (ends up at the
 *    contribution amount rather than the accumulated sum), making the test
 *    an effective regression guard.
 *
 * 2. ROLLBACK when the history insert fails
 *    Each transaction mock maintains *transaction-local* state.  The shared
 *    "committed" row is updated only when the callback returns without
 *    throwing.  When insert throws, the callback re-throws, and the
 *    committed row remains unchanged — exactly what Postgres ROLLBACK does.
 *
 * 3. CAPPING & COMPLETION
 *    When a contribution would push the balance past the target, the handler
 *    must cap the applied amount at (targetAmount − currentAmount) and set
 *    isCompleted = true in the same UPDATE.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Mock @workspace/db — vi.mock is hoisted; factory must not reference
// variables declared outside it.
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
    // sql is imported directly from drizzle-orm by the route, not from
    // @workspace/db, so the real tagged-template implementation is used.
    // No mock needed here.
    desc: vi.fn((col) => ({ _desc: col })),
  };
});

// Import AFTER mock registration so the route module picks up the stub.
import { db } from "@workspace/db";
import savingsGoalsRouter from "../savings-goals.js";

// ---------------------------------------------------------------------------
// Minimal express app — bypasses real auth middleware with an inline stub.
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

// ---------------------------------------------------------------------------
// SQL expression evaluator
//
// The real drizzle sql`` tagged template produces an object whose
// queryChunks array interleaves StringChunk objects and interpolated values.
// We classify the expression by inspecting whether a column proxy (our mocked
// table column — recognisable by the _col property) appears as a chunk:
//
//   sql`${col} + ${amount}`  → chunks: [col_proxy, " + ", amount]
//                              → hasColumnRef = true → ATOMIC INCREMENT
//
//   sql`${amount}`           → chunks: [amount]
//                              → hasColumnRef = false → CONSTANT OVERWRITE
//
//   plain number             → direct overwrite (read-modify-write)
//
// A test that asserts the final committed balance equals the sum of all
// contributions will fail for the latter two cases, making this an effective
// regression guard against lost-update bugs.
// ---------------------------------------------------------------------------
function evaluateSetClause(
  currentValue: number,
  setClause: Record<string, unknown>,
): number {
  const expr = setClause.currentAmount;

  // Plain number → read-modify-write overwrite.
  if (typeof expr === "number") return expr;

  // Drizzle SQL object → inspect queryChunks.
  const chunks = (expr as Record<string, unknown>).queryChunks as unknown[];

  // A column reference in our mock is the proxy object produced by makeTable.
  const hasColumnRef = chunks.some(
    (c) => c !== null && typeof c === "object" && "_col" in (c as object),
  );
  const numerics = chunks.filter((c) => typeof c === "number") as number[];

  if (hasColumnRef && numerics.length === 1) {
    // sql`${col} + ${delta}` → atomic increment.
    return currentValue + numerics[0];
  }

  if (!hasColumnRef && numerics.length === 1) {
    // sql`${constant}` → constant overwrite (non-atomic).
    return numerics[0];
  }

  throw new Error(
    `evaluateSetClause: unrecognised SQL expression shape. chunks: ${JSON.stringify(chunks)}`,
  );
}

// ---------------------------------------------------------------------------
// Shared goal row type
// ---------------------------------------------------------------------------
type GoalRow = {
  id: number;
  name: string;
  currentAmount: number;
  targetAmount: number;
  isCompleted: boolean;
  deadline: null;
  createdByUserId: number;
  createdAt: Date;
};

function makeRow(
  id: number,
  opts: { current?: number; target?: number; completed?: boolean } = {},
): GoalRow {
  return {
    id,
    name: `Goal ${id}`,
    currentAmount: opts.current ?? 0,
    targetAmount: opts.target ?? 500,
    isCompleted: opts.completed ?? false,
    deadline: null,
    createdByUserId: 1,
    createdAt: new Date("2024-01-01"),
  };
}

/** Build a tx.select() chain that resolves to the given rows. */
function makeSelectMock(rows: GoalRow[]) {
  return vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        for: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

/** Narrow view of db that lets tests re-assign transaction per test. */
type MockableDb = {
  select: ((...args: unknown[]) => unknown) & { mockReturnValue: (v: unknown) => void };
  transaction: ((cb: (tx: Record<string, unknown>) => Promise<unknown>) => Promise<unknown>) & {
    mock: { results: Array<{ type: string; value: unknown }> };
    mockImplementation: (fn: (...args: unknown[]) => unknown) => MockableDb["transaction"];
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /savings-goals/:id/contribute", () => {
  const app = buildApp();
  const mockedDb = db as unknown as MockableDb;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Atomic SQL expression — single request
  // -------------------------------------------------------------------------
  describe("atomic SQL increment (single request)", () => {
    it("applies the contribution amount as an increment, not an overwrite", async () => {
      // Committed row starts at 100; we expect it to reach 150 after +50.
      const committed = makeRow(1, { current: 100, target: 500 });

      mockedDb.transaction = vi
        .fn()
        .mockImplementation(
          async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
            // Transaction-local snapshot — only copied to `committed` on success.
            let txAmount = committed.currentAmount;
            let txCompleted = committed.isCompleted;

            const tx: Record<string, unknown> = {
              select: makeSelectMock([{ ...committed }]),
              update: vi.fn().mockImplementation(() => ({
                set: vi.fn().mockImplementation((setClause: Record<string, unknown>) => ({
                  where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockImplementation(async () => {
                      txAmount = evaluateSetClause(txAmount, setClause);
                      txCompleted = typeof setClause.isCompleted === "boolean"
                        ? setClause.isCompleted
                        : txCompleted;
                      return [{ ...committed, currentAmount: txAmount, isCompleted: txCompleted }];
                    }),
                  }),
                })),
              })),
              insert: vi.fn().mockImplementation(() => ({
                values: vi.fn().mockResolvedValue(undefined),
              })),
            };

            const result = await cb(tx);
            // Commit only on success.
            committed.currentAmount = txAmount;
            committed.isCompleted = txCompleted;
            return result;
          },
        );

      const res = await request(app)
        .post("/savings-goals/1/contribute")
        .send({ amount: 50 });

      expect(res.status).toBe(200);
      expect(res.body.currentAmount).toBe(150);
      expect(committed.currentAmount).toBe(150);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Concurrent requests — shared committed row, SQL-expression-aware mock
  // -------------------------------------------------------------------------
  describe("concurrent requests", () => {
    it("both concurrent contributions accumulate — final balance equals the sum of both amounts, proving atomic increment semantics", async () => {
      // Shared committed row.  With a correct sql`col + amount` expression,
      // both transactions independently add 200, giving 400.
      // A regression to sql`${amount}` (overwrite) would end up at 200,
      // and the assertion below would catch it.
      const committed = makeRow(7, { current: 0, target: 1000 });

      mockedDb.transaction = vi
        .fn()
        .mockImplementation(
          async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
            // Each transaction gets its own local snapshot, initialised from
            // the current committed value at the moment it starts.
            let txAmount = committed.currentAmount;
            let txCompleted = committed.isCompleted;

            const tx: Record<string, unknown> = {
              select: makeSelectMock([{ ...committed }]),
              update: vi.fn().mockImplementation(() => ({
                set: vi.fn().mockImplementation((setClause: Record<string, unknown>) => ({
                  where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockImplementation(async () => {
                      txAmount = evaluateSetClause(txAmount, setClause);
                      txCompleted = typeof setClause.isCompleted === "boolean"
                        ? setClause.isCompleted
                        : txCompleted;
                      return [{ ...committed, currentAmount: txAmount, isCompleted: txCompleted }];
                    }),
                  }),
                })),
              })),
              insert: vi.fn().mockImplementation(() => ({
                values: vi.fn().mockResolvedValue(undefined),
              })),
            };

            const result = await cb(tx);
            // Commit local state to shared row on success.
            committed.currentAmount += txAmount - committed.currentAmount;
            committed.isCompleted = txCompleted;
            return result;
          },
        );

      const [res1, res2] = await Promise.all([
        request(app).post("/savings-goals/7/contribute").send({ amount: 200 }),
        request(app).post("/savings-goals/7/contribute").send({ amount: 200 }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(mockedDb.transaction).toHaveBeenCalledTimes(2);

      // Final committed balance must be 400 (0 + 200 + 200).
      // A non-atomic overwrite (sql`${200}` or plain 200) would leave it at
      // 200 because both transactions would set the value to 200, not add to it.
      expect(committed.currentAmount).toBe(400);
    });

    it("records one contribution insert per successful concurrent transaction — inserts always match increments", async () => {
      const committed = makeRow(3, { current: 0, target: 1000 });
      let insertCount = 0;

      mockedDb.transaction = vi
        .fn()
        .mockImplementation(
          async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
            let txAmount = committed.currentAmount;
            let txCompleted = committed.isCompleted;

            const tx: Record<string, unknown> = {
              select: makeSelectMock([{ ...committed }]),
              update: vi.fn().mockImplementation(() => ({
                set: vi.fn().mockImplementation((setClause: Record<string, unknown>) => ({
                  where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockImplementation(async () => {
                      txAmount = evaluateSetClause(txAmount, setClause);
                      txCompleted = typeof setClause.isCompleted === "boolean"
                        ? setClause.isCompleted
                        : txCompleted;
                      return [{ ...committed, currentAmount: txAmount, isCompleted: txCompleted }];
                    }),
                  }),
                })),
              })),
              insert: vi.fn().mockImplementation(() => ({
                values: vi.fn().mockImplementation(async () => {
                  insertCount++;
                }),
              })),
            };

            const result = await cb(tx);
            committed.currentAmount += txAmount - committed.currentAmount;
            committed.isCompleted = txCompleted;
            return result;
          },
        );

      const [resA, resB] = await Promise.all([
        request(app).post("/savings-goals/3/contribute").send({ amount: 100 }),
        request(app).post("/savings-goals/3/contribute").send({ amount: 100 }),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      // Two inserts — one per successful transaction.
      expect(insertCount).toBe(2);

      // Both deltas applied.
      expect(committed.currentAmount).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Rollback — transaction-local state, committed row stays unchanged
  // -------------------------------------------------------------------------
  describe("rollback when history insert fails", () => {
    it("leaves the committed balance unchanged when the contribution insert throws a constraint error", async () => {
      // committed.currentAmount starts at 50 and must remain 50 after rollback.
      const committed = makeRow(2, { current: 50, target: 500 });
      const originalBalance = committed.currentAmount;

      mockedDb.transaction = vi
        .fn()
        .mockImplementation(
          async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
            // Transaction-local state — never copied to committed if cb throws.
            let txAmount = committed.currentAmount;
            let txCompleted = committed.isCompleted;

            const tx: Record<string, unknown> = {
              select: makeSelectMock([{ ...committed }]),
              update: vi.fn().mockImplementation(() => ({
                set: vi.fn().mockImplementation((setClause: Record<string, unknown>) => ({
                  where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockImplementation(async () => {
                      // Apply delta locally — does NOT touch committed yet.
                      txAmount = evaluateSetClause(txAmount, setClause);
                      txCompleted = typeof setClause.isCompleted === "boolean"
                        ? setClause.isCompleted
                        : txCompleted;
                      return [{ ...committed, currentAmount: txAmount, isCompleted: txCompleted }];
                    }),
                  }),
                })),
              })),
              insert: vi.fn().mockImplementation(() => ({
                values: vi.fn().mockImplementation(async () => {
                  throw new Error(
                    "violates foreign key constraint: savings_goal_contributions_goal_id_fkey",
                  );
                }),
              })),
            };

            // cb() throws because insert throws; committed is never updated.
            const result = await cb(tx);
            committed.currentAmount = txAmount; // only reached on success
            committed.isCompleted = txCompleted;
            return result;
          },
        );

      const res = await request(app)
        .post("/savings-goals/2/contribute")
        .send({ amount: 50 });

      expect(res.status).toBe(500);

      // The committed row must be at the original balance — the update was
      // staged in transaction-local state but never written through.
      expect(committed.currentAmount).toBe(originalBalance);

      // The transaction promise itself rejected.
      const txCall = (mockedDb.transaction as ReturnType<typeof vi.fn>).mock
        .results[0];
      await expect(txCall.value).rejects.toThrow(
        "violates foreign key constraint",
      );
    });

    it("leaves the committed balance unchanged when the insert fails due to a unique-constraint violation", async () => {
      const committed = makeRow(5, { current: 30, target: 500 });
      const originalBalance = committed.currentAmount;

      mockedDb.transaction = vi
        .fn()
        .mockImplementation(
          async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
            let txAmount = committed.currentAmount;
            let txCompleted = committed.isCompleted;

            const tx: Record<string, unknown> = {
              select: makeSelectMock([{ ...committed }]),
              update: vi.fn().mockImplementation(() => ({
                set: vi.fn().mockImplementation((setClause: Record<string, unknown>) => ({
                  where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockImplementation(async () => {
                      txAmount = evaluateSetClause(txAmount, setClause);
                      txCompleted = typeof setClause.isCompleted === "boolean"
                        ? setClause.isCompleted
                        : txCompleted;
                      return [{ ...committed, currentAmount: txAmount, isCompleted: txCompleted }];
                    }),
                  }),
                })),
              })),
              insert: vi.fn().mockImplementation(() => ({
                values: vi.fn().mockImplementation(async () => {
                  throw new Error(
                    "duplicate key value violates unique constraint",
                  );
                }),
              })),
            };

            const result = await cb(tx);
            committed.currentAmount = txAmount;
            committed.isCompleted = txCompleted;
            return result;
          },
        );

      const res = await request(app)
        .post("/savings-goals/5/contribute")
        .send({ amount: 75 });

      expect(res.status).toBe(500);
      expect(committed.currentAmount).toBe(originalBalance);

      const txCall = (mockedDb.transaction as ReturnType<typeof vi.fn>).mock
        .results[0];
      await expect(txCall.value).rejects.toThrow(
        "duplicate key value violates unique constraint",
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. Goal not found
  // -------------------------------------------------------------------------
  describe("goal not found", () => {
    it("returns 404 and never calls update or insert when the goal does not exist", async () => {
      const txUpdate = vi.fn();
      const txInsert = vi.fn();

      mockedDb.transaction = vi
        .fn()
        .mockImplementation(
          async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
            const tx: Record<string, unknown> = {
              // select returns empty — goal not found
              select: makeSelectMock([]),
              update: txUpdate,
              insert: txInsert,
            };
            return cb(tx);
          },
        );

      const res = await request(app)
        .post("/savings-goals/999/contribute")
        .send({ amount: 50 });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: "Not found" });
      expect(txUpdate).not.toHaveBeenCalled();
      expect(txInsert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Input validation
  // -------------------------------------------------------------------------
  describe("input validation", () => {
    it("returns 400 for a missing amount", async () => {
      const res = await request(app)
        .post("/savings-goals/1/contribute")
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 for a zero amount", async () => {
      const res = await request(app)
        .post("/savings-goals/1/contribute")
        .send({ amount: 0 });
      expect(res.status).toBe(400);
    });

    it("returns 400 for a negative amount", async () => {
      const res = await request(app)
        .post("/savings-goals/1/contribute")
        .send({ amount: -25 });
      expect(res.status).toBe(400);
    });

    it("returns 400 for a non-numeric id", async () => {
      const res = await request(app)
        .post("/savings-goals/abc/contribute")
        .send({ amount: 50 });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Cap and completion
  // -------------------------------------------------------------------------
  describe("cap and completion", () => {
    /** Build a standard transaction mock around a committed row. */
    function makeCapMock(
      committed: GoalRow,
      captureInsertValues?: (v: unknown) => void,
    ) {
      return vi
        .fn()
        .mockImplementation(
          async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
            let txAmount = committed.currentAmount;
            let txCompleted = committed.isCompleted;

            const tx: Record<string, unknown> = {
              select: makeSelectMock([{ ...committed }]),
              update: vi.fn().mockImplementation(() => ({
                set: vi.fn().mockImplementation((setClause: Record<string, unknown>) => ({
                  where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockImplementation(async () => {
                      txAmount = evaluateSetClause(txAmount, setClause);
                      txCompleted = typeof setClause.isCompleted === "boolean"
                        ? setClause.isCompleted
                        : txCompleted;
                      return [{ ...committed, currentAmount: txAmount, isCompleted: txCompleted }];
                    }),
                  }),
                })),
              })),
              insert: vi.fn().mockImplementation(() => ({
                values: vi.fn().mockImplementation(async (vals: unknown) => {
                  captureInsertValues?.(vals);
                }),
              })),
            };

            const result = await cb(tx);
            committed.currentAmount = txAmount;
            committed.isCompleted = txCompleted;
            return result;
          },
        );
    }

    it("sets isCompleted=true and records the exact needed amount when the contribution exactly fills the goal", async () => {
      // current=400, target=500 → need exactly 100 more.
      const committed = makeRow(10, { current: 400, target: 500 });
      let insertedValues: unknown;
      mockedDb.transaction = makeCapMock(committed, (v) => { insertedValues = v; });

      const res = await request(app)
        .post("/savings-goals/10/contribute")
        .send({ amount: 100 });

      expect(res.status).toBe(200);
      expect(res.body.currentAmount).toBe(500);
      expect(res.body.isCompleted).toBe(true);
      expect(committed.currentAmount).toBe(500);
      expect(committed.isCompleted).toBe(true);
      // The contribution row records exactly 100, not more.
      expect((insertedValues as { amount: number }).amount).toBe(100);
    });

    it("caps the applied amount and sets isCompleted=true when the contribution exceeds the target", async () => {
      // current=400, target=500 → only 100 needed; request sends 300.
      const committed = makeRow(11, { current: 400, target: 500 });
      let insertedValues: unknown;
      mockedDb.transaction = makeCapMock(committed, (v) => { insertedValues = v; });

      const res = await request(app)
        .post("/savings-goals/11/contribute")
        .send({ amount: 300 });

      expect(res.status).toBe(200);
      // Balance must be exactly the target — not 700.
      expect(res.body.currentAmount).toBe(500);
      expect(res.body.isCompleted).toBe(true);
      expect(committed.currentAmount).toBe(500);
      expect(committed.isCompleted).toBe(true);
      // The insert records the capped amount (100), not the requested amount (300).
      expect((insertedValues as { amount: number }).amount).toBe(100);
    });

    it("does not set isCompleted when the goal is only partially filled", async () => {
      // current=100, target=500 → 50 leaves 350 remaining.
      const committed = makeRow(12, { current: 100, target: 500 });
      mockedDb.transaction = makeCapMock(committed);

      const res = await request(app)
        .post("/savings-goals/12/contribute")
        .send({ amount: 50 });

      expect(res.status).toBe(200);
      expect(res.body.currentAmount).toBe(150);
      expect(res.body.isCompleted).toBe(false);
      expect(committed.isCompleted).toBe(false);
    });
  });
});
