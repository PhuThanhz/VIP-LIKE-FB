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
];

// Hàm chặn quảng cáo, pixel theo dõi, video nặng & ảnh thừa để tăng tốc 3-5 lần (tiết kiệm 80% RAM & băng thông)
async function applyResourceOptimization(context, allowMedia = false, blockImages = true) {
  try {
    await context.route('**/*', (route) => {
      const req = route.request();
      const rType = req.resourceType();
      const url = req.url();

      // Chặn các tracker, pixel telemetry gây chậm mạng
      if (
        url.includes('/tr/') ||
        url.includes('pixel.facebook.com') ||
        url.includes('connect.facebook.net') ||
        url.includes('googletagmanager.com') ||
        url.includes('doubleclick.net')
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
  } catch (_) {}
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
  } catch (e) {}
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
      await reqContext.dispose().catch(() => {});
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
        try { walk(JSON.parse(line)); } catch (e) {}
      }
    } catch (e) {}
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
      await more.click().catch(() => {});
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
    await page.keyboard.press('Escape').catch(() => {});

    const results = [];
    for (const name of names) {
      let id = idByName.get(name) || '';
      let url = id ? `https://www.facebook.com/profile.php?id=${id}` : cardLinks[name] || '';
      if (!id && url) {
        // Page vanity: ID nằm ở "userID" trong HTML trang tường của page
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
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

    console.log(`[FB-Buff] ✅ Đã tìm thấy và làm sạch tên ${pageList.length} Fanpage được quản lý.`);
    if (uid && pageList.length > 0) {
      setCachedPages(uid, pageList, viaName);
    }
    return pageList;
  } finally {
    await browser.close().catch(() => {});
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

const REACTED_ARIA_RE = /(Gỡ|Remove|Đã thích|Liked|Thay đổi|Change)/i;
// Sau khi thả cảm xúc khác Like, nút Like hiển thị tên cảm xúc đó thay cho "Thích"
const REACTION_NAME_RE = /^(Yêu thích|Thương thương|Haha|Wow|Buồn|Phẫn nộ|Love|Care|Sad|Angry)$/i;

function isReactedState(state, beforeAria) {
  if (!state) return false;
  if (state.pressed === 'true') return true;
  if (state.isBlue) return true;
  if (REACTED_ARIA_RE.test(state.aria)) return true;
  if (REACTION_NAME_RE.test(state.aria) || REACTION_NAME_RE.test(state.text)) return true;
  return Boolean(state.aria) && state.aria !== beforeAria && !/^(Thích|Like)$/i.test(state.aria);
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
// Tối ưu: Polling phản hồi nhanh mỗi 150ms, tự động click bổ trợ nếu Facebook phản hồi trễ
async function verifyReacted(handle, beforeAria, refind = null, maxWaitMs = 2600) {
  const start = Date.now();
  let retried = false;
  if (handle) {
    const state = await handle.evaluate(readButtonState).catch(() => null);
    if (isReactedState(state, beforeAria)) return true;
  }
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 160));
    if (handle) {
      const state = await handle.evaluate(readButtonState).catch(() => null);
      if (isReactedState(state, beforeAria)) return true;
    }
    if (refind) {
      const fresh = await refind().catch(() => null);
      if (fresh) {
        const state = await fresh.evaluate(readButtonState).catch(() => null);
        if (isReactedState(state, beforeAria)) return true;
        // Nếu qua 1.2s Facebook chưa cập nhật, click bổ trợ 1 lần nữa để đảm bảo tương tác ăn 100%
        if (!retried && Date.now() - start > 1200) {
          retried = true;
          await fresh.click({ timeout: 1000 }).catch(async () => {
            await fresh.evaluate((el) => {
              if (typeof el.click === 'function') el.click();
            }).catch(() => {});
          });
        }
      }
    }
  }
  return false;
}

// Hàm tính toán độ trễ tối ưu giữa các trang theo chế độ tốc độ (chống lag, không kẹt số)
function calculatePageDelay(delayMs, enableComment, dripFeedMode, dripDurationMinutes, totalPages, concurrency, speedMode = 'NORMAL') {
  if (dripFeedMode && dripDurationMinutes > 0) {
    const totalDurationMs = dripDurationMinutes * 60 * 1000;
    const dripBaseWait = Math.max(delayMs, Math.floor((totalDurationMs / Math.max(1, totalPages)) * concurrency));
    const dripJitter = Math.floor(dripBaseWait * 0.15 * (Math.random() * 2 - 1));
    return Math.max(2000, dripBaseWait + dripJitter);
  }

  if (enableComment) {
    const baseWait = delayMs > 0 ? Math.max(delayMs, 4500) : 8000;
    return baseWait + Math.floor(Math.random() * 1800);
  }

  // Chế độ Buff Like / Reaction thuần túy:
  if (speedMode === 'TURBO' || delayMs <= 1800) {
    const base = delayMs > 0 ? Math.max(800, delayMs) : 1500;
    return base + Math.floor(Math.random() * 300);
  } else if (speedMode === 'FAST' || delayMs <= 2800) {
    const base = delayMs > 0 ? Math.max(1800, delayMs) : 2500;
    return base + Math.floor(Math.random() * 450);
  } else if (speedMode === 'SAFE' || delayMs >= 5000) {
    const base = delayMs > 0 ? delayMs : 5000;
    return base + Math.floor(Math.random() * 1800);
  } else {
    const base = delayMs > 0 ? delayMs : 3500;
    const jitter = Math.floor(base * 0.15 * (Math.random() * 2 - 1));
    return Math.max(1200, base + jitter);
  }
}

// Tìm nút Like siêu tốc: Quét và đánh dấu trực tiếp trong DOM nội tại (0.5ms) thay vì gọi 25 lệnh CDP tuần tự
async function findLikeButtonOnTab(tab) {
  try {
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
        // Bỏ qua nếu nằm trong popup thông báo
        if (b.closest('div[aria-label*="Thông báo"], div[role="dialog"][aria-label*="Thông báo"]')) return false;

        const aria = (b.getAttribute('aria-label') || '').trim();
        const text = (b.innerText || '').trim();

        // Bỏ qua nút đếm số cảm xúc (ví dụ "Thích: 2 người")
        if (/^(?:Thích|Like):\s*\d+/i.test(aria)) return false;

        // Khớp chính xác aria-label của nút Like / Cảm xúc
        if (
          aria === 'Thích' || aria === 'Like' ||
          aria === 'Gỡ Thích' || aria === 'Unlike' ||
          aria.startsWith('Gỡ ') || aria.startsWith('Remove ') ||
          aria.includes('Đã thích') || aria.includes('Liked') ||
          aria === 'Thích bài viết' || aria === 'Like post' ||
          aria === 'Bày tỏ cảm xúc' || aria === 'React' ||
          aria === 'Reaction'
        ) {
          return true;
        }

        // Khớp nút có attribute quảng cáo Facebook
        if (b.querySelector('[data-ad-rendering-role="like_button"]') || b.getAttribute('data-ad-rendering-role') === 'like_button') {
          return true;
        }

        // Khớp chính xác theo text hiển thị
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (lines.length > 0 && (lines[0] === 'Thích' || lines[0] === 'Like')) {
          return true;
        }

        return false;
      }

      // Ưu tiên 1: Quét trong Modal Dialog đang mở (bài viết xem qua permalink/share thường nằm trong modal lightbox)
      const modals = Array.from(document.querySelectorAll('div[role="dialog"]')).filter(
        (d) => !(d.getAttribute('aria-label') || '').includes('Thông báo') && !(d.getAttribute('aria-label') || '').includes('Trang &')
      );
      for (const m of modals) {
        const btns = Array.from(m.querySelectorAll('div[role="button"]'));
        const match = btns.find(isLegitLikeButton);
        if (match) {
          match.setAttribute('data-viplike-target', 'like');
          return true;
        }
      }

      // Ưu tiên 2: Quét trong bài viết (Feed article / Group post)
      const articles = Array.from(document.querySelectorAll('div[role="article"], div[data-pagelet*="FeedUnit"], div[data-pagelet*="Group"]'));
      for (const a of articles) {
        const btns = Array.from(a.querySelectorAll('div[role="button"]'));
        const match = btns.find(isLegitLikeButton);
        if (match) {
          match.setAttribute('data-viplike-target', 'like');
          return true;
        }
      }

      // Ưu tiên 3: Quét toàn trang (bỏ qua banner và notifications)
      const allBtns = Array.from(document.querySelectorAll('div[role="button"]'));
      const match = allBtns.find(isLegitLikeButton);
      if (match) {
        match.setAttribute('data-viplike-target', 'like');
        return true;
      }

      return false;
    });

    if (found) {
      return tab.locator('[data-viplike-target="like"]').first();
    }
  } catch (e) {}

  // Fallback sang Playwright Locator siêu nhanh nếu evaluate gặp lỗi
  const fastFallback = tab.locator(
    'div[role="dialog"] div[role="button"][aria-label="Thích"], ' +
    'div[role="dialog"] div[role="button"][aria-label="Like"], ' +
    'div[role="dialog"] div[role="button"][aria-label="Gỡ Thích"], ' +
    'div[role="article"] div[role="button"][aria-label="Thích"], ' +
    'div[role="article"] div[role="button"][aria-label="Like"], ' +
    'div[role="button"]:has([data-ad-rendering-role="like_button"]), ' +
    'div[role="button"][aria-label="Thích"], div[role="button"][aria-label="Like"], ' +
    'div[role="button"][aria-label="Thích bài viết"], div[role="button"][aria-label="Like post"], ' +
    'div[role="button"]:has(span:text-is("Thích")), div[role="button"]:has(span:text-is("Like"))'
  ).first();

  if (await fastFallback.isVisible({ timeout: 450 }).catch(() => false)) {
    return fastFallback;
  }

  return null;
}

