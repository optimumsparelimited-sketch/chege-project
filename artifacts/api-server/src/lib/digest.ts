import { ReplitConnectors } from "@replit/connectors-sdk";
import { db } from "@workspace/db";
import {
  expensesTable,
  budgetCategoriesTable,
  contributionsTable,
  usersTable,
  membersTable,
  digestSendsTable,
} from "@workspace/db";
import { sql, eq, desc } from "drizzle-orm";
import { logger } from "./logger";

const TOTAL_BUDGET = 317094;
const CHEGE_TARGET = 267094;
const LYDIAH_TARGET = 50000;

function fmt(kes: number): string {
  return `KES ${Math.round(kes).toLocaleString()}`;
}

function monthName(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
}

function statusBadge(pct: number): string {
  if (pct >= 100) return "🔴 Over budget";
  if (pct >= 85) return "🟡 Near limit";
  return "🟢 On track";
}

interface CategoryRow {
  name: string;
  budgetAmount: number;
}

interface ExpenseRow {
  description: string;
  amount: number;
  category: string;
  paidByName: string | null;
  date: string;
}

function buildEmailHtml(opts: {
  label: string;
  totalSpent: number;
  remaining: number;
  pctUsed: number;
  categories: CategoryRow[];
  spentMap: Map<string, number>;
  top5: ExpenseRow[];
  chegeContributed: number;
  lydiahContributed: number;
}): string {
  const {
    label,
    totalSpent,
    remaining,
    pctUsed,
    categories,
    spentMap,
    top5,
    chegeContributed,
    lydiahContributed,
  } = opts;

  const overBudget = remaining < 0;
  const budgetLine = overBudget
    ? `<span style="color:#dc2626">Over budget by ${fmt(Math.abs(remaining))}</span>`
    : `${fmt(remaining)} remaining`;

  const categoryRows = categories
    .map((cat) => {
      const spent = spentMap.get(cat.name) ?? 0;
      const pct = cat.budgetAmount > 0 ? Math.round((spent / cat.budgetAmount) * 100) : 0;
      return `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">${cat.name}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right">${fmt(spent)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;color:#6b7280">${fmt(cat.budgetAmount)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right">${statusBadge(pct)}</td>
      </tr>`;
    })
    .join("");

  const top5Rows = top5
    .map(
      (e, i) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280">${i + 1}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">${e.description}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280">${e.category}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;font-weight:600">${fmt(e.amount)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;color:#6b7280">${e.paidByName ?? "—"}</td>
      </tr>`,
    )
    .join("");

  const chegeGap = CHEGE_TARGET - chegeContributed;
  const lydiahGap = LYDIAH_TARGET - lydiahContributed;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Family Budget — ${label} Summary</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111827">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:24px 0">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr><td style="background:#1d4ed8;padding:28px 32px">
          <p style="margin:0;font-size:12px;color:#93c5fd;letter-spacing:.08em;text-transform:uppercase">Monthly Digest</p>
          <h1 style="margin:6px 0 0;font-size:24px;color:#ffffff;font-weight:700">${label}</h1>
          <p style="margin:4px 0 0;font-size:14px;color:#bfdbfe">Family Budget Summary</p>
        </td></tr>

        <!-- Budget Overview -->
        <tr><td style="padding:28px 32px 0">
          <h2 style="margin:0 0 16px;font-size:16px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.05em">Budget Overview</h2>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:0 8px 16px 0" width="33%">
                <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Total Budget</p>
                <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#111827">${fmt(TOTAL_BUDGET)}</p>
              </td>
              <td style="padding:0 8px 16px" width="33%">
                <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Total Spent</p>
                <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:${pctUsed >= 100 ? "#dc2626" : "#111827"}">${fmt(totalSpent)}</p>
              </td>
              <td style="padding:0 0 16px" width="33%">
                <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">${overBudget ? "Over Budget" : "Remaining"}</p>
                <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:${overBudget ? "#dc2626" : "#059669"}">${fmt(Math.abs(remaining))}</p>
              </td>
            </tr>
          </table>
          <!-- Progress bar -->
          <div style="background:#e5e7eb;border-radius:999px;height:8px;overflow:hidden;margin-bottom:6px">
            <div style="background:${pctUsed >= 100 ? "#dc2626" : pctUsed >= 85 ? "#f59e0b" : "#1d4ed8"};width:${Math.min(pctUsed, 100)}%;height:100%;border-radius:999px"></div>
          </div>
          <p style="margin:0 0 0;font-size:13px;color:#6b7280">${pctUsed}% of budget used &mdash; ${budgetLine}</p>
        </td></tr>

        <!-- Category Breakdown -->
        <tr><td style="padding:28px 32px 0">
          <h2 style="margin:0 0 16px;font-size:16px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.05em">Category Breakdown</h2>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <th style="text-align:left;font-size:12px;font-weight:500;color:#9ca3af;padding-bottom:6px">Category</th>
              <th style="text-align:right;font-size:12px;font-weight:500;color:#9ca3af;padding-bottom:6px">Spent</th>
              <th style="text-align:right;font-size:12px;font-weight:500;color:#9ca3af;padding-bottom:6px">Budget</th>
              <th style="text-align:right;font-size:12px;font-weight:500;color:#9ca3af;padding-bottom:6px">Status</th>
            </tr>
            ${categoryRows}
          </table>
        </td></tr>

        <!-- Top 5 Expenses -->
        ${
          top5.length > 0
            ? `<tr><td style="padding:28px 32px 0">
          <h2 style="margin:0 0 16px;font-size:16px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.05em">Top 5 Expenses</h2>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <th style="text-align:left;font-size:12px;font-weight:500;color:#9ca3af;padding-bottom:6px" width="24">#</th>
              <th style="text-align:left;font-size:12px;font-weight:500;color:#9ca3af;padding-bottom:6px">Description</th>
              <th style="text-align:left;font-size:12px;font-weight:500;color:#9ca3af;padding-bottom:6px">Category</th>
              <th style="text-align:right;font-size:12px;font-weight:500;color:#9ca3af;padding-bottom:6px">Amount</th>
              <th style="text-align:right;font-size:12px;font-weight:500;color:#9ca3af;padding-bottom:6px">By</th>
            </tr>
            ${top5Rows}
          </table>
        </td></tr>`
            : ""
        }

        <!-- Contributions Split -->
        <tr><td style="padding:28px 32px 0">
          <h2 style="margin:0 0 16px;font-size:16px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.05em">Contributions</h2>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:12px 16px;background:#f8fafc;border-radius:8px;margin-right:8px" width="48%">
                <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Chege</p>
                <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#111827">${fmt(chegeContributed)}</p>
                <p style="margin:4px 0 0;font-size:12px;color:${chegeContributed >= CHEGE_TARGET ? "#059669" : "#6b7280"}">
                  Target: ${fmt(CHEGE_TARGET)} ${chegeContributed >= CHEGE_TARGET ? "✓" : `· Gap: ${fmt(chegeGap)}`}
                </p>
              </td>
              <td width="4%"></td>
              <td style="padding:12px 16px;background:#f8fafc;border-radius:8px" width="48%">
                <p style="margin:0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Lydiah</p>
                <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#111827">${fmt(lydiahContributed)}</p>
                <p style="margin:4px 0 0;font-size:12px;color:${lydiahContributed >= LYDIAH_TARGET ? "#059669" : "#6b7280"}">
                  Target: ${fmt(LYDIAH_TARGET)} ${lydiahContributed >= LYDIAH_TARGET ? "✓" : `· Gap: ${fmt(lydiahGap)}`}
                </p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:28px 32px">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
            This digest was sent automatically on the 1st of each month.<br/>
            Open the <a href="${process.env.APP_URL ?? "https://family-budget.repl.co"}" style="color:#1d4ed8">Family Budget app</a> to see full details.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendMonthlyDigest(
  month: number,
  year: number,
  opts: { force?: boolean } = {},
): Promise<{ id: string; to: string[]; skipped?: boolean }> {
  logger.info({ month, year, force: opts.force }, "Building monthly digest");

  // ── Idempotency guard — one send per (month, year) ────────────────────────
  // Uses a DB unique constraint so concurrent instances cannot double-send.
  if (opts.force) {
    await db
      .delete(digestSendsTable)
      .where(sql`${digestSendsTable.month} = ${month} AND ${digestSendsTable.year} = ${year}`);
  }

  const claimed = await db
    .insert(digestSendsTable)
    .values({ month, year })
    .onConflictDoNothing()
    .returning({ id: digestSendsTable.id });

  if (claimed.length === 0) {
    // Another instance already claimed this month — skip silently.
    logger.info({ month, year }, "Digest already sent for this month — skipping");
    return { id: "already-sent", to: [], skipped: true };
  }

  const claimId = claimed[0].id;

  // ── Gather data concurrently ──────────────────────────────────────────────
  const [spentRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${expensesTable.amount}), 0)` })
    .from(expensesTable)
    .where(
      sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${month} AND EXTRACT(YEAR FROM ${expensesTable.date}) = ${year}`,
    );

  const [categories, spentByCategory, top5, contribs, users, memberRows] = await Promise.all([
    db.select().from(budgetCategoriesTable).orderBy(budgetCategoriesTable.priority),
    db
      .select({ category: expensesTable.category, total: sql<number>`COALESCE(SUM(${expensesTable.amount}), 0)` })
      .from(expensesTable)
      .where(
        sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${month} AND EXTRACT(YEAR FROM ${expensesTable.date}) = ${year}`,
      )
      .groupBy(expensesTable.category),
    db
      .select({
        description: expensesTable.description,
        amount: expensesTable.amount,
        category: expensesTable.category,
        paidByName: usersTable.firstName,
        date: expensesTable.date,
      })
      .from(expensesTable)
      .leftJoin(usersTable, eq(expensesTable.paidById, usersTable.id))
      .where(
        sql`EXTRACT(MONTH FROM ${expensesTable.date}) = ${month} AND EXTRACT(YEAR FROM ${expensesTable.date}) = ${year}`,
      )
      .orderBy(desc(expensesTable.amount))
      .limit(5),
    db
      .select({
        userId: contributionsTable.userId,
        total: sql<number>`COALESCE(SUM(${contributionsTable.amount}), 0)`,
      })
      .from(contributionsTable)
      .where(sql`${contributionsTable.month} = ${month} AND ${contributionsTable.year} = ${year}`)
      .groupBy(contributionsTable.userId),
    db.select().from(usersTable),
    db.select().from(membersTable),
  ]);

  // ── Resolve contributions ─────────────────────────────────────────────────
  let chegeContributed = 0;
  let lydiahContributed = 0;
  for (const c of contribs) {
    const user = users.find((u) => u.id === c.userId);
    const name = (user?.firstName ?? "").toLowerCase();
    if (name.includes("chege") || name.includes("george")) chegeContributed += Number(c.total);
    else if (name.includes("lydiah") || name.includes("lydia")) lydiahContributed += Number(c.total);
    else if (chegeContributed === 0) chegeContributed += Number(c.total);
    else lydiahContributed += Number(c.total);
  }

  // ── Recipient emails ──────────────────────────────────────────────────────
  const memberEmails: string[] = [];
  for (const m of memberRows) {
    const u = users.find((u) => u.id === m.userId);
    if (u?.email) memberEmails.push(u.email);
  }
  const envEmails = (process.env.DIGEST_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const to = [...new Set([...memberEmails, ...envEmails])];

  if (to.length === 0) {
    throw new Error(
      "No recipient emails found. Set the DIGEST_EMAILS environment variable (comma-separated) " +
        "or ensure your user account has an email address.",
    );
  }

  // ── Build HTML ────────────────────────────────────────────────────────────
  const totalSpent = Number(spentRow.total);
  const remaining = TOTAL_BUDGET - totalSpent;
  const pctUsed = TOTAL_BUDGET > 0 ? Math.round((totalSpent / TOTAL_BUDGET) * 100) : 0;
  const spentMap = new Map(spentByCategory.map((s) => [s.category, Number(s.total)]));
  const label = monthName(month, year);

  const html = buildEmailHtml({
    label,
    totalSpent,
    remaining,
    pctUsed,
    categories,
    spentMap,
    top5: top5.map((e) => ({
      ...e,
      date: String(e.date), // Drizzle `date` columns return ISO strings, not Date objects
    })),
    chegeContributed,
    lydiahContributed,
  });

  // ── Send via Resend ───────────────────────────────────────────────────────
  const connectors = new ReplitConnectors();
  const from = process.env.DIGEST_FROM_EMAIL ?? "Family Budget <onboarding@resend.dev>";

  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: `Family Budget — ${label} Summary`,
      html,
    }),
  });

  const result = (await response.json()) as { id?: string; message?: string; name?: string };
  if (!response.ok) {
    // Release the claim so the next cron tick can retry.
    await db.delete(digestSendsTable).where(sql`${digestSendsTable.id} = ${claimId}`);
    throw new Error(`Resend API error (${response.status}): ${JSON.stringify(result)}`);
  }

  // Persist the Resend email ID and recipients for the audit log.
  await db
    .update(digestSendsTable)
    .set({ emailId: result.id, recipients: to })
    .where(sql`${digestSendsTable.id} = ${claimId}`);

  logger.info({ emailId: result.id, to, month, year }, "Monthly digest sent");
  return { id: result.id ?? "unknown", to };
}

/**
 * Returns the previous month + year relative to a given date (defaults to now).
 */
export function previousMonth(from = new Date()): { month: number; year: number } {
  const d = new Date(from.getFullYear(), from.getMonth() - 1, 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}
