---
name: OTA bundling fix for RN 0.81.5 + pnpm + hermesc
description: How to fix hermesc "invalid statement encountered" / "private properties are not supported" during expo export / eas update
---

## The Problem
`expo export --platform android` (used by `eas update`) fails with hermesc errors:
- "invalid statement encountered" for class declarations
- "private properties are not supported" for private class fields (#x, #y etc.)

Root cause: react-native 0.81.5 ships Fabric/DOM APIs (`DOMRect`, `ReadOnlyNode`, `ReactFabricHostComponent`, etc.) using ES6 class syntax, Flow types, and private fields. The hermesc binary bundled with RN 0.81.5 can't compile these patterns.

## Fix 1: metro.config.js — pnpm-compatible transformIgnorePatterns

Standard patterns break with pnpm's double node_modules store path:
`/workspace/node_modules/.pnpm/<pkg@ver>/node_modules/<pkg>/...`

A naïve `node_modules/(?!react-native|...)` matches at `.pnpm` (not in allowlist) → all packages excluded from Babel.

**Correct pattern**: `node_modules/(?!\.pnpm)(?!react-native|@react-native|expo|...)`

Two rules:
1. `(?!\.pnpm)` — skip the pnpm store directory level
2. NO trailing slash after the closing `)` — after consuming `node_modules/`, the cursor is at the first letter of the package name, not another `/`

## Fix 2: babel.config.js — hermes-v0 transform profile

The default hermes-stable/hermes-v1 profile preserves class syntax for Hermes to handle natively. But hermesc in RN 0.81.5 rejects ES6 classes in practice during OTA export.

Solution: `unstable_transformProfile: 'hermes-v0'` in babel-preset-expo options. This adds `@babel/plugin-transform-classes`, `@babel/plugin-transform-class-properties`, and `@babel/plugin-transform-private-methods`.

**Why:** hermes-v0 profile outputs prototype-based ES5 that hermesc compiles without errors. The device Hermes runtime (from APK) is fully compatible with the resulting bytecode.

## Fix 3: metro.config.js — add workspace/node_modules to watchFolders

When `EXPO_USE_METRO_WORKSPACE_ROOT` is auto-activated (triggered by pnpm exec in a workspace), Metro sets serverRoot = workspace root and needs to resolve files from the pnpm store. The watchFolders must include `path.resolve(workspaceRoot, 'node_modules')` (the pnpm store parent) alongside `lib/`.

Without this, `pnpm exec expo export` fails with "Unable to resolve module expo-router/entry.js" before hermesc even runs.

## Verification
Both of these must produce `dist/_expo/static/js/android/*.hbc` with no errors:
- `cd artifacts/mobile-budget && npx expo export --platform android --clear`
- `cd artifacts/mobile-budget && pnpm exec expo export --platform android --clear`
