/**
 * run-test-100-likes.js
 * Chiến dịch test 100 Like thật cho bài viết https://www.facebook.com/share/p/1CTiH3MASJ/
 * Sử dụng 100 Fanpage trực thuộc quyền quản trị của Via Thành An (100023403136194)
 */

const db = require('./db');
const store = require('./state-store');
const fbBuffTool = require('./fb-buff-tool');
const { filterAvailablePagesForPost, normalizeFbPostUrl } = require('./page-post-registry');

async function main() {
  console.log('🚀 [VIPLIKE] Bắt đầu chiến dịch buff 100 Like thật...');
  await store.init(db);
  const targetUrl = 'https://www.facebook.com/share/p/1CTiH3MASJ/';
  const normalizedUrl = normalizeFbPostUrl(targetUrl);

  const pool = db.getPool();
  // 1. Lấy Cookie của Via Thành An (100023403136194)
  const [vias] = await pool.execute(
    'SELECT access_token, page_name FROM social_accounts WHERE platform_account_id = ?',
    ['100023403136194']
  );
  if (!vias.length || !vias[0].access_token) {
    console.error('❌ Không tìm thấy cookie của Via Thành An');
    process.exit(1);
  }
  const cookieString = vias[0].access_token;

  // 2. Lấy danh sách Fanpage TRỰC THUỘC Via Thành An (để đảm bảo không bị xung đột quyền quản trị)
  const [allPages] = await pool.execute(
    'SELECT page_id as id, page_name as name FROM facebook_page_accesses WHERE personal_profile_id = ? AND active = 1',
    ['100023403136194']
  );
  console.log(`📋 Tổng số Page của Via Thành An trong CSDL: ${allPages.length}`);

  // 3. Tự động lọc bỏ các Page đã tương tác bài này trước đó
  const freshPages = filterAvailablePagesForPost(normalizedUrl, allPages);
  console.log(`🛡️ Số Page mới chưa tương tác bài viết này: ${freshPages.length}`);

  // 4. Lấy đúng 100 Page
  const targetCount = Math.min(100, freshPages.length);
  const selectedPages = freshPages.slice(0, targetCount);
  console.log(`🎯 Mục tiêu: ${selectedPages.length} Like | Chế độ: Tốc độ cao an toàn (Safe Fast) | Đa luồng: 1 luồng chuẩn`);

  const startTime = Date.now();
  let doneCount = 0;
  let successCount = 0;
  let alreadyLikedCount = 0;
  let failedCount = 0;

  try {
    const result = await fbBuffTool.buffLikesWithPages(cookieString, targetUrl, {
      reactionType: 'LIKE',
      selectedPages,
      delayMs: 3200,
      speedMode: 'FAST',
      enableLike: true,
      enableComment: false,
      enableShare: false,
      enableHumanBehavior: false,
      fastSwitch: true,
      concurrency: 1,
      cooldownEvery: 35,
      cooldownDurationMs: 20000,
      onProgress: (evt) => {
        if (evt.type === 'PAGE_FINISH') {
          doneCount++;
          if (evt.status === 'SUCCESS') successCount++;
          else if (evt.status === 'ALREADY_LIKED') alreadyLikedCount++;
          else failedCount++;

          const percent = Math.round((doneCount / selectedPages.length) * 100);
          console.log(`[${doneCount}/${selectedPages.length}] (${percent}%) [${evt.pageName}] ➔ ${evt.status} (Thành công: ${successCount}, Bỏ qua: ${alreadyLikedCount}, Lỗi: ${failedCount})`);
        }
      },
    });

    const durationSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n==================================================`);
    console.log(`🎉 HOÀN TẤT CHIẾN DỊCH 100 LIKE!`);
    console.log(`⏱️ Thời gian: ${durationSec}s`);
    console.log(`✅ Thành công thực tế: ${result.success}/${selectedPages.length}`);
    console.log(`ℹ️ Đã like từ trước: ${result.alreadyLiked || 0}`);
    console.log(`❌ Lỗi / Bỏ qua: ${result.failed || 0}`);
  } catch (err) {
    console.error('❌ Lỗi tiến trình:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
