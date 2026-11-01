/**
 * AVATAR TOOL - QUẢN LÝ & CẬP NHẬT ẢNH ĐẠI DIỆN HÀNG LOẠT CHO DÀN FANPAGE
 * Hỗ trợ:
 * 1. Quét trạng thái Avatar (Phát hiện Page chưa có Avatar / Silhouette qua Facebook Graph API).
 * 2. Cung cấp kho Avatar chân dung AI HD đa dạng (Nữ, Nam, Phong cảnh, Thú cưng, Tùy chỉnh).
 * 3. Tự động chuyển danh tính và tải ảnh đại diện lên Facebook bằng Playwright Automation.
 */

const { chromium } = require('playwright');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { getDeviceForUid, applyFingerprintToContext } = require('./device-fingerprints');
const { parseCookieString, parseProxy } = require('./fb-buff-tool');

const DATA_DIR = path.join(__dirname, 'data');
const TEMP_AVATARS_DIR = path.join(DATA_DIR, 'temp_avatars');
const CUSTOM_AVATARS_DIR = path.join(DATA_DIR, 'custom_avatars');

if (!fs.existsSync(TEMP_AVATARS_DIR)) fs.mkdirSync(TEMP_AVATARS_DIR, { recursive: true });
if (!fs.existsSync(CUSTOM_AVATARS_DIR)) fs.mkdirSync(CUSTOM_AVATARS_DIR, { recursive: true });

// Danh sách các cờ tối ưu hóa tốc độ cho Chromium
const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-notifications',
  '--mute-audio',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-webrtc',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  '--enforce-webrtc-ip-permission-check',
  '--no-first-run',
  '--no-default-browser-check',
];

// =============================================================================
const AVATAR_STATUS_CACHE_FILE = path.join(DATA_DIR, 'avatar_status_cache.json');
const COVER_STATUS_CACHE_FILE = path.join(DATA_DIR, 'cover_status_cache.json');

let memoryAvatarCache = null;
let lastAvatarCacheReadTime = 0;
const AVATAR_CACHE_TTL_MS = 15000;

function loadAvatarCache() {
  const now = Date.now();
  if (memoryAvatarCache && now - lastAvatarCacheReadTime < AVATAR_CACHE_TTL_MS) {
    return memoryAvatarCache;
  }
  try {
    if (fs.existsSync(AVATAR_STATUS_CACHE_FILE)) {
      memoryAvatarCache = JSON.parse(fs.readFileSync(AVATAR_STATUS_CACHE_FILE, 'utf8'));
      lastAvatarCacheReadTime = now;
      return memoryAvatarCache;
    }
  } catch (e) {
    console.warn('[AvatarTool] ⚠️ Lỗi đọc avatar_status_cache.json:', e.message);
  }
  return memoryAvatarCache || {};
}

function saveAvatarCache(cacheObj) {
  memoryAvatarCache = cacheObj;
  lastAvatarCacheReadTime = Date.now();
  try {
    const tmp = `${AVATAR_STATUS_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cacheObj, null, 2), 'utf8');
    fs.renameSync(tmp, AVATAR_STATUS_CACHE_FILE);
  } catch (e) {
    console.warn('[AvatarTool] ⚠️ Lỗi lưu avatar_status_cache.json:', e.message);
  }
}

function loadCoverCache() {
  try {
    if (fs.existsSync(COVER_STATUS_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(COVER_STATUS_CACHE_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[CoverTool] ⚠️ Lỗi đọc cover_status_cache.json:', e.message);
  }
  return {};
}

function saveCoverCache(cacheObj) {
  try {
    const tmp = `${COVER_STATUS_CACHE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cacheObj, null, 2), 'utf8');
    fs.renameSync(tmp, COVER_STATUS_CACHE_FILE);
  } catch (e) {
    console.warn('[CoverTool] ⚠️ Lỗi lưu cover_status_cache.json:', e.message);
  }
}

// =============================================================================
// 1. KIỂM TRA TRẠNG THÁI AVATAR HÀNG LOẠT (CHÍNH XÁC CACHE + GRAPH API)
// =============================================================================

/**
 * Quét trạng thái Avatar cho danh sách Fanpage:
 * Ưu tiên tra cứu từ Avatar Cache (được trích xuất 100% chính xác từ Facebook UI & GraphQL).
 * @param {Array<string|{id: string, name?: string}>} pages
 */
