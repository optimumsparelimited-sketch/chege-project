/**
 * Integration tests for POST /savings-goals/:id/contribute
 *
 * These tests connect to a real Postgres database (via the shared
 * @workspace/db connection) so they can catch issues that the in-process
 * mock in contribute.test.ts cannot:
 *   • Postgres-level lock contention with FOR UPDATE
 *   • Serialisation failures / isolation-level edge cases
 *   • ORM or driver regressions that change actual SQL semantics
 *
 * The suite is skipped gracefully when DATABASE_URL is absent.
 * Note: if DATABASE_URL is not set, the @workspace/db import itself will
 * throw a clear "DATABASE_URL must be set" error before any test runs.
 *
 * Isolation strategy:
 *   • A unique test goal is created in beforeAll and torn down in afterAll.
 *   • The goal name includes Date.now() so parallel CI runs don't collide.
 *   • All contributions written by these tests are deleted as part of cleanup
 *     (the goal's cascade delete would also handle this, but we do it
 *     explicitly for clarity).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { db, pool, savingsGoalsTable, savingsGoalContributionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import savingsGoalsRouter from "../savings-goals.js";

// ---------------------------------------------------------------------------
// Skip the entire suite when no DATABASE_URL is configured.
// ---------------------------------------------------------------------------
const hasDb = !!process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Minimal Express app — same auth-bypass pattern as the unit test suite.
// ---------------------------------------------------------------------------
const TEST_USER_ID = "integration-test-user-contribute";

function buildApp() {
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
  "POST /savings-goals/:id/contribute (integration — real Postgres)",
  () => {
    const app = buildApp();
    let testGoalId: number;

    beforeAll(async () => {
      // Upsert a test user so FK constraints on createdByUserId are satisfied.
      await db
        .insert(usersTable)
        .values({ id: TEST_USER_ID, firstName: "Integration", lastName: "Test" })
        .onConflictDoNothing();

      // Create an isolated goal for this test run.
      const [goal] = await db
        .insert(savingsGoalsTable)
        .values({
          name: `Integration Test Goal ${Date.now()}`,
          targetAmount: 1_000_000, // large enough that no contribution caps out
          currentAmount: 0,
          createdByUserId: TEST_USER_ID,
          isCompleted: false,
        })
        .returning();

      testGoalId = goal.id;
    });

    afterAll(async () => {
      if (testGoalId) {
        // Delete contributions first (FK child), then the goal.
        await db
          .delete(savingsGoalContributionsTable)
          .where(eq(savingsGoalContributionsTable.goalId, testGoalId));
        await db
          .delete(savingsGoalsTable)
          .where(eq(savingsGoalsTable.id, testGoalId));
      }

      // Clean up the test user (ignore if not present).
      await db
        .delete(usersTable)
        .where(eq(usersTable.id, TEST_USER_ID));

      // End the connection pool so the Vitest worker process exits cleanly.
      await pool.end();
    });

    // -----------------------------------------------------------------------
    // Core race-condition test
    //
    // Two concurrent requests are fired at the same goal. If the handler uses
    // a client-side read-modify-write (fetch current + add locally + write back),
    // both requests would read the same starting balance and one update would
    // overwrite the other — final balance would equal one contribution, not two.
    //
    // The handler uses sql`currentAmount + ${amount}` inside a transaction
    // with a FOR UPDATE row lock, which means:
    //   1. The second transaction blocks on the lock until the first commits.
    //   2. After acquiring the lock it reads the freshly-committed balance.
    //   3. The SQL expression runs server-side, so both deltas accumulate.
    //
    // This test asserts the accumulated result, catching any regression that
    // replaces the atomic expression with a plain value or removes the lock.
    // -----------------------------------------------------------------------
    it(
      "both concurrent contributions accumulate — final balance equals the sum of both amounts",
      async () => {
        const amount = 5_000;

        const [res1, res2] = await Promise.all([
          request(app)
            .post(`/savings-goals/${testGoalId}/contribute`)
            .send({ amount }),
          request(app)
            .post(`/savings-goals/${testGoalId}/contribute`)
            .send({ amount }),
        ]);

        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);

        // Fetch the authoritative value directly from Postgres.
        const [goal] = await db
          .select({ currentAmount: savingsGoalsTable.currentAmount })
          .from(savingsGoalsTable)
          .where(eq(savingsGoalsTable.id, testGoalId));

        // Both deltas must be present — a non-atomic overwrite would leave
        // this at `amount` (5 000) instead of `amount * 2` (10 000).
        expect(goal.currentAmount).toBe(amount * 2);

        // Also verify that exactly two contribution rows were inserted.
        const contributions = await db
          .select()
          .from(savingsGoalContributionsTable)
          .where(eq(savingsGoalContributionsTable.goalId, testGoalId));

        expect(contributions).toHaveLength(2);

        const contributionTotal = contributions.reduce(
          (sum, c) => sum + c.amount,
          0,
        );
        expect(contributionTotal).toBe(amount * 2);
      },
      // Allow up to 15 s for lock contention + round-trips.
      15_000,
    );

    // -----------------------------------------------------------------------
    // Verify that the transaction rolls back atomically when the goal row
    // is absent. This exercises the 404 path on a real DB rather than a mock.
    // -----------------------------------------------------------------------
    it("returns 404 for a goal that does not exist in the database", async () => {
      const res = await request(app)
        .post("/savings-goals/999999999/contribute")
        .send({ amount: 100 });

      expect(res.status).toBe(404);
    });

    // -----------------------------------------------------------------------
    // Validate the capping logic against real Postgres arithmetic.
    //
    // When a contribution would push the balance past targetAmount, the handler
    // should cap the applied amount and set isCompleted = true.
    // -----------------------------------------------------------------------
    it("caps the contribution at the remaining gap and marks the goal completed", async () => {
      // Create a fresh goal that's almost full (targetAmount = 1 000, current = 800).
      const [cappedGoal] = await db
        .insert(savingsGoalsTable)
        .values({
          name: `Cap Test Goal ${Date.now()}`,
          targetAmount: 1_000,
          currentAmount: 800,
          createdByUserId: TEST_USER_ID,
          isCompleted: false,
        })
        .returning();

      try {
        // Contribute 500 — only 200 should be applied (gap = 1000 - 800).
        const res = await request(app)
          .post(`/savings-goals/${cappedGoal.id}/contribute`)
          .send({ amount: 500 });

        expect(res.status).toBe(200);
        expect(res.body.currentAmount).toBe(1_000);
        expect(res.body.isCompleted).toBe(true);

        // Verify via a direct DB read.
        const [refreshed] = await db
          .select()
          .from(savingsGoalsTable)
          .where(eq(savingsGoalsTable.id, cappedGoal.id));

        expect(refreshed.currentAmount).toBe(1_000);
        expect(refreshed.isCompleted).toBe(true);

        // Contribution row should record the capped (200), not the requested (500) amount.
        const [contribution] = await db
          .select()
          .from(savingsGoalContributionsTable)
          .where(eq(savingsGoalContributionsTable.goalId, cappedGoal.id));

        expect(contribution.amount).toBe(200);
      } finally {
        // Clean up regardless of test outcome.
        await db
          .delete(savingsGoalContributionsTable)
          .where(eq(savingsGoalContributionsTable.goalId, cappedGoal.id));
        await db
          .delete(savingsGoalsTable)
          .where(eq(savingsGoalsTable.id, cappedGoal.id));
      }
    });
  },
);
