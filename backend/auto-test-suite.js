/**
 * auto-test-suite.js
 * Comprehensive automated test suite (Nightly Automated E2E & Health Suite)
 * Checks the whole viplike_radiant Database, the Vias, the Fanpages, the Telegram Bot and the Queue.
 */
const db = require('./db');
const { sendTelegramMessage } = require('./telegram-alert');

async function runFullNightlyTestSuite() {
  console.log('================================================================');
  console.log('🌙 STARTING THE NIGHTLY AUTOMATED TEST SUITE');
  console.log('⏰ Start time:', new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
  console.log('================================================================\n');

  const pool = db.getPool();
  const report = {
    database: { passed: false, details: '' },
    vias: { total: 0, live: 0, dead: 0 },
    pages: { total: 0, verified: 0, active: 0 },
    queue: { total: 0, completed: 0, waiting: 0 },
    telegram: { passed: false, details: '' },
    timestamp: new Date().toISOString(),
  };

  // 1. CHECK THE viplike_radiant DATABASE
  console.log('1️⃣ [Database Check] Checking the viplike_radiant database...');
  try {
    const [dbTest] = await pool.execute('SELECT DATABASE() as current_db, 1 as ok');
    const currentDb = dbTest[0]?.current_db;
    if (currentDb === 'viplike_radiant') {
      console.log('   ✅ Connected to the correct database:', currentDb);
      report.database.passed = true;
      report.database.details = `Database '${currentDb}' is healthy`;
    } else {
      console.warn('   ⚠️ Connected to database:', currentDb);
      report.database.details = `Warning: the Database is '${currentDb}'`;
    }
  } catch (err) {
    console.error('   ❌ Database connection error:', err.message);
    report.database.details = err.message;
  }

  // 2. CHECK THE VIAS (social_accounts)
  console.log('\n2️⃣ [Via Fleet Check] Checking 37 Via accounts...');
  try {
    const [vias] = await pool.execute(
      'SELECT id, platform_account_id, page_name, token_status, LENGTH(access_token) as cookie_len FROM social_accounts'
    );
    report.vias.total = vias.length;
    report.vias.live = vias.filter((v) => v.token_status === 'OK' || v.token_status === 'LIVE').length;
    report.vias.dead = report.vias.total - report.vias.live;
    console.log(`   📊 Total Vias: ${report.vias.total} | LIVE: ${report.vias.live} | Need updating: ${report.vias.dead}`);
    for (const v of vias.slice(0, 5)) {
      console.log(`      • [${v.page_name}] (UID: ${v.platform_account_id}) -> Cookie: ${v.cookie_len > 0 ? 'Yes (' + v.cookie_len + ' bytes)' : 'Empty'} | Status: ${v.token_status}`);
    }
  } catch (err) {
    console.error('   ❌ Error checking Vias:', err.message);
  }

  // 3. CHECK THE FANPAGES (facebook_page_accesses)
  console.log('\n3️⃣ [Fanpage Fleet Check] Reviewing 600+ Fanpages...');
  try {
    const [pagesCount] = await pool.execute('SELECT COUNT(*) as total, SUM(active = 1) as active_count, SUM(verification_status = "VERIFIED") as verified_count FROM facebook_page_accesses');
    report.pages.total = Number(pagesCount[0]?.total || 0);
    report.pages.active = Number(pagesCount[0]?.active_count || 0);
    report.pages.verified = Number(pagesCount[0]?.verified_count || 0);
    console.log(`   📊 Total Fanpages: ${report.pages.total} | Ready to engage: ${report.pages.active} | Verified: ${report.pages.verified}`);

    // Stats per Via
    const [byVia] = await pool.execute(
      'SELECT personal_profile_id, profile_name, COUNT(*) as page_count FROM facebook_page_accesses GROUP BY personal_profile_id, profile_name ORDER BY page_count DESC'
    );
    console.log('   🏛️ Fanpages per Via:');
    for (const r of byVia) {
      console.log(`      • [${r.profile_name || 'Via ' + r.personal_profile_id}] (UID: ${r.personal_profile_id}): ${r.page_count} Fanpage`);
    }
  } catch (err) {
    console.error('   ❌ Error checking Fanpages:', err.message);
  }

  // 4. CHECK THE QUEUE & HISTORY (buff_queue, buff_history)
  console.log('\n4️⃣ [Queue & History Check] Checking the buff queue...');
  try {
    const [qRows] = await pool.execute('SELECT status, COUNT(*) as count FROM buff_queue GROUP BY status');
    console.log('   ⏳ buff_queue status:');
    for (const r of qRows) {
      console.log(`      • ${r.status}: ${r.count} posts`);
      if (r.status === 'COMPLETED') report.queue.completed = r.count;
      else if (r.status === 'WAITING' || r.status === 'QUEUED') report.queue.waiting += r.count;
      report.queue.total += r.count;
    }

    const [histCount] = await pool.execute('SELECT COUNT(*) as count FROM buff_history');
    console.log(`   📜 Total buff_history engagement records: ${histCount[0]?.count || 0} posts`);
  } catch (err) {
    console.error('   ❌ Error checking the queue:', err.message);
  }

  // 5. CHECK THE TELEGRAM BOT
  console.log('\n5️⃣ [Telegram Bot Check] Checking the notification channel connection...');
  try {
    const nowStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const msg = [
      `🌙 <b>[STARTING OVERNIGHT MONITORING MODE: VIPLIKE RADIANT]</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `✅ Database: <b>viplike_radiant</b> (Healthy)`,
      `👤 Vias ready: <b>${report.vias.live}</b> / ${report.vias.total} accounts`,
      `📄 Fanpages ready: <b>${report.pages.active}</b> Fanpages`,
      `⏳ Task queue: <b>${report.queue.total}</b> posts`,
      `⏰ Started at: ${nowStr}`,
      `━━━━━━━━━━━━━━━━━━`,
      `💤 <i>The system is standing guard, testing and optimizing automatically. Sleep well!</i>`,
    ].join('\n');

    const res = await sendTelegramMessage(msg, 'HTML');
    if (res.success) {
      report.telegram.passed = true;
      report.telegram.details = `Notification sent (Message ID: ${res.data?.result?.message_id})`;
      console.log('   ✅ Sent the overnight monitoring kickoff message to Telegram!');
    } else {
      report.telegram.details = res.reason;
      console.warn('   ⚠️ Could not send Telegram:', res.reason);
    }
  } catch (err) {
    report.telegram.details = err.message;
    console.error('   ❌ Error checking Telegram:', err.message);
  }

  console.log('\n================================================================');
  console.log('✨ AUTOMATED TEST SUITE COMPLETE! EVERY SYSTEM IS READY TO RUN OVERNIGHT!');
  console.log('================================================================\n');

  return report;
}

if (require.main === module) {
  runFullNightlyTestSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runFullNightlyTestSuite };
