import { Router } from "express";
import { db } from "@workspace/db";
import { jointAccountTxTable, usersTable, contributionsTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const DepositInput = z.object({
  amount: z.number().positive(),
  description: z.string().min(1),
  date: z.string().min(1),
  madeById: z.string().optional(),
});

const DisbursementInput = z.object({
  amount: z.number().positive(),
  description: z.string().min(1),
  date: z.string().min(1),
  expenseCategory: z.string().optional(),
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

async function enrichTx(tx: typeof jointAccountTxTable.$inferSelect) {
  const user = tx.madeById
    ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, tx.madeById) })
    : null;
  return {
    ...tx,
    madeByName: user?.firstName ?? null,
    expenseCategory: tx.expenseCategory ?? null,
    createdAt: tx.createdAt instanceof Date ? tx.createdAt.toISOString() : tx.createdAt,
  };
}

// GET /joint-account — returns balance + all transactions ordered newest first
router.get("/joint-account", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const txs = await db
    .select()
    .from(jointAccountTxTable)
    .orderBy(sql`${jointAccountTxTable.date} DESC, ${jointAccountTxTable.createdAt} DESC`);

  const enriched = await Promise.all(txs.map(enrichTx));

  const totalDeposits = txs.filter(t => t.type === "deposit").reduce((s, t) => s + t.amount, 0);
  const totalDisbursements = txs.filter(t => t.type === "disbursement").reduce((s, t) => s + t.amount, 0);
  const balance = totalDeposits - totalDisbursements;

  res.json({ balance, totalDeposits, totalDisbursements, transactions: enriched });
});

// POST /joint-account/deposit
router.post("/joint-account/deposit", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = DepositInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { amount, description, date, madeById } = parsed.data;
  const depositorId = madeById ?? req.user!.id;

  const [tx] = await db
    .insert(jointAccountTxTable)
    .values({ type: "deposit", amount, description, date, madeById: depositorId })
    .returning();

  // Auto-record this deposit as a contribution for the depositor in the same month/year
  const depositDate = new Date(date);
  const month = depositDate.getUTCMonth() + 1;
  const year = depositDate.getUTCFullYear();
  await db.insert(contributionsTable).values({
    userId: depositorId,
    amount,
    month,
    year,
    note: `Bank deposit: ${description}`,
  });

  res.status(201).json(await enrichTx(tx));
});

// POST /joint-account/disbursement
router.post("/joint-account/disbursement", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = DisbursementInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { amount, description, date, expenseCategory } = parsed.data;
  const [tx] = await db
    .insert(jointAccountTxTable)
    .values({ type: "disbursement", amount, description, date, madeById: req.user!.id, expenseCategory: expenseCategory ?? null })
    .returning();

  res.status(201).json(await enrichTx(tx));
});

// DELETE /joint-account/:id
router.delete("/joint-account/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = IdParam.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db
    .delete(jointAccountTxTable)
    .where(eq(jointAccountTxTable.id, parsed.data.id))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

export default router;