async function checkPagesAvatarStatus(pages = []) {
  const pageList = pages.map((p) => (typeof p === 'object' ? p : { id: String(p) }));
  if (pageList.length === 0) return { results: {}, stats: { total: 0, missingAvatar: 0, hasAvatar: 0 } };

  const cache = loadAvatarCache();
  const results = {};
  let missingAvatar = 0;
  let hasAvatar = 0;

  const uncached = [];
  for (const p of pageList) {
    const pid = String(p.id);
    if (cache[pid]) {
      results[pid] = cache[pid];
      if (cache[pid].hasAvatar) hasAvatar++;
      else missingAvatar++;
    } else {
      uncached.push(p);
    }
  }

  // Với các page chưa có trong cache, thử truy vấn
  if (uncached.length > 0) {
    const CHUNK_SIZE = 30;
    for (let i = 0; i < uncached.length; i += CHUNK_SIZE) {
      const chunk = uncached.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (p) => {
          const pageId = String(p.id);
          try {
            const res = await axios.get(`https://graph.facebook.com/${pageId}/picture?type=large&redirect=false`, {
              timeout: 5000,
            });
            const isSilhouette = Boolean(res.data?.data?.is_silhouette);
            const avatarUrl = res.data?.data?.url || '';
            return {
              pageId,
              isSilhouette,
              hasAvatar: !isSilhouette,
              avatarUrl,
              error: null,
            };
          } catch (err) {
            return {
              pageId,
              isSilhouette: true,
              hasAvatar: false,
              avatarUrl: `https://graph.facebook.com/${pageId}/picture?type=large`,
              error: err.message,
            };
          }
        })
      );

      for (const item of chunkResults) {
        results[item.pageId] = item;
        cache[item.pageId] = item;
        if (item.hasAvatar) hasAvatar++;
        else missingAvatar++;
      }
    }
    saveAvatarCache(cache);
  }

  return {
    results,
    stats: {
      total: pageList.length,
      missingAvatar,
      hasAvatar,
    },
  };
}

/**
 * Quét sâu trực tiếp từ Facebook Switcher & your_pages bằng Playwright
 * Trích xuất 100% chuẩn xác ảnh đại diện thật của toàn bộ dàn Fanpage
 */
