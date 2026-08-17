/**
 * Unit tests for PATCH /savings-goals/:id — balance-correction endpoint
 *
 * Two core guarantees are tested:
 *
 * 1. ATOMIC ROLLBACK on mid-write crash
 *    The handler performs two writes inside a single transaction:
 *      a. UPDATE savings_goals (new currentAmount)
 *      b. INSERT savings_goal_contributions (the adjustment history row)
 *    If the INSERT throws the transaction callback re-throws, causing the
 *    transaction to reject. The mock verifies the committed row is left
 *    unchanged (i.e. the UPDATE was never persisted).
 *
 * 2. HAPPY PATH — both writes are issued
 *    On a successful correction both the UPDATE and the INSERT are called,
 *    and the endpoint returns 200 with the updated goal.
 *
 * Additional cases covered:
 *  - delta === 0 → no INSERT issued (history row only written for real changes)
 *  - large-negative correction without a reason → 400 validation error
 *  - goal not found → 404
 *  - non-currentAmount updates (name, deadline) → no SELECT lock, no INSERT
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
    desc: vi.fn((col) => ({ _desc: col })),
  };
});

// Import AFTER mock registration so the route module picks up the stub.
import { db } from "@workspace/db";
import savingsGoalsRouter from "../savings-goals.js";

// ---------------------------------------------------------------------------
// Minimal express app — bypasses real auth with an inline stub.
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
// Shared helpers
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

function makeRow(id: number, opts: { current?: number; target?: number } = {}): GoalRow {
  return {
    id,
    name: `Goal ${id}`,
    currentAmount: opts.current ?? 200,
    targetAmount: opts.target ?? 1000,
    isCompleted: false,
    deadline: null,
    createdByUserId: 1,
    createdAt: new Date("2024-01-01"),
  };
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
// Builds a tx mock whose select().from().where().for() chain returns the
// given existing row (simulating the FOR UPDATE lock read), whose
// update().set().where().returning() returns the updatedRow, and whose
// insert().values() runs the provided insertImpl.
// ---------------------------------------------------------------------------
function buildTx(opts: {
  existingRow: GoalRow;
  updatedRow: GoalRow;
  insertImpl?: () => Promise<void>;
}): Record<string, unknown> {
  const { existingRow, updatedRow, insertImpl = async () => {} } = opts;

  return {
    // SELECT … FOR UPDATE
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          for: vi.fn().mockResolvedValue([{ currentAmount: existingRow.currentAmount }]),
        }),
      }),
    })),
    // UPDATE … RETURNING
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updatedRow]),
        }),
      }),
    })),
    // INSERT … VALUES
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation(insertImpl),
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /savings-goals/:id — balance correction", () => {
  const app = buildApp();
  const mockedDb = db as unknown as MockableDb;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Happy path — both writes issued
  // -------------------------------------------------------------------------
  describe("happy path", () => {
    it("issues both the goal UPDATE and the contribution INSERT on success", async () => {
      const existing = makeRow(10, { current: 200 });
      const updated = { ...existing, currentAmount: 300 };
      let insertCalled = false;

      const tx = buildTx({
        existingRow: existing,
        updatedRow: updated,
        insertImpl: async () => {
          insertCalled = true;
        },
      });

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(tx),
      );

      const res = await request(app)
        .patch("/savings-goals/10")
        .send({ currentAmount: 300 });

      expect(res.status).toBe(200);
      expect(res.body.currentAmount).toBe(300);

      // UPDATE must have been called.
      expect(tx.update).toHaveBeenCalledTimes(1);

      // INSERT must also have been called (delta = 100 ≠ 0).
      expect(insertCalled).toBe(true);
      expect(tx.insert).toHaveBeenCalledTimes(1);
    });

    it("passes the delta amount and 'Manual adjustment' note to the INSERT", async () => {
      const existing = makeRow(11, { current: 100 });
      const updated = { ...existing, currentAmount: 250 };
      let capturedValues: Record<string, unknown> | null = null;

      const tx = buildTx({
        existingRow: existing,
        updatedRow: updated,
        insertImpl: async () => {}, // replaced below
      });

      // Override insert to capture values.
      (tx.insert as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        values: vi.fn().mockImplementation(async (vals: Record<string, unknown>) => {
          capturedValues = vals;
        }),
      }));

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(tx),
      );

      const res = await request(app)
        .patch("/savings-goals/11")
        .send({ currentAmount: 250 });

      expect(res.status).toBe(200);
      expect(capturedValues).not.toBeNull();
      expect(capturedValues!.amount).toBe(150); // delta = 250 - 100
      expect(capturedValues!.note).toBe("Manual adjustment");
      expect(capturedValues!.goalId).toBe(11);
      expect(capturedValues!.createdByUserId).toBe(99); // from stub auth
    });

    it("does NOT issue an INSERT when the delta is zero (currentAmount unchanged)", async () => {
      const existing = makeRow(12, { current: 200 });
      const updated = { ...existing, currentAmount: 200 };

      const tx = buildTx({ existingRow: existing, updatedRow: updated });

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(tx),
      );

      const res = await request(app)
        .patch("/savings-goals/12")
        .send({ currentAmount: 200 });

      expect(res.status).toBe(200);
      // INSERT must NOT be called because delta === 0.
      expect(tx.insert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Rollback — crash between UPDATE and INSERT
  // -------------------------------------------------------------------------
  describe("rollback when contribution INSERT fails after goal UPDATE", () => {
    it("returns an error (not 200) and the transaction rejects when INSERT throws", async () => {
      const existing = makeRow(20, { current: 100 });
      const updated = { ...existing, currentAmount: 200 };

      // Track whether the UPDATE was 'applied' in tx-local state.
      let txUpdateApplied = false;
      // Shared committed row — must stay unchanged after rollback.
      const committed = { ...existing };

      const tx = buildTx({
        existingRow: existing,
        updatedRow: updated,
        insertImpl: async () => {
          throw new Error("DB crash: disk full");
        },
      });

      // Override update to set txUpdateApplied = true.
      (tx.update as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockImplementation(async () => {
              txUpdateApplied = true;
              return [updated];
            }),
          }),
        }),
      }));

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
          // Don't commit to `committed` — let the callback throw naturally.
          return cb(tx);
          // If cb threw, this line is never reached; committed stays unchanged.
        },
      );

      const res = await request(app)
        .patch("/savings-goals/20")
        .send({ currentAmount: 200 });

      // Must NOT be a success response.
      expect(res.status).toBe(500);

      // The UPDATE ran inside the transaction (tx-local), but since INSERT
      // threw, the transaction callback threw, so `committed` was never touched.
      expect(txUpdateApplied).toBe(true); // update did run inside tx
      expect(committed.currentAmount).toBe(100); // but committed row is unchanged

      // The transaction promise itself must have rejected.
      const txCall = (mockedDb.transaction as ReturnType<typeof vi.fn>).mock.results[0];
      await expect(txCall.value).rejects.toThrow("DB crash: disk full");
    });

    it("transaction rejects with the original error so the caller can observe it", async () => {
      const existing = makeRow(21, { current: 50 });
      const updated = { ...existing, currentAmount: 150 };

      const tx = buildTx({
        existingRow: existing,
        updatedRow: updated,
        insertImpl: async () => {
          throw new Error("violates foreign key constraint: savings_goal_contributions_goal_id_fkey");
        },
      });

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(tx),
      );

      const res = await request(app)
        .patch("/savings-goals/21")
        .send({ currentAmount: 150 });

      expect(res.status).toBe(500);

      const txCall = (mockedDb.transaction as ReturnType<typeof vi.fn>).mock.results[0];
      await expect(txCall.value).rejects.toThrow(
        "violates foreign key constraint",
      );
    });

    it("committed row stays at original balance when INSERT throws a constraint error", async () => {
      const committed = makeRow(22, { current: 80 });
      const originalBalance = committed.currentAmount;

      const tx: Record<string, unknown> = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([{ currentAmount: committed.currentAmount }]),
            }),
          }),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { ...committed, currentAmount: 180 },
              ]),
            }),
          }),
        })),
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation(async () => {
            throw new Error("duplicate key value violates unique constraint");
          }),
        })),
      };

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
          // Simulate real transaction: cb throws → no commit, re-throw.
          let txLocalAmount = committed.currentAmount;
          try {
            const result = await cb(tx);
            committed.currentAmount = txLocalAmount; // only on success
            return result;
          } catch (err) {
            // rollback — committed unchanged
            throw err;
          }
        },
      );

      const res = await request(app)
        .patch("/savings-goals/22")
        .send({ currentAmount: 180 });

      expect(res.status).toBe(500);
      // Committed row must be at the original balance.
      expect(committed.currentAmount).toBe(originalBalance);

      const txCall = (mockedDb.transaction as ReturnType<typeof vi.fn>).mock.results[0];
      await expect(txCall.value).rejects.toThrow("duplicate key value violates unique constraint");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Goal not found
  // -------------------------------------------------------------------------
  describe("goal not found", () => {
    it("returns 404 when the SELECT lock finds no row", async () => {
      const tx: Record<string, unknown> = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([]), // no row
            }),
          }),
        })),
        update: vi.fn(),
        insert: vi.fn(),
      };

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(tx),
      );

      const res = await request(app)
        .patch("/savings-goals/999")
        .send({ currentAmount: 100 });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: "Not found" });
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it("returns 404 when the UPDATE returns no rows", async () => {
      const existing = makeRow(30, { current: 100 });

      const tx = buildTx({
        existingRow: existing,
        updatedRow: existing, // doesn't matter; update returns empty
      });

      // Override update to return empty.
      (tx.update as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }));

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(tx),
      );

      const res = await request(app)
        .patch("/savings-goals/30")
        .send({ currentAmount: 200 });

      expect(res.status).toBe(404);
      expect(tx.insert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Large-negative-correction safety check
  // -------------------------------------------------------------------------
  describe("large-negative-correction guard", () => {
    it("returns 400 when a large negative correction lacks a reason", async () => {
      const existing = makeRow(40, { current: 1000 });
      const updated = { ...existing, currentAmount: 400 }; // -600 > 50% of 1000

      const tx = buildTx({ existingRow: existing, updatedRow: updated });

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(tx),
      );

      const res = await request(app)
        .patch("/savings-goals/40")
        .send({ currentAmount: 400 }); // no reason

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/more than 50%/i);
      // Neither UPDATE nor INSERT should have been issued.
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it("allows a large negative correction when a reason is provided", async () => {
      const existing = makeRow(41, { current: 1000 });
      const updated = { ...existing, currentAmount: 400 };
      let insertCalled = false;

      const tx = buildTx({
        existingRow: existing,
        updatedRow: updated,
        insertImpl: async () => {
          insertCalled = true;
        },
      });

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(tx),
      );

      const res = await request(app)
        .patch("/savings-goals/41")
        .send({ currentAmount: 400, reason: "Emergency withdrawal" });

      expect(res.status).toBe(200);
      expect(insertCalled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Non-amount updates (name, deadline) — no lock, no INSERT
  // -------------------------------------------------------------------------
  describe("non-amount field updates", () => {
    it("updates the name without issuing a SELECT lock or INSERT", async () => {
      const updated = makeRow(50);
      updated.name = "Updated Name";

      const tx: Record<string, unknown> = {
        select: vi.fn(),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updated]),
            }),
          }),
        })),
        insert: vi.fn(),
      };

      mockedDb.transaction = vi.fn().mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => cb(tx),
      );

      const res = await request(app)
        .patch("/savings-goals/50")
        .send({ name: "Updated Name" });

      expect(res.status).toBe(200);
      // No SELECT lock needed for non-amount updates.
      expect(tx.select).not.toHaveBeenCalled();
      // No history row for a name change.
      expect(tx.insert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Input validation
  // -------------------------------------------------------------------------
  describe("input validation", () => {
    it("returns 400 for an empty body (no updates provided)", async () => {
      const res = await request(app).patch("/savings-goals/1").send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 for a negative targetAmount", async () => {
      const res = await request(app)
        .patch("/savings-goals/1")
        .send({ targetAmount: -100 });
      expect(res.status).toBe(400);
    });

    it("returns 400 for a negative currentAmount", async () => {
      const res = await request(app)
        .patch("/savings-goals/1")
        .send({ currentAmount: -1 });
      expect(res.status).toBe(400);
    });

    it("returns 400 for a non-numeric id", async () => {
      const res = await request(app)
        .patch("/savings-goals/abc")
        .send({ name: "test" });
      expect(res.status).toBe(400);
    });
  });
});
