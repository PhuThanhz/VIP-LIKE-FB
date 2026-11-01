/**
 * db.js - Quản lý kết nối MySQL Workbench cho VIPLIKE RADIANT
 * Kết nối trực tiếp vào Database 'viplike_radiant' trên MySQL Workbench (port 3306)
 * Hỗ trợ bộ nhớ đệm tự động (Local Cache Fallback) chống gián đoạn khi MySQL bảo trì/chưa bật.
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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
  if (pool) return; // Đã có MySQL Workbench làm nguồn chính
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
  database: process.env.DB_NAME || 'viplike_radiant',
  waitForConnections: true,
  connectionLimit: 25,
  maxIdle: 15,
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

let performanceIndexesReady = false;
async function ensurePerformanceIndexes(p) {
  if (performanceIndexesReady) return;
  try {
    const indexes = [
      {
        table: 'buff_history',
        name: 'idx_history_created_covering',
        sql: 'CREATE INDEX idx_history_created_covering ON buff_history (created_at DESC, status, page_id)',
      },
      {
        table: 'facebook_page_accesses',
        name: 'idx_page_profile_active',
        sql: 'CREATE INDEX idx_page_profile_active ON facebook_page_accesses (personal_profile_id, active, page_id)',
      },
      {
        table: 'buff_queue',
        name: 'idx_queue_status_time',
        sql: 'CREATE INDEX idx_queue_status_time ON buff_queue (status, schedule_time, id)',
      },
      {
        table: 'buff_logs',
        name: 'idx_logs_type_time',
        sql: 'CREATE INDEX idx_logs_type_time ON buff_logs (run_type, created_at DESC)',
      },
    ];

    for (const item of indexes) {
      try {
        const [existing] = await p.query(`SHOW INDEX FROM ${item.table} WHERE Key_name = ?`, [item.name]);
        if (!existing || existing.length === 0) {
          await p.query(item.sql);
          console.log(`[DB Indexing] ⚡ Tối ưu hóa Database: Đã tạo Index '${item.name}' trên bảng '${item.table}'`);
        }
      } catch (err) {}
    }
    performanceIndexesReady = true;
  } catch (err) {
    console.warn('[DB Indexing] ⚠️ Bỏ qua lỗi tạo Index:', err.message);
  }
}

/**
 * Kiểm tra kết nối tới MySQL Workbench
 */
