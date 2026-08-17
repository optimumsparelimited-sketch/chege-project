import { Router } from "express";
import { db } from "@workspace/db";
import {
  expensesTable,
  contributionsTable,
  budgetCategoriesTable,
  usersTable,
  jointAccountTxTable,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { GetDashboardSummaryQueryParams, GetDashboardCategoryBreakdownQueryParams } from "@workspace/api-zod";

const CHEGE_TARGET = 267094;
const LYDIAH_TARGET = 50000;
const TOTAL_BUDGET = 317094;

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = new Date();
  const parsed = GetDashboardSummaryQueryParams.safeParse(req.query);
  const month = parsed.success && parsed.data.month != null ? Math.round(parsed.data.month) : now.getMonth() + 1;
  const year = parsed.success && parsed.data.year != null ? Math.round(parsed.data.year) : now.getFullYear();

  const [spentRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${expensesTable.amount}), 0)` })
    .from(expensesTable)
    .where(sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${month} AND EXTRACT(YEAR FROM ${expensesTable.date}) = ${year}`);

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(expensesTable)
    .where(sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${month} AND EXTRACT(YEAR FROM ${expensesTable.date}) = ${year}`);

  // Disbursements tagged to an expense category also count as spending
  const [categorisedDisbursementsRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${jointAccountTxTable.amount}), 0)` })
    .from(jointAccountTxTable)
    .where(sql`${jointAccountTxTable.type} = 'disbursement' AND ${jointAccountTxTable.expenseCategory} IS NOT NULL AND EXTRACT(MONTH FROM ${jointAccountTxTable.date}) = ${month} AND EXTRACT(YEAR FROM ${jointAccountTxTable.date}) = ${year}`);

  const contribs = await db
    .select({
      userId: contributionsTable.userId,
      total: sql<number>`COALESCE(SUM(${contributionsTable.amount}), 0)`,
    })
    .from(contributionsTable)
    .where(sql`${contributionsTable.month} = ${month} AND ${contributionsTable.year} = ${year}`)
    .groupBy(contributionsTable.userId);

  // Per-person spending breakdown
  const memberExpenses = await db
    .select({
      userId: expensesTable.paidById,
      total: sql<number>`COALESCE(SUM(${expensesTable.amount}), 0)`,
    })
    .from(expensesTable)
    .where(sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${month} AND EXTRACT(YEAR FROM ${expensesTable.date}) = ${year}`)
    .groupBy(expensesTable.paidById);

  const users = await db.select().from(usersTable);

  // Identify Chege and Lydiah by name OR email (firstName may be null if they
  // haven't logged in since the profile-save was added, so email is the reliable fallback)
  const isChege = (u?: typeof usersTable.$inferSelect | null) => {
    const n = (u?.firstName ?? "").toLowerCase();
    const e = (u?.email ?? "").toLowerCase();
    return n.includes("chege") || n.includes("george") || n.includes("frederick") || e.includes("mundarafrederick");
  };
  const isLydiah = (u?: typeof usersTable.$inferSelect | null) => {
    const n = (u?.firstName ?? "").toLowerCase();
    const e = (u?.email ?? "").toLowerCase();
    return n.includes("lydiah") || n.includes("lydia") || e.includes("lydiah");
  };

  let chegeContributed = 0;
  let lydiahContributed = 0;
  let chegeSpent = 0;
  let lydiahSpent = 0;

  for (const c of contribs) {
    const user = users.find((u) => u.id === c.userId);
    if (isChege(user)) chegeContributed += Number(c.total);
    else if (isLydiah(user)) lydiahContributed += Number(c.total);
    else if (chegeContributed === 0) chegeContributed += Number(c.total);
    else lydiahContributed += Number(c.total);
  }

  for (const e of memberExpenses) {
    const user = users.find((u) => u.id === e.userId);
    if (isChege(user)) chegeSpent += Number(e.total);
    else if (isLydiah(user)) lydiahSpent += Number(e.total);
    else if (chegeSpent === 0) chegeSpent += Number(e.total);
    else lydiahSpent += Number(e.total);
  }

  const totalSpent = Number(spentRow.total) + Number(categorisedDisbursementsRow.total);
  res.json({
    month, year,
    totalBudget: TOTAL_BUDGET,
    totalSpent,
    remaining: TOTAL_BUDGET - totalSpent,
    chegeContributed,
    lydiahContributed,
    chegeSpent,
    lydiahSpent,
    chegeNet: chegeContributed - chegeSpent,
    lydiahNet: lydiahContributed - lydiahSpent,
    chegeTarget: CHEGE_TARGET,
    lydiahTarget: LYDIAH_TARGET,
    expenseCount: Number(countRow.count),
  });
});

router.get("/dashboard/activity", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const expenses = await db
    .select({
      id: expensesTable.id,
      amount: expensesTable.amount,
      category: expensesTable.category,
      description: expensesTable.description,
      paidById: expensesTable.paidById,
      paidByName: usersTable.firstName,
      date: expensesTable.date,
      createdAt: expensesTable.createdAt,
    })
    .from(expensesTable)
    .leftJoin(usersTable, eq(expensesTable.paidById, usersTable.id))
    .orderBy(sql`${expensesTable.createdAt} DESC`)
    .limit(10);

  const contributions = await db
    .select({
      id: contributionsTable.id,
      amount: contributionsTable.amount,
      userId: contributionsTable.userId,
      userName: usersTable.firstName,
      month: contributionsTable.month,
      year: contributionsTable.year,
      createdAt: contributionsTable.createdAt,
    })
    .from(contributionsTable)
    .leftJoin(usersTable, eq(contributionsTable.userId, usersTable.id))
    .orderBy(sql`${contributionsTable.createdAt} DESC`)
    .limit(10);

  const items = [
    ...expenses.map((e) => ({
      id: `expense-${e.id}`,
      type: "expense",
      amount: e.amount,
      description: e.description,
      userName: e.paidByName ?? "Unknown",
      category: e.category,
      date: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
    })),
    ...contributions.map((c) => ({
      id: `contribution-${c.id}`,
      type: "contribution",
      amount: c.amount,
      description: `Contribution for ${new Date(c.year, c.month - 1).toLocaleString("default", { month: "long" })} ${c.year}`,
      userName: c.userName ?? "Unknown",
      category: null,
      date: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20);

  res.json(items);
});

router.get("/dashboard/category-breakdown", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const now = new Date();
  const parsed = GetDashboardCategoryBreakdownQueryParams.safeParse(req.query);
  const month = parsed.success && parsed.data.month != null ? Math.round(parsed.data.month) : now.getMonth() + 1;
  const year = parsed.success && parsed.data.year != null ? Math.round(parsed.data.year) : now.getFullYear();

  const categories = await db.select().from(budgetCategoriesTable).orderBy(budgetCategoriesTable.priority);
  const spentByCategory = await db
    .select({ category: expensesTable.category, total: sql<number>`COALESCE(SUM(${expensesTable.amount}), 0)` })
    .from(expensesTable)
    .where(sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${month} AND EXTRACT(YEAR FROM ${expensesTable.date}) = ${year}`)
    .groupBy(expensesTable.category);

  // Also count disbursements that are tagged to an expense category
  const disbursementsByCategory = await db
    .select({
      category: jointAccountTxTable.expenseCategory,
      total: sql<number>`COALESCE(SUM(${jointAccountTxTable.amount}), 0)`,
    })
    .from(jointAccountTxTable)
    .where(sql`${jointAccountTxTable.type} = 'disbursement' AND ${jointAccountTxTable.expenseCategory} IS NOT NULL AND EXTRACT(MONTH FROM ${jointAccountTxTable.date}) = ${month} AND EXTRACT(YEAR FROM ${jointAccountTxTable.date}) = ${year}`)
    .groupBy(jointAccountTxTable.expenseCategory);

  const spentMap = new Map(spentByCategory.map((s) => [s.category, Number(s.total)]));
  const disbursementMap = new Map(disbursementsByCategory.map((d) => [d.category, Number(d.total)]));

  res.json(categories.map((cat) => {
    const spentAmount = (spentMap.get(cat.name) ?? 0) + (disbursementMap.get(cat.name) ?? 0);
    return {
      category: cat.name,
      budgetAmount: cat.budgetAmount,
      spentAmount,
      remaining: cat.budgetAmount - spentAmount,
      percentUsed: Math.round(cat.budgetAmount > 0 ? (spentAmount / cat.budgetAmount) * 100 * 10 : 0) / 10,
      priority: cat.priority,
      color: cat.color,
    };
  }));
});

router.get("/dashboard/trends", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const monthsBack = Math.min(Math.max(Number(req.query.months) || 6, 1), 12);
  const now = new Date();
  const results = [];

  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();

    const [spentRow] = await db
      .select({ total: sql<number>`COALESCE(SUM(${expensesTable.amount}), 0)`, count: sql<number>`COUNT(*)` })
      .from(expensesTable)
      .where(sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${m} AND EXTRACT(YEAR FROM ${expensesTable.date}) = ${y}`);

    results.push({
      month: m,
      year: y,
      label: d.toLocaleString("default", { month: "short", year: "numeric" }),
      totalSpent: Number(spentRow.total),
      expenseCount: Number(spentRow.count),
    });
  }

  res.json(results);
});

export default router;
