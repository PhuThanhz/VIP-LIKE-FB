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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'vi-VN'
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  // Try opening the VTV24 Fanpage or a public post
  console.log('Opening a public VTV24 post...');
  await page.goto('https://www.facebook.com/tintucvtv24', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log('VTV24 URL:', page.url());
  console.log('VTV24 Title:', await page.title());

  await page.screenshot({ path: '/Users/huynhthanhphu/.gemini/antigravity-ide/brain/4c53adbe-1bcc-4d9e-b36e-f41e50fb9a83/scratch/vtv24_test.png' });
  console.log('Screenshot vtv24 saved!');

  await browser.close();
  await conn.end();
})();
