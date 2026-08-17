---
name: Bank balance invalidation
description: After any joint-account mutation (deposit, disbursement, delete), invalidate the joint-account query so all screens refresh immediately.
---

## Rule
After `createDeposit`, `createDisbursement`, or `deleteJointAccountTransaction` succeeds, call:
```ts
queryClient.invalidateQueries({ queryKey: getGetJointAccountQueryKey() });
```
**Do not** use `refetch()` alone — it only updates the calling screen's instance, leaving the home-screen balance card stale until the user manually pulls to refresh.

## Why
`useGetJointAccount` is used in both `bank.tsx` (bank tab) and `index.tsx` (home screen balance card). Both use separate React Query instances. A local `refetch()` only refreshes one; `invalidateQueries` broadcasts to all instances sharing the same query key.

## How to apply
- Import `useQueryClient` from `@tanstack/react-query` and `getGetJointAccountQueryKey` from `@workspace/api-client-react`.
- Call `await queryClient.invalidateQueries({ queryKey: getGetJointAccountQueryKey() })` in every mutation handler that changes the account balance.
- Already done in `artifacts/mobile-budget/app/(tabs)/bank.tsx`.
