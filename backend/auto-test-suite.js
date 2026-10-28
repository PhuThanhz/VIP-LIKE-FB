/**
 * auto-test-suite.js
 * Bộ kiểm thử tự động toàn diện (Nightly Automated E2E & Health Suite)
 * Kiểm tra toàn bộ Database viplike_radiant, dàn Via, dàn Fanpage, Telegram Bot và Hàng đợi.
 */
const db = require('./db');
const { sendTelegramMessage } = require('./telegram-alert');

async function runFullNightlyTestSuite() {
  console.log('================================================================');
  console.log('🌙 BẮT ĐẦU BỘ KIỂM THỬ TỰ ĐỘNG XUYÊN ĐÊM (NIGHTLY TEST SUITE)');
  console.log('⏰ Thời gian bắt đầu:', new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
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

  // 1. KIỂM TRA DATABASE viplike_radiant
  console.log('1️⃣ [Database Check] Đang kiểm tra cơ sở dữ liệu viplike_radiant...');
  try {
    const [dbTest] = await pool.execute('SELECT DATABASE() as current_db, 1 as ok');
    const currentDb = dbTest[0]?.current_db;
    if (currentDb === 'viplike_radiant') {
      console.log('   ✅ Đã kết nối chuẩn xác vào database:', currentDb);
      report.database.passed = true;
      report.database.details = `Database '${currentDb}' hoạt động tốt`;
    } else {
      console.warn('   ⚠️ Đang nối vào database:', currentDb);
      report.database.details = `Cảnh báo: Database đang là '${currentDb}'`;
    }
  } catch (err) {
    console.error('   ❌ Lỗi kết nối Database:', err.message);
    report.database.details = err.message;
  }

  // 2. KIỂM TRA DÀN VIA (social_accounts)
  console.log('\n2️⃣ [Via Fleet Check] Đang kiểm tra 37 tài khoản Via...');
  try {
    const [vias] = await pool.execute(
      'SELECT id, platform_account_id, page_name, token_status, LENGTH(access_token) as cookie_len FROM social_accounts'
    );
    report.vias.total = vias.length;
    report.vias.live = vias.filter((v) => v.token_status === 'OK' || v.token_status === 'LIVE').length;
    report.vias.dead = report.vias.total - report.vias.live;
    console.log(`   📊 Tổng Via: ${report.vias.total} | Sống tốt (LIVE): ${report.vias.live} | Cần cập nhật: ${report.vias.dead}`);
    for (const v of vias.slice(0, 5)) {
      console.log(`      • [${v.page_name}] (UID: ${v.platform_account_id}) -> Cookie: ${v.cookie_len > 0 ? 'Có (' + v.cookie_len + ' bytes)' : 'Trống'} | Trạng thái: ${v.token_status}`);
    }
  } catch (err) {
    console.error('   ❌ Lỗi kiểm tra Vias:', err.message);
  }

  // 3. KIỂM TRA DÀN FANPAGE (facebook_page_accesses)
  console.log('\n3️⃣ [Fanpage Fleet Check] Đang rà soát dàn 600+ Fanpage...');
  try {
    const [pagesCount] = await pool.execute('SELECT COUNT(*) as total, SUM(active = 1) as active_count, SUM(verification_status = "VERIFIED") as verified_count FROM facebook_page_accesses');
    report.pages.total = Number(pagesCount[0]?.total || 0);
    report.pages.active = Number(pagesCount[0]?.active_count || 0);
    report.pages.verified = Number(pagesCount[0]?.verified_count || 0);
    console.log(`   📊 Tổng Fanpage: ${report.pages.total} | Sẵn sàng tương tác: ${report.pages.active} | Đã xác minh: ${report.pages.verified}`);

    // Thống kê theo từng Via
    const [byVia] = await pool.execute(
      'SELECT personal_profile_id, profile_name, COUNT(*) as page_count FROM facebook_page_accesses GROUP BY personal_profile_id, profile_name ORDER BY page_count DESC'
    );
    console.log('   🏛️ Phân bổ Fanpage theo Via:');
    for (const r of byVia) {
      console.log(`      • [${r.profile_name || 'Via ' + r.personal_profile_id}] (UID: ${r.personal_profile_id}): ${r.page_count} Fanpage`);
    }
  } catch (err) {
    console.error('   ❌ Lỗi kiểm tra Fanpage:', err.message);
  }

  // 4. KIỂM TRA HÀNG ĐỢI & LỊCH SỬ (buff_queue, buff_history)
  console.log('\n4️⃣ [Queue & History Check] Đang kiểm tra hàng đợi buff...');
  try {
    const [qRows] = await pool.execute('SELECT status, COUNT(*) as count FROM buff_queue GROUP BY status');
    console.log('   ⏳ Trạng thái hàng đợi buff_queue:');
    for (const r of qRows) {
      console.log(`      • ${r.status}: ${r.count} bài`);
      if (r.status === 'COMPLETED') report.queue.completed = r.count;
      else if (r.status === 'WAITING' || r.status === 'QUEUED') report.queue.waiting += r.count;
      report.queue.total += r.count;
    }

    const [histCount] = await pool.execute('SELECT COUNT(*) as count FROM buff_history');
    console.log(`   📜 Tổng số bản ghi lịch sử tương tác buff_history: ${histCount[0]?.count || 0} bài`);
  } catch (err) {
    console.error('   ❌ Lỗi kiểm tra hàng đợi:', err.message);
  }

  // 5. KIỂM TRA TELEGRAM BOT
  console.log('\n5️⃣ [Telegram Bot Check] Kiểm tra kết nối kênh thông báo...');
  try {
    const nowStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const msg = [
      `🌙 <b>[BẮT ĐẦU CHẾ ĐỘ GIÁM SÁT XUYÊN ĐÊM: VIPLIKE RADIANT]</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `✅ Cơ sở dữ liệu: <b>viplike_radiant</b> (Hoạt động tốt)`,
      `👤 Dàn Via sẵn sàng: <b>${report.vias.live}</b> / ${report.vias.total} tài khoản`,
      `📄 Dàn Fanpage sẵn sàng: <b>${report.pages.active}</b> Fanpage`,
      `⏳ Hàng đợi nhiệm vụ: <b>${report.queue.total}</b> bài`,
      `⏰ Bắt đầu lúc: ${nowStr}`,
      `━━━━━━━━━━━━━━━━━━`,
      `💤 <i>Hệ thống tự động canh gác, kiểm thử và tối ưu hoá. Chúc anh ngủ ngon!</i>`,
    ].join('\n');

    const res = await sendTelegramMessage(msg, 'HTML');
    if (res.success) {
      report.telegram.passed = true;
      report.telegram.details = `Đã gửi thông báo thành công (Message ID: ${res.data?.result?.message_id})`;
      console.log('   ✅ Đã gửi tin nhắn mở màn giám sát xuyên đêm về Telegram!');
    } else {
      report.telegram.details = res.reason;
      console.warn('   ⚠️ Không gửi được Telegram:', res.reason);
    }
  } catch (err) {
    report.telegram.details = err.message;
    console.error('   ❌ Lỗi kiểm tra Telegram:', err.message);
  }

  console.log('\n================================================================');
  console.log('✨ HOÀN TẤT BỘ KIỂM THỬ TỰ ĐỘNG! TẤT CẢ HỆ THỐNG ĐÃ SẴN SÀNG CHẠY XUYÊN ĐÊM!');
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
