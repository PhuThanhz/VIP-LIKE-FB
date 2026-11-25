/**
 * FB BUFF TOOL - HIDDEN LIKE BUFF VIA FANPAGES & VIDEO/REELS VIEW BUFF
 * Supports:
 * 1. Scanning every Fanpage from a parent account Cookie (Profile Pages / New Page Experience).
 * 2. Like/Reaction buff (LIKE, LOVE, CARE, HAHA, WOW, SAD, ANGRY) on posts as a Fanpage identity (hidden Like).
 * 3. Multi-threaded Video/Reels view buff (headless Playwright, RAM/bandwidth optimized).
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
  registerPostUrlAlias,
  isValidCanonicalFbPostUrl,
  resolvePostUrlCanonical,
  flushRegistry,
} = require('./page-post-registry');
const { isEmergencyStopped, loadSettings } = require('./telegram-alert');
const store = require('./state-store');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Speed and RAM optimization flags for Playwright Chromium
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
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--js-flags=--max-old-space-size=768',
  '--renderer-process-limit=4',
  '--password-store=basic',
  '--use-mock-keychain',
  '--disk-cache-size=33554432',
  '--media-cache-size=16777216',
];

// Block heavy video, unnecessary images & 3rd-party ad trackers to save RAM/bandwidth
// Keep Facebook's internal telemetry (/ajax/bz, logging_client_events, browser_measurement) so Meta doesn't flag the client as abnormal
async function applyResourceOptimization(context, allowMedia = false, blockImages = true) {
  try {
    await context.route('**/*', (route) => {
      const req = route.request();
      const rType = req.resourceType();
      const url = req.url();

      // Only block 3rd-party ad trackers; keep Facebook's internal telemetry
      if (
        url.includes('googletagmanager.com') ||
        url.includes('doubleclick.net')
      ) {
        return route.abort();
      }

      // When only Like/Comment is needed, block mp4/m3u8 video streams to save bandwidth
      if (!allowMedia && (rType === 'media' || url.endsWith('.mp4') || url.endsWith('.m3u8') || url.endsWith('.webm'))) {
        return route.abort();
      }

      // Block images and web fonts during engagement buffs to save RAM, CPU and DOM load time
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
    // ignore errors if the context is already closed
  }
}

// ==========================================
// 1. COOKIE & PARSING UTILITIES
// ==========================================


function parseCookieString(cookieStr, domain = '.facebook.com') {
  if (!cookieStr) return [];
  if (Array.isArray(cookieStr)) return cookieStr;
  let str = String(cookieStr).trim();
  str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. JSON format (Cookie-Editor, J2Team, cookie arrays)
  if ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
    try {
      const parsed = JSON.parse(str);
      let list = [];
      if (Array.isArray(parsed)) list = parsed;
      else if (parsed && Array.isArray(parsed.cookies)) list = parsed.cookies;
      else if (parsed && typeof parsed === 'object') {
        list = Object.entries(parsed).map(([name, value]) => ({ name, value: String(value) }));
      }
      if (list.length > 0) {
        return list
          .map((c) => {
            let sameSite = 'Lax';
            if (c.sameSite === 'no_restriction' || c.sameSite === 'None' || c.sameSite === 'none') sameSite = 'None';
            else if (c.sameSite === 'strict' || c.sameSite === 'Strict') sameSite = 'Strict';
            return {
              name: String(c.name).trim(),
              value: c.value != null ? String(c.value).trim() : '',
              domain: c.domain || domain,
              path: c.path || '/',
              httpOnly: Boolean(c.httpOnly || c.name === 'xs' || c.name === 'sb'),
              secure: c.secure !== undefined ? Boolean(c.secure) : true,
              sameSite: sameSite,
              ...(c.expirationDate ? { expires: Math.floor(c.expirationDate) } : {}),
            };
          })
          .filter((c) => c.name && c.value);
      }
    } catch (_) {}
  }

  // 2. Regular cookie string format
  const parts = str.split(';');
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
  if (!cookieStr) return null;
  const str = String(cookieStr);
  const match = str.match(/(?:^|;\s*)c_user=([0-9]+)/);
  if (match) return match[1];

  // Look inside the JSON
  const jsonMatch =
    str.match(/"name"\s*:\s*"c_user"\s*,\s*"value"\s*:\s*"([0-9]+)"/) ||
    str.match(/"c_user"\s*:\s*"?([0-9]+)"?/);
  if (jsonMatch) return jsonMatch[1];

  return null;
}

// ==========================================
// 1b. FANPAGE CACHE MANAGEMENT (PAGES CACHE)
// ==========================================

const { DATA_DIR: dataDir, PROFILES_DIR } = require('./paths');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
// Cache expiry so newly assigned pages (e.g. pages in a BM) show up on the next scan
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
    const quarantined = entry.quarantined && typeof entry.quarantined === 'object' ? entry.quarantined : {};
    const valid = entry.pages.filter((p) => p && p.id && !quarantined[String(p.id)]);
    // Put Pages that have switched identity successfully before (verified) first
    return valid.sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0));
  }
  return null;
}

function setCachedPages(uid, pages, viaName = '', options = {}) {
  if (!uid || !Array.isArray(pages)) return;
  const { replaceExisting = false } = options || {};
  const cache = loadPagesCache();
  const prevEntry = cache[uid] && typeof cache[uid] === 'object' ? cache[uid] : {};
  const quarantined = { ...(prevEntry.quarantined || {}) };
  const switchFailures = { ...(prevEntry.switchFailures || {}) };
  const prevPagesList = Array.isArray(prevEntry.pages) ? prevEntry.pages : [];
  const prevVerifiedIds = new Set(
    prevPagesList
      .filter((p) => p && p.id && p.verified)
      .map((p) => String(p.id))
  );

  const normalizedPages = [];
  const seenIds = new Set();
  for (const raw of pages) {
    if (!raw || !raw.id) continue;
    const pid = String(raw.id);
    if (seenIds.has(pid)) continue;
    // If the Switcher list directly shows this Page, lift the quarantine; other sources keep the old quarantine
    if (quarantined[pid]) {
      if (raw.source === 'SWITCHER') {
        delete quarantined[pid];
        delete switchFailures[pid];
      } else {
        continue;
      }
    }
    seenIds.add(pid);
    normalizedPages.push({
      ...raw,
      id: pid,
      verified: Boolean(raw.verified || raw.source === 'SWITCHER' || prevVerifiedIds.has(pid)),
    });
  }

  // Guard against data loss when Facebook returns an incomplete scan (partial scan):
  // if the new list is much smaller than the old cache, keep the old non-quarantined Pages
  if (!replaceExisting && prevPagesList.length > normalizedPages.length * 2 && normalizedPages.length > 0) {
    for (const prev of prevPagesList) {
      if (!prev || !prev.id) continue;
      const pid = String(prev.id);
      if (seenIds.has(pid) || quarantined[pid]) continue;
      seenIds.add(pid);
      normalizedPages.push({ ...prev, id: pid });
    }
  }

  cache[uid] = {
    uid,
    viaName: viaName || prevEntry.viaName || `Via_${uid}`,
    updatedAt: new Date().toISOString(),
    count: normalizedPages.length,
    pages: normalizedPages,
    quarantined,
    switchFailures,
  };
  savePagesCache(cache);

  // Sync directly into the facebook_page_accesses table in MySQL
  try {
    const db = require('./db');
    db.saveFacebookPageAccesses(normalizedPages, uid, viaName).catch((e) => {
      console.warn(`[FB-Buff] ⚠️ Could not sync pages into MySQL facebook_page_accesses: ${e.message}`);
    });
  } catch (_) { }
}

/**
 * Records the result of switching to a Fanpage identity on each Via:
 * - Success: clear the failure counter, mark verified = true.
 * - Repeated identity-switch failures (or wrong Via): automatically quarantine from pages_cache & facebook_page_accesses.
 */
function recordPageSwitchOutcome(uid, pageId, success, errorCode = '') {
  if (!uid || !pageId || String(pageId) === String(uid)) return { quarantined: false };
  const uidKey = String(uid);
  const pidKey = String(pageId);

  const cache = loadPagesCache();
  const entry = cache[uidKey];
  if (!entry || !Array.isArray(entry.pages)) return { quarantined: false };

  entry.quarantined = entry.quarantined && typeof entry.quarantined === 'object' ? entry.quarantined : {};
  entry.switchFailures = entry.switchFailures && typeof entry.switchFailures === 'object' ? entry.switchFailures : {};
  const targetIdx = entry.pages.findIndex((p) => p && String(p.id) === pidKey);
  const targetPage = targetIdx !== -1 ? entry.pages[targetIdx] : null;

  if (success) {
    const hadFail = Boolean(entry.switchFailures[pidKey] || entry.quarantined[pidKey]);
    const wasUnverified = targetPage && !targetPage.verified;
    delete entry.switchFailures[pidKey];
    delete entry.quarantined[pidKey];
    if (targetPage) targetPage.verified = true;
    if (hadFail || wasUnverified) {
      savePagesCache(cache);
      try {
        const db = require('./db');
        db.markFacebookPageAccessesStatus(
          [{ personalProfileId: uidKey, pageId: pidKey }],
          'VERIFIED',
          1,
          'Identity switch verified successfully'
        ).catch(() => {});
      } catch (_) {}
    }
    return { quarantined: false };
  }

  const isWrongVia = errorCode === 'WRONG_VIA';
  const prevFails = Number(entry.switchFailures[pidKey] || 0);
  const nextFails = prevFails + 1;
  const threshold = isWrongVia ? 1 : (targetPage?.verified ? 3 : 2);

  if (nextFails >= threshold) {
    const reason = isWrongVia
      ? 'Page is managed by a different Via'
      : `Could not switch to the Fanpage identity ${nextFails} times in a row`;
    entry.quarantined[pidKey] = {
      name: targetPage?.name || pidKey,
      quarantinedAt: new Date().toISOString(),
      reason,
      failCount: nextFails,
    };
    delete entry.switchFailures[pidKey];
    if (targetIdx !== -1) {
      entry.pages.splice(targetIdx, 1);
      entry.count = entry.pages.length;
    }
    savePagesCache(cache);
    console.warn(`[FB-Buff] 🧹 Automatically quarantined Page "${targetPage?.name || pidKey}" (${pidKey}) from Via ${uidKey}: ${reason}`);
    try {
      const db = require('./db');
      db.markFacebookPageAccessesStatus(
        [{ personalProfileId: uidKey, pageId: pidKey }],
        'UNSWITCHABLE',
        0,
        reason
      ).catch(() => {});
    } catch (_) {}
    return { quarantined: true, reason };
  }

  entry.switchFailures[pidKey] = nextFails;
  savePagesCache(cache);
  return { quarantined: false, failCount: nextFails };
}

// ==========================================
// 1c. PAGE FATIGUE GOVERNOR & PROXY PARSER
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
 * Checks Proxy connectivity and latency via a Playwright request context
 */
async function testProxy(proxyStr, timeoutMs = 8000) {
  const parsed = parseProxy(proxyStr);
  if (!parsed) {
    return {
      success: false,
      error: 'Invalid Proxy format. Supported: ip:port or ip:port:user:pass or http(s)/socks5://user:pass@ip:port',
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
        error: `Proxy returned HTTP error code ${res.status()}`,
        latencyMs,
      };
    }
  } catch (err) {
    const cleanError = (err.message || '').split('\n')[0].replace(/^apiRequestContext\.\w+:\s*/, '');
    return {
      success: false,
      error: `Proxy connection failed: ${cleanError}`,
      latencyMs: Date.now() - startTime,
    };
  } finally {
    if (reqContext) {
      await reqContext.dispose().catch(() => { });
    }
  }
}

/**
 * Quick Proxy health check
 */
