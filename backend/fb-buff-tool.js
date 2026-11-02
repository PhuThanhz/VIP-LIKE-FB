/**
 * FB BUFF TOOL - BUFF LIKE ẨN BẰNG FANPAGE & BUFF VIEW VIDEO/REELS
 * Hỗ trợ:
 * 1. Quét toàn bộ Fanpage từ Cookie nick mẹ (Profile Pages / New Page Experience).
 * 2. Buff Like/Reaction (LIKE, LOVE, CARE, HAHA, WOW, SAD, ANGRY) bằng danh tính Fanpage vào bài viết (Like ẩn).
 * 3. Buff View Video/Reels đa luồng (Headless Playwright, tối ưu RAM/băng thông).
 */

const { chromium } = require('playwright');
const { getDeviceForUid, applyFingerprintToContext } = require('./device-fingerprints');
const {
  filterAvailablePagesForPost,
  recordPagePostInteraction,
  hasPageInteractedWithPost,
  getGlobalRegistryStats,
  getPostInteractedPageIds,
  normalizeFbPostUrl,
} = require('./page-post-registry');
const { isEmergencyStopped, loadSettings } = require('./telegram-alert');
const store = require('./state-store');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Cờ tối ưu hóa tốc độ và bộ nhớ RAM cho Playwright Chromium
const OPTIMIZED_CHROMIUM_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-notifications',
  '--mute-audio',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-breakpad',
  '--disable-component-update',
  '--disable-ipc-flooding-protection',
  '--no-first-run',
  '--no-default-browser-check',
  '--password-store=basic',
  '--use-mock-keychain',
  '--disk-cache-size=33554432',
  '--media-cache-size=16777216',
];

// Hàm chặn quảng cáo, pixel theo dõi, video nặng & ảnh thừa để tăng tốc 3-5 lần (tiết kiệm 80% RAM & băng thông)
async function applyResourceOptimization(context, allowMedia = false, blockImages = true) {
  try {
    await context.route('**/*', (route) => {
      const req = route.request();
      const rType = req.resourceType();
      const url = req.url();

      // Chặn các tracker, pixel telemetry & metrics nền gây nghẽn mạng Facebook
      if (
        url.includes('/tr/') ||
        url.includes('pixel.facebook.com') ||
        url.includes('connect.facebook.net') ||
        url.includes('googletagmanager.com') ||
        url.includes('doubleclick.net') ||
        url.includes('/ajax/bz') ||
        url.includes('logging_client_events') ||
        url.includes('browser_measurement') ||
        url.includes('/privacy/sandbox')
      ) {
        return route.abort();
      }

      // Khi chỉ cần Like/Comment, chặn luồng video mp4/m3u8 để tiết kiệm 70% băng thông
      if (!allowMedia && (rType === 'media' || url.endsWith('.mp4') || url.endsWith('.m3u8') || url.endsWith('.webm'))) {
        return route.abort();
      }

      // Chặn ảnh và web font khi buff tương tác để tiết kiệm 80% RAM, CPU và giảm 70% thời gian tải DOM
      if (blockImages) {
        if (
          rType === 'image' ||
          rType === 'font' ||
          /\.(png|jpe?g|webp|gif|avif|ico|woff2?|ttf|eot)(\?.*)?$/i.test(url)
        ) {
          return route.abort();
        }
      }

      return route.continue();
    });
  } catch (e) {
    // bỏ qua lỗi nếu context đã đóng
  }
}

// ==========================================
// 1. CÁC HÀM TIỆN ÍCH COOKIE & PARSING
// ==========================================


function parseCookieString(cookieStr, domain = '.facebook.com') {
  if (!cookieStr || typeof cookieStr !== 'string') return [];
  const parts = cookieStr.split(';');
  const cookies = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (name) {
      cookies.push({
        name,
        value,
        domain,
        path: '/',
        httpOnly: name === 'xs' || name === 'sb',
        secure: true,
        sameSite: 'Lax',
      });
    }
  }
  return cookies;
}

function getUserIdFromCookie(cookieStr) {
  const match = cookieStr.match(/(?:^|;\s*)c_user=([0-9]+)/);
  return match ? match[1] : null;
}

// ==========================================
// 1b. QUẢN LÝ BỘ NHỚ ĐỆM FANPAGE (PAGES CACHE)
// ==========================================

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
// Cache hết hạn để page mới được gán (vd. page trong BM) tự xuất hiện ở lần quét sau
const PAGES_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function loadPagesCache() {
  const data = store.read('pages_cache');
  return data && typeof data === 'object' && !Array.isArray(data) ? data : store.write('pages_cache', {});
}

function savePagesCache(cache) {
  store.write('pages_cache', cache);
}

function getCachedPages(uid) {
  if (!uid) return null;
  const cache = loadPagesCache();
  const entry = cache[uid];
  if (entry && Array.isArray(entry.pages) && entry.pages.length > 0) {
    const age = Date.now() - new Date(entry.updatedAt || 0).getTime();
    if (!(age < PAGES_CACHE_TTL_MS)) return null;
    return entry.pages;
  }
  return null;
}

function setCachedPages(uid, pages, viaName = '') {
  if (!uid || !Array.isArray(pages)) return;
  const cache = loadPagesCache();
  cache[uid] = {
    uid,
    viaName: viaName || `Via_${uid}`,
    updatedAt: new Date().toISOString(),
    count: pages.length,
    pages,
  };
  savePagesCache(cache);

  // Đồng bộ trực tiếp vào bảng facebook_page_accesses trên MySQL
  try {
    const db = require('./db');
    db.saveFacebookPageAccesses(pages, uid, viaName).catch((e) => {
      console.warn(`[FB-Buff] ⚠️ Không đồng bộ được pages vào MySQL facebook_page_accesses: ${e.message}`);
    });
  } catch (_) { }
}

// ==========================================
// 1c. BỘ ĐIỀU TIẾT CHỐNG KIỆT SỨC FANPAGE (PAGE FATIGUE GOVERNOR) & PROXY PARSER
// ==========================================

function parseProxy(proxyStr) {
  if (!proxyStr || typeof proxyStr !== 'string') return null;
  try {
    let trimmed = proxyStr.trim().replace(/^['"]|['"]$/g, '');
    if (!trimmed) return null;

    let scheme = 'http';
    if (trimmed.startsWith('socks5://')) {
      scheme = 'socks5';
      trimmed = trimmed.substring(9);
    } else if (trimmed.startsWith('https://')) {
      scheme = 'https';
      trimmed = trimmed.substring(8);
    } else if (trimmed.startsWith('http://')) {
      scheme = 'http';
      trimmed = trimmed.substring(7);
    }

    if (trimmed.includes('@')) {
      const atIdx = trimmed.indexOf('@');
      const p1 = trimmed.substring(0, atIdx);
      const p2 = trimmed.substring(atIdx + 1);

      const p2Parts = p2.split(':');
      const p1Parts = p1.split(':');

      if (p2Parts.length >= 2 && !isNaN(Number(p2Parts[p2Parts.length - 1]))) {
        // e.g. user:pass@ip:port
        const user = p1Parts[0] || '';
        const pass = p1Parts.slice(1).join(':') || '';
        return {
          server: `${scheme}://${p2}`,
          username: decodeURIComponent(user),
          password: decodeURIComponent(pass),
        };
      } else if (p1Parts.length >= 2 && !isNaN(Number(p1Parts[p1Parts.length - 1]))) {
        // e.g. ip:port@user:pass
        const user = p2Parts[0] || '';
        const pass = p2Parts.slice(1).join(':') || '';
        return {
          server: `${scheme}://${p1}`,
          username: decodeURIComponent(user),
          password: decodeURIComponent(pass),
        };
      }
    }

    const parts = trimmed.split(':');
    if (parts.length === 4) {
      return {
        server: `${scheme}://${parts[0]}:${parts[1]}`,
        username: parts[2],
        password: parts[3],
      };
    }
    if (parts.length === 2) {
      return {
        server: `${scheme}://${parts[0]}:${parts[1]}`,
      };
    }
  } catch (e) { }
  return null;
}

/**
 * Kiểm tra kết nối và độ trễ của Proxy qua Playwright request context
 */
async function testProxy(proxyStr, timeoutMs = 8000) {
  const parsed = parseProxy(proxyStr);
  if (!parsed) {
    return {
      success: false,
      error: 'Định dạng Proxy không hợp lệ. Hỗ trợ: ip:port hoặc ip:port:user:pass hoặc http(s)/socks5://user:pass@ip:port',
    };
  }

  const { request } = require('playwright');
  const startTime = Date.now();
  let reqContext = null;

  try {
    reqContext = await request.newContext({
      proxy: {
        server: parsed.server,
        username: parsed.username,
        password: parsed.password,
      },
      timeout: timeoutMs,
    });

    const res = await reqContext.get('http://ip-api.com/json/', { timeout: timeoutMs });
    const latencyMs = Date.now() - startTime;

    if (res.ok()) {
      const data = await res.json().catch(() => ({}));
      const outboundIp = data.query || 'N/A';
      const country = data.country || 'N/A';
      const countryCode = data.countryCode || '';
      const city = data.city || '';
      const isp = data.isp || '';

      return {
        success: true,
        ip: outboundIp,
        country,
        countryCode,
        city,
        isp,
        latencyMs,
        server: parsed.server,
        hasAuth: !!(parsed.username && parsed.password),
        message: `Proxy LIVE (${country}${city ? ' - ' + city : ''}) | Ping: ${latencyMs}ms | IP: ${outboundIp}`,
      };
    } else {
      return {
        success: false,
        error: `Proxy trả về mã lỗi HTTP ${res.status()}`,
        latencyMs,
      };
    }
  } catch (err) {
    const cleanError = (err.message || '').split('\n')[0].replace(/^apiRequestContext\.\w+:\s*/, '');
    return {
      success: false,
      error: `Kết nối qua Proxy thất bại: ${cleanError}`,
      latencyMs: Date.now() - startTime,
    };
  } finally {
    if (reqContext) {
      await reqContext.dispose().catch(() => { });
    }
  }
}

/**
 * Kiểm tra sức khỏe Proxy nhanh chóng (Quick Health Check)
 */
async function testProxyHealth(proxyStr, timeoutMs = 4000) {
  if (!proxyStr || typeof proxyStr !== 'string' || !proxyStr.trim()) {
    return { live: false, error: 'Proxy trống' };
  }
  const trimmed = proxyStr.trim();
  const parsed = parseProxy(trimmed);
  if (!parsed) {
    return { live: false, error: 'Định dạng Proxy không hợp lệ' };
  }
  try {
    const res = await testProxy(trimmed, timeoutMs);
    return {
      live: res.success === true,
      latencyMs: res.latencyMs || 0,
      ip: res.ip || '',
      country: res.country || '',
      city: res.city || '',
      server: parsed.server,
      error: res.error,
    };
  } catch (e) {
    return { live: false, error: e.message };
  }
}

/**
 * Lọc và kiểm tra danh sách Proxy trong Pool, trả về các Proxy còn sống (Live)
 */
async function filterLiveProxies(proxyList = [], timeoutMs = 4000) {
  if (!Array.isArray(proxyList) || proxyList.length === 0) return [];
  const results = await Promise.all(
    proxyList.map(async (p) => {
      const h = await testProxyHealth(p, timeoutMs);
      return { proxy: p, live: h.live, latencyMs: h.latencyMs };
    })
  );
  return results.filter((r) => r.live).map((r) => r.proxy);
}



function loadPageUsage() {
  const data = store.read('page_usage');
  return data && typeof data === 'object' && !Array.isArray(data) ? data : store.write('page_usage', {});
}

function savePageUsage(data) {
  store.write('page_usage', data);
}

// Ngày theo giờ Việt Nam (YYYY-MM-DD) để giới hạn reset lúc 0h chứ không phải 7h sáng (UTC)
function usageDateKey() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function recordPageAction(pageId) {
  if (!pageId) return;
  const today = usageDateKey();
  let usage = loadPageUsage();
  if (!usage[today]) {
    // Chỉ giữ 7 ngày gần nhất
    const kept = {};
    for (const d of Object.keys(usage).sort().slice(-6)) kept[d] = usage[d];
    kept[today] = {};
    usage = kept;
  }
  usage[today][pageId] = (usage[today][pageId] || 0) + 1;
  savePageUsage(usage);
}

function getPageUsageToday(pageId) {
  if (!pageId) return 0;
  const usage = loadPageUsage();
  const today = usageDateKey();
  return (usage[today] && usage[today][pageId]) || 0;
}

function getDailyPageActionLimit() {
  const limit = parseInt(loadSettings().maxDailyPageActions, 10);
  return Number.isFinite(limit) && limit > 0 ? limit : 25;
}

// ==========================================
// 2. QUÉT DANH SÁCH FANPAGE TỪ COOKIE NICK MẸ
// ==========================================

// Quét bảng "Trang & trang cá nhân của bạn" (menu tài khoản → Xem tất cả trang cá nhân → Xem thêm trang...).
// ID lấy từ phản hồi GraphQL khi bấm "Xem thêm trang"; page nào chỉ có tên (thường là URL vanity) thì
// tra ID bằng link trên your_pages.
async function scanProfileSwitcherPages(page, uid) {
  const idByName = new Map();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o.id === 'string' && /^\d{9,}$/.test(o.id) && typeof o.name === 'string' && o.name && !idByName.has(o.name)) {
      idByName.set(o.name, o.id);
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  const onResponse = async (r) => {
    if (!r.url().includes('/api/graphql')) return;
    try {
      const text = await r.text();
      for (const line of text.split('\n')) {
        try { walk(JSON.parse(line)); } catch (e) { }
      }
    } catch (e) { }
  };

  // Link của từng card trên your_pages (để tra page vanity), lấy trước khi rời trang
  const cardLinks = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('a[href]').forEach((a) => {
      const name = (a.innerText || '').trim().split('\n')[0];
      const href = a.href || '';
      if (name && !out[name] && /^https:\/\/www\.facebook\.com\/[^/?#]+\/?$/.test(href)) out[name] = href;
    });
    return out;
  }).catch(() => ({}));

  page.on('response', onResponse);
  try {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    await page.locator('[aria-label="Trang cá nhân của bạn"], [aria-label="Your profile"]').first().click({ timeout: 8000 });
    await page.waitForTimeout(2000);
    await page.getByText(/^(Xem tất cả trang cá nhân|See all profiles)$/).first().click({ timeout: 8000 });
    await page.waitForTimeout(2500);

    const dialog = page.locator('div[role="dialog"]').filter({ hasText: /Trang & trang cá nhân của bạn|Your profiles and Pages/ }).first();
    for (let i = 0; i < 100; i++) {
      const more = dialog.getByText(/^(Xem thêm trang|See more Pages|See more pages)$/).first();
      if (!(await more.isVisible().catch(() => false))) break;
      await more.click().catch(() => { });
      await page.waitForTimeout(1500);
    }

    const names = await dialog.evaluate((dlg) => {
      const noise = /^(Xem thêm trang|See more pages|Tạo|Create|Đi đến Trung tâm tài khoản|Go to Accounts Center|\d+ thông báo|Tìm kiếm.*)$/i;
      const cleanName = (str) => {
        if (!str) return '';
        return str
          .replace(/^(?:Chưa đọc|Unread)[\s\S]*?[·•]\s*/i, '')
          .replace(/(?:\r?\n|^)\s*\d+\s*(?:thông báo|tin nhắn|notifications?|messages?)[^\n]*/gi, '')
          .replace(/^[·•\s-]+|[·•\s-]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      };
      const set = new Set();
      dlg.querySelectorAll('[role="listitem"], [role="radio"], [role="button"], a').forEach((e) => {
        const raw = (e.innerText || '').split('\n')[0].trim();
        const t = cleanName(raw);
        if (t && t.length > 1 && t.length < 80 && !noise.test(t)) set.add(t);
      });
      return [...set];
    });
    await page.keyboard.press('Escape').catch(() => { });

    const results = [];
    for (const name of names) {
      let id = idByName.get(name) || '';
      let url = id ? `https://www.facebook.com/profile.php?id=${id}` : cardLinks[name] || '';
      if (!id && url) {
        // Page vanity: ID nằm ở "userID" trong HTML trang tường của page
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
        await page.waitForTimeout(2500);
        const html = await page.content().catch(() => '');
        const m = html.match(/"userID":"(\d{9,})"/);
        if (m && m[1] !== String(uid)) id = m[1];
      }
      if (!id || id === String(uid)) continue;
      const cleanUrl = (url || `https://www.facebook.com/profile.php?id=${id}`).split('&sk=')[0].split('&notif_id')[0].split('?notif_id')[0];
      results.push({ id, name, url: cleanUrl });
    }
    return results;
  } finally {
    page.off('response', onResponse);
  }
}

/**
 * Quét danh sách Fanpage từ Meta Accounts Centre (Trung tâm tài khoản - mục "Pages you manage / See all Pages")
 * Hỗ trợ các tài khoản được chuyển giao diện mới hiển thị 90+ Fanpage
 */
async function scanAccountsCenterPages(page, uid) {
  const pages = new Map();
  const onResponse = async (r) => {
    if (!r.url().includes('/api/graphql')) return;
    try {
      const text = await r.text();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          const walk = (o) => {
            if (!o || typeof o !== 'object') return;
            if (Array.isArray(o)) return o.forEach(walk);
            if (o.id && o.name && typeof o.name === 'string' && /^\d{10,}$/.test(String(o.id))) {
              if (String(o.id) !== String(uid) && !pages.has(String(o.id))) {
                pages.set(String(o.id), {
                  id: String(o.id),
                  name: o.name.trim(),
                  url: `https://www.facebook.com/profile.php?id=${o.id}`,
                });
              }
            }
            for (const k of Object.keys(o)) walk(o[k]);
          };
          walk(data);
        } catch (_) { }
      }
    } catch (_) { }
  };

  page.on('response', onResponse);
  try {
    await page.goto('https://accountscenter.facebook.com/profiles', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Tìm và click "See all Pages" hoặc "Xem tất cả trang"
    const seeAllBtn = page.getByText(/^(Xem tất cả trang|See all Pages|See all pages)/i).first();
    if (await seeAllBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await seeAllBtn.click().catch(() => { });
      await page.waitForTimeout(2000);
    }

    // Cuộn trang để kích hoạt tải sạch toàn bộ trang
    for (let r = 0; r < 25; r++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(600);
    }

    const domItems = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a[href*="/profile.php?id="], a[href*="facebook.com/"]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/id=([0-9]{10,})/);
        const name = (a.innerText || '').split('\n')[0].trim();
        if (m && name && name.length > 1) {
          out.push({ id: m[1], name, url: `https://www.facebook.com/profile.php?id=${m[1]}` });
        }
      });
      return out;
    }).catch(() => []);

    domItems.forEach((item) => {
      if (item.id !== String(uid) && !pages.has(item.id)) {
        pages.set(item.id, item);
      }
    });

    return Array.from(pages.values());
  } catch (err) {
    console.warn(`[FB-Buff] ⚠️ Lỗi trong scanAccountsCenterPages: ${err.message}`);
    return Array.from(pages.values());
  } finally {
    page.off('response', onResponse);
  }
}

/**
 * Quét danh sách tất cả các Fanpage mà tài khoản đang sở hữu/quản lý (hỗ trợ Cache)
 * @param {string} cookieStr - Chuỗi cookie của nick Facebook mẹ
 * @param {object} options - { forceRefresh: boolean, viaName: string, proxyUrl: string }
 * @returns {Promise<Array<{ id: string, name: string, url: string }>>}
 */
