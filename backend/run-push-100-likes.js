/**
 * run-push-100-likes.js
 * Safe real 100-Like push campaign with Multi-Via Rotation (split across 3 Vias)
 * Target: https://www.facebook.com/share/p/1CFB1A8SRm/
 */

const db = require('./db');
const store = require('./state-store');
const fbBuffTool = require('./fb-buff-tool');
const { filterAvailablePagesForPost, normalizeFbPostUrl } = require('./page-post-registry');
const { notifyBuffStarted, notifyBuffCompleted } = require('./telegram-alert');

async function main() {
  console.log('================================================================');
  console.log('🚀 [VIPLIKE-RADIANT] STARTING THE REAL 100-LIKE PUSH CAMPAIGN');
  console.log('🎯 Multi-Via Rotation to avoid feature blocks 100%');
  console.log('================================================================\n');

  await store.init(db);
  const targetUrl = 'https://www.facebook.com/share/p/1CFB1A8SRm/';
  const normalizedUrl = normalizeFbPostUrl(targetUrl);
  const pool = db.getPool();

  // 1. Get the 3 main Vias
  const [vias] = await pool.execute(
    'SELECT platform_account_id, page_name, access_token FROM social_accounts WHERE platform_account_id IN (?, ?, ?) AND access_token IS NOT NULL',
    ['100009194846268', '61568198025556', '100023403136194']
  );

  if (!vias.length) {
    console.error('❌ No Via accounts found!');
    process.exit(1);
  }

  // 2. Collect each Via's Pages and drop Pages that already liked this post
  const TARGET_TOTAL = 100;
  const viaBuckets = [];

  for (const via of vias) {
    const [pages] = await pool.execute(
      'SELECT page_id as id, page_name as name FROM facebook_page_accesses WHERE personal_profile_id = ? AND active = 1',
      [via.platform_account_id]
    );
    const freshPages = filterAvailablePagesForPost(normalizedUrl, pages);
    console.log(`📋 Via [${via.page_name}] (UID: ${via.platform_account_id}): ${pages.length} Pages (available, not yet liked: ${freshPages.length})`);
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
    console.error('❌ Every Page of every Via already liked this post!');
    process.exit(0);
  }

  // 3. Balance 100 Pages across the Vias
  const selectedGroups = [];
  let remainingNeeded = TARGET_TOTAL;

  // Reasonable split: Via Thạnh Phú (max ~14), Huỳnh Hồng Phước (~43), Thành An (~43)
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
  console.log(`\n🎯 TOTAL LIKES TO PUSH: ${grandTotal} LIKES`);
  selectedGroups.forEach(g => console.log(`   👉 Via [${g.viaName}]: ${g.pages.length} Page`));
  console.log('----------------------------------------------------------------\n');

  await notifyBuffStarted({
    targetUrl,
    total: grandTotal,
    reactionType: 'LIKE',
    speedMode: 'FAST',
    concurrency: 1,
    accountName: `3-Via fleet (${grandTotal} Pages)`,
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
    console.log(`⚡ [GROUP ${gIdx + 1}/${selectedGroups.length}] Running Via: "${group.viaName}" (${group.pages.length} Pages)...`);
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
            console.log(`[${overallDone}/${grandTotal}] (${pct}%) [${group.viaName}] [${evt.pageName}] ➔ ${evt.status} (Success: ${overallSuccess}, Already liked: ${overallAlreadyLiked}, Errors: ${overallFailed})`);
          }
        },
      });

      if (res && res.details) {
        allDetails.push(...res.details.map(d => ({ ...d, viaName: group.viaName })));
      }
    } catch (err) {
      console.error(`⚠️ Error running Via group [${group.viaName}]:`, err.message);
      console.log(`🔄 Switching to the next Via automatically...`);
    }

    if (gIdx < selectedGroups.length - 1) {
      console.log(`\n⏳ Safe 5-second rest before switching to the next Via...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n================================================================`);
  console.log(`🎉 100-LIKE PUSH CAMPAIGN COMPLETE!`);
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
    accountName: `3-Via fleet (${grandTotal} Pages)`,
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
