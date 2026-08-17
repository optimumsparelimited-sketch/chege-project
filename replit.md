# Family Budget

A shared kids' budget tracker for Chege and Lydiah covering Nathan, Keren, Hadassah & David. Both parents sign in, track expenses, record monthly contributions, and monitor spending against the KES 317,094/month joint budget.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/family-budget run dev` — run the web app (port 25043)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — session signing key

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Wouter routing, Recharts, TanStack Query
- API: Express 5
- Auth: Replit Auth (OpenID Connect + PKCE), sessions in PostgreSQL
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, drizzle-zod
- API codegen: Orval (from OpenAPI spec)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/auth.ts` — users and sessions tables
- `lib/db/src/schema/budget.ts` — budget_categories, expenses, contributions tables
- `artifacts/api-server/src/routes/` — backend route handlers
- `artifacts/family-budget/src/pages/` — dashboard, expenses, budget, contributions, activity, login
- `artifacts/family-budget/src/components/layout.tsx` — shared sidebar/nav
- `lib/replit-auth-web/` — browser auth hook (`useAuth`)

## Architecture decisions

- Income-proportional split: Chege 84.2% (KES 267,094), Lydiah 15.8% (KES 50,000)
- Budget total is KES 317,094/month across 14 categories in 5 priority tiers
- Budget categories are seeded at startup, not user-managed (stable reference data)
- Sessions stored in PostgreSQL via Replit Auth; no local auth (no passwords)
- All API routes require authentication (401 if not signed in)

## Product

- **Dashboard** — monthly budget vs spent hero card, contribution status per parent, category spending chart, activity feed
- **Expenses** — add/view/delete expenses by category and month
- **Budget** — 14 categories with progress bars, grouped by priority tier
- **Contributions** — record monthly deposits, track target vs contributed per parent
- **Activity** — unified feed of all expenses and contributions

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run codegen after every OpenAPI spec change before touching backend or frontend code
- `zod/v4` import path doesn't bundle with esbuild; use `zod` directly in api-server routes
- Budget categories are seeded via SQL — rerun the seed INSERT if the table is ever wiped

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See the `replit-auth` skill for auth flow details
