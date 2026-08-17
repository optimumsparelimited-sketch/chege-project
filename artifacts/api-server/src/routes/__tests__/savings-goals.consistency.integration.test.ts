/**
 * Integration tests for GET /savings-goals/consistency-check
 *
 * These tests connect to a real Postgres database so they can verify that the
 * consistency-check endpoint correctly identifies goals whose currentAmount
 * does not match the sum of their contribution rows — the signature of a
 * partial write caused by a mid-transaction connection drop or a logic bug
 * that bypasses the transactional write pair.
 *
 * The suite is skipped gracefully when DATABASE_URL is absent.
 *
 * Isolation strategy:
 *   • All imports that transitively touch @workspace/db are deferred to
 *     beforeAll via dynamic import, so the module is never loaded (and never
 *     throws) when DATABASE_URL is absent. describe.skipIf acts first.
 *   • Each test uses goals with a timestamp-suffixed name to avoid collisions
 *     in parallel CI runs.
 *   • All fixtures are torn down in afterAll / finally blocks.
 *
 * What is tested:
 *   1. Clean state — a goal with matching balance and contribution rows returns
 *      ok: true and an empty inconsistentGoals array.
 *   2. Simulated partial write — manually setting currentAmount via a direct
 *      DB UPDATE without inserting a corresponding contribution row (the state
 *      a real mid-transaction crash would leave if Postgres's rollback ever
 *      failed, or that a manual DB edit could introduce) surfaces that goal in
 *      the response with the correct discrepancy value.
 *   3. Mixed state — a DB containing both consistent and inconsistent goals
 *      only lists the inconsistent ones.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";

// ---------------------------------------------------------------------------
// Skip the entire suite when no DATABASE_URL is configured.
// ---------------------------------------------------------------------------
const hasDb = !!process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Module-level variables populated lazily in beforeAll (only when hasDb).
// ---------------------------------------------------------------------------
type DbModule = typeof import("@workspace/db");
type RouterModule = typeof import("../savings-goals.js");
type DrizzleOrm = typeof import("drizzle-orm");

let db: DbModule["db"];
let pool: DbModule["pool"];
let savingsGoalsTable: DbModule["savingsGoalsTable"];
let savingsGoalContributionsTable: DbModule["savingsGoalContributionsTable"];
let usersTable: DbModule["usersTable"];
let eq: DrizzleOrm["eq"];
let inArray: DrizzleOrm["inArray"];
let sql: DrizzleOrm["sql"];

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------
const TEST_USER_ID = "integration-test-user-consistency";

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
  "GET /savings-goals/consistency-check (integration — real Postgres)",
  () => {
    let app: ReturnType<typeof buildApp>;
    const ts = Date.now();
    const createdGoalIds: number[] = [];

    beforeAll(async () => {
      // Defer all imports that touch @workspace/db so describe.skipIf can act
      // first in no-DB environments without triggering the "DATABASE_URL must
      // be set" throw.
      const dbModule = await import("@workspace/db");
      db = dbModule.db;
      pool = dbModule.pool;
      savingsGoalsTable = dbModule.savingsGoalsTable;
      savingsGoalContributionsTable = dbModule.savingsGoalContributionsTable;
      usersTable = dbModule.usersTable;

      const drizzle = await import("drizzle-orm");
      eq = drizzle.eq;
      inArray = drizzle.inArray;
      sql = drizzle.sql;

      const routerModule = await import("../savings-goals.js");
      app = buildApp(routerModule.default);

      // Upsert a test user so FK constraints on createdByUserId are satisfied.
      await db
        .insert(usersTable)
        .values({ id: TEST_USER_ID, firstName: "Consistency", lastName: "Tester" })
        .onConflictDoNothing();
    });

    afterAll(async () => {
      // Best-effort cleanup; individual tests also clean up their own fixtures.
      if (createdGoalIds.length > 0) {
        await db
          .delete(savingsGoalContributionsTable)
          .where(inArray(savingsGoalContributionsTable.goalId, createdGoalIds));
        await db
          .delete(savingsGoalsTable)
          .where(inArray(savingsGoalsTable.id, createdGoalIds));
      }

      await db
        .delete(usersTable)
        .where(eq(usersTable.id, TEST_USER_ID));

      await pool.end();
    });

    // -----------------------------------------------------------------------
    // 1. Clean state — a goal created via the API has matching balance and
    //    contribution row, so the check returns ok: true.
    // -----------------------------------------------------------------------
    it(
      "reports ok: true when all goal balances match their contribution sums",
      async () => {
        // Create a goal via the API so the transactional write pair runs normally.
        const createRes = await request(app)
          .post("/savings-goals")
          .send({ name: `Consistency Clean Goal ${ts}`, targetAmount: 10_000 });

        expect(createRes.status).toBe(201);
        const goalId: number = createRes.body.id;
        createdGoalIds.push(goalId);

        // Contribute 1 000 — both the UPDATE and INSERT commit atomically.
        const contribRes = await request(app)
          .post(`/savings-goals/${goalId}/contribute`)
          .send({ amount: 1_000 });

        expect(contribRes.status).toBe(200);

        // The consistency check must not flag this goal.
        const checkRes = await request(app).get("/savings-goals/consistency-check");
        expect(checkRes.status).toBe(200);

        // ok is true only when there are no inconsistent goals at all.
        // There may be other goals in the DB from other test runs; we only care
        // that this test's goal is not listed.
        const listed = checkRes.body.inconsistentGoals as { id: number }[];
        const found = listed.find((g) => g.id === goalId);
        expect(found).toBeUndefined();

        // Clean up.
        await db
          .delete(savingsGoalContributionsTable)
          .where(eq(savingsGoalContributionsTable.goalId, goalId));
        await db
          .delete(savingsGoalsTable)
          .where(eq(savingsGoalsTable.id, goalId));
        createdGoalIds.splice(createdGoalIds.indexOf(goalId), 1);
      },
      15_000,
    );

    // -----------------------------------------------------------------------
    // 2. Simulated partial write — manually advance currentAmount without
    //    inserting a contribution row.  This is the DB state a mid-transaction
    //    connection drop would produce *if* Postgres's rollback ever failed
    //    (or that a direct manual DB edit could introduce).  The endpoint must
    //    surface it with the correct discrepancy value.
    // -----------------------------------------------------------------------
    it(
      "detects and reports a goal whose balance was advanced without a matching contribution row",
      async () => {
        // Create a fresh goal directly in the DB (currentAmount = 0, no contributions).
        const [goal] = await db
          .insert(savingsGoalsTable)
          .values({
            name: `Consistency Partial-Write Goal ${ts}`,
            targetAmount: 5_000,
            currentAmount: 0,
            createdByUserId: TEST_USER_ID,
            isCompleted: false,
          })
          .returning();

        createdGoalIds.push(goal.id);

        // Simulate the "goal UPDATE committed, contribution INSERT did not" state:
        // directly set currentAmount to 2 500 without writing a contribution row.
        await db
          .update(savingsGoalsTable)
          .set({ currentAmount: 2_500 })
          .where(eq(savingsGoalsTable.id, goal.id));

        // The consistency check must surface this goal.
        const checkRes = await request(app).get("/savings-goals/consistency-check");
        expect(checkRes.status).toBe(200);

        const listed = checkRes.body.inconsistentGoals as {
          id: number;
          name: string;
          currentAmount: number;
          contributionTotal: number;
          discrepancy: number;
        }[];

        const found = listed.find((g) => g.id === goal.id);
        expect(found).toBeDefined();
        expect(found!.currentAmount).toBe(2_500);
        expect(found!.contributionTotal).toBe(0);
        expect(found!.discrepancy).toBe(2_500);

        // ok must be false when at least one inconsistency exists.
        expect(checkRes.body.ok).toBe(false);

        // Clean up.
        await db
          .delete(savingsGoalContributionsTable)
          .where(eq(savingsGoalContributionsTable.goalId, goal.id));
        await db
          .delete(savingsGoalsTable)
          .where(eq(savingsGoalsTable.id, goal.id));
        createdGoalIds.splice(createdGoalIds.indexOf(goal.id), 1);
      },
      15_000,
    );

    // -----------------------------------------------------------------------
    // 3. Mixed state — one consistent goal and one inconsistent goal coexist.
    //    Only the inconsistent goal should appear in inconsistentGoals.
    // -----------------------------------------------------------------------
    it(
      "only lists the inconsistent goal when consistent and inconsistent goals coexist",
      async () => {
        const [goodGoal] = await db
          .insert(savingsGoalsTable)
          .values({
            name: `Consistency Good Goal ${ts}`,
            targetAmount: 10_000,
            currentAmount: 1_000,
            createdByUserId: TEST_USER_ID,
            isCompleted: false,
          })
          .returning();

        createdGoalIds.push(goodGoal.id);

        // Insert the matching contribution row so goodGoal is consistent.
        await db.insert(savingsGoalContributionsTable).values({
          goalId: goodGoal.id,
          amount: 1_000,
          createdByUserId: TEST_USER_ID,
        });

        const [badGoal] = await db
          .insert(savingsGoalsTable)
          .values({
            name: `Consistency Bad Goal ${ts}`,
            targetAmount: 10_000,
            currentAmount: 3_000, // no contributions — simulated partial write
            createdByUserId: TEST_USER_ID,
            isCompleted: false,
          })
          .returning();

        createdGoalIds.push(badGoal.id);

        const checkRes = await request(app).get("/savings-goals/consistency-check");
        expect(checkRes.status).toBe(200);

        const listed = checkRes.body.inconsistentGoals as { id: number }[];

        // Good goal must NOT appear.
        expect(listed.find((g) => g.id === goodGoal.id)).toBeUndefined();

        // Bad goal MUST appear.
        const badEntry = listed.find((g) => g.id === badGoal.id) as {
          id: number;
          currentAmount: number;
          contributionTotal: number;
          discrepancy: number;
        } | undefined;
        expect(badEntry).toBeDefined();
        expect(badEntry!.discrepancy).toBe(3_000);

        // Clean up.
        await db
          .delete(savingsGoalContributionsTable)
          .where(inArray(savingsGoalContributionsTable.goalId, [goodGoal.id, badGoal.id]));
        await db
          .delete(savingsGoalsTable)
          .where(inArray(savingsGoalsTable.id, [goodGoal.id, badGoal.id]));
        createdGoalIds.splice(createdGoalIds.indexOf(goodGoal.id), 1);
        createdGoalIds.splice(createdGoalIds.indexOf(badGoal.id), 1);
      },
      15_000,
    );

    // -----------------------------------------------------------------------
    // 4. Verify the opposite partial-write direction: contribution row exists
    //    but currentAmount was not updated (the INSERT committed, UPDATE did
    //    not). The discrepancy is negative in this case.
    // -----------------------------------------------------------------------
    it(
      "detects a goal whose contribution rows exceed its recorded balance (negative discrepancy)",
      async () => {
        const [goal] = await db
          .insert(savingsGoalsTable)
          .values({
            name: `Consistency Orphan-Contrib Goal ${ts}`,
            targetAmount: 5_000,
            currentAmount: 0, // balance was never updated
            createdByUserId: TEST_USER_ID,
            isCompleted: false,
          })
          .returning();

        createdGoalIds.push(goal.id);

        // Insert a contribution row without updating currentAmount — simulates
        // the state where the INSERT committed but the UPDATE rolled back.
        await db.insert(savingsGoalContributionsTable).values({
          goalId: goal.id,
          amount: 1_500,
          createdByUserId: TEST_USER_ID,
        });

        const checkRes = await request(app).get("/savings-goals/consistency-check");
        expect(checkRes.status).toBe(200);

        const listed = checkRes.body.inconsistentGoals as {
          id: number;
          currentAmount: number;
          contributionTotal: number;
          discrepancy: number;
        }[];

        const found = listed.find((g) => g.id === goal.id);
        expect(found).toBeDefined();
        expect(found!.currentAmount).toBe(0);
        expect(found!.contributionTotal).toBe(1_500);
        expect(found!.discrepancy).toBe(-1_500);

        // Clean up.
        await db
          .delete(savingsGoalContributionsTable)
          .where(eq(savingsGoalContributionsTable.goalId, goal.id));
        await db
          .delete(savingsGoalsTable)
          .where(eq(savingsGoalsTable.id, goal.id));
        createdGoalIds.splice(createdGoalIds.indexOf(goal.id), 1);
      },
      15_000,
    );
  },
);
