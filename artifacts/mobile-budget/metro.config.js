const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// During `expo export` / `eas update`, Metro's hasher needs access to pnpm
// store files whose SHA-1 it can't compute unless they're in a watched folder.
// During the dev server we must NOT watch the whole pnpm store — Replit temp
// files in other workspace dirs cause inotify watch-limit crashes.
// Detect the export mode by checking the process argv.
// expo export  → argv contains 'export'
// expo export:embed (EAS build) → argv contains 'export:embed'
const isExportMode = process.argv.some((a) => a === 'export' || a === 'export:embed');

config.watchFolders = isExportMode
  ? [
      path.resolve(workspaceRoot, 'lib'),
      path.resolve(workspaceRoot, 'node_modules', '.pnpm'),
    ]
  : [
      path.resolve(workspaceRoot, 'lib'),
    ];

// Resolve packages from both the artifact's own node_modules and the root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// When `expo export` (used by `eas update`) runs, Metro resolves the app
// entry from the workspace root instead of projectRoot. pnpm symlink targets
// stored as relative paths then point to the wrong location.
// This custom resolver intercepts any module Metro can't find through its
// normal paths and retries the lookup anchored to the app's own node_modules.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Try default resolution first (works for the dev server).
  try {
    const result = originalResolveRequest
      ? originalResolveRequest(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
    if (result) return result;
  } catch {
    // fall through to manual retry below
  }

  // Fallback: resolve via the local node_modules directory first (keeps paths
  // within projectRoot so Metro's hasher can compute SHA-1 without the pnpm
  // store being in watchFolders), then fall back to the workspace root.
  const fs = require('fs');
  const searchBases = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ];
  for (const base of searchBases) {
    try {
      // Resolve without following symlinks when the local node_modules copy exists.
      // This keeps the returned path inside projectRoot for Metro's SHA-1 hasher.
      const parts = moduleName.split('/');
      const pkgName = moduleName.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
      const subpath = moduleName.startsWith('@') ? parts.slice(2).join('/') : parts.slice(1).join('/');
      const localPkg = path.resolve(base, pkgName);
      if (fs.existsSync(localPkg)) {
        if (subpath) {
          for (const ext of ['.js', '.ts', '.tsx', '.jsx', '.json', '']) {
            const candidate = path.resolve(localPkg, subpath) + ext;
            if (fs.existsSync(candidate)) return { filePath: candidate, type: 'sourceFile' };
          }
        } else {
          // Let require.resolve handle main field, but map back through local path.
          const realResolved = require.resolve(moduleName, { paths: [base] });
          const realPkg = fs.realpathSync(localPkg);
          const rel = path.relative(realPkg, realResolved);
          const localResolved = path.resolve(localPkg, rel);
          if (fs.existsSync(localResolved)) return { filePath: localResolved, type: 'sourceFile' };
          return { filePath: realResolved, type: 'sourceFile' };
        }
      }
    } catch {
      // not found in this base; try next
    }
  }

  // Nothing worked — re-throw to get Metro's normal error message.
  return context.resolveRequest(context, moduleName, platform);
};

// Force Metro to run Babel on packages that use private class fields or class
// declarations that the Hermes bytecode compiler (hermesc) rejects during
// `expo export` / `eas update`.
//
// Two issues addressed here:
//
// 1. pnpm stores packages at node_modules/.pnpm/<pkg@ver>/node_modules/<pkg>/…
//    A naïve allowlist pattern matches at the first "node_modules/" segment
//    (before ".pnpm") because ".pnpm" is not in the allow-list, so every
//    package in the pnpm store is excluded from Babel transformation.
//    The (?!\.pnpm) lookahead causes the regex engine to skip that segment so
//    evaluation only happens at the inner "node_modules/<pkg-name>" position.
//    Note: the pattern must NOT have a trailing "/" after the closing ")" —
//    after consuming "node_modules/" the next character is the first letter of
//    the package name, not another slash.
//
// 2. react-native 0.81.5 ships Fabric/DOM APIs (DOMRect, ReadOnlyNode,
//    ReactFabricHostComponent, etc.) using ES6 class declarations, Flow types,
//    and private class fields.  Without Babel those files reach hermesc raw;
//    hermesc rejects class syntax with "invalid statement encountered" and
//    private fields with "private properties are not supported".
//    With the hermes-v0 preset (see babel.config.js) Babel transforms all of
//    these to prototype-based ES5 before hermesc sees them.
config.transformIgnorePatterns = [
  'node_modules/(?!\\.pnpm)(?!' +
    [
      'react-native',
      '@react-native(-community)?',
      '@react-native/[^/]+',
      'expo',
      '@expo/[^/]+',
      '@expo-google-fonts/[^/]+',
      '@unimodules/[^/]+',
      'unimodules',
      'react-native-reanimated',
      'react-native-gesture-handler',
      'react-native-screens',
      'react-native-safe-area-context',
      'react-native-svg',
      'react-native-keyboard-controller',
      'react-native-worklets',
      'react-native-web',
      '@react-navigation/[^/]+',
    ].join('|') +
    ')',
];

module.exports = config;
