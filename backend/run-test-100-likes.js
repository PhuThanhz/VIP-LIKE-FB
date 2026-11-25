/**
 * run-test-100-likes.js
 * Real 100-Like test campaign for the post https://www.facebook.com/share/p/1CTiH3MASJ/
 * Uses 100 Fanpages managed by Via Thành An (100023403136194)
 */

const db = require('./db');
const store = require('./state-store');
const fbBuffTool = require('./fb-buff-tool');
const { filterAvailablePagesForPost, normalizeFbPostUrl } = require('./page-post-registry');

async function main() {
  console.log('🚀 [VIPLIKE] Starting the real 100-Like buff campaign...');
  await store.init(db);
  const targetUrl = 'https://www.facebook.com/share/p/1CTiH3MASJ/';
  const normalizedUrl = normalizeFbPostUrl(targetUrl);

  const pool = db.getPool();
  // 1. Get the Cookie of Via Thành An (100023403136194)
  const [vias] = await pool.execute(
    'SELECT access_token, page_name FROM social_accounts WHERE platform_account_id = ?',
    ['100023403136194']
  );
  if (!vias.length || !vias[0].access_token) {
    console.error('❌ Cookie for Via Thành An not found');
    process.exit(1);
  }
  const cookieString = vias[0].access_token;

  // 2. Get the Fanpages MANAGED BY Via Thành An (so there's no admin-rights conflict)
  const [allPages] = await pool.execute(
    'SELECT page_id as id, page_name as name FROM facebook_page_accesses WHERE personal_profile_id = ? AND active = 1',
    ['100023403136194']
  );
  console.log(`📋 Total Pages of Via Thành An in the DB: ${allPages.length}`);

  // 3. Automatically drop Pages that already engaged with this post
  const freshPages = filterAvailablePagesForPost(normalizedUrl, allPages);
  console.log(`🛡️ New Pages that haven't engaged with this post: ${freshPages.length}`);

  // 4. Take exactly 100 Pages
  const targetCount = Math.min(100, freshPages.length);
  const selectedPages = freshPages.slice(0, targetCount);
  console.log(`🎯 Target: ${selectedPages.length} Likes | Mode: Safe Fast | Threads: 1 standard thread`);

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
          console.log(`[${doneCount}/${selectedPages.length}] (${percent}%) [${evt.pageName}] ➔ ${evt.status} (Success: ${successCount}, Skipped: ${alreadyLikedCount}, Errors: ${failedCount})`);
        }
      },
    });

    const durationSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n==================================================`);
    console.log(`🎉 100-LIKE CAMPAIGN COMPLETE!`);
    console.log(`⏱️ Time: ${durationSec}s`);
    console.log(`✅ Actual successes: ${result.success}/${selectedPages.length}`);
    console.log(`ℹ️ Already liked: ${result.alreadyLiked || 0}`);
    console.log(`❌ Errors / Skipped: ${result.failed || 0}`);
  } catch (err) {
    console.error('❌ Run error:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
