/**
 * Unit tests for POST /savings-goals/cascade-contribute
 *
 * Strategy: mock @workspace/db so that:
 *   - db.transaction() executes the callback with a mock tx
 *   - tx.select() returns the goals provided to makeTx (simulating FOR UPDATE)
 *
 * Because eq/sql/desc are imported directly from drizzle-orm (not from
 * @workspace/db), only the db object and table proxies need to be mocked.
 * The real drizzle helpers run unchanged inside the handler.
 *
 * Goal selection now happens INSIDE the transaction (via tx.select with
 * FOR UPDATE locking) so tests wire goals through the tx mock, not db.select.
 *
 * The concurrent test uses a shared committed-state object that both
 * transactions read from and write to, asserting the cross-request invariant:
 * total contributions per goal ≤ each goal's remaining capacity.
 *
 * The rollback test verifies that when the callback throws, the shared
 * committed state is completely unchanged — not just that a mock rejected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Mock @workspace/db — vi.mock is hoisted so the factory must not reference
// variables declared in module scope.  We define stubs inline here.
// NOTE: eq/sql/desc come from drizzle-orm directly; mocking them here has no
// effect on the handler.  Only the db object and table proxies are needed.
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
    sql: vi.fn(),
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
    targetAmount: opts.target ?? 100,
    isCompleted: false,
    deadline: null,
    createdByUserId: 1,
    createdAt: new Date("2024-01-01"),
  };
}

/**
 * Create a fluent SELECT mock chain that resolves to `result`.
 * Supports all call patterns used by the cascade-contribute handler:
 *   await tx.select().from().where().for("update")
 *   await tx.select().from().where().orderBy().for("update")
 * The chain itself is also thenable so bare `await chain` resolves to `result`
 * (used by other routes in the same router file).
 */
function makeSelectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  // orderBy returns the chain (not a resolved Promise) so .for() can be
  // chained after it.
  chain.orderBy = vi.fn().mockReturnValue(chain);
  // .for("update") is the terminal call in the cascade-contribute handler.
  chain.for = vi.fn().mockResolvedValue(result);
  // Make the chain itself thenable so `await chain` resolves to result
  // when neither .for() nor .orderBy() is the terminal call.
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  chain.catch = (reject: (r: unknown) => unknown) =>
    Promise.resolve(result).catch(reject as never);
  chain.finally = (cb: () => void) => Promise.resolve(result).finally(cb);
  return chain;
}

/**
 * Build a mock `tx` where:
 *  - tx.select()…  returns `goals` (simulates FOR UPDATE snapshot)
 *  - tx.update().set().where().returning() resolves to [updatedGoal] in
 *    index order — the handler processes goals in the same order SELECT
 *    returns them, so the index approach is correct and avoids parsing the
 *    real drizzle WhereExpression (which is NOT the mock's { _eq } shape).
 *  - tx.insert().values() behaves as configured by `insertImpl`
 */
function makeTx(
  goals: ReturnType<typeof makeGoal>[],
  updatedGoals: ReturnType<typeof makeGoal>[],
  insertImpl: () => Promise<void> = () => Promise.resolve(),
) {
  let updateCallIndex = 0;
  const tx: Record<string, unknown> = {};

  // Goal reads now happen inside the transaction via tx.select.
  tx.select = vi.fn().mockImplementation(() => makeSelectChain(goals));

  tx.update = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(async () => {
          const g =
            updatedGoals[updateCallIndex] ?? updatedGoals.at(-1)!;
          updateCallIndex++;
          return [g];
        }),
      }),
    }),
  }));

  tx.insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation(insertImpl),
  }));

  return tx;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Opaque mock-tx type used to break the self-referential `typeof tx` cycle. */
type MockTx = Record<string, unknown>;

