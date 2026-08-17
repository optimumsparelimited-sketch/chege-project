import { Router } from "express";
import { db } from "@workspace/db";
import { budgetCategoriesTable } from "@workspace/db";
import { asc } from "drizzle-orm";

const router = Router();

router.get("/budget-categories", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const categories = await db
    .select()
    .from(budgetCategoriesTable)
    .orderBy(asc(budgetCategoriesTable.priority), asc(budgetCategoriesTable.name));

  res.json(categories);
});

export default router;