async function testProxyHealth(proxyStr, timeoutMs = 4000) {
  if (!proxyStr || typeof proxyStr !== 'string' || !proxyStr.trim()) {
    return { live: false, error: 'Empty proxy' };
  }
  const trimmed = proxyStr.trim();
  const parsed = parseProxy(trimmed);
  if (!parsed) {
    return { live: false, error: 'Invalid Proxy format' };
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
 * Filters and checks the Proxy Pool, returning the live Proxies
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

// Date in Vietnam time (YYYY-MM-DD) so limits reset at midnight, not at 7am (UTC)
function usageDateKey() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function recordPageAction(pageId) {
  if (!pageId) return;
  const today = usageDateKey();
  let usage = loadPageUsage();
  if (!usage[today]) {
    // Keep only the last 7 days
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
// 2. SCAN THE FANPAGE LIST FROM THE PARENT ACCOUNT COOKIE
// ==========================================

// Scan the "Your profiles and Pages" panel (account menu → See all profiles → See more Pages...).
// IDs come from the GraphQL response when clicking "See more Pages"; pages with only a name (usually a vanity URL)
// get their ID looked up via the link on your_pages.
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

  // Each card's link on your_pages (to look up vanity pages), collected before leaving the page
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
      // Notification preview lines (e.g. "Chưa đọcNguyễn Phi Văn đã theo dõi bạn.") are not Page names
      const notificationLike = /^(?:Chưa đọc|Unread)|(?:^|\s)đã (?:theo dõi|thích|bình luận|nhắc|gửi|chia sẻ|phản hồi|mời)(?:\s|$)|\b(?:followed|liked|commented|mentioned|shared|replied|invited)\b/;
      const set = new Set();
      dlg.querySelectorAll('[role="listitem"], [role="radio"], [role="button"], a').forEach((e) => {
        // Take the first line that is actually a name (skip unread notification lines above it)
        const lines = (e.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
        for (const raw of lines) {
          const t = cleanName(raw);
          if (!t || notificationLike.test(raw) || notificationLike.test(t)) continue;
          if (t.length > 1 && t.length < 80 && !noise.test(t)) set.add(t);
          break;
        }
      });
      return [...set];
    });
    await page.keyboard.press('Escape').catch(() => { });

    const results = [];
    for (const name of names) {
      let id = idByName.get(name) || '';
      let url = id ? `https://www.facebook.com/profile.php?id=${id}` : cardLinks[name] || '';
      if (!id && url) {
        // Vanity page: the ID is in "userID" in the page's wall HTML
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
 * Scans the Fanpage list from Meta Accounts Centre ("Pages you manage / See all Pages")
 * Supports accounts on the new UI that show 90+ Fanpages
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

    // Find and click "See all Pages" (or the Vietnamese equivalent)
    const seeAllBtn = page.getByText(/^(Xem tất cả trang|See all Pages|See all pages)/i).first();
    if (await seeAllBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await seeAllBtn.click().catch(() => { });
      await page.waitForTimeout(2000);
    }

    // Scroll to trigger loading every page
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
    console.warn(`[FB-Buff] ⚠️ Error in scanAccountsCenterPages: ${err.message}`);
    return Array.from(pages.values());
  } finally {
    page.off('response', onResponse);
  }
}

/**
 * Scans every Fanpage the account owns/manages (with Cache support)
 * @param {string} cookieStr - Cookie string of the parent Facebook account
 * @param {object} options - { forceRefresh: boolean, viaName: string, proxyUrl: string }
 * @returns {Promise<Array<{ id: string, name: string, url: string }>>}
 */
/**
 * Merges Fanpages from pages_cache and the MySQL facebook_page_accesses table (excluding quarantined pages).
 */
async function mergeCachedAndDbPages(uid, viaName = '') {
  const uidKey = String(uid || '');
  const isJunkPageName = (name) => {
    const s = String(name || '').trim();
    return /^(?:chưa đọc|unread)\b/i.test(s) || /đã theo dõi bạn|started following you|đã nhắc đến bạn/i.test(s);
  };
  let cached = uidKey ? (getCachedPages(uidKey) || []) : [];
  const beforeJunkLen = cached.length;
  cached = cached.filter((p) => !isJunkPageName(p?.name || p?.pageName));
  if (!uidKey) return cached;
  try {
    const db = require('./db');
    const dbPages = await db.getFacebookPageAccesses(1, uidKey);
    if (dbPages && dbPages.length > 0) {
      const cacheEntry = loadPagesCache()[uidKey] || {};
      const quarantined = cacheEntry.quarantined && typeof cacheEntry.quarantined === 'object' ? cacheEntry.quarantined : {};
      const mergedMap = new Map(cached.map((p) => [String(p.id), p]));
      let addedFromDb = 0;
      for (const p of dbPages) {
        const pid = String(p.id);
        const pName = p.name || p.pageName || `Page ${pid}`;
        if (mergedMap.has(pid) || quarantined[pid] || isJunkPageName(pName)) continue;
        mergedMap.set(pid, {
          id: pid,
          name: pName,
          url: p.url || `https://www.facebook.com/${pid}`,
          verified: p.verificationStatus === 'VERIFIED',
        });
        addedFromDb++;
      }
      if (addedFromDb > 0 || cached.length !== beforeJunkLen) {
        cached = Array.from(mergedMap.values()).sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0));
        setCachedPages(uidKey, cached, viaName, true);
      }
    } else if (cached.length !== beforeJunkLen) {
      setCachedPages(uidKey, cached, viaName, true);
    }
  } catch (_) {}
  return cached;
}

async function getManagedPages(cookieStr, options = {}) {
  const { forceRefresh = false, viaName = '', proxyUrl = '' } = options;
  const cookies = parseCookieString(cookieStr);
  if (!cookies.length) {
    throw new Error('Cookie is empty or in the wrong format');
  }

  const uid = getUserIdFromCookie(cookieStr);
  if (!forceRefresh && uid) {
    const cached = await mergeCachedAndDbPages(uid, viaName);
    if (cached && cached.length > 0) {
      console.log(`[FB-Buff] ⚡ [CACHE HIT] Got ${cached.length} Fanpages from cache/DB for UID: ${uid} (no rescan needed)`);
      return cached;
    }
  }

  const device = getDeviceForUid(uid);
  const proxy = parseProxy(proxyUrl);
  const browser = await chromium.launch({
    headless: true,
    args: OPTIMIZED_CHROMIUM_ARGS,
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
  });

  try {
    const context = await browser.newContext({
      userAgent: device.userAgent,
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
    });
    await applyFingerprintToContext(context, device);
    await applyResourceOptimization(context, false);
    await context.addCookies(cookies);
    const page = await context.newPage();

    console.log('[FB-Buff] 🔄 Opening Facebook to fetch the Fanpage list...');
    await page.goto('https://www.facebook.com/pages/?category=your_pages', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(4000);

    // Check login
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
      throw new Error('Cookie expired or checkpointed');
    }

    // DEEP-SCROLL THE WHOLE FANPAGE LIST (FOR BM ACCOUNTS WITH HUNDREDS OF PAGES)
    console.log('[FB-Buff] 📜 Auto-scrolling to scan hundreds of Fanpages in the BM...');
    let lastFoundCount = 0;
    let staleRounds = 0;
    const maxScrollRounds = 35; // Supports scanning 500+ Fanpages

    for (let round = 0; round < maxScrollRounds; round++) {
      const currentCards = await page.evaluate(() => {
        window.scrollBy(0, 1600);
        return document.querySelectorAll('div[role="article"], a[href*="/profile.php?id="], a[href*="/pages/"]').length;
      });
      await page.waitForTimeout(900);

      if (currentCards === lastFoundCount) {
        staleRounds++;
        if (staleRounds >= 3) {
          // Try scrolling to the very bottom one last time to make sure everything loaded
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1500);
          const finalCards = await page.evaluate(() => document.querySelectorAll('div[role="article"], a[href*="/profile.php?id="], a[href*="/pages/"]').length);
          if (finalCards === lastFoundCount) break;
        }
      } else {
        staleRounds = 0;
        lastFoundCount = currentCards;
        if (round % 5 === 0 && round > 0) {
          console.log(`[FB-Buff] 🔄 BM Fanpage scan progress: ~${currentCards} cards detected...`);
        }
      }
    }

    // Extract the Fanpage list from the web UI accurately
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

      // 1. Scan the parent elements representing each Fanpage card
      const cardContainers = document.querySelectorAll('div[role="article"], div[data-visualcompletion="ignore-dynamic-extra-content"], div[role="listitem"], a[href*="/profile.php?id="]');

      cardContainers.forEach((card) => {
        const link = card.tagName === 'A' ? card : card.querySelector('a[href*="/profile.php?id="], a[href*="/pages/"]');
        if (!link) return;

        const href = link.getAttribute('href') || '';
        const idMatch = href.match(/id=([0-9]{10,})/);
        if (!idMatch) return;
        const pageId = idMatch[1];

        // Find the Fanpage name from heading tags or the main span
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

      // 2. Fallback scan of every link if there aren't enough yet
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
            // If the current name is numeric or too short and the new name is nicer
            const current = pageMap.get(pageId);
            if (noiseRegex.test(current.name) || (current.name.length < cleaned.length && !noiseRegex.test(cleaned))) {
              current.name = cleaned;
            }
          }
        }
      });

      // 3. Final normalization
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

    pageList.forEach((p) => {
      p.source = p.source || 'YOUR_PAGES';
    });

    // Supplement from the "Your profiles and Pages" panel: this is exactly the list of pages the account can switch to,
    // usually more than your_pages (pages assigned in a BM, pages with a vanity URL...)
    try {
      const extra = await scanProfileSwitcherPages(page, uid);
      const byId = new Map(pageList.map((p) => [String(p.id), p]));
      const knownNames = new Set(pageList.map((p) => p.name));
      let added = 0;
      for (const item of extra) {
        const existing = item.id ? byId.get(String(item.id)) : null;
        if (existing) {
          existing.source = 'SWITCHER';
          existing.verified = true;
          continue;
        }
        if (knownNames.has(item.name) && !item.id) continue;
        const tagged = { ...item, source: 'SWITCHER', verified: true };
        byId.set(String(tagged.id), tagged);
        pageList.push(tagged);
        added++;
      }
      console.log(`[FB-Buff] 🔁 Profile switcher panel: ${extra.length} pages, added ${added} more.`);
    } catch (err) {
      console.warn(`[FB-Buff] ⚠️ Could not scan the profile switcher panel: ${err.message}`);
    }

    // Supplement from Meta Accounts Centre ("See all Pages 92 >")
    try {
      const acPages = await scanAccountsCenterPages(page, uid);
      const known = new Set(pageList.map((p) => p.id));
      let addedAc = 0;
      for (const item of acPages) {
        if (known.has(item.id)) continue;
        known.add(item.id);
        pageList.push({ ...item, source: 'ACCOUNTS_CENTRE', verified: false });
        addedAc++;
      }
      console.log(`[FB-Buff] 🏢 Meta Accounts Centre: ${acPages.length} pages, added ${addedAc} more.`);
    } catch (err) {
      console.warn(`[FB-Buff] ⚠️ Could not scan Accounts Centre: ${err.message}`);
    }

    // Move Pages confirmed by the Switcher to the top of the list
    pageList.sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0));

    console.log(`[FB-Buff] ✅ Found and cleaned the names of ${pageList.length} managed Fanpages.`);
    if (uid && pageList.length > 0) {
      setCachedPages(uid, pageList, viaName);
    }
    return pageList;
  } finally {
    await browser.close().catch(() => { });
  }
}

// ==========================================
// 3. HIDDEN LIKE BUFF VIA FANPAGES (PAGE REACTIONS & COMMENTS)
// ==========================================

/**
 * Expands multi-level/nested Spintax {A|B|C} into a random string
 * Example: "{ {Chào|Hello} {bạn|shop} | {Bài viết|Nội dung} {quá hay|rất ý nghĩa} } {ạ!|nha!}"
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
 * Natural suffixes that vary comments so Meta/Admins don't penalize duplicates
 */
const NATURAL_VI_VARIATIONS = [
  ' ạ ❤️', ' nha bạn!', ' nhé 👍', ' quá nè ✨', ' bạn ơi 😊',
  ' quá ạ 🥰', ' luôn nè 🌟', ' nha shop 🍀', ' quá trời 👏', ' nha ạ ✨',
  ' nè bạn ơi!', ' nhé bạn 💖', ' ạ, cảm ơn bạn!', ' nè 🥰', ' nha! 🍀',
];

/**
 * Smart Seeding Presets library
 * Supports multi-level Spintax, grouped by real-world goal: Sales, Viral praise, Discussion
 */
