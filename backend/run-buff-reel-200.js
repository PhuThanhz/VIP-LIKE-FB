/**
 * run-buff-reel-200.js
 * 200-Like push campaign for the Facebook Reel: https://www.facebook.com/reel/1194926649525979/
 * Distributes Vias & Fanpages to avoid checkpoints
 */

const db = require('./db');
const store = require('./state-store');
const fbBuffTool = require('./fb-buff-tool');
const { filterAvailablePagesForPost, normalizeFbPostUrl } = require('./page-post-registry');
const { notifyBuffStarted, notifyBuffCompleted } = require('./telegram-alert');

async function main() {
  console.log('================================================================');
  console.log('🚀 [VIPLIKE-RADIANT] STARTING THE 200-LIKE REELS BUFF CAMPAIGN');
  console.log('🎯 Target: https://www.facebook.com/reel/1194926649525979/');
  console.log('================================================================\n');

  await store.init(db);
  const targetUrl = 'https://www.facebook.com/reel/1194926649525979/';
  const normalizedUrl = normalizeFbPostUrl(targetUrl);
  const pool = db.getPool();

  // 1. Get the main Via accounts
  const [vias] = await pool.execute(
    'SELECT platform_account_id, page_name, access_token FROM social_accounts WHERE platform_account_id IN (?, ?, ?) AND access_token IS NOT NULL',
    ['100009194846268', '61568198025556', '100023403136194']
  );

  if (!vias.length) {
    console.error('❌ No Via accounts found in the database!');
    process.exit(1);
  }

  // 2. Health-check each Via's login session
  console.log('🔍 Checking the Vias\' login sessions...');
  const liveVias = [];
  for (const via of vias) {
    const check = await fbBuffTool.validateViaSession(via.access_token, { timeoutMs: 15000 });
    if (check.isLive) {
      console.log(`   ✅ Via [${via.page_name}] (UID: ${via.platform_account_id}): LIVE`);
      liveVias.push(via);
    } else {
      console.warn(`   ❌ Via [${via.page_name}] (UID: ${via.platform_account_id}): ${check.status} (${check.error || 'Cookie needs updating'})`);
    }
  }

  if (liveVias.length === 0) {
    console.error('\n🛑 EVERY VIA ACCOUNT HAS AN EXPIRED COOKIE OR IS LOGGED OUT!');
    console.error('👉 Please update the Cookie of at least 1 Via (Huỳnh Thạnh Phú, Thành An, or Huỳnh Hồng Phước) to buff Likes.');
    process.exit(2);
  }

  // 3. Collect each LIVE Via's Pages and dedupe
  const TARGET_TOTAL = 200;
  const viaBuckets = [];

  for (const via of liveVias) {
    const [pages] = await pool.execute(
      'SELECT page_id as id, page_name as name FROM facebook_page_accesses WHERE personal_profile_id = ? AND active = 1',
      [via.platform_account_id]
    );
    const freshPages = filterAvailablePagesForPost(normalizedUrl, pages);
    console.log(`📋 Via [${via.page_name}]: ${pages.length} Pages total, not yet liked the Reel: ${freshPages.length}`);
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
    console.error('❌ Every Page of the LIVE Vias already liked this Reel!');
    process.exit(0);
  }

  // 4. Balance 200 Pages across the Vias
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
  console.log(`\n🎯 TOTAL LIKES TO BUFF: ${grandTotal} LIKES`);
  selectedGroups.forEach(g => console.log(`   👉 Via [${g.viaName}]: ${g.pages.length} Page`));
  console.log('----------------------------------------------------------------\n');

  await notifyBuffStarted({
    targetUrl,
    total: grandTotal,
    reactionType: 'LIKE',
    speedMode: 'FAST',
    concurrency: 1,
    accountName: `${selectedGroups.length}-Via fleet (${grandTotal} Pages)`,
  }).catch(() => {});

  const startTime = Date.now();
  let overallSuccess = 0;
  let overallAlreadyLiked = 0;
  let overallFailed = 0;
  let overallDone = 0;
  const allDetails = [];

  console.log(`\n🚀 [MULTI-VIA ENGINE] Launching ${selectedGroups.length} Via groups in parallel...`);

  await Promise.all(
    selectedGroups.map(async (group, gIdx) => {
      if (group.pages.length === 0) return;

      console.log(`⚡ [GROUP ${gIdx + 1}/${selectedGroups.length}] Starting Via thread: "${group.viaName}" (${group.pages.length} Pages)...`);

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
          fastSwitch: true, // Fast-Switch support right on Reels
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
              console.log(`[${overallDone}/${grandTotal}] (${pct}%) [${group.viaName}] [${evt.pageName}] ➔ ${evt.status} (Success: ${overallSuccess}, Already liked: ${overallAlreadyLiked}, Errors: ${overallFailed})`);
            }
          },
        });

        if (res && res.details) {
          allDetails.push(...res.details.map(d => ({ ...d, viaName: group.viaName })));
        }
      } catch (err) {
        console.error(`⚠️ Error running Via group [${group.viaName}]:`, err.message);
      }
    })
  );

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n================================================================`);
  console.log(`🎉 REEL LIKE PUSH CAMPAIGN COMPLETE!`);
  console.log(`⏱️ Time: ${durationSec}s (~${Math.round(durationSec / 60)} min)`);
  console.log(`✅ Actual successes: ${overallSuccess}/${grandTotal}`);
  console.log(`ℹ️ Already liked: ${overallAlreadyLiked}`);
  console.log(`❌ Errors / Skipped: ${overallFailed}`);
  console.log(`================================================================\n`);

  // Save the log to MySQL
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
    accountName: `Via fleet (${grandTotal} Pages)`,
    details: allDetails,
  }).catch(() => {});

  // Telegram report
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
