/**
 * sqlite-pool.js - Embedded SQLite storage for the desktop app (no MySQL install needed).
 * Uses Node's built-in `node:sqlite` (Node >= 22.13) and exposes the small part of the
 * mysql2/promise pool API the backend uses: execute(sql, params) / query(sql, params)
 * resolving to [rows] for reads and [{ insertId, affectedRows }] for writes.
 *
 * The MySQL statements in db.js / server.js are translated on the fly (see translate()).
 * All datetimes are stored as UTC text 'YYYY-MM-DD HH:MM:SS.sss' and returned as Date objects,
 * like mysql2 does.
 */
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  password TEXT DEFAULT '',
  password_hash TEXT,
  full_name TEXT,
  role TEXT DEFAULT 'ADMIN',
  status TEXT DEFAULT 'ACTIVE',
  disabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS social_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 1,
  platform TEXT DEFAULT 'FACEBOOK_PROFILE',
  platform_account_id TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  page_name TEXT NOT NULL DEFAULT '',
  account_type TEXT DEFAULT 'PERSONAL_PROFILE_COOKIE',
  proxy_url TEXT,
  token_status TEXT DEFAULT 'OK',
  token_checked_at TEXT,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);
CREATE INDEX IF NOT EXISTS idx_user_platform ON social_accounts (user_id, platform);
CREATE INDEX IF NOT EXISTS idx_platform_account_id ON social_accounts (platform_account_id);

CREATE TABLE IF NOT EXISTS buff_monitors (
  id TEXT PRIMARY KEY,
  user_id INTEGER DEFAULT 1,
  target_type TEXT DEFAULT 'PAGE',
  target_name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  target_likes TEXT DEFAULT 'ALL',
  reaction_type TEXT DEFAULT 'RANDOM_POSITIVE',
  delay_minutes INTEGER DEFAULT 0,
  scan_interval_minutes INTEGER DEFAULT 10,
  via_mode TEXT DEFAULT 'ALL_VIAS',
  enable_comment INTEGER DEFAULT 0,
  comment_list TEXT,
  is_active INTEGER DEFAULT 1,
  last_scanned_at TEXT,
  total_posts_found INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);

CREATE TABLE IF NOT EXISTS buff_queue (
  id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  target_likes INTEGER DEFAULT 30,
  reaction_type TEXT DEFAULT 'RANDOM_POSITIVE',
  delay_minutes INTEGER DEFAULT 0,
  enable_comment INTEGER DEFAULT 0,
  comment_list TEXT,
  status TEXT DEFAULT 'WAITING',
  progress_likes INTEGER DEFAULT 0,
  progress_comments INTEGER DEFAULT 0,
  schedule_time TEXT,
  created_at TEXT DEFAULT (NOW()),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_queue_status_time ON buff_queue (status, schedule_time, id);

CREATE TABLE IF NOT EXISTS buff_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 1,
  target_url TEXT NOT NULL,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT DEFAULT (NOW())
);
CREATE INDEX IF NOT EXISTS idx_history_url_page ON buff_history (target_url, page_id);
CREATE INDEX IF NOT EXISTS idx_history_created_covering ON buff_history (created_at DESC, status, page_id);

CREATE TABLE IF NOT EXISTS buff_logs (
  id TEXT PRIMARY KEY,
  user_id INTEGER DEFAULT 1,
  run_type TEXT NOT NULL,
  target_url TEXT NOT NULL,
  reaction_type TEXT,
  engagement_mode TEXT,
  account_name TEXT,
  total_pages INTEGER DEFAULT 0,
  target_likes INTEGER DEFAULT NULL,
  success_count INTEGER DEFAULT 0,
  already_liked_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buff_logs_created ON buff_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_buff_logs_user_created ON buff_logs (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_logs_type_time ON buff_logs (run_type, created_at);

CREATE TABLE IF NOT EXISTS software_licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_contact TEXT DEFAULT '',
  hardware_hwid TEXT DEFAULT NULL,
  package_type TEXT DEFAULT '1_MONTH',
  max_vias INTEGER DEFAULT 50,
  status TEXT DEFAULT 'ACTIVE',
  activated_at TEXT DEFAULT NULL,
  expires_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
);
CREATE INDEX IF NOT EXISTS idx_status ON software_licenses (status);
CREATE INDEX IF NOT EXISTS idx_hardware_hwid ON software_licenses (hardware_hwid);

CREATE TABLE IF NOT EXISTS telegram_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'SENT',
  telegram_message_id INTEGER NULL,
  error_message TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW())
);
CREATE INDEX IF NOT EXISTS idx_tg_created ON telegram_notifications (created_at DESC);

CREATE TABLE IF NOT EXISTS app_state (
  state_key TEXT NOT NULL PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT NOT NULL PRIMARY KEY,
  setting_value TEXT
);

