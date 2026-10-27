/**
 * db.js - Quản lý kết nối MySQL Workbench cho VIPLIKE RADIANT
 * Kết nối trực tiếp vào Database 'autopost_saas' trên MySQL Workbench (port 3306)
 * Hỗ trợ bộ nhớ đệm tự động (Local Cache Fallback) chống gián đoạn khi MySQL bảo trì/chưa bật.
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const ACCOUNTS_CACHE_FILE = path.join(dataDir, 'accounts_cache.json');

function loadAccountsCache() {
  try {
    if (fs.existsSync(ACCOUNTS_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_CACHE_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.warn('[DB Cache] ⚠️ Không đọc được accounts_cache.json:', e.message);
  }
  return [];
}

function saveAccountsCache(accounts) {
  try {
    const tmp = `${ACCOUNTS_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2), 'utf8');
    fs.renameSync(tmp, ACCOUNTS_CACHE_FILE);
  } catch (e) {
    console.warn('[DB Cache] ⚠️ Không lưu được accounts_cache.json:', e.message);
  }
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '26082003',
  database: process.env.DB_NAME || 'autopost_saas',
  waitForConnections: true,
  connectionLimit: 15,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 0,
  connectTimeout: 8000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  timezone: '+07:00',
  charset: 'utf8mb4_unicode_ci',
};

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
}

/**
 * Kiểm tra kết nối tới MySQL Workbench
 */
async function testConnection() {
  try {
    const p = getPool();
    const [rows] = await p.execute('SELECT 1 as test');
    const [tables] = await p.execute('SHOW TABLES');
    return {
      success: true,
      connected: true,
      usingCache: false,
      config: {
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user,
      },
      tables: tables.map((r) => Object.values(r)[0]),
    };
  } catch (err) {
    const cachedAccounts = loadAccountsCache();
    console.warn('[MySQL Workbench] ⚠️ Lỗi kết nối MySQL (Dùng bộ nhớ đệm):', err.message);
    return {
      success: true,
      connected: false,
      usingCache: cachedAccounts.length > 0,
      cachedCount: cachedAccounts.length,
      config: {
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user,
      },
      error: err.message,
    };
  }
}

/**
 * Lấy danh sách toàn bộ tài khoản Via / Fanpage từ MySQL Workbench (hoặc Cache dự phòng)
 */
async function getSocialAccounts() {
  try {
    const p = getPool();
    const [rows] = await p.execute(`
      SELECT 
        id, 
        user_id as userId, 
        platform, 
        platform_account_id as platformAccountId, 
        access_token as cookieString, 
        access_token as accessToken, 
        page_name as pageName, 
        account_type as accountType, 
        token_status as tokenStatus, 
        proxy_url as proxyUrl, 
        token_checked_at as tokenCheckedAt, 
        created_at as createdAt, 
        updated_at as updatedAt
      FROM social_accounts 
      ORDER BY id DESC
    `);
    // Cập nhật bộ nhớ đệm tự động khi MySQL hoạt động
    if (Array.isArray(rows) && rows.length > 0) {
      saveAccountsCache(rows);
    }
    return rows;
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Không kết nối được MySQL, chuyển sang đọc accounts_cache.json:', err.message);
    const cached = loadAccountsCache();
    if (cached.length > 0) return cached;
    return [];
  }
}

/**
 * Lấy danh sách Via còn sống (có c_user trong access_token/cookie)
 */
