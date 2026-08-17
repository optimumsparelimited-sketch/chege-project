// Local entry-point wrapper.
// Uses a relative path to the local node_modules symlink so Metro's file
// hasher can compute a SHA-1 without needing the pnpm store in watchFolders.
// This file exists so `expo export` / `eas update` can find the entry point
// even when Metro incorrectly uses the workspace root as the project root.
import './node_modules/expo-router/entry-classic.js';
