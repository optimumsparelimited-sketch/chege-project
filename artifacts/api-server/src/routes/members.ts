import { Router } from "express";
import { db } from "@workspace/db";
import { membersTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

const router = Router();

async function getMembersWithNames() {
  const members = await db.select().from(membersTable);
  const users = await db.select().from(usersTable);
  const userMap = new Map(users.map((u) => [u.id, u]));
  return members.map((m) => {
    const user = userMap.get(m.userId);
    const name =
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      user?.email?.split("@")[0] ||
      null;
    return {
      userId: m.userId,
      userName: name,
      addedAt: m.addedAt instanceof Date ? m.addedAt.toISOString() : m.addedAt,
    };
  });
}

router.get("/members", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(await getMembersWithNames());
});

router.post("/members", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const schema = z.object({ userId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "userId is required" }); return; }

  const { userId } = parsed.data;

  // Check if already a member
  const existing = await db.query.membersTable.findFirst({ where: eq(membersTable.userId, userId) });
  if (existing) { res.status(400).json({ error: "Already a member" }); return; }

  await db.insert(membersTable).values({ userId, addedByUserId: req.user.id });
  const [member] = await getMembersWithNames().then((m) => m.filter((x) => x.userId === userId));

  res.status(201).json(member);
});

router.delete("/members/:userId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { userId } = req.params;

  // Prevent removing yourself if you're the only member
  const [countRow] = await db.select({ count: sql<number>`COUNT(*)` }).from(membersTable);
  if (Number(countRow.count) <= 1 && userId === req.user.id) {
    res.status(400).json({ error: "Cannot remove the last member" });
    return;
  }

  const [deleted] = await db.delete(membersTable).where(eq(membersTable.userId, userId)).returning();
  if (!deleted) { res.status(404).json({ error: "Member not found" }); return; }

  res.json({ success: true });
});

export default router;
