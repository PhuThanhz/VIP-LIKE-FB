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
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 5000,
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
};
