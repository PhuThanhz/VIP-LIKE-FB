const mysql = require('mysql2/promise');
const { chromium } = require('playwright');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost', user: 'root', password: '26082003', database: 'viplike_radiant'
  });
  const [rows] = await conn.query('SELECT * FROM social_accounts WHERE platform_account_id = "61568198025556"');
  const hp = rows[0];

  const rawCookie = hp.access_token;
  const cookiePairs = rawCookie.split(';').map(p => p.trim()).filter(Boolean);
  const cookies = cookiePairs.map(p => {
    const idx = p.indexOf('=');
    return {
      name: p.slice(0, idx).trim(),
      value: p.slice(idx + 1).trim(),
      domain: '.facebook.com',
      path: '/'
    };
  });

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh'
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  // Test 1: Click Reload page button if error appears
  console.log('Testing clean reel with real UA...');
  await page.goto('https://www.facebook.com/reel/1456424179756313', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const reloadBtn = page.locator('div[role="button"]:has-text("Reload page"), div[role="button"]:has-text("Tải lại trang")').first();
  if (await reloadBtn.isVisible().catch(() => false)) {
    console.log('Found Reload page button! Clicking it...');
    await reloadBtn.click();
    await page.waitForTimeout(5000);
  }

  console.log('After reload URL:', page.url());
  await page.screenshot({ path: '/Users/huynhthanhphu/.gemini/antigravity-ide/brain/4c53adbe-1bcc-4d9e-b36e-f41e50fb9a83/scratch/after_reload.png' });

  // Test 2: watch url
  console.log('Testing watch URL...');
  await page.goto('https://www.facebook.com/watch/?v=1456424179756313', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log('Watch URL:', page.url());
  console.log('Watch Title:', await page.title());
  await page.screenshot({ path: '/Users/huynhthanhphu/.gemini/antigravity-ide/brain/4c53adbe-1bcc-4d9e-b36e-f41e50fb9a83/scratch/watch_url.png' });

  // Test 3: m.facebook.com
  console.log('Testing m.facebook.com URL...');
  await page.goto('https://m.facebook.com/reel/1456424179756313', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log('m.facebook URL:', page.url());
  console.log('m.facebook Title:', await page.title());
  await page.screenshot({ path: '/Users/huynhthanhphu/.gemini/antigravity-ide/brain/4c53adbe-1bcc-4d9e-b36e-f41e50fb9a83/scratch/m_facebook.png' });

  await browser.close();
  await conn.end();
})();
