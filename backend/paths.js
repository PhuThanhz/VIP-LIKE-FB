/**
 * paths.js - Where the backend reads/writes its files.
 * Dev (no env set): backend/data and backend/browser_profiles, exactly as before.
 * Packaged desktop app: the Tauri shell sets VIPLIKE_DATA_DIR / VIPLIKE_PROFILES_DIR
 * to the user's app-data folder (the install folder is read-only on Windows).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.VIPLIKE_DATA_DIR || path.join(__dirname, 'data');
const PROFILES_DIR = process.env.VIPLIKE_PROFILES_DIR || path.join(__dirname, 'browser_profiles');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// .env lookup: <DATA_DIR>/.env first (packaged app), then backend/.env (dev).
// dotenv never overrides a value that is already set, so the first file wins.
const dotenv = require('dotenv');
for (const p of [path.join(DATA_DIR, '.env'), path.join(__dirname, '.env')]) {
  if (fs.existsSync(p)) dotenv.config({ path: p });
}

module.exports = { DATA_DIR, PROFILES_DIR };
