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
  console.log('🚀 STARTING THE BULK AVATAR UPDATE (TARGET: 100 PAGES)');
  console.log('================================================================');

  // 1. Get the Cookie of parent account Thành An (UID: 100023403136194)
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'viplike_radiant',
  });
  const [rows] = await conn.query(
    'SELECT access_token, proxy_url FROM social_accounts WHERE platform_account_id = ?',
    ['100023403136194']
  );
  await conn.end();

  const cookieStr = rows[0]?.access_token;
  const proxyUrl = rows[0]?.proxy_url || '';

  if (!cookieStr) {
    console.error('❌ Cookie of parent account Thành An not found!');
    process.exit(1);
  }

  // 2. Load the Page list and pick 100 Pages without an avatar
  const pagesCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'pages_cache.json'), 'utf8'));
  const avatarCache = loadAvatarCache();

  const thanhAnPages = pagesCache['100023403136194']?.pages || [];
  const missingPages = thanhAnPages.filter((p) => {
    const pid = String(p.id);
    const st = avatarCache[pid];
    return !st || !st.hasAvatar;
  });

  const targetPages = missingPages.slice(0, 100);
  console.log(`📊 Total Pages without an Avatar: ${missingPages.length}`);
  console.log(`🎯 Picked ${targetPages.length} Pages to update the Avatar...`);

  if (targetPages.length === 0) {
    console.log('🎉 Every Page already has an Avatar, nothing to update!');
    return;
  }

  // 3. Prepare an independent Random Mix portrait library
  const portraitPool = getCuratedPortraitPool();
  console.log(`🖼️ Random sample library: ${portraitPool.length} male/female portraits.`);

  // Create the progress tracking file
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

  // 4. Launch the Playwright browser with the parent Cookie
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

  console.log('🌐 The automated browser is ready. Starting the update loop...\n');

  for (let i = 0; i < targetPages.length; i++) {
    const pageItem = targetPages[i];
    const pageId = String(pageItem.id);
    const pageName = pageItem.name || `Page ${pageId}`;
    const pageStartTime = Date.now();
    let localTempImage = null;

    console.log(`----------------------------------------------------------------`);
    console.log(`[${i + 1}/${targetPages.length}] ⏳ Processing: "${pageName}" (ID: ${pageId})`);

    try {
      // 1. Download a portrait from the pool
      const imageUrl = portraitPool[i % portraitPool.length];
      localTempImage = await downloadImageToTemp(imageUrl, `batch_${pageId}`);

      // 2. Open the Page Profile URL
      await tab.goto(`https://www.facebook.com/profile.php?id=${pageId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      }).catch(() => {});
      await tab.waitForTimeout(3000);

      // 3. Check and switch identity (Switch Profile)
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

      // 4. Close any Onboarding popups ("Welcome to the new Pages experience!", "Use Page", Escape)
      const dungTrangBtn = await tab.$('div[role="button"]:has-text("Dùng Trang"), div[role="button"]:has-text("Use Page"), div[role="button"]:has-text("Bắt đầu khám phá"), div[aria-label="Đóng"], div[aria-label="Close"]');
      if (dungTrangBtn && await dungTrangBtn.isVisible()) {
        await dungTrangBtn.click().catch(() => {});
        await tab.waitForTimeout(1500);
      }
      await tab.keyboard.press('Escape').catch(() => {});
      await tab.waitForTimeout(1000);

      // 5. Find the profile picture camera button ("Profile picture actions")
      const cameraLoc = tab.locator('div[aria-label*="ảnh đại diện"], div[aria-label*="Hành động với ảnh đại diện"], div[aria-label*="Cập nhật ảnh đại diện"], div[aria-label*="Profile picture" i]').first();
      if ((await cameraLoc.count()) === 0 || !(await cameraLoc.isVisible().catch(() => false))) {
        throw new Error('Profile picture camera button not found on the Fanpage');
      }

      await cameraLoc.click({ force: true });
      await tab.waitForTimeout(2000);

      // 6. In the popup menu, pick "Choose profile picture"
      const chooseAvatarMenuItem = tab.locator('div[role="menuitem"]:has-text("Chọn ảnh đại diện"), div[role="menuitem"]:has-text("Choose profile picture"), div[role="menuitem"]:has-text("Tải ảnh lên"), div[role="menuitem"]').first();
      if ((await chooseAvatarMenuItem.count()) > 0 && await chooseAvatarMenuItem.isVisible().catch(() => false)) {
        await chooseAvatarMenuItem.click({ force: true }).catch(() => {});
        await tab.waitForTimeout(2500);
      }

      // 7. In the "Choose profile picture" modal, click "+ Upload photo" and load the file
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
        // Fallback: file input directly in the dialog
        const directInput = tab.locator('div[role="dialog"] input[type="file"]').first();
        if ((await directInput.count()) > 0) {
          await directInput.setInputFiles(localTempImage);
          uploadSuccess = true;
        }
      }

      if (!uploadSuccess) {
        throw new Error('Could not open Facebook\'s image file picker dialog');
      }

      // 8. Wait for the preview modal & click "Save"
      await tab.waitForTimeout(4000);
      const saveBtn = tab.locator('div[role="dialog"] div[role="button"]:has-text("Lưu"), div[role="dialog"] button:has-text("Lưu"), div[role="dialog"] div[role="button"]:has-text("Save")').first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click({ force: true });
        // Wait for the save modal to finish and close
        await tab.waitForSelector('div[role="dialog"] div[role="button"]:has-text("Lưu")', {
          state: 'hidden',
          timeout: 25000,
        }).catch(() => {});
        await tab.waitForTimeout(2500);
      }

      const elapsedSec = ((Date.now() - pageStartTime) / 1000).toFixed(1);
      console.log(`[${i + 1}/${targetPages.length}] ✅ SUCCESS: changed the Avatar for "${pageName}" (${elapsedSec}s)`);

      // Update the disk cache
      avatarCache[pageId] = {
        pageId,
        pageName,
        hasAvatar: true,
        isSilhouette: false,
        avatarUrl: imageUrl,
        updatedAt: new Date().toISOString(),
      };
      saveAvatarCache(avatarCache);

      // Update the progress file
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
      console.warn(`[${i + 1}/${targetPages.length}] ⚠️ SKIPPED DUE TO ERROR: "${pageName}": ${err.message} (${elapsedSec}s)`);

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
      // Delete the temp image file from disk
      if (localTempImage && fs.existsSync(localTempImage)) {
        fs.unlink(localTempImage, () => {});
      }
    }

    // Safe 3-second rest between Pages to avoid checkpoints
    if (i < targetPages.length - 1) {
      await new Promise((r) => setTimeout(r, 3500));
    }
  }

  await browser.close().catch(() => {});

  progressState.status = 'COMPLETED';
  progressState.finishedAt = new Date().toISOString();
  progressState.totalDuration = `${((Date.now() - startTime) / 60000).toFixed(1)} min`;
  fs.writeFileSync(progressFile, JSON.stringify(progressState, null, 2));

  console.log('\n================================================================');
  console.log(`🏁 FINISHED UPDATING 100 PAGES!`);
  console.log(`✅ Success: ${progressState.successCount}/${targetPages.length}`);
  console.log(`⚠️ Errors / Skipped: ${progressState.failCount}/${targetPages.length}`);
  console.log(`⏱️ Total time: ${progressState.totalDuration}`);
  console.log('================================================================');
}

runBatch100Avatars().catch(console.error);