async function getManagedPages(cookieStr, options = {}) {
  const { forceRefresh = false, viaName = '', proxyUrl = '' } = options;
  const cookies = parseCookieString(cookieStr);
  if (!cookies.length) {
    throw new Error('Cookie rỗng hoặc không đúng định dạng');
  }

  const uid = getUserIdFromCookie(cookieStr);
  if (!forceRefresh && uid) {
    const cached = getCachedPages(uid);
    if (cached && cached.length > 0) {
      console.log(`[FB-Buff] ⚡ [CACHE HIT] Đã lấy ${cached.length} Fanpage từ cache cho UID: ${uid} (không tốn thời gian quét lại)`);
      return cached;
    }
  }

  const proxy = parseProxy(proxyUrl);
  const browser = await chromium.launch({
    headless: true,
    args: OPTIMIZED_CHROMIUM_ARGS,
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    await applyResourceOptimization(context, false);
    await context.addCookies(cookies);
    const page = await context.newPage();

    console.log('[FB-Buff] 🔄 Đang truy cập Facebook để lấy danh sách Fanpage...');
    await page.goto('https://www.facebook.com/pages/?category=your_pages', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(4000);

    // Kiểm tra đăng nhập
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      throw new Error('Cookie đã hết hạn hoặc bị checkpoint');
    }

    // CUỘN TẢI SÂU TOÀN BỘ DANH SÁCH FANPAGE (DÀNH CHO TÀI KHOẢN BM CÓ HÀNG TRĂM PAGE)
    console.log('[FB-Buff] 📜 Đang cuộn trang tự động để quét toàn bộ hàng trăm Fanpage trong BM...');
    let lastFoundCount = 0;
    let staleRounds = 0;
    const maxScrollRounds = 35; // Hỗ trợ quét tới 500+ Fanpage

    for (let round = 0; round < maxScrollRounds; round++) {
      const currentCards = await page.evaluate(() => {
        window.scrollBy(0, 1600);
        return document.querySelectorAll('div[role="article"], a[href*="/profile.php?id="], a[href*="/pages/"]').length;
      });
      await page.waitForTimeout(900);

      if (currentCards === lastFoundCount) {
        staleRounds++;
        if (staleRounds >= 3) {
          // Thử cuộn tận đáy trang một lần cuối để đảm bảo đã tải sạch
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1500);
          const finalCards = await page.evaluate(() => document.querySelectorAll('div[role="article"], a[href*="/profile.php?id="], a[href*="/pages/"]').length);
          if (finalCards === lastFoundCount) break;
        }
      } else {
        staleRounds = 0;
        lastFoundCount = currentCards;
        if (round % 5 === 0 && round > 0) {
          console.log(`[FB-Buff] 🔄 Tiến trình quét Fanpage BM: Đã nhận diện ~${currentCards} thẻ...`);
        }
      }
    }

    // Trích xuất danh sách Fanpage từ giao diện web một cách chuẩn xác
    const pageList = await page.evaluate(() => {
      const pageMap = new Map(); // pageId -> { id, name, url }
      const noiseRegex = /^(?:\d+\s*(?:thông báo|tin nhắn|notifications?|messages?)|chuyển sang|chuyển ngay|switch|quản lý|manage|xem trang|view page|trang cá nhân|profile)$/i;

      const cleanPageName = (raw) => {
        if (!raw) return '';
        let cleaned = raw
          .replace(/^(?:Chưa đọc|Unread)[\s\S]*?[·•]\s*/i, '')
          .replace(/(?:\r?\n|^)\s*\d+\s*(?:thông báo|tin nhắn|notifications?|messages?)[^\n]*/gi, '')
          .replace(/(?:\r?\n|^)\s*(?:Chuyển sang|Chuyển ngay|Switch into|Switch now|Quản lý|Manage|Xem trang)[^\n]*/gi, '')
          .replace(/^[·•\s-]+|[·•\s-]+$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        return cleaned;
      };

      // 1. Quét các thẻ cha đại diện cho từng Fanpage Card
      const cardContainers = document.querySelectorAll('div[role="article"], div[data-visualcompletion="ignore-dynamic-extra-content"], div[role="listitem"], a[href*="/profile.php?id="]');

      cardContainers.forEach((card) => {
        const link = card.tagName === 'A' ? card : card.querySelector('a[href*="/profile.php?id="], a[href*="/pages/"]');
        if (!link) return;

        const href = link.getAttribute('href') || '';
        const idMatch = href.match(/id=([0-9]{10,})/);
        if (!idMatch) return;
        const pageId = idMatch[1];

        // Tìm tiêu đề tên Fanpage từ các thẻ tiêu đề hoặc span chính
        const titleEl = card.querySelector('h2, h3, h4, strong, span[dir="auto"], span.x1lliihq') || link;
        const rawTitle = titleEl ? (titleEl.innerText || titleEl.textContent || '') : '';
        const cleanedTitle = cleanPageName(rawTitle);

        if (cleanedTitle && cleanedTitle.length > 1 && !noiseRegex.test(cleanedTitle)) {
          if (!pageMap.has(pageId) || (pageMap.get(pageId).name.length < cleanedTitle.length && !noiseRegex.test(cleanedTitle))) {
            pageMap.set(pageId, {
              id: pageId,
              name: cleanedTitle,
              url: href.startsWith('http') ? href : `https://www.facebook.com${href}`,
            });
          }
        }
      });

      // 2. Quét dự phòng toàn bộ các link nếu chưa đủ
      const allLinks = document.querySelectorAll('a[href*="/profile.php?id="]');
      allLinks.forEach((a) => {
        const href = a.getAttribute('href') || '';
        const idMatch = href.match(/id=([0-9]{10,})/);
        if (!idMatch) return;
        const pageId = idMatch[1];

        const raw = a.innerText || a.textContent || '';
        const cleaned = cleanPageName(raw);

        if (cleaned && cleaned.length > 1 && !noiseRegex.test(cleaned)) {
          if (!pageMap.has(pageId)) {
            pageMap.set(pageId, {
              id: pageId,
              name: cleaned,
              url: href.startsWith('http') ? href : `https://www.facebook.com${href}`,
            });
          } else {
            // Nếu tên hiện tại đang là dạng số hoặc quá ngắn mà tên mới đẹp hơn
            const current = pageMap.get(pageId);
            if (noiseRegex.test(current.name) || (current.name.length < cleaned.length && !noiseRegex.test(cleaned))) {
              current.name = cleaned;
            }
          }
        }
      });

      // 3. Chuẩn hóa lại lần cuối
      const results = [];
      for (const [id, item] of pageMap.entries()) {
        item.name = cleanPageName(item.name);
        item.url = (item.url || `https://www.facebook.com/profile.php?id=${id}`).split('&sk=')[0].split('&notif_id')[0].split('?notif_id')[0];
        if (!item.name || noiseRegex.test(item.name)) {
          item.name = `Fanpage (${id.slice(-4)})`;
        }
        results.push(item);
      }

      return results;
    });

    // Bổ sung từ bảng "Trang & trang cá nhân của bạn": đây đúng là danh sách page nick chuyển sang được,
    // thường nhiều hơn your_pages (page BM được gán, page dùng URL vanity...)
    try {
      const extra = await scanProfileSwitcherPages(page, uid);
      const known = new Set(pageList.map((p) => p.id));
      const knownNames = new Set(pageList.map((p) => p.name));
      let added = 0;
      for (const item of extra) {
        if (known.has(item.id) || (knownNames.has(item.name) && !item.id)) continue;
        known.add(item.id);
        pageList.push(item);
        added++;
      }
      console.log(`[FB-Buff] 🔁 Bảng chuyển trang cá nhân: ${extra.length} page, bổ sung thêm ${added} page.`);
    } catch (err) {
      console.warn(`[FB-Buff] ⚠️ Không quét được bảng chuyển trang cá nhân: ${err.message}`);
    }

    // Bổ sung từ Meta Accounts Centre (Trung tâm tài khoản - "See all Pages 92 >")
    try {
      const acPages = await scanAccountsCenterPages(page, uid);
      const known = new Set(pageList.map((p) => p.id));
      let addedAc = 0;
      for (const item of acPages) {
        if (known.has(item.id)) continue;
        known.add(item.id);
        pageList.push(item);
        addedAc++;
      }
      console.log(`[FB-Buff] 🏢 Meta Accounts Centre: ${acPages.length} page, bổ sung thêm ${addedAc} page.`);
    } catch (err) {
      console.warn(`[FB-Buff] ⚠️ Không quét được Accounts Centre: ${err.message}`);
    }

    console.log(`[FB-Buff] ✅ Đã tìm thấy và làm sạch tên ${pageList.length} Fanpage được quản lý.`);
    if (uid && pageList.length > 0) {
      setCachedPages(uid, pageList, viaName);
    }
    return pageList;
  } finally {
    await browser.close().catch(() => { });
  }
}

// ==========================================
// 3. BUFF LIKE ẨN BẰNG FANPAGE (PAGE REACTIONS & COMMENTS)
// ==========================================

/**
 * Giải mã cú pháp Spintax {A|B|C} đa tầng/lồng nhau (Nested Spintax) thành chuỗi ngẫu nhiên
 * Ví dụ: "{ {Chào|Hello} {bạn|shop} | {Bài viết|Nội dung} {quá hay|rất ý nghĩa} } {ạ!|nha!}"
 */
function resolveSpintax(text) {
  if (!text || typeof text !== 'string') return '';
  let result = text;
  let safety = 20;
  while (result.includes('{') && result.includes('}') && safety > 0) {
    const next = result.replace(/\{([^{}]+)\}/g, (_, choices) => {
      const options = choices.split('|');
      const chosen = options[Math.floor(Math.random() * options.length)];
      return (chosen !== undefined ? chosen : '').trim();
    });
    if (next === result) break;
    result = next;
    safety--;
  }
  return result.trim();
}

/**
 * Danh sách hậu tố tự nhiên giúp biến đổi bình luận tránh Meta/Admin phạt trùng lặp
 */
const NATURAL_VI_VARIATIONS = [
  ' ạ ❤️', ' nha bạn!', ' nhé 👍', ' quá nè ✨', ' bạn ơi 😊',
  ' quá ạ 🥰', ' luôn nè 🌟', ' nha shop 🍀', ' quá trời 👏', ' nha ạ ✨',
  ' nè bạn ơi!', ' nhé bạn 💖', ' ạ, cảm ơn bạn!', ' nè 🥰', ' nha! 🍀',
];

/**
 * Thư viện Mẫu Kịch Bản Seeding Thông Minh (Smart Seeding Presets)
 * Hỗ trợ Spintax đa tầng, chia theo nhóm mục tiêu thực chiến: Bán hàng, Khen ngợi viral, Thảo luận tranh luận
 */
const SEEDING_PRESETS = [
  {
    id: 'sales',
    name: 'Bán hàng & Chốt đơn',
    badge: 'Kinh doanh',
    description: 'Tạo hiệu ứng khách hỏi mua, xin giá, kích thích mua sắm',
    comments: [
      '{Shop ơi|Dạ shop|Shop yêu}|{cho em xin giá|inbox tư vấn em với ạ|sản phẩm này còn hàng không shop|ship về {Hà Nội|Sài Gòn|Đà Nẵng|Cần Thơ} mất mấy ngày ạ}?',
      '{Chất lượng|Hàng|Mẫu này} {đẹp quá|nhìn xịn xò thật sự|chuẩn chỉ ghê|rất ưng mắt}, {báo giá em với|ib em nha shop|tư vấn em chi tiết nhé|cho em đặt 1 cái với}! 🔥',
      '{Đã nhận được hàng|Vừa nhận hôm qua xong|Đã mua lần 2}, {dùng thích lắm|ưng ý lắm luôn|chất lượng tuyệt vời|shop tư vấn nhiệt tình ghê}. {Sẽ ủng hộ tiếp|Cho shop 5 sao nha|Chúc shop đắt hàng}! ⭐⭐⭐⭐⭐',
      '{Có màu khác không shop|Còn size {M|L|XL} không ạ|Bảo hành bao lâu vậy shop|Có được kiểm tra hàng trước khi nhận không ạ}?',
      '{Sản phẩm|Dịch vụ} bên mình {uy tín|chuyên nghiệp|chu đáo} thật, {bạn bè mình ai cũng khen|lần sau lại ghé ủng hộ tiếp nha}! ❤️',
    ],
  },
  {
    id: 'praise',
    name: 'Khen ngợi & Viral tương tác',
    badge: 'Viral',
    description: 'Đẩy mạnh tương tác tự nhiên, khen ngợi nội dung bài viết',
    comments: [
      '{Quá tuyệt vời|Xuất sắc luôn|Đỉnh của chóp|Quá ý nghĩa|Chuẩn luôn}|{ạ|nha|bác ơi|mọi người ơi}! {Rất thích|Cực kỳ thích|Rất ấn tượng với} {nội dung|bài viết|video|chia sẻ} này. ❤️',
      '{Tuyệt vời quá|Đẹp mê ly|Đẳng cấp thực sự|Không còn gì để chê}! {Mong chờ|Hóng|Chúc bạn|Chúc kênh} {các bài viết tiếp theo|ngày càng phát triển|luôn thành công}! 👏✨',
      '{Cảm ơn bạn đã chia sẻ|Thông tin rất hữu ích và giá trị|Nội dung chất lượng quá|Đúng cái mình đang tìm kiếm}! {Thả tim|Ủng hộ|Like mạnh} nha! 👍💯',
      '{Bài viết này|Chia sẻ này} {rất truyền cảm hứng|rất thiết thực|đọc thấm từng chữ luôn}. {Cảm ơn tác giả nhiều|Chúc bạn luôn tràn đầy năng lượng}! 🔥',
      '{10 điểm không có nhưng|Quá xịn sò|Chuẩn không cần chỉnh|Hay quá bạn ơi}! {Lan tỏa năng lượng tích cực này nhé}! 🌟',
    ],
  },
  {
    id: 'discussion',
    name: 'Thảo luận & Hỏi đáp',
    badge: 'Hỏi đáp',
    description: 'Kích thích bình luận tranh luận, giữ chân người xem lâu hơn',
    comments: [
      '{Bác|Bạn|Chủ thớt|Admin} cho mình hỏi {thêm chút kinh nghiệm về cái này với|chút xíu với ạ|đoạn này xử lý thế nào vậy ạ}? {Thấy hay quá|Nhìn cuốn thật sự|Tò mò ghê}! 🤔',
      '{Ai đã trải nghiệm|Có ai thử|Đã có bác nào dùng} cái này chưa ạ? {Cho em xin|Chia sẻ chút} review chân thực với nha! 🙌',
      '{Quan điểm này rất hay|Góc nhìn độc đáo ghê|Đúng là chuẩn không cần chỉnh}, {mình cũng đồng tình hoàn toàn|rất nhất trí với bạn}! 💡',
      '{Theo mọi người thì|Theo anh em thì} {phương án này|cách làm này} có {hiệu quả lâu dài|tối ưu nhất} không? Thảo luận cùng vui nào! 🚀',
      '{Có tài liệu hay nguồn tham khảo thêm không bạn|Chia sẻ thêm về phần này được không ạ}? Đang rất quan tâm chủ đề này! 📚',
    ],
  },
];

const REACTED_ARIA_RE = /(Gỡ|Remove|Đã thích|Liked|Thay đổi|Change)/i;
// Sau khi thả cảm xúc khác Like, nút Like hiển thị tên cảm xúc đó thay cho "Thích"
const REACTION_NAME_RE = /^(Yêu thích|Thương thương|Haha|Wow|Buồn|Phẫn nộ|Love|Care|Sad|Angry)$/i;

function isReactedState(state, beforeAria, beforeText = '') {
  if (!state) return false;
  // 1. Trạng thái aria đã đổi thành Gỡ Thích, Remove, Liked,...
  if (REACTED_ARIA_RE.test(state.aria)) return true;
  // 2. Trạng thái aria hoặc text đổi thành tên reaction khác (Haha, Yêu thích,...)
  if (REACTION_NAME_RE.test(state.aria) || REACTION_NAME_RE.test(state.text)) return true;
  // 3. aria-pressed chuyển thành true
  if (state.pressed === 'true') return true;
  // 4. aria thay đổi khác aria ban đầu và không còn là "Thích" đơn thuần
  if (Boolean(state.aria) && state.aria !== beforeAria && !/^(Thích|Like)$/i.test(state.aria)) return true;
  // 5. Nếu là dạng nút pill hiển thị số cảm xúc (ví dụ trước click là 3, sau click là 4 hoặc 5)
  if (beforeText && /^\d+$/.test(beforeText.trim()) && /^\d+$/.test((state.text || '').trim())) {
    const numBefore = parseInt(beforeText.trim(), 10);
    const numAfter = parseInt(state.text.trim(), 10);
    if (numAfter > numBefore) return true;
  }
  return false;
}

const readButtonState = (el) => {
  const aria = el.getAttribute('aria-label') || '';
  const pressed = el.getAttribute('aria-pressed') || '';
  const text = (el.innerText || '').trim();
  const isBlue = Boolean(
    el.querySelector('span[style*="rgb(8, 102, 249)"], span[style*="#0866ff"], i[style*="rgb(8, 102, 249)"], svg path[fill*="rgb(8, 102, 249)"]') ||
    (window.getComputedStyle(el).color === 'rgb(8, 102, 249)')
  );
  return { aria, pressed, text, isBlue };
};

// Xác nhận nút Like đã chuyển sang trạng thái "đã bày tỏ cảm xúc" sau khi click.
// Tối ưu: Polling phản hồi nhanh mỗi 50ms, phản hồi tức thì trong 60-150ms
async function verifyReacted(handle, beforeAria, refind = null, maxWaitMs = 1200, beforeText = '') {
  const start = Date.now();
  let retried = false;
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (handle) {
      const state = await handle.evaluate(readButtonState).catch(() => null);
      if (isReactedState(state, beforeAria, beforeText)) return true;
    }
    if (refind) {
      const fresh = await refind().catch(() => null);
      if (fresh) {
        const state = await fresh.evaluate(readButtonState).catch(() => null);
        if (isReactedState(state, beforeAria, beforeText)) return true;
        // Nếu qua 600ms Facebook chưa cập nhật, click bổ trợ 1 lần nữa để đảm bảo tương tác ăn 100%
        if (!retried && Date.now() - start > 600) {
          retried = true;
          await fresh.click({ timeout: 600 }).catch(async () => {
            await fresh.evaluate((el) => {
              if (typeof el.click === 'function') el.click();
            }).catch(() => { });
          });
        }
      }
    }
  }
  return false;
}

