---
name: OTA export for pnpm workspace
description: Recipe for running expo export and eas update from a pnpm monorepo in Replit without Metro resolution errors.
---

## Problem
`expo export` / `eas update` use the **workspace root** as the Metro project root (not `artifacts/mobile-budget`). This causes two cascading failures:

1. **pnpm symlink paths resolve wrong** — Metro stores symlink targets as relative paths. From the workspace root, `../../node_modules/.pnpm/…` points outside the repo instead of back to the pnpm store.
2. **SHA-1 hasher rejects pnpm store files** — files outside `projectRoot` and `watchFolders` can't be hashed by Metro.
3. **hermesc fails on private class fields** — `react-native@0.81.5/src/private/webapis/geometry/DOMRectReadOnly.js` uses `#x #y #width #height` private fields; the hermesc binary in that RN version doesn't support them.

## Fix (applied in metro.config.js + package.json + expo-entry.js)

### 1. Local entry-point wrapper (`artifacts/mobile-budget/expo-entry.js`)
```js
import 'expo-router/entry-classic';
```
`package.json` `"main"` changed from `"expo-router/entry"` to `"./expo-entry.js"`.  
Metro loads this as a direct project-root file — no symlink resolution needed.

### 2. metro.config.js — export-mode watchFolders
```js
const isExportMode = process.argv.some((a) => a === 'export' || a === 'export-embed');
config.watchFolders = isExportMode
  ? [path.resolve(workspaceRoot, 'lib'), path.resolve(workspaceRoot, 'node_modules', '.pnpm')]
  : [path.resolve(workspaceRoot, 'lib')];
```
Dev server must NOT watch `.pnpm` — Replit temp files cause inotify watch-limit crashes.

### 3. metro.config.js — custom resolveRequest fallback
```js
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try { return /* default resolution */ } catch {}
  for (const base of [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')]) {
    try { return { filePath: require.resolve(moduleName, { paths: [base] }), type: 'sourceFile' }; } catch {}
  }
  return context.resolveRequest(context, moduleName, platform); // re-throw
};
```

## Export + push recipe
```bash
cd artifacts/mobile-budget
# Export (skip Hermes bytecode — hermesc can't handle DOMRectReadOnly.js private fields)
node_modules/.bin/expo export --platform android --output-dir /tmp/expo-dist --no-bytecode --dump-assetmap

# Push OTA update (skip re-bundling to avoid hermesc)
npx eas update --channel preview --platform android \
  --skip-bundler --input-dir /tmp/expo-dist \
  --message "..." --non-interactive
```

**Why** `--no-bytecode`: the hermesc binary in RN 0.81.5 rejects ES2022 private class fields (`#x`, `#y`) in `react-native/src/private/webapis/geometry/DOMRectReadOnly.js`. OTA JS-only updates work fine without bytecode.

## babel-preset-expo version (critical)
The package.json MUST have `"babel-preset-expo": "~54.0.10"`, NOT `^57.0.6`.  
`57.x` targets Expo 57 and produces output that hermesc 0.12.0 (bundled with react-native@0.81.5) cannot compile — causes "private properties are not supported" during `expo export` and the EAS build's "Bundle JavaScript" step.  
`54.0.12` (resolved from `~54.0.10`) produces hermesc-compatible `.hbc` output with zero errors.

## Metro SHA-1 / resolveRequest rule
The custom `resolveRequest` fallback in metro.config.js must NOT return absolute pnpm store paths (e.g. `/node_modules/.pnpm/…`). Metro's hasher fails with "Failed to get the SHA-1" for any path outside `watchFolders`. Always return paths through the LOCAL `node_modules/` directory (without following symlinks) so the path stays within `projectRoot`.

`expo-entry.js` uses `import './node_modules/expo-router/entry-classic.js'` (relative, stays in projectRoot) instead of `import 'expo-router/entry-classic'` (resolved to absolute pnpm path by require.resolve).

## Channel
EAS channel `preview` — created automatically when `eas update --channel preview` ran for the first time.  
EAS project: `effa7c71-0641-41fb-ba15-219661b89ab8` (slug: `workspace`, team: `optimumprimesolutions`).
