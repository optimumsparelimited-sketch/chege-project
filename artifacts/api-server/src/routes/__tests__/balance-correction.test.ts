/**
 * Unit tests for PATCH /savings-goals/:id (balance correction path)
 *
 * Strategy: mock @workspace/db so that:
 *   - db.transaction() executes the callback with a mock tx
 *   - tx.select().from().where().for("update") returns the current goal row
 *   - tx.update().set().where().returning() returns the updated goal row
 *   - tx.insert().values() behaviour is configurable per test
 *
 * The failure test simulates a crash (tx.insert throws) after the goal row
 * has been updated inside the transaction.  Because db.transaction re-throws
 * when the callback throws (matching real Postgres rollback semantics), the
 * goal update is rolled back — no partial state is persisted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Mock @workspace/db — vi.mock is hoisted so the factory must not reference
// variables declared in module scope.  We define stubs inline here.
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
// Helpers
// ---------------------------------------------------------------------------

/** Build a goal row as the handler's SELECT returns it. */
function makeGoal(
  id: number,
  opts: { current?: number; target?: number; name?: string } = {},
) {
  return {
    id,
    name: opts.name ?? `Goal ${id}`,
    currentAmount: opts.current ?? 0,
    targetAmount: opts.target ?? 500,
    isCompleted: false,
    deadline: null,
    createdByUserId: 1,
    createdAt: new Date("2024-01-01"),
  };
}

/**
 * Build a mock `tx` suitable for the PATCH handler's transaction body:
 *
 *   tx.select().from().where().for("update")  → [existingGoal]
 *   tx.update().set().where().returning()      → [updatedGoal]
 *   tx.insert().values()                       → controlled by insertImpl
 */
function makePatchTx(
  existingGoal: ReturnType<typeof makeGoal>,
  updatedGoal: ReturnType<typeof makeGoal>,
  insertImpl: () => Promise<void> = () => Promise.resolve(),
) {
  const tx: Record<string, unknown> = {};

  // tx.select() chain: supports .from().where().for()
  tx.select = vi.fn().mockImplementation(() => {
    const forChain = { for: vi.fn().mockResolvedValue([existingGoal]) };
    const whereChain = { where: vi.fn().mockReturnValue(forChain) };
    const fromChain = { from: vi.fn().mockReturnValue(whereChain) };
    return fromChain;
  });

  // tx.update() chain: .set().where().returning()
  tx.update = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([updatedGoal]),
      }),
    }),
  }));

  // tx.insert() chain: .values()
  tx.insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation(insertImpl),
  }));

  return tx;
}

