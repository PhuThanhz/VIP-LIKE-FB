/**
 * VIPLIKE RADIANT - BACKEND SERVER
 * Tích hợp trực tiếp với MySQL Workbench (viplike_radiant), Playwright Automation & Gemini AI
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const db = require('./db');
const store = require('./state-store');
const fbBuffTool = require('./fb-buff-tool');
const {
  isEmergencyStopped,
  setEmergencyStop,
  loadSettings: loadBuffSettings,
  saveSettings: saveBuffSettings,
  notifyViaDead,
  notifyBuffCompleted,
  notifyPostHunted,
  notifyQueueIdle,
  notifyQueueTrouble,
  sendAlert,
  formatDurationVi,
  startCommandListener,
  sendTelegramMessage,
} = require('./telegram-alert');
const {
  filterAvailablePagesForPost,
  getGlobalRegistryStats,
  normalizeFbPostUrl,
  clearPostInteractions,
} = require('./page-post-registry');
const { generateSeedingComments } = require('./ai-seeding');
const avatarTool = require('./avatar-tool');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Trong vài giây đầu, dữ liệu đang được nạp từ MySQL: chặn request để không đọc/ghi lệch dữ liệu
app.use((req, res, next) => {
  if (req.method === 'OPTIONS' || store.isReady()) return next();
  return res.status(503).json({ success: false, error: 'Hệ thống đang khởi động, vui lòng thử lại sau vài giây.' });
});

// Đảm bảo thư mục lưu trữ dữ liệu tồn tại
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// =============================================================================
// 1. DATA HELPERS (QUEUE, HISTORY, MONITORS)
//    Lưu qua state-store: MySQL (bảng app_state) là nguồn chính, file JSON trong data/ là bản dự phòng.
// =============================================================================

function loadBuffQueue() {
  const data = store.read('buff_queue');
  if (data && Array.isArray(data.items)) return data;
  console.warn('[BuffQueue] ⚠️ Dữ liệu hàng đợi sai định dạng, khởi tạo lại.');
  return store.write('buff_queue', { items: [] });
}

function saveBuffQueue(queueData) {
  store.write('buff_queue', queueData);
  syncBuffQueueToMysql(queueData).catch(() => {});
}

async function syncBuffQueueToMysql(queueData) {
  try {
    const p = db.getPool();
    const items = queueData?.items || [];
    for (const it of items) {
      if (!it.id) continue;
      const targetUrl = it.targetUrl || it.normalizedUrl || '';
      const targetLikes = Number(it.targetLikes) || 30;
      const reactionType = it.reactionType || 'RANDOM_POSITIVE';
      const delayMinutes = Number(it.delayMinutes) || 5;
      const enableComment = it.enableComment ? 1 : 0;
      const commentList = JSON.stringify(it.comments || []);
      let status = 'WAITING';
      if (it.status === 'COMPLETED') status = 'COMPLETED';
      else if (it.status === 'RUNNING') status = 'RUNNING';
      else if (it.status === 'FAILED') status = 'FAILED';
      else if (it.status === 'PAUSED') status = 'PAUSED';

      const progressLikes = Number(it.progress?.done ?? it.result?.success ?? 0);
      const progressComments = 0;
      const scheduleTime = it.runAfter ? new Date(it.runAfter) : new Date();
      const createdAt = it.addedAt ? new Date(it.addedAt) : new Date();
      const completedAt = it.finishedAt ? new Date(it.finishedAt) : null;

      await p.execute(
        `INSERT INTO buff_queue (id, target_url, target_likes, reaction_type, delay_minutes, enable_comment, comment_list, status, progress_likes, progress_comments, schedule_time, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           target_url = VALUES(target_url),
           target_likes = VALUES(target_likes),
           reaction_type = VALUES(reaction_type),
           status = VALUES(status),
           progress_likes = VALUES(progress_likes),
           completed_at = VALUES(completed_at)`,
        [
          it.id,
          targetUrl,
          targetLikes,
          reactionType,
          delayMinutes,
          enableComment,
          commentList,
          status,
          progressLikes,
          progressComments,
          scheduleTime,
          createdAt,
          completedAt,
        ]
      );
    }
  } catch (_) {}
}

function loadBuffHistory() {
  const data = store.read('buff_history');
  if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  return store.write('buff_history', {});
}

function saveBuffHistory(historyData) {
  store.write('buff_history', historyData);
  syncBuffHistoryToMysql(historyData).catch(() => {});
}

async function syncBuffHistoryToMysql(historyData) {
  try {
    const p = db.getPool();
    const entries = Object.entries(historyData || {});
    for (const [url, item] of entries) {
      const targetUrl = item.url || item.normalizedUrl || url;
      const reaction = item.reactionType || 'LIKE';
      const status = 'COMPLETED';
      const createdAt = item.lastBuffedAt ? new Date(item.lastBuffedAt) : new Date();
      await p.execute(
        `INSERT INTO buff_history (user_id, target_url, page_id, page_name, interaction_type, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [1, targetUrl, 'ALL_PAGES', `Đã tương tác (${item.totalSuccess || 1} lượt)`, reaction, status, createdAt]
      );
    }
  } catch (_) {}
}

function loadBuffMonitors() {
  const data = store.read('buff_monitors');
  if (data && Array.isArray(data.monitors)) return data;
  return { monitors: [] };
}

function saveBuffMonitors(data) {
  store.write('buff_monitors', data);
}

function parseTargetLikes(value, fallback = 30) {
  if (value === 'ALL' || value === 0 || value === '0') return 'ALL';
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseDelayMinutes(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

// =============================================================================
// 2. CONCURRENCY & LANE MANAGEMENT
// =============================================================================

const activeBuffTaskIds = new Set();
const activeBuffVias = new Set();
const MAX_PARALLEL_BUFF = 2;
const busyBuffLanes = new Set();
const buffLaneWaiters = [];

function getBuffParallelVias() {
  const n = parseInt(loadBuffSettings().buffParallelVias, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : 4;
}

function getMaxPagesPerPost() {
  const n = parseInt(loadBuffSettings().maxPagesPerPost, 10);
  return Number.isFinite(n) && n > 0 ? n : 150;
}

function pumpBuffLanes() {
  for (let i = 0; i < buffLaneWaiters.length; i++) {
    if (busyBuffLanes.size >= getBuffParallelVias()) return;
    const waiter = buffLaneWaiters[i];
    if (isEmergencyStopped()) {
      buffLaneWaiters.splice(i--, 1);
      waiter.reject(new Error('Dừng khẩn cấp'));
      continue;
    }
    if (busyBuffLanes.has(waiter.uid)) continue;
    buffLaneWaiters.splice(i--, 1);
    busyBuffLanes.add(waiter.uid);
    waiter.resolve();
  }
}

async function withBuffLane(uid, fn) {
  const key = uid || 'unknown';
  await new Promise((resolve, reject) => {
    buffLaneWaiters.push({ uid: key, resolve, reject });
    pumpBuffLanes();
  });
  try {
    return await fn();
  } finally {
    busyBuffLanes.delete(key);
    pumpBuffLanes();
  }
}

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

const deadBuffVias = new Map();
const DEAD_VIA_TTL_MS = 60 * 60 * 1000;
const DEAD_VIA_ERR_RE = /hết hạn|checkpoint|đăng nhập|xác minh/i;

// Khi một lượt chạy báo lỗi cookie: xác minh lại bằng phiên đăng nhập thật; nếu đúng là hết hạn/checkpoint
// thì ghi trạng thái vào MySQL (để giao diện hiện cảnh báo) và gửi Telegram. Tránh báo nhầm vì lỗi tạm thời.
async function confirmAndRecordDeadVia(via) {
  try {
    const status = await fbBuffTool.validateViaSession(via.cookieString, { proxyUrl: via.proxyUrl, timeoutMs: 18000 });
    if (status.isLive || (status.status !== 'EXPIRED' && status.status !== 'CHECKPOINT')) return;
    await db.updateTokenStatus(via.id, status.status).catch(() => {});
    notifyViaDead(
      { uid: via.uid, viaName: via.viaName, proxyUrl: via.proxyUrl, tokenStatus: status.status },
      status.status === 'CHECKPOINT' ? 'Facebook yêu cầu xác minh (checkpoint)' : 'Cookie hết hạn hoặc đã đăng xuất'
    ).catch(() => {});
  } catch (e) {
    console.warn(`[ViaHealth] ⚠️ Không xác minh được Via ${via.viaName}: ${e.message}`);
  }
}

/** Sau một lỗi lấy Page của Via: xác minh Cookie thật (tối đa 1 lần/giờ cho mỗi Via) và cảnh báo nếu đã chết */
function verifyViaAfterRunError(via) {
  if (!via?.uid || typeof via.id !== 'number' || !via.cookieString || isBuffViaDead(via.uid)) return;
  deadBuffVias.set(via.uid, Date.now() + DEAD_VIA_TTL_MS); // dùng làm mốc "vừa kiểm tra"
  confirmAndRecordDeadVia(via);
}

function isBuffViaDead(uid) {
  const until = deadBuffVias.get(uid);
  if (!until) return false;
  if (Date.now() > until) {
    deadBuffVias.delete(uid);
    return false;
  }
  return true;
}

async function resolveViaProxy(cookieString, explicitProxy = '') {
  if (explicitProxy) return explicitProxy;
  try {
    const vias = await db.getLiveVias();
    const targetUid = fbBuffTool.getUserIdFromCookie(cookieString);
    if (targetUid) {
      const found = vias.find((v) => v.uid === targetUid);
      if (found && found.proxyUrl) return found.proxyUrl;
    }
  } catch (e) {}
  return '';
}

// =============================================================================
// AUTHENTICATION, JWT (RFC 7519 HMAC-SHA256) & ACCESS CONTROL
// =============================================================================
const JWT_SECRET_FILE = path.join(DATA_DIR, '.jwt_secret');

// Mật khẩu lưu dạng: scrypt$<saltHex>$<hashHex>
const PASSWORD_HASH_PREFIX = 'scrypt$';
const SCRYPT_KEYLEN = 64;
const scryptAsync = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => (err ? reject(err) : resolve(key)))
  );

function isHashedPassword(stored) {
  return typeof stored === 'string' && stored.startsWith(PASSWORD_HASH_PREFIX);
}

