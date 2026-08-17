#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Push Drizzle schema to the database (creates/alters tables, non-destructive)
pnpm --filter @workspace/db run push