async function scanLiveFanpageAvatars(cookieStr, options = {}) {
  const { maxRounds = 40, proxyUrl = '' } = options;
  const cookies = parseCookieString(cookieStr);
  if (!cookies.length) throw new Error('Cookie rỗng hoặc không đúng định dạng');

  const proxy = parseProxy(proxyUrl);
  const browser = await chromium.launch({
    headless: true,
    args: BROWSER_ARGS,
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
  });

  const avatarMap = loadAvatarCache();

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    await context.addCookies(cookies);
    const page = await context.newPage();

    const scanObj = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(scanObj);
      if (typeof o.id === 'string' && /^\d{9,}$/.test(o.id)) {
        const picUri = o.profile_picture?.uri || o.profile_photo?.uri || o.profilePicture?.uri || o.profile_image?.uri || o.picture?.uri || (typeof o.profile_picture === 'string' ? o.profile_picture : null);
        if (picUri) {
          const isDefault = picUri.includes('453178253_') || picUri.includes('84628273_') || picUri.includes('176159830') || picUri.includes('rsrc.php') || picUri.includes('102047530');
          avatarMap[o.id] = {
            pageId: o.id,
            name: o.name || avatarMap[o.id]?.name || '',
            avatarUrl: picUri,
            hasAvatar: !isDefault,
            isSilhouette: isDefault,
          };
        }
      }
      for (const k of Object.keys(o)) scanObj(o[k]);
    };

    page.on('response', async (r) => {
      if (!r.url().includes('/api/graphql')) return;
      try {
        const text = await r.text();
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try { scanObj(JSON.parse(line)); } catch (e) {}
        }
      } catch (e) {}
    });

    console.log('[AvatarTool] 🔄 Mở Facebook Home để quét switcher profiles...');
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    const profileBtn = page.locator('[aria-label="Trang cá nhân của bạn"], [aria-label="Your profile"]').first();
    if (await profileBtn.isVisible().catch(() => false)) {
      await profileBtn.click();
      await page.waitForTimeout(2000);
      const seeAll = page.getByText(/^(Xem tất cả trang cá nhân|See all profiles)$/).first();
      if (await seeAll.isVisible().catch(() => false)) {
        await seeAll.click();
        await page.waitForTimeout(3000);

        const dialog = page.locator('div[role="dialog"]').filter({ hasText: /Trang & trang cá nhân của bạn|Your profiles and Pages/ }).first();
        for (let i = 0; i < maxRounds; i++) {
          const more = dialog.getByText(/^(Xem thêm trang|See more Pages|See more pages)$/).first();
          if (!(await more.isVisible().catch(() => false))) {
            await dialog.evaluate((dlg) => {
              const scroller = dlg.querySelector('div[style*="overflow"], div.x78zum5') || dlg;
              scroller.scrollTop += 2000;
            }).catch(() => {});
            await page.waitForTimeout(1000);
            if (!(await more.isVisible().catch(() => false))) break;
          }
          await more.click().catch(() => {});
          await page.waitForTimeout(1100);
        }
      }
    }

    saveAvatarCache(avatarMap);
    console.log(`[AvatarTool] 💾 Đã lưu cache trạng thái Avatar cho ${Object.keys(avatarMap).length} Fanpage.`);

    const items = Object.values(avatarMap);
    return {
      success: true,
      results: avatarMap,
      stats: {
        total: items.length,
        hasAvatar: items.filter((i) => i.hasAvatar).length,
        missingAvatar: items.filter((i) => !i.hasAvatar).length,
      },
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// =============================================================================
// 2. KHO AVATAR MẪU (PRESET CURATED COLLECTIONS)
// =============================================================================

function getAvatarPresets() {
  const women = [];
  for (let i = 1; i <= 95; i++) {
    women.push(`https://randomuser.me/api/portraits/women/${i}.jpg`);
  }

  const men = [];
  for (let i = 1; i <= 95; i++) {
    men.push(`https://randomuser.me/api/portraits/men/${i}.jpg`);
  }

  const nature = [];
  for (let i = 10; i <= 60; i++) {
    nature.push(`https://picsum.photos/id/${i * 10}/400/400.jpg`);
  }

  const cutePets = [
    'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1573865526739-10659fec78a5?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1537151608828-ea2b11777ee8?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1561037404-61cd46aa615b?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1548767797-d8c844163c4c?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?w=400&h=400&fit=crop',
    'https://images.unsplash.com/photo-1592194996308-7b43878e84a6?w=400&h=400&fit=crop',
  ];

  return {
    categories: [
      {
        id: 'WOMEN_PORTRAIT',
        name: 'Chân dung Nữ (Hot Girl & Nữ Doanh Nhân)',
        desc: 'Ảnh chân dung nữ sắc nét, tự nhiên chuẩn tỷ lệ 1:1',
        icon: '👩',
        items: women,
      },
      {
        id: 'MEN_PORTRAIT',
        name: 'Chân dung Nam (Mỹ Nam & Lịch Lãm)',
        desc: 'Ảnh chân dung nam đa dạng phong cách, chuẩn Facebook',
        icon: '👨',
        items: men,
      },
      {
        id: 'NATURE_AESTHETIC',
        name: 'Phong Cảnh & Đời Sống HD',
        desc: 'Ảnh thiên nhiên, phong cảnh nghệ thuật chất lượng cao',
        icon: '🌿',
        items: nature,
      },
      {
        id: 'CUTE_PETS',
        name: 'Thú Cưng & Chó Mèo Cute',
        desc: 'Hình ảnh cún và mèo cưng dễ thương thu hút tương tác',
        icon: '🐱',
        items: cutePets,
      },
      {
        id: 'RANDOM_MIX',
        name: 'Ngẫu Nhiên Toàn Bộ (Khuyên Dùng)',
        desc: 'Tự động phân phối luân phiên ngẫu nhiên mỗi page một ảnh khác nhau',
        icon: '🎲',
        items: [...women, ...men, ...cutePets],
      },
    ],
  };
}

/**
 * Tải file ảnh từ URL về thư mục tạm trên ổ cứng để Playwright upload
 */
async function downloadImageToTemp(url, prefix = 'avatar') {
  const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
  const filePath = path.join(TEMP_AVATARS_DIR, filename);

  const writer = fs.createWriteStream(filePath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 15000,
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(filePath));
    writer.on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
}

// =============================================================================
// 3. THỰC THI CẬP NHẬT AVATAR TỰ ĐỘNG BẰNG PLAYWRIGHT
// =============================================================================

/**
 * Đổi Avatar cho danh sách Fanpage đã chọn
 * @param {string} cookieString Cookie nick Mẹ
 * @param {Array<{id: string, name: string, imageUrl?: string}>} pagesToUpdate
 * @param {object} options
 * @param {function} onProgress
 */
async function bulkUpdateFanpageAvatars(cookieString, pagesToUpdate = [], options = {}, onProgress = null) {
  const {
    presetCategory = 'RANDOM_MIX',
    customImages = [], // Danh sách đường dẫn ảnh local hoặc base64
    delaySeconds = 4,
    proxyUrl = '',
  } = options;

  if (!cookieString) {
    throw new Error('Thiếu Cookie nick Mẹ sở hữu Fanpage');
  }

  if (pagesToUpdate.length === 0) {
    return { success: true, total: 0, updatedCount: 0, details: [] };
  }

  const presets = getAvatarPresets();
  const selectedCat = presets.categories.find((c) => c.id === presetCategory) || presets.categories[4];
  const presetPool = selectedCat.items;

  const cookies = parseCookieString(cookieString);
  const cUserMatch = cookieString.match(/(?:^|;\s*)c_user=([^;]+)/);
  const uid = cUserMatch ? cUserMatch[1] : '';
  const device = getDeviceForUid(uid);
  const proxy = parseProxy(proxyUrl);

  const profileDir = path.join(__dirname, 'browser_profiles', `via_${uid || 'avatar_worker'}`);
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(`[AvatarStudio] 🎨 Bắt đầu cập nhật Avatar cho ${pagesToUpdate.length} Fanpage (UID Via: ${uid || 'N/A'})...`);

  let context = null;
  const details = [];
  let updatedCount = 0;
  const avatarCacheMap = loadAvatarCache();

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      args: BROWSER_ARGS,
      proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
      userAgent: device.userAgent,
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
    });

    await applyFingerprintToContext(context, device);
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }

    const tab = context.pages().length ? context.pages()[0] : await context.newPage();

    for (let i = 0; i < pagesToUpdate.length; i++) {
      const pageItem = pagesToUpdate[i];
      const pageId = String(pageItem.id);
      const pageName = pageItem.name || `Page ${pageId}`;
      let localTempFile = null;

      if (typeof options.shouldStop === 'function' && options.shouldStop()) {
        console.log('[AvatarStudio] 🛑 Đã nhận tín hiệu dừng từ người dùng.');
        break;
      }

      if (typeof onProgress === 'function') {
        onProgress({
          type: 'PAGE_START',
          index: i + 1,
          total: pagesToUpdate.length,
          pageId,
          pageName,
          status: 'RUNNING',
          message: `[${i + 1}/${pagesToUpdate.length}] Đang xử lý tải ảnh & đổi Avatar...`,
        });
      }

      try {
        // 1. Chuẩn bị file ảnh cho Page này
        if (customImages.length > 0) {
          const chosenCustom = customImages[i % customImages.length];
          if (typeof chosenCustom === 'string' && chosenCustom.startsWith('data:image')) {
            // Base64 image
            const base64Data = chosenCustom.replace(/^data:image\/\w+;base64,/, '');
            const tmpFile = path.join(TEMP_AVATARS_DIR, `custom_b64_${Date.now()}_${i}.jpg`);
            fs.writeFileSync(tmpFile, Buffer.from(base64Data, 'base64'));
            localTempFile = tmpFile;
          } else if (typeof chosenCustom === 'string' && chosenCustom.startsWith('http')) {
            localTempFile = await downloadImageToTemp(chosenCustom, `custom_url_${pageId}`);
          } else if (typeof chosenCustom === 'string' && fs.existsSync(chosenCustom)) {
            localTempFile = chosenCustom;
          }
        }

        if (!localTempFile) {
          // Lấy từ kho ảnh mẫu hoặc URL chỉ định
          const chosenUrl = pageItem.imageUrl || presetPool[i % presetPool.length];
          localTempFile = await downloadImageToTemp(chosenUrl, `p_${pageId}`);
        }

        // 2. Chuyển sang danh tính Page (Switch Profile)
        console.log(`[AvatarStudio] 🔄 [${i + 1}/${pagesToUpdate.length}] Chuyển sang danh tính Page: "${pageName}" (${pageId})...`);
        await tab.goto(`https://www.facebook.com/profile.php?id=${pageId}`, {
          waitUntil: 'domcontentloaded',
          timeout: 25000,
        }).catch(() => {});
        await tab.waitForTimeout(2500);

        // Bấm nút "Chuyển ngay" / "Switch now" nếu có
        const switchBtn = tab.locator('div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Chuyển"), [aria-label="Chuyển ngay"], [aria-label="Chuyển"], div[role="button"]:has-text("Switch now"), div[role="button"]:has-text("Switch")').first();
        if (await switchBtn.isVisible().catch(() => false)) {
          await switchBtn.click({ force: true }).catch(() => {});
          await tab.waitForTimeout(2500);

          const confirmBtn = tab.locator('div[role="dialog"] div[role="button"]:has-text("Chuyển"), div[role="dialog"] div[role="button"]:has-text("Switch")').first();
          if (await confirmBtn.isVisible().catch(() => false)) {
            await confirmBtn.click({ force: true }).catch(() => {});
            await tab.waitForTimeout(3000);
          }
        } else {
          // Fallback direct switch link
          const switchUrl = `https://www.facebook.com/profile/switch/?target_id=${pageId}`;
          await tab.goto(switchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          await tab.waitForTimeout(2000);
          const switchConfirm = tab.locator('div[role="button"]:has-text("Chuyển"), div[role="button"]:has-text("Switch")').first();
          if (await switchConfirm.isVisible().catch(() => false)) {
            await switchConfirm.click({ force: true }).catch(() => {});
            await tab.waitForTimeout(3000);
          }
        }

        // Cập nhật cookie i_user sang ID của Page
        await context.addCookies([
          {
            name: 'i_user',
            value: pageId,
            domain: '.facebook.com',
            path: '/',
            secure: true,
            sameSite: 'Lax',
          },
        ]);
        await tab.waitForTimeout(1000);

        // 3. Đóng mọi popup chào mừng ("Chào mừng bạn đến với Trang mới!", "Dùng Trang", v.v.)
        const dungTrangBtn = tab.locator('div[role="button"]:has-text("Dùng Trang"), div[role="button"]:has-text("Use Page"), div[role="button"]:has-text("Bắt đầu khám phá"), div[aria-label="Đóng"], div[aria-label="Close"]').first();
        if ((await dungTrangBtn.count().catch(() => 0)) > 0 && (await dungTrangBtn.isVisible().catch(() => false))) {
          await dungTrangBtn.click({ force: true }).catch(() => {});
          await tab.waitForTimeout(1500);
        }
        await tab.keyboard.press('Escape').catch(() => {});
        await tab.waitForTimeout(1000);

        // 4. Tìm và kích hoạt nút Đổi ảnh đại diện (Camera button / Hành động với ảnh đại diện)
        const cameraLoc = tab.locator('div[aria-label*="ảnh đại diện"], div[aria-label*="Hành động với ảnh đại diện"], div[aria-label*="Cập nhật ảnh đại diện"], div[aria-label*="Profile picture" i]').first();
        if ((await cameraLoc.count().catch(() => 0)) === 0 || !(await cameraLoc.isVisible().catch(() => false))) {
          throw new Error('Không tìm thấy nút Camera đại diện trên Fanpage');
        }

        console.log(`[AvatarStudio] 📸 Đã tìm thấy nút đại diện, kích hoạt menu cho Page "${pageName}"...`);
        await cameraLoc.click({ force: true });
        await tab.waitForTimeout(2000);

        // 5. Trong popup menu, chọn "Chọn ảnh đại diện"
        const chooseAvatarMenuItem = tab.locator('div[role="menuitem"]:has-text("Chọn ảnh đại diện"), div[role="menuitem"]:has-text("Choose profile picture"), div[role="menuitem"]:has-text("Tải ảnh lên"), div[role="menuitem"]').first();
        if ((await chooseAvatarMenuItem.count().catch(() => 0)) > 0 && (await chooseAvatarMenuItem.isVisible().catch(() => false))) {
          await chooseAvatarMenuItem.click({ force: true }).catch(() => {});
          await tab.waitForTimeout(2500);
        }

        // 6. Trong hộp thoại "Chọn ảnh đại diện", bấm "+ Tải ảnh lên" và nạp file qua filechooser
        let uploadSuccess = false;
        const uploadBtn = tab.locator('div[role="dialog"] div[role="button"]:has-text("Tải ảnh lên"), div[role="dialog"] div[role="button"]:has-text("Upload photo"), div[role="dialog"] button:has-text("Tải ảnh lên")').first();

        if ((await uploadBtn.count().catch(() => 0)) > 0 && (await uploadBtn.isVisible().catch(() => false))) {
          const [fileChooser] = await Promise.all([
            tab.waitForEvent('filechooser', { timeout: 12000 }).catch(() => null),
            uploadBtn.click({ force: true }).catch(() => {}),
          ]);

          if (fileChooser) {
            await fileChooser.setFiles(localTempFile);
            uploadSuccess = true;
            console.log(`[AvatarStudio] 📤 Đã nạp file ảnh thành công cho Page "${pageName}"`);
          }
        }

        if (!uploadSuccess) {
          // Thử input file trực tiếp trong dialog
          const dialogFileInput = tab.locator('div[role="dialog"] input[type="file"]').first();
          if ((await dialogFileInput.count().catch(() => 0)) > 0) {
            await dialogFileInput.setInputFiles(localTempFile);
            uploadSuccess = true;
          }
        }

        if (!uploadSuccess) {
          throw new Error('Không thể mở hộp thoại chọn tệp của Facebook');
        }

        // 7. Đợi Facebook tải ảnh và bấm nút "Lưu" (Save) bắt buộc
        let saveClicked = false;
        const saveSelectors = [
          'div[role="dialog"] div[role="button"]:has-text("Lưu")',
          'div[role="dialog"] button:has-text("Lưu")',
          'div[role="dialog"] [aria-label="Lưu"]',
          'div[role="dialog"] div[role="button"]:has-text("Save")',
          'div[role="dialog"] button:has-text("Save")',
        ];

        for (let waitSec = 0; waitSec < 12; waitSec++) {
          await tab.waitForTimeout(1000);
          for (const sel of saveSelectors) {
            const btn = tab.locator(sel).first();
            if ((await btn.count().catch(() => 0)) > 0 && (await btn.isVisible().catch(() => false))) {
              await btn.click({ force: true }).catch(() => {});
              saveClicked = true;
              console.log(`[AvatarStudio] 💾 Đã bấm "Lưu" ảnh đại diện cho Page "${pageName}"...`);
              break;
            }
          }
          if (saveClicked) break;
        }

        if (!saveClicked) {
          throw new Error('Nút "Lưu" ảnh đại diện không xuất hiện trên Facebook (ảnh chưa tải lên xong hoặc mạng chậm)');
        }

        // Đợi modal lưu đóng lại xác nhận Facebook đã hoàn tất lưu
        await tab.waitForSelector('div[role="dialog"] div[role="button"]:has-text("Lưu")', {
          state: 'hidden',
          timeout: 25000,
        }).catch(() => {});
        await tab.waitForTimeout(3000);

        console.log(`[AvatarStudio] ✅ Cập nhật Avatar THÀNH CÔNG cho Page: "${pageName}" (ID: ${pageId})`);
        updatedCount++;

        // Cập nhật lại cache trạng thái avatar ngay lập tức
        if (avatarCacheMap[pageId]) {
          avatarCacheMap[pageId].hasAvatar = true;
          avatarCacheMap[pageId].isSilhouette = false;
        } else {
          avatarCacheMap[pageId] = {
            pageId,
            pageName,
            hasAvatar: true,
            isSilhouette: false,
            avatarUrl: chosenImageUrl,
            scannedAt: new Date().toISOString(),
          };
        }
        saveAvatarCache(avatarCacheMap);

        const detail = {
          pageId,
          pageName,
          status: 'SUCCESS',
          message: 'Cập nhật ảnh đại diện thành công',
          updatedAt: new Date().toISOString(),
        };
        details.push(detail);

        if (typeof onProgress === 'function') {
          onProgress({
            type: 'PAGE_FINISH',
            index: i + 1,
            total: pagesToUpdate.length,
            ...detail,
          });
        }
      } catch (pageErr) {
        console.warn(`[AvatarStudio] ⚠️ Lỗi cập nhật Page "${pageName}":`, pageErr.message);
        const detail = {
          pageId,
          pageName,
          status: 'ERROR',
          error: pageErr.message,
          message: `Lỗi: ${pageErr.message}`,
        };
        details.push(detail);

        if (typeof onProgress === 'function') {
          onProgress({
            type: 'PAGE_FINISH',
            index: i + 1,
            total: pagesToUpdate.length,
            ...detail,
          });
        }
      } finally {
        // Dọn dẹp file ảnh tạm nếu tạo từ URL
        if (localTempFile && localTempFile.includes(TEMP_AVATARS_DIR)) {
          fs.unlink(localTempFile, () => {});
        }
      }

      // Giãn cách nghỉ an toàn giữa các Page để chống checkpoint
      if (i < pagesToUpdate.length - 1) {
        const sleepMs = Math.max(1000, Number(delaySeconds) * 1000);
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    }
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }

  console.log(`[AvatarStudio] 🏁 Hoàn thành cập nhật Avatar: ${updatedCount}/${pagesToUpdate.length} Page thành công.`);
  return {
    success: true,
    total: pagesToUpdate.length,
    updatedCount,
    details,
  };
}