/** Narrow view of db that lets us re-assign transaction per test. */
type MockableDb = {
  select: ((...args: unknown[]) => unknown) & { mockReturnValue: (v: unknown) => void };
  transaction: ((cb: (tx: MockTx) => Promise<unknown>) => Promise<unknown>) & {
    mock: { results: Array<{ type: string; value: unknown }> };
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /savings-goals/cascade-contribute", () => {
  const app = buildApp();
  // Cast through unknown to avoid the type overlap error — the vi.mock factory
  // above replaces the real db implementation with plain vi.fn() stubs.
  const mockedDb = db as unknown as MockableDb;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  it("writes all goal updates and contribution rows when the full cascade succeeds", async () => {
    const goal1 = makeGoal(1, { current: 0, target: 100 });
    const goal2 = makeGoal(2, { current: 50, target: 200 });
    const updated1 = { ...goal1, currentAmount: 100, isCompleted: true };
    const updated2 = { ...goal2, currentAmount: 200, isCompleted: true };

    const tx = makeTx([goal1, goal2], [updated1, updated2]);
    mockedDb.transaction = vi.fn().mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .post("/savings-goals/cascade-contribute")
      .send({ amount: 250 });

    expect(res.status).toBe(200);

    // Both goals received an allocation.
    expect(res.body.allocations).toHaveLength(2);
    expect(res.body.allocations[0]).toMatchObject({
      goalId: 1,
      allocated: 100,
      completed: true,
    });
    expect(res.body.allocations[1]).toMatchObject({
      goalId: 2,
      allocated: 150,
    });
    expect(res.body.leftover).toBe(0);

    // One update and one contribution insert were issued per goal.
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(tx.insert).toHaveBeenCalledTimes(2);
  });

  it("returns leftover when total amount exceeds all goals' remaining need", async () => {
    const goal1 = makeGoal(1, { current: 80, target: 100 });
    const updated1 = { ...goal1, currentAmount: 100, isCompleted: true };

    const tx = makeTx([goal1], [updated1]);
    mockedDb.transaction = vi.fn().mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .post("/savings-goals/cascade-contribute")
      .send({ amount: 50 });

    expect(res.status).toBe(200);
    // Only 20 was needed; 30 remains.
    expect(res.body.leftover).toBe(30);
    expect(res.body.allocations[0].allocated).toBe(20);
  });

  it("respects explicit goalIds ordering", async () => {
    // goalIds = [2, 1] — goal 2 should be funded first even though goal 1
    // was created earlier.
    const goal1 = makeGoal(1, { current: 0, target: 100 });
    const goal2 = makeGoal(2, { current: 0, target: 100 });
    const updated2 = { ...goal2, currentAmount: 100, isCompleted: true };
    const updated1 = { ...goal1, currentAmount: 100, isCompleted: true };

    // The goalIds path calls tx.select().from().where().for("update"),
    // returning all incomplete goals; the handler then reorders by goalIds.
    const tx = makeTx([goal1, goal2], [updated2, updated1]);
    mockedDb.transaction = vi.fn().mockImplementation(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx));

    const res = await request(app)
      .post("/savings-goals/cascade-contribute")
      .send({ amount: 200, goalIds: [2, 1] });

    expect(res.status).toBe(200);
    expect(res.body.allocations[0].goalId).toBe(2);
    expect(res.body.allocations[1].goalId).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Concurrent requests — shared committed state
  // -------------------------------------------------------------------------
  it("total contributions per goal never exceed its remaining capacity across two concurrent requests", async () => {
    /**
     * Shared committed database state — both transactions read from and write
     * to the same object.  This simulates the serialization that FOR UPDATE
     * produces in a real Postgres transaction:
     *
     *   - The first transaction locks the rows, allocates, then commits,
     *     updating committedGoals.
     *   - The second transaction reads the now-updated committedGoals before
     *     allocating, so it only funds whatever room is left.
     *
     * Key invariant under test: totalFunded[goalId] ≤ targetAmount for every
     * goal, regardless of how the two requests interleave.
     *
     * IMPORTANT: the returning() mock here uses an index-based approach rather
     * than parsing the real drizzle WhereExpression (eq/where args use the
     * real drizzle implementation, not the mock's { _eq } shape, so parsing
     * the where clause would yield undefined).
     */
    type GoalRow = ReturnType<typeof makeGoal>;

    const committedGoals: Record<string, GoalRow> = {
      "1": makeGoal(1, { current: 0, target: 100 }),
      "2": makeGoal(2, { current: 0, target: 100 }),
    };
    const committedContributions: { goalId: number; amount: number }[] = [];

    mockedDb.transaction = vi.fn().mockImplementation(
      async (cb: (tx: MockTx) => Promise<unknown>) => {
        // Snapshot current committed state — analogous to acquiring a FOR UPDATE
        // lock and reading the rows at that serialization point.
        const snapshotGoals: GoalRow[] = Object.values(committedGoals)
          .filter((g) => !g.isCompleted)
          .map((g) => ({ ...g }));

        const stagingContributions: { goalId: number; amount: number }[] = [];
        let returnIdx = 0;

        const tx: MockTx = {
          select: vi.fn().mockImplementation(() =>
            makeSelectChain(snapshotGoals),
          ),
          // Index-based returning() — avoids parsing the real drizzle where
          // expression which does not have the mock's { _eq } shape.
          update: vi.fn().mockImplementation(() => ({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockImplementation(async () => {
                  const goal = snapshotGoals[returnIdx++];
                  return goal ? [{ ...goal }] : [];
                }),
              }),
            }),
          })),
          insert: vi.fn().mockImplementation(() => ({
            values: vi.fn().mockImplementation(async (vals: any) => {
              const goalId: number = vals.goalId;
              const amount: number = vals.amount;
              stagingContributions.push({ goalId, amount });
              // Apply balance change to snapshotGoals for within-tx consistency
              // so the handler's "needed" calculation for later goals in the
              // same transaction reflects prior allocations.
              const idx = snapshotGoals.findIndex((g) => g.id === goalId);
              if (idx !== -1) {
                snapshotGoals[idx] = {
                  ...snapshotGoals[idx],
                  currentAmount: snapshotGoals[idx].currentAmount + amount,
                  isCompleted:
                    snapshotGoals[idx].currentAmount + amount >=
                    snapshotGoals[idx].targetAmount,
                };
              }
            }),
          })),
        };

        // Run the transaction callback.
        const result = await cb(tx);

        // Commit: merge staging into committed state.
        for (const c of stagingContributions) {
          committedContributions.push(c);
          const key = String(c.goalId);
          committedGoals[key] = {
            ...committedGoals[key],
            currentAmount: committedGoals[key].currentAmount + c.amount,
            isCompleted:
              committedGoals[key].currentAmount + c.amount >=
              committedGoals[key].targetAmount,
          };
        }

        return result;
      },
    );

    // Fire two concurrent requests, each trying to fund 200 across the same goals.
    const [res1, res2] = await Promise.all([
      request(app)
        .post("/savings-goals/cascade-contribute")
        .send({ amount: 200 }),
      request(app)
        .post("/savings-goals/cascade-contribute")
        .send({ amount: 200 }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Aggregate committed contributions per goal across both transactions.
    const totalFundedByGoal: Record<number, number> = {};
    for (const c of committedContributions) {
      totalFundedByGoal[c.goalId] =
        (totalFundedByGoal[c.goalId] ?? 0) + c.amount;
    }

    // Core invariant: no goal is funded beyond its capacity.
    for (const [goalIdStr, totalFunded] of Object.entries(totalFundedByGoal)) {
      const goalId = Number(goalIdStr);
      expect(totalFunded).toBeLessThanOrEqual(
        committedGoals[goalId].targetAmount,
      );
    }

    // Every allocation in every response has a matching committed contribution row.
    for (const res of [res1, res2]) {
      for (const alloc of res.body.allocations) {
        const hasContribution = committedContributions.some(
          (c) => c.goalId === alloc.goalId && c.amount === alloc.allocated,
        );
        expect(hasContribution).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Failure / rollback scenario — committed state must be unchanged
  // -------------------------------------------------------------------------
  it("leaves committed state completely unchanged when a crash occurs mid-loop", async () => {
    /**
     * Three goals are in the cascade.  The crash happens on the SECOND insert
     * (after two goal updates have already run inside the transaction).
     *
     * Two invariants verified:
     *   1. The endpoint returns 500, not a partial 200.
     *   2. The shared committed state (both goal balances and contribution rows)
     *      is identical to what it was before the request — no partial write
     *      leaked out of the rolled-back transaction.
     */
    type GoalRow = ReturnType<typeof makeGoal>;

    const committedGoals: Record<string, GoalRow> = {
      "1": makeGoal(1, { current: 0, target: 100 }),
      "2": makeGoal(2, { current: 0, target: 100 }),
      "3": makeGoal(3, { current: 0, target: 100 }),
    };
    const committedContributions: { goalId: number; amount: number }[] = [];

    // Snapshot the initial balances so we can compare after the failed request.
    const initialGoalBalances = Object.fromEntries(
      Object.entries(committedGoals).map(([id, g]) => [id, g.currentAmount]),
    );

    const midLoopCrash = new Error("DB crash: insert failed mid-loop");
    let insertCalls = 0;
    let captureTx: MockTx | null = null;

    mockedDb.transaction = vi.fn().mockImplementation(
      async (cb: (tx: MockTx) => Promise<unknown>) => {
        const snapshotGoals: GoalRow[] = Object.values(committedGoals)
          .filter((g) => !g.isCompleted)
          .map((g) => ({ ...g }));

        const stagingContributions: { goalId: number; amount: number }[] = [];
        let returnIdx = 0;

        const tx: MockTx = {
          select: vi.fn().mockImplementation(() =>
            makeSelectChain(snapshotGoals),
          ),
          // Index-based returning() to avoid parsing the real drizzle where
          // expression (which is not the mock's { _eq } shape).
          update: vi.fn().mockImplementation(() => ({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockImplementation(async () => {
                  const goal = snapshotGoals[returnIdx++];
                  return goal ? [{ ...goal }] : [];
                }),
              }),
            }),
          })),
          insert: vi.fn().mockImplementation(() => ({
            values: vi.fn().mockImplementation(async (vals: any) => {
              insertCalls++;
              // Crash on the second insert — two goal updates have already run.
              if (insertCalls === 2) throw midLoopCrash;
              stagingContributions.push({
                goalId: vals.goalId,
                amount: vals.amount,
              });
            }),
          })),
        };

        captureTx = tx;

        // db.transaction re-throws when the callback throws — matching real
        // Postgres rollback semantics: COMMIT never executes.
        const result = await cb(tx);

        // Only reached on success — merge staging to committed.
        for (const c of stagingContributions) {
          committedContributions.push(c);
          committedGoals[String(c.goalId)].currentAmount += c.amount;
        }

        return result;
      },
    );

    const res = await request(app)
      .post("/savings-goals/cascade-contribute")
      .send({ amount: 300 });

    // 1. The endpoint must surface the error, not return partial success.
    expect(res.status).toBe(500);

    // 2. Two goal updates ran before the crash, but because the transaction
    //    threw, neither was committed — the committed state must be unchanged.
    expect(committedContributions).toHaveLength(0);
    for (const [id, initialBalance] of Object.entries(initialGoalBalances)) {
      expect(committedGoals[id].currentAmount).toBe(initialBalance);
    }

    // 3. Verify the transaction promise itself rejected (no COMMIT occurred).
    const txResult = (
      mockedDb.transaction as ReturnType<typeof vi.fn>
    ).mock.results[0];
    expect(txResult.type).toBe("return"); // returned a Promise
    await expect(txResult.value).rejects.toThrow(
      "DB crash: insert failed mid-loop",
    );

    // 4. Two updates ran (goal 1 and goal 2) before the crash.
    expect(captureTx!.update).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  it("returns 400 for a missing amount", async () => {
    const res = await request(app)
      .post("/savings-goals/cascade-contribute")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-positive amount", async () => {
    const res = await request(app)
      .post("/savings-goals/cascade-contribute")
      .send({ amount: -10 });
    expect(res.status).toBe(400);
  });
});