async function getLiveVias() {
  try {
    const p = getPool();
    const [rows] = await p.execute(`
      SELECT 
        id, 
        page_name as viaName, 
        access_token as cookieString, 
        proxy_url as proxyUrl, 
        token_status as tokenStatus
      FROM social_accounts 
      WHERE platform IN ('FACEBOOK', 'FACEBOOK_PAGE', 'FACEBOOK_PROFILE') 
        AND access_token LIKE '%c_user%' 
        AND (token_status IS NULL OR (token_status != 'EXPIRED' AND token_status != 'CHECKPOINT')) 
      ORDER BY id DESC
    `);

    const seenCUsers = new Set();
    const vias = [];
    for (const row of rows || []) {
      const m = (row.cookieString || '').match(/(?:^|;\s*)c_user=([^;]+)/);
      const uid = m ? m[1] : `id_${row.id}`;
      if (seenCUsers.has(uid)) continue;
      seenCUsers.add(uid);
      vias.push({
        id: row.id,
        uid,
        viaName: row.viaName || `Via ${uid}`,
        cookieString: row.cookieString,
        proxyUrl: row.proxyUrl || '',
        tokenStatus: row.tokenStatus || 'OK',
      });
    }
    return vias;
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Không kết nối được MySQL, trích xuất Live Vias từ cache:', err.message);
    const cached = loadAccountsCache();
    const seenCUsers = new Set();
    const vias = [];
    for (const row of cached || []) {
      const cookieStr = row.cookieString || row.accessToken || '';
      if (!cookieStr.includes('c_user=')) continue;
      if (row.tokenStatus === 'EXPIRED' || row.tokenStatus === 'CHECKPOINT') continue;
      const m = cookieStr.match(/(?:^|;\s*)c_user=([^;]+)/);
      const uid = m ? m[1] : `id_${row.id}`;
      if (seenCUsers.has(uid)) continue;
      seenCUsers.add(uid);
      vias.push({
        id: row.id,
        uid,
        viaName: row.pageName || `Via ${uid}`,
        cookieString: cookieStr,
        proxyUrl: row.proxyUrl || '',
        tokenStatus: row.tokenStatus || 'OK',
      });
    }
    return vias;
  }
}

/**
 * Thêm một Via hoặc Fanpage mới vào bảng social_accounts trên MySQL Workbench & Cache
 */