// Hỗ trợ dừng chờ ngay lập tức khi AbortSignal kích hoạt (Deep Cancellation)
function cancellableSleep(ms, signal) {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

// Hàm tính toán độ trễ tối ưu giữa các trang theo chuẩn Safe Human Pacing (chống spam, chống checkpoint)
function calculatePageDelay(delayMs, enableComment, dripFeedMode, dripDurationMinutes, totalPages, concurrency, speedMode = 'FAST') {
  if (dripFeedMode && dripDurationMinutes > 0) {
    const totalDurationMs = dripDurationMinutes * 60 * 1000;
    const dripBaseWait = Math.max(delayMs || 3000, Math.floor((totalDurationMs / Math.max(1, totalPages)) * concurrency));
    const dripJitter = Math.floor(dripBaseWait * 0.12 * (Math.random() * 2 - 1));
    return Math.max(2500, dripBaseWait + dripJitter);
  }

  if (enableComment) {
    // Có bình luận: giãn cách an toàn 7s - 10s
    const baseWait = delayMs > 0 ? Math.max(delayMs, 7500) : 8000;
    return baseWait + Math.floor(Math.random() * 2000);
  }

  // Chế độ TURBO (Siêu Tốc: 0.7s - 1.1s)
  if (speedMode === 'TURBO' || (delayMs > 0 && delayMs <= 1500)) {
    const base = delayMs > 0 ? Math.min(delayMs, 900) : 750;
    return base + Math.floor(Math.random() * 250);
  }

  // Chế độ FAST (Nhanh & Tối ưu: 1.4s - 1.8s)
  if (speedMode === 'FAST' || (delayMs > 1500 && delayMs <= 3000)) {
    const base = delayMs > 0 ? Math.min(delayMs, 1600) : 1400;
    return base + Math.floor(Math.random() * 300);
  }

  // Chế độ SMART (Thích ứng thông minh: 2.2s - 2.8s)
  if (speedMode === 'SMART') {
    let base = 2200;
    if (totalPages <= 50) base = 1800;
    else if (totalPages <= 100) base = 2200;
    else base = 2500;
    const jitter = Math.floor(base * 0.10 * (Math.random() * 2 - 1));
    return Math.max(1600, base + jitter);
  }

  // Chế độ SAFE (Siêu An Toàn: 4s - 6s)
  if (speedMode === 'SAFE' || delayMs >= 5000) {
    const base = delayMs > 0 ? Math.max(4500, delayMs) : 5000;
    return base + Math.floor(Math.random() * 1000);
  }

  // NORMAL (Chuẩn: 2.0s - 2.6s)
  const base = delayMs > 0 ? Math.min(delayMs, 2400) : 2100;
  const jitter = Math.floor(base * 0.12 * (Math.random() * 2 - 1));
  return Math.max(1800, base + jitter);
}

// Tìm nút Like siêu tốc: Quét và đánh dấu trực tiếp trong DOM nội tại (0.5ms) thay vì gọi 25 lệnh CDP tuần tự
async function findLikeButtonOnTab(tab) {
  try {
    const u = tab.url() || '';
    const isHome = u === 'https://www.facebook.com/' || u === 'https://www.facebook.com' || u.startsWith('https://www.facebook.com/?') || u.includes('facebook.com/home.php');
    if (isHome) {
      console.warn(`[FB-Buff] ⚠️ findLikeButtonOnTab: Tab đang ở trang chủ Facebook (${u}), từ chối quét Like để tránh like nhầm New Feed.`);
      return null;
    }

    const found = await tab.evaluate(() => {
      // Xóa đánh dấu cũ nếu có
      const prev = document.querySelectorAll('[data-viplike-target="like"]');
      prev.forEach((el) => el.removeAttribute('data-viplike-target'));

      function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      }

      function isLegitLikeButton(b) {
        if (!isVisible(b)) return false;
        // Bỏ qua nếu nằm trong thanh banner / header trên cùng
        if (b.closest('div[role="banner"]')) return false;
        // Bỏ qua nếu nằm trong popup thông báo, tin nhắn, cài đặt
        if (b.closest('div[aria-label*="Thông báo"], div[role="dialog"][aria-label*="Thông báo"], div[role="dialog"][aria-label*="Trang &"], div[role="dialog"][aria-label*="Cài đặt"], div[role="dialog"][aria-label*="Tin nhắn"]')) return false;

        const aria = (b.getAttribute('aria-label') || '').trim();
        const text = (b.innerText || '').trim();

        // Bỏ qua nút đếm số cảm xúc thuần (ví dụ "Thích: 2 người")
        if (/^(?:Thích|Like):\s*\d+/i.test(aria)) return false;

        // Khớp chính xác aria-label của nút Like / Cảm xúc (hỗ trợ cả Post, Video và Reels)
        if (
          aria === 'Thích' || aria === 'Like' ||
          /^Thích[,\s]/i.test(aria) || /^Like[,\s]/i.test(aria) ||
          aria === 'Gỡ Thích' || aria === 'Unlike' ||
          aria.startsWith('Gỡ ') || aria.startsWith('Remove ') ||
          aria.includes('Đã thích') || aria.includes('Liked') ||
          aria === 'Thích bài viết' || aria === 'Like post' ||
          aria === 'Bày tỏ cảm xúc' || aria === 'React' ||
          aria === 'Reaction' ||
          /^(?:Yêu thích|Thương thương|Haha|Wow|Buồn|Phẫn nộ|Love|Care|Sad|Angry)$/i.test(aria)
        ) {
          return true;
        }

        // Khớp nút có attribute quảng cáo Facebook
        if (b.querySelector('[data-ad-rendering-role="like_button"]') || b.getAttribute('data-ad-rendering-role') === 'like_button') {
          return true;
        }

        // Khớp chính xác theo text hiển thị (nhưng loại trừ text quá dài)
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (lines.length > 0 && (lines[0] === 'Thích' || lines[0] === 'Like') && text.length <= 15) {
          return true;
        }

        return false;
      }

      // Ưu tiên 1: Quét trong Modal Dialog bài viết đang mở (bài viết xem qua permalink/share nằm trong modal lightbox)
      const modals = Array.from(document.querySelectorAll('div[role="dialog"]')).filter((d) => {
        const aria = (d.getAttribute('aria-label') || '').toLowerCase();
        return !aria.includes('thông báo') && !aria.includes('trang &') && !aria.includes('chuyển sang') && !aria.includes('cài đặt') && !aria.includes('tin nhắn');
      });
      for (const m of modals) {
        const btns = Array.from(m.querySelectorAll('div[role="button"]'));
        const match = btns.find(isLegitLikeButton);
        if (match) {
          match.setAttribute('data-viplike-target', 'like');
          return true;
        }
      }

      // Ưu tiên 2: Quét trong bài viết (Feed article / Group post / Pagelet)
      const articles = Array.from(document.querySelectorAll('div[role="article"], div[data-pagelet*="FeedUnit"], div[data-pagelet*="Group"]'));
      for (const a of articles) {
        const btns = Array.from(a.querySelectorAll('div[role="button"]'));
        const match = btns.find(isLegitLikeButton);
        if (match) {
          match.setAttribute('data-viplike-target', 'like');
          return true;
        }
      }

      // Ưu tiên 3: Quét trong Reels / Video container (div[role="main"])
      const mains = Array.from(document.querySelectorAll('div[role="main"]'));
      for (const m of mains) {
        const btns = Array.from(m.querySelectorAll('div[role="button"]'));
        const match = btns.find(isLegitLikeButton);
        if (match) {
          match.setAttribute('data-viplike-target', 'like');
          return true;
        }
      }

      return false;
    });

    if (found) {
      return tab.locator('[data-viplike-target="like"]').first();
    }
  } catch (e) { }

  // Fallback Playwright Locator có phạm vi an toàn bên trong dialog, article hoặc main (Reels)
  const fastFallback = tab.locator(
    'div[role="dialog"]:not([aria-label*="Thông báo"]) div[role="button"][aria-label="Thích"], ' +
    'div[role="dialog"]:not([aria-label*="Thông báo"]) div[role="button"][aria-label="Like"], ' +
    'div[role="dialog"]:not([aria-label*="Thông báo"]) div[role="button"][aria-label="Gỡ Thích"], ' +
    'div[role="article"] div[role="button"][aria-label="Thích"], ' +
    'div[role="article"] div[role="button"][aria-label="Like"], ' +
    'div[role="article"] div[role="button"][aria-label="Gỡ Thích"], ' +
    'div[role="main"] div[role="button"][aria-label^="Thích"], ' +
    'div[role="main"] div[role="button"][aria-label^="Like"], ' +
    'div[role="main"] div[role="button"][aria-label^="Gỡ Thích"]'
  ).first();

  if (await fastFallback.isVisible({ timeout: 500 }).catch(() => false)) {
    return fastFallback;
  }

  return null;
}

async function checkActionBlockedOnTab(tab) {
  try {
    if (!tab || tab.isClosed()) return false;
    const curUrl = tab.url() || '';
    // Nếu tab đang ở trang chuyển tài khoản trung gian hoặc trang đăng nhập, không tính là Action Blocked
    if (curUrl.includes('forced_account_switch') || curUrl.includes('/login') || curUrl.includes('/checkpoint')) {
      return false;
    }

    const checkResult = await tab.evaluate(() => {
      const dialogs = document.querySelectorAll('div[role="dialog"], div[role="alertdialog"], [role="alert"]');
      const blockedPhrases = [
        'bạn tạm thời bị chặn',
        'hành động này bị chặn',
        'bạn tạm thời bị hạn chế',
        'you’re temporarily blocked',
        'you\'re temporarily blocked',
        'action blocked',
        'không thể bày tỏ cảm xúc',
        'tài khoản của bạn bị hạn chế',
        'your account is restricted',
        'we restrict certain activity',
      ];
      for (const d of dialogs) {
        // Bỏ qua modal xem bài viết, chọn profile, thông báo hệ thống thông thường
        const aria = (d.getAttribute('aria-label') || '').toLowerCase();
        if (
          aria.includes('bài viết') ||
          aria.includes('post') ||
          aria.includes('ảnh') ||
          aria.includes('photo') ||
          aria.includes('trang &') ||
          aria.includes('thông báo') ||
          aria.includes('chuyển') ||
          aria.includes('switch') ||
          aria.includes('reel') ||
          aria.includes('video')
        ) continue;

        const text = (d.innerText || '').toLowerCase();
        // Bỏ qua cảnh báo về tài khoản quảng cáo (Ads restriction không ảnh hưởng đến like bài viết thông thường)
        if (text.includes('quảng cáo') || text.includes('advertising') || text.includes('ad account')) continue;
        // Bỏ qua hướng dẫn chuyển tài khoản
        if (text.includes('chuyển sang') || text.includes('switch to')) continue;

        // Chỉ coi là Action Blocked nếu popup có tiêu đề hoặc nội dung cảnh báo ngắn gọn
        if (text.length > 0 && text.length < 500) {
          const matched = blockedPhrases.find((phrase) => text.includes(phrase));
          if (matched) {
            return { blocked: true, matched, text: text.slice(0, 180), aria };
          }
        }
      }
      return null;
    }).catch(() => null);

    if (checkResult && checkResult.blocked) {
      console.warn(`[FB-Buff] 🛑 Action Blocked khớp cụm từ: "${checkResult.matched}" trong [aria="${checkResult.aria}"]: "${checkResult.text.replace(/\s+/g, ' ')}"`);
      return true;
    }

    return false;
  } catch (e) {
    return false;
  }
}

/** Tự động đóng các popup / overlay làm phiền của Facebook (Lúc khác, Not now, Đóng, v.v.) */
async function dismissFacebookOverlays(tab) {
  try {
    await tab.evaluate(() => {
      const dismissTexts = ['lúc khác', 'not now', 'để sau', 'không phải bây giờ'];
      const dialogs = document.querySelectorAll('div[role="dialog"]');
      for (const dlg of dialogs) {
        // Nếu dialog này là nơi chứa bài viết hoặc nút Like (hộp thoại xem ảnh/reel), TUYỆT ĐỐI KHÔNG ĐƯỢC ĐÓNG
        const isPostDialog = Boolean(
          dlg.querySelector('[aria-label="Thích"], [aria-label="Like"], [aria-label*="Bình luận dưới tên"], [role="article"]')
        );
        if (isPostDialog) continue;

        const buttons = Array.from(dlg.querySelectorAll('div[role="button"], [aria-label="Đóng"], [aria-label="Close"], [aria-label="Hủy"]'));
        for (const btn of buttons) {
          const t = (btn.innerText || btn.getAttribute('aria-label') || '').trim().toLowerCase();
          if (dismissTexts.includes(t) || t === 'đóng' || t === 'close' || t === 'hủy' || t === 'cancel') {
            btn.click();
            break;
          }
        }
      }
    }).catch(() => { });
  } catch (_) { }
}

/** Tự động xử lý trang trung gian bắt chuyển tài khoản (forced_account_switch) của Facebook */
async function handleForcedAccountSwitch(tab, targetUrl = null, workerTag = '', pageInfo = null) {
  try {
    if (!tab || tab.isClosed()) return false;
    const u = tab.url() || '';
    if (u.includes('forced_account_switch')) {
      console.log(`[FB-Buff]${workerTag} ⚠️ Phát hiện trang "forced_account_switch" (Chuyển tài khoản). Đang tự động xử lý...`);

      // Nếu có tên Fanpage, ưu tiên click chọn danh tính Fanpage đó trên form thay vì để mặc định nick mẹ
      if (pageInfo && pageInfo.name) {
        const pageOption = tab.locator(
          `div[role="radio"]:has-text("${pageInfo.name}"), ` +
          `div[role="button"]:has-text("${pageInfo.name}"), ` +
          `label:has-text("${pageInfo.name}")`
        ).first();
        if (await pageOption.isVisible({ timeout: 1200 }).catch(() => false)) {
          console.log(`[FB-Buff]${workerTag} 🎯 Đã chọn danh tính Page "${pageInfo.name}" trên forced_account_switch`);
          await pageOption.click({ force: true }).catch(() => { });
          await tab.waitForTimeout(400);
        }
      }

      const submitBtn = tab.locator('input[type="submit"][value="Tiếp tục"], input[type="submit"][value="Continue"], button:has-text("Tiếp tục"), button:has-text("Continue"), div[role="button"]:has-text("Tiếp tục")').first();
      if (await submitBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
        await submitBtn.click().catch(() => { });
        await tab.waitForLoadState('domcontentloaded').catch(() => { });
        await tab.waitForTimeout(1000);
        if (targetUrl) {
          const cur = tab.url() || '';
          if (!cur.includes(targetUrl) && (cur.includes('forced_account_switch') || cur === 'https://www.facebook.com/')) {
            console.log(`[FB-Buff]${workerTag} 🔄 Sau khi giải phóng forced_account_switch, đưa tab về: ${targetUrl}...`);
            await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
            await tab.waitForTimeout(1000);
          }
        }
        return true;
      }
    }
  } catch (e) {
    console.warn(`[FB-Buff]${workerTag} ⚠️ Lỗi xử lý forced_account_switch:`, e.message);
  }
  return false;
}

/** Kiểm tra bài viết Facebook có bị lỗi "Trang này hiện không hiển thị / Nội dung không khả dụng" */
async function checkFacebookContentUnavailable(tab) {
  try {
    if (!tab || tab.isClosed()) return false;
    return await tab.evaluate(() => {
      const text = (document.body ? document.body.innerText : '') || '';
      const unavailableKeywords = [
        'trang này hiện không hiển thị',
        "this page isn't available at the moment",
        'nội dung này hiện không khả dụng',
        "this content isn't available right now",
        'rất tiếc, nội dung này không hiển thị',
        'liên kết bạn theo dõi có thể bị hỏng',
        'the link you followed may be broken',
        'trang có thể đã bị gỡ',
        'may have been removed',
      ];
      const lower = text.toLowerCase();
      for (const kw of unavailableKeywords) {
        if (lower.includes(kw)) return kw;
      }
      return false;
    }).catch(() => false);
  } catch (_) {
    return false;
  }
}

/** Đảm bảo Tab luôn mở và kết nối còn tốt, tự động phục hồi nếu Tab bị crash hoặc đóng */
async function ensureTabHealthy(context, currentTab) {
  try {
    if (!currentTab || currentTab.isClosed()) {
      console.log('[FB-Buff] 🔄 Tab bị đóng hoặc ngắt kết nối, đang tự động khởi tạo tab mới...');
      const newTab = await context.newPage();
      await newTab.route('**/*.{png,jpg,jpeg,webp,gif,avif,ico,mp4,mov,m4v,avi,webm,m3u8,ts}', (route) => route.abort()).catch(() => { });
      await newTab.route('**/*{google-analytics,doubleclick,connect.facebook.net/signals,pixel.facebook.com,facebook.com/tr/}*', (route) => route.abort()).catch(() => { });
      return newTab;
    }
    return currentTab;
  } catch (err) {
    const isBrowserDead = err.message && (
      err.message.includes('closed') ||
      err.message.includes('Target page') ||
      err.message.includes('Connection closed') ||
      err.message.includes('Target closed')
    );
    if (isBrowserDead) {
      console.error('[FB-Buff] 🛑 Trình duyệt Chromium đã bị đóng hoặc crash:', err.message);
      const deadErr = new Error(`Trình duyệt Chromium đã bị đóng hoặc crash: ${err.message}`);
      deadErr.isBrowserDead = true;
      throw deadErr;
    }
    console.warn('[FB-Buff] ⚠️ Lỗi kiểm tra tab, tạo lại tab sạch:', err.message);
    const newTab = await context.newPage();
    return newTab;
  }
}

async function dispatchSyntheticClick(el) {
  try {
    await el.click({ timeout: 1200 });
  } catch (e) {
    try {
      await el.evaluate((element) => {
        if (typeof element.click === 'function') element.click();
        ['mousedown', 'mouseup', 'click'].forEach((eventType) => {
          const evt = new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window,
            buttons: 1,
          });
          element.dispatchEvent(evt);
        });
      });
    } catch (e2) {
      await el.click({ force: true, timeout: 2500 }).catch(() => { });
    }
  }
}

async function getCurrentActor(tab) {
  return await tab.evaluate(() => {
    try {
      const init = window.require ? window.require('CurrentUserInitialData') : null;
      if (init && init.USER_ID) {
        return { id: String(init.USER_ID), name: init.NAME || '' };
      }
    } catch (e) { }
    return null;
  }).catch(() => null);
}

async function switchTabIdentity(tab, context, pageInfo, uid, workerTag = '') {
  const isProfileVia = !pageInfo.id || pageInfo.id === uid || pageInfo.isProfile === true;
  const targetId = String(pageInfo.id || uid);
  const targetName = (pageInfo.name || '').trim();

  // Kiểm tra xem hiện tại đã ở đúng danh tính chưa
  const currentActor = await getCurrentActor(tab);
  if (currentActor) {
    const isMatched = isProfileVia
      ? currentActor.id === String(uid)
      : (currentActor.id === targetId || (targetName && currentActor.name === targetName));
    if (isMatched) {
      console.log(`[FB-Buff]${workerTag} 🎯 Đã ở đúng danh tính "${currentActor.name}" (ID: ${currentActor.id})`);
      return true;
    }
  }

  console.log(`[FB-Buff]${workerTag} 🔄 Đang chuyển sang danh tính "${pageInfo.name || 'Nick mẹ'}" (ID: ${pageInfo.id || uid})...`);

  // Đóng các modal thừa nếu có
  await tab.keyboard.press('Escape').catch(() => { });
  await tab.waitForTimeout(300);

  // Bước 1: Mở menu Avatar góc trên cùng bên phải trong banner hoặc header navigation
  let avatarBtn = tab.locator(
    'div[role="banner"] div[role="button"][aria-label*="trang cá nhân"], ' +
    'div[role="banner"] div[role="button"][aria-label*="Your profile"], ' +
    'div[role="banner"] div[role="button"][aria-label*="Tài khoản"], ' +
    'div[role="navigation"] div[role="button"][aria-label*="trang cá nhân"], ' +
    'div[role="navigation"] div[role="button"][aria-label*="Tài khoản"], ' +
    '[aria-label*="Tài khoản cá nhân"], [aria-label*="Account controls and settings"]'
  ).first();

  let hasAvatar = (await avatarBtn.count().catch(() => 0)) > 0 && (await avatarBtn.isVisible({ timeout: 800 }).catch(() => false));

  // TỐI ƯU SIÊU TỐC: Chỉ khi giao diện hiện tại thực sự thiếu thanh header menu Avatar mới cần đưa về trang chủ
  if (!hasAvatar) {
    const curSwitchUrl = tab.url() || '';
    if (curSwitchUrl.includes('/watch/') || !curSwitchUrl.includes('facebook.com')) {
      await tab.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
      await tab.waitForTimeout(600);
      avatarBtn = tab.locator(
        'div[role="banner"] div[role="button"][aria-label*="trang cá nhân"], ' +
        'div[role="banner"] div[role="button"][aria-label*="Your profile"], ' +
        'div[role="banner"] div[role="button"][aria-label*="Tài khoản"], ' +
        '[aria-label*="Tài khoản cá nhân"]'
      ).first();
    }
  }

  let switched = false;
  if (await avatarBtn.isVisible({ timeout: 1800 }).catch(() => false)) {
    await avatarBtn.click({ force: true });
    await tab.waitForTimeout(350);

    // Bước 2: Kiểm tra xem Page/Via mục tiêu có nằm ngay trong danh sách rút gọn không
    const searchTargetName = isProfileVia ? '' : targetName;
    if (searchTargetName) {
      const quickPage = tab.locator(
        `div[role="menu"] div[role="button"]:has-text("${searchTargetName}"), ` +
        `div[role="dialog"] div[role="button"]:has-text("${searchTargetName}")`
      ).first();
      if (await quickPage.isVisible({ timeout: 400 }).catch(() => false)) {
        await quickPage.click({ force: true });
        switched = true;
      }
    } else if (isProfileVia) {
      // Chuyển về Via mẹ: Chọn profile cá nhân đầu tiên trong menu
      const viaOption = tab.locator(
        'div[role="menu"] div[role="button"], div[role="dialog"] div[role="button"]'
      ).first();
      if (await viaOption.isVisible({ timeout: 400 }).catch(() => false)) {
        await viaOption.click({ force: true });
        switched = true;
      }
    }

    // Bước 3: Nếu chưa bấm được, mở modal "Xem tất cả trang cá nhân"
    if (!switched) {
      const seeAllBtn = tab.locator(
        'div[role="button"]:has-text("Xem tất cả trang cá nhân"), ' +
        'div[role="button"]:has-text("See all profiles")'
      ).first();

      if (await seeAllBtn.isVisible({ timeout: 800 }).catch(() => false)) {
        await seeAllBtn.click({ force: true });
        await tab.waitForTimeout(250);

        // Bắt bất kỳ dialog nào vừa mở ra sau khi bấm "Xem tất cả trang cá nhân"
        let profileDlg = tab.locator('div[role="dialog"]').last();
        if (!(await profileDlg.isVisible({ timeout: 800 }).catch(() => false))) {
          profileDlg = tab.locator('div[role="dialog"]').first();
        }

        if (await profileDlg.isVisible({ timeout: 1000 }).catch(() => false)) {
          // Lọc ưu tiên bằng ô tìm kiếm trong modal để tìm chính xác trong kho BM lớn (hàng trăm Fanpage)
          const searchBox = profileDlg.locator(
            'input[placeholder*="Tìm"], input[aria-label*="Tìm"], input[placeholder*="Search"], input[aria-label*="Search"], input[type="search"], input[type="text"]'
          ).first();

          if (await searchBox.isVisible({ timeout: 600 }).catch(() => false)) {
            await searchBox.click({ force: true }).catch(() => {});
            await searchBox.fill(targetName).catch(() => {});
            await tab.waitForTimeout(250);
            const filteredItem = profileDlg.locator(
              `div[role="button"]:has-text("${targetName}"), ` +
              `div[role="listitem"]:has-text("${targetName}"), ` +
              `[aria-label*="${targetName}"]`
            ).first();
            if (await filteredItem.isVisible({ timeout: 800 }).catch(() => false)) {
              await filteredItem.click({ force: true });
              switched = true;
            }
          }

          if (!switched) {
            const pageItem = profileDlg.locator(
              `div[role="button"]:has-text("${targetName}"), ` +
              `div[role="listitem"]:has-text("${targetName}"), ` +
              `[aria-label*="${targetName}"]`
            ).first();

            if (await pageItem.isVisible({ timeout: 500 }).catch(() => false)) {
              await pageItem.click({ force: true });
              switched = true;
            }
          }
        }
      }
    }
  }

  // Fallback nếu không click được qua menu banner
  if (!switched) {
    if (isProfileVia) {
      await tab.goto(`https://www.facebook.com/profile.php?id=${uid}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
      const switchBtn = tab.locator('div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Chuyển")').first();
      if (await switchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await switchBtn.click({ force: true }).catch(() => { });
      }
    } else {
      await tab.goto(`https://www.facebook.com/profile.php?id=${pageInfo.id}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
      const switchBtn = tab.locator('div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Chuyển"), [aria-label*="Chuyển sang"], div[role="button"]:has-text("Switch now")').first();
      if (await switchBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
        await switchBtn.click({ force: true }).catch(() => { });
        await tab.waitForTimeout(600);

        // Kiểm tra nếu Facebook yêu cầu chuyển sang Via khác (không thuộc quyền của Via hiện tại)
        const mismatchDlg = tab.locator('div[role="dialog"]').filter({
          hasText: /Bạn cần chuyển sang|Chuyển tài khoản|You need to switch to/i
        }).first();
        if (await mismatchDlg.isVisible({ timeout: 1500 }).catch(() => false)) {
          console.warn(`[FB-Buff]${workerTag} ⚠️ Page "${pageInfo.name}" (${pageInfo.id}) thuộc quản trị của Via khác. Tự động bỏ qua.`);
          await tab.keyboard.press('Escape').catch(() => { });
          await tab.waitForTimeout(400);
          return false;
        }

        // Bắt và bấm nút "Chuyển" trong hộp thoại xác nhận đổi trang cá nhân Pro5 nếu có
        const modalConfirm = tab.locator(
          'div[role="dialog"] div[role="button"]:has-text("Chuyển"), ' +
          'div[role="dialog"] div[role="button"]:has-text("Switch"), ' +
          'div[role="dialog"] [aria-label*="Chuyển sang"]'
        ).first();
        if (await modalConfirm.isVisible({ timeout: 2500 }).catch(() => false)) {
          await modalConfirm.click({ force: true }).catch(() => { });
          switched = true;
          await tab.waitForTimeout(1000);
        } else {
          // Nút switchBtn đã được click thành công trực tiếp (Facebook chuyển ngay không hiện popup)
          switched = true;
          await tab.waitForTimeout(600);
        }
      }
    }
  }

  // Đóng mọi popover/menu còn mở để tránh cản trở điều hướng
  await tab.keyboard.press('Escape').catch(() => { });

  if (switched) {
    // Chờ Facebook thực hiện điều hướng chuyển sang phiên tài khoản mới hoàn tất
    await Promise.race([
      tab.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3500 }),
      tab.waitForTimeout(1100),
    ]).catch(() => { });
    await tab.waitForTimeout(150);

    const usePageBtn = tab.locator('div[role="button"]:has-text("Dùng Trang"), div[role="button"]:has-text("Use Page")').first();
    if (await usePageBtn.isVisible({ timeout: 400 }).catch(() => false)) {
      await usePageBtn.click({ force: true }).catch(() => { });
      await tab.waitForTimeout(100);
    }
  }

  // Cập nhật cookie i_user cho Playwright context (chìa khóa để Facebook nhận diện actor Fanpage)
  if (pageInfo.id && pageInfo.id !== uid && !pageInfo.isProfile) {
    await context.addCookies([
      {
        name: 'i_user',
        value: String(pageInfo.id),
        domain: '.facebook.com',
        path: '/',
        secure: true,
        sameSite: 'Lax',
      },
    ]).catch(() => { });
  } else {
    await context.clearCookies({ name: 'i_user' }).catch(() => { });
  }

  return true;
}