function formatPasswordHash(salt, hash) {
  return `${PASSWORD_HASH_PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
}

function hashPasswordSync(plain) {
  const salt = crypto.randomBytes(16);
  return formatPasswordHash(salt, crypto.scryptSync(String(plain), salt, SCRYPT_KEYLEN));
}

async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  return formatPasswordHash(salt, await scryptAsync(String(plain), salt));
}

async function verifyPassword(plain, stored) {
  if (!isHashedPassword(stored)) return false;
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(String(plain), Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Khi chưa có users.json: tạo 1 ADMIN từ ADMIN_USERNAME / ADMIN_PASSWORD (env), thiếu thì sinh mật khẩu ngẫu nhiên
function createSeedAdmin() {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = crypto.randomBytes(12).toString('base64url');
    console.log(`\n================================================================`);
    console.log(`🔑 [Auth] Đã tạo tài khoản ADMIN mặc định (chỉ hiển thị 1 lần):`);
    console.log(`   Tên đăng nhập: ${username}`);
    console.log(`   Mật khẩu:      ${password}`);
    console.log(`👉 Hãy đăng nhập và đổi mật khẩu, hoặc đặt ADMIN_USERNAME / ADMIN_PASSWORD trong .env`);
    console.log(`================================================================\n`);
  }
  return {
    id: 1,
    username,
    password: hashPasswordSync(password),
    email: `${username}@viplike.vn`,
    fullName: 'Quản Trị Viên VIPLIKE',
    role: 'ADMIN',
  };
}

function loadUsers() {
  const data = store.read('users');
  if (Array.isArray(data) && data.length > 0) {
    // Chuyển mật khẩu dạng chữ thường (plaintext) sang scrypt một lần duy nhất
    const migrated = [];
    for (const u of data) {
      if (u.password && !isHashedPassword(u.password)) {
        u.password = hashPasswordSync(u.password);
        migrated.push(u.username);
      }
    }
    if (migrated.length > 0) {
      saveUsers(data);
      console.log(`[Auth] 🔐 Đã mã hóa mật khẩu (scrypt) cho tài khoản: ${migrated.join(', ')}`);
    }
    return data;
  }
  const seeded = [createSeedAdmin()];
  saveUsers(seeded);
  return seeded;
}

function saveUsers(users) {
  store.write('users', users);
  try {
    db.syncUsersToDb(users).catch(() => {});
  } catch (_) {}
}

function publicUser(user) {
  const { password, ...rest } = user;
  return rest;
}

// JWT_SECRET: ưu tiên env, nếu thiếu thì sinh ngẫu nhiên và lưu vào data/.jwt_secret (dùng lại khi khởi động lại)
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    if (fs.existsSync(JWT_SECRET_FILE)) {
      const saved = fs.readFileSync(JWT_SECRET_FILE, 'utf-8').trim();
      if (saved.length >= 32) return saved;
    }
  } catch (e) {}
  const secret = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(JWT_SECRET_FILE, secret, { encoding: 'utf-8', mode: 0o600 });
    console.log('[Auth] 🔑 Đã sinh JWT_SECRET ngẫu nhiên và lưu vào data/.jwt_secret');
  } catch (e) {
    console.warn('[Auth] ⚠️ Không lưu được data/.jwt_secret, phiên đăng nhập sẽ mất khi khởi động lại:', e.message);
  }
  return secret;
}

const JWT_SECRET = loadJwtSecret();

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function generateJwtToken(user, expiresInSeconds = 86400 * 10) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;
  const payload = {
    sub: user.username,
    id: user.id,
    email: user.email,
    fullName: user.fullName || user.username,
    role: user.role || 'USER',
    iat: now,
    exp,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwtToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Token hết hạn
    }
    return payload;
  } catch {
    return null;
  }
}

// Giới hạn đăng nhập sai trong 60 giây → 429:
//  - quá 5 lần theo IP + tên đăng nhập
//  - quá 20 lần theo riêng IP (chặn dò nhiều tên đăng nhập từ một máy)
const LOGIN_MAX_FAILURES = 5;
const LOGIN_IP_MAX_FAILURES = 20;
const LOGIN_WINDOW_MS = 60 * 1000;
const loginFailures = new Map(); // key -> { count, firstAt }

function getLoginRateKey(req, username) {
  return `${req.ip}|${String(username).trim().toLowerCase()}`;
}

function getLoginIpRateKey(req) {
  return `ip:${req.ip}`;
}

function getLoginRetryAfterSec(key, max = LOGIN_MAX_FAILURES) {
  const entry = loginFailures.get(key);
  if (!entry) return 0;
  const elapsed = Date.now() - entry.firstAt;
  if (elapsed >= LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return 0;
  }
  return entry.count >= max ? Math.ceil((LOGIN_WINDOW_MS - elapsed) / 1000) : 0;
}

// Tìm user theo thứ tự ưu tiên: username → email → alias (tránh khớp nhầm khi trùng chuỗi)
function findUserByLogin(users, value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  return (
    users.find((x) => String(x.username || '').toLowerCase() === v) ||
    users.find((x) => String(x.email || '').toLowerCase() === v) ||
    users.find((x) => Array.isArray(x.aliases) && x.aliases.some((a) => String(a).toLowerCase() === v)) ||
    null
  );
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.firstAt >= LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
  if (loginFailures.size > 5000) {
    for (const [k, v] of loginFailures) {
      if (now - v.firstAt >= LOGIN_WINDOW_MS) loginFailures.delete(k);
    }
  }
}

const authHandler = {
  login: async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!' });
      }

      const rateKey = getLoginRateKey(req, username);
      const ipRateKey = getLoginIpRateKey(req);
      const retryAfterSec = Math.max(
        getLoginRetryAfterSec(rateKey),
        getLoginRetryAfterSec(ipRateKey, LOGIN_IP_MAX_FAILURES)
      );
      if (retryAfterSec > 0) {
        res.set('Retry-After', String(retryAfterSec));
        return res.status(429).json({
          success: false,
          error: `Bạn đã đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${retryAfterSec} giây!`,
        });
      }

      const users = loadUsers();
      const user = findUserByLogin(users, username);

      // So khớp mật khẩu với hash scrypt (timing-safe)
      const isMatch = user ? await verifyPassword(password.trim(), user.password) : false;

      // Cùng một thông báo cho "không có tài khoản" và "sai mật khẩu" để không lộ tên đăng nhập nào tồn tại
      if (!user || !isMatch) {
        recordLoginFailure(rateKey);
        recordLoginFailure(ipRateKey);
        return res.status(401).json({
          success: false,
          error: 'Sai tên đăng nhập hoặc mật khẩu. Vui lòng kiểm tra lại!',
        });
      }

      loginFailures.delete(rateKey);

      // Sinh JWT chuẩn RFC 7519 HMAC-SHA256 (hạn 10 ngày)
      const token = generateJwtToken(user, 86400 * 10);
      return res.json({
        success: true,
        token,
        tokenType: 'Bearer',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName || user.username,
          role: user.role || 'USER',
        },
        data: {
          token,
          tokenType: 'Bearer',
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName || user.username,
          role: user.role || 'USER',
        },
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
  register: async (req, res) => {
    try {
      const { username, password, email, fullName } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!' });
      }
      const users = loadUsers();
      // Username/email mới không được trùng username, email hay alias của bất kỳ user nào
      if (findUserByLogin(users, username)) {
        return res.status(400).json({ success: false, error: 'Tên đăng nhập đã tồn tại!' });
      }
      if (email && findUserByLogin(users, email)) {
        return res.status(400).json({ success: false, error: 'Email đã được sử dụng!' });
      }
      const newUser = {
        id: Date.now(),
        username: username.trim(),
        password: await hashPassword(password.trim()),
        email: email || `${username.trim()}@viplike.vn`,
        fullName: fullName || username.trim(),
        role: 'USER',
      };
      users.push(newUser);
      saveUsers(users);
      const token = generateJwtToken(newUser, 86400 * 10);
      const safeUser = publicUser(newUser);
      return res.json({
        success: true,
        token,
        tokenType: 'Bearer',
        user: safeUser,
        data: { token, tokenType: 'Bearer', ...safeUser },
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
  me: (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
    if (!token) {
      return res.status(401).json({ success: false, authenticated: false, error: 'Yêu cầu đăng nhập. Chưa có mã xác thực JWT.' });
    }
    const decoded = verifyJwtToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, authenticated: false, error: 'Phiên đăng nhập (JWT) không hợp lệ hoặc đã hết hạn.' });
    }
    return res.json({
      success: true,
      authenticated: true,
      user: {
        id: decoded.id,
        username: decoded.sub || decoded.username,
        email: decoded.email,
        fullName: decoded.fullName,
        role: decoded.role,
      },
    });
  },
};

// Các route xác thực (Công khai) — register yêu cầu ADMIN, đăng ký sau middleware JWT bên dưới
app.post('/api/auth/login', authHandler.login);
app.post('/auth/login', authHandler.login);
app.get('/api/auth/me', authHandler.me);
app.get('/auth/me', authHandler.me);

// Middleware xác thực JWT bắt buộc cho toàn bộ API hệ thống
function authenticateJwt(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  const publicPaths = [
    '/api/auth/login',
    '/auth/login',
    '/api/auth/me',
    '/auth/me',
    '/api/db/test',
    '/db/test',
    '/api/health',
    '/health',
    '/api/license/activate',
    '/api/license/status',
    '/api/buff-cached-pages',
  ];

  const currentPath = req.path.toLowerCase();
  const isPublic = publicPaths.some(
    (p) => currentPath === p.toLowerCase() || currentPath === p.toLowerCase() + '/'
  );

  if (isPublic) return next();

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Yêu cầu đăng nhập. Không tìm thấy mã xác thực JWT (Bearer token).',
    });
  }

  const decoded = verifyJwtToken(token);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Phiên đăng nhập (JWT) không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
    });
  }

  req.user = decoded;
  next();
}

// Chỉ cho phép tài khoản ADMIN (dùng sau authenticateJwt)
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'Bạn không có quyền thực hiện thao tác này. Chỉ tài khoản ADMIN được phép!',
    });
  }
  next();
}

app.use(authenticateJwt);

// Tạo tài khoản mới: chỉ ADMIN
app.post('/api/auth/register', requireAdmin, authHandler.register);
app.post('/auth/register', requireAdmin, authHandler.register);

// Kiểm tra sức khỏe và tốc độ Proxy thời gian thực
app.post('/api/proxy/test', async (req, res) => {
  const { proxyUrl } = req.body;
  if (!proxyUrl || typeof proxyUrl !== 'string' || !proxyUrl.trim()) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp chuỗi Proxy cần kiểm tra' });
  }

  try {
    const result = await fbBuffTool.testProxy(proxyUrl.trim(), 8000);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy danh sách Proxy Pool từ cài đặt hệ thống
app.get('/api/proxy-pool', (req, res) => {
  try {
    const settings = loadBuffSettings();
    return res.json({ success: true, proxyPool: settings.proxyPool || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật danh sách Proxy Pool
app.post('/api/proxy-pool', (req, res) => {
  try {
    const { proxyPool } = req.body;
    if (!Array.isArray(proxyPool)) {
      return res.status(400).json({ success: false, error: 'proxyPool phải là một mảng chuỗi proxy' });
    }
    const cleanPool = proxyPool
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => Boolean(p));

    const updated = saveBuffSettings({ proxyPool: cleanPool });
    return res.json({ success: true, proxyPool: updated?.proxyPool || cleanPool });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Kiểm tra sức khỏe toàn bộ Proxy trong Pool song song
app.post('/api/proxy-pool/test', async (req, res) => {
  try {
    const { proxies } = req.body;
    const pool = Array.isArray(proxies) ? proxies : (loadBuffSettings().proxyPool || []);
    if (!pool.length) {
      return res.json({ success: true, results: [] });
    }

    const results = await Promise.all(
      pool.map(async (proxyStr) => {
        const health = await fbBuffTool.testProxyHealth(proxyStr, 6000);
        return {
          proxy: proxyStr,
          ...health,
        };
      })
    );
    return res.json({ success: true, results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// 3. API ROUTES - MYSQL WORKBENCH DATABASE
// =============================================================================

// Kiểm tra kết nối tới MySQL Workbench
app.get('/api/db/test', async (req, res) => {
  const result = await db.testConnection();
  return res.json(result);
});

// -----------------------------------------------------------------------------
// TÀI KHOẢN VIA: chuẩn hoá Cookie, che dữ liệu nhạy cảm, chặn trùng
// -----------------------------------------------------------------------------
const MYSQL_SAVE_WARNING =
  'Chưa lưu được vào MySQL, dữ liệu mới chỉ được lưu tạm trên máy này. Hãy kiểm tra kết nối MySQL rồi thử lại.';

/**
 * Nhận Cookie dạng chuỗi thường ("c_user=...; xs=...") hoặc "UID|PASS|2FA|COOKIE".
 * Trả về cookie đã tách sạch, UID, và valid=true khi có đủ c_user + xs.
 */
function normalizeFbCookie(input) {
  let cookie = String(input || '').trim();
  if (cookie.includes('|')) {
    const parts = cookie.split('|').map((p) => p.trim());
    const cookiePart = parts.find((p) => /c_user=/.test(p)) || parts.find((p) => /(?:^|;\s*)xs=/.test(p)) || '';
    const uidPart = /^[0-9]{6,}$/.test(parts[0]) ? parts[0] : '';
    cookie = cookiePart;
    if (cookie && uidPart && !/c_user=/.test(cookie)) cookie = `c_user=${uidPart}; ${cookie}`;
  }
  const uid = cookie.match(/(?:^|;\s*)c_user=([^;\s]+)/)?.[1] || '';
  const hasXs = /(?:^|;\s*)xs=[^;\s]+/.test(cookie);
  return { cookie, uid, valid: Boolean(uid && hasXs) };
}

function maskProxyUrl(proxy) {
  const v = String(proxy || '');
  if (!v) return '';
  if (v.includes('@')) return v.replace(/\/\/[^@]*@/, '//***@').replace(/^[^/@]*:[^/@]*@/, '***@');
  const parts = v.split(':');
  return parts.length > 2 ? `${parts[0]}:${parts[1]}:***` : v;
}

/** Tài khoản không phải ADMIN chỉ thấy UID, không thấy Cookie hay mật khẩu proxy */
function redactAccountForNonAdmin(acc) {
  const uid =
    (acc.cookieString || acc.accessToken || '').match(/(?:^|;\s*)c_user=([^;\s]+)/)?.[1] || acc.platformAccountId || '';
  const safeCookie = uid && /^[0-9]+$/.test(uid) ? `c_user=${uid}` : '';
  return { ...acc, cookieString: safeCookie, accessToken: safeCookie, proxyUrl: maskProxyUrl(acc.proxyUrl) };
}

function findViaByUid(rows, uid) {
  return rows.find((r) => {
    if (r.platform === 'FACEBOOK_GROUP') return false;
    const own = (r.cookieString || r.accessToken || '').match(/(?:^|;\s*)c_user=([^;\s]+)/)?.[1];
    return own === uid;
  });
}

// Lấy danh sách toàn bộ tài khoản Via & Fanpage từ MySQL Workbench
app.get('/api/connections', async (req, res) => {
  try {
    const accounts = await db.getSocialAccounts();
    const isAdmin = req.user?.role === 'ADMIN';
    return res.json(isAdmin ? accounts : accounts.map(redactAccountForNonAdmin));
  } catch (err) {
    console.error('[API /connections] ❌ Lỗi:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Thêm tài khoản Via mới vào MySQL Workbench (chỉ ADMIN)
app.post('/api/connections', requireAdmin, async (req, res) => {
  try {
    const {
      pageName = '',
      cookieString = '',
      proxyUrl = '',
      platform = 'FACEBOOK_PROFILE',
      accountType = 'PERSONAL_PROFILE_COOKIE',
    } = req.body;

    if (!String(cookieString).trim()) {
      return res.status(400).json({ success: false, error: 'Thiếu Cookie Facebook (cookieString)' });
    }

    let finalCookie = String(cookieString).trim();
    if (accountType === 'PERSONAL_PROFILE_COOKIE') {
      const norm = normalizeFbCookie(cookieString);
      if (!norm.valid) {
        return res.status(400).json({
          success: false,
          error: 'Cookie không hợp lệ: cần có đủ c_user và xs (hoặc dạng UID|PASS|2FA|COOKIE chứa 2 giá trị này).',
        });
      }
      finalCookie = norm.cookie;

      const existing = findViaByUid(await db.getSocialAccounts(), norm.uid);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: `Via này đã có trong hệ thống (${existing.pageName || norm.uid}). Dùng "Đổi Cookie" nếu muốn cập nhật.`,
          existingId: existing.id,
        });
      }
    }

    const created = await db.addSocialAccount({
      pageName,
      cookieString: finalCookie,
      proxyUrl,
      platform,
      accountType,
    });

    const { dbSaved, ...account } = created;
    return res.json({ success: true, account, ...(dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật tài khoản trong MySQL Workbench (chỉ ADMIN)
app.put('/api/connections/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { pageName, proxyUrl, tokenStatus } = req.body;
    let { cookieString } = req.body;
    if (cookieString !== undefined) {
      const norm = normalizeFbCookie(cookieString);
      if (!norm.valid) {
        return res.status(400).json({ success: false, error: 'Cookie không hợp lệ: cần có đủ c_user và xs.' });
      }
      cookieString = norm.cookie;
    }
    const result = await db.updateSocialAccount(id, { pageName, cookieString, proxyUrl, tokenStatus });
    return res.json({ success: true, ...(result.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật Cookie mới cho Via (theo UID) — chỉ ADMIN
app.post('/api/vias/update-cookie', requireAdmin, async (req, res) => {
  try {
    const { uid, cookieString, proxyUrl } = req.body;
    if (!cookieString || !String(cookieString).trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp chuỗi Cookie Facebook mới!' });
    }

    const norm = normalizeFbCookie(cookieString);
    if (!norm.valid) {
      return res.status(400).json({ success: false, error: 'Cookie không hợp lệ: cần có đủ c_user và xs.' });
    }
    const targetUid = uid || norm.uid;
    if (uid && /^[0-9]+$/.test(String(uid)) && norm.uid && String(uid) !== norm.uid) {
      return res.status(400).json({
        success: false,
        error: `Cookie này thuộc tài khoản ${norm.uid}, không khớp với Via ${uid}. Hãy kiểm tra lại.`,
      });
    }

    // 1. Cập nhật vào DB & Cache cho UID này
    const result = await db.updateViaCookieByUid(targetUid, norm.cookie, proxyUrl);

    // 2. Gỡ bỏ khỏi danh sách đen deadBuffVias để hàng đợi tự động sử dụng lại
    deadBuffVias.delete(targetUid);

    console.log(`[ViaManager] 🔄 Đã cập nhật Cookie mới thành công cho Via UID: ${targetUid}`);
    return res.json({
      success: true,
      message: `Đã cập nhật Cookie mới cho Via UID ${targetUid}`,
      ...(result?.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Xóa tài khoản khỏi MySQL Workbench
app.delete('/api/connections/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.deleteSocialAccount(id);
    return res.json({ success: true, ...(result.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lịch sử tương tác (mỗi lượt chạy một bản ghi) lưu trên MySQL Workbench
app.get('/api/buff-logs', async (req, res) => {
  try {
    const result = await db.getBuffLogs(req.query.limit);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Body: { log } cho 1 lượt chạy, hoặc { logs: [...] } khi chuyển dữ liệu cũ lên
app.post('/api/buff-logs', async (req, res) => {
  try {
    const { log, logs } = req.body || {};
    const input = Array.isArray(logs) ? logs.slice(0, 2000) : log;
    if (!input) {
      return res.status(400).json({ success: false, error: 'Thiếu dữ liệu log' });
    }
    const result = await db.saveBuffLogs(input);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/buff-logs', async (req, res) => {
  try {
    await db.clearBuffLogs();
    return res.json({ success: true });
  } catch (err) {
    return res.status(503).json({
      success: false,
      error: `Không xoá được lịch sử vì MySQL chưa kết nối: ${err.message}`,
    });
  }
});

// =============================================================================
// 4. API ROUTES - FANPAGE & BUFF INTERACTION
// =============================================================================

// Quét danh sách Fanpage từ Cookie nick mẹ (Profile Pages / New Page Experience)
app.post('/api/buff-get-pages', async (req, res) => {
  const { cookieString, forceRefresh = false, viaName = '', proxyUrl: explicitProxy = '' } = req.body;
  if (!cookieString) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString' });
  }
  try {
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const pages = await fbBuffTool.getManagedPages(cookieString, {
      forceRefresh: Boolean(forceRefresh),
      viaName,
      proxyUrl,
    });
    return res.json({ success: true, count: pages.length, pages });
  } catch (err) {
    console.error('[Buff API] ❌ Lỗi quét Page:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy danh sách Fanpage từ MySQL Workbench facebook_page_accesses (kèm trạng thái Avatar chuẩn)
app.get('/api/buff-cached-pages', async (req, res) => {
  try {
    const { uid } = req.query;
    const avatarCache = avatarTool.loadAvatarCache() || {};
    let pages = [];

    if (uid) {
      pages = fbBuffTool.getCachedPages(String(uid)) || [];
      if (!pages || pages.length === 0) {
        // Nạp trực tiếp từ bảng facebook_page_accesses trên MySQL Workbench
        try {
          pages = await db.getFacebookPageAccesses(1, String(uid));
        } catch (e) {}
      }
      if (!pages || pages.length === 0) {
        // Fallback: Tìm trong accounts_cache
        try {
          const cachedAccounts = db.loadAccountsCache() || [];
          const matched = cachedAccounts.filter(
            (a) =>
              a.platform === 'FACEBOOK_PAGE' &&
              ((a.cookieString && a.cookieString.includes(`c_user=${uid}`)) || (a.accessToken && a.accessToken.includes(`c_user=${uid}`)))
          );
          if (matched.length > 0) {
            pages = matched.map((m) => ({
              id: m.platformAccountId || m.pageId || String(m.id),
              name: m.pageName || `Fanpage ${m.id}`,
              url: `https://www.facebook.com/${m.platformAccountId || m.pageId || m.id}`,
            }));
          }
        } catch (e) {}
      }

      // Gắn trạng thái Avatar chi tiết cho từng Page
      const enrichedPages = pages.map((p) => {
        const id = String(p.id || p.pageId || p.platformAccountId);
        const av = avatarCache[id];
        const hasAvatar = Boolean(av && av.hasAvatar && !av.isSilhouette);
        return {
          id,
          name: p.name || p.pageName || `Fanpage ${id.slice(-4)}`,
          url: p.url || `https://www.facebook.com/${id}`,
          hasAvatar,
          isSilhouette: Boolean(!av || av.isSilhouette || !av.hasAvatar),
          avatarUrl: av?.avatarUrl || '',
        };
      });

      return res.json({ success: true, uid, count: enrichedPages.length, pages: enrichedPages });
    }

    // Nếu không truyền UID, ưu tiên nạp toàn bộ từ bảng facebook_page_accesses trên MySQL
    try {
      const dbPages = await db.getFacebookPageAccesses(1, null);
      if (dbPages.length > 0) {
        const enrichedList = dbPages.map((p) => {
          const id = String(p.id);
          const av = avatarCache[id];
          return {
            id,
            name: p.name,
            url: p.url,
            hasAvatar: Boolean(av && av.hasAvatar && !av.isSilhouette),
            isSilhouette: Boolean(!av || av.isSilhouette || !av.hasAvatar),
            avatarUrl: av?.avatarUrl || '',
          };
        });
        return res.json({ success: true, count: enrichedList.length, pages: enrichedList });
      }
    } catch (e) {}

    const allCache = fbBuffTool.loadPagesCache();
    return res.json({ success: true, cache: allCache });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lưu / cập nhật thủ công danh sách Page vào MySQL facebook_page_accesses và cache
