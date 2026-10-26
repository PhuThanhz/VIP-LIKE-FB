const { chromium } = require('playwright');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const { parseCookieString, parseProxy } = require('./fb-buff-tool');
const { downloadImageToTemp, loadAvatarCache, saveAvatarCache } = require('./avatar-tool');

// Shuffle array
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Generate curated Random Mix pool (women & men portraits)
function getCuratedPortraitPool() {
  const pool = [];
  // 95 women portraits
  for (let i = 1; i <= 95; i++) {
    pool.push(`https://randomuser.me/api/portraits/women/${i}.jpg`);
  }
  // 95 men portraits
  for (let i = 1; i <= 95; i++) {
    pool.push(`https://randomuser.me/api/portraits/men/${i}.jpg`);
  }
  return shuffle(pool);
}

async function runBatch100Avatars() {
  const startTime = Date.now();
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU TIẾN TRÌNH CẬP NHẬT AVATAR HÀNG LOẠT (MỤC TIÊU: 100 PAGE)');
  console.log('================================================================');

  // 1. Lấy Cookie của nick mẹ Thành An (UID: 100023403136194)
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '26082003',
    database: 'autopost_saas',
  });
  const [rows] = await conn.query(
    'SELECT access_token, proxy_url FROM social_accounts WHERE platform_account_id = ?',
    ['100023403136194']
  );
  await conn.end();

  const cookieStr = rows[0]?.access_token;
  const proxyUrl = rows[0]?.proxy_url || '';

  if (!cookieStr) {
    console.error('❌ Không tìm thấy Cookie của nick mẹ Thành An!');
    process.exit(1);
  }

  // 2. Tải danh sách Page và lọc ra 100 Page chưa có avatar
  const pagesCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'pages_cache.json'), 'utf8'));
  const avatarCache = loadAvatarCache();

  const thanhAnPages = pagesCache['100023403136194']?.pages || [];
  const missingPages = thanhAnPages.filter((p) => {
    const pid = String(p.id);
    const st = avatarCache[pid];
    return !st || !st.hasAvatar;
  });

  const targetPages = missingPages.slice(0, 100);
  console.log(`📊 Tổng số Page chưa có Avatar: ${missingPages.length}`);
  console.log(`🎯 Chọn ra ${targetPages.length} Page để tiến hành cập nhật Avatar...`);

  if (targetPages.length === 0) {
    console.log('🎉 Toàn bộ Page đã có Avatar, không cần cập nhật thêm!');
    return;
  }

  // 3. Chuẩn bị kho ảnh chân dung Random Mix độc lập
  const portraitPool = getCuratedPortraitPool();
  console.log(`🖼️ Kho ảnh mẫu ngẫu nhiên: ${portraitPool.length} ảnh chân dung nam/nữ.`);

  // Khởi tạo file theo dõi tiến độ
  const progressFile = path.join(__dirname, 'data', 'batch_100_progress.json');
  const progressState = {
    startedAt: new Date().toISOString(),
    total: targetPages.length,
    completed: 0,
    successCount: 0,
    failCount: 0,
    status: 'RUNNING',
    items: [],
  };
  fs.writeFileSync(progressFile, JSON.stringify(progressState, null, 2));

  // 4. Khởi chạy trình duyệt Playwright với Cookie mẹ
  const cookies = parseCookieString(cookieStr);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 850 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  });
  await context.addCookies(cookies);
  const tab = await context.newPage();

  console.log('🌐 Trình duyệt tự động đã sẵn sàng. Bắt đầu vòng lặp cập nhật...\n');

  for (let i = 0; i < targetPages.length; i++) {
    const pageItem = targetPages[i];
    const pageId = String(pageItem.id);
    const pageName = pageItem.name || `Page ${pageId}`;
    const pageStartTime = Date.now();
    let localTempImage = null;

    console.log(`----------------------------------------------------------------`);
    console.log(`[${i + 1}/${targetPages.length}] ⏳ Đang xử lý: "${pageName}" (ID: ${pageId})`);

    try {
      // 1. Tải ảnh chân dung từ pool
      const imageUrl = portraitPool[i % portraitPool.length];
      localTempImage = await downloadImageToTemp(imageUrl, `batch_${pageId}`);

      // 2. Mở URL Profile Page
      await tab.goto(`https://www.facebook.com/profile.php?id=${pageId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      }).catch(() => {});
      await tab.waitForTimeout(3000);

      // 3. Kiểm tra và chuyển quyền danh tính (Switch Profile)
      const switchBtns = await tab.$$('div[role="button"]:has-text("Chuyển ngay"), div[role="button"]:has-text("Chuyển"), [aria-label*="Chuyển sang"]');
      if (switchBtns.length > 0) {
        await switchBtns[0].click().catch(() => {});
        await tab.waitForTimeout(2000);
        const confirmBtn = await tab.$('div[role="dialog"] div[role="button"]:has-text("Chuyển"), div[role="dialog"] div[role="button"]:has-text("Switch")');
        if (confirmBtn) {
          await confirmBtn.click().catch(() => {});
        }
        await tab.waitForNavigation({ timeout: 15000 }).catch(() => {});
        await tab.waitForTimeout(3500);
      }

      // 4. Đóng mọi popup Onboarding ("Chào mừng bạn đến với Trang mới!", "Dùng Trang", Escape)
      const dungTrangBtn = await tab.$('div[role="button"]:has-text("Dùng Trang"), div[role="button"]:has-text("Use Page"), div[role="button"]:has-text("Bắt đầu khám phá"), div[aria-label="Đóng"], div[aria-label="Close"]');
      if (dungTrangBtn && await dungTrangBtn.isVisible()) {
        await dungTrangBtn.click().catch(() => {});
        await tab.waitForTimeout(1500);
      }
      await tab.keyboard.press('Escape').catch(() => {});
      await tab.waitForTimeout(1000);

      // 5. Tìm nút Camera đại diện ("Hành động với ảnh đại diện")
      const cameraLoc = tab.locator('div[aria-label*="ảnh đại diện"], div[aria-label*="Hành động với ảnh đại diện"], div[aria-label*="Cập nhật ảnh đại diện"], div[aria-label*="Profile picture" i]').first();
      if ((await cameraLoc.count()) === 0 || !(await cameraLoc.isVisible().catch(() => false))) {
        throw new Error('Không tìm thấy nút Camera đại diện trên Fanpage');
      }

      await cameraLoc.click({ force: true });
      await tab.waitForTimeout(2000);

      // 6. Trong menu popup, chọn "Chọn ảnh đại diện"
      const chooseAvatarMenuItem = tab.locator('div[role="menuitem"]:has-text("Chọn ảnh đại diện"), div[role="menuitem"]:has-text("Choose profile picture"), div[role="menuitem"]:has-text("Tải ảnh lên"), div[role="menuitem"]').first();
      if ((await chooseAvatarMenuItem.count()) > 0 && await chooseAvatarMenuItem.isVisible().catch(() => false)) {
        await chooseAvatarMenuItem.click({ force: true }).catch(() => {});
        await tab.waitForTimeout(2500);
      }

      // 7. Trong modal "Chọn ảnh đại diện", bấm "+ Tải ảnh lên" và nạp file
      let uploadSuccess = false;
      const uploadBtn = tab.locator('div[role="dialog"] div[role="button"]:has-text("Tải ảnh lên"), div[role="dialog"] div[role="button"]:has-text("Upload photo"), div[role="dialog"] button:has-text("Tải ảnh lên")').first();

      if ((await uploadBtn.count()) > 0 && await uploadBtn.isVisible().catch(() => false)) {
        const [fileChooser] = await Promise.all([
          tab.waitForEvent('filechooser', { timeout: 10000 }),
          uploadBtn.click({ force: true }),
        ]);

        if (fileChooser) {
          await fileChooser.setFiles(localTempImage);
          uploadSuccess = true;
        }
      }

      if (!uploadSuccess) {
        // Fallback input trực tiếp trong dialog
        const directInput = tab.locator('div[role="dialog"] input[type="file"]').first();
        if ((await directInput.count()) > 0) {
          await directInput.setInputFiles(localTempImage);
          uploadSuccess = true;
        }
      }

      if (!uploadSuccess) {
        throw new Error('Không thể mở hộp thoại chọn tệp ảnh của Facebook');
      }

      // 8. Đợi modal xem trước & Bấm "Lưu" (Save)
      await tab.waitForTimeout(4000);
      const saveBtn = tab.locator('div[role="dialog"] div[role="button"]:has-text("Lưu"), div[role="dialog"] button:has-text("Lưu"), div[role="dialog"] div[role="button"]:has-text("Save")').first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click({ force: true });
        // Chờ modal lưu hoàn thành và đóng lại
        await tab.waitForSelector('div[role="dialog"] div[role="button"]:has-text("Lưu")', {
          state: 'hidden',
          timeout: 25000,
        }).catch(() => {});
        await tab.waitForTimeout(2500);
      }

      const elapsedSec = ((Date.now() - pageStartTime) / 1000).toFixed(1);
      console.log(`[${i + 1}/${targetPages.length}] ✅ THÀNH CÔNG: Đã đổi Avatar cho "${pageName}" (${elapsedSec}s)`);

      // Cập nhật Cache đĩa
      avatarCache[pageId] = {
        pageId,
        pageName,
        hasAvatar: true,
        isSilhouette: false,
        avatarUrl: imageUrl,
        updatedAt: new Date().toISOString(),
      };
      saveAvatarCache(avatarCache);

      // Cập nhật file tiến độ
      progressState.completed++;
      progressState.successCount++;
      progressState.items.push({
        index: i + 1,
        pageId,
        pageName,
        status: 'SUCCESS',
        imageUrl,
        duration: `${elapsedSec}s`,
        time: new Date().toLocaleTimeString('vi-VN'),
      });
      fs.writeFileSync(progressFile, JSON.stringify(progressState, null, 2));

    } catch (err) {
      const elapsedSec = ((Date.now() - pageStartTime) / 1000).toFixed(1);
      console.warn(`[${i + 1}/${targetPages.length}] ⚠️ BỎ QUA DO LỖI: "${pageName}": ${err.message} (${elapsedSec}s)`);

      progressState.completed++;
      progressState.failCount++;
      progressState.items.push({
        index: i + 1,
        pageId,
        pageName,
        status: 'ERROR',
        error: err.message,
        duration: `${elapsedSec}s`,
        time: new Date().toLocaleTimeString('vi-VN'),
      });
      fs.writeFileSync(progressFile, JSON.stringify(progressState, null, 2));
    } finally {
      // Xóa file ảnh tạm trên ổ cứng
      if (localTempImage && fs.existsSync(localTempImage)) {
        fs.unlink(localTempImage, () => {});
      }
    }

    // Nghỉ an toàn 3 giây giữa các Page để chống checkpoint
    if (i < targetPages.length - 1) {
      await new Promise((r) => setTimeout(r, 3500));
    }
  }

  await browser.close().catch(() => {});

  progressState.status = 'COMPLETED';
  progressState.finishedAt = new Date().toISOString();
  progressState.totalDuration = `${((Date.now() - startTime) / 60000).toFixed(1)} phút`;
  fs.writeFileSync(progressFile, JSON.stringify(progressState, null, 2));

  console.log('\n================================================================');
  console.log(`🏁 HOÀN THÀNH TIẾN TRÌNH CẬP NHẬT 100 PAGE!`);
  console.log(`✅ Thành công: ${progressState.successCount}/${targetPages.length}`);
  console.log(`⚠️ Lỗi / Bỏ qua: ${progressState.failCount}/${targetPages.length}`);
  console.log(`⏱️ Tổng thời gian: ${progressState.totalDuration}`);
  console.log('================================================================');
}

runBatch100Avatars().catch(console.error);