async function checkActionBlockedOnTab(tab) {
  try {
    const blocked = tab.locator(
      'div[role="dialog"]:has-text("Hành động này bị chặn"), ' +
      'div[role="dialog"]:has-text("Bạn tạm thời bị hạn chế"), ' +
      'div[role="dialog"]:has-text("You’re Temporarily Blocked"), ' +
      'div[role="dialog"]:has-text("Action Blocked"), ' +
      'div[role="dialog"]:has-text("Thử lại sau"), ' +
      'div[role="dialog"]:has-text("Try again later"), ' +
      'div[role="dialog"]:has-text("Không thể bày tỏ cảm xúc"), ' +
      'div[role="dialog"]:has-text("Tài khoản của bạn bị hạn chế"), ' +
      'div[role="dialog"]:has-text("Your account is restricted")'
    ).first();
    return (await blocked.count().catch(() => 0)) > 0 && (await blocked.isVisible().catch(() => false));
  } catch (e) {
    return false;
  }
}

/** Tự động đóng các popup / overlay làm phiền của Facebook (Lúc khác, Not now, Đóng, v.v.) */
async function dismissFacebookOverlays(tab) {
  try {
    await tab.evaluate(() => {
      const dismissTexts = ['lúc khác', 'not now', 'để sau', 'đóng', 'close', 'hủy', 'cancel'];
      const buttons = Array.from(document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] [aria-label="Đóng"], div[role="dialog"] [aria-label="Close"]'));
      for (const btn of buttons) {
        const t = (btn.innerText || btn.getAttribute('aria-label') || '').trim().toLowerCase();
        if (dismissTexts.includes(t)) {
          btn.click();
        }
      }
    }).catch(() => {});
  } catch (_) {}
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
      await el.click({ force: true, timeout: 2500 }).catch(() => {});
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
    } catch (e) {}
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
  await tab.keyboard.press('Escape').catch(() => {});
  await tab.waitForTimeout(300);

  // Bước 1: Mở menu Avatar góc trên cùng bên phải trong banner
  const avatarBtn = tab.locator(
    'div[role="banner"] div[role="button"][aria-label*="trang cá nhân"], ' +
    'div[role="banner"] div[role="button"][aria-label*="Your profile"], ' +
    'div[role="banner"] div[role="button"][aria-label*="Tài khoản"]'
  ).first();

  let switched = false;
  if (await avatarBtn.isVisible({ timeout: 3500 }).catch(() => false)) {
    await avatarBtn.click({ force: true });
    await tab.waitForTimeout(800);

    // Bước 2: Kiểm tra xem Page/Via mục tiêu có nằm ngay trong danh sách rút gọn không
    const searchTargetName = isProfileVia ? '' : targetName;
    if (searchTargetName) {
      const quickPage = tab.locator(
        `div[role="menu"] div[role="button"]:has-text("${searchTargetName}"), ` +
        `div[role="dialog"] div[role="button"]:has-text("${searchTargetName}")`
      ).first();
      if (await quickPage.isVisible({ timeout: 1000 }).catch(() => false)) {
        await quickPage.click({ force: true });
        switched = true;
      }
    } else if (isProfileVia) {
      // Chuyển về Via mẹ: Chọn profile cá nhân đầu tiên trong menu
      const viaOption = tab.locator(
        'div[role="menu"] div[role="button"], div[role="dialog"] div[role="button"]'
      ).first();
      if (await viaOption.isVisible({ timeout: 1000 }).catch(() => false)) {
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

      if (await seeAllBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
        await seeAllBtn.click({ force: true });
        await tab.waitForTimeout(1000);

        const profileDlg = tab.locator('div[role="dialog"]').filter({
          hasText: /Trang & trang cá nhân của bạn|Your profiles and Pages/
        }).first();

        if (await profileDlg.isVisible({ timeout: 3000 }).catch(() => false)) {
          const pageItem = profileDlg.locator(
            `div[role="button"]:has-text("${targetName}"), ` +
            `div[role="listitem"]:has-text("${targetName}")`
          ).first();

          if (await pageItem.isVisible({ timeout: 1500 }).catch(() => false)) {
            await pageItem.click({ force: true });
            switched = true;
          } else {
            // Lọc bằng ô tìm kiếm trong modal
            const searchBox = profileDlg.locator('input[type="search"], input[type="text"]').first();
            if (await searchBox.isVisible({ timeout: 1500 }).catch(() => false)) {
              await searchBox.fill(targetName);
              await tab.waitForTimeout(600);
              const filteredItem = profileDlg.locator(
                `div[role="button"]:has-text("${targetName}"), ` +
                `div[role="listitem"]:has-text("${targetName}")`
              ).first();
              if (await filteredItem.isVisible({ timeout: 1500 }).catch(() => false)) {
                await filteredItem.click({ force: true });
                switched = true;
              }
            }
          }
        }
      }
    }
  }

  // Fallback nếu không click được qua menu banner
  if (!switched) {
    if (isProfileVia) {
      await tab.goto(`https://www.facebook.com/profile.php?id=${uid}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      const switchBtn = tab.locator('div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Chuyển")').first();
      if (await switchBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await switchBtn.click({ force: true }).catch(() => {});
      }
    } else {
      await tab.goto(`https://www.facebook.com/profile.php?id=${pageInfo.id}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      const switchBtn = tab.locator('div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Chuyển"), [aria-label*="Chuyển sang"], div[role="button"]:has-text("Switch now")').first();
      if (await switchBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
        await switchBtn.click({ force: true }).catch(() => {});
        await tab.waitForTimeout(600);

        // Bắt và bấm nút "Chuyển" trong hộp thoại xác nhận đổi trang cá nhân Pro5 nếu có
        const modalConfirm = tab.locator(
          'div[role="dialog"] div[role="button"]:has-text("Chuyển"), ' +
          'div[role="dialog"] div[role="button"]:has-text("Switch"), ' +
          'div[role="dialog"] [aria-label*="Chuyển sang"]'
        ).first();
        if (await modalConfirm.isVisible({ timeout: 2500 }).catch(() => false)) {
          await modalConfirm.click({ force: true }).catch(() => {});
          switched = true;
          await tab.waitForTimeout(1000);
        }
      }
    }
  }

  // Đợi Facebook hoàn tất chuyển danh tính
  await tab.waitForTimeout(2000);
  const usePageBtn = tab.locator('div[role="button"]:has-text("Dùng Trang"), div[role="button"]:has-text("Use Page")').first();
  if (await usePageBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await usePageBtn.click({ force: true }).catch(() => {});
    await tab.waitForTimeout(500);
  }
  if (!switched) {
    await tab.keyboard.press('Escape').catch(() => {});
  }

  // Cập nhật cookie i_user cho Playwright context
  if (pageInfo.id && pageInfo.id !== uid) {
    await context.addCookies([
      {
        name: 'i_user',
        value: String(pageInfo.id),
        domain: '.facebook.com',
        path: '/',
        secure: true,
        sameSite: 'Lax',
      },
    ]).catch(() => {});
  } else {
    await context.clearCookies({ name: 'i_user' }).catch(() => {});
  }

  return true;
}

/**
 * Thực hiện chuỗi tương tác (đổi danh tính, thả like, viết bình luận) cho 1 Fanpage trên 1 Tab
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
  enableHumanBehavior,
  fastSwitch,
  reactionType,
  comments = [],
  usedCommentsHistory,
  pageIndex = 0,
  workerTag = '',
}) {
  // BƯỚC 0: KIỂM TRA CHẶN TÍNH NĂNG
  if (await checkActionBlockedOnTab(tab)) {
    console.error(`[FB-Buff]${workerTag} 🛑 PHÁT HIỆN TÀI KHOẢN BỊ FACEBOOK HẠN CHẾ TÍNH NĂNG (Action Blocked)!`);
    return {
      actionBlocked: true,
      item: {
        pageId: pageInfo.id,
        pageName: pageInfo.name,
        status: 'ERROR',
        error: 'Tài khoản Facebook bị hạn chế tạm thời (Action Blocked). Dừng để bảo vệ Via & BM an toàn.',
      },
    };
  }

  let likeStatus = enableLike ? 'WAITING' : 'SKIPPED';
  let likeError = '';
  let commentStatus = enableComment ? 'WAITING' : 'SKIPPED';
  let commentError = '';
  let usedCommentText = '';
  let currentReaction = (reactionType || 'LIKE').toUpperCase();

  try {
    // BƯỚC 1: CHUYỂN ĐỔI DANH TÍNH
    let fastSwitched = false;
    const curTabUrl = tab.url();
    const isOnPost = curTabUrl.includes('facebook.com') &&
      !curTabUrl.includes('/login') &&
      !curTabUrl.includes('/checkpoint') &&
      !curTabUrl.includes('/pages/?category=') &&
      !curTabUrl.includes('/profile.php?') &&
      !curTabUrl.includes('/profile/switch');

    if (fastSwitch && isOnPost) {
      const voiceBtn = tab.locator(
        '[aria-label*="Giọng nói hiện có"], [aria-label*="chuyển trang cá nhân"], [aria-label*="Voice switcher"], ' +
        '[aria-label*="Tương tác với tư cách"], [aria-label*="Bình chọn giọng nói"], [aria-label*="Bình luận dưới tên"], ' +
        '[aria-label*="Bình luận với tư cách"], [aria-label*="Comment as"], [aria-label*="Tương tác bằng"], ' +
        '[aria-label*="Switch to profile"], [aria-label*="Interact as"], [aria-label*="Chọn cách tương tác"], ' +
        '[aria-label*="Choose how to interact"], div[aria-haspopup="menu"][aria-label*="trang cá nhân"], ' +
        'div[aria-haspopup="menu"][aria-label*="profile" i]'
      ).first();

      if ((await voiceBtn.count().catch(() => 0)) > 0 && (await voiceBtn.isVisible().catch(() => false))) {
        const currentVoiceAria = (await voiceBtn.getAttribute('aria-label').catch(() => '')) || '';
        if (currentVoiceAria.includes(pageInfo.name)) {
          fastSwitched = true;
        } else {
          await voiceBtn.click({ force: true }).catch(() => {});
          await tab.waitForTimeout(350);

          let pageOpt = tab.locator(
            `[role="dialog"] [aria-label*="${pageInfo.name}"], [role="menu"] [aria-label*="${pageInfo.name}"], div[role="dialog"] div:has-text("${pageInfo.name}"), [role="menu"] div:has-text("${pageInfo.name}")`
          ).last();

          if ((await pageOpt.count().catch(() => 0)) > 0 && (await pageOpt.isVisible().catch(() => false))) {
            await pageOpt.click({ force: true }).catch(() => {});
            await tab.waitForTimeout(600);
            fastSwitched = true;
            console.log(`[FB-Buff]${workerTag} ⚡ [FAST-SWITCH] Đã đổi sang Page "${pageInfo.name}" ngay trên bài viết! (Chỉ tốn ~0.8s)`);
          } else {
            const searchBox = tab.locator(
              'div[role="dialog"] input[type="search"], div[role="dialog"] input[type="text"], [role="menu"] input, div[role="dialog"] [role="searchbox"]'
            ).first();

            if ((await searchBox.count().catch(() => 0)) > 0 && (await searchBox.isVisible().catch(() => false))) {
              await searchBox.click({ force: true }).catch(() => {});
              await searchBox.fill(pageInfo.name).catch(() => {});
              await tab.waitForTimeout(300);

              const filteredOpt = tab.locator(
                `[role="dialog"] [aria-label*="${pageInfo.name}"], [role="menu"] [aria-label*="${pageInfo.name}"], div[role="dialog"] div:has-text("${pageInfo.name}")`
              ).last();

              if ((await filteredOpt.count().catch(() => 0)) > 0 && (await filteredOpt.isVisible().catch(() => false))) {
                await filteredOpt.click({ force: true }).catch(() => {});
                await tab.waitForTimeout(600);
                fastSwitched = true;
                console.log(`[FB-Buff]${workerTag} ⚡ [FAST-SWITCH SEARCH] Đã lọc và đổi sang Page "${pageInfo.name}" trong kho BM!`);
              }
            }

            if (!fastSwitched) {
              await tab.evaluate(() => {
                const scrollable = document.querySelector('div[role="dialog"] [role="list"], div[role="dialog"] div[style*="overflow"]');
                if (scrollable) scrollable.scrollBy(0, 500);
              }).catch(() => {});
              await tab.waitForTimeout(250);

              const retryOpt = tab.locator(
                `[role="dialog"] [aria-label*="${pageInfo.name}"], [role="menu"] [aria-label*="${pageInfo.name}"]`
              ).last();

              if ((await retryOpt.count().catch(() => 0)) > 0 && (await retryOpt.isVisible().catch(() => false))) {
                await retryOpt.click({ force: true }).catch(() => {});
                await tab.waitForTimeout(600);
                fastSwitched = true;
                console.log(`[FB-Buff]${workerTag} ⚡ [FAST-SWITCH SCROLL] Đã cuộn tìm và đổi sang Page "${pageInfo.name}"!`);
              } else {
                await tab.keyboard.press('Escape').catch(() => {});
              }
            }
          }
        }
      }
    }

    if (!fastSwitched) {
      await switchTabIdentity(tab, context, pageInfo, uid, workerTag);

      // Đợi Facebook tải xong trạng thái chuyển đổi danh tính
      await tab.waitForLoadState('domcontentloaded').catch(() => {});
      await tab.waitForTimeout(600);

      // Chắc chắn phải mở và đưa tab về URL bài viết mục tiêu dưới danh tính mới
      let targetNavOk = false;
      for (let navAttempt = 0; navAttempt < 3; navAttempt++) {
        try {
          console.log(`[FB-Buff]${workerTag} 🌐 Đang mở bài viết mục tiêu: ${targetUrl}...`);
          await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await tab.waitForTimeout(1500);
          targetNavOk = true;
          break;
        } catch (navErr) {
          console.warn(`[FB-Buff]${workerTag} ⚠️ Thử lại mở bài viết mục tiêu (lần ${navAttempt + 1}/3): ${navErr.message}`);
          await tab.waitForTimeout(1200);
        }
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

    // BƯỚC 2: HÀNH VI LƯỚT XEM TỰ NHIÊN (TỐI ƯU NHANH GỌN)
    if (enableHumanBehavior) {
      await tab.evaluate(() => {
        window.scrollBy({ top: 80 + Math.floor(Math.random() * 120), behavior: 'smooth' });
      }).catch(() => {});
      await tab.waitForTimeout(250 + Math.floor(Math.random() * 250));
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
          await acceptCookie.click({ force: true }).catch(() => {});
        }
      }

      // 2. Chờ phần tử nút Like xuất hiện (đợi Facebook vượt qua Splash Screen & mount React DOM)
      let likeBtn = await findLikeButtonOnTab(tab);
      if (!likeBtn) {
        const waitDeadline = Date.now() + 7500;
        let scrolled = false;
        while (!likeBtn && Date.now() < waitDeadline) {
          if (!scrolled) {
            await tab.evaluate(() => {
              const dlg = document.querySelector('div[role="dialog"]');
              if (dlg) dlg.scrollBy({ top: 350, behavior: 'smooth' });
              else window.scrollBy({ top: 350, behavior: 'smooth' });
            }).catch(() => {});
            scrolled = true;
          }

          await tab.waitForTimeout(500);
          likeBtn = await findLikeButtonOnTab(tab);
        }
      }

      if (likeBtn) {
        const currentAria = (await likeBtn.getAttribute('aria-label')) || '';
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
            const verified = await verifyReacted(likeHandle, currentAria, () => findLikeButtonOnTab(tab), 2600);
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

            await likeBtn.scrollIntoViewIfNeeded().catch(() => {});
            await likeBtn.hover({ timeout: 1200 }).catch(async () => {
              const box = await likeBtn.boundingBox().catch(() => null);
              if (box) await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 }).catch(() => {});
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
              await rBtn.hover({ timeout: 800 }).catch(() => {});
              await rBtn.click({ timeout: 1500 }).catch(() => dispatchSyntheticClick(rBtn));
            } else {
              console.log(`[FB-Buff]${workerTag} ℹ️ Không mở được thanh cảm xúc cho Page "${pageInfo.name}", chuyển sang thả LIKE.`);
              currentReaction = 'LIKE';
              await dispatchSyntheticClick(likeBtn);
            }
            const verified = await verifyReacted(likeHandle, currentAria, () => findLikeButtonOnTab(tab), 2600);
            likeStatus = verified ? 'SUCCESS' : 'UNVERIFIED';
            console.log(`[FB-Buff]${workerTag} ${verified ? '✅' : '❔'} Page "${pageInfo.name}" thả ${currentReaction} ${verified ? 'đã xác nhận' : 'chưa xác nhận được trạng thái nút'}.`);
          }

          if (await checkActionBlockedOnTab(tab)) {
            console.warn(`[FB-Buff]${workerTag} ⚠️ Facebook cảnh báo chặn hành động sau khi like bằng Page "${pageInfo.name}".`);
            likeStatus = 'ERROR';
            likeError = 'Facebook tạm thời hạn chế hành động (Action Blocked)';
          }
        }
      } else {
        const currentUrl = tab.url();
        console.warn(`[FB-Buff]${workerTag} ⚠️ Không tìm thấy nút Like cho "${pageInfo.name}" (URL: ${currentUrl})`);

        // Lưu ảnh màn hình debug
        try {
          const debugDir = path.join(__dirname, 'data', 'debug_screens');
          if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
          const imgPath = path.join(debugDir, `no_like_${pageInfo.id}.png`);
          await tab.screenshot({ path: imgPath, fullPage: false }).catch(() => {});
        } catch (e) {}

        const isGroup = currentUrl.includes('/groups/');
        const joinGroupBtn = tab.locator('div[role="button"]:has-text("Tham gia nhóm"), div[role="button"]:has-text("Join group")').first();
        const needsJoin = (await joinGroupBtn.count().catch(() => 0)) > 0;

        likeStatus = 'NO_BUTTON';
        likeError = needsJoin
          ? 'Nhóm yêu cầu tham gia (Chưa vào nhóm nên ẩn nút Like)'
          : isGroup
          ? 'Bài viết trong Nhóm kín hoặc chưa tải kịp nút Like'
          : 'Không tìm thấy nút Like trên bài viết';
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
            await writeBtn.click({ force: true }).catch(() => {});
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
          }).catch(() => {});
          await tab.waitForTimeout(200);

          await commentBox.evaluate((el) => {
            el.focus();
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }).catch(() => {});
          await tab.waitForTimeout(200);
          await commentBox.click().catch(() => {});
          await tab.waitForTimeout(250);

          for (const char of usedCommentText) {
            await tab.keyboard.type(char, { delay: Math.floor(Math.random() * 20) + 12 });
            if (char === ' ' && Math.random() < 0.15) {
              await tab.waitForTimeout(Math.floor(Math.random() * 60) + 30);
            }
          }

          await tab.waitForTimeout(400 + Math.floor(Math.random() * 300));
          await tab.keyboard.press('Enter');
          await tab.waitForTimeout(900 + Math.floor(Math.random() * 400));
          commentStatus = 'SUCCESS';
          console.log(`[FB-Buff]${workerTag} 💬 Page "${pageInfo.name}" đã bình luận tự nhiên: "${usedCommentText}"`);
        } else {
          commentStatus = 'FAILED';
          commentError = 'Không tìm thấy ô nhập bình luận';
          console.warn(`[FB-Buff]${workerTag} ⚠️ Không tìm thấy ô bình luận cho Page "${pageInfo.name}"`);
        }
      }
    }

    // BƯỚC 6: TỔNG HỢP KẾT QUẢ CHO PAGE NÀY
    const likeOk = !enableLike || likeStatus === 'SUCCESS';
    const cmtOk = !enableComment || commentStatus === 'SUCCESS';
    const isAlready = enableLike && !enableComment && likeStatus === 'ALREADY_LIKED';

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
    if (enableLike && likeStatus === 'UNVERIFIED') {
      msgs[0] = `Đã bấm ${currentReaction} nhưng chưa xác nhận được`;
    }

    if (isAlready) finalStatus = 'ALREADY_LIKED';
    else if (likeStatus === 'UNVERIFIED' && !(enableComment && commentStatus === 'SUCCESS')) finalStatus = 'UNVERIFIED';
    else if (likeOk && cmtOk) finalStatus = 'SUCCESS';
    else if ((enableLike && likeStatus === 'SUCCESS') || (enableComment && commentStatus === 'SUCCESS')) finalStatus = 'SUCCESS';
    else finalStatus = 'ERROR';

    if (finalStatus === 'SUCCESS' || finalStatus === 'ALREADY_LIKED' || finalStatus === 'UNVERIFIED') {
      recordPageAction(pageInfo.id);
      recordPagePostInteraction(normalizedPostUrl, pageInfo.id, {
        reactionType: currentReaction,
        commentText: usedCommentText,
        status: finalStatus,
        pageName: pageInfo.name,
      });
    }

    return {
      actionBlocked: false,
      item: {
        pageId: pageInfo.id,
        pageName: pageInfo.name,
        status: finalStatus,
        likeStatus,
        commentStatus,
        commentText: commentStatus === 'SUCCESS' ? usedCommentText : undefined,
        message: msgs.join(' • '),
        error: finalStatus === 'ERROR' ? msgs.join(' • ') : undefined,
      },
    };
  } catch (err) {
    console.error(`[FB-Buff]${workerTag} ❌ Lỗi khi Page "${pageInfo.name}" tương tác: ${err.message}`);
    return {
      actionBlocked: false,
      item: {
        pageId: pageInfo.id,
        pageName: pageInfo.name,
        status: 'ERROR',
        likeStatus: enableLike ? 'ERROR' : 'SKIPPED',
        commentStatus: enableComment ? 'ERROR' : 'SKIPPED',
        error: err.message,
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
    delayMs = 3800,        // Độ trễ giữa mỗi lần tương tác
    speedMode = 'NORMAL',  // 'TURBO' (siêu tốc ~1.5s) | 'FAST' (nhanh ~2.5s) | 'NORMAL' (chuẩn ~3.8s) | 'SAFE' (an toàn ~6s)
    enableLike = true,     // Có thả Like/Reaction không (mặc định true)
    enableComment = false, // Có viết bình luận bằng Fanpage không (mặc định false)
    enableHumanBehavior = true, // Hành vi lướt tự nhiên chống checkpoint (mặc định true)
    fastSwitch = true,     // Ưu tiên đổi danh tính trực tiếp trên bài viết bằng Voice Switcher (tiết kiệm 15s/lần)
    cooldownEvery = 12,    // Cứ mỗi 10-15 page nghỉ an toàn chống checkpoint
    cooldownDurationMs = 25000, // Thời gian nghỉ ngơi an toàn mỗi lô
    comments = [],         // Mảng danh sách nội dung bình luận
    proxyUrl = '',         // URL Proxy riêng biệt cho Via (http://user:pass@host:port)
    proxyPool = [],        // Danh sách Proxy Pool định tuyến cho từng luồng Worker
    maxActionsPerPageToday = getDailyPageActionLimit(), // Giới hạn lượt tương tác/ngày cho mỗi Page (Cài đặt hệ thống)
    concurrency = 1,       // Số luồng worker song song (1 - 4 luồng)
    dripFeedMode = false,  // Chế độ rải đều lượt like theo thời gian chống thuật toán quét
    dripDurationMinutes = 30, // Thời gian rải đều (phút)
    onProgress,            // Callback nhận tiến trình: onProgress(event)
    shouldStop,            // () => boolean: người gọi yêu cầu dừng (client ngắt kết nối, dừng khẩn cấp...)
  } = options;
  const isStopRequested = () => isEmergencyStopped() || (typeof shouldStop === 'function' && shouldStop());

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

  // TÍNH TOÁN CẤU HÌNH ĐA LUỒNG (MULTI-WORKER CONCURRENCY)
  const targetConcurrency = Math.max(1, Math.min(4, parseInt(concurrency, 10) || 1));
  const isMultiWorker = targetConcurrency > 1 && pages.length >= targetConcurrency;
  const actualConcurrency = isMultiWorker ? targetConcurrency : 1;

  console.log(`[FB-Buff] 🚀 Bắt đầu Buff Tương Tác: ${targetUrl}`);
  console.log(`[FB-Buff] 🎯 Mục tiêu: ${pages.length} Fanpage | Chế độ tốc độ: ${speedMode} (${delayMs}ms) | Thả Like: ${enableLike ? reactionType : 'TẮT'} | Bình luận: ${enableComment ? 'BẬT' : 'TẮT'} | Số luồng: ${actualConcurrency} luồng | Fast-Switch: ${fastSwitch ? 'BẬT' : 'TẮT'}`);

  const results = {
    total: pages.length + cappedDetails.length,
    success: 0,
    failed: 0,
    unverified: 0,
    skipped: cappedDetails.length,
    stopped: false,
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

      try {
        await applyFingerprintToContext(workerContext, device);
        await applyResourceOptimization(workerContext, false, true);
        if (cookies.length > 0) {
          await workerContext.addCookies(cookies);
        }
        const workerTab = await workerContext.newPage();
        await workerTab.route('**/*.{png,jpg,jpeg,webp,gif,avif,ico,mp4,mov,m4v,avi,webm,m3u8,ts}', (route) => route.abort());
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

        for (let i = 0; i < workerPages.length; i++) {
          if (isStopRequested() || globalStopTriggered) {
            results.stopped = true;
            console.warn(`[FB-Buff]${workerTag} 🛑 Dừng luồng tại page ${i + 1}/${workerPages.length}`);
            break;
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

          const { actionBlocked, item: resultItem } = await executePageInteraction({
            tab: workerTab,
            context: workerContext,
            pageInfo,
            uid,
            targetUrl: workerTargetUrl,
            normalizedPostUrl,
            enableLike,
            enableComment,
            enableHumanBehavior,
            fastSwitch,
            reactionType,
            comments,
            usedCommentsHistory,
            pageIndex: originalIndex,
            workerTag,
          });

          if (actionBlocked) {
            globalStopTriggered = true;
            results.stopped = true;
            results.failed++;
            results.details.push(resultItem);
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
            break;
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

          // Chống checkpoint: Nghỉ ngơi an toàn theo lô (Batch Cooldown) per worker
          if (cooldownEvery < 9999 && i > 0 && i % cooldownEvery === 0 && i < workerPages.length - 1 && speedMode !== 'TURBO') {
            const isBigBatch = i % 36 === 0;
            const batchRest = isBigBatch
              ? Math.max(12000, cooldownDurationMs * 2) + Math.floor(Math.random() * 4000)
              : Math.max(2500, cooldownDurationMs) + Math.floor(Math.random() * 1500);
            console.log(`[FB-Buff]${workerTag} 🛡️ [ANTI-CHECKPOINT BM] Đã chạy xong ${i} Page. Nghỉ ngơi ${(batchRest / 1000).toFixed(1)}s...`);
            await new Promise((r) => setTimeout(r, batchRest));
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
            await new Promise((r) => setTimeout(r, waitTime));
          }
        }
      } finally {
        if (workerContext) await workerContext.close().catch(() => {});
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
      const tab = context.pages().length ? context.pages()[0] : await context.newPage();
      await tab.route('**/*.{png,jpg,jpeg,webp,gif,avif,ico,mp4,mov,m4v,avi,webm,m3u8,ts}', (route) => route.abort());
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

      for (let i = 0; i < pages.length; i++) {
        if (isStopRequested()) {
          results.stopped = true;
          console.warn(`[FB-Buff] 🛑 Phát hiện lệnh DỪNG KHẨN CẤP! Dừng vòng lặp tại page ${i + 1}/${pages.length}`);
          break;
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

        const { actionBlocked, item: resultItem } = await executePageInteraction({
          tab,
          context,
          pageInfo,
          uid,
          targetUrl: effectiveTargetUrl,
          normalizedPostUrl,
          enableLike,
          enableComment,
          enableHumanBehavior,
          fastSwitch,
          reactionType,
          comments,
          usedCommentsHistory,
          pageIndex: i,
          workerTag: '',
        });

        if (actionBlocked) {
          results.stopped = true;
          results.failed++;
          results.details.push(resultItem);
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
          break;
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

        // Chống checkpoint: Nghỉ ngơi an toàn theo lô (Batch Cooldown)
        if (cooldownEvery < 9999 && i > 0 && i % cooldownEvery === 0 && i < pages.length - 1 && speedMode !== 'TURBO') {
          const isBigBatch = i % 36 === 0;
          const batchRest = isBigBatch
            ? Math.max(12000, cooldownDurationMs * 2) + Math.floor(Math.random() * 4000)
            : Math.max(2500, cooldownDurationMs) + Math.floor(Math.random() * 1500);
          console.log(`[FB-Buff] 🛡️ [ANTI-CHECKPOINT BM] Đã chạy xong ${i} Page. Nghỉ ngơi ${(batchRest / 1000).toFixed(1)}s hạ nhiệt Via & BM...`);
          await new Promise((r) => setTimeout(r, batchRest));
        }

        // Độ trễ tối ưu giữa các page
        if (i < pages.length - 1) {
          const waitTime = calculatePageDelay(delayMs, enableComment, dripFeedMode, dripDurationMinutes, pages.length, 1, speedMode);
          await new Promise((r) => setTimeout(r, waitTime));
        }
      }
    } finally {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }

  console.log(`[FB-Buff] 🏁 Hoàn thành buff Like: Thành công ${results.success}/${results.total} (Luồng: ${actualConcurrency})`);
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
              v.play().catch(() => {});
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
          if (context) await context.close().catch(() => {});
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
    await browser.close().catch(() => {});
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
      await page.evaluate(() => window.scrollBy({ top: 900, behavior: 'smooth' })).catch(() => {});
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
        await a.hover({ timeout: 1500 }).catch(() => {});
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
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
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

    if (currentUrl.includes('/login') || currentUrl.includes('login_attempt')) {
      console.warn(`[ViaValidator] ❌ Via ${uid} ĐÃ HẾT HẠN COOKIE / BỊ ĐĂNG XUẤT!`);
      return { isLive: false, status: 'EXPIRED', uid, url: currentUrl };
    }

    const title = await page.title().catch(() => '');
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
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
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

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
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
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
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
  resolveSpintax,
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
