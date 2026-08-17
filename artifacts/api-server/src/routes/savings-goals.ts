import { Router } from "express";
import { db } from "@workspace/db";
import { savingsGoalsTable, savingsGoalContributionsTable, usersTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const CreateGoalBody = z.object({
  name: z.string().min(1),
  targetAmount: z.number().positive(),
  deadline: z.string().optional(),
});

const UpdateGoalBody = z.object({
  name: z.string().min(1).optional(),
  targetAmount: z.number().positive().optional(),
  currentAmount: z.number().min(0, "currentAmount cannot be negative").optional(),
  deadline: z.string().nullable().optional(),
  isCompleted: z.boolean().optional(),
  reason: z.string().trim().min(1).optional(),
});

const GoalIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

function formatGoal(g: typeof savingsGoalsTable.$inferSelect) {
  return {
    ...g,
    deadline: g.deadline ?? null,
    createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : g.createdAt,
  };
}

router.get("/savings-goals", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const goals = await db
    .select()
    .from(savingsGoalsTable)
    .orderBy(savingsGoalsTable.createdAt);

  res.json(goals.map(formatGoal));
});

router.post("/savings-goals", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateGoalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const { name, targetAmount, deadline } = parsed.data;

  const [goal] = await db
    .insert(savingsGoalsTable)
    .values({
      name,
      targetAmount,
      currentAmount: 0,
      deadline: deadline ?? null,
      createdByUserId: req.user.id,
      isCompleted: false,
    })
    .returning();

  res.status(201).json(formatGoal(goal));
});