/**
 * Kho Ảnh Bìa mẫu độ phân giải cao tỉ lệ 16:9
 */
function getCoverPresets() {
  const nature = [
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1511884642898-4c92249e20b6?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=1200&h=675&fit=crop',
  ];
  const architecture = [
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1200&h=675&fit=crop',
  ];
  const tech = [
    'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1200&h=675&fit=crop',
  ];
  const business = [
    'https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=1200&h=675&fit=crop',
    'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1200&h=675&fit=crop',
  ];
  return {
    categories: [
      { id: 'NATURE_COVER', name: 'Thiên Nhiên & Phong Cảnh HD (16:9)', desc: 'Ảnh thiên nhiên, núi rừng, biển xanh nghệ thuật', icon: '🌿', items: nature },
      { id: 'MINIMAL_ARCH', name: 'Kiến Trúc & Tối Giản', desc: 'Không gian kiến trúc hiện đại, sang trọng', icon: '🏛️', items: architecture },
      { id: 'TECH_CYBER', name: 'Công Nghệ & Cyber', desc: 'Đồ họa công nghệ số, ánh sáng hiện đại', icon: '💻', items: tech },
      { id: 'BUSINESS_OFFICE', name: 'Văn Phòng & Doanh Nghiệp', desc: 'Không gian làm việc chuyên nghiệp chuẩn doanh nghiệp', icon: '🏢', items: business },
      { id: 'RANDOM_COVER', name: 'Ngẫu Nhiên Toàn Bộ (Khuyên Dùng)', desc: 'Tự động luân phiên ngẫu nhiên mỗi page một ảnh bìa độc bản', icon: '🎲', items: [...nature, ...architecture, ...tech, ...business] },
    ],
  };
}

