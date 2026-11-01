/**
 * run-push-100-likes.js
 * Chiến dịch đẩy 100 Like thật an toàn bằng Multi-Via Rotation (Chia đều 3 Via)
 * Target: https://www.facebook.com/share/p/1CFB1A8SRm/
 */

const db = require('./db');
const store = require('./state-store');
const fbBuffTool = require('./fb-buff-tool');
const { filterAvailablePagesForPost, normalizeFbPostUrl } = require('./page-post-registry');
const { notifyBuffStarted, notifyBuffCompleted } = require('./telegram-alert');

async function main() {
  console.log('================================================================');
  console.log('🚀 [VIPLIKE-RADIANT] KHỞI ĐỘNG CHIẾN DỊCH PUSH 100 LIKE THẬT');
  console.log('🎯 Phân bổ đa Via (Multi-Via Rotation) chống chặn tính năng 100%');
  console.log('================================================================\n');

  await store.init(db);
  const targetUrl = 'https://www.facebook.com/share/p/1CFB1A8SRm/';
  const normalizedUrl = normalizeFbPostUrl(targetUrl);
  const pool = db.getPool();

  // 1. Lấy danh sách 3 Via chủ lực
  const [vias] = await pool.execute(
    'SELECT platform_account_id, page_name, access_token FROM social_accounts WHERE platform_account_id IN (?, ?, ?) AND access_token IS NOT NULL',
    ['100009194846268', '61568198025556', '100023403136194']
  );

  if (!vias.length) {
    console.error('❌ Không tìm thấy tài khoản Via nào!');
    process.exit(1);
  }

  // 2. Thu thập Page của từng Via và lọc bỏ các Page đã like bài này trước đó
  const TARGET_TOTAL = 100;
  const viaBuckets = [];

  for (const via of vias) {
    const [pages] = await pool.execute(
      'SELECT page_id as id, page_name as name FROM facebook_page_accesses WHERE personal_profile_id = ? AND active = 1',
      [via.platform_account_id]
    );
    const freshPages = filterAvailablePagesForPost(normalizedUrl, pages);
    console.log(`📋 Via [${via.page_name}] (UID: ${via.platform_account_id}): Có ${pages.length} Page (Khả dụng chưa like: ${freshPages.length})`);
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
    console.error('❌ Toàn bộ các Page của mọi Via đã like bài viết này!');
    process.exit(0);
  }

  // 3. Phân bổ cân bằng 100 Page qua các Via
  const selectedGroups = [];
  let remainingNeeded = TARGET_TOTAL;

  // Lấy tỷ lệ hợp lý: Via Thạnh Phú (tối đa ~14), Huỳnh Hồng Phước (~43), Thành An (~43)
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
  console.log(`\n🎯 TỔNG SỐ LIKE CẦN BƠM: ${grandTotal} LIKE`);
  selectedGroups.forEach(g => console.log(`   👉 Via [${g.viaName}]: ${g.pages.length} Page`));
  console.log('----------------------------------------------------------------\n');

  await notifyBuffStarted({
    targetUrl,
    total: grandTotal,
    reactionType: 'LIKE',
    speedMode: 'FAST',
    concurrency: 1,
    accountName: `Dàn 3 Via (${grandTotal} Page)`,
  }).catch(() => {});

  const startTime = Date.now();
  let overallSuccess = 0;
  let overallAlreadyLiked = 0;
  let overallFailed = 0;
  let overallDone = 0;
  const allDetails = [];

  for (let gIdx = 0; gIdx < selectedGroups.length; gIdx++) {
    const group = selectedGroups[gIdx];
    if (group.pages.length === 0) continue;

    console.log(`\n==================================================`);
    console.log(`⚡ [NHÓM ${gIdx + 1}/${selectedGroups.length}] Đang chạy Via: "${group.viaName}" (${group.pages.length} Page)...`);
    console.log(`==================================================`);

    try {
      const res = await fbBuffTool.buffLikesWithPages(group.cookieString, targetUrl, {
        reactionType: 'LIKE',
        selectedPages: group.pages,
        delayMs: 3200,
        speedMode: 'FAST',
        enableLike: true,
        enableComment: false,
        enableShare: false,
        enableHumanBehavior: false,
        fastSwitch: true,
        concurrency: 1,
        cooldownEvery: 25,
        cooldownDurationMs: 20000,
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
      console.log(`🔄 Tự động chuyển sang Via tiếp theo...`);
    }

    if (gIdx < selectedGroups.length - 1) {
      console.log(`\n⏳ Nghỉ an toàn 5 giây trước khi chuyển sang Via tiếp theo...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n================================================================`);
  console.log(`🎉 HOÀN TẤT CHIẾN DỊCH PUSH 100 LIKE!`);
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
    accountName: `Dàn 3 Via (${grandTotal} Page)`,
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
