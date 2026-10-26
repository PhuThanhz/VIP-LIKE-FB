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
// 1. KIỂM TRA TRẠNG THÁI AVATAR HÀNG LOẠT (GRAPH API CỰC NHANH)
// =============================================================================

/**
 * Quét danh sách Page để phân loại xem Page nào ĐÃ CÓ AVATAR hay CHƯA CÓ (Silhouette)
 * @param {Array<string|{id: string, name?: string}>} pages
 */
async function checkPagesAvatarStatus(pages = []) {
  const pageList = pages.map((p) => (typeof p === 'object' ? p : { id: String(p) }));
  if (pageList.length === 0) return { results: {}, stats: { total: 0, missingAvatar: 0, hasAvatar: 0 } };

  const results = {};
  let missingAvatar = 0;
  let hasAvatar = 0;

  const CHUNK_SIZE = 40;
  for (let i = 0; i < pageList.length; i += CHUNK_SIZE) {
    const chunk = pageList.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (p) => {
        const pageId = String(p.id);
        try {
          const res = await axios.get(`https://graph.facebook.com/${pageId}/picture?type=large&redirect=false`, {
            timeout: 7000,
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
          // Thử lại dạng direct redirect header nếu endpoint graph bị chặn
          return {
            pageId,
            isSilhouette: true, // Mặc định coi là cần cập nhật nếu không đọc được
            hasAvatar: false,
            avatarUrl: `https://graph.facebook.com/${pageId}/picture?type=large`,
            error: err.message,
          };
        }
      })
    );

    for (const item of chunkResults) {
      results[item.pageId] = item;
      if (item.hasAvatar) hasAvatar++;
      else missingAvatar++;
    }
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

        // 3. Vào trang tường chính của Page
        await tab.goto(`https://www.facebook.com/profile.php?id=${pageId}`, {
          waitUntil: 'domcontentloaded',
          timeout: 25000,
        }).catch(() => {});
        await tab.waitForTimeout(3000);

        // 4. Tìm và kích hoạt nút Đổi ảnh đại diện (Camera button)
        const avatarCameraSelectors = [
          'div[aria-label="Cập nhật ảnh đại diện"]',
          'div[aria-label="Update profile picture"]',
          'div[aria-label="Chọn ảnh đại diện"]',
          'div[aria-label*="ảnh đại diện"]',
          'div[aria-label*="Profile picture"]',
          'div[role="button"]:has(svg path[d*="19.5"])',
        ];

        let cameraBtn = null;
        for (const sel of avatarCameraSelectors) {
          const loc = tab.locator(sel).first();
          if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
            cameraBtn = loc;
            break;
          }
        }

        // Tải ảnh qua fileChooser hoặc input[type="file"]
        let uploadSuccess = false;

        const fileInput = tab.locator('input[type="file"][accept*="image"]').first();
        if ((await fileInput.count().catch(() => 0)) > 0) {
          await fileInput.setInputFiles(localTempFile);
          uploadSuccess = true;
        } else if (cameraBtn) {
          const [fileChooser] = await Promise.all([
            tab.waitForEvent('filechooser', { timeout: 7000 }).catch(() => null),
            cameraBtn.click({ force: true }).catch(() => {}),
          ]);

          if (fileChooser) {
            await fileChooser.setFiles(localTempFile);
            uploadSuccess = true;
          } else {
            // Thử click vào nút "Tải ảnh lên" trong menu popup nếu có
            await tab.waitForTimeout(1500);
            const uploadMenuBtn = tab.locator('div[role="menuitem"]:has-text("Tải ảnh lên"), div[role="menuitem"]:has-text("Upload photo")').first();
            if (await uploadMenuBtn.isVisible().catch(() => false)) {
              const [menuChooser] = await Promise.all([
                tab.waitForEvent('filechooser', { timeout: 7000 }).catch(() => null),
                uploadMenuBtn.click().catch(() => {}),
              ]);
              if (menuChooser) {
                await menuChooser.setFiles(localTempFile);
                uploadSuccess = true;
              }
            }
          }
        }

        if (!uploadSuccess) {
          throw new Error('Không tìm thấy nút tải ảnh đại diện của Facebook');
        }

        // 5. Đợi modal xem trước & Bấm "Lưu" (Save)
        await tab.waitForTimeout(3500);
        const saveBtn = tab.locator('div[role="dialog"] div[role="button"]:has-text("Lưu"), div[role="dialog"] div[role="button"]:has-text("Save")').first();
        if (await saveBtn.isVisible().catch(() => false)) {
          await saveBtn.click({ force: true });
          console.log(`[AvatarStudio] 💾 Đã bấm "Lưu" ảnh đại diện cho Page "${pageName}"...`);
          // Đợi modal lưu đóng
          await tab.waitForSelector('div[role="dialog"] div[role="button"]:has-text("Lưu")', {
            state: 'hidden',
            timeout: 20000,
          }).catch(() => {});
          await tab.waitForTimeout(2000);
        }

        console.log(`[AvatarStudio] ✅ Cập nhật Avatar THÀNH CÔNG cho Page: "${pageName}" (ID: ${pageId})`);
        updatedCount++;

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

module.exports = {
  checkPagesAvatarStatus,
  getAvatarPresets,
  downloadImageToTemp,
  bulkUpdateFanpageAvatars,
};
