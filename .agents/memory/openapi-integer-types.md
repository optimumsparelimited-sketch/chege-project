---
name: OpenAPI integer types break Zod v3 codegen
description: Using type:integer in OpenAPI spec causes Orval to emit zod.int() which doesn't exist in Zod v3
---

**Rule:** In `lib/api-spec/openapi.yaml`, always use `type: number` for numeric fields, never `type: integer`.

**Why:** Orval maps OpenAPI `integer` to `zod.int()`, which is a Zod v4 API. The workspace catalog pins `zod: ^3.25.76`, so `zod.int()` doesn't exist and the post-codegen typecheck fails. Using `type: number` generates `zod.number()` which works on Zod v3.

**How to apply:** Replace any `type: integer` with `type: number` before running codegen. Integer constraints are enforced at the DB level via Drizzle `integer()` column type instead.
