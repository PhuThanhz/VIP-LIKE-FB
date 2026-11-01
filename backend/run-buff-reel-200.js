/**
 * run-buff-reel-200.js
 * Chiến dịch đẩy 200 Like cho Facebook Reel: https://www.facebook.com/reel/1194926649525979/
 * Phân bổ dàn Via & Fanpage chống checkpoint
 */

const db = require('./db');
const store = require('./state-store');
const fbBuffTool = require('./fb-buff-tool');
const { filterAvailablePagesForPost, normalizeFbPostUrl } = require('./page-post-registry');
const { notifyBuffStarted, notifyBuffCompleted } = require('./telegram-alert');

async function main() {
  console.log('================================================================');
  console.log('🚀 [VIPLIKE-RADIANT] KHỞI ĐỘNG CHIẾN DỊCH BUFF 200 LIKE REELS');
  console.log('🎯 Target: https://www.facebook.com/reel/1194926649525979/');
  console.log('================================================================\n');

  await store.init(db);
  const targetUrl = 'https://www.facebook.com/reel/1194926649525979/';
  const normalizedUrl = normalizeFbPostUrl(targetUrl);
  const pool = db.getPool();

  // 1. Lấy danh sách các tài khoản Via chủ lực
  const [vias] = await pool.execute(
    'SELECT platform_account_id, page_name, access_token FROM social_accounts WHERE platform_account_id IN (?, ?, ?) AND access_token IS NOT NULL',
    ['100009194846268', '61568198025556', '100023403136194']
  );

  if (!vias.length) {
    console.error('❌ Không tìm thấy tài khoản Via nào trong database!');
    process.exit(1);
  }

  // 2. Kiểm tra phiên đăng nhập (Health-check) từng Via
  console.log('🔍 Kiểm tra phiên đăng nhập dàn Via...');
  const liveVias = [];
  for (const via of vias) {
    const check = await fbBuffTool.validateViaSession(via.access_token, { timeoutMs: 15000 });
    if (check.isLive) {
      console.log(`   ✅ Via [${via.page_name}] (UID: ${via.platform_account_id}): LIVE`);
      liveVias.push(via);
    } else {
      console.warn(`   ❌ Via [${via.page_name}] (UID: ${via.platform_account_id}): ${check.status} (${check.error || 'Cần cập nhật cookie'})`);
    }
  }

  if (liveVias.length === 0) {
    console.error('\n🛑 TOÀN BỘ CÁC TÀI KHOẢN VIA ĐÃ HẾT HẠN COOKIE HOẶC BỊ ĐĂNG XUẤT!');
    console.error('👉 Vui lòng cập nhật Cookie mới cho ít nhất 1 Via (Huỳnh Thạnh Phú, Thành An, hoặc Huỳnh Hồng Phước) để tiến hành buff Like.');
    process.exit(2);
  }

  // 3. Thu thập Page của từng Via LIVE và lọc trùng
  const TARGET_TOTAL = 200;
  const viaBuckets = [];

  for (const via of liveVias) {
    const [pages] = await pool.execute(
      'SELECT page_id as id, page_name as name FROM facebook_page_accesses WHERE personal_profile_id = ? AND active = 1',
      [via.platform_account_id]
    );
    const freshPages = filterAvailablePagesForPost(normalizedUrl, pages);
    console.log(`📋 Via [${via.page_name}]: Tổng ${pages.length} Page, Chưa like Reel: ${freshPages.length}`);
    if (freshPages.length > 0) {
      viaBuckets.push({
        viaName: via.page_name,
        viaUid: via.platform_account_id,
        cookieString: via.access_token,
        availablePages: freshPages,
      });
    }
  }

  if (!viaBuckets.length) {
    console.error('❌ Toàn bộ Page của các Via đang LIVE đã Like Reel này trước đó!');
    process.exit(0);
  }

  // 4. Phân bổ cân bằng 200 Page qua các Via
  const selectedGroups = [];
  let remainingNeeded = TARGET_TOTAL;

  for (let i = 0; i < viaBuckets.length; i++) {
    const bucket = viaBuckets[i];
    const isLast = (i === viaBuckets.length - 1);
    const quota = isLast
      ? Math.min(remainingNeeded, bucket.availablePages.length)
      : Math.min(Math.ceil(TARGET_TOTAL / viaBuckets.length), bucket.availablePages.length, remainingNeeded);

    const chosen = bucket.availablePages.slice(0, quota);
    remainingNeeded -= chosen.length;

    selectedGroups.push({
      viaName: bucket.viaName,
      viaUid: bucket.viaUid,
      cookieString: bucket.cookieString,
      pages: chosen,
    });
  }

  const grandTotal = selectedGroups.reduce((acc, g) => acc + g.pages.length, 0);
  console.log(`\n🎯 TỔNG SỐ LIKE SẼ BUFF: ${grandTotal} LIKE`);
  selectedGroups.forEach(g => console.log(`   👉 Via [${g.viaName}]: ${g.pages.length} Page`));
  console.log('----------------------------------------------------------------\n');

  await notifyBuffStarted({
    targetUrl,
    total: grandTotal,
    reactionType: 'LIKE',
    speedMode: 'FAST',
    concurrency: 1,
    accountName: `Dàn ${selectedGroups.length} Via (${grandTotal} Page)`,
  }).catch(() => {});

  const startTime = Date.now();
  let overallSuccess = 0;
  let overallAlreadyLiked = 0;
  let overallFailed = 0;
  let overallDone = 0;
  const allDetails = [];

  console.log(`\n🚀 [MULTI-VIA ENGINE] Khởi chạy song song ${selectedGroups.length} nhóm Via...`);

  await Promise.all(
    selectedGroups.map(async (group, gIdx) => {
      if (group.pages.length === 0) return;

      console.log(`⚡ [NHÓM ${gIdx + 1}/${selectedGroups.length}] Kích hoạt luồng Via: "${group.viaName}" (${group.pages.length} Page)...`);

      try {
        const res = await fbBuffTool.buffLikesWithPages(group.cookieString, targetUrl, {
          reactionType: 'LIKE',
          selectedPages: group.pages,
          kpiTarget: TARGET_TOTAL,
          delayMs: 1600,
          speedMode: 'FAST',
          enableLike: true,
          enableComment: false,
          enableShare: false,
          enableHumanBehavior: false,
          fastSwitch: true, // Hỗ trợ Fast-Switch trực tiếp trên Reels
          concurrency: 2,
          cooldownEvery: 35,
          cooldownDurationMs: 8000,
          onProgress: (evt) => {
            if (evt.type === 'PAGE_FINISH') {
              overallDone++;
              if (evt.status === 'SUCCESS') overallSuccess++;
              else if (evt.status === 'ALREADY_LIKED') overallAlreadyLiked++;
              else overallFailed++;

              const pct = Math.round((overallDone / grandTotal) * 100);
              console.log(`[${overallDone}/${grandTotal}] (${pct}%) [${group.viaName}] [${evt.pageName}] ➔ ${evt.status} (Thành công: ${overallSuccess}, Đã like: ${overallAlreadyLiked}, Lỗi: ${overallFailed})`);
            }
          },
        });

        if (res && res.details) {
          allDetails.push(...res.details.map(d => ({ ...d, viaName: group.viaName })));
        }
      } catch (err) {
        console.error(`⚠️ Lỗi khi chạy nhóm Via [${group.viaName}]:`, err.message);
      }
    })
  );

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n================================================================`);
  console.log(`🎉 HOÀN TẤT CHIẾN DỊCH PUSH LIKE REEL!`);
  console.log(`⏱️ Thời gian: ${durationSec}s (~${Math.round(durationSec / 60)} phút)`);
  console.log(`✅ Thành công thực tế: ${overallSuccess}/${grandTotal}`);
  console.log(`ℹ️ Đã like từ trước: ${overallAlreadyLiked}`);
  console.log(`❌ Lỗi / Bỏ qua: ${overallFailed}`);
  console.log(`================================================================\n`);

  // Lưu log vào MySQL
  const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  await db.saveBuffLogs({
    id: logId,
    createdAt: new Date().toISOString(),
    type: 'SINGLE',
    targetUrl,
    reactionType: 'LIKE',
    totalPages: grandTotal,
    successCount: overallSuccess,
    alreadyLikedCount: overallAlreadyLiked,
    failedCount: overallFailed,
    engagementMode: 'LIKE_ONLY',
    commentCount: 0,
    accountName: `Dàn Via (${grandTotal} Page)`,
    details: allDetails,
  }).catch(() => {});

  // Báo cáo Telegram
  await notifyBuffCompleted({
    targetUrl,
    success: overallSuccess,
    total: grandTotal,
    failed: overallFailed,
    durationSec,
    reactionType: 'LIKE',
  }).catch(() => {});

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
