---
name: Mobile deep link URL parsing
description: How Expo Linking.parse handles mobile-budget://auth?token=... URLs — hostname vs path bug
---

## Rule
When parsing `mobile-budget://auth?token=VALUE` with Expo's `Linking.parse()`, the segment `auth` is returned as `parsed.hostname`, **not** `parsed.path`. `parsed.path` is an empty string.

**Why:** URL spec treats everything after `://` and before the next `/` or `?` as the authority/host. Since there's no `/` path segment in `mobile-budget://auth?token=...`, `auth` becomes the host.

**How to apply:** Any code that checks `parsed.path === 'auth'` to detect the auth callback URL will silently fail — the token is never extracted and `fetchUser()` is never called. Use `parsed.hostname === 'auth'` instead. This applies in both the `login()` handler and any `Linking.getInitialURL()` cold-start handler.