/**
 * Cập nhật Ảnh Bìa (Cover Photo) hàng loạt cho dàn Fanpage
 */
async function bulkUpdateFanpageCovers(cookieString, pagesToUpdate, options = {}, onProgress) {
  const {
    presetCategory = 'RANDOM_COVER',
    customImages = [],
    delaySeconds = 3,
    proxyUrl = '',
    shouldStop,
  } = options;

  const cookies = parseCookieString(cookieString);
  if (!cookies.length) throw new Error('Cookie rỗng hoặc không đúng định dạng');

  const proxy = parseProxy(proxyUrl);
  const presets = getCoverPresets();
  const selectedCat = presets.categories.find((c) => c.id === presetCategory) || presets.categories[presets.categories.length - 1];
  const presetPool = selectedCat.items;

  const uid = getUserIdFromCookie(cookieString);
  const profileDir = uid ? path.join(__dirname, 'browser_profiles', `via_${uid}`) : null;
  if (profileDir) fs.mkdirSync(profileDir, { recursive: true });

  const browserOptions = {
    headless: true,
    args: BROWSER_ARGS,
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
    viewport: { width: 1280, height: 800 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  };

  let context;
  if (profileDir) {
    context = await chromium.launchPersistentContext(profileDir, browserOptions);
  } else {
    const b = await chromium.launch(browserOptions);
    context = await b.newContext(browserOptions);
  }

  await applyResourceOptimization(context, false);
  await context.addCookies(cookies);

  const tab = context.pages().length ? context.pages()[0] : await context.newPage();
  const coverCache = loadCoverCache();
  const details = [];
  let updatedCount = 0;

  try {
    for (let i = 0; i < pagesToUpdate.length; i++) {
      if (typeof shouldStop === 'function' && shouldStop()) {
        console.warn(`[CoverStudio] 🛑 Dừng theo yêu cầu người dùng tại page ${i + 1}/${pagesToUpdate.length}`);
        break;
      }

      const pageItem = pagesToUpdate[i];
      const pageId = pageItem.id || pageItem.platformAccountId;
      const pageName = pageItem.name || pageItem.pageName || `Fanpage ${pageId}`;

      let localTempFile = null;
      const startTime = Date.now();

      if (typeof onProgress === 'function') {
        onProgress({
          type: 'PAGE_START',
          index: i + 1,
          total: pagesToUpdate.length,
          pageId,
          pageName,
          status: 'RUNNING',
          message: `[${i + 1}/${pagesToUpdate.length}] Đang tải ảnh bìa cho "${pageName}"...`,
        });
      }

      try {
        if (customImages.length > 0) {
          const chosenCustom = customImages[i % customImages.length];
          if (typeof chosenCustom === 'string' && chosenCustom.startsWith('data:image')) {
            const base64Data = chosenCustom.replace(/^data:image\/\w+;base64,/, '');
            const tmpFile = path.join(TEMP_AVATARS_DIR, `cover_b64_${Date.now()}_${i}.jpg`);
            fs.writeFileSync(tmpFile, Buffer.from(base64Data, 'base64'));
            localTempFile = tmpFile;
          } else if (typeof chosenCustom === 'string' && chosenCustom.startsWith('http')) {
            localTempFile = await downloadImageToTemp(chosenCustom, `cover_url_${pageId}`);
          } else if (typeof chosenCustom === 'string' && fs.existsSync(chosenCustom)) {
            localTempFile = chosenCustom;
          }
        }

        if (!localTempFile) {
          const chosenUrl = pageItem.imageUrl || presetPool[i % presetPool.length];
          localTempFile = await downloadImageToTemp(chosenUrl, `cov_${pageId}`);
        }

        console.log(`[CoverStudio] 🔄 [${i + 1}/${pagesToUpdate.length}] Đổi Ảnh Bìa cho Page "${pageName}" (${pageId})...`);
        await tab.goto(`https://www.facebook.com/profile.php?id=${pageId}`, {
          waitUntil: 'domcontentloaded',
          timeout: 25000,
        }).catch(() => {});
        await tab.waitForTimeout(2000);

        // Chuyển sang danh tính Page nếu cần
        const switchBtn = tab.locator('div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Chuyển"), [aria-label="Chuyển ngay"], [aria-label="Chuyển"]').first();
        if (await switchBtn.isVisible().catch(() => false)) {
          await switchBtn.click({ force: true }).catch(() => {});
          await tab.waitForTimeout(2000);
          const confirmBtn = tab.locator('div[role="dialog"] div[role="button"]:has-text("Chuyển")').first();
          if (await confirmBtn.isVisible().catch(() => false)) {
            await confirmBtn.click({ force: true }).catch(() => {});
            await tab.waitForTimeout(2500);
          }
        }

        await context.addCookies([{ name: 'i_user', value: pageId, domain: '.facebook.com', path: '/', secure: true, sameSite: 'Lax' }]);
        await tab.waitForTimeout(1000);
        await tab.keyboard.press('Escape').catch(() => {});

        // Tìm nút Đổi ảnh bìa (Cover Button)
        const coverBtn = tab.locator(
          'div[aria-label*="ảnh bìa" i], div[aria-label*="cover photo" i], div[role="button"]:has-text("Chỉnh sửa ảnh bìa"), div[role="button"]:has-text("Edit cover photo"), div[role="button"]:has-text("Thêm ảnh bìa"), div[role="button"]:has-text("Add cover photo")'
        ).first();

        if ((await coverBtn.count().catch(() => 0)) === 0 || !(await coverBtn.isVisible().catch(() => false))) {
          throw new Error('Không tìm thấy nút chỉnh sửa Ảnh Bìa trên Fanpage');
        }

        await coverBtn.click({ force: true });
        await tab.waitForTimeout(1500);

        // Trong popup menu, chọn "Tải ảnh lên"
        let uploadSuccess = false;
        const uploadMenuItem = tab.locator('div[role="menuitem"]:has-text("Tải ảnh lên"), div[role="menuitem"]:has-text("Upload photo"), div[role="button"]:has-text("Tải ảnh lên")').first();
        if ((await uploadMenuItem.count().catch(() => 0)) > 0 && (await uploadMenuItem.isVisible().catch(() => false))) {
          const [fileChooser] = await Promise.all([
            tab.waitForEvent('filechooser', { timeout: 12000 }).catch(() => null),
            uploadMenuItem.click({ force: true }).catch(() => {}),
          ]);
          if (fileChooser) {
            await fileChooser.setFiles(localTempFile);
            uploadSuccess = true;
          }
        }

        if (!uploadSuccess) {
          const fileInput = tab.locator('input[type="file"]').first();
          if ((await fileInput.count().catch(() => 0)) > 0) {
            await fileInput.setInputFiles(localTempFile);
            uploadSuccess = true;
          }
        }

        if (!uploadSuccess) {
          throw new Error('Không thể kích hoạt hộp thoại chọn tệp Ảnh Bìa');
        }

        // Bấm "Lưu thay đổi" (Save changes) bắt buộc
        let coverSaved = false;
        const coverSaveSelectors = [
          'div[role="button"]:has-text("Lưu thay đổi")',
          'button:has-text("Lưu thay đổi")',
          'div[role="button"]:has-text("Save changes")',
          'button:has-text("Save changes")',
        ];

        for (let waitSec = 0; waitSec < 12; waitSec++) {
          await tab.waitForTimeout(1000);
          for (const sel of coverSaveSelectors) {
            const btn = tab.locator(sel).first();
            if ((await btn.count().catch(() => 0)) > 0 && (await btn.isVisible().catch(() => false))) {
              await btn.click({ force: true }).catch(() => {});
              coverSaved = true;
              console.log(`[CoverStudio] 💾 Đã bấm "Lưu thay đổi" Ảnh Bìa cho Page "${pageName}"`);
              break;
            }
          }
          if (coverSaved) break;
        }

        if (!coverSaved) {
          throw new Error('Nút "Lưu thay đổi" ảnh bìa không xuất hiện trên Facebook');
        }

        await tab.waitForTimeout(3000);

        const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
        updatedCount++;
        coverCache[pageId] = {
          pageId,
          pageName,
          hasCover: true,
          updatedAt: new Date().toISOString(),
        };
        saveCoverCache(coverCache);

        const detail = {
          pageId,
          pageName,
          status: 'SUCCESS',
          duration,
          message: `Đổi ảnh bìa thành công (${duration})`,
        };
        details.push(detail);

        if (typeof onProgress === 'function') {
          onProgress({
            type: 'PAGE_FINISH',
            index: i + 1,
            total: pagesToUpdate.length,
            percent: Math.round(((i + 1) / pagesToUpdate.length) * 100),
            ...detail,
          });
        }
      } catch (err) {
        console.warn(`[CoverStudio] ⚠️ Lỗi khi đổi ảnh bìa "${pageName}": ${err.message}`);
        const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
        const detail = {
          pageId,
          pageName,
          status: 'FAILED',
          duration,
          error: err.message,
        };
        details.push(detail);
        if (typeof onProgress === 'function') {
          onProgress({
            type: 'PAGE_FINISH',
            index: i + 1,
            total: pagesToUpdate.length,
            percent: Math.round(((i + 1) / pagesToUpdate.length) * 100),
            ...detail,
          });
        }
      } finally {
        if (localTempFile && localTempFile.includes(TEMP_AVATARS_DIR)) {
          fs.unlink(localTempFile, () => {});
        }
      }

      if (i < pagesToUpdate.length - 1) {
        const sleepMs = Math.max(1000, Number(delaySeconds) * 1000);
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    }
  } finally {
    if (context) await context.close().catch(() => {});
  }

  return { success: true, total: pagesToUpdate.length, updatedCount, details };
}

module.exports = {
  checkPagesAvatarStatus,
  getAvatarPresets,
  getCoverPresets,
  downloadImageToTemp,
  bulkUpdateFanpageAvatars,
  bulkUpdateFanpageCovers,
  loadAvatarCache,
  saveAvatarCache,
  loadCoverCache,
  saveCoverCache,
  scanLiveFanpageAvatars,
};