/** Narrow view of db that lets us re-assign transaction per test. */
type MockTx = Record<string, unknown>;
type MockableDb = {
  select: ((...args: unknown[]) => unknown) & { mockReturnValue: (v: unknown) => void };
  transaction: ((cb: (tx: MockTx) => Promise<unknown>) => Promise<unknown>) & {
    mock: { results: Array<{ type: string; value: unknown }> };
  };
};

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
  // Happy path
  // -------------------------------------------------------------------------
  it("updates the goal balance and inserts a Manual adjustment contribution row on success", async () => {
    const existing = makeGoal(1, { current: 200, target: 500 });
    // currentAmount sent in body = 300 → delta = +100
    const updated = makeGoal(1, { current: 300, target: 500 });

    const tx = makePatchTx(existing, updated);
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: 300 });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.currentAmount).toBe(300);

    // Both the goal update and the contribution insert must have been called.
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(1);

    // The insert must carry the "Manual adjustment" note.
    const insertArg = (tx.insert as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(
      (insertArg.values as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({ note: "Manual adjustment", amount: 100 });
  });

  it("does NOT insert a contribution row when currentAmount is unchanged (delta = 0)", async () => {
    const existing = makeGoal(1, { current: 200, target: 500 });
    const updated = makeGoal(1, { current: 200, target: 500 });

    const tx = makePatchTx(existing, updated);
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: 200 }); // same value — delta is 0

    expect(res.status).toBe(200);
    // No contribution row should be written for a zero-delta correction.
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("updates non-balance fields without inserting a contribution row", async () => {
    const existing = makeGoal(1, { current: 200, target: 500, name: "Old name" });
    const updated = makeGoal(1, { current: 200, target: 500, name: "New name" });

    const tx = makePatchTx(existing, updated);
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ name: "New name" });

    expect(res.status).toBe(200);
    // A name-only update must not write a contribution row.
    expect(tx.insert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Failure / rollback scenario
  // -------------------------------------------------------------------------
  it("rolls back atomically when a crash occurs after the goal update but before the contribution insert", async () => {
    const existing = makeGoal(1, { current: 100, target: 500 });
    // delta = 150 (newAmount 250 − old 100)
    const updated = makeGoal(1, { current: 250, target: 500 });

    const crashError = new Error("DB crash: disk full mid-transaction");

    // tx.insert throws — simulating a server failure between the two writes.
    const tx = makePatchTx(existing, updated, async () => {
      throw crashError;
    });

    // db.transaction re-throws when its callback throws, matching real Postgres
    // rollback semantics: the goal update is never committed.
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: 250 });

    // The endpoint must NOT return 200 with partial data; it must surface the
    // error so the caller knows the operation failed.
    expect(res.status).toBe(500);

    // tx.update was called once (the goal amount was incremented in-flight),
    // but because the transaction threw, Postgres rolls back that write.
    expect(tx.update).toHaveBeenCalledTimes(1);

    // db.transaction itself rejected — no commit occurred.
    const transactionCall = (
      mockedDb.transaction as ReturnType<typeof vi.fn>
    ).mock.results[0];
    expect(transactionCall.type).toBe("return"); // returned a Promise (that rejected)
    await expect(transactionCall.value).rejects.toThrow(
      "DB crash: disk full mid-transaction",
    );
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  it("returns 400 when no updatable fields are provided", async () => {
    const res = await request(app).patch("/savings-goals/1").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(app)
      .patch("/savings-goals/abc")
      .send({ name: "X" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a negative targetAmount", async () => {
    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ targetAmount: -50 });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Large-correction safety guard
  // -------------------------------------------------------------------------
  it("returns 400 with a descriptive message when a correction wipes more than 50% of the balance and no reason is supplied", async () => {
    // balance = 200, new amount = 50 → delta = -150, which is 75% of 200
    const existing = makeGoal(1, { current: 200, target: 500 });
    const updated = makeGoal(1, { current: 50, target: 500 });

    const tx = makePatchTx(existing, updated);
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: 50 }); // no reason field

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50%/i);
    // The update must NOT have been applied.
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("succeeds when the same large correction includes a reason field", async () => {
    // balance = 200, new amount = 50 → delta = -150 (>50%), but reason is provided
    const existing = makeGoal(1, { current: 200, target: 500 });
    const updated = makeGoal(1, { current: 50, target: 500 });

    const tx = makePatchTx(existing, updated);
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: 50, reason: "Emergency withdrawal approved" });

    expect(res.status).toBe(200);
    expect(res.body.currentAmount).toBe(50);
    // The goal update and the contribution insert both fired.
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(1);

    // The contribution note must be the caller-supplied reason, not the generic fallback.
    const insertArg = (tx.insert as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(
      (insertArg.values as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({ note: "Emergency withdrawal approved", amount: -150 });
  });

  it("falls back to 'Manual adjustment' note when no reason is supplied", async () => {
    // A normal (small) correction with no reason field — note must be the default fallback.
    const existing = makeGoal(1, { current: 100, target: 500 });
    const updated = makeGoal(1, { current: 120, target: 500 }); // delta = +20

    const tx = makePatchTx(existing, updated);
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: 120 }); // no reason field

    expect(res.status).toBe(200);
    expect(tx.insert).toHaveBeenCalledTimes(1);

    // Without a reason, the note must default to "Manual adjustment".
    const insertArg = (tx.insert as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(
      (insertArg.values as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({ note: "Manual adjustment", amount: 20 });
  });

  // -------------------------------------------------------------------------
  // Boundary tests — exactly 50% and 50% + 0.01
  // -------------------------------------------------------------------------
  it("allows a correction of exactly 50% of the balance without a reason", async () => {
    // balance = 200, new amount = 100 → delta = -100, which is exactly 50% of 200
    // The guard uses strict > so this must pass without a reason.
    const existing = makeGoal(1, { current: 200, target: 500 });
    const updated = makeGoal(1, { current: 100, target: 500 });

    const tx = makePatchTx(existing, updated);
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: 100 }); // no reason field — delta is exactly 50%

    expect(res.status).toBe(200);
    expect(res.body.currentAmount).toBe(100);
    // The correction must have been applied.
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when a correction exceeds 50% of the balance by just 0.01 and no reason is supplied", async () => {
    // balance = 200, new amount = 99.99 → delta = -100.01, which is 50% + 0.01 of 200
    // The guard uses strict > so this must be blocked without a reason.
    const existing = makeGoal(1, { current: 200, target: 500 });
    const updated = makeGoal(1, { current: 99.99, target: 500 });

    const tx = makePatchTx(existing, updated);
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: 99.99 }); // no reason field — delta just exceeds 50%

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50%/i);
    // The update must NOT have been applied.
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("does NOT trigger the large-correction guard when the current balance is 0", async () => {
    // previousAmount = 0: the guard must short-circuit on `previousAmount > 0`
    // so a positive correction from zero never requires a reason.
    const existing = makeGoal(1, { current: 0, target: 500 });
    const updated = makeGoal(1, { current: 100, target: 500 });

    const tx = makePatchTx(existing, updated);
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: 100 }); // no reason, delta is positive but guard irrelevant

    expect(res.status).toBe(200);
    expect(res.body.currentAmount).toBe(100);
  });

  // -------------------------------------------------------------------------
  // Negative-balance guard
  // -------------------------------------------------------------------------
  it("returns 400 with a clear message when currentAmount is set to a negative value", async () => {
    // A negative balance is nonsensical — the schema must reject it before the
    // transaction even starts, and the error message must be descriptive.
    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be negative/i);
  });

  it("allows setting currentAmount to exactly 0", async () => {
    // Zero is a valid balance (goal was emptied) — the guard must not block it.
    const existing = makeGoal(1, { current: 100, target: 500 });
    const updated = makeGoal(1, { current: 0, target: 500 }); // delta = -100 (100% wipe, needs reason)

    const tx = makePatchTx(existing, updated);
    mockedDb.transaction = vi
      .fn()
      .mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .patch("/savings-goals/1")
      .send({ currentAmount: 0, reason: "Goal reset to zero" }); // reason supplied for >50% wipe

    expect(res.status).toBe(200);
    expect(res.body.currentAmount).toBe(0);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });
});