CREATE TABLE IF NOT EXISTS facebook_page_accesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 1,
  personal_profile_id TEXT NOT NULL DEFAULT '',
  page_id TEXT NOT NULL,
  page_name TEXT,
  page_url TEXT,
  profile_name TEXT,
  verification_status TEXT DEFAULT 'UNVERIFIED',
  verification_message TEXT,
  active INTEGER DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW()),
  UNIQUE (personal_profile_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_page_profile_active ON facebook_page_accesses (personal_profile_id, active, page_id);
`;

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** UTC text 'YYYY-MM-DD HH:MM:SS.sss' (sortable, same width everywhere). */
function toSqlDateTime(d) {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
  );
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function toSqliteValue(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toSqlDateTime(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  // ISO strings (e.g. pagination cursors from the frontend) → same text format as stored datetimes
  if (typeof v === 'string' && ISO_RE.test(v)) return toSqlDateTime(new Date(v));
  if (typeof v === 'bigint' || typeof v === 'number' || typeof v === 'string') return v;
  if (Buffer.isBuffer(v)) return v;
  return JSON.stringify(v);
}

function fromSqliteRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && DATETIME_RE.test(v)) out[k] = new Date(`${v.replace(' ', 'T')}Z`);
    else if (typeof v === 'bigint') out[k] = Number(v);
    else out[k] = v;
  }
  return out;
}

const UNIT = { SECOND: 'seconds', MINUTE: 'minutes', HOUR: 'hours', DAY: 'days', MONTH: 'months', YEAR: 'years' };
const nowWithOffset = (sign, n, unit) =>
  `strftime('%Y-%m-%d %H:%M:%f', 'now', '${sign}${n} ${UNIT[unit.toUpperCase()] || 'days'}')`;

/**
 * Rewrites the MySQL dialect used in this codebase to SQLite. Returns null for
 * statements that must be skipped (MySQL DDL - the SQLite schema is created up front).
 */
function translate(sql) {
  let s = String(sql).trim();
  if (/^(CREATE\s+(TABLE|INDEX)|ALTER\s+TABLE)\b/i.test(s)) return null;

  s = s
    .replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, 'INSERT OR IGNORE INTO')
    .replace(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/gi, 'ON CONFLICT DO UPDATE SET')
    .replace(/\bVALUES\s*\(\s*`?(\w+)`?\s*\)/gi, (m, col, offset, whole) =>
      // VALUES(col) only inside the ON CONFLICT part means "the new value"
      whole.slice(0, offset).match(/ON CONFLICT DO UPDATE SET/i) ? `excluded.${col}` : m
    )
    .replace(/\bAS\s+UNSIGNED\b/gi, 'AS INTEGER')
    .replace(/\bAS\s+CHAR\b/gi, 'AS TEXT')
    .replace(/\bNOW\(\)\s*-\s*INTERVAL\s+(\d+)\s+(\w+)/gi, (_, n, u) => nowWithOffset('-', n, u))
    .replace(/\bNOW\(\)\s*\+\s*INTERVAL\s+(\d+)\s+(\w+)/gi, (_, n, u) => nowWithOffset('+', n, u))
    .replace(/\bDATE_SUB\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+(\w+)\s*\)/gi, (_, n, u) => nowWithOffset('-', n, u))
    .replace(/\bDATE_ADD\(\s*NOW\(\)\s*,\s*INTERVAL\s+(\d+)\s+(\w+)\s*\)/gi, (_, n, u) => nowWithOffset('+', n, u))
    .replace(/`/g, '"');
  return s;
}

function createSqlitePool(dbFile) {
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;');
  db.function('NOW', { deterministic: false }, () => toSqlDateTime(new Date()));
  db.exec(SCHEMA);

  const stmtCache = new Map();
  function prepare(sql) {
    let st = stmtCache.get(sql);
    if (!st) {
      st = db.prepare(sql);
      if (stmtCache.size > 500) stmtCache.clear();
      stmtCache.set(sql, st);
    }
    return st;
  }

  function run(sql, params = []) {
    const raw = String(sql).trim();

    if (/^SHOW\s+TABLES\b/i.test(raw)) {
      const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all();
      return [rows.map((r) => ({ Tables_in_sqlite: r.name }))];
    }
    const showIdx = raw.match(/^SHOW\s+INDEX\s+FROM\s+`?(\w+)`?\s+WHERE\s+Key_name\s*=\s*\?/i);
    if (showIdx) {
      const rows = db
        .prepare("SELECT name AS Key_name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name = ?")
        .all(showIdx[1], toSqliteValue(params[0]));
      return [rows];
    }

    const translated = translate(raw);
    if (translated === null) return [{ insertId: 0, affectedRows: 0, warningStatus: 0 }];

    const args = (Array.isArray(params) ? params : [params]).map(toSqliteValue);
    const st = prepare(translated);
    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(translated)) {
      return [st.all(...args).map(fromSqliteRow)];
    }
    const info = st.run(...args);
    return [{ insertId: Number(info.lastInsertRowid || 0), affectedRows: Number(info.changes || 0), warningStatus: 0 }];
  }

  // Async API (mysql2-compatible). Errors reject just like a MySQL failure would.
  const call = (sql, params) => {
    try {
      return Promise.resolve(run(sql, params));
    } catch (e) {
      return Promise.reject(e);
    }
  };

  return {
    driver: 'sqlite',
    file: dbFile,
    raw: db,
    execute: call,
    query: call,
    end: async () => db.close(),
  };
}

module.exports = { createSqlitePool, translate, toSqlDateTime };
