/**
 * Integration tests for POST /savings-goals/cascade-contribute
 *
 * These tests connect to a real Postgres database (via the shared
 * @workspace/db connection) so they can catch issues that the in-process
 * mock in cascade-contribute.test.ts cannot:
 *   • Postgres-level lock contention with FOR UPDATE across two concurrent
 *     cascade transactions — verifies no deadlock and correct accumulation
 *   • Serialisation of concurrent writes so no goal is over-funded
 *   • ORM or driver regressions that change actual SQL semantics
 *
 * The suite is skipped gracefully when DATABASE_URL is absent.
 *
 * Isolation strategy:
 *   • All imports of @workspace/db (which throws on load when DATABASE_URL is
 *     absent) are deferred to beforeAll via dynamic import so the module is
 *     never loaded in no-DB environments and describe.skipIf can act first.
 *   • A unique set of test goals is created in beforeAll and torn down in
 *     afterAll using a timestamp suffix to avoid collisions in parallel runs.
 *   • All contributions written by these tests are deleted as part of cleanup.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Skip the entire suite when no DATABASE_URL is configured.
// @workspace/db throws during module loading when DATABASE_URL is absent, so
// all imports that transitively touch it are deferred to beforeAll below.
// ---------------------------------------------------------------------------
const hasDb = !!process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Module-level variables populated lazily in beforeAll (only when hasDb).
// ---------------------------------------------------------------------------
type DbModule = typeof import("@workspace/db");
type RouterModule = typeof import("../savings-goals.js");

let db: DbModule["db"];
let pool: DbModule["pool"];
let savingsGoalsTable: DbModule["savingsGoalsTable"];
let savingsGoalContributionsTable: DbModule["savingsGoalContributionsTable"];
let usersTable: DbModule["usersTable"];
let eq: (typeof import("drizzle-orm"))["eq"];
let inArray: (typeof import("drizzle-orm"))["inArray"];

// ---------------------------------------------------------------------------
// App factory — accepts the router so it can be built after dynamic import.
// ---------------------------------------------------------------------------
const TEST_USER_ID = "integration-test-user-cascade";

function buildApp(savingsGoalsRouter: RouterModule["default"]) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: TEST_USER_ID };
    next();
  });
  app.use("/", savingsGoalsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe.skipIf(!hasDb)(
  "POST /savings-goals/cascade-contribute (integration — real Postgres)",
  () => {
    let app: ReturnType<typeof buildApp>;
    const testGoalIds: number[] = [];
    const ts = Date.now();

    beforeAll(async () => {
      // Dynamically import everything that touches @workspace/db so the
      // module is never loaded (and therefore never throws) when DATABASE_URL
      // is absent.  describe.skipIf prevents this beforeAll from running in
      // no-DB environments, so by the time we reach this point we know
      // DATABASE_URL is set.
      const dbModule = await import("@workspace/db");
      db = dbModule.db;
      pool = dbModule.pool;
      savingsGoalsTable = dbModule.savingsGoalsTable;
      savingsGoalContributionsTable = dbModule.savingsGoalContributionsTable;
      usersTable = dbModule.usersTable;

      const drizzle = await import("drizzle-orm");
      eq = drizzle.eq;
      inArray = drizzle.inArray;

      const routerModule = await import("../savings-goals.js");
      app = buildApp(routerModule.default);

      // Upsert a test user so FK constraints on createdByUserId are satisfied.
      await db
        .insert(usersTable)
        .values({ id: TEST_USER_ID, firstName: "Cascade", lastName: "Tester" })
        .onConflictDoNothing();

      // Create two isolated goals for the concurrent race test.
      const [goal1] = await db
        .insert(savingsGoalsTable)
        .values({
          name: `Cascade Integration Goal A ${ts}`,
          targetAmount: 1_000_000, // large so neither request caps out
          currentAmount: 0,
          createdByUserId: TEST_USER_ID,
          isCompleted: false,
        })
        .returning();

      const [goal2] = await db
        .insert(savingsGoalsTable)
        .values({
          name: `Cascade Integration Goal B ${ts}`,
          targetAmount: 1_000_000,
          currentAmount: 0,
          createdByUserId: TEST_USER_ID,
          isCompleted: false,
        })
        .returning();

      testGoalIds.push(goal1.id, goal2.id);
    });

    afterAll(async () => {
      if (testGoalIds.length > 0) {
        // Delete contributions first (FK child), then the goals.
        await db
          .delete(savingsGoalContributionsTable)
          .where(inArray(savingsGoalContributionsTable.goalId, testGoalIds));
        await db
          .delete(savingsGoalsTable)
          .where(inArray(savingsGoalsTable.id, testGoalIds));
      }

      // Clean up the test user.
      await db
        .delete(usersTable)
        .where(eq(usersTable.id, TEST_USER_ID));

      // End the connection pool so the Vitest worker process exits cleanly.
      await pool.end();
    });

    // -----------------------------------------------------------------------
    // Core race-condition test
    //
    // Two concurrent cascade-contribute requests target the same pair of goals.
    // The goals have a large target so neither request caps out, meaning each
    // request allocates its entire amount to the first listed goal.
    //
    // Without FOR UPDATE a client-side read-modify-write would allow both
    // transactions to read the same starting balance, compute the same delta,
    // and one UPDATE would silently overwrite the other — final balance would
    // equal one request's amount instead of two.
    //
    // The handler uses FOR UPDATE inside a transaction:
    //   1. The second transaction blocks on the row lock until the first commits.
    //   2. It then reads the freshly-committed balance.
    //   3. The SQL expression (currentAmount + allocated) accumulates both deltas.
    //
    // Key invariant: the DB balance for each funded goal must equal the total
    // of all contribution rows written by both requests.  A lost-update race
    // would leave the balance at a single request's allocation, not the sum.
    // -----------------------------------------------------------------------
    it(
      "both concurrent cascade requests accumulate correctly — DB balance equals sum of all contribution rows",
      async () => {
        const amountPerRequest = 5_000;

        const [res1, res2] = await Promise.all([
          request(app)
            .post("/savings-goals/cascade-contribute")
            .send({ amount: amountPerRequest, goalIds: testGoalIds }),
          request(app)
            .post("/savings-goals/cascade-contribute")
            .send({ amount: amountPerRequest, goalIds: testGoalIds }),
        ]);

        // Both requests must succeed without deadlock.
        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);

        // Neither cascade had leftover — both goals have plenty of room.
        expect(res1.body.leftover).toBe(0);
        expect(res2.body.leftover).toBe(0);

        // Collect every allocation reported across both responses.
        type Alloc = { goalId: number; allocated: number };
        const allAllocations: Alloc[] = [
          ...res1.body.allocations,
          ...res2.body.allocations,
        ];

        // Read the authoritative balances and contribution rows from Postgres.
        const goals = await db
          .select({ id: savingsGoalsTable.id, currentAmount: savingsGoalsTable.currentAmount })
          .from(savingsGoalsTable)
          .where(inArray(savingsGoalsTable.id, testGoalIds));

        const contributions = await db
          .select()
          .from(savingsGoalContributionsTable)
          .where(inArray(savingsGoalContributionsTable.goalId, testGoalIds));

        const balanceById: Record<number, number> = {};
        for (const g of goals) {
          balanceById[g.id] = g.currentAmount;
        }

        // Core invariant: for each goal that received an allocation, the DB
        // balance must equal the sum of contribution rows written to that goal.
        // A lost-update (non-atomic overwrite) would leave the balance at the
        // last-written value rather than the accumulated total.
        const allocatedByGoal: Record<number, number> = {};
        for (const alloc of allAllocations) {
          allocatedByGoal[alloc.goalId] = (allocatedByGoal[alloc.goalId] ?? 0) + alloc.allocated;
        }

        for (const [goalIdStr, totalAllocated] of Object.entries(allocatedByGoal)) {
          const goalId = Number(goalIdStr);
          expect(balanceById[goalId]).toBe(totalAllocated);
        }

        // Every allocation in every response must have a matching contribution row.
        for (const alloc of allAllocations) {
          const match = contributions.find(
            (c) => c.goalId === alloc.goalId && c.amount === alloc.allocated,
          );
          expect(match).toBeDefined();
        }

        // Contribution rows' total per goal must match the reported allocations.
        for (const goalId of testGoalIds) {
          const dbTotal = contributions
            .filter((c) => c.goalId === goalId)
            .reduce((sum, c) => sum + c.amount, 0);
          const allocTotal = allocatedByGoal[goalId] ?? 0;
          expect(dbTotal).toBe(allocTotal);
        }
      },
      // Allow up to 20 s for lock contention + round-trips across two goals.
      20_000,
    );

    // -----------------------------------------------------------------------
    // Leftover: when total amount exceeds all goals' remaining capacity the
    // handler returns a non-zero leftover without erroring.
    // -----------------------------------------------------------------------
    it(
      "returns a non-zero leftover when the payment exceeds all remaining capacity",
      async () => {
        // Create two nearly-full goals just for this test.
        const [gA] = await db
          .insert(savingsGoalsTable)
          .values({
            name: `Cascade Leftover A ${ts}`,
            targetAmount: 500,
            currentAmount: 480,
            createdByUserId: TEST_USER_ID,
            isCompleted: false,
          })
          .returning();

        const [gB] = await db
          .insert(savingsGoalsTable)
          .values({
            name: `Cascade Leftover B ${ts}`,
            targetAmount: 500,
            currentAmount: 480,
            createdByUserId: TEST_USER_ID,
            isCompleted: false,
          })
          .returning();

        try {
          // 200 available gap (2 × 20), but we send 300 — expect 260 leftover.
          const res = await request(app)
            .post("/savings-goals/cascade-contribute")
            .send({ amount: 300, goalIds: [gA.id, gB.id] });

          expect(res.status).toBe(200);
          // Each goal only had 20 of room; total capacity = 40, leftover = 260.
          expect(res.body.leftover).toBe(260);
          expect(res.body.allocations).toHaveLength(2);
          expect(res.body.allocations[0].allocated).toBe(20);
          expect(res.body.allocations[1].allocated).toBe(20);
          expect(res.body.allocations[0].completed).toBe(true);
          expect(res.body.allocations[1].completed).toBe(true);

          // Verify final balances in DB.
          const [refreshedA] = await db
            .select({ currentAmount: savingsGoalsTable.currentAmount, isCompleted: savingsGoalsTable.isCompleted })
            .from(savingsGoalsTable)
            .where(eq(savingsGoalsTable.id, gA.id));
          const [refreshedB] = await db
            .select({ currentAmount: savingsGoalsTable.currentAmount, isCompleted: savingsGoalsTable.isCompleted })
            .from(savingsGoalsTable)
            .where(eq(savingsGoalsTable.id, gB.id));

          expect(refreshedA.currentAmount).toBe(500);
          expect(refreshedA.isCompleted).toBe(true);
          expect(refreshedB.currentAmount).toBe(500);
          expect(refreshedB.isCompleted).toBe(true);
        } finally {
          await db
            .delete(savingsGoalContributionsTable)
            .where(inArray(savingsGoalContributionsTable.goalId, [gA.id, gB.id]));
          await db
            .delete(savingsGoalsTable)
            .where(inArray(savingsGoalsTable.id, [gA.id, gB.id]));
        }
      },
      15_000,
    );

    // -----------------------------------------------------------------------
    // goalIds ordering: when explicit goalIds are provided the waterfall
    // follows that order, not creation order.
    // -----------------------------------------------------------------------
    it(
      "respects explicit goalIds ordering — the first listed goal receives funds before the second",
      async () => {
        // Create two fresh goals for this isolated ordering test.
        const [gFirst] = await db
          .insert(savingsGoalsTable)
          .values({
            name: `Cascade Order First ${ts}`,
            targetAmount: 100,
            currentAmount: 0,
            createdByUserId: TEST_USER_ID,
            isCompleted: false,
          })
          .returning();

        const [gSecond] = await db
          .insert(savingsGoalsTable)
          .values({
            name: `Cascade Order Second ${ts}`,
            targetAmount: 100,
            currentAmount: 0,
            createdByUserId: TEST_USER_ID,
            isCompleted: false,
          })
          .returning();

        try {
          // Send exactly 100 — enough to fill only the first goal in the list.
          // Pass goalIds with gSecond first to verify the handler respects it.
          const res = await request(app)
            .post("/savings-goals/cascade-contribute")
            .send({ amount: 100, goalIds: [gSecond.id, gFirst.id] });

          expect(res.status).toBe(200);
          expect(res.body.allocations).toHaveLength(1);
          // gSecond must have been funded first (it was listed first).
          expect(res.body.allocations[0].goalId).toBe(gSecond.id);
          expect(res.body.allocations[0].allocated).toBe(100);
          expect(res.body.leftover).toBe(0);

          const [refreshedSecond] = await db
            .select({ currentAmount: savingsGoalsTable.currentAmount })
            .from(savingsGoalsTable)
            .where(eq(savingsGoalsTable.id, gSecond.id));
          const [refreshedFirst] = await db
            .select({ currentAmount: savingsGoalsTable.currentAmount })
            .from(savingsGoalsTable)
            .where(eq(savingsGoalsTable.id, gFirst.id));

          expect(refreshedSecond.currentAmount).toBe(100);
          expect(refreshedFirst.currentAmount).toBe(0);
        } finally {
          await db
            .delete(savingsGoalContributionsTable)
            .where(inArray(savingsGoalContributionsTable.goalId, [gFirst.id, gSecond.id]));
          await db
            .delete(savingsGoalsTable)
            .where(inArray(savingsGoalsTable.id, [gFirst.id, gSecond.id]));
        }
      },
      15_000,
    );
  },
);