app.post('/api/buff-cache-pages', async (req, res) => {
  try {
    const { uid, pages, viaName = '' } = req.body;
    if (!uid || !Array.isArray(pages)) {
      return res.status(400).json({ success: false, error: 'Thiếu uid hoặc pages' });
    }
    fbBuffTool.setCachedPages(String(uid), pages, viaName);
    await db.saveFacebookPageAccesses(pages, uid, viaName);
    return res.json({ success: true, message: `Đã lưu MySQL Workbench và cache ${pages.length} Page cho UID ${uid}` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Tạo bình luận tự nhiên theo ngữ cảnh bài viết bằng Gemini AI
app.post('/api/buff-ai-generate-comments', async (req, res) => {
  try {
    const { topic = 'GENERAL', postContent = '', postUrl = '', count = 8, tone = 'natural' } = req.body;
    const comments = await generateSeedingComments({ topic, postContent, postUrl, count, tone });
    return res.json({ success: true, count: comments.length, comments });
  } catch (err) {
    console.error('[AI Seeding API] ❌ Lỗi tạo comment AI:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Helper xác thực Bản quyền phần mềm (License Key) cho các tính năng tương tác chính
async function checkLicenseOrReject(req, res) {
  try {
    const hwid = req.headers['x-hardware-hwid'] || req.body?.hardwareHwid || req.query?.hardwareHwid;
    const active = await db.verifyLicenseActive(hwid);
    if (!active) {
      res.status(403).json({
        success: false,
        error: 'Bản quyền phần mềm chưa kích hoạt hoặc đã hết hạn thuê. Vui lòng vào mục "Cho Thuê & Bản Quyền" để kích hoạt License Key.',
      });
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[License Check] ⚠️ Bỏ qua lỗi kiểm tra license:', err.message);
    return true;
  }
}

// Buff Like & Comment (Đồng bộ)
app.post('/api/buff-like', async (req, res) => {
  if (!(await checkLicenseOrReject(req, res))) return;

  const {
    cookieString,
    targetUrl,
    reactionType = 'LIKE',
    selectedPages = [],
    delayMs = 1500,
    speedMode = 'NORMAL',
    enableLike = true,
    enableComment = false,
    enableHumanBehavior = true,
    fastSwitch = true,
    cooldownEvery = 15,
    cooldownDurationMs = 3500,
    comments = [],
    proxyUrl: explicitProxy = '',
    concurrency = 1,
    dripFeedMode = false,
    dripDurationMinutes = 30,
  } = req.body;

  if (!cookieString || !targetUrl) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc targetUrl' });
  }

  try {
    const sysSettings = loadBuffSettings();
    const proxyPool = Array.isArray(sysSettings.proxyPool) ? sysSettings.proxyPool : [];
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const laneUid = fbBuffTool.getUserIdFromCookie(cookieString);
    const startMs = Date.now();
    const result = await withBuffLane(laneUid, () =>
      fbBuffTool.buffLikesWithPages(cookieString, targetUrl, {
        reactionType,
        selectedPages,
        delayMs,
        speedMode,
        enableLike,
        enableComment,
        enableHumanBehavior,
        fastSwitch,
        cooldownEvery,
        cooldownDurationMs,
        comments,
        proxyUrl,
        proxyPool,
        concurrency: Math.max(1, Math.min(5, parseInt(concurrency, 10) || 1)),
        dripFeedMode: Boolean(dripFeedMode),
        dripDurationMinutes: parseInt(dripDurationMinutes, 10) || 30,
      })
    );

    const durationSec = Math.max(1, Math.round((Date.now() - startMs) / 1000));
    const totalCount = selectedPages?.length || result?.total || 0;
    const successCount = result?.successCount ?? (result?.details ? result.details.filter((d) => d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED').length : 0);
    const failedCount = result?.failedCount ?? (result?.details ? result.details.filter((d) => d.status === 'ERROR' || d.status === 'FAILED' || d.status === 'NO_BUTTON').length : 0);

    notifyBuffCompleted({
      targetUrl,
      success: successCount,
      total: totalCount,
      failed: failedCount,
      durationSec,
      reactionType,
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Lỗi gửi thông báo hoàn tất buff:', err.message));

    return res.json({ success: true, result });
  } catch (err) {
    console.error('[Buff API] ❌ Lỗi Buff Like/Comment:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Trạng thái phiên Buff trực tiếp đang chạy ngầm (hỗ trợ duy trì tiến trình khi người dùng F5 / reload trang)
let activeLiveBuffSession = null;

// Lấy thông tin phiên Buff trực tiếp đang chạy ngầm
app.get('/api/buff-live/active', (req, res) => {
  try {
    if (!activeLiveBuffSession) {
      return res.json({ success: true, activeSession: null });
    }
    // Tự động dọn dẹp nếu phiên đã xong và qua 30 phút
    if (
      activeLiveBuffSession.status !== 'RUNNING' &&
      Date.now() - new Date(activeLiveBuffSession.updatedAt).getTime() > 30 * 60 * 1000
    ) {
      activeLiveBuffSession = null;
      return res.json({ success: true, activeSession: null });
    }
    return res.json({ success: true, activeSession: activeLiveBuffSession });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lệnh dừng tác vụ Buff trực tiếp
app.post('/api/buff-live/stop', (req, res) => {
  try {
    if (activeLiveBuffSession && activeLiveBuffSession.status === 'RUNNING') {
      activeLiveBuffSession.stopRequested = true;
      activeLiveBuffSession.status = 'STOPPED';
      activeLiveBuffSession.updatedAt = new Date().toISOString();
      console.log(`[BuffStream] 🛑 Đã nhận lệnh dừng tác vụ buff trực tiếp (Session: ${activeLiveBuffSession.sessionId})`);
      return res.json({ success: true, message: 'Đã gửi lệnh dừng tiến trình buff trực tiếp', activeSession: activeLiveBuffSession });
    }
    return res.json({ success: true, message: 'Không có phiên buff trực tiếp nào đang chạy' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Xóa cache phiên Buff trực tiếp
app.post('/api/buff-live/clear', (req, res) => {
  try {
    activeLiveBuffSession = null;
    return res.json({ success: true, message: 'Đã xóa thông tin phiên buff trực tiếp' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Buff Like & Comment Stream thời gian thực (SSE)
app.post('/api/buff-like-stream', async (req, res) => {
  if (!(await checkLicenseOrReject(req, res))) return;

  const {
    sessionId = null,
    totalSelectedCount = 0,
    cookieString,
    targetUrl,
    reactionType = 'LIKE',
    selectedPages = [],
    delayMs = 1500,
    speedMode = 'NORMAL',
    enableLike = true,
    enableComment = false,
    enableHumanBehavior = true,
    fastSwitch = true,
    cooldownEvery = 15,
    cooldownDurationMs = 3500,
    comments = [],
    proxyUrl: explicitProxy = '',
    concurrency = 1,
    dripFeedMode = false,
    dripDurationMinutes = 30,
  } = req.body;

  if (!cookieString || !targetUrl) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc targetUrl' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let clientGone = false;
  res.on('close', () => {
    if (!res.writableFinished) {
      clientGone = true;
      console.log('[BuffStream] 🔌 Client đã ngắt kết nối SSE (reload trang hoặc chuyển tab). Background worker vẫn tiếp tục chạy an toàn...');
    }
  });

  const sendEvent = (event, data) => {
    if (clientGone || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {}
  };

  const sessionKey = sessionId || ('live_' + Date.now());
  const incomingTotal = parseInt(totalSelectedCount, 10) || selectedPages.length;

  if (activeLiveBuffSession && activeLiveBuffSession.sessionId === sessionKey && activeLiveBuffSession.status === 'RUNNING') {
    activeLiveBuffSession.updatedAt = new Date().toISOString();
    activeLiveBuffSession.targetUrl = targetUrl;
    activeLiveBuffSession.reactionType = reactionType;
  } else {
    activeLiveBuffSession = {
      sessionId: sessionKey,
      targetUrl,
      reactionType,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      total: Math.max(incomingTotal, selectedPages.length),
      done: 0,
      success: 0,
      alreadyLiked: 0,
      failed: 0,
      percent: 0,
      currentRunningPageName: '',
      details: [],
      stopRequested: false,
    };
  }

  try {
    const sysSettings = loadBuffSettings();
    const proxyPool = Array.isArray(sysSettings.proxyPool) ? sysSettings.proxyPool : [];
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const laneUid = fbBuffTool.getUserIdFromCookie(cookieString);

    const result = await withBuffLane(laneUid, () =>
      fbBuffTool.buffLikesWithPages(cookieString, targetUrl, {
        reactionType,
        selectedPages,
        delayMs,
        speedMode,
        enableLike,
        enableComment,
        enableHumanBehavior,
        fastSwitch,
        cooldownEvery,
        cooldownDurationMs,
        comments,
        proxyUrl,
        proxyPool,
        concurrency: Math.max(1, Math.min(5, parseInt(concurrency, 10) || 1)),
        dripFeedMode: Boolean(dripFeedMode),
        dripDurationMinutes: parseInt(dripDurationMinutes, 10) || 30,
        // CHỈ DỪNG KHI NGƯỜI DÙNG BẤM NÚT DỪNG HOẶC DỪNG KHẨN CẤP.
        // NẾU NGƯỜI DÙNG F5/LOAD LẠI TRANG, BACKGROUND VẪN TIẾP TỤC CHẠY KHÔNG BỊ HỦY!
        shouldStop: () => Boolean(activeLiveBuffSession?.stopRequested) || isEmergencyStopped(),
        onProgress: (evt) => {
          if (activeLiveBuffSession && activeLiveBuffSession.sessionId === sessionKey) {
            activeLiveBuffSession.updatedAt = new Date().toISOString();
            if (evt.type === 'PAGE_START') {
              activeLiveBuffSession.currentRunningPageName = evt.pageName || '';
            } else if (evt.type === 'PAGE_FINISH') {
              activeLiveBuffSession.done = (activeLiveBuffSession.done || 0) + 1;
              if (evt.status === 'SUCCESS') activeLiveBuffSession.success++;
              else if (evt.status === 'ALREADY_LIKED') activeLiveBuffSession.alreadyLiked++;
              else if (evt.status === 'FAILED' || evt.status === 'ERROR') activeLiveBuffSession.failed++;
              activeLiveBuffSession.percent = Math.min(
                100,
                Math.round((activeLiveBuffSession.done / Math.max(1, activeLiveBuffSession.total)) * 100)
              );

              const detailItem = {
                pageId: evt.pageId,
                pageName: evt.pageName,
                viaName: evt.viaName,
                status: evt.status,
                likeStatus: evt.likeStatus,
                commentStatus: evt.commentStatus,
                commentText: evt.commentText,
                message: evt.message,
                error: evt.error,
              };
              const exIdx = activeLiveBuffSession.details.findIndex((d) => d.pageId === evt.pageId);
              if (exIdx >= 0) {
                activeLiveBuffSession.details[exIdx] = { ...activeLiveBuffSession.details[exIdx], ...detailItem };
              } else {
                activeLiveBuffSession.details.push(detailItem);
              }
            }
          }
          sendEvent('progress', evt);
        },
      })
    );

    if (activeLiveBuffSession && activeLiveBuffSession.sessionId === sessionKey) {
      if (activeLiveBuffSession.done >= activeLiveBuffSession.total || activeLiveBuffSession.stopRequested) {
        activeLiveBuffSession.status = activeLiveBuffSession.stopRequested ? 'STOPPED' : 'DONE';
        activeLiveBuffSession.currentRunningPageName = '';
      }
      activeLiveBuffSession.updatedAt = new Date().toISOString();
    }

    const streamStartMs = activeLiveBuffSession?.startedAt ? new Date(activeLiveBuffSession.startedAt).getTime() : Date.now();
    const durationSec = Math.max(1, Math.round((Date.now() - streamStartMs) / 1000));
    const totalCount = selectedPages?.length || result?.total || 0;
    const successCount = result?.successCount ?? (result?.details ? result.details.filter((d) => d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED').length : 0);
    const failedCount = result?.failedCount ?? (result?.details ? result.details.filter((d) => d.status === 'ERROR' || d.status === 'FAILED' || d.status === 'NO_BUTTON').length : 0);

    notifyBuffCompleted({
      targetUrl,
      success: successCount,
      total: totalCount,
      failed: failedCount,
      durationSec,
      reactionType,
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Lỗi gửi thông báo stream xong:', err.message));

    sendEvent('done', { result });
    res.end();
  } catch (err) {
    console.error('[BuffStream] ❌ Lỗi stream:', err.message);
    if (activeLiveBuffSession && activeLiveBuffSession.sessionId === sessionKey) {
      activeLiveBuffSession.status = 'ERROR';
      activeLiveBuffSession.error = err.message;
      activeLiveBuffSession.updatedAt = new Date().toISOString();
    }
    sendEvent('error', { error: err.message });
    res.end();
  }
});

// Buff View Video / Reels Facebook
app.post('/api/buff-view', async (req, res) => {
  const { targetUrl, targetViews = 10, concurrency = 2, watchTimeSeconds = 6, cookieString = null } = req.body;
  if (!targetUrl) {
    return res.status(400).json({ success: false, error: 'Thiếu targetUrl' });
  }
  try {
    const result = await fbBuffTool.buffViews(targetUrl, {
      targetViews: parseInt(targetViews, 10) || 10,
      concurrency: parseInt(concurrency, 10) || 2,
      watchTimeSeconds: parseInt(watchTimeSeconds, 10) || 6,
      cookieStr: cookieString,
    });
    return res.json({ success: true, result });
  } catch (err) {
    console.error('[Buff API] ❌ Lỗi Buff View:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// 5. API ROUTES - HÀNG ĐỢI (QUEUE) & THỐNG KÊ (HISTORY)
// =============================================================================

function addBuffQueueTask(taskPayload) {
  const queueData = loadBuffQueue();
  const history = loadBuffHistory();
  const normUrl = normalizeFbPostUrl(taskPayload.targetUrl);

  if (history[normUrl]) {
    return { skipped: true, history: history[normUrl] };
  }

  const existing = queueData.items.find((it) => it.normalizedUrl === normUrl && it.status !== 'FAILED');
  if (existing) {
    return { alreadyQueued: true, task: existing };
  }

  const delayMin = parseDelayMinutes(taskPayload.delayMinutes);
  const newTask = {
    id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    source: taskPayload.source || 'MANUAL',
    targetUrl: taskPayload.targetUrl,
    normalizedUrl: normUrl,
    targetLikes: parseTargetLikes(taskPayload.targetLikes),
    reactionType: taskPayload.reactionType || 'RANDOM_POSITIVE',
    enableLike: taskPayload.enableLike !== false,
    enableComment: Boolean(taskPayload.enableComment),
    comments: Array.isArray(taskPayload.comments) ? taskPayload.comments : [],
    delayMinutes: delayMin,
    speedMode: taskPayload.speedMode || 'FAST',
    addedAt: new Date().toISOString(),
    runAfter: new Date(Date.now() + delayMin * 60 * 1000).toISOString(),
    status: 'QUEUED',
    cookieString: taskPayload.cookieString || 'ALL_VIAS',
    attempts: 0,
  };

  queueData.items.unshift(newTask);
  saveBuffQueue(queueData);
  return { task: newTask };
}

app.post('/api/buff-queue/add', async (req, res) => {
  try {
    if (!(await checkLicenseOrReject(req, res))) return;

    if (!req.body.targetUrl) {
      return res.status(400).json({ success: false, error: 'Thiếu targetUrl' });
    }
    const result = addBuffQueueTask(req.body);
    if (result.skipped) {
      return res.json({
        success: true,
        skipped: true,
        message: 'Bài viết này đã từng được buff trước đó, tự động bỏ qua để tránh trùng lặp.',
        history: result.history,
      });
    }
    if (result.alreadyQueued) {
      return res.json({
        success: true,
        alreadyQueued: true,
        message: 'Bài viết đang nằm sẵn trong hàng đợi xử lý.',
        task: result.task,
      });
    }
    return res.json({ success: true, task: result.task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/batch-add', async (req, res) => {
  try {
    if (!(await checkLicenseOrReject(req, res))) return;
    const {
      urls = [],
      targetLikes = 30,
      reactionType = 'RANDOM_POSITIVE',
      delayMinutes = 0,
      enableLike = true,
      enableComment = false,
      comments = [],
      speedMode = 'FAST',
      staggerMinutes = 3,
    } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ success: false, error: 'Thiếu danh sách urls' });
    }

    const baseDelay = parseDelayMinutes(delayMinutes);
    const stagger = Math.max(0, Number(staggerMinutes) || 0);

    const added = [];
    const skipped = [];
    const alreadyQueued = [];

    urls.forEach((u, idx) => {
      const cleanUrl = String(u || '').trim();
      if (!cleanUrl) return;

      const calculatedDelay = baseDelay + idx * stagger;
      const result = addBuffQueueTask({
        targetUrl: cleanUrl,
        targetLikes,
        reactionType,
        enableLike,
        enableComment,
        comments,
        speedMode,
        delayMinutes: calculatedDelay,
        source: 'BATCH_MANUAL',
      });

      if (result.skipped) {
        skipped.push({ url: cleanUrl, reason: 'Đã buff trước đó' });
      } else if (result.alreadyQueued) {
        alreadyQueued.push({ url: cleanUrl, taskId: result.task?.id });
      } else if (result.task) {
        added.push(result.task);
      }
    });

    return res.json({
      success: true,
      totalReceived: urls.length,
      addedCount: added.length,
      skippedCount: skipped.length,
      alreadyQueuedCount: alreadyQueued.length,
      added,
      skipped,
      alreadyQueued,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/buff-queue/check', (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Thiếu url' });
    const normalizedUrl = normalizeFbPostUrl(String(url));
    const history = loadBuffHistory();
    const queueData = loadBuffQueue();

    const isBuffed = Boolean(history[normalizedUrl]);
    const queueTask = queueData.items.find((it) => it.normalizedUrl === normalizedUrl);

    return res.json({
      success: true,
      url,
      normalizedUrl,
      isBuffed,
      history: history[normalizedUrl] || null,
      inQueue: Boolean(queueTask),
      queueTask: queueTask || null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/buff-queue/list', (req, res) => {
  try {
    const queueData = loadBuffQueue();
    const history = loadBuffHistory();
    return res.json({
      success: true,
      queue: queueData.items || [],
      historyCount: Object.keys(history).length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/buff-queue/remove/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const prevLen = queueData.items.length;
    queueData.items = queueData.items.filter((it) => it.id !== id);
    saveBuffQueue(queueData);
    return res.json({ success: true, deleted: queueData.items.length < prevLen });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/run-now/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const task = queueData.items.find((it) => it.id === id);
    if (!task) return res.status(404).json({ success: false, error: 'Không tìm thấy task' });

    task.runAfter = new Date().toISOString();
    task.status = 'QUEUED';
    saveBuffQueue(queueData);

    setImmediate(runQueueWorker);

    return res.json({ success: true, message: 'Đã kích hoạt task chạy ngay!', task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/retry/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const task = queueData.items.find((it) => it.id === id);
    if (!task) return res.status(404).json({ success: false, error: 'Không tìm thấy task' });

    task.runAfter = new Date().toISOString();
    task.status = 'QUEUED';
    task.error = null;
    saveBuffQueue(queueData);

    setImmediate(runQueueWorker);

    return res.json({ success: true, message: 'Đã đưa task vào hàng đợi chạy lại!', task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// QUEUE WORKER ENGINE (XỬ LÝ HÀNG ĐỢI TỰ ĐỘNG)
// =============================================================================

async function executeQueueTask(task) {
  if (activeBuffTaskIds.has(task.id)) return;
  activeBuffTaskIds.add(task.id);

  const queueData = loadBuffQueue();
  const currentTask = queueData.items.find((it) => it.id === task.id);
  if (!currentTask) {
    activeBuffTaskIds.delete(task.id);
    return;
  }

  currentTask.status = 'RUNNING';
  currentTask.startedAt = new Date().toISOString();
  saveBuffQueue(queueData);

  const startTime = Date.now();
  console.log(`[BuffQueue Worker] 🚀 Đang chạy Task ${task.id} cho bài viết: ${task.targetUrl}`);

  try {
    let targetVias = [];
    if (task.cookieString && task.cookieString !== 'ALL_VIAS') {
      const liveVias = await db.getLiveVias();
      const matched = liveVias.find(
        (v) => v.cookieString === task.cookieString || v.uid === fbBuffTool.getUserIdFromCookie(task.cookieString)
      );
      if (matched) {
        targetVias = [matched];
      } else {
        // Bài được gắn với 1 Via cụ thể nhưng Via đó đang bị đánh dấu lỗi: không dùng lại Cookie cũ đã chết
        const pinnedUid = fbBuffTool.getUserIdFromCookie(task.cookieString);
        const deadRow = pinnedUid
          ? (await db.getSocialAccounts()).find(
              (r) =>
                r.platform !== 'FACEBOOK_GROUP' &&
                (r.cookieString || r.accessToken || '').match(/(?:^|;\s*)c_user=([^;\s]+)/)?.[1] === pinnedUid &&
                (r.tokenStatus === 'EXPIRED' || r.tokenStatus === 'CHECKPOINT')
            )
          : null;
        if (deadRow) {
          throw new Error(
            `Via ${deadRow.pageName || pinnedUid} đang ${deadRow.tokenStatus === 'CHECKPOINT' ? 'bị checkpoint' : 'hết hạn Cookie'}. Hãy cập nhật Cookie ở trang Via & Fanpage rồi bấm Thử lại.`
          );
        }
        targetVias = [
          {
            id: 'task_via',
            uid: fbBuffTool.getUserIdFromCookie(task.cookieString) || 'custom',
            viaName: 'Via Riêng',
            cookieString: task.cookieString,
            proxyUrl: '',
          },
        ];
      }
    } else {
      targetVias = await db.getLiveVias();
    }

    if (targetVias.length === 0) {
      throw new Error('Không tìm thấy tài khoản Via khả dụng nào trong hệ thống');
    }

    let allAvailablePages = [];
    for (const via of targetVias) {
      if (isEmergencyStopped()) break;
      const uid = via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString);
      let pages = fbBuffTool.getCachedPages(uid);
      if (!pages || pages.length === 0) {
        try {
          pages = await fbBuffTool.getManagedPages(via.cookieString, {
            forceRefresh: false,
            viaName: via.viaName,
            proxyUrl: via.proxyUrl,
          });
        } catch (e) {
          console.warn(`[BuffQueue Worker] ⚠️ Không lấy được page từ via ${via.viaName}:`, e.message);
          verifyViaAfterRunError({ ...via, uid });
          continue;
        }
      }

      for (const p of pages || []) {
        allAvailablePages.push({
          ...p,
          viaAccountId: via.id,
          viaName: via.viaName,
          viaCookie: via.cookieString,
          proxyUrl: via.proxyUrl,
        });
      }
    }

    const normUrl = normalizeFbPostUrl(task.targetUrl);
    allAvailablePages = filterAvailablePagesForPost(normUrl, allAvailablePages);

    if (allAvailablePages.length === 0) {
      console.log(`[BuffQueue Worker] ℹ️ Toàn bộ page đã tương tác với bài "${task.targetUrl}". Hoàn tất task.`);
      const qd = loadBuffQueue();
      const t = qd.items.find((it) => it.id === task.id);
      if (t) {
        t.status = 'COMPLETED';
        t.finishedAt = new Date().toISOString();
        t.result = { total: 0, success: 0, failed: 0, message: 'Đã like trước đó hoặc không còn page mới' };
        saveBuffQueue(qd);
      }
      return;
    }

    const maxPages = getMaxPagesPerPost();
    const desiredLikes =
      task.targetLikes === 'ALL'
        ? Math.min(allAvailablePages.length, maxPages)
        : Math.min(task.targetLikes || 30, allAvailablePages.length);

    const pagesToBuff = allAvailablePages.slice(0, desiredLikes);

    const viaGroupsMap = new Map();
    for (const p of pagesToBuff) {
      const key = p.viaCookie || 'unknown';
      if (!viaGroupsMap.has(key)) {
        viaGroupsMap.set(key, {
          cookieString: p.viaCookie,
          viaName: p.viaName || 'Via',
          proxyUrl: p.proxyUrl || '',
          pages: [],
        });
      }
      const commentLines = Array.isArray(task.comments) ? task.comments : [];
      viaGroupsMap.get(key).pages.push({
        id: p.id,
        name: p.name,
        comment: commentLines.length > 0 ? commentLines[Math.floor(Math.random() * commentLines.length)] : '',
      });
    }

    let totalSuccess = 0;
    let totalFailed = 0;
    let totalDone = 0;

    for (const group of viaGroupsMap.values()) {
      if (isEmergencyStopped()) break;
      const sysSettings = loadBuffSettings();
      const proxyPool = Array.isArray(sysSettings.proxyPool) ? sysSettings.proxyPool : [];
      const laneUid = fbBuffTool.getUserIdFromCookie(group.cookieString);
      const res = await withBuffLane(laneUid, () =>
        fbBuffTool.buffLikesWithPages(group.cookieString, task.targetUrl, {
          reactionType: task.reactionType || 'RANDOM_POSITIVE',
          speedMode: task.speedMode || 'FAST',
          selectedPages: group.pages,
          delayMs: 3500,
          enableLike: task.enableLike !== false,
          enableComment: Boolean(task.enableComment),
          enableHumanBehavior: true,
          fastSwitch: true,
          cooldownEvery: 15,
          cooldownDurationMs: 4000,
          comments: task.comments || [],
          proxyUrl: group.proxyUrl,
          proxyPool,
          shouldStop: () => isEmergencyStopped(),
          onProgress: (ev) => {
            if (ev.type === 'PAGE_FINISH') {
              totalDone++;
              if (ev.status === 'SUCCESS') totalSuccess++;
              else if (ev.status === 'ERROR' || ev.status === 'FAILED') totalFailed++;

              const qd = loadBuffQueue();
              const t = qd.items.find((it) => it.id === task.id);
              if (t) {
                t.progress = { done: totalDone, total: pagesToBuff.length, success: totalSuccess };
                t.pageDetails = t.pageDetails || [];
                t.pageDetails.push({
                  pageId: ev.pageId,
                  pageName: ev.pageName,
                  status: ev.status,
                  reaction: ev.reaction || task.reactionType,
                  comment: ev.comment || '',
                  error: ev.error || null,
                  time: new Date().toLocaleTimeString(),
                });
                saveBuffQueue(qd);
              }
            }
          },
        })
      );

      if (res) {
        totalSuccess += res.success || 0;
        totalFailed += res.failed || 0;
      }
    }

    const durationSec = Math.round((Date.now() - startTime) / 1000);

    const qd = loadBuffQueue();
    const t = qd.items.find((it) => it.id === task.id);
    if (t) {
      t.status = isEmergencyStopped() ? 'STOPPED' : 'COMPLETED';
      t.finishedAt = new Date().toISOString();
      t.result = {
        total: pagesToBuff.length,
        success: totalSuccess,
        failed: totalFailed,
        durationSec,
      };
      saveBuffQueue(qd);
    }

    const history = loadBuffHistory();
    history[normUrl] = {
      url: task.targetUrl,
      normalizedUrl: normUrl,
      firstBuffedAt: history[normUrl]?.firstBuffedAt || new Date().toISOString(),
      lastBuffedAt: new Date().toISOString(),
      totalSuccess: (history[normUrl]?.totalSuccess || 0) + totalSuccess,
      reactionType: task.reactionType || 'RANDOM_POSITIVE',
      lastTaskId: task.id,
    };
    saveBuffHistory(history);

    notifyBuffCompleted({
      targetUrl: task.targetUrl,
      success: totalSuccess,
      total: pagesToBuff.length,
      failed: totalFailed,
      durationSec,
      reactionType: task.reactionType,
    }).catch(() => {});

    console.log(`[BuffQueue Worker] ✅ Hoàn tất Task ${task.id}: Thành công ${totalSuccess}/${pagesToBuff.length} (${durationSec}s)`);

    consecutiveQueueFailures = 0;
    const stillBusy = loadBuffQueue().items.some(
      (it) => it.id !== task.id && (it.status === 'QUEUED' || it.status === 'RUNNING')
    );
    if (!stillBusy) notifyQueueIdle({ completedCount: queueCompletedSinceIdle + 1 }).catch(() => {});
    queueCompletedSinceIdle = stillBusy ? queueCompletedSinceIdle + 1 : 0;
  } catch (err) {
    console.error(`[BuffQueue Worker] ❌ Task ${task.id} lỗi:`, err.message);
    const qd = loadBuffQueue();
    const t = qd.items.find((it) => it.id === task.id);
    if (t) {
      t.status = 'FAILED';
      t.finishedAt = new Date().toISOString();
      t.error = err.message;
      t.attempts = (t.attempts || 0) + 1;
      saveBuffQueue(qd);
    }
    consecutiveQueueFailures += 1;
    if (consecutiveQueueFailures === 3) {
      notifyQueueTrouble({
        consecutiveFailures: consecutiveQueueFailures,
        lastError: err.message,
        lastUrl: task.targetUrl,
      }).catch(() => {});
    }
  } finally {
    activeBuffTaskIds.delete(task.id);
  }
}

// Đếm bài thất bại liên tiếp / số bài đã xong từ lần hàng đợi trống gần nhất (phục vụ thông báo Telegram)
let consecutiveQueueFailures = 0;
let queueCompletedSinceIdle = 0;

async function runQueueWorker() {
  if (!store.isReady()) return;
  if (isEmergencyStopped()) return;
  if (activeBuffTaskIds.size >= MAX_PARALLEL_BUFF) return;

  const queueData = loadBuffQueue();
  const now = new Date();

  const taskToRun = (queueData.items || []).find(
    (it) => it.status === 'QUEUED' && new Date(it.runAfter) <= now && !activeBuffTaskIds.has(it.id)
  );

  if (taskToRun) {
    executeQueueTask(taskToRun);
  }
}

// Chạy vòng lặp kiểm tra hàng đợi mỗi 6 giây
setInterval(runQueueWorker, 6000);

app.post('/api/buff-queue/clear-completed', (req, res) => {
  try {
    const queueData = loadBuffQueue();
    const prevLen = queueData.items.length;
    queueData.items = queueData.items.filter((it) => it.status === 'QUEUED' || it.status === 'RUNNING');
    saveBuffQueue(queueData);
    return res.json({ success: true, cleared: prevLen - queueData.items.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// 6. API ROUTES - POST HUNTER (TỰ SĂN BÀI MỚI)
// =============================================================================

app.get('/api/buff-monitors', (req, res) => {
  try {
    const data = loadBuffMonitors();
    const queueData = loadBuffQueue();
    const history = loadBuffHistory();
    return res.json({
      success: true,
      monitors: data.monitors || [],
      queueCount: (queueData.items || []).filter((it) => it.status === 'QUEUED').length,
      historyCount: Object.keys(history).length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-monitors', (req, res) => {
  try {
    const {
      id,
      targetName,
      targetUrl,
      targetType = 'PAGE',
      checkIntervalMinutes = 10,
      buffConfig = {},
      status = 'ACTIVE',
    } = req.body;

    if (!targetUrl || !String(targetUrl).trim()) {
      return res.status(400).json({ success: false, error: 'Thiếu link mục tiêu (targetUrl)' });
    }

    const data = loadBuffMonitors();
    let monitorId = id;

    if (monitorId) {
      const idx = data.monitors.findIndex((m) => m.id === monitorId);
      if (idx !== -1) {
        const urlChanged = String(targetUrl).trim() !== data.monitors[idx].targetUrl;
        data.monitors[idx] = {
          ...data.monitors[idx],
          ...(urlChanged ? { baselineDone: false, seenPostUrls: [] } : {}),
          targetName: targetName ? String(targetName).trim() : data.monitors[idx].targetName,
          targetUrl: String(targetUrl).trim(),
          targetType,
          checkIntervalMinutes: parseInt(checkIntervalMinutes, 10) || 10,
          buffConfig: {
            ...data.monitors[idx].buffConfig,
            ...buffConfig,
          },
          status,
          updatedAt: new Date().toISOString(),
        };
        saveBuffMonitors(data);
        return res.json({ success: true, monitor: data.monitors[idx] });
      }
    }

    monitorId = `mon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newMon = {
      id: monitorId,
      targetName: targetName ? String(targetName).trim() : `Mục tiêu ${data.monitors.length + 1}`,
      targetUrl: String(targetUrl).trim(),
      targetType,
      checkIntervalMinutes: parseInt(checkIntervalMinutes, 10) || 10,
      buffConfig: {
        targetLikes: parseTargetLikes(buffConfig.targetLikes, 'ALL'),
        reactionType: buffConfig.reactionType || 'RANDOM_POSITIVE',
        enableLike: buffConfig.enableLike !== false,
        enableComment: Boolean(buffConfig.enableComment),
        comments: Array.isArray(buffConfig.comments) ? buffConfig.comments : [],
        delayMinutes: parseDelayMinutes(buffConfig.delayMinutes),
        viaMode: buffConfig.viaMode || 'ALL_VIAS',
        cookieString: buffConfig.cookieString || '',
      },
      status: 'ACTIVE',
      totalDetected: 0,
      lastCheckedAt: null,
      lastFoundPostUrl: null,
      createdAt: new Date().toISOString(),
    };

    data.monitors.unshift(newMon);
    saveBuffMonitors(data);
    return res.json({ success: true, monitor: newMon });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/buff-monitors/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = loadBuffMonitors();
    const prevLen = data.monitors.length;
    data.monitors = data.monitors.filter((m) => m.id !== id);
    saveBuffMonitors(data);
    return res.json({ success: true, deleted: data.monitors.length < prevLen });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-monitors/:id/toggle', (req, res) => {
  try {
    const { id } = req.params;
    const data = loadBuffMonitors();
    const mon = data.monitors.find((m) => m.id === id);
    if (!mon) return res.status(404).json({ success: false, error: 'Không tìm thấy mục tiêu theo dõi' });
    mon.status = mon.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    saveBuffMonitors(data);
    return res.json({ success: true, monitor: mon });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-hunter/test-scan', async (req, res) => {
  try {
    const { targetUrl, cookieString = '' } = req.body;
    if (!targetUrl || !String(targetUrl).trim()) {
      return res.status(400).json({ success: false, error: 'Thiếu link mục tiêu cần test quét' });
    }

    const posts = await fbBuffTool.scanTargetForPosts(String(targetUrl).trim(), {
      cookieStr: cookieString,
      maxPosts: 8,
    });

    const history = loadBuffHistory();
    const queueData = loadBuffQueue();

    const annotatedPosts = (posts || []).map((p) => {
      const normUrl = p.normalizedUrl || normalizeFbPostUrl(p.url);
      return {
        ...p,
        isAlreadyBuffed: Boolean(history[normUrl]),
        isInQueue: queueData.items.some((it) => it.normalizedUrl === normUrl),
      };
    });

    return res.json({
      success: true,
      total: annotatedPosts.length,
      posts: annotatedPosts,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Quét mục tiêu và nạp bài viết mới vào hàng đợi
async function scanMonitorTarget(monitorId) {
  const data = loadBuffMonitors();
  const mon = data.monitors.find((m) => m.id === monitorId);
  if (!mon) throw new Error('Không tìm thấy mục tiêu theo dõi');

  const history = loadBuffHistory();

  let cookieStr = mon.buffConfig?.cookieString || '';
  let proxyUrl = '';
  if (!cookieStr) {
    const liveVias = await db.getLiveVias();
    if (liveVias.length > 0) {
      cookieStr = liveVias[0].cookieString;
      proxyUrl = liveVias[0].proxyUrl || '';
    }
  }

  const posts = await fbBuffTool.scanTargetForPosts(mon.targetUrl, {
    cookieStr,
    proxyUrl,
    maxPosts: 8,
  });

  const postsFound = posts.length;
  mon.lastCheckedAt = new Date().toISOString();
  mon.lastPostsFound = postsFound;

  if (!Array.isArray(mon.seenPostUrls)) {
    mon.seenPostUrls = [];
  }

  if (!mon.baselineDone) {
    mon.baselineDone = true;
    mon.seenPostUrls = Array.from(new Set([...mon.seenPostUrls, ...posts.map((p) => p.normalizedUrl)]));
    saveBuffMonitors(data);
    return {
      baseline: true,
      postsFound,
      newPostsEnqueued: 0,
      posts,
    };
  }

  const newPosts = [];
  for (const post of posts) {
    const normUrl = post.normalizedUrl || normalizeFbPostUrl(post.url);
    if (!mon.seenPostUrls.includes(normUrl) && !history[normUrl]) {
      newPosts.push(post);
      mon.seenPostUrls.push(normUrl);
    }
  }

  let newPostsEnqueued = 0;
  for (const newPost of newPosts) {
    const queuePayload = {
      source: `POST_HUNTER:${mon.targetName || mon.id}`,
      targetUrl: newPost.url,
      targetLikes: mon.buffConfig?.targetLikes || 30,
      reactionType: mon.buffConfig?.reactionType || 'RANDOM_POSITIVE',
      enableLike: mon.buffConfig?.enableLike !== false,
      enableComment: Boolean(mon.buffConfig?.enableComment),
      comments: mon.buffConfig?.comments || [],
      delayMinutes: mon.buffConfig?.delayMinutes ?? 3,
      cookieString: mon.buffConfig?.viaMode || 'ALL_VIAS',
    };

    const addRes = addBuffQueueTask(queuePayload);
    if (addRes.task) {
      newPostsEnqueued++;
      mon.totalDetected = (mon.totalDetected || 0) + 1;
      mon.lastFoundPostUrl = newPost.url;

      notifyPostHunted({
        targetName: mon.targetName,
        targetUrl: mon.targetUrl,
        postUrl: newPost.url,
        delayMinutes: queuePayload.delayMinutes,
        targetLikes: queuePayload.targetLikes,
      }).catch(() => {});
    }
  }

  saveBuffMonitors(data);

  return {
    baseline: false,
    postsFound,
    newPostsEnqueued,
    posts,
  };
}

// API Quét thủ công ngay lập tức cho 1 mục tiêu theo dõi
app.post('/api/buff-monitors/:id/scan-now', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await scanMonitorTarget(id);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error(`[PostHunter] ❌ Lỗi quét mục tiêu ${req.params.id}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Post Hunter Background Scheduler
let isHunterScanning = false;
async function runHunterScheduler() {
  if (!store.isReady()) return;
  if (isHunterScanning || isEmergencyStopped()) return;
  const data = loadBuffMonitors();
  const activeMonitors = (data.monitors || []).filter((m) => m.status === 'ACTIVE');
  if (activeMonitors.length === 0) return;

  const now = Date.now();
  for (const mon of activeMonitors) {
    if (isEmergencyStopped()) break;
    const intervalMs = Math.max(1, mon.checkIntervalMinutes || 10) * 60 * 1000;
    const lastChecked = mon.lastCheckedAt ? new Date(mon.lastCheckedAt).getTime() : 0;
    if (now - lastChecked >= intervalMs) {
      isHunterScanning = true;
      try {
        console.log(`[PostHunter Scheduler] ⏰ Đến lịch quét mục tiêu: ${mon.targetName} (${mon.targetUrl})`);
        await scanMonitorTarget(mon.id);
      } catch (err) {
        console.warn(`[PostHunter Scheduler] ⚠️ Quét mục tiêu ${mon.targetName} lỗi:`, err.message);
      } finally {
        isHunterScanning = false;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

// Chạy Hunter Scheduler kiểm tra mỗi 30 giây
setInterval(runHunterScheduler, 30000);

// Kiểm tra sức khỏe nhanh cho danh sách Fanpage (Public / Restricted / Live)
app.post('/api/buff-check-pages-health', async (req, res) => {
  try {
    const axios = require('axios');
    const { pageIds = [] } = req.body;
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return res.json({ success: true, results: {} });
    }
    const targetIds = pageIds.slice(0, 150);
    const results = {};

    await runWithConcurrency(targetIds, 8, async (id) => {
      try {
        const testUrl = `https://mbasic.facebook.com/${id}`;
        const resp = await axios.get(testUrl, {
          timeout: 6000,
          validateStatus: (s) => s < 500,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (resp.status === 404 || resp.data?.includes('Trang không tìm thấy') || resp.data?.includes('Page Not Found')) {
          results[id] = 'NOT_FOUND';
        } else if (resp.data?.includes('bị hạn chế') || resp.data?.includes('Restricted')) {
          results[id] = 'RESTRICTED';
        } else {
          results[id] = 'LIVE';
        }
      } catch (e) {
        results[id] = 'LIVE';
      }
    });

    return res.json({ success: true, results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Kiểm tra sức khỏe dàn Via và CẬP NHẬT TRỰC TIẾP vào MySQL Workbench (social_accounts)
app.post('/api/buff-vias/health-check', async (req, res) => {
  try {
    const { cookieString, viaId } = req.body;
    let targetVias = [];

    if (cookieString) {
      targetVias.push({
        id: viaId || 'custom',
        viaName: 'Via Kiểm Tra',
        cookieString: String(cookieString).trim(),
        proxyUrl: '',
      });
    } else {
      targetVias = await db.getLiveVias();
    }

    console.log(`[ViaHealth] 🩺 Bắt đầu kiểm tra sức khỏe ${targetVias.length} tài khoản Via...`);
    const checkResults = [];

    for (const via of targetVias) {
      try {
        const status = await fbBuffTool.validateViaSession(via.cookieString, {
          proxyUrl: via.proxyUrl,
          timeoutMs: 18000,
        });

        if (typeof via.id === 'number') {
          const dbStatus = status.isLive ? 'OK' : status.status === 'CHECKPOINT' ? 'CHECKPOINT' : 'EXPIRED';
          await db.updateTokenStatus(via.id, dbStatus).catch(() => {});
        }

        if (!status.isLive) {
          notifyViaDead(
            {
              uid: via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString),
              viaName: via.viaName,
              proxyUrl: via.proxyUrl,
              tokenStatus: status.status,
            },
            status.error || 'Phiên đăng nhập không khả dụng'
          ).catch(() => {});
        }

        checkResults.push({
          id: via.id,
          uid: via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString),
          viaName: via.viaName,
          proxyUrl: via.proxyUrl,
          isLive: status.isLive,
          status: status.status,
          name: status.name,
          error: status.error,
          checkedAt: new Date().toISOString(),
        });
      } catch (checkErr) {
        checkResults.push({
          id: via.id,
          uid: via.uid,
          viaName: via.viaName,
          isLive: false,
          status: 'ERROR',
          error: checkErr.message,
          checkedAt: new Date().toISOString(),
        });
      }
    }

    const liveCount = checkResults.filter((r) => r.isLive).length;
    return res.json({
      success: true,
      total: checkResults.length,
      liveCount,
      deadCount: checkResults.length - liveCount,
      vias: checkResults,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// KIỂM TRA ĐỊNH KỲ VIA HẾT HẠN COOKIE / CHECKPOINT → CẬP NHẬT TRẠNG THÁI + CẢNH BÁO TELEGRAM
// =============================================================================
const VIA_HEALTH_INTERVAL_MS = 30 * 60 * 1000;
const VIA_HEALTH_FIRST_RUN_MS = 3 * 60 * 1000;
let isViaHealthScanning = false;

async function runScheduledViaHealthCheck() {
  if (!store.isReady() || isViaHealthScanning) return;
  // Nhường chỗ cho tác vụ đang chạy để không tranh tài nguyên trình duyệt
  if (isHunterScanning || activeLiveBuffSession) return;
  try {
    if (loadBuffSettings().isEmergencyStopped) return;
    if (loadBuffQueue().items.some((it) => it.status === 'RUNNING')) return;
  } catch (e) {
    return;
  }

  isViaHealthScanning = true;
  try {
    // getLiveVias chỉ trả về Via chưa bị đánh dấu lỗi → mỗi Via chỉ bị cảnh báo 1 lần khi vừa chuyển sang lỗi
    const vias = (await db.getLiveVias()).filter((v) => typeof v.id === 'number');
    if (vias.length === 0) return;
    console.log(`[ViaHealth] ⏱️ Kiểm tra định kỳ ${vias.length} Via...`);

    for (const via of vias) {
      if (loadBuffSettings().isEmergencyStopped) break;
      try {
        const status = await fbBuffTool.validateViaSession(via.cookieString, {
          proxyUrl: via.proxyUrl,
          timeoutMs: 18000,
        });
        // Chỉ coi là lỗi khi chắc chắn (hết hạn / checkpoint); lỗi mạng hoặc timeout bỏ qua để không báo nhầm
        if (status.isLive || (status.status !== 'EXPIRED' && status.status !== 'CHECKPOINT')) continue;

        await db.updateTokenStatus(via.id, status.status).catch(() => {});
        notifyViaDead(
          {
            uid: via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString),
            viaName: via.viaName,
            proxyUrl: via.proxyUrl,
            tokenStatus: status.status,
          },
          status.status === 'CHECKPOINT' ? 'Facebook yêu cầu xác minh (checkpoint)' : 'Cookie hết hạn hoặc đã đăng xuất'
        ).catch(() => {});
      } catch (err) {
        console.warn(`[ViaHealth] ⚠️ Bỏ qua Via ${via.viaName || via.id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[ViaHealth] ⚠️ Kiểm tra định kỳ thất bại: ${err.message}`);
  } finally {
    isViaHealthScanning = false;
  }
}

setTimeout(() => {
  runScheduledViaHealthCheck();
  setInterval(runScheduledViaHealthCheck, VIA_HEALTH_INTERVAL_MS);
}, VIA_HEALTH_FIRST_RUN_MS);

// =============================================================================
// TELEGRAM: BÁO CÁO HẰNG NGÀY + LỆNH /status
// =============================================================================
async function getViaCounts() {
  let total = 0;
  let dead = 0;
  try {
    const seen = new Set();
    for (const row of await db.getSocialAccounts()) {
      if (row.platform === 'FACEBOOK_GROUP' || !row.cookieString) continue;
      const m = row.cookieString.match(/(?:^|;\s*)c_user=([^;]+)/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      total++;
      if (row.tokenStatus === 'EXPIRED' || row.tokenStatus === 'CHECKPOINT') dead++;
    }
  } catch (e) {
    return null;
  }
  return { total, dead, live: total - dead };
}

function summarizeQueueSince(sinceMs) {
  const items = loadBuffQueue().items || [];
  const finished = items.filter((it) => it.finishedAt && new Date(it.finishedAt).getTime() >= sinceMs);
  const done = finished.filter((it) => it.status === 'COMPLETED');
  return {
    completed: done.length,
    failed: finished.filter((it) => it.status === 'FAILED').length,
    success: done.reduce((a, it) => a + (it.result?.success || 0), 0),
    total: done.reduce((a, it) => a + (it.result?.total || 0), 0),
    totalSec: done.reduce((a, it) => a + (it.result?.durationSec || 0), 0),
    queued: items.filter((it) => it.status === 'QUEUED').length,
    running: items.filter((it) => it.status === 'RUNNING').length,
  };
}

async function buildStatusText() {
  const st = loadBuffSettings();
  const q = summarizeQueueSince(Date.now() - 24 * 3600 * 1000);
  const v = await getViaCounts();
  return [
    `📊 <b>[TÌNH TRẠNG HỆ THỐNG]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    st.isEmergencyStopped ? `⛔ <b>Đang DỪNG KHẨN CẤP</b> — gửi /resume để khôi phục` : `🟢 Đang hoạt động bình thường`,
    v ? `👤 Via: ${v.live}/${v.total} hoạt động${v.dead ? ` · <b>${v.dead} cần cập nhật Cookie</b>` : ''}` : `👤 Via: không đọc được dữ liệu`,
    `📋 Hàng đợi: ${q.running} đang chạy · ${q.queued} đang chờ`,
    `📈 24 giờ qua: ${q.completed} bài xong · ${q.failed} thất bại`,
  ].join('\n');
}

async function buildDailyReport() {
  const q = summarizeQueueSince(Date.now() - 24 * 3600 * 1000);
  const v = await getViaCounts();
  const rate = q.total > 0 ? Math.round((q.success / q.total) * 100) : 0;
  return [
    `🗓️ <b>[BÁO CÁO 24 GIỜ QUA]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `✅ Bài hoàn tất: <b>${q.completed}</b>${q.failed ? ` · ❌ thất bại: <b>${q.failed}</b>` : ''}`,
    `❤️ Lượt thành công: <b>${q.success}</b> / ${q.total}${q.total ? ` (${rate}%)` : ''}`,
    `⏱️ Tổng thời gian chạy: ${formatDurationVi(q.totalSec)}`,
    v ? `👤 Via: ${v.live}/${v.total} hoạt động${v.dead ? ` · <b>${v.dead} cần cập nhật Cookie</b>` : ''}` : '',
    `📋 Đang chờ trong hàng đợi: ${q.queued}`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function runDailyReportTick() {
  if (!store.isReady()) return;
  try {
    const st = loadBuffSettings();
    if (!st.dailyReportEnabled || !st.telegramBotToken || !st.telegramChatId) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (now.getHours() !== Number(st.dailyReportHour) || st.lastDailyReportDate === today) return;
    saveBuffSettings({ lastDailyReportDate: today }); // ghi trước để không gửi lặp nếu có lỗi giữa chừng
    await sendAlert(await buildDailyReport());
  } catch (err) {
    console.warn(`[DailyReport] ⚠️ ${err.message}`);
  }
}
setInterval(runDailyReportTick, 60 * 1000);

// Nhận lệnh /status /stop /resume từ Telegram
startCommandListener({ getStatusText: buildStatusText });

// Lấy dữ liệu báo cáo tổng quan ngày (cho trang Săn bài & VIP Like)
app.get('/api/buff-daily-report', async (req, res) => {
  try {
    const q = summarizeQueueSince(Date.now() - 24 * 3600 * 1000);
    const v = await getViaCounts();
    const rate = q.total > 0 ? Math.round((q.success / q.total) * 100) : 0;
    const history = loadBuffHistory();
    const historyList = Object.values(history);
    const today24h = historyList.filter(
      (h) => h.lastBuffedAt && Date.now() - new Date(h.lastBuffedAt).getTime() < 24 * 3600 * 1000
    );
    return res.json({
      success: true,
      report: {
        completedPosts: q.completed,
        failedPosts: q.failed,
        totalLikesSuccess: q.success,
        totalLikesTarget: q.total,
        successRate: rate,
        runningTimeSec: q.totalSec,
        queuedCount: q.queued,
        liveVias: v?.live || 0,
        totalVias: v?.total || 0,
        todayHistoryCount: today24h.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Bấm nút gửi báo cáo tổng kết 24h về Telegram
app.post('/api/buff-daily-report/send', async (req, res) => {
  try {
    const reportText = await buildDailyReport();
    const result = await sendAlert(reportText, { critical: true });
    return res.json({ success: true, message: 'Đã gửi báo cáo tổng kết ngày về Telegram!', result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Tổng quan sức khỏe hệ thống (truy vấn trực tiếp MySQL Workbench)
app.get('/api/buff-vias/overview', async (req, res) => {
  try {
    let totalVias = 0;
    let liveVias = 0;
    let viaRows = [];

    try {
      const allAccounts = await db.getSocialAccounts();
      const seenCUsers = new Set();
      for (const row of allAccounts) {
        // Bỏ qua Nhóm (Group) và các dòng không có cookie
        if (row.platform === 'FACEBOOK_GROUP') continue;
        if (!row.cookieString || !row.cookieString.includes('c_user=')) continue;
        const m = row.cookieString.match(/(?:^|;\s*)c_user=([^;]+)/);
        if (!m) continue;
        const uid = m[1];
        if (!seenCUsers.has(uid)) {
          seenCUsers.add(uid);
          const isLive = row.tokenStatus !== 'EXPIRED' && row.tokenStatus !== 'CHECKPOINT';
          if (isLive) liveVias++;
          totalVias++;
          viaRows.push({
            id: row.id,
            uid,
            viaName: row.pageName,
            tokenStatus: row.tokenStatus || 'OK',
            proxyUrl: row.proxyUrl || '',
            lastCheckedAt: row.tokenCheckedAt,
          });
        }
      }
    } catch (dbErr) {
      console.warn(`[BuffOverview] DB warning: ${dbErr.message}`);
    }

    const pagesCache = fbBuffTool.loadPagesCache();
    let totalCachedPages = 0;
    for (const uid in pagesCache) {
      if (Array.isArray(pagesCache[uid]?.pages)) {
        totalCachedPages += pagesCache[uid].pages.length;
      }
    }

    const queueData = loadBuffQueue();
    const history = loadBuffHistory();
    const monitorsData = loadBuffMonitors();
    const registryStats = getGlobalRegistryStats();
    const sysSettings = loadBuffSettings();

    return res.json({
      success: true,
      bmHealth: {
        totalVias,
        liveVias,
        deadVias: totalVias - liveVias,
        vias: viaRows,
        totalCachedPages,
        safeDailyCapacity: liveVias * 200,
        dailyGovernorLimitPerPage: sysSettings.maxDailyPageActions || 25,
      },
      stats: {
        queueCount: (queueData.items || []).filter((it) => it.status === 'QUEUED').length,
        runningCount: (queueData.items || []).filter((it) => it.status === 'RUNNING').length,
        historyCount: Object.keys(history).length,
        monitorsCount: (monitorsData.monitors || []).length,
        activeMonitorsCount: (monitorsData.monitors || []).filter((m) => m.status === 'ACTIVE').length,
      },
      antiOverlap: registryStats,
      system: {
        isEmergencyStopped: isEmergencyStopped(),
        emergencyReason: sysSettings.emergencyReason || '',
        emergencyStoppedAt: sysSettings.emergencyStoppedAt || null,
        telegramConfigured: Boolean(sysSettings.telegramBotToken && sysSettings.telegramChatId),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// 8. API ROUTES - CÀI ĐẶT HỆ THỐNG & DỪNG KHẨN CẤP
// =============================================================================

let cachedTelegramBotInfo = null;
let lastBotTokenChecked = '';

async function getTelegramBotInfo(token) {
  if (!token) return null;
  if (cachedTelegramBotInfo && lastBotTokenChecked === token) return cachedTelegramBotInfo;
  try {
    const axios = require('axios');
    const resp = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 4000 });
    if (resp.data?.ok) {
      cachedTelegramBotInfo = {
        id: resp.data.result.id,
        firstName: resp.data.result.first_name,
        username: resp.data.result.username,
      };
      lastBotTokenChecked = token;
      return cachedTelegramBotInfo;
    }
  } catch {}
  return null;
}

// Token thật chỉ trả về cho ADMIN (để hiện/sửa trên giao diện); tài khoản khác chỉ thấy bản che
function publicBuffSettings(s) {
  const maskedToken = s.telegramBotToken
    ? `${s.telegramBotToken.slice(0, 6)}...${s.telegramBotToken.slice(-4)}`
    : '';
  return {
    ...s,
    telegramBotToken: s.telegramBotToken || '',
    telegramBotTokenMasked: maskedToken,
    hasBotToken: Boolean(s.telegramBotToken),
  };
}

app.get('/api/buff-settings', async (req, res) => {
  try {
    const raw = loadBuffSettings();
    const botInfo = await getTelegramBotInfo(raw.telegramBotToken);
    return res.json({
      success: true,
      settings: {
        ...publicBuffSettings(raw),
        botInfo,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-settings', requireAdmin, async (req, res) => {
  try {
    const updated = saveBuffSettings(req.body);
    if (!updated) return res.status(500).json({ success: false, error: 'Không lưu được file cài đặt' });
    const botInfo = await getTelegramBotInfo(updated.telegramBotToken);
    try {
      const db = require('./db');
      await db.syncTelegramSettingsToDb({ ...updated, botInfo });
    } catch {}
    return res.json({ success: true, settings: { ...publicBuffSettings(updated), botInfo } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy lịch sử thông báo Telegram lưu trong MySQL
app.get('/api/telegram/history', async (req, res) => {
  try {
    const db = require('./db');
    const limit = parseInt(req.query.limit || '50', 10);
    const notifications = await db.getTelegramNotifications(limit);
    return res.json({ success: true, notifications });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Bắn thử các tình huống thực tế để người dùng thấy Telegram giúp gì
app.post('/api/telegram/test-scenario', async (req, res) => {
  try {
    const { scenario = 'TEST' } = req.body;
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    let text = '';

    if (scenario === 'BUFF_COMPLETED') {
      text = [
        `🎉 <b>[MÔ PHỎNG: BUFF HOÀN TẤT CHIẾN DỊCH]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `🔗 <b>Bài viết:</b> <a href="https://facebook.com/groups/947583488284655/posts/1174580982251570">Nhóm Facebook VIP 947583488...</a>`,
        `❤️ <b>Loại Reaction:</b> LIKE & LOVE (Yêu thích)`,
        `✅ <b>Thành công:</b> <b>26 / 26</b> Page (100%)`,
        `❌ <b>Thất bại:</b> 0`,
        `⏱️ <b>Thời gian xử lý:</b> 42s (2 luồng song song)`,
        `⏰ <b>Hoàn tất lúc:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `✨ <i>Chiến dịch hoàn thành xuất sắc, toàn bộ Page an toàn!</i>`,
      ].join('\n');
    } else if (scenario === 'VIA_DEAD') {
      text = [
        `⚠️ <b>[MÔ PHỎNG: CẢNH BÁO VIA DIE / CHECKPOINT]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `🚨 <b>Phát hiện tài khoản Via cần xử lý ngay:</b>`,
        `👤 <b>Tên Via:</b> (4) Facebook`,
        `🆔 <b>UID:</b> <code>100009194846268</code>`,
        `❌ <b>Trạng thái:</b> Cookie hết hạn / Yêu cầu xác minh`,
        `⏰ <b>Thời điểm phát hiện:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `🛡️ <i>Hệ thống đã tự động cách ly Via này để tránh bị khóa dàn Page con!</i>`,
      ].join('\n');
    } else if (scenario === 'EMERGENCY_STOP') {
      text = [
        `🛑 <b>[MÔ PHỎNG: BÁO ĐỘNG DỪNG KHẨN CẤP]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `👤 <b>Người kích hoạt:</b> Quản trị viên (Admin)`,
        `⚠️ <b>Lý do:</b> Kiểm tra an toàn định kỳ hệ thống`,
        `⏰ <b>Thời gian:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `⛔ <i>Tất cả trình duyệt Playwright và Hàng đợi Queue đã được đóng ngay lập tức!</i>`,
      ].join('\n');
    } else if (scenario === 'HUNTER') {
      text = [
        `🎯 <b>[MÔ PHỎNG: SĂN BÀI VIẾT MỚI THÀNH CÔNG]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `📢 <b>Nguồn theo dõi:</b> Fanpage "VIPLIKE RADIANT OFFICIAL"`,
        `🔗 <b>Bài viết mới:</b> <a href="https://facebook.com/viplike/posts/123456789">facebook.com/viplike/posts/123456789</a>`,
        `⏳ <b>Kế hoạch:</b> Tự động buff 50 Like sau 3 phút nữa`,
        `⏰ <b>Phát hiện lúc:</b> ${now}`,
      ].join('\n');
    } else {
      text = [
        `🤖 <b>[TEST THÀNH CÔNG: VIPLIKE RADIANT OPS BOT]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `✅ Kết nối Telegram Bot thông suốt 100%!`,
        `⏰ Thời gian: ${now}`,
        `🛡️ <i>Dữ liệu đã được lưu trữ và kiểm soát trực tiếp trong MySQL Database!</i>`,
      ].join('\n');
    }

    const result = await sendTelegramMessage(text, 'HTML');
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.reason || 'Không gửi được tin nhắn' });
    }
    return res.json({ success: true, message: 'Đã gửi mô phỏng về Telegram và lưu vào Database!', result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-settings/test-telegram', async (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const customMsg = [
      `🤖 <b>[TEST THÀNH CÔNG: VIPLIKE RADIANT OPS BOT]</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `✅ Kết nối Telegram Bot thông suốt 100%!`,
      `⏰ Thời gian: ${now}`,
      `🛡️ <i>Hệ thống giám sát và bảo vệ dàn Via & Fanpage đã sẵn sàng 24/7!</i>`,
    ].join('\n');

    let result;
    if (botToken && chatId) {
      const axios = require('axios');
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const resp = await axios.post(
        url,
        { chat_id: chatId, text: customMsg, parse_mode: 'HTML' },
        { timeout: 8000 }
      );
      const msgId = resp.data?.result?.message_id || null;
      try {
        const db = require('./db');
        await db.saveTelegramNotification({
          chatId,
          eventType: 'TEST',
          title: 'TEST THÀNH CÔNG: VIPLIKE RADIANT OPS BOT',
          message: customMsg.replace(/<[^>]*>/g, ''),
          status: 'SENT',
          telegramMessageId: msgId,
        });
      } catch {}
      result = { success: true, data: resp.data };
    } else {
      result = await sendTelegramMessage(customMsg);
    }

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.reason || 'Gửi thất bại' });
    }
    return res.json({ success: true, message: 'Đã gửi tin nhắn thử nghiệm thành công vào Telegram!' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/emergency-stop', (req, res) => {
  try {
    const { reason = 'Người quản trị kích hoạt DỪNG KHẨN CẤP' } = req.body;
    setEmergencyStop(true, reason);
    return res.json({ success: true, isEmergencyStopped: true, reason });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/resume', (req, res) => {
  try {
    setEmergencyStop(false);
    return res.json({ success: true, isEmergencyStopped: false, message: 'Đã khôi phục hoạt động thành công' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/buff-registry/stats', (req, res) => {
  try {
    const stats = getGlobalRegistryStats();
    return res.json({ success: true, ...stats });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-registry/clear-post', (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'Thiếu url' });
    const normUrl = normalizeFbPostUrl(url);
    const cleared = clearPostInteractions(normUrl);
    return res.json({ success: true, cleared, normalizedUrl: normUrl });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// API QUẢN LÝ BẢN QUYỀN & CHO THUÊ PHẦN MỀM (TAURI / SAAS LICENSING)
// =============================================================================

// 1. Kiểm tra trạng thái bản quyền hiện tại
// Chỉ trả về license đã gắn đúng HWID của máy gửi yêu cầu (header x-hardware-hwid)
function maskLicenseKey(key) {
  const s = String(key || '');
  return s.length <= 4 ? s : '*'.repeat(s.length - 4) + s.slice(-4);
}

app.get('/api/license/status', async (req, res) => {
  try {
    const hardwareHwid = String(req.headers['x-hardware-hwid'] || '').trim();
    const active = hardwareHwid ? await db.verifyLicenseActive(hardwareHwid) : null;
    if (!active || active.hardwareHwid !== hardwareHwid) {
      return res.json({
        success: true,
        activated: false,
        message: 'Chưa kích hoạt bản quyền hoặc đã hết hạn thuê',
      });
    }

    const now = new Date();
    const expire = new Date(active.expiresAt);
    const daysRemaining = Math.max(0, Math.ceil((expire.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const isExpired = expire < now;

    return res.json({
      success: true,
      activated: !isExpired,
      license: {
        licenseKey: maskLicenseKey(active.licenseKey),
        customerName: active.customerName,
        packageType: active.packageType,
        maxVias: active.maxVias,
        expiresAt: active.expiresAt,
        daysRemaining,
        isExpired,
        status: isExpired ? 'EXPIRED' : active.status,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Kích hoạt mã License mới trên máy khách
app.post('/api/license/activate', async (req, res) => {
  try {
    const { licenseKey, hardwareHwid } = req.body;
    if (!licenseKey) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp mã License Key' });
    }
    const result = await db.activateLicense({ licenseKey: licenseKey.trim(), hardwareHwid });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Admin: Danh sách tất cả khách thuê
app.get('/api/license/admin/list', requireAdmin, async (req, res) => {
  try {
    const licenses = await db.getLicenses();
    return res.json({ success: true, licenses });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Admin: Tạo mã thuê mới cho đối tác/khách hàng
app.post('/api/license/admin/create', requireAdmin, async (req, res) => {
  try {
    const { customerName, customerContact, packageType, maxVias, days, notes } = req.body;
    if (!customerName) {
      return res.status(400).json({ success: false, error: 'Tên khách hàng thuê là bắt buộc' });
    }
    const newLicense = await db.createLicense({
      customerName,
      customerContact,
      packageType,
      maxVias: Number(maxVias) || 50,
      days: Number(days) || 30,
      notes,
    });
    return res.json({ success: true, license: newLicense });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Admin: Cập nhật trạng thái hoặc gia hạn (+30 ngày)
app.post('/api/license/admin/update-status', requireAdmin, async (req, res) => {
  try {
    const { id, status, addDays } = req.body;
    const result = await db.updateLicenseStatus(id, status, Number(addDays) || 0);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Khởi động server

// Nạp dữ liệu từ MySQL (hoặc chuyển JSON cũ lên MySQL lần đầu) rồi mới nhận request
store
  .init(db)
  .then((r) => {
    console.log(
      r.dbOk
        ? `[StateStore] ✅ Đã nạp dữ liệu từ MySQL${r.pendingSync.length ? ` (chờ đồng bộ: ${r.pendingSync.join(', ')})` : ''}.`
        : '[StateStore] ⚠️ MySQL không dùng được, đang chạy bằng file JSON dự phòng; sẽ tự đồng bộ lại khi MySQL sống.'
    );
  })
  .catch((err) => console.error('[StateStore] ❌ Lỗi khởi tạo:', err.message));

// Tắt server: ghi nốt dữ liệu đang chờ
let isShuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    try {
      await Promise.race([store.flush(), new Promise((r) => setTimeout(r, 4000))]);
    } catch (_) {}
    process.exit(0);
  });
}

app.listen(PORT, async () => {
  console.log(`\n================================================================`);
  console.log(`✨ VIPLIKE RADIANT BACKEND ĐANG CHẠY TẠI http://localhost:${PORT}`);
  console.log(`================================================================`);

  // Kiểm tra kết nối MySQL Workbench ngay khi khởi động
  const dbStatus = await db.testConnection();
  if (dbStatus.connected) {
    console.log(`✅ Kết nối MySQL Workbench (Database: ${db.dbConfig.database}) THÀNH CÔNG!`);
  } else {
    console.warn(`⚠️ MySQL Workbench chưa kết nối: ${dbStatus.error}`);
    console.warn(`👉 Kiểm tra MySQL Server (Port 3306) hoặc cấu hình trong file .env`);
  }
});
