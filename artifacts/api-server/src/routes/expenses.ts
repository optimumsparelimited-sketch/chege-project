import { Router } from "express";
import { db } from "@workspace/db";
import { expensesTable, usersTable, membersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CreateExpenseBody,
  UpdateExpenseBody,
  DeleteExpenseParams,
  GetExpensesQueryParams,
} from "@workspace/api-zod";

const router = Router();

function formatExpense(e: {
  id: number;
  amount: number;
  category: string;
  description: string;
  notes: string | null;
  paidById: string;
  paidByName: string | null;
  isRecurring: boolean;
  date: string | Date | null;
  createdAt: Date | string;
}) {
  return {
    ...e,
    notes: e.notes ?? null,
    paidByName: e.paidByName ?? "Unknown",
    isRecurring: e.isRecurring ?? false,
    date: typeof e.date === "string" ? e.date : e.date?.toISOString().split("T")[0],
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
  };
}

router.get("/expenses", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = GetExpensesQueryParams.safeParse(req.query);
  const { month, year, category } = parsed.success ? parsed.data : {};

  const conditions = [];
  if (month !== undefined && year !== undefined) {
    conditions.push(sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${month}`, sql`EXTRACT(YEAR FROM ${expensesTable.date}) = ${year}`);
  } else if (year !== undefined) {
    conditions.push(sql`EXTRACT(YEAR FROM ${expensesTable.date}) = ${year}`);
  }
  if (category) conditions.push(eq(expensesTable.category, category));

  const expenses = await db
    .select({
      id: expensesTable.id,
      amount: expensesTable.amount,
      category: expensesTable.category,
      description: expensesTable.description,
      notes: expensesTable.notes,
      paidById: expensesTable.paidById,
      paidByName: usersTable.firstName,
      isRecurring: expensesTable.isRecurring,
      date: expensesTable.date,
      createdAt: expensesTable.createdAt,
    })
    .from(expensesTable)
    .leftJoin(usersTable, eq(expensesTable.paidById, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${expensesTable.date} DESC, ${expensesTable.createdAt} DESC`);

  res.json(expenses.map(formatExpense));
});

// POST /expenses/apply-recurring — must be before /:id route
router.post("/expenses/apply-recurring", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const schema = z.object({ month: z.number(), year: z.number() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { month, year } = parsed.data;

  // Find the previous month
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  // Get recurring expenses from previous month
  const recurring = await db
    .select()
    .from(expensesTable)
    .where(
      and(
        eq(expensesTable.isRecurring, true),
        sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${prevMonth}`,
        sql`EXTRACT(YEAR FROM ${expensesTable.date}) = ${prevYear}`,
      ),
    );

  if (recurring.length === 0) {
    res.json({ copied: 0 });
    return;
  }

  // Check which ones don't already exist this month (match by category + description)
  const existing = await db
    .select({ category: expensesTable.category, description: expensesTable.description })
    .from(expensesTable)
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${month}`,
        sql`EXTRACT(YEAR FROM ${expensesTable.date}) = ${year}`,
      ),
    );

  const existingKeys = new Set(existing.map((e) => `${e.category}||${e.description}`));
  const toInsert = recurring.filter((r) => !existingKeys.has(`${r.category}||${r.description}`));

  if (toInsert.length === 0) {
    res.json({ copied: 0 });
    return;
  }

  // Build the new date (1st of target month)
  const newDate = `${year}-${String(month).padStart(2, "0")}-01`;

  await db.insert(expensesTable).values(
    toInsert.map((r) => ({
      amount: r.amount,
      category: r.category,
      description: r.description,
      notes: r.notes,
      paidById: r.paidById,
      isRecurring: true,
      date: newDate,
    })),
  );

  res.json({ copied: toInsert.length });
});

router.post("/expenses", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const { amount, category, description, notes, paidById, isRecurring, date } = parsed.data;

  if (!paidById) {
    res.status(400).json({ error: "paidById is required — choose who paid." });
    return;
  }

  // Validate paidById is a known household member
  const member = await db.query.membersTable.findFirst({ where: eq(membersTable.userId, paidById) });
  if (!member) {
    res.status(400).json({ error: "paidById must be a recognised household member." });
    return;
  }

  const [expense] = await db
    .insert(expensesTable)
    .values({ amount, category, description, notes: notes ?? null, paidById, isRecurring: isRecurring ?? false, date: date instanceof Date ? date.toISOString().split('T')[0] : date })
    .returning();

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, paidById) });

  res.status(201).json(formatExpense({ ...expense, paidByName: user?.firstName ?? "Unknown" }));
});

router.patch("/expenses/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const idParsed = DeleteExpenseParams.safeParse(req.params);
  if (!idParsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { amount, category, description, notes, paidById, isRecurring, date } = parsed.data;

  if (!paidById) {
    res.status(400).json({ error: "paidById is required — choose who paid." });
    return;
  }

  // Validate paidById is a known household member
  const member = await db.query.membersTable.findFirst({ where: eq(membersTable.userId, paidById) });
  if (!member) {
    res.status(400).json({ error: "paidById must be a recognised household member." });
    return;
  }

  const [updated] = await db
    .update(expensesTable)
    .set({ amount, category, description, notes: notes ?? null, paidById, isRecurring: isRecurring ?? false, date: date instanceof Date ? date.toISOString().split('T')[0] : date })
    .where(eq(expensesTable.id, Math.round(idParsed.data.id)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, paidById) });
  res.json(formatExpense({ ...updated, paidByName: user?.firstName ?? "Unknown" }));
});

router.delete("/expenses/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = DeleteExpenseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db.delete(expensesTable).where(eq(expensesTable.id, Math.round(parsed.data.id))).returning();
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }

  res.json({ success: true });
});

export default router;