async function testConnection() {
  try {
    const p = getPool();
    const [rows] = await p.execute('SELECT 1 as test');
    const [tables] = await p.execute('SHOW TABLES');
    ensurePerformanceIndexes(p).catch(() => {});
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
        token_status as tokenStatus,
        account_type as accountType
      FROM social_accounts 
      WHERE platform IN ('FACEBOOK', 'FACEBOOK_PAGE', 'FACEBOOK_PROFILE') 
        AND access_token LIKE '%c_user%' 
        AND (token_status IS NULL OR (token_status != 'EXPIRED' AND token_status != 'CHECKPOINT')) 
      ORDER BY 
        CASE WHEN account_type = 'PERSONAL_PROFILE_COOKIE' THEN 0 ELSE 1 END,
        id ASC
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
        accountType: row.accountType,
        cookieString: row.cookieString,
        proxyUrl: row.proxyUrl || '',
        tokenStatus: row.tokenStatus || 'OK',
      });
    }
    return vias;
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Không kết nối được MySQL, trích xuất Live Vias từ cache:', err.message);
    const cached = loadAccountsCache();
    const sortedCache = [...(cached || [])].sort((a, b) => {
      const aProf = a.accountType === 'PERSONAL_PROFILE_COOKIE' ? 0 : 1;
      const bProf = b.accountType === 'PERSONAL_PROFILE_COOKIE' ? 0 : 1;
      return aProf - bProf || (a.id || 0) - (b.id || 0);
    });
    const seenCUsers = new Set();
    const vias = [];
    for (const row of sortedCache) {
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
        accountType: row.accountType,
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
  let dbSaved = true;
  try {
    const p = getPool();
    const [res] = await p.execute(
      `INSERT INTO social_accounts (user_id, platform, platform_account_id, access_token, page_name, account_type, proxy_url, token_status, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'OK', NOW(), NOW())`,
      [userId, platform, accountId, cookieString, name, accountType, proxyUrl || '']
    );
    newId = res.insertId;
  } catch (err) {
    dbSaved = false;
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

  // dbSaved=false: mới chỉ lưu tạm vào cache cục bộ, chưa vào MySQL
  return { ...newAccount, dbSaved };
}

/**
 * Cập nhật thông tin tài khoản trong MySQL Workbench & Cache
 */
async function updateSocialAccount(id, { pageName, cookieString, proxyUrl, tokenStatus }) {
  let dbSaved = true;
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
    dbSaved = false;
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

  return { success: true, dbSaved };
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
 * Cập nhật chuỗi Cookie mới cho Via theo UID (cập nhật đồng bộ cả nick mẹ & các page con)
 */
async function updateViaCookieByUid(uid, cookieString, proxyUrl) {
  const cleanCookie = String(cookieString || '').trim();
  const cUserMatch = cleanCookie.match(/(?:^|;\s*)c_user=([^;]+)/);
  const targetUid = uid || (cUserMatch ? cUserMatch[1] : '');

  let dbSaved = true;
  try {
    const p = getPool();
    const updates = ['access_token = ?', "token_status = 'OK'", 'token_checked_at = NOW()', 'updated_at = NOW()'];
    const params = [cleanCookie];
    if (proxyUrl !== undefined && proxyUrl !== null && String(proxyUrl).trim()) {
      updates.push('proxy_url = ?');
      params.push(String(proxyUrl).trim());
    }
    await p.execute(
      `UPDATE social_accounts SET ${updates.join(', ')} WHERE platform_account_id = ? OR access_token LIKE ?`,
      [...params, targetUid, `%c_user=${targetUid}%`]
    );
  } catch (err) {
    dbSaved = false;
    console.warn(`[MySQL Workbench] ⚠️ Lỗi cập nhật cookie theo UID ${targetUid}:`, err.message);
  }

  // Luôn cập nhật cache
  const cached = loadAccountsCache();
  let updatedCount = 0;
  for (const acc of cached) {
    const accUid =
      (acc.cookieString || acc.accessToken || '').match(/(?:^|;\s*)c_user=([^;]+)/)?.[1] ||
      acc.platformAccountId;
    if (accUid === targetUid || acc.platformAccountId === targetUid) {
      acc.cookieString = cleanCookie;
      acc.accessToken = cleanCookie;
      acc.tokenStatus = 'OK';
      acc.tokenCheckedAt = new Date().toISOString();
      if (proxyUrl !== undefined && proxyUrl !== null && String(proxyUrl).trim()) {
        acc.proxyUrl = String(proxyUrl).trim();
      }
      acc.updatedAt = new Date().toISOString();
      updatedCount++;
    }
  }
  if (updatedCount > 0) {
    saveAccountsCache(cached);
  }
  return { success: true, updatedCount, dbSaved };
}

/**
 * Xóa tài khoản khỏi MySQL Workbench & Cache
 */
async function deleteSocialAccount(id) {
  let dbSaved = true;
  try {
    const p = getPool();
    await p.execute('DELETE FROM social_accounts WHERE id = ?', [id]);
  } catch (err) {
    dbSaved = false;
    console.warn(`[MySQL Workbench] ⚠️ Lỗi xóa ID ${id} trên MySQL:`, err.message);
  }

  const cached = loadAccountsCache();
  const filtered = cached.filter((a) => a.id !== Number(id) && a.id !== id);
  saveAccountsCache(filtered);

  return { success: true, dbSaved };
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
  if (pool) return; // Đã có MySQL Workbench làm nguồn chính
  try {
    const tmp = `${LICENSES_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(licenses, null, 2), 'utf8');
    fs.renameSync(tmp, LICENSES_CACHE_FILE);
  } catch (e) {
    console.warn('[License Cache] ⚠️ Không lưu được licenses_cache.json:', e.message);
  }
}

let softwareLicensesTableReady = false;

async function ensureSoftwareLicensesTable(p) {
  if (softwareLicensesTableReady) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS software_licenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      license_key VARCHAR(128) NOT NULL UNIQUE,
      customer_name VARCHAR(255) NOT NULL,
      customer_contact VARCHAR(255) DEFAULT '',
      hardware_hwid VARCHAR(255) DEFAULT NULL,
      package_type VARCHAR(64) DEFAULT '1_MONTH',
      max_vias INT DEFAULT 50,
      status VARCHAR(32) DEFAULT 'ACTIVE',
      activated_at DATETIME DEFAULT NULL,
      expires_at DATETIME NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_license_key (license_key),
      INDEX idx_status (status),
      INDEX idx_hardware_hwid (hardware_hwid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  softwareLicensesTableReady = true;
}

async function getLicenses() {
  try {
    const p = getPool();
    await ensureSoftwareLicensesTable(p);
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
    } else {
      // Nếu bảng rỗng, đồng bộ bản ghi mẫu từ cache vào MySQL
      const cached = loadLicensesCache();
      for (const lic of cached) {
        try {
          await p.execute(
            `INSERT IGNORE INTO software_licenses 
              (license_key, customer_name, customer_contact, hardware_hwid, package_type, max_vias, status, activated_at, expires_at, notes) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              lic.licenseKey,
              lic.customerName,
              lic.customerContact || '',
              lic.hardwareHwid || null,
              lic.packageType || '1_MONTH',
              lic.maxVias || 50,
              lic.status || 'ACTIVE',
              lic.activatedAt ? new Date(lic.activatedAt) : null,
              new Date(lic.expiresAt),
              lic.notes || ''
            ]
          );
        } catch (_) {}
      }
      return cached;
    }
  } catch (err) {
    console.warn('[Database] ⚠️ Lỗi đọc licenses:', err.message);
  }
  return loadLicensesCache();
}