const SEEDING_PRESETS = [
  {
    id: 'sales',
    name: 'Sales & Closing',
    badge: 'Kinh doanh',
    description: 'Creates the effect of customers asking to buy and for prices, encouraging purchases',
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
    name: 'Praise & Viral engagement',
    badge: 'Viral',
    description: 'Boosts natural engagement by praising the post content',
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
    name: 'Discussion & Q&A',
    badge: 'Q&A',
    description: 'Encourages discussion comments to keep viewers around longer',
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
// After reacting with something other than Like, the Like button shows that reaction's name instead of "Thích"
const REACTION_NAME_RE = /^(Yêu thích|Thương thương|Haha|Wow|Buồn|Phẫn nộ|Love|Care|Sad|Angry)$/i;

function isReactedState(state, beforeAria, beforeText = '') {
  if (!state) return false;
  // 1. aria state changed to Unlike, Remove, Liked,... (Gỡ Thích...)
  if (REACTED_ARIA_RE.test(state.aria)) return true;
  // 2. aria or text changed to another reaction name (Haha, Love,...)
  if (REACTION_NAME_RE.test(state.aria) || REACTION_NAME_RE.test(state.text)) return true;
  // 3. aria-pressed became true
  if (state.pressed === 'true') return true;
  // 4. aria differs from the original aria and is no longer plain "Like"
  if (Boolean(state.aria) && state.aria !== beforeAria && !/^(Thích|Like)$/i.test(state.aria)) return true;
  // 5. Pill-style button showing the reaction count (e.g. 3 before the click, 4 or 5 after)
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

// Confirm the Like button switched to the "reacted" state after the click.
// Optimized: fast polling every 50ms, instant feedback within 60-150ms
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
        // If Facebook hasn't updated after 600ms, click once more to make sure the engagement lands
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

// Stops waiting immediately when the AbortSignal fires (Deep Cancellation)
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

// Computes the optimal delay between pages per Safe Human Pacing (anti-spam, anti-checkpoint)
function calculatePageDelay(delayMs, enableComment, dripFeedMode, dripDurationMinutes, totalPages, concurrency, speedMode = 'NORMAL') {
  if (dripFeedMode && dripDurationMinutes > 0) {
    const totalDurationMs = dripDurationMinutes * 60 * 1000;
    const dripBaseWait = Math.max(delayMs || 3000, Math.floor((totalDurationMs / Math.max(1, totalPages)) * concurrency));
    const dripJitter = Math.floor(dripBaseWait * 0.15 * (Math.random() * 2 - 1));
    return Math.max(2000, dripBaseWait + dripJitter);
  }

  let minModeBase = 2000;
  const userFloor = delayMs > 0 ? delayMs : 0;

  if (enableComment) {
    minModeBase = 5000;
  } else if (speedMode === 'TURBO') {
    minModeBase = 1000;
  } else if (speedMode === 'FAST') {
    minModeBase = 1500;
  } else if (speedMode === 'SMART') {
    if (totalPages <= 30) minModeBase = 2200;
    else if (totalPages <= 80) minModeBase = 2600;
    else minModeBase = 3000;
  } else if (speedMode === 'SAFE') {
    minModeBase = 4500;
  } else {
    // NORMAL
    minModeBase = 2000;
  }

  const baseWait = userFloor > 0 ? Math.max(Math.round(minModeBase * 0.7), userFloor) : minModeBase;
  const jitter = Math.floor(baseWait * 0.12 * (Math.random() * 2 - 1));
  return Math.max(Math.round(minModeBase * 0.7), baseWait + jitter);
}

/**
 * Computes the batch cooldown rest time shared by Single & Multi Worker
 */
function computeBatchCooldownMs(cooldownDurationMs, speedMode = 'FAST', isBigBatch = false) {
  let baseCooldown = cooldownDurationMs || 10000;
  if (speedMode === 'TURBO') {
    baseCooldown = Math.max(3000, Math.min(baseCooldown, 6000));
  } else if (speedMode === 'FAST') {
    baseCooldown = Math.max(5000, Math.min(baseCooldown, 8000));
  } else if (speedMode === 'SAFE') {
    baseCooldown = Math.max(20000, baseCooldown);
  } else {
    baseCooldown = Math.max(8000, Math.min(baseCooldown, 12000));
  }
  return isBigBatch
    ? Math.round(baseCooldown * 1.2) + Math.floor(Math.random() * 1000)
    : baseCooldown + Math.floor(Math.random() * 1000);
}

// Ultra-fast Like button finder: scan and mark directly in the in-page DOM (0.5ms) instead of 25 sequential CDP calls
async function findLikeButtonOnTab(tab) {
  try {
    const u = tab.url() || '';
    const isHome = u === 'https://www.facebook.com/' || u === 'https://www.facebook.com' || u.startsWith('https://www.facebook.com/?') || u.includes('facebook.com/home.php');
    if (isHome) {
      console.warn(`[FB-Buff] ⚠️ findLikeButtonOnTab: the tab is on the Facebook home page (${u}), refusing to scan for Like to avoid liking the News Feed by mistake.`);
      return null;
    }

    const found = await tab.evaluate(() => {
      // Clear old marks if any
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
        // Skip if inside the top banner / header
        if (b.closest('div[role="banner"]')) return false;
        // Skip if inside a notifications, messages or settings popup
        if (b.closest('div[aria-label*="Thông báo"], div[role="dialog"][aria-label*="Thông báo"], div[role="dialog"][aria-label*="Trang &"], div[role="dialog"][aria-label*="Cài đặt"], div[role="dialog"][aria-label*="Tin nhắn"]')) return false;

        const aria = (b.getAttribute('aria-label') || '').trim();
        const text = (b.innerText || '').trim();

        // Skip pure reaction-count buttons (e.g. "Thích: 2 người")
        if (/^(?:Thích|Like):\s*\d+/i.test(aria)) return false;

        // Exact match on the Like / Reaction button aria-label (supports Posts, Videos and Reels)
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

        // Match buttons with Facebook's ad attribute
        if (b.querySelector('[data-ad-rendering-role="like_button"]') || b.getAttribute('data-ad-rendering-role') === 'like_button') {
          return true;
        }

        // Exact match on the visible text (excluding overly long text)
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (lines.length > 0 && (lines[0] === 'Thích' || lines[0] === 'Like') && text.length <= 15) {
          return true;
        }

        return false;
      }

      // Priority 1: scan inside the open post Modal Dialog (posts opened via permalink/share sit in a lightbox modal)
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

      // Priority 2: scan inside the post (Feed article / Group post / Pagelet)
      const articles = Array.from(document.querySelectorAll('div[role="article"], div[data-pagelet*="FeedUnit"], div[data-pagelet*="Group"]'));
      for (const a of articles) {
        const btns = Array.from(a.querySelectorAll('div[role="button"]'));
        const match = btns.find(isLegitLikeButton);
        if (match) {
          match.setAttribute('data-viplike-target', 'like');
          return true;
        }
      }

      // Priority 3: scan inside the Reels / Video container (div[role="main"])
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

  // Fallback Playwright Locator safely scoped inside a dialog, article or main (Reels)
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

/**
 * Detects Facebook dialogs or pages warning about blocked actions / suspected automated behavior
 * @returns {Promise<{ blocked: boolean, automatedWarning: boolean, matched?: string, text?: string } | null>}
 */
async function detectActionBlockReason(tab) {
  try {
    if (!tab || tab.isClosed()) return null;
    const curUrl = tab.url() || '';
    if (curUrl.includes('forced_account_switch') || curUrl.includes('/login')) {
      return null;
    }

    const automatedPhrases = [
      'hành vi tự động',
      'automated behavior',
      'suspect automated',
      'we suspect',
      'nghi ngờ có hành vi tự động',
      'xác nhận bạn là người thật',
      'confirm you are human',
      'bạn đang dùng tính năng này quá nhanh',
      'going too fast',
    ];

    const blockedPhrases = [
      ...automatedPhrases,
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
      'hãy thử lại sau',
      'try again later',
    ];

    if (curUrl.includes('/checkpoint')) {
      return {
        blocked: true,
        automatedWarning: true,
        matched: '/checkpoint',
        aria: 'url',
        text: curUrl,
      };
    }

    const checkResult = await tab.evaluate(({ blockedList, automatedList }) => {
      const dialogs = document.querySelectorAll('div[role="dialog"], div[role="alertdialog"], [role="alert"]');
      for (const d of dialogs) {
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
        if (text.includes('quảng cáo') || text.includes('advertising') || text.includes('ad account')) continue;
        if (text.includes('chuyển sang') || text.includes('switch to')) continue;

        if (text.length > 0 && text.length < 700) {
          const matched = blockedList.find((phrase) => text.includes(phrase));
          if (matched) {
            const automatedWarning = automatedList.some((p) => text.includes(p));
            return { blocked: true, automatedWarning, matched, text: text.slice(0, 180), aria };
          }
        }
      }

      // Also check the whole page when Facebook shows a warning screen outside a dialog
      const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
      if (bodyText.length > 0 && bodyText.length < 3000) {
        const autoMatch = automatedList.find((p) => bodyText.includes(p));
        if (autoMatch) {
          return { blocked: true, automatedWarning: true, matched: autoMatch, text: bodyText.slice(0, 180), aria: 'body' };
        }
      }
      return null;
    }, { blockedList: blockedPhrases, automatedList: automatedPhrases }).catch(() => null);

    if (checkResult && checkResult.blocked) {
      console.warn(
        `[FB-Buff] 🛑 ${checkResult.automatedWarning ? 'AUTOMATED BEHAVIOR WARNING' : 'Action Blocked'} matched "${checkResult.matched}" [${checkResult.aria}]: "${checkResult.text.replace(/\s+/g, ' ')}"`
      );
      return checkResult;
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function checkActionBlockedOnTab(tab) {
  const reason = await detectActionBlockReason(tab);
  return Boolean(reason && reason.blocked);
}

/** Automatically closes annoying Facebook popups / overlays (Not now, Later, Close, etc.) */
async function dismissFacebookOverlays(tab) {
  try {
    await tab.evaluate(() => {
      const dismissTexts = ['lúc khác', 'not now', 'để sau', 'không phải bây giờ'];
      const dialogs = document.querySelectorAll('div[role="dialog"]');
      for (const dlg of dialogs) {
        // If this dialog holds the post or the Like button (photo/reel viewer), NEVER close it
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

/** Automatically handles Facebook's forced account switch interstitial (forced_account_switch) */
async function handleForcedAccountSwitch(tab, targetUrl = null, workerTag = '', pageInfo = null) {
  try {
    if (!tab || tab.isClosed()) return false;
    const u = tab.url() || '';
    if (u.includes('forced_account_switch')) {
      console.log(`[FB-Buff]${workerTag} ⚠️ Detected the "forced_account_switch" page. Handling it automatically...`);

      // If there's a Fanpage name, prefer selecting that Fanpage identity on the form instead of the default parent account
      if (pageInfo && pageInfo.name) {
        const pageOption = tab.locator(
          `div[role="radio"]:has-text("${pageInfo.name}"), ` +
          `div[role="button"]:has-text("${pageInfo.name}"), ` +
          `label:has-text("${pageInfo.name}")`
        ).first();
        if (await pageOption.isVisible({ timeout: 1200 }).catch(() => false)) {
          console.log(`[FB-Buff]${workerTag} 🎯 Selected Page identity "${pageInfo.name}" on forced_account_switch`);
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
            console.log(`[FB-Buff]${workerTag} 🔄 After clearing forced_account_switch, sending the tab back to: ${targetUrl}...`);
            await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
            await tab.waitForTimeout(1000);
          }
        }
        return true;
      }
    }
  } catch (e) {
    console.warn(`[FB-Buff]${workerTag} ⚠️ Error handling forced_account_switch:`, e.message);
  }
  return false;
}

/** Checks whether a Facebook post shows "This content isn't available right now" */
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

function registerLightweightTabRoutes(tab) {
  if (!tab || tab._hasLightweightRoutes) return;
  tab._hasLightweightRoutes = true;
  tab._isCrashed = false;
  if (!tab._hasCrashListener) {
    tab._hasCrashListener = true;
    tab.on('crash', () => {
      tab._isCrashed = true;
    });
  }
  tab.route('**/*.{png,jpg,jpeg,webp,gif,avif,ico,mp4,mov,m4v,avi,webm,m3u8,ts,woff,woff2,ttf,otf}', (route) => route.abort()).catch(() => {});
  tab.route('**/*{google-analytics,doubleclick}*', (route) => route.abort()).catch(() => {});
}

/** Keeps the Tab open and healthy, automatically closing crashed/hung tabs and opening a new one */
async function ensureTabHealthy(context, currentTab, trackedTabs = null) {
  let needsNewTab = !currentTab || currentTab.isClosed() || Boolean(currentTab._isCrashed);

  if (!needsNewTab) {
    if (!currentTab._hasCrashListener) {
      currentTab._hasCrashListener = true;
      currentTab.on('crash', () => {
        currentTab._isCrashed = true;
      });
    }
    try {
      await Promise.race([
        currentTab.evaluate(() => 1),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Tab health probe timeout')), 4000)),
      ]);
      if (currentTab._isCrashed || currentTab.isClosed()) {
        needsNewTab = true;
      }
    } catch {
      needsNewTab = true;
    }
  }

  if (!needsNewTab) {
    return currentTab;
  }

  if (currentTab) {
    if (trackedTabs) trackedTabs.delete(currentTab);
    if (!currentTab.isClosed()) {
      await currentTab.close().catch(() => {});
    }
  }

  try {
    console.log('[FB-Buff] 🔄 Tab closed, crashed or hung — automatically opening a clean new tab...');
    const newTab = await context.newPage();
    registerLightweightTabRoutes(newTab);
    if (trackedTabs) trackedTabs.add(newTab);
    return newTab;
  } catch (err) {
    const msg = String(err?.message || '');
    const isBrowserDead = (
      msg.includes('closed') ||
      msg.includes('Target page') ||
      msg.includes('Connection closed') ||
      msg.includes('Target closed')
    );
    if (isBrowserDead) {
      console.error('[FB-Buff] 🛑 The Chromium browser was closed or crashed for the whole session:', msg);
      const deadErr = new Error(`The Chromium browser was closed or crashed: ${msg}`);
      deadErr.isBrowserDead = true;
      throw deadErr;
    }
    throw err;
  }
}

/** Proactively closes the old tab and opens a new one to free renderer RAM on long batches */
async function recycleHealthyTab(context, currentTab, trackedTabs = null) {
  if (currentTab) {
    if (trackedTabs) trackedTabs.delete(currentTab);
    if (!currentTab.isClosed()) {
      await currentTab.close().catch(() => {});
    }
  }
  return ensureTabHealthy(context, null, trackedTabs);
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

async function waitVisible(locator, timeoutMs = 2000) {
  try {
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
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

async function switchTabIdentity(tab, context, pageInfo, uid, workerTag = '', options = {}) {
  const isProfileVia = !pageInfo.id || pageInfo.id === uid || pageInfo.isProfile === true;
  const targetId = String(pageInfo.id || uid);
  const targetName = (pageInfo.name || '').trim();
  const skipAvatarModal = Boolean(options?.skipAvatarModal);

  // Check whether we're already on the right identity
  const currentActor = await getCurrentActor(tab);
  if (currentActor) {
    const isMatched = isProfileVia
      ? currentActor.id === String(uid)
      : (currentActor.id === targetId || (targetName && currentActor.name === targetName));
    if (isMatched) {
      console.log(`[FB-Buff]${workerTag} 🎯 Already on the right identity "${currentActor.name}" (ID: ${currentActor.id})`);
      return true;
    }
  }

  console.log(`[FB-Buff]${workerTag} 🔄 Switching to identity "${pageInfo.name || 'Parent account'}" (ID: ${pageInfo.id || uid})...`);

  // Close leftover modals if any
  await tab.keyboard.press('Escape').catch(() => { });
  await tab.waitForTimeout(200);

  // Step 1: open the Avatar menu at the top right of the banner or header navigation
  // (Skipped if the Voice Switcher is already open and the Page isn't found, going straight via profile.php?id=..., saving 5-6s/page)
  const avatarSelector =
    'div[role="banner"] div[role="button"][aria-label*="trang cá nhân" i], ' +
    'div[role="banner"] div[role="button"][aria-label*="Your profile" i], ' +
    'div[role="banner"] div[role="button"][aria-label*="Account, your profile" i], ' +
    'div[role="banner"] div[role="button"][aria-label*="Tài khoản" i], ' +
    'div[role="navigation"] div[role="button"][aria-label*="trang cá nhân" i], ' +
    'div[role="navigation"] div[role="button"][aria-label*="Your profile" i], ' +
    'div[role="navigation"] div[role="button"][aria-label*="Tài khoản" i], ' +
    '[aria-label*="Tài khoản cá nhân" i], [aria-label*="Account controls and settings" i]';
  let avatarBtn = tab.locator(avatarSelector).last();

  let hasAvatar = skipAvatarModal ? false : await waitVisible(avatarBtn, 1500);

  // SPEED OPTIMIZATION: only go back to the home page when the current UI really lacks the Avatar header menu
  if (!skipAvatarModal && !hasAvatar) {
    const curSwitchUrl = tab.url() || '';
    if (curSwitchUrl.includes('/watch/') || !curSwitchUrl.includes('facebook.com')) {
      await tab.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
      avatarBtn = tab.locator(avatarSelector).last();
      hasAvatar = await waitVisible(avatarBtn, 3000);
    }
  }

  let switched = false;
  if (hasAvatar) {
    await avatarBtn.click({ force: true });

    // Step 2: check whether the target Page/Via is right in the short list
    const searchTargetName = isProfileVia ? '' : targetName;
    const seeAllBtn = tab.locator(
      'div[role="button"]:has-text("Xem tất cả trang cá nhân"), ' +
      'div[role="button"]:has-text("Xem tất cả các trang cá nhân"), ' +
      'div[role="button"]:has-text("See all profiles"), ' +
      'div[role="button"]:has-text("See all Profiles"), ' +
      'div[role="button"]:has-text("Switch profiles"), ' +
      '[aria-label*="See all profiles" i], [aria-label*="Xem tất cả trang" i]'
    ).first();

    // Wait for the account menu to finish rendering (wait for seeAllBtn or a quickPage item)
    await waitVisible(seeAllBtn, 2000);

    if (searchTargetName) {
      const quickPage = tab.locator(
        `div[role="menu"] div[role="button"]:has-text("${searchTargetName}"), ` +
        `div[role="dialog"] div[role="button"]:has-text("${searchTargetName}")`
      ).first();
      if (await waitVisible(quickPage, 400)) {
        await quickPage.click({ force: true });
        switched = true;
      }
    } else if (isProfileVia) {
      // Switch back to the parent Via: pick the first personal profile in the menu
      const viaOption = tab.locator(
        'div[role="menu"] div[role="button"], div[role="dialog"] div[role="button"]'
      ).first();
      if (await waitVisible(viaOption, 500)) {
        await viaOption.click({ force: true });
        switched = true;
      }
    }

    // Step 3: if not clicked yet, open the "See all profiles" modal
    if (!switched && (await waitVisible(seeAllBtn, 1200))) {
      await seeAllBtn.click({ force: true });

      // Catch the dialog holding the profile switch list
      const profileDlg = tab.locator('div[role="dialog"]').filter({
        has: tab.locator('input, [role="listitem"]'),
      }).last();
      const fallbackDlg = tab.locator('div[role="dialog"]').last();
      const activeDlg = (await waitVisible(profileDlg, 2500)) ? profileDlg : ((await waitVisible(fallbackDlg, 1000)) ? fallbackDlg : null);

      if (activeDlg) {
        // 1. Quick check whether the Page/Profile is already shown in the modal's initial list
        let pageItem = activeDlg.locator('div[role="button"], div[role="listitem"]').filter({ hasText: targetName }).first();
        if (await waitVisible(pageItem, 500)) {
          await pageItem.click({ force: true });
          switched = true;
        }

        // 2. If not, use the search box in the modal (typed via DOM evaluate so it doesn't blur the modal)
        if (!switched && targetName) {
          const hasSearchInput = await activeDlg.locator('input').first().isVisible({ timeout: 350 }).catch(() => false);
          if (hasSearchInput) {
            await tab.evaluate((name) => {
              const dlg = document.querySelector('div[role="dialog"]');
              if (!dlg) return;
              const input = dlg.querySelector('input');
              if (input) {
                input.focus();
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (setter) setter.call(input, name);
                else input.value = name;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, targetName).catch(() => {});
            await tab.waitForTimeout(250);

            pageItem = activeDlg.locator('div[role="button"], div[role="listitem"]').filter({ hasText: targetName }).first();
            if (await waitVisible(pageItem, 700)) {
              await pageItem.click({ force: true });
              switched = true;
            }
          }
        }

        // 3. If still not found, scroll the list quickly (supports accounts with dozens to hundreds of Pages)
        if (!switched && targetName) {
          for (let scrollAttempt = 0; scrollAttempt < 8 && !switched; scrollAttempt++) {
            await activeDlg.evaluate((dlg) => {
              const scrollable = dlg.querySelector('div[style*="overflow"], [role="list"]') || dlg;
              scrollable.scrollTop += 500;
            }).catch(() => {});
            await tab.waitForTimeout(180);

            pageItem = activeDlg.locator('div[role="button"], div[role="listitem"]').filter({ hasText: targetName }).first();
            if (await waitVisible(pageItem, 350)) {
              await pageItem.click({ force: true });
              switched = true;
              break;
            }

            const seeMoreBtn = activeDlg.locator(
              'div[role="button"]:has-text("Xem thêm"), div[role="button"]:has-text("See more")'
            ).first();
            if (await waitVisible(seeMoreBtn, 200)) {
              await seeMoreBtn.click({ force: true }).catch(() => {});
            }
          }
        }

        if (switched) {
          await tab.waitForFunction(() => {
            const text = document.body ? document.body.innerText : '';
            return !text.includes('Đang chuyển sang') && !text.includes('Switching to');
          }, { timeout: 8000 }).catch(() => {});
          await tab.waitForTimeout(250);
        }
      }
    }
  }

  // Fallback when the banner menu can't be clicked
  if (!switched) {
    // Remove i_user before opening profile.php: while carrying the previous Page's i_user, Facebook hides the "Switch Now" button
    await context.clearCookies({ name: 'i_user' }).catch(() => { });
    await tab.waitForTimeout(250);

    const openProfileUrl = async (profileId) => {
      const profileUrl = `https://www.facebook.com/profile.php?id=${profileId}`;
      for (let navTry = 0; navTry < 2; navTry++) {
        await tab.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
        if ((tab.url() || '').includes(String(profileId))) return true;
        await tab.waitForTimeout(400);
      }
      return (tab.url() || '').includes(String(profileId));
    };

    if (isProfileVia) {
      await openProfileUrl(uid);
      const switchBtn = tab.locator(
        'div[aria-label="Switch Now"], div[aria-label="Chuyển ngay"], ' +
        'div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Switch Now"), ' +
        'div[role="button"]:has-text("Chuyển"), div[role="button"]:has-text("Switch")'
      ).first();
      if (await waitVisible(switchBtn, 4000)) {
        await switchBtn.click({ force: true }).catch(() => { });
        switched = true;
      }
    } else {
      await openProfileUrl(pageInfo.id);
      const primarySwitchBtn = tab.locator(
        'div[role="button"][aria-label="Chuyển ngay"], div[role="button"][aria-label="Switch Now"], ' +
        'div[aria-label="Switch Now"], div[aria-label="Chuyển ngay"], ' +
        'div[role="button"]:text-is("Chuyển ngay"), div[role="button"]:text-is("Switch Now"), ' +
        'div[role="button"]:text-is("Switch now"), [aria-label*="Switch into" i]'
      ).first();
      const secondarySwitchBtn = tab.locator(
        'div[role="button"][aria-label="Chuyển"], div[role="button"][aria-label="Switch"], ' +
        'div[role="button"]:text-is("Chuyển"), div[role="button"]:text-is("Switch")'
      ).first();

      let switchBtn = null;
      let clickedPrimary = false;
      if (await waitVisible(primarySwitchBtn, 4500)) {
        switchBtn = primarySwitchBtn;
        clickedPrimary = true;
      } else if (await waitVisible(secondarySwitchBtn, 1500)) {
        switchBtn = secondarySwitchBtn;
      }

      if (switchBtn) {
        await switchBtn.click().catch(async () => {
          await switchBtn.click({ force: true }).catch(() => {});
        });
        await tab.waitForTimeout(500);

        // Check whether Facebook asks to switch to another Via (not owned by the current Via)
        const mismatchDlg = tab.locator('div[role="dialog"]').filter({
          hasText: /Bạn cần chuyển sang|Chuyển tài khoản|You need to switch to/i
        }).first();
        if (await waitVisible(mismatchDlg, 800)) {
          console.warn(`[FB-Buff]${workerTag} ⚠️ Page "${pageInfo.name}" (${pageInfo.id}) is managed by another Via. Skipping automatically.`);
          pageInfo._switchErrorType = 'WRONG_VIA';
          await tab.keyboard.press('Escape').catch(() => { });
          await tab.waitForTimeout(300);
          return false;
        }

        // Catch and click "Switch" in the Pro5 profile switch confirmation dialog if a modal opens
        if (!clickedPrimary) {
          const modalConfirm = tab.locator(
            'div[role="dialog"] div[role="button"][aria-label="Chuyển"], ' +
            'div[role="dialog"] div[role="button"][aria-label="Switch"], ' +
            'div[role="dialog"] div[role="button"]:text-is("Chuyển"), ' +
            'div[role="dialog"] div[role="button"]:text-is("Switch")'
          ).last();
          if (await waitVisible(modalConfirm, 2000)) {
            await modalConfirm.click().catch(async () => {
              await modalConfirm.click({ force: true }).catch(() => {});
            });
          }
        }
        switched = true;
      }
    }
  }

  // Close any open popovers/menus so they don't block navigation
  await tab.keyboard.press('Escape').catch(() => { });

  if (switched) {
    // Wait for Facebook's GraphQL request that changes the i_user cookie server-side before navigating (don't cut it off!)
    const wantsPageCookie = Boolean(pageInfo.id && pageInfo.id !== uid && !pageInfo.isProfile);
    const cookieDeadline = Date.now() + 5000;
    while (Date.now() < cookieDeadline) {
      const ctxCookies = await context.cookies('https://www.facebook.com').catch(() => []);
      const iUser = ctxCookies.find((c) => c.name === 'i_user')?.value || '';
      if (wantsPageCookie && iUser === targetId) break;
      if (!wantsPageCookie && !iUser) break;
      await tab.waitForTimeout(300);
    }

    // Wait for Facebook to finish navigating into the new account session
    await tab.waitForFunction(() => {
      const text = document.body ? document.body.innerText : '';
      return !text.includes('Đang chuyển sang') && !text.includes('Switching to');
    }, { timeout: 10000 }).catch(() => {});
    await Promise.race([
      tab.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2500 }),
      tab.waitForTimeout(350),
    ]).catch(() => { });

    const usePageBtn = tab.locator('div[role="button"]:has-text("Dùng Trang"), div[role="button"]:has-text("Use Page")').first();
    if (await waitVisible(usePageBtn, 350)) {
      await usePageBtn.click({ force: true }).catch(() => { });
      await tab.waitForTimeout(100);
    }

    // Update the i_user cookie in the Playwright context after a successful switch
    if (wantsPageCookie) {
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
  } else {
    await context.clearCookies({ name: 'i_user' }).catch(() => { });
    console.warn(`[FB-Buff]${workerTag} ⚠️ Could not find the button to switch to identity "${pageInfo.name}" (${pageInfo.id}) on Facebook.`);
    return false;
  }

  return true;
}

/**
 * Shares the post (Share to Feed / Share now) as the current Fanpage identity on the Tab
 * Increases the real Share count on the Facebook post
 */
async function executePostShare(tab, workerTag = '') {
  try {
    // 1. Find the Share button on the post
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
      console.warn(`[FB-Buff]${workerTag} ⚠️ Share button not found on the post.`);
      return { success: false, error: 'Share button not found on the post' };
    }

    await shareBtn.scrollIntoViewIfNeeded().catch(() => { });
    await shareBtn.click({ force: true }).catch(async () => {
      await dispatchSyntheticClick(shareBtn);
    });
    await tab.waitForTimeout(650);

    // 2. Find the "Share now" or "Share to Feed" option
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

    // 3. If Facebook opens a share composer modal/dialog (with a Post button)
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
      console.log(`[FB-Buff]${workerTag} 🚀 Shared the post to the Fanpage wall!`);
      return { success: true };
    }

    // Close the popover if nothing could be clicked, so the UI doesn't get stuck
    await tab.keyboard.press('Escape').catch(() => { });
    return { success: false, error: 'Share now option not found' };
  } catch (err) {
    console.warn(`[FB-Buff]${workerTag} ⚠️ Error while sharing: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Runs the engagement chain (switch identity, like, comment, share) for 1 Fanpage on 1 Tab
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
  shouldStop = null,
}) {
  if (signal?.aborted || (typeof shouldStop === 'function' && shouldStop())) {
    return {
      aborted: true,
      deadReason: 'Task stopped because the KPI was reached or a stop command was issued',
      item: {
        pageId: pageInfo.id,
        pageName: pageInfo.name,
        status: 'SKIPPED',
        likeStatus: 'SKIPPED',
        commentStatus: 'SKIPPED',
        shareStatus: 'SKIPPED',
        message: 'Skipped because the KPI target was reached',
    },
  };
}

  // STEP 0: CHECK FOR LOGOUT / EXPIRED COOKIE ON THE TAB
  const isLoginPageOnTab = await tab.evaluate(() => {
    const hasInputs = Boolean(document.querySelector('input[name="email"], input[name="pass"], #login_form'));
    const modalText = (document.querySelector('div[role="dialog"]')?.innerText || '').toLowerCase();
    const isLoginModal = modalText.includes('đăng nhập') && (modalText.includes('mật khẩu') || modalText.includes('xem thêm trên facebook') || modalText.includes('tạo tài khoản'));
    return hasInputs || isLoginModal;
  }).catch(() => false);

  const curUrl = tab.url();
  if (isLoginPageOnTab || curUrl.includes('/login') || curUrl.includes('/checkpoint')) {
    const isCp = curUrl.includes('/checkpoint');
    console.error(`[FB-Buff]${workerTag} 🚨 EXPIRED COOKIE / LOGGED OUT DETECTED (Facebook login screen appeared)!`);
    return {
      cookieDead: true,
      isCheckpoint: isCp,
      isExpired: !isCp,
      deadReason: isCp ? 'Facebook account is checkpointed' : 'Cookie expired or the login session was logged out',
      item: {
        pageId: pageInfo.id,
        pageName: pageInfo.name,
        status: 'ERROR',
        error: isCp ? 'Account is checkpointed' : 'Facebook Cookie expired. Please update the Cookie.',
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
  let isAutomatedWarning = false;

  try {
    // STEP 1: SWITCH IDENTITY
    let fastSwitched = false;
    let voiceSwitchMissed = false;
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
      // For Reels / Video, the comment panel usually holds the engagement identity switch (Voice Switcher)
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
        'div[aria-haspopup="menu"][aria-label*="profile" i], ' +
        'div[role="button"]:has-text("Comment as"), div[role="button"]:has-text("Bình luận dưới tên")'
      ).first();

      if ((await voiceBtn.count().catch(() => 0)) > 0 && (await voiceBtn.isVisible().catch(() => false))) {
        const currentVoiceAria = (await voiceBtn.getAttribute('aria-label').catch(() => '')) || '';
        if (currentVoiceAria.includes(pageInfo.name)) {
          fastSwitched = true;
        } else {
          await voiceBtn.click({ force: true }).catch(() => { });
          await tab.waitForTimeout(450);

          const voiceItemSel =
            `[role="dialog"] [role="button"]:has-text("${pageInfo.name}"), ` +
            `[role="dialog"] [role="menuitem"]:has-text("${pageInfo.name}"), ` +
            `[role="dialog"] [role="menuitemradio"]:has-text("${pageInfo.name}"), ` +
            `[role="dialog"] [role="option"]:has-text("${pageInfo.name}"), ` +
            `[role="dialog"] [role="radio"]:has-text("${pageInfo.name}"), ` +
            `[role="menu"] [role="button"]:has-text("${pageInfo.name}"), ` +
            `[role="menu"] [role="menuitem"]:has-text("${pageInfo.name}"), ` +
            `[role="menu"] [role="menuitemradio"]:has-text("${pageInfo.name}"), ` +
            `[role="dialog"] [aria-label*="${pageInfo.name}"]:not(input), ` +
            `[role="menu"] [aria-label*="${pageInfo.name}"]:not(input)`;

          let pageOpt = tab.locator(voiceItemSel).first();

          if (await waitVisible(pageOpt, 500)) {
            await pageOpt.click({ force: true }).catch(() => { });
            // Wait for Facebook to finish the identity switch spinner (wait for "Switching to..." to disappear)
            await tab.waitForFunction(() => {
              const text = document.body ? document.body.innerText : '';
              return !text.includes('Đang chuyển sang') && !text.includes('Switching to');
            }, { timeout: 12000 }).catch(() => { });
            await tab.waitForTimeout(450);
            fastSwitched = true;
            console.log(`[FB-Buff]${workerTag} ⚡ [FAST-SWITCH] Switched to Page "${pageInfo.name}" right on the post!`);
          } else {
            // Don't type into the searchBox (FB closes the dialog on input); try expanding once quickly, otherwise close and go straight via profile.php
            const seeMoreVoice = tab.locator(
              'div[role="dialog"] div[role="button"]:has-text("Xem thêm trang"), ' +
              'div[role="dialog"] div[role="button"]:has-text("See more Pages"), ' +
              'div[role="dialog"] div[role="button"]:has-text("See more pages")'
            ).first();
            if (await waitVisible(seeMoreVoice, 350)) {
              await seeMoreVoice.click({ force: true }).catch(() => {});
              await tab.waitForTimeout(450);
            } else {
              await tab.evaluate(() => {
                const scrollable = document.querySelector('div[role="dialog"] [role="list"], div[role="dialog"] div[style*="overflow"]');
                if (scrollable) scrollable.scrollBy(0, 600);
              }).catch(() => {});
            }

            const retryOpt = tab.locator(voiceItemSel).first();
            if (await waitVisible(retryOpt, 450)) {
              await retryOpt.click({ force: true }).catch(() => { });
              await tab.waitForFunction(() => {
                const text = document.body ? document.body.innerText : '';
                return !text.includes('Đang chuyển sang') && !text.includes('Switching to');
              }, { timeout: 12000 }).catch(() => { });
              await tab.waitForTimeout(450);
              fastSwitched = true;
              console.log(`[FB-Buff]${workerTag} ⚡ [FAST-SWITCH SCROLL] Found and switched to Page "${pageInfo.name}"!`);
            } else {
              voiceSwitchMissed = true;
              await tab.keyboard.press('Escape').catch(() => { });
            }
          }
        }
      }
    }

    if (fastSwitched) {
      // SPEED OPTIMIZATION: if the identity was switched right on the post and the tab is still on the target post,
      // NO FULL PAGE RELOAD NEEDED (saves 6 - 8 seconds per Like)!
      const u = tab.url() || '';
      const isStillOnPost = !u.includes('forced_account_switch') &&
        (u.includes('/posts/') || u.includes('/permalink') || u.includes('/share/') || u.includes('/reel/') || u.includes('/videos/') || u.includes('/photo/') || (targetUrl && u.includes(targetUrl)));

      if (!isStillOnPost) {
        console.log(`[FB-Buff]${workerTag} 🌐 Tab drifted off the post (${u}), bringing it back to the target post: ${targetUrl}...`);
        await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => { });
        await tab.waitForTimeout(1500);
      } else {
        // Only a short 450ms wait is needed for Facebook's DOM to update the new actor
        await tab.waitForTimeout(450);
      }

      // Re-check the actual identity right after Fast-Switch; if it didn't change, fall back to the standard Switch
      const postFastActor = await getCurrentActor(tab);
      if (postFastActor && pageInfo.id && pageInfo.id !== uid && !pageInfo.isProfile) {
        const fastMatched =
          postFastActor.id === String(pageInfo.id) ||
          (pageInfo.name && postFastActor.name && postFastActor.name.toLowerCase() === pageInfo.name.toLowerCase());
        if (!fastMatched) {
          console.warn(`[FB-Buff]${workerTag} ⚠️ Fast-Switch didn't change the identity (still "${postFastActor.name}"), falling back to the standard Switch...`);
          await tab.keyboard.press('Escape').catch(() => { });
          fastSwitched = false;
        }
      }
    }

    if (!fastSwitched) {
      const switchOk = await switchTabIdentity(tab, context, pageInfo, uid, workerTag, { skipAvatarModal: voiceSwitchMissed });
      if (!switchOk) {
        recordPageSwitchOutcome(uid, pageInfo.id, false, pageInfo._switchErrorType || 'SWITCH_FAILED');
        throw new Error(`Could not switch to Fanpage identity "${pageInfo.name}" (${pageInfo.id}) on Facebook`);
      }

      // SPEED OPTIMIZATION: if the tab is still on the target post after switching identity (URL unchanged),
      // NO FULL PAGE RELOAD NEEDED (saves 4 - 6 seconds per Like)!
      const curU = tab.url() || '';
      const isStillOnPost = !curU.includes('forced_account_switch') &&
        (curU.includes('/posts/') || curU.includes('/permalink') || curU.includes('/share/') || curU.includes('/reel/') || curU.includes('/videos/') || curU.includes('/photo/') || (targetUrl && curU.includes(targetUrl)));

      if (!isStillOnPost) {
        console.log(`[FB-Buff]${workerTag} 🌐 Opening the target post: ${targetUrl}...`);
        await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(async (navErr) => {
          console.warn(`[FB-Buff]${workerTag} ⚠️ Retrying to open the target post: ${navErr.message}`);
          await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
        });
        await tab.waitForTimeout(400);
      } else {
        console.log(`[FB-Buff]${workerTag} ⚡ Tab is already on the target post (${curU}), skipping the reload to speed up.`);
        await tab.waitForTimeout(400);
      }

      if (tab.url().includes('forced_account_switch')) {
        await handleForcedAccountSwitch(tab, targetUrl, workerTag, pageInfo);
      }
    }

    // MAKE SURE THE TAB IS ON THE TARGET POST (GUARD AGAINST FACEBOOK PUSHING IT TO THE HOME PAGE / FEED)
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
        console.log(`[FB-Buff]${workerTag} 🔄 Tab isn't on the right post (${tab.url()}), bringing it back to the target post: ${targetUrl}...`);
        await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
        await tab.waitForTimeout(400);
      }
    }

    const currentUrl = tab.url();
    if (currentUrl.includes('/checkpoint') || currentUrl.includes('/login')) {
      const isCp = currentUrl.includes('/checkpoint');
      const cpMsg = isCp
        ? 'Facebook asked to verify you are human ("Confirm you are human")'
        : 'Cookie expired (redirected to the login page)';
      console.warn(`[FB-Buff]${workerTag} ⚠️ ${cpMsg} cho "${pageInfo.name}" (URL: ${currentUrl})`);
      throw new Error(cpMsg);
    }

    // STEP 2: NATURAL SCROLLING & DWELL TIME (SIMULATING A REAL PERSON READING THE POST)
    if (enableHumanBehavior) {
      // Natural reading scroll (120 - 300px)
      await tab.evaluate(() => {
        const dlg = document.querySelector('div[role="dialog"]');
        if (dlg) dlg.scrollBy({ top: 120 + Math.floor(Math.random() * 180), behavior: 'smooth' });
        else window.scrollBy({ top: 120 + Math.floor(Math.random() * 180), behavior: 'smooth' });
      }).catch(() => { });

      // Human-like Dwell Time reading the post: tuned per speedMode
      let dwellBase = 350;
      let dwellVar = 200;
      const currentSpeed = speedMode || 'FAST';
      if (currentSpeed === 'TURBO') { dwellBase = 150; dwellVar = 100; }
      else if (currentSpeed === 'FAST') { dwellBase = 250; dwellVar = 150; }
      else if (currentSpeed === 'SAFE') { dwellBase = 800; dwellVar = 400; }
      await tab.waitForTimeout(dwellBase + Math.floor(Math.random() * dwellVar));

      // Occasionally scroll back up a little (15% chance) like someone pondering the post
      if (Math.random() < 0.15 && currentSpeed !== 'TURBO') {
        await tab.evaluate(() => {
          const dlg = document.querySelector('div[role="dialog"]');
          if (dlg) dlg.scrollBy({ top: -(20 + Math.floor(Math.random() * 40)), behavior: 'smooth' });
          else window.scrollBy({ top: -(20 + Math.floor(Math.random() * 40)), behavior: 'smooth' });
        }).catch(() => { });
        await tab.waitForTimeout(200);
      }
    }

    // STEP 3: SMART REACTION ALLOCATION
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

    // STEP 4: DROP THE LIKE / REACTION
    if (enableLike) {
      // 0. Close Facebook ad popups / annoying modals if any
      await dismissFacebookOverlays(tab);

      // 1. Close the cookie banner if it covers the screen (don't close the post dialog)
      const cookieBanner = tab.locator('div[role="dialog"]:has-text("Cookie"), div[role="dialog"]:has-text("Cookies")').first();
      if (await cookieBanner.isVisible({ timeout: 400 }).catch(() => false)) {
        const acceptCookie = cookieBanner.locator('div[role="button"]:has-text("Chấp nhận"), div[role="button"]:has-text("Accept")').first();
        if (await acceptCookie.isVisible().catch(() => false)) {
          await acceptCookie.click({ force: true }).catch(() => { });
        }
      }

      // Make sure the tab is on the post before scanning for the Like button (prevents drifting to the home page)
      if (!checkIsOnPostUrl()) {
        if (tab.url().includes('forced_account_switch')) {
          await handleForcedAccountSwitch(tab, targetUrl, workerTag, pageInfo);
        }
        if (!checkIsOnPostUrl()) {
          console.warn(`[FB-Buff]${workerTag} 🔄 Tab drifted off the post (${tab.url()}), restoring to: ${targetUrl}...`);
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
        // VERIFY THE IDENTITY BEFORE LIKING (prevents liking as the parent account by mistake)
        let currentActor = await getCurrentActor(tab);
        if (currentActor && pageInfo.id && pageInfo.id !== uid && !pageInfo.isProfile) {
          let isMatched = currentActor.id === String(pageInfo.id) ||
            (pageInfo.name && currentActor.name && currentActor.name.toLowerCase() === pageInfo.name.toLowerCase());
          if (!isMatched) {
            // If the i_user cookie already holds the new Page ID but CurrentUserInitialData in the SPA is stale, reload the tab once to refresh the actor
            const ctxCookies = await context.cookies('https://www.facebook.com').catch(() => []);
            const iUserCookie = ctxCookies.find((c) => c.name === 'i_user')?.value || '';
            if (iUserCookie === String(pageInfo.id)) {
              console.log(`[FB-Buff]${workerTag} 🔄 Cookie is on Page "${pageInfo.name}" (${pageInfo.id}) but the stale DOM still says "${currentActor.name}", reloading the post to sync...`);
              await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
              await tab.waitForTimeout(800);
              currentActor = await getCurrentActor(tab);
              isMatched = Boolean(currentActor && (
                currentActor.id === String(pageInfo.id) ||
                (pageInfo.name && currentActor.name && currentActor.name.toLowerCase() === pageInfo.name.toLowerCase())
              ));
              const refreshedBtn = await findLikeButtonOnTab(tab);
              if (refreshedBtn) likeBtn = refreshedBtn;
            }
          }
          if (!isMatched) {
            console.warn(`[FB-Buff]${workerTag} ⚠️ Identity mismatch! Expected "${pageInfo.name}" (${pageInfo.id}) but currently "${currentActor?.name}" (${currentActor?.id}). REFUSING TO LIKE to protect the Via.`);
            // Record it as an identity-switch failure so repeatedly broken Pages (e.g. assigned to the wrong Via) get quarantined like the failed-switch branch.
            // Previously this branch didn't record anything → a Page failing 9/9 times was still retried on every run.
            recordPageSwitchOutcome(uid, pageInfo.id, false, 'IDENTITY_MISMATCH');
            throw new Error(`Could not switch identity to Page "${pageInfo.name}" yet (current: ${currentActor?.name || 'N/A'})`);
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
          console.log(`[FB-Buff]${workerTag} ℹ️ Page "${pageInfo.name}" already liked earlier (state: ${currentAria}).`);
          likeStatus = 'ALREADY_LIKED';
        } else {
          // OVERSHOOT GUARD: if the KPI is already reached or a stop was issued before clicking Like, SKIP right away
          if (typeof shouldStop === 'function' && shouldStop()) {
            console.warn(`[FB-Buff]${workerTag} 🛑 KPI reached / stop received, cancelling Page "${pageInfo.name}"'s Like so it doesn't overshoot.`);
            likeStatus = 'SKIPPED';
            return {
              item: {
                pageId: pageInfo.id,
                pageName: pageInfo.name,
                status: 'SKIPPED',
                likeStatus: 'SKIPPED',
                commentStatus: 'SKIPPED',
                shareStatus: 'SKIPPED',
                message: 'Like cancelled because the KPI target was reached',
              },
            };
          }

          if (currentReaction === 'LIKE') {
            await dispatchSyntheticClick(likeBtn);
            const verifyTimeout = speedMode === 'TURBO' ? 700 : speedMode === 'FAST' ? 1200 : 2000;
            const verified = await verifyReacted(likeHandle, currentAria, () => findLikeButtonOnTab(tab), verifyTimeout, beforeText);
            likeStatus = verified ? 'SUCCESS' : 'UNVERIFIED';
            console.log(`[FB-Buff]${workerTag} ${verified ? '✅' : '❔'} Page "${pageInfo.name}" LIKE ${verified ? 'confirmed' : 'button state not confirmed'}.`);
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
              console.log(`[FB-Buff]${workerTag} ℹ️ Could not open the reaction bar for Page "${pageInfo.name}", falling back to LIKE.`);
              currentReaction = 'LIKE';
              await dispatchSyntheticClick(likeBtn);
            }
            const verifyTimeout = speedMode === 'TURBO' ? 700 : speedMode === 'FAST' ? 1200 : 2000;
            const verified = await verifyReacted(likeHandle, currentAria, () => findLikeButtonOnTab(tab), verifyTimeout, beforeText);
            likeStatus = verified ? 'SUCCESS' : 'UNVERIFIED';
            console.log(`[FB-Buff]${workerTag} ${verified ? '✅' : '❔'} Page "${pageInfo.name}" ${currentReaction} ${verified ? 'confirmed' : 'button state not confirmed'}.`);
          }

          const blockInfoAfterClick = await detectActionBlockReason(tab);
          if (blockInfoAfterClick && blockInfoAfterClick.blocked) {
            console.warn(`[FB-Buff]${workerTag} ⚠️ Facebook warning after liking as Page "${pageInfo.name}" (${blockInfoAfterClick.matched}).`);
            likeStatus = 'ERROR';
            isAutomatedWarning = Boolean(blockInfoAfterClick.automatedWarning);
            likeError = isAutomatedWarning
              ? 'Facebook warned about suspected automated behavior - stopping now to protect the Via'
              : 'Facebook temporarily restricted the action (Action Blocked)';
            isActionBlocked = true;
          }
        }
      } else {
        const blockInfoMissing = await detectActionBlockReason(tab);
        if (blockInfoMissing && blockInfoMissing.blocked) {
          isActionBlocked = true;
          isAutomatedWarning = Boolean(blockInfoMissing.automatedWarning);
          likeStatus = 'ERROR';
          likeError = isAutomatedWarning
            ? 'Facebook warned about suspected automated behavior - auto-stopping to protect the Via'
            : 'Facebook temporarily restricted fast actions (Action Blocked) - auto-stopping to protect the Via';
          console.warn(`[FB-Buff]${workerTag} 🛑 FACEBOOK WARNING DETECTED (${blockInfoMissing.matched}) on Page "${pageInfo.name}"!`);
        } else {
          const currentUrl = tab.url();
          const isUnavailable = await checkFacebookContentUnavailable(tab);
          if (isUnavailable) {
            console.warn(`[FB-Buff]${workerTag} ⚠️ Facebook post unavailable for "${pageInfo.name}" (${isUnavailable})`);
            likeStatus = 'ERROR';
            likeError = 'The post does not exist or was deleted, hidden or restricted by its owner (This content isn\'t available)';
          } else {
            console.warn(`[FB-Buff]${workerTag} ⚠️ Like button not found for "${pageInfo.name}" (URL: ${currentUrl})`);

            // Save a debug screenshot
            try {
              const debugDir = path.join(dataDir, 'debug_screens');
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
              ? 'The Facebook Group requires joining (Like button hidden until joined)'
              : isForcedSwitch
                ? 'Facebook is holding on the account switch page (forced_account_switch)'
                : isHome
                  ? 'Tab drifted to the Facebook home page (switching Pages too fast)'
                  : isGroup
                    ? 'Post is in a private Group or the Like button had not loaded yet'
                    : 'Like button not found on the post';
          }
        }
      }
    }

    // STEP 5: WRITE A COMMENT (IF ENABLED)
    if (enableComment) {
      let rawComment = pageInfo.comment || (Array.isArray(comments) && comments.length > 0 ? comments[pageIndex % comments.length] : '');
      usedCommentText = resolveSpintax(rawComment ? rawComment.trim() : '');

      if (!usedCommentText.trim()) {
        commentStatus = 'SKIPPED';
        commentError = 'No comment content';
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
          console.warn(`[FB-Buff]${workerTag} ⚠️ SPAM-PRONE KEYWORD DETECTED: "${usedCommentText}". Automatically converting it into natural seeding.`);
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

          // Pause to re-read the comment before sending (like a real person)
          await tab.waitForTimeout(900 + Math.floor(Math.random() * 600));
          await tab.keyboard.press('Enter');
          await tab.waitForTimeout(1600 + Math.floor(Math.random() * 800));
          commentStatus = 'SUCCESS';
          console.log(`[FB-Buff]${workerTag} 💬 Page "${pageInfo.name}" commented naturally: "${usedCommentText}"`);
        } else {
          commentStatus = 'FAILED';
          commentError = 'Comment box not found';
          console.warn(`[FB-Buff]${workerTag} ⚠️ Comment box not found for Page "${pageInfo.name}"`);
        }
      }
    }

    // STEP 5.5: SHARE THE POST TO THE FANPAGE WALL (IF ENABLED)
    if (enableShare) {
      const shareResult = await executePostShare(tab, workerTag);
      if (shareResult.success) {
        shareStatus = 'SUCCESS';
      } else {
        shareStatus = 'FAILED';
        shareError = shareResult.error || 'Could not share';
      }
    }

    // STEP 6: SUMMARIZE THE RESULT FOR THIS PAGE
    const likeOk = !enableLike || likeStatus === 'SUCCESS';
    const cmtOk = !enableComment || commentStatus === 'SUCCESS';
    const shareOk = !enableShare || shareStatus === 'SUCCESS';
    const isAlready = enableLike && !enableComment && !enableShare && likeStatus === 'ALREADY_LIKED';

    let finalStatus = 'SUCCESS';
    const msgs = [];
    if (enableLike) {
      if (likeStatus === 'SUCCESS') msgs.push(`Liked (${currentReaction})`);
      else if (likeStatus === 'ALREADY_LIKED') msgs.push('Already liked');
      else msgs.push(`Like error: ${likeError || 'Could not like'}`);
    }
    if (enableComment) {
      if (commentStatus === 'SUCCESS') msgs.push('Commented');
      else if (commentStatus === 'SKIPPED') msgs.push('Comment skipped (cmt)');
      else msgs.push(`Comment error: ${commentError || 'Could not send'}`);
    }
    if (enableShare) {
      if (shareStatus === 'SUCCESS') msgs.push('Shared to the Fanpage wall');
      else if (shareStatus === 'SKIPPED') msgs.push('Share skipped');
      else msgs.push(`Share error: ${shareError || 'Could not share'}`);
    }
    if (enableLike && likeStatus === 'UNVERIFIED') {
      msgs[0] = `Clicked ${currentReaction} but could not confirm it`;
    }

    if (isAlready) finalStatus = 'ALREADY_LIKED';
    else if (likeStatus === 'UNVERIFIED' && !(enableComment && commentStatus === 'SUCCESS') && !(enableShare && shareStatus === 'SUCCESS')) finalStatus = 'UNVERIFIED';
    else if (likeOk && cmtOk && shareOk) finalStatus = 'SUCCESS';
    else if ((enableLike && likeStatus === 'SUCCESS') || (enableComment && commentStatus === 'SUCCESS') || (enableShare && shareStatus === 'SUCCESS')) finalStatus = 'SUCCESS';
    else finalStatus = 'ERROR';

    if (finalStatus === 'SUCCESS' || finalStatus === 'ALREADY_LIKED' || finalStatus === 'UNVERIFIED') {
      const currentTabUrl = tab.url();
      const canonicalUrl = isValidCanonicalFbPostUrl(currentTabUrl)
        ? currentTabUrl
        : isValidCanonicalFbPostUrl(targetUrl)
          ? targetUrl
          : '';
      recordPageSwitchOutcome(uid, pageInfo.id, true);
      recordPageAction(pageInfo.id);
      recordPagePostInteraction(normalizedPostUrl, pageInfo.id, {
        reactionType: currentReaction,
        commentText: usedCommentText,
        shareStatus,
        status: finalStatus,
        pageName: pageInfo.name,
        canonicalUrl,
      });
    }

    return {
      actionBlocked: isActionBlocked,
      automatedWarning: isAutomatedWarning,
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
    console.error(`[FB-Buff]${workerTag} ❌ Error while Page "${pageInfo.name}" was engaging: ${err.message}`);
    const errMsg = String(err?.message || '');
    const isTabCrashed = Boolean(
      errMsg.includes('Page crashed') ||
      errMsg.includes('Target crashed') ||
      errMsg.includes('Tab health probe timeout')
    );
    const isBrowserDead = Boolean(
      !isTabCrashed && (
        err.isBrowserDead ||
        errMsg.includes('Browser has been closed') ||
        errMsg.includes('Target page, context or browser has been closed') ||
        errMsg.includes('Connection closed') ||
        errMsg.includes('Target closed')
      )
    );
    if (isTabCrashed && tab) {
      tab._isCrashed = true;
    }
    const blockOnCatch = (isBrowserDead || isTabCrashed) ? null : await detectActionBlockReason(tab).catch(() => null);
    const isBlockedOnCatch = Boolean(blockOnCatch && blockOnCatch.blocked);
    const isAutoWarnOnCatch = Boolean(blockOnCatch && blockOnCatch.automatedWarning);
    const isCp = Boolean(errMsg.includes('checkpoint') || errMsg.includes('xác minh người thật') || errMsg.includes('Confirm you are human'));
    const isExp = Boolean(errMsg.includes('Cookie hết hạn') || errMsg.includes('Cookie expired') || errMsg.includes('đăng nhập') || errMsg.includes('login page') || errMsg.includes('/login'));
    const cookieDead = isCp || isExp;
    return {
      actionBlocked: isBlockedOnCatch,
      automatedWarning: isAutoWarnOnCatch,
      browserDead: isBrowserDead,
      tabCrashed: isTabCrashed,
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
          ? 'The Chromium browser was closed or lost its connection.'
          : isTabCrashed
            ? 'The Chromium tab crashed (a clean tab was reopened for the next page).'
            : isAutoWarnOnCatch
              ? 'Facebook warned about suspected automated behavior. Auto-stopping to protect the Via.'
              : isBlockedOnCatch
                ? 'Facebook temporarily restricted actions (Action Blocked) for acting too fast. Auto-stopping to protect the Via.'
                : err.message,
      },
    };
  }
}

/**
 * Runs the Like/Reaction and Comment buff on a post using Fanpages
 * Supports multiple workers (Multi-Worker Concurrency, 1 - 3 parallel threads) & Proxy Pool routing
 * @param {string} cookieStr - Parent account cookie
 * @param {string} targetUrl - Post / Reels / Video link to buff
 * @param {object} options - Config: { reactionType, selectedPages, delayMs, enableLike, enableComment, comments, concurrency, proxyPool, proxyUrl, dripFeedMode, dripDurationMinutes }
 */
async function buffLikesWithPages(cookieStr, targetUrl, options = {}) {
  const {
    reactionType = 'RANDOM_POSITIVE', // Default RANDOM_POSITIVE (65% Like, 25% Love, 10% Care) for natural engagement that evades Meta's bot detection
    selectedPages = [],    // Array of pages { id, name, comment? } or empty to auto-scan
    delayMs = 2500,        // Base delay between engagements
    speedMode = 'NORMAL',  // Default NORMAL (~2.4s) runs smoothly and stably at 1 thread/Via
    enableLike = true,     // Whether to drop a Like/Reaction (default true)
    enableComment = false, // Whether to comment as the Fanpage (default false)
    enableShare = false,   // Whether to share the post to the Fanpage wall (default false)
    enableHumanBehavior = true, // Natural browsing behavior against checkpoints (default true)
    fastSwitch = true,     // Prefer switching identity right on the post via the Voice Switcher (saves 15s each)
    cooldownEvery = 25,    // Safe cooldown every 25 pages to avoid rate limits
    cooldownDurationMs = 20000, // Cooldown duration (20 seconds) per batch so Facebook resets its rate counter
    comments = [],         // Array of comment texts
    proxyUrl = '',         // Dedicated Proxy URL for the Via (http://user:pass@host:port)
    proxyPool = [],        // Proxy Pool routed per Worker thread
    maxActionsPerPageToday = getDailyPageActionLimit(), // Daily engagement limit per Page (System settings)
    concurrency = 1,       // Number of parallel worker threads (1 per Via recommended to avoid checkpoints)
    dripFeedMode = false,  // Spread likes out over time to evade scanning algorithms
    dripDurationMinutes = 30, // Drip-feed duration (minutes)
    kpiTarget = 0,         // Target number of successful Likes (0 = run through every selectedPage)
    targetLikes = 0,       // Alias cho kpiTarget
    onProgress,            // Progress callback: onProgress(event)
    shouldStop,            // () => boolean: caller requested a stop (client disconnected, emergency stop...)
    signal = options.signal || (options.fence?.signal) || null, // AbortSignal for deep cancellation
  } = options;
  const isStopRequested = () => isEmergencyStopped() || Boolean(signal?.aborted) || (typeof shouldStop === 'function' && shouldStop());

  if (isEmergencyStopped()) {
    throw new Error('The system is in EMERGENCY STOP. The task was refused.');
  }

  const normalizedPostUrl = normalizeFbPostUrl(targetUrl);

  let pages = selectedPages;
  if (!pages || pages.length === 0) {
    console.log('[FB-Buff] 🔄 No page list passed, auto-scanning Fanpages from the Cookie...');
    pages = await getManagedPages(cookieStr, { proxyUrl });
  }

  if (pages.length === 0) {
    throw new Error('No Fanpages found in the account to run with');
  }

  // GUARD AGAINST PAGES THAT FAIL IDENTITY SWITCHES (even when the client sends selectedPages from an old cache)
  const laneViaUid = getUserIdFromCookie(cookieStr);
  const cachedEntry = laneViaUid ? loadPagesCache()[laneViaUid] : null;
  const quarantinedMap = cachedEntry?.quarantined && typeof cachedEntry.quarantined === 'object' ? cachedEntry.quarantined : {};
  const beforeQuarantineCount = pages.length;
  pages = pages.filter((p) => p && p.id && !quarantinedMap[String(p.id)]);
  if (beforeQuarantineCount > pages.length) {
    console.log(`[FB-Buff] 🛡️ Skipping ${beforeQuarantineCount - pages.length} quarantined Pages (identity switch failed).`);
  }
  if (pages.length === 0) {
    return {
      total: beforeQuarantineCount,
      success: 0,
      failed: 0,
      skipped: beforeQuarantineCount,
      message: 'Every selected Fanpage is on the quarantine list (identity switch failed)',
      details: [],
    };
  }

  // GUARD AGAINST DUPLICATES & UN-LIKES
  await resolvePostUrlCanonical(targetUrl).catch(() => normalizedPostUrl);
  const originalPagesCount = pages.length;
  pages = filterAvailablePagesForPost(normalizedPostUrl, pages);
  if (pages.length === 0) {
    console.log(`[FB-Buff] ℹ️ All ${originalPagesCount} Fanpages already engaged with post "${normalizedPostUrl}". No new pages left to buff.`);
    return {
      total: originalPagesCount,
      success: 0,
      failed: 0,
      allAlreadyInteracted: true,
      message: 'Every Fanpage already engaged with this post (skipped automatically to avoid un-liking)',
      details: [],
    };
  }

  // DAILY LIMIT: skip Pages that reached today's limit, prefer the least active Pages
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
      message: `Reached ${maxActionsPerPageToday} actions today`,
    });
    return false;
  });
  if (cappedDetails.length > 0) {
    console.log(`[FB-Buff] 🛡️ Skipping ${cappedDetails.length} Pages that hit the ${maxActionsPerPageToday} actions/day limit.`);
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
      message: `Every Page reached the ${maxActionsPerPageToday} actions limit today`,
      details: cappedDetails,
    };
  }
  pages.sort((a, b) => (usedToday(a.id) - usedToday(b.id)) || ((b.verified ? 1 : 0) - (a.verified ? 1 : 0)));

  // MULTI-WORKER CONCURRENCY CONFIG & VIA PROTECTION:
  // Only run multiple threads on the same Via when proxyPool has >= 2 distinct Proxies; otherwise keep 1 sequential thread (Persistent Profile) to avoid "using this too fast"
  const targetConcurrency = Math.max(1, Math.min(4, parseInt(concurrency, 10) || 1));
  const hasMultiProxyPool = Array.isArray(proxyPool) && proxyPool.length >= 2;
  let safeConcurrency = hasMultiProxyPool ? targetConcurrency : 1;
  if (safeConcurrency < targetConcurrency) {
    console.log(`[FB-Buff] 🛡️ No multi-IP Proxy Pool — keeping 1 thread/Via (Persistent Profile) to avoid Facebook's "using this too fast" warning.`);
  }
  const isMultiWorker = safeConcurrency > 1 && pages.length >= safeConcurrency;
  const actualConcurrency = safeConcurrency;
  const effectiveKpi = parseInt(kpiTarget || targetLikes, 10) || 0;
  let adaptiveSlowFactor = 1.0;

  console.log(`[FB-Buff] 🚀 Starting engagement buff: ${targetUrl}`);
  console.log(`[FB-Buff] 🎯 Target: ${effectiveKpi > 0 ? `KPI ${effectiveKpi} successful Likes (backup pool: ${pages.length} Pages)` : `${pages.length} Fanpages`} | Speed mode: ${speedMode} (${delayMs}ms) | Like: ${enableLike ? reactionType : 'OFF'} | Comment: ${enableComment ? 'ON' : 'OFF'} | Share: ${enableShare ? 'ON' : 'OFF'} | Threads: ${actualConcurrency} | Fast-Switch: ${fastSwitch ? 'ON' : 'OFF'}`);

  const results = {
    total: effectiveKpi > 0 ? effectiveKpi : (pages.length + cappedDetails.length),
    candidateCount: pages.length + cappedDetails.length,
    success: 0,
    alreadyLiked: 0,
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
  console.log(`[FB-Buff] 📱 Emulating independent hardware (${device.name}) for UID: ${uid || 'N/A'}${baseProxy ? ` via Proxy ${baseProxy.server}` : ''}`);

  const usedCommentsHistory = new Set();
  let completedCount = cappedDetails.length;
  let globalStopTriggered = false;

  // DEEP CANCELLATION: close every tab/context immediately when the AbortSignal fires
  const trackedContexts = new Set();
  const trackedTabs = new Set();
  const abortCleanup = () => {
    console.warn(`[FB-Buff] 🛑 AbortSignal fired (Lease expired or User Abort)! Closing every Playwright Tab/Context immediately...`);
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
    // MODE 1: MULTI-WORKER PARALLEL BUFF (MULTI-WORKER CONCURRENCY)
    // ========================================================
    console.log(`[FB-Buff] ⚡ MULTI-THREAD ENABLED: splitting ${pages.length} Pages across ${actualConcurrency} independent Browser Contexts`);
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
      console.log(`[FB-Buff]${workerTag} 🚀 Starting to process ${workerPages.length} Pages...`);

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
        console.warn(`[FB-Buff]${workerTag} ⚠️ Proxy error (${workerProxyStr}): ${proxyErr.message}. Falling back to Direct.`);
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
        registerLightweightTabRoutes(workerTab);

        // Stagger opening the initial post between workers to avoid session congestion
        await new Promise((r) => setTimeout(r, (workerId - 1) * 2000));
        let workerTargetUrl = targetUrl;
        try {
          await workerTab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await workerTab.waitForTimeout(1000);
          const redirected = workerTab.url();
          if (redirected && redirected.includes('facebook.com') && !redirected.includes('/share/')) {
            workerTargetUrl = redirected;
            if (isValidCanonicalFbPostUrl(redirected)) {
              registerPostUrlAlias(normalizedPostUrl, redirected);
            }
          }
        } catch (e) {
          console.warn(`[FB-Buff]${workerTag} ⚠️ Error loading the initial post: ${e.message}`);
        }

        const isUnavailable = await checkFacebookContentUnavailable(workerTab);
        if (isUnavailable) {
          console.warn(`[FB-Buff]${workerTag} 🛑 Post unavailable (hidden/deleted/privacy-restricted): ${isUnavailable}`);
          globalStopTriggered = true;
          results.stopped = true;
          results.error = 'The post does not exist or was deleted, hidden or privacy-restricted by its author on Facebook.';
          return;
        }

        for (let i = 0; i < workerPages.length; i++) {
          if (isStopRequested() || globalStopTriggered) {
            results.stopped = true;
            console.warn(`[FB-Buff]${workerTag} 🛑 Stopping the thread at page ${i + 1}/${workerPages.length}`);
            break;
          }

          try {
            workerTab = await ensureTabHealthy(workerContext, workerTab, trackedTabs);
          } catch (tErr) {
            if (tErr.isBrowserDead || (tErr.message && tErr.message.includes('closed'))) {
              globalStopTriggered = true;
              results.stopped = true;
              console.error(`[FB-Buff]${workerTag} 🛑 The browser was closed. Stopping the worker thread now.`);
              break;
            }
          }

          const { page: pageInfo, originalIndex } = workerPages[i];
          if (pageInfo && pageInfo.id && hasPageInteractedWithPost(normalizedPostUrl, pageInfo.id)) {
            completedCount++;
            results.alreadyLiked++;
            const skippedItem = {
              pageId: pageInfo.id,
              pageName: pageInfo.name,
              status: 'ALREADY_LIKED',
              likeStatus: 'ALREADY_LIKED',
              commentStatus: 'SKIPPED',
              shareStatus: 'SKIPPED',
              message: 'Already liked (skipped automatically via the original link)',
            };
            results.details.push(skippedItem);
            if (typeof onProgress === 'function') {
              const pct = effectiveKpi > 0
                ? Math.min(100, Math.round((results.success / effectiveKpi) * 100))
                : Math.round((completedCount / pages.length) * 100);
              onProgress({
                type: 'PAGE_FINISH',
                index: originalIndex,
                total: effectiveKpi > 0 ? effectiveKpi : pages.length,
                kpiTarget: effectiveKpi > 0 ? effectiveKpi : undefined,
                ...skippedItem,
                percent: pct,
                workerId,
              });
            }
            continue;
          }
          try {
            options.touch?.() || options.fence?.touch?.() || options.fence?.heartbeat?.();
          } catch (_) {}
          console.log(`[FB-Buff]${workerTag} [${i + 1}/${workerPages.length}] ⚡ Engaging as Page: "${pageInfo.name}" (ID: ${pageInfo.id})...`);

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

          const { actionBlocked, automatedWarning, browserDead, tabCrashed, cookieDead, isCheckpoint, isExpired, deadReason, item: resultItem } = await executePageInteraction({
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
            shouldStop: () => isStopRequested() || globalStopTriggered || (effectiveKpi > 0 && results.success >= effectiveKpi),
          });

          if (tabCrashed) {
            try {
              workerTab = await recycleHealthyTab(workerContext, workerTab, trackedTabs);
            } catch (tErr) {
              globalStopTriggered = true;
              results.stopped = true;
              results.failed++;
              results.details.push(resultItem);
              console.error(`[FB-Buff]${workerTag} 🛑 Could not recover the tab after a crash: ${tErr.message}`);
              break;
            }
          }

          if (browserDead) {
            globalStopTriggered = true;
            results.stopped = true;
            results.failed++;
            results.details.push(resultItem);
            console.error(`[FB-Buff]${workerTag} 🛑 The Chromium browser was closed or lost its connection! Stopping the thread now.`);
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
            console.error(`[FB-Buff]${workerTag} 🚨 VIA COOKIE EXPIRED / CHECKPOINT DETECTED (${deadReason})! Stopping the thread now to protect it.`);
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

          if (actionBlocked || automatedWarning) {
            results.consecutiveBlocks = (results.consecutiveBlocks || 0) + 1;
            results.failed++;
            results.details.push(resultItem);
            console.warn(`[FB-Buff]${workerTag} ⚠️ Page "${pageInfo.name}" hit ${automatedWarning ? 'an AUTOMATED BEHAVIOR WARNING' : 'Action Blocked'} (${results.consecutiveBlocks} in a row). Skipping to the next page...`);
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
            if (automatedWarning || results.consecutiveBlocks >= 3) {
              globalStopTriggered = true;
              results.stopped = true;
              if (automatedWarning) {
                results.cookieDead = true;
                results.isCheckpoint = true;
                results.deadViaUid = uid;
                results.deadReason = 'Facebook warned about suspected automated behavior';
              }
              console.error(`[FB-Buff]${workerTag} 🛑 ${automatedWarning ? 'Stopping immediately because Facebook suspects automated behavior!' : `Action Blocked ${results.consecutiveBlocks} times in a row! Stopping this worker to protect the Via.`}`);
              break;
            }
            // Rest another 8s before trying the next page
            await new Promise((r) => setTimeout(r, 8000));
            continue;
          } else {
            results.consecutiveBlocks = 0;
          }

          completedCount++;
          if (resultItem.status === 'SUCCESS') {
            results.success++;
          } else if (resultItem.status === 'ALREADY_LIKED') {
            results.alreadyLiked++;
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
            console.log(`[FB-Buff]${workerTag} 🎯 [KPI REACHED] Reached KPI ${results.success}/${effectiveKpi} successful Likes!`);
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
                message: `🎯 Reached KPI ${results.success}/${effectiveKpi} successful Likes!`,
              });
            }
            break;
          }

          // Anti-checkpoint: safe per-worker Batch Cooldown
          if (cooldownEvery < 9999 && i > 0 && i % cooldownEvery === 0 && i < workerPages.length - 1) {
            const isBigBatch = i % (cooldownEvery * 2) === 0;
            const batchRest = computeBatchCooldownMs(cooldownDurationMs, speedMode, isBigBatch);
            const restSec = Math.round(batchRest / 1000);
            const restMsg = `🛡️ [Safe Human Pacing] Cooling down the Via (${restSec}s) to reset Facebook's rate counter...`;
            console.log(`[FB-Buff]${workerTag} 🛡️ [ANTI-CHECKPOINT BM] Finished ${i} Pages. ${restMsg}`);

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

          // Reduce Chromium RAM on large batches: recreate a clean tab every 20 pages
          if (i > 0 && i % 20 === 0 && i < workerPages.length - 1) {
            try {
              workerTab = await recycleHealthyTab(workerContext, workerTab, trackedTabs);
            } catch (_) {}
          }

          // Optimal delay between pages
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
    // MODE 2: SINGLE-THREAD SEQUENTIAL BUFF (SINGLE-WORKER PERSISTENT)
    // ========================================================
    let context = null;
    let browser = null;

    if (uid) {
      const profileDir = path.join(PROFILES_DIR, `via_${uid}`);
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
      if (tab) {
        trackedTabs.add(tab);
        registerLightweightTabRoutes(tab);
      }

      console.log(`[FB-Buff] 🌐 Loading the target post before starting the thread: ${targetUrl}`);
      let effectiveTargetUrl = targetUrl;
      try {
        await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await tab.waitForTimeout(1000);
        const redirected = tab.url();
        if (redirected && redirected.includes('facebook.com') && !redirected.includes('/share/')) {
          effectiveTargetUrl = redirected;
          console.log(`[FB-Buff] 🔗 Detected the original post link: ${effectiveTargetUrl}`);
          if (isValidCanonicalFbPostUrl(redirected)) {
            registerPostUrlAlias(normalizedPostUrl, redirected);
          }
        }
      } catch (e) {
        console.warn(`[FB-Buff] ⚠️ Error loading the initial post (${e.message}), will retry automatically.`);
      }

      const isUnavailable = await checkFacebookContentUnavailable(tab);
      if (isUnavailable) {
        console.warn(`[FB-Buff] 🛑 Post unavailable (hidden/deleted/privacy-restricted): ${isUnavailable}`);
        results.stopped = true;
        results.error = 'The post does not exist or was deleted, hidden or privacy-restricted by its author on Facebook.';
        return results;
      }

      for (let i = 0; i < pages.length; i++) {
        if (isStopRequested()) {
          results.stopped = true;
          console.warn(`[FB-Buff] 🛑 EMERGENCY STOP detected! Stopping the loop at page ${i + 1}/${pages.length}`);
          break;
        }

        try {
          tab = await ensureTabHealthy(context, tab, trackedTabs);
        } catch (tErr) {
          if (tErr.isBrowserDead || (tErr.message && tErr.message.includes('closed'))) {
            results.stopped = true;
            console.error(`[FB-Buff] 🛑 The browser was closed. Stopping the task now.`);
            break;
          }
        }

        const pageInfo = pages[i];
        if (pageInfo && pageInfo.id && hasPageInteractedWithPost(normalizedPostUrl, pageInfo.id)) {
          completedCount++;
          results.alreadyLiked++;
          const skippedItem = {
            pageId: pageInfo.id,
            pageName: pageInfo.name,
            status: 'ALREADY_LIKED',
            likeStatus: 'ALREADY_LIKED',
            commentStatus: 'SKIPPED',
            shareStatus: 'SKIPPED',
            message: 'Already liked (skipped automatically via the original link)',
          };
          results.details.push(skippedItem);
          if (typeof onProgress === 'function') {
            const pct = effectiveKpi > 0
              ? Math.min(100, Math.round((results.success / effectiveKpi) * 100))
              : Math.round((completedCount / pages.length) * 100);
            onProgress({
              type: 'PAGE_FINISH',
              index: i,
              total: effectiveKpi > 0 ? effectiveKpi : pages.length,
              kpiTarget: effectiveKpi > 0 ? effectiveKpi : undefined,
              ...skippedItem,
              percent: pct,
              workerId: 1,
            });
          }
          continue;
        }
        console.log(`[FB-Buff] [${i + 1}/${pages.length}] ⚡ Engaging as Page: "${pageInfo.name}" (ID: ${pageInfo.id})...`);

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

        const { actionBlocked, automatedWarning, browserDead, tabCrashed, cookieDead, isCheckpoint, isExpired, deadReason, item: resultItem } = await executePageInteraction({
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
          shouldStop: () => isStopRequested() || (effectiveKpi > 0 && results.success >= effectiveKpi),
        });

          if (tabCrashed) {
            try {
              tab = await recycleHealthyTab(context, tab, trackedTabs);
            } catch (tErr) {
              results.stopped = true;
              results.failed++;
              results.details.push(resultItem);
              console.error(`[FB-Buff] 🛑 Could not recover the tab after a crash: ${tErr.message}`);
              break;
            }
          }

          if (browserDead) {
            results.stopped = true;
            results.failed++;
            results.details.push(resultItem);
            console.error('[FB-Buff] 🛑 The Chromium browser was closed or lost its connection! Stopping the task now.');
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
            console.error(`[FB-Buff] 🚨 VIA COOKIE EXPIRED / CHECKPOINT DETECTED (${deadReason})! Stopping the task now.`);
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

          if (actionBlocked || automatedWarning) {
            // Don't stop everything — just skip this page and continue with the next
            // But if blocked >= 3 times in a row (or an automated warning appears), stop to protect the Via
            results.consecutiveBlocks = (results.consecutiveBlocks || 0) + 1;
            results.failed++;
            results.details.push(resultItem);
            console.warn(`[FB-Buff] ⚠️ Page "${pageInfo.name}" hit ${automatedWarning ? 'an AUTOMATED BEHAVIOR WARNING' : 'Action Blocked'} (${results.consecutiveBlocks} in a row). Skipping to the next page...`);
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
            if (automatedWarning || results.consecutiveBlocks >= 3) {
              results.stopped = true;
              if (automatedWarning) {
                results.cookieDead = true;
                results.isCheckpoint = true;
                results.deadViaUid = uid;
                results.deadReason = 'Facebook warned about suspected automated behavior';
              }
              console.error(`[FB-Buff] 🛑 ${automatedWarning ? 'Stopping immediately because Facebook suspects automated behavior!' : `Action Blocked ${results.consecutiveBlocks} times in a row! Stopping the task to protect the Via.`}`);
              break;
            }
            // Rest another 15s before trying the next page
            await cancellableSleep(15000, signal);
            completedCount++;
            continue;
          }

          // Reset the consecutive block counter when a page succeeds
          results.consecutiveBlocks = 0;

          completedCount++;
          if (resultItem.status === 'SUCCESS') {
            results.success++;
          } else if (resultItem.status === 'ALREADY_LIKED') {
            results.alreadyLiked++;
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

          // SMART KPI AUTO-REFILL: once the KPI is reached, finish early and stop the task automatically
          if (effectiveKpi > 0 && results.success >= effectiveKpi) {
            console.log(`[FB-Buff] 🎯 [KPI REACHED] Reached KPI ${results.success}/${effectiveKpi} successful Likes! Stopping the task (after ${i + 1} attempts, auto-replaced ${results.failed} failed Pages).`);
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
                message: `🎯 Reached KPI ${results.success}/${effectiveKpi} successful Likes! (auto-replaced ${results.failed} failed pages)`,
              });
            }
            break;
          }

          // Anti-checkpoint: safe Batch Cooldown
          if (cooldownEvery < 9999 && i > 0 && i % cooldownEvery === 0 && i < pages.length - 1) {
            const isBigBatch = i % (cooldownEvery * 2) === 0;
            const batchRest = computeBatchCooldownMs(cooldownDurationMs, speedMode, isBigBatch);
            const restSec = Math.round(batchRest / 1000);
            const restMsg = `🛡️ [Safe Human Pacing] Cooling down the Via (${restSec}s) to reset Facebook's rate counter...`;
            console.log(`[FB-Buff] 🛡️ [ANTI-CHECKPOINT BM] Finished ${i} Pages. ${restMsg}`);

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

          // Reduce Chromium RAM on large batches: recreate a clean tab every 20 pages
          if (i > 0 && i % 20 === 0 && i < pages.length - 1) {
            try {
              tab = await recycleHealthyTab(context, tab, trackedTabs);
            } catch (_) {}
          }

          // Optimal delay between pages
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
    flushRegistry();

    console.log(`[FB-Buff] 🏁 Like buff finished: ${results.success}/${effectiveKpi > 0 ? effectiveKpi : results.total} successful (already liked: ${results.alreadyLiked}, failed/replaced: ${results.failed}, threads: ${actualConcurrency})`);
    return results;
  }

  // ==========================================
  // 4. RAM-OPTIMIZED MULTI-THREAD VIDEO / REELS VIEW BUFF
  // ==========================================

  /**
   * Increases views for Facebook Videos / Reels (RAM and CPU optimized)
   * @param {string} targetVideoUrl - Video / Reels link to buff views for
   * @param {object} options - { targetViews, concurrency, watchTimeSeconds, cookieStr }
   */
  async function buffViews(targetVideoUrl, options = {}) {
    const {
      targetViews = 10,       // Number of views to buff
      concurrency = 2,        // Number of parallel viewing threads
      watchTimeSeconds = 6,   // Watch time per view (FB counts a view after 3-5s+)
      cookieStr = null,       // Cookie (optional, public views don't need a login)
    } = options;

    console.log(`[FB-Buff] 🚀 Starting fast, RAM-saving view buff for video: ${targetVideoUrl}`);
    console.log(`[FB-Buff] 🎯 Target: ${targetViews} Views | Threads: ${concurrency} | Watch time: ${watchTimeSeconds}s/view`);

    const cookies = cookieStr ? parseCookieString(cookieStr) : [];
    let completedViews = 0;
    let failedViews = 0;

    // Create ONE single Playwright browser instance (saves 90% RAM vs opening many browsers)
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
            // Block heavy resources to save as much CPU and network bandwidth as possible
            await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot,ico}', (route) => route.abort());

            console.log(`[FB-Buff] [Thread ${workerId}] Watching video (View #${currentTaskNum}/${targetViews})...`);
            await page.goto(targetVideoUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

            // Auto-play the video if paused
            await page.evaluate(() => {
              const videos = document.querySelectorAll('video');
              videos.forEach((v) => {
                v.muted = true;
                v.play().catch(() => { });
              });
            });

            // Keep watching for watchTimeSeconds
            await page.waitForTimeout(watchTimeSeconds * 1000);

            completedViews++;
            console.log(`[FB-Buff] [Thread ${workerId}] ✅ Finished 1 view (${completedViews}/${targetViews})`);
          } catch (err) {
            failedViews++;
            console.warn(`[FB-Buff] [Thread ${workerId}] ⚠️ Error while watching the video: ${err.message}`);
          } finally {
            if (context) await context.close().catch(() => { });
          }

          // Short delay between views
          await new Promise((r) => setTimeout(r, 600));
        }
      };

      // Launch the parallel workers in the same browser
      const workers = [];
      const actualConcurrency = Math.min(concurrency, targetViews);
      for (let i = 1; i <= actualConcurrency; i++) {
        workers.push(runViewWorker(i));
      }

      await Promise.all(workers);
    } finally {
      await browser.close().catch(() => { });
    }

    console.log(`[FB-Buff] 🏁 View buff finished: ${completedViews}/${targetViews} successful`);
    return {
      totalTarget: targetViews,
      completed: completedViews,
      failed: failedViews,
    };
  }

  /**
   * 6. FACEBOOK POST HUNTER — Scans and extracts the latest posts from a Fanpage / Group / Profile
   * Ultra-light (blocks media/fonts), auto-finds new posts to feed into the Auto-Buff queue
   * @param {string} targetUrl URL of the Fanpage, Group or Profile
   * @param {object} options Options: cookieStr, maxPosts, timeoutMs
   */
  // Determine the target type (Group / Page) to scan in the right order and filter the right post links
  function getScanTargetInfo(rawUrl) {
    let url;
    try {
      url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://www.facebook.com/${rawUrl.replace(/^\/+/, '')}`);
    } catch (_) {
      return { type: 'UNKNOWN', scanUrl: rawUrl };
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'groups' && segments[1]) {
      // Group: view by "New posts" so the newest post is on top
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
      // In a Group feed only accept Group post links (Page/Reel links are reshares)
      return first === 'groups' && /^(posts|permalink)$/.test(segments[2] || '');
    }
    if (info.type === 'PAGE') {
      if (first === 'reel' || first === 'watch' || first === 'share') return true; // Reel/Video/Share links don't carry the owner's name
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
      browser: externalBrowser = null,
    } = options;

    if (!targetUrl || typeof targetUrl !== 'string') {
      throw new Error('Missing target page URL');
    }

    const targetInfo = getScanTargetInfo(targetUrl.trim());
    const cleanTarget = targetInfo.scanUrl;
    const proxy = parseProxy(proxyUrl);
    console.log(`[FB-Hunter] 🔍 Scanning new posts from: ${cleanTarget} (Max: ${maxPosts})`);

    let browser = externalBrowser;
    const ownsBrowser = !externalBrowser;
    let context = null;
    const discoveredPosts = [];

    try {
      if (!browser) {
        browser = await chromium.launch({
          headless: true,
          args: OPTIMIZED_CHROMIUM_ARGS,
          proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
        });
      }


      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'vi-VN',
      });

      // Block images/video/fonts to scan very fast, saving 80% RAM & network
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
        console.warn(`[FB-Hunter] ⚠️ Page load (${e.message}), continuing with the current DOM...`);
      });

      await page.waitForTimeout(3000);

      // Scroll gently 1-2 times to trigger lazy loading of the Facebook Feed
      for (let s = 0; s < 2; s++) {
        await page.evaluate(() => window.scrollBy({ top: 900, behavior: 'smooth' })).catch(() => { });
        await page.waitForTimeout(1400);
      }

      // Facebook hides post links in the timestamp (href "?__cft__..." / "#") and only shows the real link on hover.
      // Hover those links in each post block (in feed order, newest on top) to reveal the permalink.
      // The revealed link only exists while the mouse is over it → read it right after hovering.
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
          if (revealed && /story_fbid=|\/posts\/|\/permalink\/|\/share\//.test(revealed)) {
            const unitText = await unit.evaluate((el) => (el.innerText || '').trim().slice(0, 300)).catch(() => '');
            const isPinned = /đã ghim|bài viết đã ghim|pinned post/i.test(unitText) ||
              Boolean(await unit.$('[aria-label*="ghim" i], [aria-label*="pin" i]').catch(() => null));
            revealedLinks.push({ href: revealed, text: unitText.slice(0, 150), isPinned });
            break; // 1 permalink per post block is enough
          }
        }
      }

      // Extract every post link (posts revealed from timestamps first, in feed order)
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
        /\/share\/(?:p|v|r)\/[a-zA-Z0-9_-]+/i,
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
        // Drop post links from elsewhere (reshares, suggestions...) — only keep posts that belong to the target
        if (!isLinkOwnedByTarget(href, targetInfo)) continue;

        // Normalize by stripping Facebook tracking queries
        const cleanUrl = href.replace(/[?&](?:mibextid|fbclid|rdid|__cft__\[0\]|__tn__|ref)=[^&]*/g, '').replace(/[?&]$/, '');
        const normalized = normalizeFbPostUrl(cleanUrl);

        // Drop links that aren't specific posts
        if (/\/(posts|videos|reels)$/.test(normalized.split('?')[0])) {
          continue;
        }

        if (seenUrls.has(normalized)) continue;
        seenUrls.add(normalized);

        discoveredPosts.push({
          url: cleanUrl,
          normalizedUrl: normalized,
          title: item.text || 'Facebook post',
          isPinned: Boolean(item.isPinned),
          foundAt: new Date().toISOString(),
        });

        if (discoveredPosts.length >= maxPosts) break;
      }

      console.log(`[FB-Hunter] 🎯 Found ${discoveredPosts.length} valid posts from ${cleanTarget}`);
    } catch (err) {
      console.error(`[FB-Hunter] ❌ Error scanning target ${cleanTarget}:`, err.message);
    } finally {
      if (context) await context.close().catch(() => { });
      if (ownsBrowser && browser) await browser.close().catch(() => { });
    }

    return discoveredPosts;
  }

  /**
   * 7. VIA SESSION VALIDATOR — Checks Via account health (LIVE vs CHECKPOINT / EXPIRED)
   * @param {string} cookieStr The Via's Cookie
   * @param {object} options Options proxyUrl, timeoutMs
   */
  async function validateViaSession(cookieStr, options = {}) {
    const { proxyUrl = '', timeoutMs = 20000 } = options;
    if (!cookieStr || !cookieStr.includes('c_user=')) {
      return { isLive: false, status: 'NO_COOKIE', error: 'Cookie string is empty or has no c_user' };
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
          console.warn(`[ViaValidator] ⚠️ Network error while checking Via ${uid}: ${errStr}`);
          return { isLive: false, status: 'NETWORK_ERROR', uid, error: errStr };
        }
      }

      await page.waitForTimeout(2500);
      const currentUrl = page.url();

      // If the Facebook page can't load due to a network error / blank page
      if (!currentUrl || currentUrl === 'about:blank' || !currentUrl.startsWith('http')) {
        console.warn(`[ViaValidator] ⚠️ Facebook page not responding (URL: ${currentUrl}), not marking as an error.`);
        return { isLive: false, status: 'NETWORK_ERROR', uid, error: 'Could not load the Facebook page' };
      }

      if (currentUrl.includes('/checkpoint') || currentUrl.includes('checkpoint')) {
        console.warn(`[ViaValidator] 🛑 Via ${uid} IS CHECKPOINTED! (URL: ${currentUrl})`);
        return { isLive: false, status: 'CHECKPOINT', uid, url: currentUrl };
      }

      const hasLoginForm = (await page.locator('input[name="email"], input[name="pass"], #login_form').count().catch(() => 0)) > 0;
      const title = await page.title().catch(() => '');
      const isLoginPage = hasLoginForm || /đăng nhập|log in|login/i.test(title);

      if (currentUrl.includes('/login') || currentUrl.includes('login_attempt') || isLoginPage) {
        console.warn(`[ViaValidator] ❌ Via ${uid} COOKIE EXPIRED / LOGGED OUT! (login form detected)`);
        return { isLive: false, status: 'EXPIRED', uid, url: currentUrl, error: 'Cookie expired or logged out of Facebook' };
      }

      console.log(`[ViaValidator] ✅ Via ${uid} IS HEALTHY (LIVE)! (Name: ${title})`);
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
   * Screenshots the Facebook post as proof of the buff result
   * @param {string} targetUrl - Post URL
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
      path.join(dataDir, 'screenshots', `proof_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Automatically clean up proof images older than 7 days so the disk doesn't fill up
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
      // Block heavy video to save RAM & CPU, keep images so the post renders nicely
      await page.route('**/*.{mp4,mov,m4v,avi,webm,m3u8,ts}', (route) => route.abort());
      await page.route('**/*{google-analytics,doubleclick,connect.facebook.net/signals,pixel.facebook.com,facebook.com/tr/}*', (route) => route.abort());

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => { });
      await page.waitForTimeout(3000);

      // Capture the main post block or the viewport
      const article = await page.$('div[role="article"]').catch(() => null);
      if (article) {
        await article.screenshot({ path: targetPath }).catch(async () => {
          await page.screenshot({ path: targetPath, fullPage: false });
        });
      } else {
        await page.screenshot({ path: targetPath, fullPage: false });
      }

      console.log(`[FB-Proof] 📸 Proof screenshot captured: ${targetPath}`);
      return { success: true, filePath: targetPath };
    } catch (err) {
      console.warn(`[FB-Proof] ⚠️ Error capturing the proof screenshot: ${err.message}`);
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
    mergeCachedAndDbPages,
    getCachedPages,
    setCachedPages,
    loadPagesCache,
    savePagesCache,
    recordPageSwitchOutcome,
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
    resolvePostUrlCanonical,
    registerPostUrlAlias,
    resolveSpintax,
    executePostShare,
    switchTabIdentity,
    ensureTabHealthy,
    recycleHealthyTab,
    SEEDING_PRESETS,
    OPTIMIZED_CHROMIUM_ARGS,
  };

  // ==========================================
  // 5. DIRECT CLI TEST
  // ==========================================
  if (require.main === module) {
    const args = process.argv.slice(2);
    const action = args[0]; // 'get-pages' | 'buff-like' | 'buff-view'

    console.log('--- FB BUFF ENGAGEMENT TOOL ---');
    console.log('Usage:');
    console.log('  node fb-buff-tool.js get-pages "<COOKIE>"');
    console.log('  node fb-buff-tool.js buff-like "<COOKIE>" "<POST_URL>" [REACTION_TYPE]');
    console.log('  node fb-buff-tool.js buff-view "<VIDEO_URL>" [TARGET_VIEWS] [CONCURRENCY]');
    console.log('-------------------------------\n');

    if (action === 'get-pages') {
      const cookie = args[1];
      if (!cookie) {
        console.error('Please provide a Cookie string!');
        process.exit(1);
      }
      getManagedPages(cookie)
        .then((pages) => console.log('RESULT:', JSON.stringify(pages, null, 2)))
        .catch((err) => console.error('ERROR:', err.message));
    } else if (action === 'buff-like') {
      const cookie = args[1];
      const postUrl = args[2];
      const reaction = args[3] || 'LIKE';
      if (!cookie || !postUrl) {
        console.error('Please provide a Cookie and a post link!');
        process.exit(1);
      }
      buffLikesWithPages(cookie, postUrl, { reactionType: reaction })
        .then((res) => console.log('RESULT:', res))
        .catch((err) => console.error('ERROR:', err.message));
    } else if (action === 'buff-view') {
      const videoUrl = args[1];
      const targetViews = parseInt(args[2], 10) || 5;
      const concurrency = parseInt(args[3], 10) || 2;
      if (!videoUrl) {
        console.error('Please provide a Video/Reels link!');
        process.exit(1);
      }
      buffViews(videoUrl, { targetViews, concurrency })
        .then((res) => console.log('RESULT:', res))
        .catch((err) => console.error('ERROR:', err.message));
    }
  }