async function addSocialAccount({
  userId = 1,
  platform = 'FACEBOOK_PROFILE',
  platformAccountId = '',
  cookieString = '',
  pageName = '',
  accountType = 'PERSONAL_PROFILE_COOKIE',
  proxyUrl = '',
}) {
  const cUserMatch = (cookieString || '').match(/(?:^|;\s*)c_user=([^;]+)/);
  const accountId = platformAccountId || (cUserMatch ? cUserMatch[1] : `fb_${Date.now()}`);
  const name = pageName || (cUserMatch ? `Via ${cUserMatch[1]}` : 'Facebook Account');

  let newId = Date.now();
  try {
    const p = getPool();
    const [res] = await p.execute(
      `INSERT INTO social_accounts (user_id, platform, platform_account_id, access_token, page_name, account_type, proxy_url, token_status, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'OK', NOW(), NOW())`,
      [userId, platform, accountId, cookieString, name, accountType, proxyUrl || '']
    );
    newId = res.insertId;
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Lỗi lưu MySQL, lưu tạm vào cache:', err.message);
  }

  const newAccount = {
    id: newId,
    userId,
    platform,
    platformAccountId: accountId,
    pageName: name,
    cookieString,
    accessToken: cookieString,
    accountType,
    proxyUrl,
    tokenStatus: 'OK',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const cached = loadAccountsCache();
  cached.unshift(newAccount);
  saveAccountsCache(cached);

  return newAccount;
}

/**
 * Cập nhật thông tin tài khoản trong MySQL Workbench & Cache
 */
async function updateSocialAccount(id, { pageName, cookieString, proxyUrl, tokenStatus }) {
  try {
    const p = getPool();
    const updates = [];
    const params = [];

    if (pageName !== undefined) {
      updates.push('page_name = ?');
      params.push(pageName);
    }
    if (cookieString !== undefined) {
      updates.push('access_token = ?');
      params.push(cookieString);
    }
    if (proxyUrl !== undefined) {
      updates.push('proxy_url = ?');
      params.push(proxyUrl);
    }
    if (tokenStatus !== undefined) {
      updates.push('token_status = ?');
      updates.push('token_checked_at = NOW()');
      params.push(tokenStatus);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    await p.execute(`UPDATE social_accounts SET ${updates.join(', ')} WHERE id = ?`, params);
  } catch (err) {
    console.warn(`[MySQL Workbench] ⚠️ Lỗi cập nhật ID ${id} trên MySQL, cập nhật cache:`, err.message);
  }

  // Luôn cập nhật cache
  const cached = loadAccountsCache();
  const idx = cached.findIndex((a) => a.id === Number(id) || a.id === id);
  if (idx !== -1) {
    if (pageName !== undefined) cached[idx].pageName = pageName;
    if (cookieString !== undefined) {
      cached[idx].cookieString = cookieString;
      cached[idx].accessToken = cookieString;
    }
    if (proxyUrl !== undefined) cached[idx].proxyUrl = proxyUrl;
    if (tokenStatus !== undefined) cached[idx].tokenStatus = tokenStatus;
    cached[idx].updatedAt = new Date().toISOString();
    saveAccountsCache(cached);
  }

  return { success: true };
}

/**
 * Cập nhật trạng thái Token / Session (OK, CHECKPOINT, EXPIRED)
 */
async function updateTokenStatus(id, status) {
  try {
    const p = getPool();
    await p.execute(
      'UPDATE social_accounts SET token_status = ?, token_checked_at = NOW() WHERE id = ?',
      [status, id]
    );
  } catch (e) {}

  const cached = loadAccountsCache();
  const idx = cached.findIndex((a) => a.id === Number(id) || a.id === id);
  if (idx !== -1) {
    cached[idx].tokenStatus = status;
    cached[idx].tokenCheckedAt = new Date().toISOString();
    saveAccountsCache(cached);
  }
}

/**
 * Xóa tài khoản khỏi MySQL Workbench & Cache
 */
async function deleteSocialAccount(id) {
  try {
    const p = getPool();
    await p.execute('DELETE FROM social_accounts WHERE id = ?', [id]);
  } catch (err) {
    console.warn(`[MySQL Workbench] ⚠️ Lỗi xóa ID ${id} trên MySQL:`, err.message);
  }

  const cached = loadAccountsCache();
  const filtered = cached.filter((a) => a.id !== Number(id) && a.id !== id);
  saveAccountsCache(filtered);

  return { success: true };
}

// =============================================================================
// QUẢN LÝ BẢN QUYỀN & CHO THUÊ TOOL (SOFTWARE LICENSES)
// =============================================================================
const LICENSES_CACHE_FILE = path.join(dataDir, 'licenses_cache.json');

function loadLicensesCache() {
  try {
    if (fs.existsSync(LICENSES_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(LICENSES_CACHE_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.warn('[License Cache] ⚠️ Không đọc được licenses_cache.json:', e.message);
  }
  // Khởi tạo key mẫu nếu chưa có
  return [
    {
      id: 1,
      licenseKey: 'VIP-PRO-2026-TRIAL-8888',
      customerName: 'Đối Tác Thuê VIPLIKE (Bản quyền mẫu)',
      customerContact: '0988888888',
      hardwareHwid: null,
      packageType: '1_MONTH',
      maxVias: 100,
      status: 'ACTIVE',
      activatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      notes: 'Gói thuê 30 ngày kích hoạt mẫu cho máy khách',
      createdAt: new Date().toISOString(),
    },
  ];
}

function saveLicensesCache(licenses) {
  try {
    const tmp = `${LICENSES_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(licenses, null, 2), 'utf8');
    fs.renameSync(tmp, LICENSES_CACHE_FILE);
  } catch (e) {
    console.warn('[License Cache] ⚠️ Không lưu được licenses_cache.json:', e.message);
  }
}

async function getLicenses() {
  try {
    const p = getPool();
    const [rows] = await p.execute(`
      SELECT 
        id, 
        license_key as licenseKey, 
        customer_name as customerName, 
        customer_contact as customerContact, 
        hardware_hwid as hardwareHwid, 
        package_type as packageType, 
        max_vias as maxVias, 
        status, 
        activated_at as activatedAt, 
        expires_at as expiresAt, 
        notes, 
        created_at as createdAt, 
        updated_at as updatedAt
      FROM software_licenses 
      ORDER BY id DESC
    `);
    if (Array.isArray(rows) && rows.length > 0) {
      saveLicensesCache(rows);
      return rows;
    }
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Lỗi đọc licenses:', err.message);
  }
  return loadLicensesCache();
}

async function createLicense({
  licenseKey,
  customerName,
  customerContact = '',
  packageType = '1_MONTH',
  maxVias = 50,
  days = 30,
  notes = '',
}) {
  const key = licenseKey || `VIP-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  let newId = Date.now();

  try {
    const p = getPool();
    const [res] = await p.execute(
      `INSERT INTO software_licenses 
        (license_key, customer_name, customer_contact, package_type, max_vias, status, expires_at, notes, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, NOW(), NOW())`,
      [key, customerName, customerContact, packageType, maxVias, expiresAt, notes]
    );
    newId = res.insertId;
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Lỗi tạo license MySQL:', err.message);
  }

  const newLicense = {
    id: newId,
    licenseKey: key,
    customerName,
    customerContact,
    hardwareHwid: null,
    packageType,
    maxVias,
    status: 'ACTIVE',
    activatedAt: null,
    expiresAt: expiresAt.toISOString(),
    notes,
    createdAt: new Date().toISOString(),
  };

  const cached = loadLicensesCache();
  cached.unshift(newLicense);
  saveLicensesCache(cached);

  return newLicense;
}

async function activateLicense({ licenseKey, hardwareHwid }) {
  const cached = loadLicensesCache();
  const lic = cached.find((l) => l.licenseKey === licenseKey);

  if (!lic) {
    return { success: false, error: 'Mã License không tồn tại trên hệ thống.' };
  }

  if (lic.status === 'LOCKED') {
    return { success: false, error: 'Mã License này đã bị KHÓA. Vui lòng liên hệ Admin.' };
  }

  const now = new Date();
  const expireDate = new Date(lic.expiresAt);
  if (expireDate < now) {
    return { success: false, error: 'Mã License này đã HẾT HẠN sử dụng.' };
  }

  // Nếu đã gắn HWID và máy khác cố kích hoạt
  if (lic.hardwareHwid && hardwareHwid && lic.hardwareHwid !== hardwareHwid) {
    return {
      success: false,
      error: `License này đã được kích hoạt cho thiết bị khác (${lic.hardwareHwid}). Không thể dùng trên máy này.`,
    };
  }

  // Gắn HWID và đánh dấu kích hoạt
  lic.hardwareHwid = hardwareHwid || lic.hardwareHwid;
  lic.activatedAt = lic.activatedAt || now.toISOString();
  saveLicensesCache(cached);

  try {
    const p = getPool();
    await p.execute(
      `UPDATE software_licenses SET hardware_hwid = ?, activated_at = COALESCE(activated_at, NOW()), updated_at = NOW() WHERE license_key = ?`,
      [lic.hardwareHwid, licenseKey]
    );
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Lỗi kích hoạt license MySQL:', err.message);
  }

  const daysRemaining = Math.max(0, Math.ceil((expireDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  return {
    success: true,
    license: {
      licenseKey: lic.licenseKey,
      customerName: lic.customerName,
      packageType: lic.packageType,
      maxVias: lic.maxVias,
      expiresAt: lic.expiresAt,
      daysRemaining,
      status: lic.status,
    },
  };
}

async function updateLicenseStatus(id, newStatus, addDays = 0) {
  const cached = loadLicensesCache();
  const lic = cached.find((l) => l.id === Number(id) || l.id === id);
  if (!lic) return { success: false, error: 'Không tìm thấy license' };

  lic.status = newStatus;
  if (addDays > 0) {
    const currentExpire = new Date(lic.expiresAt);
    const base = currentExpire > new Date() ? currentExpire : new Date();
    lic.expiresAt = new Date(base.getTime() + addDays * 24 * 60 * 60 * 1000).toISOString();
  }
  saveLicensesCache(cached);

  try {
    const p = getPool();
    if (addDays > 0) {
      await p.execute(`UPDATE software_licenses SET status = ?, expires_at = ?, updated_at = NOW() WHERE id = ?`, [
        newStatus,
        new Date(lic.expiresAt),
        id,
      ]);
    } else {
      await p.execute(`UPDATE software_licenses SET status = ?, updated_at = NOW() WHERE id = ?`, [newStatus, id]);
    }
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Lỗi cập nhật license MySQL:', err.message);
  }

  return { success: true, license: lic };
}

// =============================================================================
// LỊCH SỬ TƯƠNG TÁC (BUFF LOGS) - mỗi dòng là một lượt chạy, chi tiết Page lưu JSON
// Ghi MySQL trước; MySQL lỗi thì giữ trong buff_logs_cache.json (cờ _pending)
// và tự đẩy lên lại ở lần đọc/ghi kế tiếp khi MySQL hoạt động.
// =============================================================================
const BUFF_LOGS_CACHE_FILE = path.join(dataDir, 'buff_logs_cache.json');
const BUFF_LOGS_CACHE_MAX = 2000;
let buffLogsTableReady = false;

async function ensureBuffLogsTable(p) {
  if (buffLogsTableReady) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS buff_logs (
      id VARCHAR(64) PRIMARY KEY,
      user_id INT DEFAULT 1,
      run_type VARCHAR(16) NOT NULL,
      target_url TEXT NOT NULL,
      reaction_type VARCHAR(32),
      engagement_mode VARCHAR(32),
      account_name VARCHAR(255),
      total_pages INT DEFAULT 0,
      success_count INT DEFAULT 0,
      already_liked_count INT DEFAULT 0,
      failed_count INT DEFAULT 0,
      comment_count INT DEFAULT 0,
      details LONGTEXT,
      created_at DATETIME(3) NOT NULL,
      INDEX idx_buff_logs_created (created_at),
      INDEX idx_buff_logs_user_created (user_id, created_at),
      INDEX idx_buff_logs_type_created (run_type, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  buffLogsTableReady = true;
}

function loadBuffLogsCache() {
  try {
    if (fs.existsSync(BUFF_LOGS_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(BUFF_LOGS_CACHE_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.warn('[BuffLogs Cache] ⚠️ Không đọc được buff_logs_cache.json:', e.message);
  }
  return [];
}

function saveBuffLogsCache(logs) {
  try {
    const sorted = [...logs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const tmp = `${BUFF_LOGS_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(sorted.slice(0, BUFF_LOGS_CACHE_MAX)), 'utf8');
    fs.renameSync(tmp, BUFF_LOGS_CACHE_FILE);
  } catch (e) {
    console.warn('[BuffLogs Cache] ⚠️ Không lưu được buff_logs_cache.json:', e.message);
  }
}

const toInt = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);

/** Chuẩn hoá log từ frontend, trả null nếu thiếu id/targetUrl */
function normalizeBuffLog(log) {
  if (!log || typeof log !== 'object') return null;
  const id = typeof log.id === 'string' ? log.id.slice(0, 64) : '';
  const targetUrl = typeof log.targetUrl === 'string' ? log.targetUrl : '';
  if (!id || !targetUrl) return null;
  const created = new Date(log.createdAt);
  return {
    id,
    createdAt: Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString(),
    type: log.type === 'BATCH' ? 'BATCH' : 'SINGLE',
    targetUrl,
    reactionType: String(log.reactionType || 'LIKE').slice(0, 32),
    engagementMode: log.engagementMode ? String(log.engagementMode).slice(0, 32) : undefined,
    accountName: log.accountName ? String(log.accountName).slice(0, 255) : undefined,
    totalPages: toInt(log.totalPages),
    successCount: toInt(log.successCount),
    alreadyLikedCount: toInt(log.alreadyLikedCount),
    failedCount: toInt(log.failedCount),
    commentCount: toInt(log.commentCount),
    details: Array.isArray(log.details) ? log.details : [],
  };
}

function rowToBuffLog(row) {
  let details = row.details;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      details = [];
    }
  }
  return {
    id: row.id,
    createdAt: new Date(row.createdAt).toISOString(),
    type: row.type,
    targetUrl: row.targetUrl,
    reactionType: row.reactionType || 'LIKE',
    engagementMode: row.engagementMode || undefined,
    accountName: row.accountName || undefined,
    totalPages: row.totalPages,
    successCount: row.successCount,
    alreadyLikedCount: row.alreadyLikedCount,
    failedCount: row.failedCount,
    commentCount: row.commentCount,
    details: Array.isArray(details) ? details : [],
  };
}

async function upsertBuffLogsToMysql(p, logs) {
  if (logs.length === 0) return;
  await ensureBuffLogsTable(p);
  const placeholders = logs.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const params = logs.flatMap((l) => [
    l.id,
    l.type,
    l.targetUrl,
    l.reactionType,
    l.engagementMode || null,
    l.accountName || null,
    l.totalPages,
    l.successCount,
    l.alreadyLikedCount,
    l.failedCount,
    l.commentCount,
    JSON.stringify(l.details),
    new Date(l.createdAt),
  ]);
  await p.query(
    `INSERT INTO buff_logs
      (id, run_type, target_url, reaction_type, engagement_mode, account_name, total_pages,
       success_count, already_liked_count, failed_count, comment_count, details, created_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE
       run_type = VALUES(run_type), target_url = VALUES(target_url), reaction_type = VALUES(reaction_type),
       engagement_mode = VALUES(engagement_mode), account_name = VALUES(account_name),
       total_pages = VALUES(total_pages), success_count = VALUES(success_count),
       already_liked_count = VALUES(already_liked_count), failed_count = VALUES(failed_count),
       comment_count = VALUES(comment_count), details = VALUES(details)`,
    params
  );
}

/** Đẩy các log đang chờ (lưu lúc MySQL lỗi) lên MySQL */
async function flushPendingBuffLogs(p) {
  const cached = loadBuffLogsCache();
  const pending = cached.filter((l) => l._pending);
  if (pending.length === 0) return;
  for (let i = 0; i < pending.length; i += 100) {
    await upsertBuffLogsToMysql(p, pending.slice(i, i + 100));
  }
  saveBuffLogsCache(cached.map(({ _pending, ...l }) => l));
  console.log(`[BuffLogs] ✅ Đã đồng bộ ${pending.length} log chờ lên MySQL`);
}

/**
 * Lấy lịch sử tương tác mới nhất (MySQL, hoặc cache khi MySQL lỗi)
 */
async function getBuffLogs(limit = 500) {
  const safeLimit = Math.min(Math.max(toInt(limit) || 500, 1), BUFF_LOGS_CACHE_MAX);
  try {
    const p = getPool();
    await ensureBuffLogsTable(p);
    await flushPendingBuffLogs(p);
    const [rows] = await p.query(
      `SELECT id, run_type as type, target_url as targetUrl, reaction_type as reactionType,
        engagement_mode as engagementMode, account_name as accountName, total_pages as totalPages,
        success_count as successCount, already_liked_count as alreadyLikedCount,
        failed_count as failedCount, comment_count as commentCount, details, created_at as createdAt
       FROM buff_logs ORDER BY created_at DESC LIMIT ?`,
      [safeLimit]
    );
    const logs = rows.map(rowToBuffLog);
    saveBuffLogsCache(logs);
    return { logs, source: 'mysql' };
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Lỗi đọc buff_logs, dùng cache:', err.message);
    const logs = loadBuffLogsCache()
      .slice(0, safeLimit)
      .map(({ _pending, ...l }) => l);
    return { logs, source: 'cache' };
  }
}

/**
 * Lưu (thêm/cập nhật) một hoặc nhiều log. Trả về số log hợp lệ đã lưu.
 */
async function saveBuffLogs(rawLogs) {
  const logs = (Array.isArray(rawLogs) ? rawLogs : [rawLogs]).map(normalizeBuffLog).filter(Boolean);
  if (logs.length === 0) return { saved: 0, source: 'none' };

  let source = 'mysql';
  try {
    const p = getPool();
    for (let i = 0; i < logs.length; i += 100) {
      await upsertBuffLogsToMysql(p, logs.slice(i, i + 100));
    }
    await flushPendingBuffLogs(p);
  } catch (err) {
    source = 'cache';
    console.warn('[MySQL Workbench] ⚠️ Lỗi lưu buff_logs, giữ trong cache chờ đồng bộ:', err.message);
  }

  const incoming = new Map(logs.map((l) => [l.id, source === 'cache' ? { ...l, _pending: true } : l]));
  const cached = loadBuffLogsCache().filter((l) => !incoming.has(l.id));
  saveBuffLogsCache([...incoming.values(), ...cached]);

  return { saved: logs.length, source };
}

/**
 * Xoá toàn bộ lịch sử. Bắt buộc MySQL hoạt động để log không "sống lại" khi kết nối lại.
 */
async function clearBuffLogs() {
  const p = getPool();
  await ensureBuffLogsTable(p);
  await p.query('DELETE FROM buff_logs');
  saveBuffLogsCache([]);
  return { success: true };
}

module.exports = {
  dbConfig,
  getPool,
  testConnection,
  getSocialAccounts,
  getLiveVias,
  addSocialAccount,
  updateSocialAccount,
  updateTokenStatus,
  deleteSocialAccount,
  loadAccountsCache,
  saveAccountsCache,
  getLicenses,
  createLicense,
  activateLicense,
  updateLicenseStatus,
  loadLicensesCache,
  saveLicensesCache,
  getBuffLogs,
  saveBuffLogs,
  clearBuffLogs,
};