async function verifyLicenseActive(hardwareHwid = null) {
  const licenses = await getLicenses();
  const now = new Date();
  const active = licenses.find((l) => {
    if (l.status !== 'ACTIVE') return false;
    const exp = new Date(l.expiresAt);
    if (exp < now) return false;
    if (hardwareHwid && l.hardwareHwid && l.hardwareHwid !== hardwareHwid) return false;
    return true;
  });
  return active || null;
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
      INDEX idx_logs_type_time (run_type, created_at)
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
  if (pool) return; // Đã có MySQL Workbench làm nguồn chính
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
    type: log.type === 'QUEUE' ? 'QUEUE' : (log.type === 'BATCH' ? 'BATCH' : 'SINGLE'),
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
 * Hỗ trợ Keyset Cursor Pagination O(1) chống chậm khi bảng lớn
 */
async function getBuffLogs(optionsOrLimit = 500, summaryOnlyArg = false) {
  let safeLimit = 500;
  let summaryOnly = false;
  let cursorCreatedAt = null;
  let cursorId = null;

  if (typeof optionsOrLimit === 'object' && optionsOrLimit !== null) {
    safeLimit = Math.min(Math.max(toInt(optionsOrLimit.limit) || 50, 1), BUFF_LOGS_CACHE_MAX);
    summaryOnly = Boolean(optionsOrLimit.summaryOnly);
    cursorCreatedAt = optionsOrLimit.cursorCreatedAt || null;
    cursorId = optionsOrLimit.cursorId || null;
  } else {
    safeLimit = Math.min(Math.max(toInt(optionsOrLimit) || 500, 1), BUFF_LOGS_CACHE_MAX);
    summaryOnly = Boolean(summaryOnlyArg);
  }

  try {
    const p = getPool();
    await ensureBuffLogsTable(p);
    await flushPendingBuffLogs(p);
    const selectCols = summaryOnly
      ? `id, run_type as type, target_url as targetUrl, reaction_type as reactionType,
         engagement_mode as engagementMode, account_name as accountName, total_pages as totalPages,
         success_count as successCount, already_liked_count as alreadyLikedCount,
         failed_count as failedCount, comment_count as commentCount, created_at as createdAt`
      : `id, run_type as type, target_url as targetUrl, reaction_type as reactionType,
         engagement_mode as engagementMode, account_name as accountName, total_pages as totalPages,
         success_count as successCount, already_liked_count as alreadyLikedCount,
         failed_count as failedCount, comment_count as commentCount, details, created_at as createdAt`;

    let sql = `SELECT ${selectCols} FROM buff_logs`;
    const params = [];

    if (cursorCreatedAt && cursorId) {
      sql += ` WHERE created_at < ? OR (created_at = ? AND id < ?)`;
      params.push(cursorCreatedAt, cursorCreatedAt, cursorId);
    } else if (cursorCreatedAt) {
      sql += ` WHERE created_at < ?`;
      params.push(cursorCreatedAt);
    }

    sql += ` ORDER BY created_at DESC, id DESC LIMIT ?`;
    params.push(safeLimit);

    const [rows] = await p.query(sql, params);
    const logs = rows.map((r) => (summaryOnly ? { ...r, details: [] } : rowToBuffLog(r)));
    if (!summaryOnly && !cursorCreatedAt) saveBuffLogsCache(logs);

    let nextCursor = null;
    if (logs.length === safeLimit) {
      const last = logs[logs.length - 1];
      nextCursor = {
        createdAt: last.createdAt instanceof Date ? last.createdAt.toISOString() : last.createdAt,
        id: last.id,
      };
    }

    return { logs, nextCursor, source: 'mysql' };
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Lỗi đọc buff_logs, dùng cache:', err.message);
    const logs = loadBuffLogsCache()
      .slice(0, safeLimit)
      .map(({ _pending, ...l }) => (summaryOnly ? { ...l, details: [] } : l));
    return { logs, nextCursor: null, source: 'cache' };
  }
}

/**
 * Lấy chi tiết đầy đủ của một lượt chạy theo ID (kèm JSON details)
 */
async function getBuffLogById(id) {
  if (!id) return null;
  try {
    const p = getPool();
    await ensureBuffLogsTable(p);
    const [rows] = await p.query(
      `SELECT id, run_type as type, target_url as targetUrl, reaction_type as reactionType,
        engagement_mode as engagementMode, account_name as accountName, total_pages as totalPages,
        success_count as successCount, already_liked_count as alreadyLikedCount,
        failed_count as failedCount, comment_count as commentCount, details, created_at as createdAt
       FROM buff_logs WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows || rows.length === 0) return null;
    return rowToBuffLog(rows[0]);
  } catch (err) {
    console.warn('[DB] ⚠️ Lỗi đọc log theo id:', err.message);
    return null;
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

// ---------------------------------------------------------------------------
// TELEGRAM NOTIFICATIONS & SETTINGS IN MYSQL
// ---------------------------------------------------------------------------
let telegramTableReady = false;
const TELEGRAM_NOTIFS_CACHE_FILE = path.join(dataDir, 'telegram_notifications_cache.json');

function loadTelegramNotifsCache() {
  try {
    if (fs.existsSync(TELEGRAM_NOTIFS_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(TELEGRAM_NOTIFS_CACHE_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.warn('[Telegram Cache] ⚠️ Không đọc được telegram_notifications_cache.json:', e.message);
  }
  return [];
}

function saveTelegramNotifsCache(list) {
  if (pool) return; // Đã có MySQL Workbench làm nguồn chính
  try {
    const sorted = [...list]
      .sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt))
      .slice(0, 200);
    const tmp = `${TELEGRAM_NOTIFS_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(sorted, null, 2), 'utf8');
    fs.renameSync(tmp, TELEGRAM_NOTIFS_CACHE_FILE);
  } catch (e) {
    console.warn('[Telegram Cache] ⚠️ Không lưu được cache:', e.message);
  }
}

async function ensureTelegramTable(p) {
  if (telegramTableReady) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS telegram_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      chat_id VARCHAR(64) NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(32) DEFAULT 'SENT',
      telegram_message_id INT NULL,
      error_message TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tg_created (created_at DESC),
      INDEX idx_tg_event (event_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  telegramTableReady = true;
}

async function saveTelegramNotification({
  chatId,
  eventType,
  title,
  message,
  status = 'SENT',
  telegramMessageId = null,
  errorMessage = null,
}) {
  const item = {
    chat_id: String(chatId || ''),
    event_type: String(eventType || 'GENERAL'),
    title: String(title || 'Thông báo hệ thống'),
    message: String(message || ''),
    status: String(status || 'SENT'),
    telegram_message_id: telegramMessageId ? Number(telegramMessageId) : null,
    error_message: errorMessage ? String(errorMessage) : null,
    created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };

  try {
    const p = getPool();
    await ensureTelegramTable(p);
    const [res] = await p.execute(
      `INSERT INTO telegram_notifications (chat_id, event_type, title, message, status, telegram_message_id, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.chat_id,
        item.event_type,
        item.title,
        item.message,
        item.status,
        item.telegram_message_id,
        item.error_message,
        item.created_at,
      ]
    );
    item.id = res.insertId;
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Không ghi được vào telegram_notifications (dùng cache):', err.message);
    item.id = Date.now();
  }

  const cached = loadTelegramNotifsCache();
  saveTelegramNotifsCache([item, ...cached]);
  return item;
}

async function getTelegramNotifications(limit = 50) {
  try {
    const p = getPool();
    await ensureTelegramTable(p);
    const [rows] = await p.query(
      `SELECT id, type, title, message, status, error, created_at FROM telegram_notifications ORDER BY created_at DESC LIMIT ?`,
      [Number(limit) || 50]
    );
    if (rows && rows.length > 0) return rows;
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Không đọc được telegram_notifications từ DB:', err.message);
  }
  return loadTelegramNotifsCache().slice(0, limit);
}

// =============================================================================
// KHO TRẠNG THÁI (app_state): người dùng, cài đặt, hàng đợi, lịch sử, monitors
// =============================================================================
let appStateTableReady = false;

async function ensureAppStateTable() {
  if (appStateTableReady) return;
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      state_key VARCHAR(64) NOT NULL PRIMARY KEY,
      state_value LONGTEXT NOT NULL,
      updated_ms BIGINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  appStateTableReady = true;
}

/** @returns {Promise<{value: string, updatedMs: number} | null>} */
async function getAppState(key) {
  await ensureAppStateTable();
  const [rows] = await getPool().execute(
    'SELECT state_value AS value, updated_ms AS updatedMs FROM app_state WHERE state_key = ?',
    [key]
  );
  return rows && rows[0] ? { value: rows[0].value, updatedMs: Number(rows[0].updatedMs) } : null;
}

async function saveAppState(key, jsonString) {
  await ensureAppStateTable();
  await getPool().execute(
    `INSERT INTO app_state (state_key, state_value, updated_ms) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_ms = VALUES(updated_ms)`,
    [key, jsonString, Date.now()]
  );
}

async function syncTelegramSettingsToDb(settings) {
  try {
    const p = getPool();
    const pairs = [
      ['telegram.bot_token', settings.telegramBotToken || ''],
      ['telegram.chat_id', settings.telegramChatId || ''],
      ['telegram.bot_username', settings.botInfo?.username || ''],
      ['telegram.bot_name', settings.botInfo?.firstName || ''],
      ['telegram.enabled', Boolean(settings.telegramBotToken && settings.telegramChatId) ? 'true' : 'false'],
      ['telegram.updated_at', new Date().toISOString()],
    ];
    for (const [k, v] of pairs) {
      await p.execute(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [k, v]
      );
    }
    return { success: true };
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Không đồng bộ được telegram settings vào app_settings:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Lấy danh sách Fanpage từ bảng facebook_page_accesses trên MySQL
 */
async function getFacebookPageAccesses(userId = 1, personalProfileId = null) {
  try {
    const p = getPool();
    let query = `SELECT id, page_id, page_name, personal_profile_id, profile_name, active, verification_status 
                 FROM facebook_page_accesses 
                 WHERE active = 1`;
    const params = [];
    if (personalProfileId) {
      query += ' AND personal_profile_id = ?';
      params.push(String(personalProfileId));
    }
    query += ' ORDER BY page_name ASC';
    const [rows] = await p.execute(query, params);
    return rows.map((r) => ({
      id: String(r.page_id),
      name: r.page_name,
      url: `https://www.facebook.com/${r.page_id}`,
      personalProfileId: r.personal_profile_id,
      profileName: r.profile_name,
      verificationStatus: r.verification_status,
    }));
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Không lấy được facebook_page_accesses:', err.message);
    return [];
  }
}

/**
 * Lưu danh sách Fanpage vào bảng facebook_page_accesses trên MySQL
 */
async function saveFacebookPageAccesses(pages = [], personalProfileId = '', profileName = '', userId = 1) {
  if (!Array.isArray(pages) || pages.length === 0) return { success: true, count: 0 };
  try {
    const p = getPool();
    let saved = 0;
    for (const pg of pages) {
      const pageId = String(pg.id || pg.pageId || '');
      const pageName = String(pg.name || pg.pageName || `Fanpage ${pageId}`).trim();
      if (!pageId) continue;
      await p.execute(
        `INSERT INTO facebook_page_accesses (
          user_id, personal_profile_id, page_id, page_name, profile_name,
          verification_status, active, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'VERIFIED', 1, NOW(), NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          page_name = VALUES(page_name),
          profile_name = COALESCE(VALUES(profile_name), profile_name),
          active = 1,
          last_seen_at = NOW(),
          updated_at = NOW()`,
        [userId, String(personalProfileId || ''), pageId, pageName, String(profileName || '')]
      );
      saved++;
    }
    return { success: true, count: saved };
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Lỗi lưu facebook_page_accesses:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Đồng bộ danh sách tài khoản người dùng vào bảng users trên MySQL
 */
async function syncUsersToDb(users = []) {
  if (!Array.isArray(users) || users.length === 0) return { success: true };
  try {
    const p = getPool();
    for (const u of users) {
      if (!u.username) continue;
      await p.execute(
        `INSERT INTO users (id, username, password, role, email, disabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           password = VALUES(password),
           role = VALUES(role),
           email = VALUES(email),
           updated_at = NOW()`,
        [u.id || null, u.username, u.password || '', u.role || 'ADMIN', u.email || `${u.username}@viplike.local`]
      );
    }
    return { success: true };
  } catch (err) {
    console.warn('[MySQL Workbench] ⚠️ Lỗi đồng bộ users vào MySQL:', err.message);
    return { success: false, error: err.message };
  }
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
  updateViaCookieByUid,
  deleteSocialAccount,
  loadAccountsCache,
  saveAccountsCache,
  getLicenses,
  verifyLicenseActive,
  createLicense,
  activateLicense,
  updateLicenseStatus,
  loadLicensesCache,
  saveLicensesCache,
  getBuffLogs,
  getBuffLogById,
  saveBuffLogs,
  clearBuffLogs,
  ensureTelegramTable,
  saveTelegramNotification,
  getTelegramNotifications,
  syncTelegramSettingsToDb,
  getFacebookPageAccesses,
  saveFacebookPageAccesses,
  syncUsersToDb,
  ensureAppStateTable,
  getAppState,
  saveAppState,
};

