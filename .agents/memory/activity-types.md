---
name: Activity type constants
description: Shared ACTIVITY_TYPE constants for the dashboard activity feed; prevents inline string drift between API, mobile, and web.
---

## Rule
Never use raw `'expense'` or `'contribution'` strings when checking `item.type` on activity feed items. Always import from the constants file.

## Files
- **Mobile**: `artifacts/mobile-budget/lib/activityTypes.ts`
- **Web**: `artifacts/family-budget/src/lib/activityTypes.ts`

```ts
export const ACTIVITY_TYPE = {
  EXPENSE: 'expense',
  CONTRIBUTION: 'contribution',
} as const;
export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];
```

## Consumers (already updated)
- `artifacts/mobile-budget/components/ActivityCard.tsx` — uses `ACTIVITY_TYPE.EXPENSE`
- `artifacts/family-budget/src/pages/activity.tsx` — uses `ACTIVITY_TYPE.EXPENSE`
- `artifacts/family-budget/src/pages/dashboard.tsx` — uses `ACTIVITY_TYPE.EXPENSE`

## Why
The API (`dashboard.ts`) returns `type: 'expense'` and `type: 'contribution'`. Inline string checks in mobile and web components drifted silently when one side changed. A single constant file means a rename is caught by TypeScript across all consumers.