/**
 * Thực hiện chia sẻ bài viết (Share to Feed / Chia sẻ ngay) bằng danh tính Fanpage hiện tại trên Tab
 * Giúp tăng chỉ số Share thật trên bài viết của Facebook
 */
async function executePostShare(tab, workerTag = '') {
  try {
    // 1. Tìm nút Chia sẻ trên bài viết
    const shareSelectors = [
      'div[role="button"][aria-label*="Chia sẻ" i]',
      'div[role="button"][aria-label*="Share" i]',
      '[aria-label="Gửi nội dung này cho bạn bè hoặc đăng lên trang cá nhân của bạn."]',
      'div[role="article"] div[role="button"]:has-text("Chia sẻ")',
      'div[role="article"] div[role="button"]:has-text("Share")',
      'div[role="dialog"] div[role="button"]:has-text("Chia sẻ")',
      'div[role="dialog"] div[role="button"]:has-text("Share")',
      'div[role="button"]:has-text("Chia sẻ")',
      'div[role="button"]:has-text("Share")',
    ];

    let shareBtn = null;
    for (const sel of shareSelectors) {
      const loc = tab.locator(sel);
      const count = await loc.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const item = loc.nth(i);
        if (await item.isVisible().catch(() => false)) {
          const aria = (await item.getAttribute('aria-label').catch(() => '')) || '';
          const text = (await item.innerText().catch(() => '')) || '';
          const combined = `${aria} ${text}`.trim().toLowerCase();
          if (combined.includes('chia sẻ') || combined.includes('share')) {
            shareBtn = item;
            break;
          }
        }
      }
      if (shareBtn) break;
    }

    if (!shareBtn) {
      console.warn(`[FB-Buff]${workerTag} ⚠️ Không tìm thấy nút Chia sẻ trên bài viết.`);
      return { success: false, error: 'Không tìm thấy nút Chia sẻ trên bài viết' };
    }

    await shareBtn.scrollIntoViewIfNeeded().catch(() => { });
    await shareBtn.click({ force: true }).catch(async () => {
      await dispatchSyntheticClick(shareBtn);
    });
    await tab.waitForTimeout(650);

    // 2. Tìm tùy chọn "Chia sẻ ngay" hoặc "Chia sẻ lên Bảng feed"
    const shareOptions = [
      'div[role="menuitem"]:has-text("Chia sẻ ngay")',
      'div[role="menuitem"]:has-text("Share now")',
      'div[role="menuitem"]:has-text("Chia sẻ lên Bảng feed")',
      'div[role="menuitem"]:has-text("Chia sẻ lên Bảng tin")',
      'div[role="menuitem"]:has-text("Share to Feed")',
      'div[role="button"]:has-text("Chia sẻ ngay")',
      'div[role="button"]:has-text("Share now")',
      'div[role="button"]:has-text("Chia sẻ lên Bảng feed")',
      'div[role="button"]:has-text("Chia sẻ lên Bảng tin")',
      'div[role="button"]:has-text("Share to Feed")',
      'div[role="dialog"] div[role="button"]:has-text("Chia sẻ ngay")',
      'div[role="dialog"] div[role="button"]:has-text("Share now")',
    ];

    let optionClicked = false;
    for (const optSel of shareOptions) {
      const opt = tab.locator(optSel).first();
      if ((await opt.count().catch(() => 0)) > 0 && (await opt.isVisible().catch(() => false))) {
        await opt.click({ force: true }).catch(async () => {
          await dispatchSyntheticClick(opt);
        });
        optionClicked = true;
        await tab.waitForTimeout(900);
        break;
      }
    }

    // 3. Nếu Facebook mở modal/dialog soạn bài chia sẻ (có nút Đăng / Post)
    const postModalBtn = tab.locator(
      'div[role="dialog"] div[role="button"][aria-label="Đăng"], ' +
      'div[role="dialog"] div[role="button"][aria-label="Post"], ' +
      'div[role="dialog"] div[role="button"]:has-text("Đăng"), ' +
      'div[role="dialog"] div[role="button"]:has-text("Post")'
    ).first();

    if ((await postModalBtn.count().catch(() => 0)) > 0 && (await postModalBtn.isVisible().catch(() => false))) {
      await postModalBtn.click({ force: true }).catch(async () => {
        await dispatchSyntheticClick(postModalBtn);
      });
      await tab.waitForTimeout(1000);
      optionClicked = true;
    }

    if (optionClicked) {
      console.log(`[FB-Buff]${workerTag} 🚀 Đã chia sẻ bài viết thành công lên tường Fanpage!`);
      return { success: true };
    }

    // Đóng popover nếu không ấn được để tránh kẹt giao diện
    await tab.keyboard.press('Escape').catch(() => { });
    return { success: false, error: 'Không tìm thấy tùy chọn Chia sẻ ngay' };
  } catch (err) {
    console.warn(`[FB-Buff]${workerTag} ⚠️ Lỗi khi thực hiện Chia sẻ: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Thực hiện chuỗi tương tác (đổi danh tính, thả like, viết bình luận, chia sẻ) cho 1 Fanpage trên 1 Tab
 */
async function executePageInteraction({
  tab,
  context,
  pageInfo,
  uid,
  targetUrl,
  normalizedPostUrl,
  enableLike,
  enableComment,
  enableShare = false,
  enableHumanBehavior,
  fastSwitch,
  reactionType,
  comments = [],
  usedCommentsHistory,
  pageIndex = 0,
  workerTag = '',
  speedMode = 'SMART',
  signal = null,
}) {
  if (signal?.aborted) {
    return {
      aborted: true,
      deadReason: 'Tác vụ đã bị dừng bởi AbortSignal / Lease hết hạn',
      item: {
        pageId: pageInfo.id,
        pageName: pageInfo.name,
        status: 'SKIPPED',
        error: 'Tác vụ đã bị hủy bởi AbortSignal',
      },
    };
  }

  // BƯỚC 0: KIỂM TRA ĐĂNG XUẤT / HẾT HẠN COOKIE TRÊN TAB
  const isLoginPageOnTab = await tab.evaluate(() => {
    const hasInputs = Boolean(document.querySelector('input[name="email"], input[name="pass"], #login_form'));
    const modalText = (document.querySelector('div[role="dialog"]')?.innerText || '').toLowerCase();
    const isLoginModal = modalText.includes('đăng nhập') && (modalText.includes('mật khẩu') || modalText.includes('xem thêm trên facebook') || modalText.includes('tạo tài khoản'));
    return hasInputs || isLoginModal;
  }).catch(() => false);

  const curUrl = tab.url();
  if (isLoginPageOnTab || curUrl.includes('/login') || curUrl.includes('/checkpoint')) {
    const isCp = curUrl.includes('/checkpoint');
    console.error(`[FB-Buff]${workerTag} 🚨 PHÁT HIỆN COOKIE HẾT HẠN / ĐÃ ĐĂNG XUẤT (Xuất hiện màn hình đăng nhập Facebook)!`);
    return {
      cookieDead: true,
      isCheckpoint: isCp,
      isExpired: !isCp,
      deadReason: isCp ? 'Tài khoản Facebook bị Checkpoint' : 'Cookie đã hết hạn hoặc phiên đăng nhập đã bị đăng xuất',
      item: {
        pageId: pageInfo.id,
        pageName: pageInfo.name,
        status: 'ERROR',
        error: isCp ? 'Tài khoản bị Checkpoint' : 'Cookie Facebook đã hết hạn. Vui lòng cập nhật Cookie mới.',
      },
    };
  }

  let likeStatus = enableLike ? 'WAITING' : 'SKIPPED';
  let likeError = '';
  let commentStatus = enableComment ? 'WAITING' : 'SKIPPED';
  let commentError = '';
  let shareStatus = enableShare ? 'WAITING' : 'SKIPPED';
  let shareError = '';
  let usedCommentText = '';
  let currentReaction = (reactionType || 'LIKE').toUpperCase();
  let isActionBlocked = false;

  try {
    // BƯỚC 1: CHUYỂN ĐỔI DANH TÍNH
    let fastSwitched = false;
    const curTabUrl = tab.url();
    const isFacebookHome = curTabUrl === 'https://www.facebook.com/' ||
      curTabUrl === 'https://www.facebook.com' ||
      curTabUrl.startsWith('https://www.facebook.com/?') ||
      curTabUrl.includes('facebook.com/home.php');
    const isPostLikeUrl = curTabUrl.includes('/posts/') ||
      curTabUrl.includes('/permalink') ||
      curTabUrl.includes('/share/') ||
      curTabUrl.includes('/reel/') ||
      curTabUrl.includes('/videos/') ||
      curTabUrl.includes('/photos/') ||
      curTabUrl.includes('/photo/') ||
      curTabUrl.includes('story_fbid=') ||
      curTabUrl.includes('fbid=') ||
      (targetUrl && curTabUrl.includes(targetUrl));
    const isOnPost = curTabUrl.includes('facebook.com') &&
      !isFacebookHome &&
      !curTabUrl.includes('/login') &&
      !curTabUrl.includes('/checkpoint') &&
      !curTabUrl.includes('/pages/?category=') &&
      !curTabUrl.includes('/profile.php?') &&
      !curTabUrl.includes('/profile/switch') &&
      isPostLikeUrl;

    if (fastSwitch && isOnPost) {
      // Nếu là Reels / Video, ngăn bình luận thường chứa nút chuyển đổi danh tính tương tác (Voice Switcher)
      const isReelsOrVideo = curTabUrl.includes('/reel/') || curTabUrl.includes('/videos/') || (targetUrl && (targetUrl.includes('/reel/') || targetUrl.includes('/videos/')));
      if (isReelsOrVideo) {
        const commentDrawerOpened = await tab.evaluate(() => {
          return Boolean(document.querySelector('div[role="region"][aria-label*="bình luận" i], div[role="dialog"] div[contenteditable="true"], div[aria-label*="Viết bình luận" i]'));
        }).catch(() => false);

        if (!commentDrawerOpened) {
          const commentToggleBtn = tab.locator(
            'div[role="main"] div[role="button"][aria-label*="Bình luận" i], ' +
            'div[role="main"] div[role="button"][aria-label*="Comment" i], ' +
            'div[role="button"][aria-label*="Xem bình luận" i], ' +
            'div[role="button"][aria-label*="Viết bình luận" i]'
          ).first();
          if ((await commentToggleBtn.count().catch(() => 0)) > 0 && (await commentToggleBtn.isVisible().catch(() => false))) {
            await commentToggleBtn.click({ force: true }).catch(() => { });
            await tab.waitForTimeout(450);
          }
        }
      }

      const voiceBtn = tab.locator(
        'div[role="dialog"]:not([aria-label*="Thông báo"]) div[role="button"][aria-label*="Chuyển sang Trang hoặc trang cá nhân khác"], ' +
        'div[role="dialog"]:not([aria-label*="Thông báo"]) div[role="button"][aria-label*="Bình luận dưới tên"], ' +
        '[aria-label*="Chuyển sang Trang hoặc trang cá nhân khác" i], ' +
        '[aria-label*="trang cá nhân khác" i], ' +
        '[aria-label*="Giọng nói hiện có" i], [aria-label*="chuyển trang cá nhân" i], [aria-label*="Voice switcher" i], ' +
        '[aria-label*="Tương tác với tư cách" i], [aria-label*="Bình chọn giọng nói" i], [aria-label*="Bình luận dưới tên" i], ' +
        '[aria-label*="Bình luận với tư cách" i], [aria-label*="Comment as" i], [aria-label*="Tương tác bằng" i], ' +
        '[aria-label*="Switch to profile" i], [aria-label*="Interact as" i], [aria-label*="Chọn cách tương tác" i], ' +
        '[aria-label*="Choose how to interact" i], div[aria-haspopup="menu"][aria-label*="trang cá nhân" i], ' +
        'div[aria-haspopup="menu"][aria-label*="profile" i]'
      ).first();

      if ((await voiceBtn.count().catch(() => 0)) > 0 && (await voiceBtn.isVisible().catch(() => false))) {
        const currentVoiceAria = (await voiceBtn.getAttribute('aria-label').catch(() => '')) || '';
        if (currentVoiceAria.includes(pageInfo.name)) {
          fastSwitched = true;
        } else {
          await voiceBtn.click({ force: true }).catch(() => { });
          await tab.waitForTimeout(450);

          let pageOpt = tab.locator(
            `[role="dialog"] [aria-label*="${pageInfo.name}"], [role="menu"] [aria-label*="${pageInfo.name}"], div[role="dialog"] div:has-text("${pageInfo.name}"), [role="menu"] div:has-text("${pageInfo.name}")`
          ).last();

          if ((await pageOpt.count().catch(() => 0)) > 0 && (await pageOpt.isVisible().catch(() => false))) {
            await pageOpt.click({ force: true }).catch(() => { });
            // Chờ Facebook hoàn tất vòng xoay chuyển danh tính (đợi "Đang chuyển sang..." biến mất)
            await tab.waitForFunction(() => {
              const text = document.body ? document.body.innerText : '';
              return !text.includes('Đang chuyển sang') && !text.includes('Switching to');
            }, { timeout: 15000 }).catch(() => { });
            await tab.waitForTimeout(650);
            fastSwitched = true;
            console.log(`[FB-Buff]${workerTag} ⚡ [FAST-SWITCH] Đã đổi sang Page "${pageInfo.name}" ngay trên bài viết!`);
          } else {
            // Tìm ô search trong modal chọn Page (tránh nhầm ô tìm kiếm Facebook trên header)
            const searchBox = tab.locator(
              'div[role="dialog"] input[placeholder*="Tìm kiếm trang cá nhân"], ' +
              'div[role="dialog"] input[aria-label*="Tìm kiếm trang cá nhân"], ' +
              'div[role="dialog"] input[placeholder*="Search profiles"], ' +
              'div[role="dialog"] input[aria-label*="Search profiles"], ' +
              'div[role="dialog"] input[type="text"]:not([aria-label*="Facebook"]), ' +
              'div[role="dialog"] input[type="search"]:not([aria-label*="Facebook"]), ' +
              '[role="menu"] input, div[role="dialog"] [role="searchbox"]'
            ).first();

            if ((await searchBox.count().catch(() => 0)) > 0 && (await searchBox.isVisible().catch(() => false))) {
              await searchBox.click({ force: true }).catch(() => { });
              await searchBox.fill(pageInfo.name).catch(() => { });
              await tab.waitForTimeout(800);

              const filteredOpt = tab.locator(
                `[role="dialog"] [aria-label*="${pageInfo.name}"], [role="menu"] [aria-label*="${pageInfo.name}"], div[role="dialog"] div:has-text("${pageInfo.name}")`
              ).last();

              if ((await filteredOpt.count().catch(() => 0)) > 0 && (await filteredOpt.isVisible().catch(() => false))) {
                await filteredOpt.click({ force: true }).catch(() => { });
                await tab.waitForFunction(() => {
                  const text = document.body ? document.body.innerText : '';
                  return !text.includes('Đang chuyển sang') && !text.includes('Switching to');
                }, { timeout: 15000 }).catch(() => { });
                await tab.waitForTimeout(650);
                fastSwitched = true;
                console.log(`[FB-Buff]${workerTag} ⚡ [FAST-SWITCH SEARCH] Đã lọc và đổi sang Page "${pageInfo.name}" trong kho BM!`);
              }
            }

            if (!fastSwitched) {
              await tab.evaluate(() => {
                const scrollable = document.querySelector('div[role="dialog"] [role="list"], div[role="dialog"] div[style*="overflow"]');
                if (scrollable) scrollable.scrollBy(0, 500);
              }).catch(() => { });
              await tab.waitForTimeout(400);

              const retryOpt = tab.locator(
                `[role="dialog"] [aria-label*="${pageInfo.name}"], [role="menu"] [aria-label*="${pageInfo.name}"]`
              ).last();

              if ((await retryOpt.count().catch(() => 0)) > 0 && (await retryOpt.isVisible().catch(() => false))) {
                await retryOpt.click({ force: true }).catch(() => { });
                await tab.waitForFunction(() => {
                  const text = document.body ? document.body.innerText : '';
                  return !text.includes('Đang chuyển sang') && !text.includes('Switching to');
                }, { timeout: 15000 }).catch(() => { });
                await tab.waitForTimeout(650);
                fastSwitched = true;
                console.log(`[FB-Buff]${workerTag} ⚡ [FAST-SWITCH SCROLL] Đã cuộn tìm và đổi sang Page "${pageInfo.name}"!`);
              } else {
                await tab.keyboard.press('Escape').catch(() => { });
              }
            }
          }
        }
      }
    }

    if (fastSwitched) {
      // TỐI ƯU SIÊU TỐC: Nếu đã đổi danh tính trực tiếp trên bài viết và tab vẫn đang ở bài viết mục tiêu,
      // KHÔNG CẦN TẢI LẠI TOÀN TRANG (tiết kiệm 6 - 8 giây cho MỖI lượt Like)!
      const u = tab.url() || '';
      const isStillOnPost = !u.includes('forced_account_switch') &&
        (u.includes('/posts/') || u.includes('/permalink') || u.includes('/share/') || u.includes('/reel/') || u.includes('/videos/') || u.includes('/photo/') || (targetUrl && u.includes(targetUrl)));

      if (!isStillOnPost) {
        console.log(`[FB-Buff]${workerTag} 🌐 Tab bị trôi khỏi bài viết (${u}), đang đưa về bài viết mục tiêu: ${targetUrl}...`);
        await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
        await tab.waitForTimeout(1500);
      } else {
        // Chỉ cần chờ ngắn 450ms để DOM Facebook cập nhật actor mới
        await tab.waitForTimeout(450);
      }
    }

    if (!fastSwitched) {
      const switchOk = await switchTabIdentity(tab, context, pageInfo, uid, workerTag);
      if (!switchOk) {
        throw new Error(`Không thể chuyển sang danh tính Fanpage "${pageInfo.name}" (${pageInfo.id}) trên Facebook`);
      }

      // TỐI ƯU SIÊU TỐC: Nếu sau khi đổi danh tính, tab vẫn đang ở bài viết mục tiêu (chưa bị đổi URL),
      // KHÔNG CẦN TẢI LẠI TOÀN TRANG (tiết kiệm 4 - 6 giây cho MỖI lượt Like)!
      const curU = tab.url() || '';
      const isStillOnPost = !curU.includes('forced_account_switch') &&
        (curU.includes('/posts/') || curU.includes('/permalink') || curU.includes('/share/') || curU.includes('/reel/') || curU.includes('/videos/') || curU.includes('/photo/') || (targetUrl && curU.includes(targetUrl)));

      if (!isStillOnPost) {
        console.log(`[FB-Buff]${workerTag} 🌐 Đang mở bài viết mục tiêu: ${targetUrl}...`);
        await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(async (navErr) => {
          console.warn(`[FB-Buff]${workerTag} ⚠️ Thử lại mở bài viết mục tiêu: ${navErr.message}`);
          await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
        });
        await tab.waitForTimeout(400);
      } else {
        console.log(`[FB-Buff]${workerTag} ⚡ Tab đã ở sẵn bài viết mục tiêu (${curU}), bỏ qua tải lại trang để tăng tốc.`);
        await tab.waitForTimeout(400);
      }

      if (tab.url().includes('forced_account_switch')) {
        await handleForcedAccountSwitch(tab, targetUrl, workerTag, pageInfo);
      }
    }

    // ĐẢM BẢO CHẮC CHẮN TAB ĐANG Ở BÀI VIẾT MỤC TIÊU (CHỐNG BỊ FACEBOOK ĐẨY LẠC VỀ TRANG CHỦ / FEED)
    const checkIsOnPostUrl = () => {
      const u = tab.url() || '';
      const isHome = u === 'https://www.facebook.com/' || u === 'https://www.facebook.com' || u.startsWith('https://www.facebook.com/?') || u.includes('facebook.com/home.php');
      const isForcedSwitch = u.includes('forced_account_switch');
      const isPost = u.includes('/posts/') || u.includes('/permalink') || u.includes('/share/') || u.includes('/reel/') || u.includes('/videos/') || u.includes('/photo/') || u.includes('/groups/') || u.includes('story_fbid=') || u.includes('fbid=') || (targetUrl && u.includes(targetUrl));
      return !isHome && !isForcedSwitch && isPost;
    };

    if (!checkIsOnPostUrl()) {
      if (tab.url().includes('forced_account_switch')) {
        await handleForcedAccountSwitch(tab, targetUrl, workerTag, pageInfo);
      }
      if (!checkIsOnPostUrl()) {
        console.log(`[FB-Buff]${workerTag} 🔄 Tab chưa ở đúng bài viết (${tab.url()}), đang đưa về bài viết mục tiêu: ${targetUrl}...`);
        await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
        await tab.waitForTimeout(400);
      }
    }

    const currentUrl = tab.url();
    if (currentUrl.includes('/checkpoint') || currentUrl.includes('/login')) {
      const isCp = currentUrl.includes('/checkpoint');
      const cpMsg = isCp
        ? 'Bị Facebook yêu cầu xác minh người thật ("Confirm you are human")'
        : 'Cookie hết hạn (Bị chuyển về trang đăng nhập)';
      console.warn(`[FB-Buff]${workerTag} ⚠️ ${cpMsg} cho "${pageInfo.name}" (URL: ${currentUrl})`);
      throw new Error(cpMsg);
    }

    // BƯỚC 2: HÀNH VI LƯỚT XEM TỰ NHIÊN & DWELL TIME (MÔ PHỎNG NGƯỜI THẬT ĐỌC BÀI VIẾT)
    if (enableHumanBehavior) {
      // Cuộn đọc bài tự nhiên (120 - 300px)
      await tab.evaluate(() => {
        const dlg = document.querySelector('div[role="dialog"]');
        if (dlg) dlg.scrollBy({ top: 120 + Math.floor(Math.random() * 180), behavior: 'smooth' });
        else window.scrollBy({ top: 120 + Math.floor(Math.random() * 180), behavior: 'smooth' });
      }).catch(() => { });

      // Thời gian đọc bài (Dwell Time) mô phỏng người thật: Tinh chỉnh tối ưu theo speedMode
      let dwellBase = 350;
      let dwellVar = 200;
      const currentSpeed = speedMode || 'FAST';
      if (currentSpeed === 'TURBO') { dwellBase = 150; dwellVar = 100; }
      else if (currentSpeed === 'FAST') { dwellBase = 250; dwellVar = 150; }
      else if (currentSpeed === 'SAFE') { dwellBase = 800; dwellVar = 400; }
      await tab.waitForTimeout(dwellBase + Math.floor(Math.random() * dwellVar));

      // Thỉnh thoảng cuộn nhẹ ngược lại (tỷ lệ 15%) như người đang ngẫm bài viết
      if (Math.random() < 0.15 && currentSpeed !== 'TURBO') {
        await tab.evaluate(() => {
          const dlg = document.querySelector('div[role="dialog"]');
          if (dlg) dlg.scrollBy({ top: -(25 + Math.floor(Math.random() * 40)), behavior: 'smooth' });
          else window.scrollBy({ top: -(25 + Math.floor(Math.random() * 40)), behavior: 'smooth' });
        }).catch(() => { });
        await tab.waitForTimeout(150 + Math.floor(Math.random() * 150));
      }
    } else {
      // Giữ thời gian dừng tối thiểu an toàn để không bị FB gắn cờ bot click tức thì
      await tab.waitForTimeout(250 + Math.floor(Math.random() * 200));
    }

    // BƯỚC 3: PHÂN BỔ CẢM XÚC THÔNG MINH
    if (currentReaction === 'RANDOM_POSITIVE' || currentReaction === 'RANDOM' || currentReaction === 'RANDOM_MIX' || currentReaction === 'SMART_MIX') {
      const rand = Math.random();
      if (rand < 0.65) currentReaction = 'LIKE';
      else if (rand < 0.90) currentReaction = 'LOVE';
      else currentReaction = 'CARE';
    } else if (currentReaction === 'RANDOM_ALL') {
      const rand = Math.random();
      if (rand < 0.50) currentReaction = 'LIKE';
      else if (rand < 0.75) currentReaction = 'LOVE';
      else if (rand < 0.90) currentReaction = 'CARE';
      else if (rand < 0.95) currentReaction = 'HAHA';
      else currentReaction = 'WOW';
    }

    // BƯỚC 4: THẢ LIKE / REACTION
    if (enableLike) {
      // 0. Đóng các popup quảng cáo / modal làm phiền của Facebook nếu có
      await dismissFacebookOverlays(tab);

      // 1. Đóng cookie banner nếu xuất hiện che màn hình (không đóng dialog bài viết)
      const cookieBanner = tab.locator('div[role="dialog"]:has-text("Cookie"), div[role="dialog"]:has-text("Cookies")').first();
      if (await cookieBanner.isVisible({ timeout: 400 }).catch(() => false)) {
        const acceptCookie = cookieBanner.locator('div[role="button"]:has-text("Chấp nhận"), div[role="button"]:has-text("Accept")').first();
        if (await acceptCookie.isVisible().catch(() => false)) {
          await acceptCookie.click({ force: true }).catch(() => { });
        }
      }

      // Đảm bảo tab chắc chắn ở bài viết trước khi quét nút Like (ngăn chặn drift về trang chủ)
      if (!checkIsOnPostUrl()) {
        if (tab.url().includes('forced_account_switch')) {
          await handleForcedAccountSwitch(tab, targetUrl, workerTag, pageInfo);
        }
        if (!checkIsOnPostUrl()) {
          console.warn(`[FB-Buff]${workerTag} 🔄 Tab bị trôi khỏi bài viết (${tab.url()}), đang phục hồi về: ${targetUrl}...`);
          await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
          await tab.waitForTimeout(400);
        }
      }

      let likeBtn = await findLikeButtonOnTab(tab);
      if (!likeBtn) {
        if (tab.url().includes('forced_account_switch')) {
          await handleForcedAccountSwitch(tab, targetUrl, workerTag, pageInfo);
          likeBtn = await findLikeButtonOnTab(tab);
        }

        const waitDeadline = Date.now() + 3500;
        let scrollStep = 1;
        while (!likeBtn && Date.now() < waitDeadline) {
          await tab.evaluate((step) => {
            const dlg = document.querySelector('div[role="dialog"]');
            if (dlg) dlg.scrollBy({ top: 300, behavior: 'smooth' });
            else window.scrollBy({ top: 300, behavior: 'smooth' });
          }, scrollStep).catch(() => { });
          scrollStep++;

          await tab.waitForTimeout(600);
          likeBtn = await findLikeButtonOnTab(tab);
        }
      }

      if (likeBtn) {
        // KIỂM TRA CHẮC CHẮN DANH TÍNH TRƯỚC KHI LIKE (Chống like nhầm bằng nick Mẹ)
        const currentActor = await getCurrentActor(tab);
        if (currentActor && pageInfo.id && pageInfo.id !== uid && !pageInfo.isProfile) {
          const isMatched = currentActor.id === String(pageInfo.id) ||
            (pageInfo.name && currentActor.name && currentActor.name.toLowerCase() === pageInfo.name.toLowerCase());
          if (!isMatched) {
            console.warn(`[FB-Buff]${workerTag} ⚠️ Danh tính chưa khớp! Kỳ vọng "${pageInfo.name}" (${pageInfo.id}) nhưng hiện tại là "${currentActor.name}" (${currentActor.id}). TỪ CHỐI LIKE để bảo vệ Via.`);
            throw new Error(`Chưa chuyển được danh tính sang Page "${pageInfo.name}" (Hiện tại: ${currentActor.name})`);
          }
        }

        const currentAria = (await likeBtn.getAttribute('aria-label')) || '';
        const beforeText = (await likeBtn.innerText().catch(() => '')) || '';
        const likeHandle = typeof likeBtn.elementHandle === 'function' ? await likeBtn.elementHandle().catch(() => null) : likeBtn;

        if (
          currentAria.includes('Gỡ') ||
          currentAria.includes('Remove') ||
          currentAria.includes('Đã thích') ||
          currentAria.includes('Liked')
        ) {
          console.log(`[FB-Buff]${workerTag} ℹ️ Page "${pageInfo.name}" đã Like trước đó (Trạng thái: ${currentAria}).`);
          likeStatus = 'ALREADY_LIKED';
        } else {
          if (currentReaction === 'LIKE') {
            await dispatchSyntheticClick(likeBtn);
            const verifyTimeout = speedMode === 'TURBO' ? 700 : speedMode === 'FAST' ? 1200 : 2000;
            const verified = await verifyReacted(likeHandle, currentAria, () => findLikeButtonOnTab(tab), verifyTimeout, beforeText);
            likeStatus = verified ? 'SUCCESS' : 'UNVERIFIED';
            console.log(`[FB-Buff]${workerTag} ${verified ? '✅' : '❔'} Page "${pageInfo.name}" thả LIKE ${verified ? 'đã xác nhận' : 'chưa xác nhận được trạng thái nút'}.`);
          } else {
            const reactionMap = {
              LOVE: ['Yêu thích', 'Love'],
              CARE: ['Thương thương', 'Care'],
              HAHA: ['Haha'],
              WOW: ['Wow'],
              SAD: ['Buồn', 'Sad'],
              ANGRY: ['Phẫn nộ', 'Angry'],
            };
            const targetKeywords = reactionMap[currentReaction] || ['Thích', 'Like'];

            await likeBtn.scrollIntoViewIfNeeded().catch(() => { });
            await likeBtn.hover({ timeout: 1200 }).catch(async () => {
              const box = await likeBtn.boundingBox().catch(() => null);
              if (box) await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 }).catch(() => { });
            });

            const exactSel = targetKeywords.map((kw) => `[aria-label="${kw}"][role="button"]`).join(', ');
            const popupSel = targetKeywords
              .map((kw) => `[role="dialog"] [aria-label="${kw}"], [role="toolbar"] [aria-label="${kw}"], [aria-label="Cảm xúc"] [aria-label="${kw}"], [aria-label="Reactions"] [aria-label="${kw}"]`)
              .join(', ');
            let rBtn = null;
            const deadline = Date.now() + 1400;
            while (!rBtn && Date.now() < deadline) {
              for (const sel of [popupSel, exactSel]) {
                const loc = tab.locator(sel);
                const n = await loc.count().catch(() => 0);
                for (let k = n - 1; k >= 0 && !rBtn; k--) {
                  if (await loc.nth(k).isVisible().catch(() => false)) rBtn = loc.nth(k);
                }
                if (rBtn) break;
              }
              if (!rBtn) await tab.waitForTimeout(150);
            }

            if (rBtn) {
              await rBtn.hover({ timeout: 800 }).catch(() => { });
              await rBtn.click({ timeout: 1500 }).catch(() => dispatchSyntheticClick(rBtn));
            } else {
              console.log(`[FB-Buff]${workerTag} ℹ️ Không mở được thanh cảm xúc cho Page "${pageInfo.name}", chuyển sang thả LIKE.`);
              currentReaction = 'LIKE';
              await dispatchSyntheticClick(likeBtn);
            }
            const verifyTimeout = speedMode === 'TURBO' ? 700 : speedMode === 'FAST' ? 1200 : 2000;
            const verified = await verifyReacted(likeHandle, currentAria, () => findLikeButtonOnTab(tab), verifyTimeout, beforeText);
            likeStatus = verified ? 'SUCCESS' : 'UNVERIFIED';
            console.log(`[FB-Buff]${workerTag} ${verified ? '✅' : '❔'} Page "${pageInfo.name}" thả ${currentReaction} ${verified ? 'đã xác nhận' : 'chưa xác nhận được trạng thái nút'}.`);
          }

          if (await checkActionBlockedOnTab(tab)) {
            console.warn(`[FB-Buff]${workerTag} ⚠️ Facebook cảnh báo chặn hành động sau khi like bằng Page "${pageInfo.name}".`);
            likeStatus = 'ERROR';
            likeError = 'Facebook tạm thời hạn chế hành động (Action Blocked)';
            isActionBlocked = true;
          }
        }
      } else {
        const isBlockedOnMissing = await checkActionBlockedOnTab(tab);
        if (isBlockedOnMissing) {
          isActionBlocked = true;
          likeStatus = 'ERROR';
          likeError = 'Facebook tạm thời hạn chế do thao tác nhanh (Action Blocked) - Tự động dừng bảo vệ Via';
          console.warn(`[FB-Buff]${workerTag} 🛑 PHÁT HIỆN FACEBOOK CHẶN HÀNH ĐỘNG (Rate Limit): "Bạn tạm thời bị chặn do sử dụng quá nhanh" trên Page "${pageInfo.name}"!`);
        } else {
          const currentUrl = tab.url();
          const isUnavailable = await checkFacebookContentUnavailable(tab);
          if (isUnavailable) {
            console.warn(`[FB-Buff]${workerTag} ⚠️ Phát hiện bài viết Facebook không khả dụng cho "${pageInfo.name}" (${isUnavailable})`);
            likeStatus = 'ERROR';
            likeError = 'Bài viết không tồn tại hoặc đã bị chủ bài viết xóa, ẩn, giới hạn quyền xem (Trang này hiện không hiển thị)';
          } else {
            console.warn(`[FB-Buff]${workerTag} ⚠️ Không tìm thấy nút Like cho "${pageInfo.name}" (URL: ${currentUrl})`);

            // Lưu ảnh màn hình debug
            try {
              const debugDir = path.join(__dirname, 'data', 'debug_screens');
              if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
              const imgPath = path.join(debugDir, `no_like_${pageInfo.id}.png`);
              await tab.screenshot({ path: imgPath, fullPage: false }).catch(() => { });
            } catch (e) { }

            const isGroup = currentUrl.includes('/groups/');
            const joinGroupBtn = tab.locator('div[role="button"]:has-text("Tham gia nhóm"), div[role="button"]:has-text("Join group")').first();
            const needsJoin = (await joinGroupBtn.count().catch(() => 0)) > 0;

            const isHome = currentUrl === 'https://www.facebook.com/' || currentUrl.startsWith('https://www.facebook.com/?') || currentUrl.includes('facebook.com/home.php');
            const isForcedSwitch = currentUrl.includes('forced_account_switch');

            likeStatus = 'NO_BUTTON';
            likeError = needsJoin
              ? 'Nhóm Facebook yêu cầu tham gia (Chưa vào nhóm nên ẩn nút Like)'
              : isForcedSwitch
                ? 'Facebook tạm giữ ở trang Chuyển tài khoản (forced_account_switch)'
                : isHome
                  ? 'Tab bị trôi về Trang chủ Facebook (Chuyển Page quá nhanh)'
                  : isGroup
                    ? 'Bài viết trong Nhóm kín hoặc chưa tải kịp nút Like'
                    : 'Không tìm thấy nút Like trên bài viết';
          }
        }
      }
    }

    // BƯỚC 5: VIẾT BÌNH LUẬN (NẾU BẬT)
    if (enableComment) {
      let rawComment = pageInfo.comment || (Array.isArray(comments) && comments.length > 0 ? comments[pageIndex % comments.length] : '');
      usedCommentText = resolveSpintax(rawComment ? rawComment.trim() : '');

      if (!usedCommentText.trim()) {
        commentStatus = 'SKIPPED';
        commentError = 'Không có nội dung bình luận';
      } else {
        const normalized = usedCommentText.toLowerCase().replace(/[.,!?:;\s]+/g, '');
        if (usedCommentsHistory && usedCommentsHistory.has(normalized)) {
          const variation = NATURAL_VI_VARIATIONS[Math.floor(Math.random() * NATURAL_VI_VARIATIONS.length)];
          usedCommentText = `${usedCommentText}${variation}`;
        }
        if (usedCommentsHistory) {
          usedCommentsHistory.add(usedCommentText.toLowerCase().replace(/[.,!?:;\s]+/g, ''));
        }

        const botFilterRegex = /\b(test|tự động|bot|tool|toolzutter|auto|buff|hack|spam)\b/gi;
        if (botFilterRegex.test(usedCommentText)) {
          console.warn(`[FB-Buff]${workerTag} ⚠️ PHÁT HIỆN TỪ KHÓA DỄ BỊ BẮT SPAM: "${usedCommentText}". Tự động chuyển hóa thành seeding tự nhiên.`);
          usedCommentText = usedCommentText
            .replace(/test\s*hệ\s*thống\s*comment\s*tự\s*động\s*từ\s*toolzutter!?\s*🚀?/gi, 'Bài viết rất hay và hữu ích ạ! ❤️')
            .replace(botFilterRegex, 'chia sẻ');
        }

        const commentSelectors = [
          'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
          'div[role="article"] div[role="textbox"][contenteditable="true"]',
          'div[role="textbox"][contenteditable="true"]',
        ];

        let commentBox = null;
        for (const sel of commentSelectors) {
          const loc = tab.locator(sel).first();
          if ((await loc.count().catch(() => 0)) > 0) {
            commentBox = loc;
            break;
          }
        }

        if (!commentBox) {
          const writeBtn = tab.locator('[aria-label="Viết bình luận"], [aria-label="Write a comment"]').first();
          if ((await writeBtn.count().catch(() => 0)) > 0) {
            await writeBtn.click({ force: true }).catch(() => { });
            await tab.waitForTimeout(400);
            for (const sel of commentSelectors) {
              const loc = tab.locator(sel).first();
              if ((await loc.count().catch(() => 0)) > 0) {
                commentBox = loc;
                break;
              }
            }
          }
        }

        if (commentBox) {
          await tab.evaluate(() => {
            window.scrollBy({ top: 80 + Math.floor(Math.random() * 100), behavior: 'smooth' });
          }).catch(() => { });
          await tab.waitForTimeout(200);

          await commentBox.evaluate((el) => {
            el.focus();
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }).catch(() => { });
          await tab.waitForTimeout(200);
          await commentBox.click().catch(() => { });
          await tab.waitForTimeout(250);

          for (const char of usedCommentText) {
            await tab.keyboard.type(char, { delay: Math.floor(Math.random() * 45) + 40 });
            if (char === ' ' && Math.random() < 0.35) {
              await tab.waitForTimeout(Math.floor(Math.random() * 250) + 120);
            }
          }

          // Nhịp dừng đọc lại comment trước khi bấm gửi (người thật)
          await tab.waitForTimeout(900 + Math.floor(Math.random() * 600));
          await tab.keyboard.press('Enter');
          await tab.waitForTimeout(1600 + Math.floor(Math.random() * 800));
          commentStatus = 'SUCCESS';
          console.log(`[FB-Buff]${workerTag} 💬 Page "${pageInfo.name}" đã bình luận tự nhiên: "${usedCommentText}"`);
        } else {
          commentStatus = 'FAILED';
          commentError = 'Không tìm thấy ô nhập bình luận';
          console.warn(`[FB-Buff]${workerTag} ⚠️ Không tìm thấy ô bình luận cho Page "${pageInfo.name}"`);
        }
      }
    }

    // BƯỚC 5.5: CHIA SẺ BÀI VIẾT LÊN TƯỜNG FANPAGE (NẾU BẬT)
    if (enableShare) {
      const shareResult = await executePostShare(tab, workerTag);
      if (shareResult.success) {
        shareStatus = 'SUCCESS';
      } else {
        shareStatus = 'FAILED';
        shareError = shareResult.error || 'Không chia sẻ được';
      }
    }

    // BƯỚC 6: TỔNG HỢP KẾT QUẢ CHO PAGE NÀY
    const likeOk = !enableLike || likeStatus === 'SUCCESS';
    const cmtOk = !enableComment || commentStatus === 'SUCCESS';
    const shareOk = !enableShare || shareStatus === 'SUCCESS';
    const isAlready = enableLike && !enableComment && !enableShare && likeStatus === 'ALREADY_LIKED';

    let finalStatus = 'SUCCESS';
    const msgs = [];
    if (enableLike) {
      if (likeStatus === 'SUCCESS') msgs.push(`Đã like (${currentReaction})`);
      else if (likeStatus === 'ALREADY_LIKED') msgs.push('Đã like trước đó');
      else msgs.push(`Lỗi like: ${likeError || 'Không thể like'}`);
    }
    if (enableComment) {
      if (commentStatus === 'SUCCESS') msgs.push(`Đã cmt: "${usedCommentText}"`);
      else if (commentStatus === 'SKIPPED') msgs.push('Bỏ qua cmt');
      else msgs.push(`Lỗi cmt: ${commentError || 'Không gửi được'}`);
    }
    if (enableShare) {
      if (shareStatus === 'SUCCESS') msgs.push('Đã chia sẻ lên tường Fanpage');
      else if (shareStatus === 'SKIPPED') msgs.push('Bỏ qua share');
      else msgs.push(`Lỗi share: ${shareError || 'Không chia sẻ được'}`);
    }
    if (enableLike && likeStatus === 'UNVERIFIED') {
      msgs[0] = `Đã bấm ${currentReaction} nhưng chưa xác nhận được`;
    }

    if (isAlready) finalStatus = 'ALREADY_LIKED';
    else if (likeStatus === 'UNVERIFIED' && !(enableComment && commentStatus === 'SUCCESS') && !(enableShare && shareStatus === 'SUCCESS')) finalStatus = 'UNVERIFIED';
    else if (likeOk && cmtOk && shareOk) finalStatus = 'SUCCESS';
    else if ((enableLike && likeStatus === 'SUCCESS') || (enableComment && commentStatus === 'SUCCESS') || (enableShare && shareStatus === 'SUCCESS')) finalStatus = 'SUCCESS';
    else finalStatus = 'ERROR';

    if (finalStatus === 'SUCCESS' || finalStatus === 'ALREADY_LIKED' || finalStatus === 'UNVERIFIED') {
      recordPageAction(pageInfo.id);
      recordPagePostInteraction(normalizedPostUrl, pageInfo.id, {
        reactionType: currentReaction,
        commentText: usedCommentText,
        shareStatus,
        status: finalStatus,
        pageName: pageInfo.name,
      });
    }

    return {
      actionBlocked: isActionBlocked,
      item: {
        pageId: pageInfo.id,
        pageName: pageInfo.name,
        status: isActionBlocked ? 'ERROR' : finalStatus,
        likeStatus,
        commentStatus,
        shareStatus,
        commentText: commentStatus === 'SUCCESS' ? usedCommentText : undefined,
        message: msgs.join(' • '),
        error: (finalStatus === 'ERROR' || isActionBlocked) ? msgs.join(' • ') : undefined,
      },
    };
  } catch (err) {
    console.error(`[FB-Buff]${workerTag} ❌ Lỗi khi Page "${pageInfo.name}" tương tác: ${err.message}`);
    const isBrowserDead = Boolean(
      err.isBrowserDead ||
      (err.message && (
        err.message.includes('closed') ||
        err.message.includes('Target page') ||
        err.message.includes('Connection closed') ||
        err.message.includes('Target closed')
      ))
    );
    const isBlockedOnCatch = isBrowserDead ? false : await checkActionBlockedOnTab(tab).catch(() => false);
    const isCp = Boolean(err.message?.includes('checkpoint') || err.message?.includes('xác minh người thật'));
    const isExp = Boolean(err.message?.includes('Cookie hết hạn') || err.message?.includes('đăng nhập') || err.message?.includes('/login'));
    const cookieDead = isCp || isExp;
    return {
      actionBlocked: isBlockedOnCatch,
      browserDead: isBrowserDead,
      cookieDead,
      isCheckpoint: isCp,
      isExpired: isExp,
      deadReason: err.message,
      item: {
        pageId: pageInfo.id,
        pageName: pageInfo.name,
        status: 'ERROR',
        likeStatus: enableLike ? 'ERROR' : 'SKIPPED',
        commentStatus: enableComment ? 'ERROR' : 'SKIPPED',
        shareStatus: enableShare ? 'ERROR' : 'SKIPPED',
        error: isBrowserDead
          ? 'Trình duyệt Chromium đã bị đóng hoặc mất kết nối.'
          : isBlockedOnCatch
            ? 'Facebook tạm thời hạn chế hành động (Action Blocked) do thao tác nhanh. Tự động dừng bảo vệ Via.'
            : err.message,
      },
    };
  }
}

/**
 * Thực hiện buff Like/Reaction và Comment bài viết bằng các Fanpage
 * Hỗ trợ Đa luồng (Multi-Worker Concurrency 1 - 3 luồng song song) & Định tuyến Proxy Pool
 * @param {string} cookieStr - Cookie nick mẹ
 * @param {string} targetUrl - Link bài viết / Reels / Video cần buff
 * @param {object} options - Cấu hình: { reactionType, selectedPages, delayMs, enableLike, enableComment, comments, concurrency, proxyPool, proxyUrl, dripFeedMode, dripDurationMinutes }
 */
async function buffLikesWithPages(cookieStr, targetUrl, options = {}) {
  const {
    reactionType = 'RANDOM_POSITIVE', // Mặc định RANDOM_POSITIVE (65% Like, 25% Love, 10% Care) để tương tác tự nhiên, chống Meta AI phát hiện bot
    selectedPages = [],    // Mảng các page { id, name, comment? } hoặc để trống để tự quét
    delayMs = 2800,        // Độ trễ cơ sở giữa mỗi lần tương tác (được Safe Human Pacing tự động tối ưu)
    speedMode = 'FAST',    // Mặc định FAST (~2.8s - 3.2s) để chạy nhanh, mượt và an toàn
    enableLike = true,     // Có thả Like/Reaction không (mặc định true)
    enableComment = false, // Có viết bình luận bằng Fanpage không (mặc định false)
    enableShare = false,   // Có chia sẻ bài viết lên tường Fanpage không (mặc định false)
    enableHumanBehavior = true, // Hành vi lướt tự nhiên chống checkpoint (mặc định true)
    fastSwitch = true,     // Ưu tiên đổi danh tính trực tiếp trên bài viết bằng Voice Switcher (tiết kiệm 15s/lần)
    cooldownEvery = 25,    // Cứ mỗi 25 page nghỉ hạ nhiệt an toàn chống rate limit
    cooldownDurationMs = 20000, // Thời gian nghỉ hạ nhiệt (20 giây) mỗi lô để Facebook reset bộ đếm tần suất
    comments = [],         // Mảng danh sách nội dung bình luận
    proxyUrl = '',         // URL Proxy riêng biệt cho Via (http://user:pass@host:port)
    proxyPool = [],        // Danh sách Proxy Pool định tuyến cho từng luồng Worker
    maxActionsPerPageToday = getDailyPageActionLimit(), // Giới hạn lượt tương tác/ngày cho mỗi Page (Cài đặt hệ thống)
    concurrency = 1,       // Số luồng worker song song (khuyên dùng 1 luồng / Via để chống checkpoint)
    dripFeedMode = false,  // Chế độ rải đều lượt like theo thời gian chống thuật toán quét
    dripDurationMinutes = 30, // Thời gian rải đều (phút)
    kpiTarget = 0,         // Mục tiêu KPI Like thành công cần đạt (0 = chạy hết toàn bộ selectedPages)
    targetLikes = 0,       // Alias cho kpiTarget
    onProgress,            // Callback nhận tiến trình: onProgress(event)
    shouldStop,            // () => boolean: người gọi yêu cầu dừng (client ngắt kết nối, dừng khẩn cấp...)
    signal = options.signal || (options.fence?.signal) || null, // AbortSignal hỗ trợ deep cancellation
  } = options;
  const isStopRequested = () => isEmergencyStopped() || Boolean(signal?.aborted) || (typeof shouldStop === 'function' && shouldStop());

  if (isEmergencyStopped()) {
    throw new Error('Hệ thống đang ở trạng thái DỪNG KHẨN CẤP (Emergency Stop). Tác vụ đã bị từ chối thực thi.');
  }

  const normalizedPostUrl = normalizeFbPostUrl(targetUrl);

  let pages = selectedPages;
  if (!pages || pages.length === 0) {
    console.log('[FB-Buff] 🔄 Chưa truyền danh sách page, tự động quét Fanpage từ Cookie...');
    pages = await getManagedPages(cookieStr, { proxyUrl });
  }

  if (pages.length === 0) {
    throw new Error('Không tìm thấy Fanpage nào trong tài khoản để thực hiện');
  }

  // BẢO VỆ CHỐNG TRÙNG LẶP & CHỐNG HỦY LIKE (UN-LIKE)
  const originalPagesCount = pages.length;
  pages = filterAvailablePagesForPost(normalizedPostUrl, pages);
  if (pages.length === 0) {
    console.log(`[FB-Buff] ℹ️ Toàn bộ ${originalPagesCount} Fanpage đã tương tác với bài viết "${normalizedPostUrl}" trước đó. Không còn page nào mới để buff.`);
    return {
      total: originalPagesCount,
      success: 0,
      failed: 0,
      allAlreadyInteracted: true,
      message: 'Toàn bộ Fanpage đã tương tác với bài viết này trước đó (đã tự động bỏ qua để chống hủy like)',
      details: [],
    };
  }

  // GIỚI HẠN LƯỢT/NGÀY: bỏ qua Page đã đủ lượt hôm nay, ưu tiên Page hoạt động ít nhất
  const usageToday = loadPageUsage()[usageDateKey()] || {};
  const usedToday = (id) => usageToday[id] || 0;
  const cappedDetails = [];
  pages = pages.filter((p) => {
    const used = usedToday(p.id);
    if (used < maxActionsPerPageToday) return true;
    cappedDetails.push({
      pageId: p.id,
      pageName: p.name,
      status: 'SKIPPED',
      likeStatus: 'SKIPPED',
      commentStatus: 'SKIPPED',
      shareStatus: 'SKIPPED',
      message: `Đã đủ ${maxActionsPerPageToday} lượt hôm nay`,
    });
    return false;
  });
  if (cappedDetails.length > 0) {
    console.log(`[FB-Buff] 🛡️ Bỏ qua ${cappedDetails.length} Page đã đạt giới hạn ${maxActionsPerPageToday} lượt/ngày.`);
    if (typeof onProgress === 'function') {
      cappedDetails.forEach((item, idx) => onProgress({ type: 'PAGE_FINISH', index: idx, total: cappedDetails.length, percent: 0, ...item }));
    }
  }
  if (pages.length === 0) {
    return {
      total: cappedDetails.length,
      success: 0,
      failed: 0,
      skipped: cappedDetails.length,
      allCapped: true,
      message: `Toàn bộ Page đã đạt giới hạn ${maxActionsPerPageToday} lượt hôm nay`,
      details: cappedDetails,
    };
  }
  pages.sort((a, b) => usedToday(a.id) - usedToday(b.id));

  // TÍNH TOÁN CẤU HÌNH ĐA LUỒNG (MULTI-WORKER CONCURRENCY) & TỐI ƯU TỐC ĐỘ:
  const targetConcurrency = Math.max(1, Math.min(4, parseInt(concurrency, 10) || 1));
  let safeConcurrency = targetConcurrency;
  if (targetConcurrency > 1 && (!Array.isArray(proxyPool) || proxyPool.length <= 1)) {
    // Tự động phân bổ luồng an toàn: TURBO cho phép 3 luồng, FAST cho phép 2 luồng song song (tăng tốc 2x - 3x)
    const maxSafe = speedMode === 'TURBO' ? 3 : (speedMode === 'FAST' ? 2 : (targetConcurrency >= 2 ? 2 : 1));
    safeConcurrency = Math.min(targetConcurrency, maxSafe);
    if (safeConcurrency < targetConcurrency) {
      console.log(`[FB-Buff] ⚡ Tối ưu điều chỉnh luồng song song về ${safeConcurrency} luồng để vừa tăng tốc vừa an toàn.`);
    }
  }
  const isMultiWorker = safeConcurrency > 1 && pages.length >= safeConcurrency;
  const actualConcurrency = safeConcurrency;
  const effectiveKpi = parseInt(kpiTarget || targetLikes, 10) || 0;

  console.log(`[FB-Buff] 🚀 Bắt đầu Buff Tương Tác: ${targetUrl}`);
  console.log(`[FB-Buff] 🎯 Mục tiêu: ${effectiveKpi > 0 ? `KPI ${effectiveKpi} Like thành công (kho dự phòng: ${pages.length} Pages)` : `${pages.length} Fanpage`} | Chế độ tốc độ: ${speedMode} (${delayMs}ms) | Thả Like: ${enableLike ? reactionType : 'TẮT'} | Bình luận: ${enableComment ? 'BẬT' : 'TẮT'} | Chia sẻ (Share): ${enableShare ? 'BẬT' : 'TẮT'} | Số luồng: ${actualConcurrency} luồng | Fast-Switch: ${fastSwitch ? 'BẬT' : 'TẮT'}`);

  const results = {
    total: effectiveKpi > 0 ? effectiveKpi : (pages.length + cappedDetails.length),
    candidateCount: pages.length + cappedDetails.length,
    success: 0,
    failed: 0,
    unverified: 0,
    skipped: cappedDetails.length,
    stopped: false,
    kpiReached: false,
    kpiTarget: effectiveKpi > 0 ? effectiveKpi : undefined,
    autoRefilled: 0,
    concurrency: actualConcurrency,
    details: [...cappedDetails],
  };

  const currentCookie = cookieStr || '';
  const cookies = parseCookieString(currentCookie);
  const cUserMatch = currentCookie.match(/(?:^|;\s*)c_user=([^;]+)/);
  const uid = cUserMatch ? cUserMatch[1] : '';
  const device = getDeviceForUid(uid);
  const baseProxy = parseProxy(proxyUrl);
  console.log(`[FB-Buff] 📱 Giả lập phần cứng độc lập (${device.name}) cho UID: ${uid || 'N/A'}${baseProxy ? ` qua Proxy ${baseProxy.server}` : ''}`);

  const usedCommentsHistory = new Set();
  let completedCount = cappedDetails.length;
  let globalStopTriggered = false;

  // QUẢN LÝ DEEP CANCELLATION: Đóng ngay toàn bộ tab/context khi AbortSignal kích hoạt
  const trackedContexts = new Set();
  const trackedTabs = new Set();
  const abortCleanup = () => {
    console.warn(`[FB-Buff] 🛑 AbortSignal kích hoạt (Lease hết hạn hoặc User Abort)! Đóng ngay lập tức các Tab/Context Playwright...`);
    results.stopped = true;
    globalStopTriggered = true;
    for (const t of trackedTabs) {
      try { t.close().catch(() => {}); } catch (_) {}
    }
    for (const c of trackedContexts) {
      try { c.close().catch(() => {}); } catch (_) {}
    }
  };
  if (signal) {
    if (signal.aborted) abortCleanup();
    else signal.addEventListener('abort', abortCleanup, { once: true });
  }

  if (isMultiWorker) {
    // ========================================================
    // CHẾ ĐỘ 1: BUFF ĐA LUỒNG SONG SONG (MULTI-WORKER CONCURRENCY)
    // ========================================================
    console.log(`[FB-Buff] ⚡ KÍCH HOẠT ĐA LUỒNG: Chia ${pages.length} Pages cho ${actualConcurrency} Browser Contexts độc lập`);
    const browser = await chromium.launch({
      headless: true,
      args: [
        ...OPTIMIZED_CHROMIUM_ARGS,
        '--disable-webrtc',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--enforce-webrtc-ip-permission-check',
      ],
    });

    const chunkSize = Math.ceil(pages.length / actualConcurrency);
    const chunks = [];
    for (let c = 0; c < actualConcurrency; c++) {
      const start = c * chunkSize;
      const end = Math.min(start + chunkSize, pages.length);
      const chunkPages = pages.slice(start, end).map((p, idx) => ({ page: p, originalIndex: start + idx }));
      if (chunkPages.length > 0) {
        chunks.push({ workerId: c + 1, pages: chunkPages });
      }
    }

    const runWorker = async ({ workerId, pages: workerPages }) => {
      let workerProxyStr = '';
      if (Array.isArray(proxyPool) && proxyPool.length > 0) {
        workerProxyStr = proxyPool[(workerId - 1) % proxyPool.length] || '';
      } else if (proxyUrl) {
        workerProxyStr = proxyUrl;
      }
      const workerProxy = parseProxy(workerProxyStr);
      const workerTag = ` [Worker ${workerId}${workerProxy ? ' • ' + workerProxy.server.replace(/^https?:\/\//, '') : ''}]`;
      console.log(`[FB-Buff]${workerTag} 🚀 Bắt đầu xử lý ${workerPages.length} Pages...`);

      let workerContext = null;
      try {
        workerContext = await browser.newContext({
          userAgent: device.userAgent,
          viewport: device.viewport,
          deviceScaleFactor: device.deviceScaleFactor,
          isMobile: device.isMobile,
          hasTouch: device.hasTouch,
          locale: 'vi-VN',
          timezoneId: 'Asia/Ho_Chi_Minh',
          proxy: workerProxy ? { server: workerProxy.server, username: workerProxy.username, password: workerProxy.password } : undefined,
        });
      } catch (proxyErr) {
        console.warn(`[FB-Buff]${workerTag} ⚠️ Lỗi Proxy (${workerProxyStr}): ${proxyErr.message}. Fallback sang Direct.`);
        workerContext = await browser.newContext({
          userAgent: device.userAgent,
          viewport: device.viewport,
          deviceScaleFactor: device.deviceScaleFactor,
          isMobile: device.isMobile,
          hasTouch: device.hasTouch,
          locale: 'vi-VN',
          timezoneId: 'Asia/Ho_Chi_Minh',
        });
      }

      if (workerContext) trackedContexts.add(workerContext);

      try {
        await applyFingerprintToContext(workerContext, device);
        await applyResourceOptimization(workerContext, false, true);
        if (cookies.length > 0) {
          await workerContext.addCookies(cookies);
        }
        let workerTab = await workerContext.newPage();
        trackedTabs.add(workerTab);
        await workerTab.route('**/*.{png,jpg,jpeg,webp,gif,avif,ico,mp4,mov,m4v,avi,webm,m3u8,ts,woff,woff2,ttf,otf}', (route) => route.abort());
        await workerTab.route('**/*{google-analytics,doubleclick,connect.facebook.net/signals,pixel.facebook.com,facebook.com/tr/}*', (route) => route.abort());

        // Giãn cách mở bài viết ban đầu giữa các worker để tránh nghẽn phiên
        await new Promise((r) => setTimeout(r, (workerId - 1) * 2000));
        let workerTargetUrl = targetUrl;
        try {
          await workerTab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await workerTab.waitForTimeout(1000);
          const redirected = workerTab.url();
          if (redirected && redirected.includes('facebook.com') && !redirected.includes('/share/')) {
            workerTargetUrl = redirected;
          }
        } catch (e) {
          console.warn(`[FB-Buff]${workerTag} ⚠️ Lỗi tải bài viết ban đầu: ${e.message}`);
        }

        const isUnavailable = await checkFacebookContentUnavailable(workerTab);
        if (isUnavailable) {
          console.warn(`[FB-Buff]${workerTag} 🛑 Bài viết không khả dụng (bị ẩn/xóa/giới hạn riêng tư): ${isUnavailable}`);
          globalStopTriggered = true;
          results.stopped = true;
          results.error = 'Bài viết không tồn tại hoặc đã bị người đăng xóa, ẩn, giới hạn riêng tư trên Facebook.';
          return;
        }

        for (let i = 0; i < workerPages.length; i++) {
          if (isStopRequested() || globalStopTriggered) {
            results.stopped = true;
            console.warn(`[FB-Buff]${workerTag} 🛑 Dừng luồng tại page ${i + 1}/${workerPages.length}`);
            break;
          }

          try {
            workerTab = await ensureTabHealthy(workerContext, workerTab);
          } catch (tErr) {
            if (tErr.isBrowserDead || (tErr.message && tErr.message.includes('closed'))) {
              globalStopTriggered = true;
              results.stopped = true;
              console.error(`[FB-Buff]${workerTag} 🛑 Trình duyệt đã bị đóng. Dừng ngay luồng worker.`);
              break;
            }
          }

          const { page: pageInfo, originalIndex } = workerPages[i];
          console.log(`[FB-Buff]${workerTag} [${i + 1}/${workerPages.length}] ⚡ Đang tương tác bằng Page: "${pageInfo.name}" (ID: ${pageInfo.id})...`);

          if (typeof onProgress === 'function') {
            onProgress({
              type: 'PAGE_START',
              index: originalIndex,
              total: pages.length,
              pageId: pageInfo.id,
              pageName: pageInfo.name,
              percent: Math.round((completedCount / pages.length) * 100),
              workerId,
            });
          }

          const { actionBlocked, browserDead, cookieDead, isCheckpoint, isExpired, deadReason, item: resultItem } = await executePageInteraction({
            tab: workerTab,
            context: workerContext,
            pageInfo,
            uid,
            targetUrl: workerTargetUrl,
            normalizedPostUrl,
            enableLike,
            enableComment,
            enableShare,
            enableHumanBehavior,
            fastSwitch,
            reactionType,
            comments,
            usedCommentsHistory,
            pageIndex: originalIndex,
            workerTag,
            speedMode,
            signal,
          });

          if (browserDead) {
            globalStopTriggered = true;
            results.stopped = true;
            results.failed++;
            results.details.push(resultItem);
            console.error(`[FB-Buff]${workerTag} 🛑 Trình duyệt Chromium đã bị đóng hoặc mất kết nối! Dừng luồng ngay lập tức.`);
            break;
          }

          if (cookieDead) {
            globalStopTriggered = true;
            results.stopped = true;
            results.cookieDead = true;
            results.deadViaUid = uid;
            results.isCheckpoint = isCheckpoint;
            results.isExpired = isExpired;
            results.deadReason = deadReason;
            results.failed++;
            results.details.push(resultItem);
            console.error(`[FB-Buff]${workerTag} 🚨 PHÁT HIỆN VIA BỊ HẾT HẠN COOKIE / CHECKPOINT (${deadReason})! Dừng luồng ngay để bảo vệ.`);
            if (typeof onProgress === 'function') {
              onProgress({
                type: 'COOKIE_EXPIRED',
                uid,
                isCheckpoint,
                isExpired,
                message: deadReason,
                pageId: pageInfo.id,
                pageName: pageInfo.name,
              });
              onProgress({
                type: 'PAGE_FINISH',
                index: originalIndex,
                total: pages.length,
                ...resultItem,
                percent: Math.round((completedCount / pages.length) * 100),
                workerId,
              });
            }
            break;
          }

          if (actionBlocked) {
            results.consecutiveBlocks = (results.consecutiveBlocks || 0) + 1;
            results.failed++;
            results.details.push(resultItem);
            console.warn(`[FB-Buff]${workerTag} ⚠️ Page "${pageInfo.name}" bị Action Blocked (lần ${results.consecutiveBlocks} liên tiếp). Skip qua page tiếp theo...`);
            if (typeof onProgress === 'function') {
              onProgress({
                type: 'PAGE_FINISH',
                index: originalIndex,
                total: pages.length,
                ...resultItem,
                percent: Math.round((completedCount / pages.length) * 100),
                workerId,
              });
            }
            if (results.consecutiveBlocks >= 3) {
              console.error(`[FB-Buff]${workerTag} 🛑 Bị Action Blocked liên tiếp ${results.consecutiveBlocks} lần! Dừng worker này để bảo vệ Via.`);
              break;
            }
            // Nghỉ thêm 8s trước khi thử page tiếp theo
            await new Promise((r) => setTimeout(r, 8000));
            continue;
          } else {
            results.consecutiveBlocks = 0;
          }

          completedCount++;
          if (resultItem.status === 'SUCCESS' || resultItem.status === 'ALREADY_LIKED') {
            results.success++;
          } else if (resultItem.status === 'UNVERIFIED') {
            results.unverified++;
          } else {
            results.failed++;
          }
          results.details.push(resultItem);

          const currentPercent = effectiveKpi > 0
            ? Math.min(100, Math.round((results.success / effectiveKpi) * 100))
            : Math.round((completedCount / pages.length) * 100);

          if (typeof onProgress === 'function') {
            onProgress({
              type: 'PAGE_FINISH',
              index: originalIndex,
              total: effectiveKpi > 0 ? effectiveKpi : pages.length,
              kpiTarget: effectiveKpi > 0 ? effectiveKpi : undefined,
              ...resultItem,
              percent: currentPercent,
              workerId,
            });
          }

          if (effectiveKpi > 0 && results.success >= effectiveKpi) {
            console.log(`[FB-Buff]${workerTag} 🎯 [KPI REACHED] Đã đạt đủ KPI ${results.success}/${effectiveKpi} Like thành công!`);
            globalStopTriggered = true;
            results.kpiReached = true;
            results.autoRefilled = results.failed;
            if (typeof onProgress === 'function') {
              onProgress({
                type: 'KPI_REACHED',
                kpiTarget: effectiveKpi,
                success: results.success,
                failed: results.failed,
                autoRefilled: results.failed,
                percent: 100,
                message: `🎯 Đã đạt đủ KPI ${results.success}/${effectiveKpi} Like thành công!`,
              });
            }
            break;
          }

          // Chống checkpoint: Nghỉ ngơi an toàn theo lô (Batch Cooldown) per worker
          if (cooldownEvery < 9999 && i > 0 && i % cooldownEvery === 0 && i < workerPages.length - 1) {
            let baseCooldown = cooldownDurationMs || 15000;
            if (speedMode === 'TURBO') {
              baseCooldown = Math.max(5000, Math.min(baseCooldown, 8000));
            } else if (speedMode === 'FAST') {
              baseCooldown = Math.max(8000, Math.min(baseCooldown, 12000));
            } else if (speedMode === 'SAFE') {
              baseCooldown = Math.max(25000, baseCooldown);
            } else {
              baseCooldown = Math.max(12000, Math.min(baseCooldown, 18000));
            }
            const isBigBatch = i % (cooldownEvery * 2) === 0;
            const batchRest = isBigBatch
              ? Math.round(baseCooldown * 1.3) + Math.floor(Math.random() * 2000)
              : baseCooldown + Math.floor(Math.random() * 1500);
            const restSec = Math.round(batchRest / 1000);
            const restMsg = `🛡️ [Safe Human Pacing] Đang hạ nhiệt Via (${restSec}s) để reset bộ đếm tần suất của Facebook...`;
            console.log(`[FB-Buff]${workerTag} 🛡️ [ANTI-CHECKPOINT BM] Đã chạy xong ${i} Page. ${restMsg}`);

            if (typeof onProgress === 'function') {
              onProgress({
                type: 'COOLDOWN_START',
                workerId,
                workerTag,
                pageIndex: i,
                durationSec: restSec,
                message: restMsg,
              });
            }

            await cancellableSleep(batchRest, signal);

            if (typeof onProgress === 'function') {
              onProgress({
                type: 'COOLDOWN_END',
                workerId,
                workerTag,
                pageIndex: i,
              });
            }
          }

          // Giảm tải RAM cho Chromium khi chạy lô lớn (200 - 500 page)
          if (i > 0 && i % 40 === 0) {
            await workerTab.evaluate(() => {
              if (window.gc) window.gc();
            }).catch(() => {});
          }

          // Độ trễ tối ưu giữa các page
          if (i < workerPages.length - 1) {
            const waitTime = calculatePageDelay(delayMs, enableComment, dripFeedMode, dripDurationMinutes, pages.length, actualConcurrency, speedMode);
            await cancellableSleep(waitTime, signal);
          }
        }
      } finally {
        if (workerContext) {
          trackedContexts.delete(workerContext);
          await workerContext.close().catch(() => {});
        }
      }
    };

    try {
      await Promise.all(chunks.map((chunk) => runWorker(chunk)));
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  } else {
    // ========================================================
    // CHẾ ĐỘ 2: BUFF 1 LUỒNG TUẦN TỰ (SINGLE-WORKER PERSISTENT)
    // ========================================================
    let context = null;
    let browser = null;

    if (uid) {
      const profileDir = path.join(__dirname, 'browser_profiles', `via_${uid}`);
      fs.mkdirSync(profileDir, { recursive: true });
      context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        args: [
          ...OPTIMIZED_CHROMIUM_ARGS,
          '--disable-webrtc',
          '--disable-features=WebRtcHideLocalIpsWithMdns',
          '--enforce-webrtc-ip-permission-check',
        ],
        proxy: baseProxy ? { server: baseProxy.server, username: baseProxy.username, password: baseProxy.password } : undefined,
        userAgent: device.userAgent,
        viewport: device.viewport,
        deviceScaleFactor: device.deviceScaleFactor,
        isMobile: device.isMobile,
        hasTouch: device.hasTouch,
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
      });
    } else {
      browser = await chromium.launch({
        headless: true,
        args: [
          ...OPTIMIZED_CHROMIUM_ARGS,
          '--disable-webrtc',
          '--disable-features=WebRtcHideLocalIpsWithMdns',
          '--enforce-webrtc-ip-permission-check',
        ],
        proxy: baseProxy ? { server: baseProxy.server, username: baseProxy.username, password: baseProxy.password } : undefined,
      });
      try {
        context = await browser.newContext({
          userAgent: device.userAgent,
          viewport: device.viewport,
          deviceScaleFactor: device.deviceScaleFactor,
          isMobile: device.isMobile,
          hasTouch: device.hasTouch,
          locale: 'vi-VN',
          timezoneId: 'Asia/Ho_Chi_Minh',
          proxy: baseProxy ? { server: baseProxy.server, username: baseProxy.username, password: baseProxy.password } : undefined,
        });
      } catch (e) {
        await browser.close().catch(() => {});
        throw e;
      }
    }

    try {
      await applyFingerprintToContext(context, device);
      await applyResourceOptimization(context, false, true);
      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }
      let tab = context.pages().length ? context.pages()[0] : await context.newPage();
      if (context) trackedContexts.add(context);
      if (tab) trackedTabs.add(tab);
      await tab.route('**/*.{png,jpg,jpeg,webp,gif,avif,ico,mp4,mov,m4v,avi,webm,m3u8,ts,woff,woff2,ttf,otf}', (route) => route.abort());
      await tab.route('**/*{google-analytics,doubleclick,connect.facebook.net/signals,pixel.facebook.com,facebook.com/tr/}*', (route) => route.abort());

      console.log(`[FB-Buff] 🌐 Tải bài viết mục tiêu trước khi chạy luồng: ${targetUrl}`);
      let effectiveTargetUrl = targetUrl;
      try {
        await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await tab.waitForTimeout(1000);
        const redirected = tab.url();
        if (redirected && redirected.includes('facebook.com') && !redirected.includes('/share/')) {
          effectiveTargetUrl = redirected;
          console.log(`[FB-Buff] 🔗 Đã phát hiện link bài viết gốc: ${effectiveTargetUrl}`);
        }
      } catch (e) {
        console.warn(`[FB-Buff] ⚠️ Lỗi tải bài viết ban đầu (${e.message}), sẽ tự động thử lại.`);
      }

      const isUnavailable = await checkFacebookContentUnavailable(tab);
      if (isUnavailable) {
        console.warn(`[FB-Buff] 🛑 Bài viết không khả dụng (bị ẩn/xóa/giới hạn riêng tư): ${isUnavailable}`);
        results.stopped = true;
        results.error = 'Bài viết không tồn tại hoặc đã bị người đăng xóa, ẩn, giới hạn riêng tư trên Facebook.';
        return results;
      }

      for (let i = 0; i < pages.length; i++) {
        if (isStopRequested()) {
          results.stopped = true;
          console.warn(`[FB-Buff] 🛑 Phát hiện lệnh DỪNG KHẨN CẤP! Dừng vòng lặp tại page ${i + 1}/${pages.length}`);
          break;
        }

        try {
          tab = await ensureTabHealthy(context, tab);
        } catch (tErr) {
          if (tErr.isBrowserDead || (tErr.message && tErr.message.includes('closed'))) {
            results.stopped = true;
            console.error(`[FB-Buff] 🛑 Trình duyệt đã bị đóng. Dừng ngay tác vụ.`);
            break;
          }
        }

        const pageInfo = pages[i];
        console.log(`[FB-Buff] [${i + 1}/${pages.length}] ⚡ Đang tương tác bằng Page: "${pageInfo.name}" (ID: ${pageInfo.id})...`);

        if (typeof onProgress === 'function') {
          onProgress({
            type: 'PAGE_START',
            index: i,
            total: pages.length,
            pageId: pageInfo.id,
            pageName: pageInfo.name,
            percent: Math.round((completedCount / pages.length) * 100),
            workerId: 1,
          });
        }

        const { actionBlocked, browserDead, cookieDead, isCheckpoint, isExpired, deadReason, item: resultItem } = await executePageInteraction({
          tab,
          context,
          pageInfo,
          uid,
          targetUrl: effectiveTargetUrl,
          normalizedPostUrl,
          enableLike,
          enableComment,
          enableShare,
          enableHumanBehavior,
          fastSwitch,
          reactionType,
          comments,
          usedCommentsHistory,
          pageIndex: i,
          workerTag: '',
          speedMode,
          signal,
        });

          if (browserDead) {
            results.stopped = true;
            results.failed++;
            results.details.push(resultItem);
            console.error('[FB-Buff] 🛑 Trình duyệt Chromium đã bị đóng hoặc mất kết nối! Dừng tác vụ ngay lập tức.');
            break;
          }

          if (cookieDead) {
            results.stopped = true;
            results.cookieDead = true;
            results.deadViaUid = uid;
            results.isCheckpoint = isCheckpoint;
            results.isExpired = isExpired;
            results.deadReason = deadReason;
            results.failed++;
            results.details.push(resultItem);
            console.error(`[FB-Buff] 🚨 PHÁT HIỆN VIA BỊ HẾT HẠN COOKIE / CHECKPOINT (${deadReason})! Dừng tác vụ ngay lập tức.`);
            if (typeof onProgress === 'function') {
              onProgress({
                type: 'COOKIE_EXPIRED',
                uid,
                isCheckpoint,
                isExpired,
                message: deadReason,
                pageId: pageInfo.id,
                pageName: pageInfo.name,
              });
              onProgress({
                type: 'PAGE_FINISH',
                index: i,
                total: pages.length,
                ...resultItem,
                percent: Math.round((completedCount / pages.length) * 100),
                workerId: 1,
              });
            }
            break;
          }

          if (actionBlocked) {
            // Không dừng toàn bộ — chỉ skip page này, tiếp tục page tiếp theo
            // Nhưng nếu bị block liên tiếp >= 3 lần thì dừng để bảo vệ Via
            results.consecutiveBlocks = (results.consecutiveBlocks || 0) + 1;
            results.failed++;
            results.details.push(resultItem);
            console.warn(`[FB-Buff] ⚠️ Page "${pageInfo.name}" bị Action Blocked (lần ${results.consecutiveBlocks} liên tiếp). Skip qua page tiếp theo...`);
            if (typeof onProgress === 'function') {
              onProgress({
                type: 'PAGE_FINISH',
                index: i,
                total: pages.length,
                ...resultItem,
                percent: Math.round((completedCount / pages.length) * 100),
                workerId: 1,
              });
            }
            if (results.consecutiveBlocks >= 3) {
              results.stopped = true;
              console.error(`[FB-Buff] 🛑 Bị Action Blocked liên tiếp ${results.consecutiveBlocks} lần! Dừng tác vụ để bảo vệ Via.`);
              break;
            }
            // Nghỉ thêm 15s trước khi thử page tiếp theo
            await cancellableSleep(15000, signal);
            completedCount++;
            continue;
          }

          // Reset đếm block liên tiếp khi page thành công
          results.consecutiveBlocks = 0;

          completedCount++;
          if (resultItem.status === 'SUCCESS' || resultItem.status === 'ALREADY_LIKED') {
            results.success++;
          } else if (resultItem.status === 'UNVERIFIED') {
            results.unverified++;
          } else {
            results.failed++;
          }
          results.details.push(resultItem);

          const currentPercent = effectiveKpi > 0
            ? Math.min(100, Math.round((results.success / effectiveKpi) * 100))
            : Math.round((completedCount / pages.length) * 100);

          if (typeof onProgress === 'function') {
            onProgress({
              type: 'PAGE_FINISH',
              index: i,
              total: effectiveKpi > 0 ? effectiveKpi : pages.length,
              kpiTarget: effectiveKpi > 0 ? effectiveKpi : undefined,
              ...resultItem,
              percent: currentPercent,
              workerId: 1,
            });
          }

          // SMART KPI AUTO-REFILL: Khi đạt đủ KPI thành công, hoàn tất sớm và tự động dừng tác vụ
          if (effectiveKpi > 0 && results.success >= effectiveKpi) {
            console.log(`[FB-Buff] 🎯 [KPI REACHED] Đã đạt đủ KPI ${results.success}/${effectiveKpi} Like thành công! Tự động dừng tác vụ (đã qua ${i + 1} lượt thử, tự động bù ${results.failed} Page lỗi).`);
            results.kpiReached = true;
            results.autoRefilled = results.failed;
            if (typeof onProgress === 'function') {
              onProgress({
                type: 'KPI_REACHED',
                kpiTarget: effectiveKpi,
                success: results.success,
                failed: results.failed,
                autoRefilled: results.failed,
                percent: 100,
                message: `🎯 Đã đạt đủ KPI ${results.success}/${effectiveKpi} Like thành công! (Tự động bù ${results.failed} page lỗi)`,
              });
            }
            break;
          }

          // Chống checkpoint: Nghỉ ngơi an toàn theo lô (Batch Cooldown)
          if (cooldownEvery < 9999 && i > 0 && i % cooldownEvery === 0 && i < pages.length - 1) {
            let baseCooldown = cooldownDurationMs || 15000;
            if (speedMode === 'TURBO') {
              baseCooldown = Math.max(5000, Math.min(baseCooldown, 8000));
            } else if (speedMode === 'FAST') {
              baseCooldown = Math.max(8000, Math.min(baseCooldown, 12000));
            } else if (speedMode === 'SAFE') {
              baseCooldown = Math.max(25000, baseCooldown);
            } else {
              baseCooldown = Math.max(12000, Math.min(baseCooldown, 18000));
            }
            const isBigBatch = i % (cooldownEvery * 2) === 0;
            const batchRest = isBigBatch
              ? Math.round(baseCooldown * 1.3) + Math.floor(Math.random() * 2000)
              : baseCooldown + Math.floor(Math.random() * 1500);
            const restSec = Math.round(batchRest / 1000);
            const restMsg = `🛡️ [Safe Human Pacing] Đang hạ nhiệt Via (${restSec}s) để reset bộ đếm tần suất của Facebook...`;
            console.log(`[FB-Buff] 🛡️ [ANTI-CHECKPOINT BM] Đã chạy xong ${i} Page. ${restMsg}`);

            if (typeof onProgress === 'function') {
              onProgress({
                type: 'COOLDOWN_START',
                workerId: 1,
                pageIndex: i,
                durationSec: restSec,
                message: restMsg,
              });
            }

            await cancellableSleep(batchRest, signal);

            if (typeof onProgress === 'function') {
              onProgress({
                type: 'COOLDOWN_END',
                workerId: 1,
                pageIndex: i,
              });
            }
          }

          // Độ trễ tối ưu giữa các page
          if (i < pages.length - 1) {
            const waitTime = calculatePageDelay(delayMs, enableComment, dripFeedMode, dripDurationMinutes, pages.length, 1, speedMode);
            await cancellableSleep(waitTime, signal);
          }
        }
      } finally {
        if (context) {
          trackedContexts.delete(context);
          await context.close().catch(() => { });
        }
        if (browser) await browser.close().catch(() => { });
        if (signal) signal.removeEventListener('abort', abortCleanup);
      }
    }

    if (signal) signal.removeEventListener('abort', abortCleanup);

    console.log(`[FB-Buff] 🏁 Hoàn thành buff Like: Thành công ${results.success}/${effectiveKpi > 0 ? effectiveKpi : results.total} (Thất bại/Bù lỗi: ${results.failed}, Luồng: ${actualConcurrency})`);
    return results;
  }

  // ==========================================
  // 4. BUFF VIEW VIDEO / REELS ĐA LUỒNG TỐI ƯU RAM
  // ==========================================

  /**
   * Tăng lượt xem (View) cho Video / Reels Facebook (Tối ưu RAM và CPU)
   * @param {string} targetVideoUrl - Link Video / Reels cần buff view
   * @param {object} options - { targetViews, concurrency, watchTimeSeconds, cookieStr }
   */
  async function buffViews(targetVideoUrl, options = {}) {
    const {
      targetViews = 10,       // Số lượt view cần buff
      concurrency = 2,        // Số luồng xem song song
      watchTimeSeconds = 6,   // Thời gian xem mỗi lượt (chuẩn FB tính view từ 3-5s+)
      cookieStr = null,       // Cookie (tùy chọn, không bắt buộc vì view công khai không cần login)
    } = options;

    console.log(`[FB-Buff] 🚀 Bắt đầu Buff View Siêu Tốc & Tiết Kiệm RAM cho video: ${targetVideoUrl}`);
    console.log(`[FB-Buff] 🎯 Mục tiêu: ${targetViews} Views | Luồng: ${concurrency} | Thời lượng xem: ${watchTimeSeconds}s/view`);

    const cookies = cookieStr ? parseCookieString(cookieStr) : [];
    let completedViews = 0;
    let failedViews = 0;

    // Khởi tạo DUY NHẤT 1 instance browser Playwright (tiết kiệm 90% RAM so với mở nhiều browser)
    const browser = await chromium.launch({
      headless: true,
      args: OPTIMIZED_CHROMIUM_ARGS,
    });


    try {
      const runViewWorker = async (workerId) => {
        while (completedViews + failedViews < targetViews) {
          const currentTaskNum = completedViews + failedViews + 1;
          if (currentTaskNum > targetViews) break;

          let context = null;
          try {
            context = await browser.newContext({
              userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              viewport: { width: 1280, height: 720 },
            });

            if (cookies.length > 0) {
              await context.addCookies(cookies);
            }

            const page = await context.newPage();
            // Chặn tải các resource nặng để tiết kiệm tối đa CPU và băng thông mạng
            await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot,ico}', (route) => route.abort());

            console.log(`[FB-Buff] [Luồng ${workerId}] Đang xem video (View #${currentTaskNum}/${targetViews})...`);
            await page.goto(targetVideoUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

            // Tự động play video nếu đang pause
            await page.evaluate(() => {
              const videos = document.querySelectorAll('video');
              videos.forEach((v) => {
                v.muted = true;
                v.play().catch(() => { });
              });
            });

            // Giữ xem trong thời lượng watchTimeSeconds
            await page.waitForTimeout(watchTimeSeconds * 1000);

            completedViews++;
            console.log(`[FB-Buff] [Luồng ${workerId}] ✅ Đã xem xong 1 view (${completedViews}/${targetViews})`);
          } catch (err) {
            failedViews++;
            console.warn(`[FB-Buff] [Luồng ${workerId}] ⚠️ Lỗi khi xem video: ${err.message}`);
          } finally {
            if (context) await context.close().catch(() => { });
          }

          // Delay nhẹ giữa các lượt xem
          await new Promise((r) => setTimeout(r, 600));
        }
      };

      // Khởi chạy các worker song song trong cùng 1 browser
      const workers = [];
      const actualConcurrency = Math.min(concurrency, targetViews);
      for (let i = 1; i <= actualConcurrency; i++) {
        workers.push(runViewWorker(i));
      }

      await Promise.all(workers);
    } finally {
      await browser.close().catch(() => { });
    }

    console.log(`[FB-Buff] 🏁 Hoàn thành Buff View: Thành công ${completedViews}/${targetViews}`);
    return {
      totalTarget: targetViews,
      completed: completedViews,
      failed: failedViews,
    };
  }

  /**
   * 6. FACEBOOK POST HUNTER — Quét và trích xuất danh sách bài viết mới nhất từ Fanpage / Group / Profile
   * Tối ưu hóa siêu nhẹ (chặn media/font), hỗ trợ tự động tìm bài viết mới để nạp vào hàng đợi Auto-Buff
   * @param {string} targetUrl URL của Fanpage, Group hoặc Profile
   * @param {object} options Các tùy chọn: cookieStr, maxPosts, timeoutMs
   */
  // Xác định loại mục tiêu (Group / Page) để quét đúng thứ tự và lọc đúng link bài
  function getScanTargetInfo(rawUrl) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://www.facebook.com/${rawUrl.replace(/^\/+/, '')}`);
    } catch (_) {
      return { type: 'UNKNOWN', scanUrl: rawUrl };
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'groups' && segments[1]) {
      // Group: xem theo "Bài viết mới" để bài mới nhất nằm trên cùng
      const groupKey = segments[1];
      return {
        type: 'GROUP',
        groupKey: groupKey.toLowerCase(),
        scanUrl: `https://www.facebook.com/groups/${groupKey}/?sorting_setting=CHRONOLOGICAL`,
      };
    }
    if (segments[0] === 'profile.php' && url.searchParams.get('id')) {
      return { type: 'PAGE', pageId: url.searchParams.get('id'), scanUrl: url.toString() };
    }
    if (segments[0] && !['watch', 'reel', 'story.php', 'permalink.php'].includes(segments[0])) {
      return { type: 'PAGE', pageSlug: segments[0].toLowerCase(), scanUrl: url.toString() };
    }
    return { type: 'UNKNOWN', scanUrl: url.toString() };
  }

  function isLinkOwnedByTarget(href, info) {
    let url;
    try { url = new URL(href); } catch (_) { return false; }
    const segments = url.pathname.split('/').filter(Boolean);
    const first = (segments[0] || '').toLowerCase();

    if (info.type === 'GROUP') {
      // Trong feed Group chỉ nhận link bài Group (link Page/Reel là bài chia sẻ lại)
      return first === 'groups' && /^(posts|permalink)$/.test(segments[2] || '');
    }
    if (info.type === 'PAGE') {
      if (first === 'reel' || first === 'watch') return true; // Reel/Video không mang tên chủ sở hữu trong link
      const ownerId = url.searchParams.get('id');
      if (ownerId) return Boolean(info.pageId) && ownerId === info.pageId;
      if (info.pageId) return first === info.pageId;
      return first === info.pageSlug;
    }
    return true;
  }

  async function scanTargetForPosts(targetUrl, options = {}) {
    const {
      cookieStr = '',
      proxyUrl = '',
      maxPosts = 8,
      timeoutMs = 30000,
    } = options;

    if (!targetUrl || typeof targetUrl !== 'string') {
      throw new Error('Thiếu URL trang mục tiêu');
    }

    const targetInfo = getScanTargetInfo(targetUrl.trim());
    const cleanTarget = targetInfo.scanUrl;
    const proxy = parseProxy(proxyUrl);
    console.log(`[FB-Hunter] 🔍 Đang quét bài viết mới từ: ${cleanTarget} (Max: ${maxPosts})`);

    let browser = null;
    let context = null;
    const discoveredPosts = [];

    try {
      browser = await chromium.launch({
        headless: true,
        args: OPTIMIZED_CHROMIUM_ARGS,
        proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
      });


      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'vi-VN',
      });

      // Chặn ảnh/video/font để quét cực nhanh, tiết kiệm 80% RAM & mạng
      await context.route('**/*.{png,jpg,jpeg,webp,gif,svg,ico,mp4,webm,woff,woff2,ttf,otf}', (route) => {
        route.abort();
      });

      if (cookieStr) {
        const cookies = parseCookieString(cookieStr);
        if (cookies.length > 0) {
          await context.addCookies(cookies);
        }
      }

      const page = await context.newPage();
      await page.goto(cleanTarget, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch((e) => {
        console.warn(`[FB-Hunter] ⚠️ Tải trang (${e.message}), tiếp tục đọc DOM hiện có...`);
      });

      await page.waitForTimeout(3000);

      // Cuộn nhẹ 1-2 lần để kích hoạt lazy loading bài viết của Facebook Feed
      for (let s = 0; s < 2; s++) {
        await page.evaluate(() => window.scrollBy({ top: 900, behavior: 'smooth' })).catch(() => { });
        await page.waitForTimeout(1400);
      }

      // Facebook giấu link bài trong mốc thời gian (href "?__cft__..." / "#"), chỉ hiện link thật khi rê chuột.
      // Rê chuột vào các link đó trong từng khối bài (theo thứ tự feed, bài mới ở trên) để lộ permalink.
      // Link lộ ra chỉ tồn tại khi chuột còn đặt trên đó → đọc ngay sau khi rê.
      const revealedLinks = [];
      const feedUnits = await page.$$('[role="main"] div[data-virtualized], [role="feed"] > div, [aria-posinset]').catch(() => []);
      for (const unit of feedUnits.slice(0, maxPosts * 3)) {
        const anchors = await unit.$$('a').catch(() => []);
        for (const a of anchors) {
          const h = (await a.getAttribute('href').catch(() => '')) || '';
          if (h && !h.startsWith('#') && !/^(?:https:\/\/www\.facebook\.com\/?)?\?__cft__/.test(h)) continue;
          await a.hover({ timeout: 1500 }).catch(() => { });
          await page.waitForTimeout(150);
          const revealed = await a.evaluate((el) => el.href).catch(() => '');
          if (revealed && /story_fbid=|\/posts\/|\/permalink\//.test(revealed)) {
            const text = await unit.evaluate((el) => (el.innerText || '').trim().slice(0, 150)).catch(() => '');
            revealedLinks.push({ href: revealed, text });
            break; // 1 permalink cho mỗi khối bài là đủ
          }
        }
      }

      // Trích xuất toàn bộ liên kết bài viết (bài lộ ra từ mốc thời gian xếp trước, đúng thứ tự feed)
      const pageLinks = await page.$$eval('a[href]', (anchors) => {
        return anchors.map((a) => {
          const text = (a.innerText || a.getAttribute('aria-label') || '').trim();
          return {
            href: a.href,
            text: text.slice(0, 150),
          };
        });
      }).catch(() => []);
      const rawLinks = [...revealedLinks, ...pageLinks];

      const seenUrls = new Set();
      const postUrlPatterns = [
        /\/posts\/[a-zA-Z0-9_-]+/i,
        /\/videos\/[0-9]+/i,
        /\/reel\/[0-9]+/i,
        /story\.php\?story_fbid=/i,
        /permalink\.php\?story_fbid=/i,
        /\/groups\/[^/]+\/permalink\/[0-9]+/i,
        /\/groups\/[^/]+\/posts\/[0-9]+/i,
      ];

      for (const item of rawLinks) {
        const href = item.href;
        if (!href || !href.includes('facebook.com')) continue;

        const isPost = postUrlPatterns.some((pattern) => pattern.test(href));
        if (!isPost) continue;
        // Bỏ link bài của nơi khác (bài chia sẻ, gợi ý...) — chỉ giữ bài thuộc chính mục tiêu
        if (!isLinkOwnedByTarget(href, targetInfo)) continue;

        // Chuẩn hóa loại bỏ tracking query Facebook
        const cleanUrl = href.replace(/[?&](?:mibextid|fbclid|rdid|__cft__\[0\]|__tn__|ref)=[^&]*/g, '').replace(/[?&]$/, '');
        const normalized = normalizeFbPostUrl(cleanUrl);

        // Loại bỏ các đường link không phải bài viết cụ thể
        if (/\/(posts|videos|reels)$/.test(normalized.split('?')[0])) {
          continue;
        }

        if (seenUrls.has(normalized)) continue;
        seenUrls.add(normalized);

        discoveredPosts.push({
          url: cleanUrl,
          normalizedUrl: normalized,
          title: item.text || 'Bài viết Facebook',
          foundAt: new Date().toISOString(),
        });

        if (discoveredPosts.length >= maxPosts) break;
      }

      console.log(`[FB-Hunter] 🎯 Tìm thấy ${discoveredPosts.length} bài viết hợp lệ từ ${cleanTarget}`);
    } catch (err) {
      console.error(`[FB-Hunter] ❌ Lỗi quét mục tiêu ${cleanTarget}:`, err.message);
    } finally {
      if (context) await context.close().catch(() => { });
      if (browser) await browser.close().catch(() => { });
    }

    return discoveredPosts;
  }

  /**
   * 7. VIA SESSION VALIDATOR — Kiểm tra sức khỏe tài khoản Via (LIVE vs CHECKPOINT / EXPIRED)
   * @param {string} cookieStr Cookie của Via
   * @param {object} options Tùy chọn proxyUrl, timeoutMs
   */
  async function validateViaSession(cookieStr, options = {}) {
    const { proxyUrl = '', timeoutMs = 20000 } = options;
    if (!cookieStr || !cookieStr.includes('c_user=')) {
      return { isLive: false, status: 'NO_COOKIE', error: 'Chuỗi Cookie rỗng hoặc không có c_user' };
    }

    const cookies = parseCookieString(cookieStr);
    const uid = getUserIdFromCookie(cookieStr);
    const device = getDeviceForUid(uid);
    const proxy = parseProxy(proxyUrl);

    let browser = null;
    let context = null;

    try {
      browser = await chromium.launch({
        headless: true,
        args: OPTIMIZED_CHROMIUM_ARGS,
        proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
      });


      context = await browser.newContext({
        userAgent: device.userAgent,
        viewport: { width: 1280, height: 720 },
        locale: 'vi-VN',
      });

      await context.route('**/*.{png,jpg,jpeg,webp,gif,svg,ico,mp4,webm,woff,woff2,ttf,otf}', (route) => {
        route.abort();
      });

      await context.addCookies(cookies);
      const page = await context.newPage();

      let navError = null;
      await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch((e) => {
        navError = e;
        console.warn(`[ViaValidator] ⚠️ Navigation note: ${e.message}`);
      });

      if (navError) {
        const errStr = navError.message || '';
        if (
          errStr.includes('ERR_INTERNET_DISCONNECTED') ||
          errStr.includes('ERR_NETWORK_CHANGED') ||
          errStr.includes('ERR_CONNECTION_RESET') ||
          errStr.includes('ERR_NAME_NOT_RESOLVED') ||
          errStr.includes('Timeout')
        ) {
          console.warn(`[ViaValidator] ⚠️ Lỗi kết nối mạng khi kiểm tra Via ${uid}: ${errStr}`);
          return { isLive: false, status: 'NETWORK_ERROR', uid, error: errStr };
        }
      }

      await page.waitForTimeout(2500);
      const currentUrl = page.url();

      // Nếu không tải được trang Facebook do lỗi mạng / blank
      if (!currentUrl || currentUrl === 'about:blank' || !currentUrl.startsWith('http')) {
        console.warn(`[ViaValidator] ⚠️ Trang không phản hồi Facebook (URL: ${currentUrl}), bỏ qua không đánh dấu lỗi.`);
        return { isLive: false, status: 'NETWORK_ERROR', uid, error: 'Không tải được trang Facebook' };
      }

      if (currentUrl.includes('/checkpoint') || currentUrl.includes('checkpoint')) {
        console.warn(`[ViaValidator] 🛑 Via ${uid} BỊ CHECKPOINT! (URL: ${currentUrl})`);
        return { isLive: false, status: 'CHECKPOINT', uid, url: currentUrl };
      }

      const hasLoginForm = (await page.locator('input[name="email"], input[name="pass"], #login_form').count().catch(() => 0)) > 0;
      const title = await page.title().catch(() => '');
      const isLoginPage = hasLoginForm || /đăng nhập|log in|login/i.test(title);

      if (currentUrl.includes('/login') || currentUrl.includes('login_attempt') || isLoginPage) {
        console.warn(`[ViaValidator] ❌ Via ${uid} ĐÃ HẾT HẠN COOKIE / BỊ ĐĂNG XUẤT! (Phát hiện form đăng nhập)`);
        return { isLive: false, status: 'EXPIRED', uid, url: currentUrl, error: 'Cookie đã hết hạn hoặc bị đăng xuất khỏi Facebook' };
      }

      console.log(`[ViaValidator] ✅ Via ${uid} HOẠT ĐỘNG TỐT (LIVE)! (Tên: ${title})`);
      return {
        isLive: true,
        status: 'LIVE',
        uid,
        name: title.replace(/\|.*$/, '').trim(),
        url: currentUrl,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { isLive: false, status: 'ERROR', uid, error: err.message };
    } finally {
      if (context) await context.close().catch(() => { });
      if (browser) await browser.close().catch(() => { });
    }
  }

  /**
   * Chụp ảnh màn hình bài viết Facebook làm bằng chứng nghiệm thu kết quả buff
   * @param {string} targetUrl - URL bài viết
   * @param {object} options - { cookieStr, proxyUrl, outputPath, timeoutMs }
   * @returns {Promise<{ success: boolean, filePath?: string, error?: string }>}
   */
  async function capturePostScreenshot(targetUrl, options = {}) {
    const {
      cookieStr = null,
      proxyUrl = null,
      outputPath = null,
      timeoutMs = 25000,
    } = options;

    const targetPath =
      outputPath ||
      path.join(__dirname, 'data', 'screenshots', `proof_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Tự động dọn dẹp ảnh bằng chứng cũ hơn 7 ngày để chống đầy ổ đĩa
    try {
      const files = fs.readdirSync(dir);
      const nowMs = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000;
      for (const f of files) {
        if (!f.startsWith('proof_')) continue;
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (nowMs - stat.mtimeMs > maxAge) {
          fs.unlinkSync(fp);
        }
      }
    } catch (_) {}

    const proxy = proxyUrl ? parseProxy(proxyUrl) : null;
    const cookies = cookieStr ? parseCookieString(cookieStr) : [];

    let browser = null;
    let context = null;

    try {
      browser = await chromium.launch({
        headless: true,
        args: OPTIMIZED_CHROMIUM_ARGS,
        proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
      });

      context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1080, height: 1100 },
        deviceScaleFactor: 1.5,
        locale: 'vi-VN',
      });

      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }

      const page = await context.newPage();
      // Chặn video nặng để tiết kiệm RAM & CPU, giữ ảnh để render bài viết đẹp mắt
      await page.route('**/*.{mp4,mov,m4v,avi,webm,m3u8,ts}', (route) => route.abort());
      await page.route('**/*{google-analytics,doubleclick,connect.facebook.net/signals,pixel.facebook.com,facebook.com/tr/}*', (route) => route.abort());

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => { });
      await page.waitForTimeout(3000);

      // Chụp lại khối bài viết chính hoặc viewport
      const article = await page.$('div[role="article"]').catch(() => null);
      if (article) {
        await article.screenshot({ path: targetPath }).catch(async () => {
          await page.screenshot({ path: targetPath, fullPage: false });
        });
      } else {
        await page.screenshot({ path: targetPath, fullPage: false });
      }

      console.log(`[FB-Proof] 📸 Đã chụp ảnh nghiệm thu thành công: ${targetPath}`);
      return { success: true, filePath: targetPath };
    } catch (err) {
      console.warn(`[FB-Proof] ⚠️ Lỗi chụp ảnh nghiệm thu: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      if (context) await context.close().catch(() => { });
      if (browser) await browser.close().catch(() => { });
    }
  }

  module.exports = {
    parseCookieString,
    getUserIdFromCookie,
    getManagedPages,
    getCachedPages,
    setCachedPages,
    loadPagesCache,
    savePagesCache,
    buffLikesWithPages,
    buffViews,
    scanTargetForPosts,
    validateViaSession,
    capturePostScreenshot,
    parseProxy,
    testProxy,
    testProxyHealth,
    filterLiveProxies,
    recordPageAction,
    getPageUsageToday,
    getDailyPageActionLimit,
    filterAvailablePagesForPost,
    recordPagePostInteraction,
    hasPageInteractedWithPost,
    getGlobalRegistryStats,
    getPostInteractedPageIds,
    normalizeFbPostUrl,
    resolveSpintax,
    executePostShare,
    SEEDING_PRESETS,
  };

  // ==========================================
  // 5. TEST CLI TRỰC TIẾP
  // ==========================================
  if (require.main === module) {
    const args = process.argv.slice(2);
    const action = args[0]; // 'get-pages' | 'buff-like' | 'buff-view'

    console.log('--- FB BUFF ENGAGEMENT TOOL ---');
    console.log('Sử dụng:');
    console.log('  node fb-buff-tool.js get-pages "<COOKIE>"');
    console.log('  node fb-buff-tool.js buff-like "<COOKIE>" "<POST_URL>" [REACTION_TYPE]');
    console.log('  node fb-buff-tool.js buff-view "<VIDEO_URL>" [TARGET_VIEWS] [CONCURRENCY]');
    console.log('-------------------------------\n');

    if (action === 'get-pages') {
      const cookie = args[1];
      if (!cookie) {
        console.error('Vui lòng cung cấp chuỗi Cookie!');
        process.exit(1);
      }
      getManagedPages(cookie)
        .then((pages) => console.log('KẾT QUẢ:', JSON.stringify(pages, null, 2)))
        .catch((err) => console.error('LỖI:', err.message));
    } else if (action === 'buff-like') {
      const cookie = args[1];
      const postUrl = args[2];
      const reaction = args[3] || 'LIKE';
      if (!cookie || !postUrl) {
        console.error('Vui lòng cung cấp Cookie và Link bài viết!');
        process.exit(1);
      }
      buffLikesWithPages(cookie, postUrl, { reactionType: reaction })
        .then((res) => console.log('KẾT QUẢ:', res))
        .catch((err) => console.error('LỖI:', err.message));
    } else if (action === 'buff-view') {
      const videoUrl = args[1];
      const targetViews = parseInt(args[2], 10) || 5;
      const concurrency = parseInt(args[3], 10) || 2;
      if (!videoUrl) {
        console.error('Vui lòng cung cấp Link Video/Reels!');
        process.exit(1);
      }
      buffViews(videoUrl, { targetViews, concurrency })
        .then((res) => console.log('KẾT QUẢ:', res))
        .catch((err) => console.error('LỖI:', err.message));
    }
  }
