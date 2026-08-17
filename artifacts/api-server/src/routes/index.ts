import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import healthRouter from "./health";
import authRouter from "./auth";
import expensesRouter from "./expenses";
import contributionsRouter from "./contributions";
import budgetCategoriesRouter from "./budget-categories";
import dashboardRouter from "./dashboard";
import membersRouter from "./members";
import digestRouter from "./digest";
import savingsGoalsRouter from "./savings-goals";
import jointAccountRouter from "./joint-account";

const MAX_MEMBERS = 2;

/**
 * Auto-registers the first MAX_MEMBERS users to sign in as members.
 * Once the cap is reached, anyone else gets a 403 with their userId
 * so they can request access from an existing member.
 */
async function requireMember(req: Request, res: Response, next: NextFunction) {
  // Only enforce for authenticated users hitting protected routes
  if (!req.isAuthenticated()) {
    next();
    return;
  }

  const userId = req.user.id;

  // Check if already a member (fast path)
  const existing = await db.query.membersTable.findFirst({
    where: eq(membersTable.userId, userId),
  });
  if (existing) {
    next();
    return;
  }

  // Check current member count
  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(membersTable);

  if (Number(countRow.count) < MAX_MEMBERS) {
    // Auto-register new member
    await db
      .insert(membersTable)
      .values({ userId, addedByUserId: null })
      .onConflictDoNothing();
    next();
    return;
  }

  // Membership is full — return forbidden with their userId so they can ask for access
  res.status(403).json({
    error: "Access restricted to this couple's account.",
    yourUserId: userId,
    hint: "Share your userId with your partner to request access.",
  });
}

const router: IRouter = Router();

// Auth routes bypass member check
router.use(authRouter);

// Apply member check to everything else
router.use(requireMember);

router.use(healthRouter);
router.use(expensesRouter);
router.use(contributionsRouter);
router.use(budgetCategoriesRouter);
router.use(dashboardRouter);
router.use(membersRouter);
router.use(digestRouter);
router.use(savingsGoalsRouter);
router.use(jointAccountRouter);

export default router;
