#!/usr/bin/env node
/**
 * Prepares the Node backend so Tauri can ship it inside the desktop app.
 *
 * Output (git-ignored):
 *   frontend/src-tauri/resources/node/node(.exe)   ← the Node runtime running this script
 *   frontend/src-tauri/resources/backend/          ← runtime backend files + production node_modules
 *
 * Run it on the same OS/arch you are building for (CI does this per matrix job):
 *   node scripts/prepare-backend-bundle.mjs
 *
 * No secrets are copied: no .env, no data/, no browser_profiles/, no seed file with cookies.
 * Chromium is NOT bundled; the app downloads it into the user's app-data folder on first launch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'backend');
const OUT = path.join(ROOT, 'frontend', 'src-tauri', 'resources');
const OUT_NODE = path.join(OUT, 'node');
const OUT_BACKEND = path.join(OUT, 'backend');

// Only the modules server.js actually loads (directly or transitively).
const RUNTIME_FILES = [
  'server.js',
  'paths.js',
  'db.js',
  'sqlite-pool.js',
  'state-store.js',
  'fb-buff-tool.js',
  'fb-feed-hunter.js',
  'fb-posted-time.js',
  'browser-pool.js',
  'avatar-tool.js',
  'device-fingerprints.js',
  'telegram-alert.js',
  'page-post-registry.js',
  'ai-seeding.js',
  'telemetry.js',
  'package.json',
  'package-lock.json',
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT_NODE, { recursive: true });
fs.mkdirSync(OUT_BACKEND, { recursive: true });

// 1) Node runtime: copy the binary that is running this script (CI pins Node 22).
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
fs.copyFileSync(process.execPath, path.join(OUT_NODE, nodeName));
if (process.platform !== 'win32') fs.chmodSync(path.join(OUT_NODE, nodeName), 0o755);
console.log(`[bundle] node ${process.version} (${process.platform}-${process.arch}) → resources/node/${nodeName}`);

// 2) Backend source files.
for (const f of RUNTIME_FILES) {
  const from = path.join(SRC, f);
  if (!fs.existsSync(from)) throw new Error(`Missing backend file: ${f}`);
  fs.copyFileSync(from, path.join(OUT_BACKEND, f));
}

// Fail early if server.js requires a local module that is not in the list above.
const missing = new Set();
for (const f of RUNTIME_FILES.filter((x) => x.endsWith('.js'))) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const m of code.matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)) {
    const name = m[1].endsWith('.js') ? m[1] : `${m[1]}.js`;
    if (!RUNTIME_FILES.includes(name)) missing.add(`${name} (required by ${f})`);
  }
}
if (missing.size) throw new Error(`Add to RUNTIME_FILES: ${[...missing].join(', ')}`);

// 3) Production dependencies only (Playwright's browser download is skipped; done at first launch).
execSync('npm ci --omit=dev --no-audit --no-fund', {
  cwd: OUT_BACKEND,
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
});

console.log('[bundle] backend ready → frontend/src-tauri/resources/backend');