// POST /savings-goals/cascade-contribute — distribute a payment waterfall-style across goals
router.post("/savings-goals/cascade-contribute", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const bodySchema = z.object({
    amount: z.number().positive(),
    goalIds: z.array(z.number().int().positive()).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const { amount: totalAmount, goalIds } = parsed.data;

  const { allocations, leftover } = await db.transaction(async (tx) => {
    // Fetch and lock goals inside the transaction so two concurrent cascades
    // cannot both read the same stale balances and doubly-fund the same goals.
    // The FOR UPDATE lock serialises concurrent transactions at the DB level:
    // the second request blocks on the lock until the first commits, then reads
    // the freshly-committed balances before allocating.
    let goals: (typeof savingsGoalsTable.$inferSelect)[];
    if (goalIds && goalIds.length > 0) {
      const all = await tx
        .select()
        .from(savingsGoalsTable)
        .where(eq(savingsGoalsTable.isCompleted, false))
        .for("update");
      const byId = Object.fromEntries(all.map((g) => [g.id, g]));
      goals = goalIds.map((id) => byId[id]).filter(Boolean);
    } else {
      goals = await tx
        .select()
        .from(savingsGoalsTable)
        .where(eq(savingsGoalsTable.isCompleted, false))
        .orderBy(savingsGoalsTable.createdAt)
        .for("update");
    }

    let remaining = totalAmount;
    const allocations: {
      goalId: number;
      goalName: string;
      allocated: number;
      newTotal: number;
      completed: boolean;
    }[] = [];

    for (const goal of goals) {
      if (remaining <= 0) break;
      const needed = goal.targetAmount - goal.currentAmount;
      if (needed <= 0) continue; // already full

      const allocated = Math.min(needed, remaining);
      remaining -= allocated;

      const [updated] = await tx
        .update(savingsGoalsTable)
        .set({
          currentAmount: sql`${savingsGoalsTable.currentAmount} + ${allocated}`,
          isCompleted: goal.currentAmount + allocated >= goal.targetAmount ? true : goal.isCompleted,
        })
        .where(eq(savingsGoalsTable.id, goal.id))
        .returning();

      // Both writes run in the same transaction — a crash between them rolls back both.
      await tx.insert(savingsGoalContributionsTable).values({
        goalId: goal.id,
        amount: allocated,
        createdByUserId: req.user.id,
      });

      allocations.push({
        goalId: goal.id,
        goalName: goal.name,
        allocated,
        newTotal: updated.currentAmount,
        completed: updated.isCompleted,
      });
    }

    return { allocations, leftover: remaining };
  });

  res.json({ totalAmount, allocations, leftover });
});

// POST /savings-goals/:id/contribute — atomic server-side increment (before /:id PATCH)
router.post("/savings-goals/:id/contribute", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const paramParsed = GoalIdParam.safeParse(req.params);
  if (!paramParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const bodySchema = z.object({ amount: z.number().positive() });
  const bodyParsed = bodySchema.safeParse(req.body);
  if (!bodyParsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const { id } = paramParsed.data;
  const { amount } = bodyParsed.data;

  // All reads and writes run inside a single transaction — a crash between them
  // rolls back everything.
  const updated = await db.transaction(async (tx) => {
    // Lock the row so concurrent contributions serialize at the DB level.
    const [goal] = await tx
      .select()
      .from(savingsGoalsTable)
      .where(eq(savingsGoalsTable.id, id))
      .for("update");

    if (!goal) return null;

    // Cap the applied amount so the balance never exceeds the target.
    const needed = goal.targetAmount - goal.currentAmount;
    const actualAmount = Math.min(amount, needed);
    const willComplete = goal.currentAmount + actualAmount >= goal.targetAmount;

    const [updated] = await tx
      .update(savingsGoalsTable)
      .set({
        currentAmount: sql`${savingsGoalsTable.currentAmount} + ${actualAmount}`,
        isCompleted: willComplete ? true : goal.isCompleted,
      })
      .where(eq(savingsGoalsTable.id, id))
      .returning();

    if (!updated) return null;

    await tx.insert(savingsGoalContributionsTable).values({
      goalId: id,
      amount: actualAmount,
      createdByUserId: req.user.id,
    });

    return updated;
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  res.json(formatGoal(updated));
});

// GET /savings-goals/:id/contributions — chronological contribution history
router.get("/savings-goals/:id/contributions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const paramParsed = GoalIdParam.safeParse(req.params);
  if (!paramParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const { id } = paramParsed.data;

  // Verify the goal still exists before returning its history.
  // Without this check a deleted goal returns 200 [] which the client
  // can't distinguish from "goal exists but has no contributions yet".
  const [goal] = await db
    .select({ id: savingsGoalsTable.id })
    .from(savingsGoalsTable)
    .where(eq(savingsGoalsTable.id, id))
    .limit(1);
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }

  const rows = await db
    .select({
      id: savingsGoalContributionsTable.id,
      goalId: savingsGoalContributionsTable.goalId,
      amount: savingsGoalContributionsTable.amount,
      note: savingsGoalContributionsTable.note,
      createdByUserId: savingsGoalContributionsTable.createdByUserId,
      createdAt: savingsGoalContributionsTable.createdAt,
      contributorName: usersTable.firstName,
    })
    .from(savingsGoalContributionsTable)
    .leftJoin(usersTable, eq(savingsGoalContributionsTable.createdByUserId, usersTable.id))
    .where(eq(savingsGoalContributionsTable.goalId, id))
    .orderBy(desc(savingsGoalContributionsTable.createdAt));

  res.json(rows.map((c) => ({
    ...c,
    contributorName: c.contributorName ?? "Unknown",
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
  })));
});

// GET /savings-goals/consistency-check — surface goals with balance/history mismatches.
//
// A Postgres transaction guarantees that the goal UPDATE and the contribution
// INSERT both commit or both roll back. If a connection ever drops between those
// two writes, the DB will roll back the entire transaction and neither change
// will persist. This endpoint provides a secondary safety net: it queries the DB
// directly and returns any goals where currentAmount ≠ SUM(contributions), which
// would indicate a partial write that somehow survived (e.g. a logic bug, a
// manual DB edit, or a future refactor that breaks transactionality).
//
// Returns: { ok: true, inconsistentGoals: [...] }
//   inconsistentGoals is empty when everything is consistent.
//   Each entry has: id, name, currentAmount, contributionTotal, discrepancy
router.get("/savings-goals/consistency-check", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Aggregate contribution totals per goal with a LEFT JOIN so goals that have
  // no contributions at all still appear (their contributionTotal will be 0).
  const rows = await db
    .select({
      id: savingsGoalsTable.id,
      name: savingsGoalsTable.name,
      currentAmount: savingsGoalsTable.currentAmount,
      contributionTotal: sql<number>`COALESCE(SUM(${savingsGoalContributionsTable.amount}), 0)`,
    })
    .from(savingsGoalsTable)
    .leftJoin(
      savingsGoalContributionsTable,
      eq(savingsGoalContributionsTable.goalId, savingsGoalsTable.id),
    )
    .groupBy(savingsGoalsTable.id);

  const inconsistentGoals = rows
    .filter((r) => r.currentAmount !== Number(r.contributionTotal))
    .map((r) => ({
      id: r.id,
      name: r.name,
      currentAmount: r.currentAmount,
      contributionTotal: Number(r.contributionTotal),
      discrepancy: r.currentAmount - Number(r.contributionTotal),
    }));

  res.json({ ok: inconsistentGoals.length === 0, inconsistentGoals });
});

router.patch("/savings-goals/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const paramParsed = GoalIdParam.safeParse(req.params);
  if (!paramParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const bodyParsed = UpdateGoalBody.safeParse(req.body);
  if (!bodyParsed.success) {
    const firstIssue = bodyParsed.error.issues[0];
    const message = firstIssue?.message ?? "Invalid request body";
    res.status(400).json({ error: message });
    return;
  }

  const { id } = paramParsed.data;
  const { reason, ...updates } = bodyParsed.data;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No updates provided" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // If currentAmount is being set directly, fetch the current value with a
    // row-level lock so concurrent PATCH requests serialize instead of racing.
    let delta: number | undefined;
    if (updates.currentAmount !== undefined) {
      const [existing] = await tx
        .select({ currentAmount: savingsGoalsTable.currentAmount })
        .from(savingsGoalsTable)
        .where(eq(savingsGoalsTable.id, id))
        .for("update"); // prevents concurrent reads from seeing the same snapshot
      if (!existing) return null;
      const previousAmount = existing.currentAmount;

      // Guard against accidental large negative corrections.
      // If the new amount would wipe more than 50% of the current balance,
      // require an explicit reason so the intent is clear.
      delta = updates.currentAmount - previousAmount;
      if (delta < 0 && previousAmount > 0 && Math.abs(delta) > previousAmount * 0.5 && !reason) {
        return { validationError: `A correction of ${Math.abs(delta).toFixed(2)} would reduce the balance by more than 50%. Provide a 'reason' field to confirm this is intentional.` };
      }
    }

    // Apply currentAmount as an atomic delta (currentAmount + delta) rather than
    // writing the raw caller-supplied value. This ensures two concurrent edits
    // both take effect rather than the second silently overwriting the first.
    const { currentAmount: _ignored, ...otherUpdates } = updates;
    const setClause: Record<string, unknown> = { ...otherUpdates };
    if (delta !== undefined) {
      setClause.currentAmount = sql`${savingsGoalsTable.currentAmount} + ${delta}`;
    }

    const [updated] = await tx
      .update(savingsGoalsTable)
      .set(setClause)
      .where(eq(savingsGoalsTable.id, id))
      .returning();

    if (!updated) return null;

    // Record a manual adjustment contribution so history totals stay consistent.
    // Both writes succeed or both roll back — no partial state possible.
    if (delta !== undefined && delta !== 0) {
      await tx.insert(savingsGoalContributionsTable).values({
        goalId: id,
        amount: delta,
        note: reason ?? "Manual adjustment",
        createdByUserId: req.user.id,
      });
    }

    return updated;
  });

  if (!result) { res.status(404).json({ error: "Not found" }); return; }

  if ("validationError" in result) {
    res.status(400).json({ error: result.validationError });
    return;
  }

  res.json(formatGoal(result));
});

router.delete("/savings-goals/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = GoalIdParam.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const { id } = parsed.data;

  // Both deletes run inside a single transaction — if either write fails, both
  // roll back so we never leave orphaned contribution rows behind.
  const deleted = await db.transaction(async (tx) => {
    // Remove all contribution history rows first (FK child before parent).
    await tx
      .delete(savingsGoalContributionsTable)
      .where(eq(savingsGoalContributionsTable.goalId, id));

    const [goal] = await tx
      .delete(savingsGoalsTable)
      .where(eq(savingsGoalsTable.id, id))
      .returning();

    return goal ?? null;
  });

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }

  res.json({ success: true });
});

export default router;
