/**
 * VIPLIKE RADIANT - BACKEND SERVER
 * Integrates directly with MySQL Workbench (viplike_radiant), Playwright Automation & Gemini AI
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DATA_DIR: PATHS_DATA_DIR } = require('./paths');
require('dotenv').config();

const db = require('./db');
const store = require('./state-store');
const fbBuffTool = require('./fb-buff-tool');
const {
  isEmergencyStopped,
  setEmergencyStop,
  loadSettings: loadBuffSettings,
  saveSettings: saveBuffSettings,
  notifyViaDead,
  notifyBuffStarted,
  notifyQueueAdded,
  notifyBuffCompleted,
  notifyPostHunted,
  notifyQueueIdle,
  notifyQueueTrouble,
  notifyActionBlocked,
  sendAlert,
  formatDurationVi,
  startCommandListener,
  sendTelegramMessage,
  registerShortUrl,
} = require('./telegram-alert');
const {
  filterAvailablePagesForPost,
  getGlobalRegistryStats,
  normalizeFbPostUrl,
  clearPostInteractions,
  getPostInteractedPageIds,
  resolvePostUrlCanonical,
  backfillShareAliases,
  countPostSuccessSince,
} = require('./page-post-registry');
const { generateSeedingComments } = require('./ai-seeding');
const avatarTool = require('./avatar-tool');
const telemetry = require('./telemetry');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(telemetry.middleware());

// For the first few seconds data is still loading from MySQL: block requests so nothing reads/writes stale data
app.use((req, res, next) => {
  if (req.method === 'OPTIONS' || store.isReady()) return next();
  return res.status(503).json({ success: false, error: 'The system is starting up, please try again in a few seconds.' });
});

// Make sure the data storage directory exists
const DATA_DIR = PATHS_DATA_DIR;
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// =============================================================================
// 1. DATA HELPERS (QUEUE, HISTORY, MONITORS)
//    Saved via state-store: MySQL (app_state table) is the primary source, JSON files in data/ are the backup.
// =============================================================================

function loadBuffQueue() {
  const data = store.read('buff_queue');
  if (data && Array.isArray(data.items)) return data;
  console.warn('[BuffQueue] ⚠️ Queue data is malformed, reinitializing.');
  return store.write('buff_queue', { items: [] });
}

function saveBuffQueue(queueData) {
  store.write('buff_queue', queueData);
  syncBuffQueueToMysql(queueData).catch(() => {});
}

// Fingerprints of each queue item written to MySQL (id → synced fields).
// saveBuffQueue is called very often (even while the worker runs) → only write items that actually changed.
const syncedQueueSignatures = new Map();

async function syncBuffQueueToMysql(queueData) {
  try {
    const p = db.getPool();
    const items = queueData?.items || [];
    for (const it of items) {
      if (!it.id) continue;
      const sig = JSON.stringify([
        it.targetUrl || it.normalizedUrl || '',
        it.targetLikes, it.reactionType, it.delayMinutes, Boolean(it.enableComment), it.comments || [],
        it.status, it.progress?.done ?? it.result?.success ?? 0,
        it.runAfter || null, it.addedAt || null, it.finishedAt || null,
      ]);
      if (syncedQueueSignatures.get(it.id) === sig) continue;
      const targetUrl = it.targetUrl || it.normalizedUrl || '';
      const targetLikes = Number(it.targetLikes) || 30;
      const reactionType = it.reactionType || 'RANDOM_POSITIVE';
      const delayMinutes = Number(it.delayMinutes) || 5;
      const enableComment = it.enableComment ? 1 : 0;
      const commentList = JSON.stringify(it.comments || []);
      let status = 'WAITING';
      if (it.status === 'COMPLETED') status = 'COMPLETED';
      else if (it.status === 'RUNNING') status = 'RUNNING';
      else if (it.status === 'FAILED') status = 'FAILED';
      else if (it.status === 'PAUSED') status = 'PAUSED';
      else if (['CANCELLED', 'STOPPED', 'PARTIAL', 'NEEDS_REVIEW', 'DEAD_LETTER'].includes(it.status)) {
        status = it.status;
      }

      const progressLikes = Number(it.progress?.done ?? it.result?.success ?? 0);
      const progressComments = 0;
      const scheduleTime = it.runAfter ? new Date(it.runAfter) : new Date();
      const createdAt = it.addedAt ? new Date(it.addedAt) : new Date();
      const completedAt = it.finishedAt ? new Date(it.finishedAt) : null;

      await p.execute(
        `INSERT INTO buff_queue (id, target_url, target_likes, reaction_type, delay_minutes, enable_comment, comment_list, status, progress_likes, progress_comments, schedule_time, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           target_url = VALUES(target_url),
           target_likes = VALUES(target_likes),
           reaction_type = VALUES(reaction_type),
           status = VALUES(status),
           progress_likes = VALUES(progress_likes),
           completed_at = VALUES(completed_at)`,
        [
          it.id,
          targetUrl,
          targetLikes,
          reactionType,
          delayMinutes,
          enableComment,
          commentList,
          status,
          progressLikes,
          progressComments,
          scheduleTime,
          createdAt,
          completedAt,
        ]
      );
      syncedQueueSignatures.set(it.id, sig);
    }
  } catch (_) {}
}

// Set of taskIds explicitly requested to cancel (e.g. turning off Post Hunter)
const cancelledTaskIds = new Set();

function isPostHunterTask(task) {
  const src = String(task?.source || '');
  return src.startsWith('POST_HUNTER') || src === 'AUTO_OWN_POST';
}

function isPostHunterPaused() {
  return Boolean(loadBuffSettings().postHunterPaused);
}

/** Cancels every waiting or running Post Hunter task without touching manual orders */
function cancelPendingPostHunterTasks(reason = 'Cancelled because Post Hunter was paused') {
  const qd = loadBuffQueue();
  const cancelledIds = [];
  const nowIso = new Date().toISOString();

  for (const it of qd.items || []) {
    if (!isPostHunterTask(it)) continue;
    if (it.status === 'QUEUED' || it.status === 'RUNNING') {
      it.status = 'CANCELLED';
      it.executionStage = 'CANCELLED';
      it.finishedAt = nowIso;
      it.error = reason;
      cancelledTaskIds.add(it.id);
      cancelledIds.push(it.id);
    }
  }

  if (cancelledIds.length > 0) {
    saveBuffQueue(qd);
  }
  return cancelledIds;
}

function recoverStaleRunningQueueTasks() {
  try {
    const qd = loadBuffQueue();
    const hunterPaused = isPostHunterPaused();
    let recoveredCount = 0;
    let reviewCount = 0;
    let completedCount = 0;
    let cancelledHunterCount = 0;

    for (const it of qd.items || []) {
      if (hunterPaused && isPostHunterTask(it) && (it.status === 'RUNNING' || it.status === 'QUEUED')) {
        it.status = 'CANCELLED';
        it.executionStage = 'CANCELLED';
        it.finishedAt = it.finishedAt || new Date().toISOString();
        it.error = 'Cancelled because Post Hunter is paused.';
        cancelledHunterCount++;
        continue;
      }

      if (it.status === 'RUNNING') {
        const hasExternalSideEffects =
          it.executionStage === 'INTERACTING' ||
          Number(it.progress?.done || 0) > 0 ||
          Number(it.progress?.success || 0) > 0 ||
          Number(it.progressLikes || 0) > 0 ||
          (Array.isArray(it.pageDetails) && it.pageDetails.length > 0);

        if (it.executionStage === 'SYNCING') {
          // Engagement finished, only the log sync was missed -> complete safely
          it.status = 'COMPLETED';
          it.executionStage = 'COMPLETED';
          it.finishedAt = it.finishedAt || new Date().toISOString();
          completedCount++;
        } else if (!hasExternalSideEffects) {
          // Nothing has been sent to the external platform yet -> safe to restore to QUEUED
          it.status = 'QUEUED';
          it.executionStage = 'INITIALIZED';
          it.error = 'The server restarted before the task started any external action. Safely restored to the queue.';
          recoveredCount++;
        } else {
          // External actions HAVE been or ARE being performed -> move to NEEDS_REVIEW, no automatic retry
          it.status = 'NEEDS_REVIEW';
          it.executionStage = 'NEEDS_REVIEW';
          it.reviewReason = 'CRASH_DURING_EXTERNAL_INTERACTION';
          it.error = `The task was interrupted by a server restart while engaging externally (successful likes: ${it.progress?.success || it.progressLikes || 0}). Moved to NEEDS_REVIEW for manual reconciliation to prevent duplicate engagement.`;
          reviewCount++;
        }
      }
    }
    if (recoveredCount > 0 || reviewCount > 0 || completedCount > 0 || cancelledHunterCount > 0) {
      saveBuffQueue(qd);
      console.log(`[Queue Recovery] 🔄 Recovered after restart/crash: ${recoveredCount} tasks back to QUEUED, ${completedCount} tasks synced to COMPLETED, ${reviewCount} tasks moved to NEEDS_REVIEW, ${cancelledHunterCount} Post Hunter tasks cancelled.`);
    }
  } catch (e) {
    console.warn('[Queue Recovery] ⚠️ Error checking task recovery:', e.message);
  }
}

let lastQueueSyncTime = 0;
async function syncCompletedQueueTasksToBuffLogs(force = false) {
  const now = Date.now();
  if (!force && now - lastQueueSyncTime < 10000) return;
  lastQueueSyncTime = now;
  try {
    const qd = loadBuffQueue();
    if (!qd || !Array.isArray(qd.items)) return;
    // Sync every finished or ended queue task (COMPLETED, PARTIAL, FAILED, STOPPED)
    const finishedTasks = qd.items.filter((it) => 
      (it.status === 'COMPLETED' || it.status === 'PARTIAL' || it.status === 'FAILED' || it.status === 'STOPPED' || it.status === 'DEAD_LETTER') && it.targetUrl
    );
    if (finishedTasks.length === 0) return;

    const newLogs = [];
    for (const t of finishedTasks) {
      const logId = 'log_' + t.id;
      const res = t.result || {};
      const successCount = typeof res.success === 'number' ? res.success : (Number(t.progress?.success ?? t.progressLikes) || 0);
      const failedCount = typeof res.failed === 'number' ? res.failed : (Number(t.progress?.failed) || 0);
      const totalPages = typeof res.targetKpi === 'number' ? res.targetKpi : (t.targetLikes === 'ALL' ? (successCount + failedCount) : (Number(t.targetLikes) || 30));
      const alreadyLikedCount = Array.isArray(t.pageDetails)
        ? t.pageDetails.filter((d) => d.status === 'ALREADY_LIKED').length
        : 0;

      newLogs.push({
        id: logId,
        createdAt: t.finishedAt || t.addedAt || new Date().toISOString(),
        type: 'QUEUE',
        targetUrl: t.targetUrl,
        reactionType: t.reactionType || 'LIKE',
        engagementMode: t.enableComment ? 'BOTH' : 'LIKE_ONLY',
        accountName: t.accountName || (t.status === 'FAILED' ? 'VIP LIKE Queue (Failed)' : 'VIP LIKE Queue'),
        totalPages,
        targetLikes: typeof t.targetLikes === 'number' ? t.targetLikes : undefined,
        successCount,
        alreadyLikedCount,
        failedCount,
        commentCount: 0,
        details: Array.isArray(t.pageDetails) && t.pageDetails.length > 0 ? t.pageDetails : (t.error ? [{
          pageName: 'Queue system',
          status: 'FAILED',
          error: t.error,
          time: new Date().toLocaleTimeString(),
        }] : []),
      });
    }

    if (newLogs.length > 0) {
      await db.saveBuffLogs(newLogs);
    }
  } catch (err) {
    console.warn('[BuffLogs] ⚠️ Error syncing the completed queue to buff_logs:', err.message);
  }
}

// Fingerprints of buff_history items already in MySQL (url → lastBuffedAt|totalSuccess).
// Previously every save INSERTed the whole history → the table ballooned to tens of thousands of duplicate rows.
const syncedHistorySignatures = new Map();
let historySignaturesSeeded = false;
const historySignature = (item) => `${item?.lastBuffedAt || ''}|${item?.totalSuccess || 0}`;
function seedHistorySignatures(data) {
  if (historySignaturesSeeded) return;
  historySignaturesSeeded = true;
  // History present at startup was already synced by earlier saves → only record it, don't rewrite
  for (const [url, item] of Object.entries(data || {})) syncedHistorySignatures.set(url, historySignature(item));
}

function loadBuffHistory() {
  const data = store.read('buff_history');
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    seedHistorySignatures(data);
    return data;
  }
  return store.write('buff_history', {});
}

function saveBuffHistory(historyData) {
  store.write('buff_history', historyData);
  syncBuffHistoryToMysql(historyData).catch(() => {});
}

async function syncBuffHistoryToMysql(historyData) {
  try {
    const p = db.getPool();
    const entries = Object.entries(historyData || {});
    for (const [url, item] of entries) {
      const sig = historySignature(item);
      if (syncedHistorySignatures.get(url) === sig) continue; // unchanged since the last sync
      const targetUrl = item.url || item.normalizedUrl || url;
      const reaction = item.reactionType || 'LIKE';
      const status = 'COMPLETED';
      const createdAt = item.lastBuffedAt ? new Date(item.lastBuffedAt) : new Date();
      await p.execute(
        `INSERT INTO buff_history (user_id, target_url, page_id, page_name, interaction_type, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [1, targetUrl, 'ALL_PAGES', `Engaged (${item.totalSuccess || 1} times)`, reaction, status, createdAt]
      );
      syncedHistorySignatures.set(url, sig);
    }
    historySignaturesSeeded = true;
  } catch (_) {}
}

function loadBuffMonitors() {
  const data = store.read('buff_monitors');
  if (data && Array.isArray(data.monitors)) return data;
  return { monitors: [] };
}

function saveBuffMonitors(data) {
  store.write('buff_monitors', data);
}

function parseTargetLikes(value, fallback = 30) {
  if (value === 'ALL' || value === 0 || value === '0') return 'ALL';
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseDelayMinutes(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

// =============================================================================
// 2. CONCURRENCY & LANE MANAGEMENT
// =============================================================================

const activeBuffTaskIds = new Set();
const activeBuffVias = new Set();
function getMaxParallelBuff() {
  const n = parseInt(loadBuffSettings().maxParallelTasks, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 4) : 2;
}
const busyBuffLanes = new Set();
const buffLaneWaiters = [];
const activeLaneLeases = new Map(); // uid -> { leaseToken, abortController, leaseTimer, acquiredAt }

// DURABLE MONOTONIC DISTRIBUTED FENCING TOKEN ENGINE
let currentFenceEpoch = 0;
async function initFenceEpoch() {
  try {
    currentFenceEpoch = await db.allocateFencingToken();
    console.log(`[Fencing Token] 🛡️ Allocated a durable distributed Epoch from MySQL: ${currentFenceEpoch}`);
  } catch (e) {
    currentFenceEpoch = Date.now() * 1000;
  }
}
function getNextFencingToken() {
  if (!currentFenceEpoch) {
    currentFenceEpoch = Date.now() * 1000;
  }
  return ++currentFenceEpoch;
}

const LANE_INACTIVITY_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes without progress/heartbeat is treated as a deadlock
const LANE_MAX_TIMEOUT_MS = 120 * 60 * 1000; // 120 minutes max for a whole large campaign (200-500 likes)
const WAITER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes max waiting in the queue (for other posts to finish)

function getBuffParallelVias() {
  const n = parseInt(loadBuffSettings().buffParallelVias, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : 2;
}

/**
 * Limits parallel threads on the same Via and the number of Vias running at once based on actual Proxies.
 * No dedicated Proxy => run 1 thread per Via sequentially so Meta doesn't see multiple sessions at once.
 */
function resolveSafeParallelVias(viaGroups, requestedParallel, sysSettings = {}) {
  const proxyPool = Array.isArray(sysSettings.proxyPool) ? sysSettings.proxyPool : [];
  const hasPerViaProxy = viaGroups.every((g) => Boolean(g.proxyUrl));
  if (proxyPool.length === 0 && !hasPerViaProxy) {
    const capFromSettings = parseInt(sysSettings.buffParallelVias, 10) || 2;
    return Math.min(viaGroups.length, Math.max(1, Math.min(capFromSettings, 2)));
  }
  return Math.min(viaGroups.length, Math.max(1, parseInt(requestedParallel, 10) || 2));
}

function resolveDefaultDelayForMode(speedMode = 'NORMAL') {
  if (speedMode === 'TURBO') return 1200;
  if (speedMode === 'FAST') return 1800;
  if (speedMode === 'SAFE') return 4500;
  if (speedMode === 'SMART') return 2500;
  return 2200; // NORMAL
}

/** Names of parent Vias whose cookie is dead right now (their Pages are excluded from runs) */
async function listDeadViaNames() {
  try {
    const rows = await db.getSocialAccounts();
    const names = new Set();
    for (const r of rows || []) {
      if (r.platform !== 'FACEBOOK_PROFILE') continue;
      if (r.tokenStatus === 'EXPIRED' || r.tokenStatus === 'CHECKPOINT') names.add(r.pageName || r.platformAccountId || 'Via');
    }
    return Array.from(names);
  } catch (_) {
    return [];
  }
}

function getMaxPagesPerPost() {
  const n = parseInt(loadBuffSettings().maxPagesPerPost, 10);
  return Number.isFinite(n) && n > 0 ? n : 150;
}

function pumpBuffLanes() {
  for (let i = 0; i < buffLaneWaiters.length; i++) {
    if (busyBuffLanes.size >= getBuffParallelVias()) return;
    const waiter = buffLaneWaiters[i];
    if (isEmergencyStopped()) {
      buffLaneWaiters.splice(i--, 1);
      if (waiter.waiterTimer) clearTimeout(waiter.waiterTimer);
      waiter.reject(new Error('Emergency stop'));
      continue;
    }
    if (busyBuffLanes.has(waiter.uid)) continue;
    buffLaneWaiters.splice(i--, 1);
    if (waiter.waiterTimer) clearTimeout(waiter.waiterTimer);

    // Allocate a unique, increasing Fencing Token (Monotonic Lease Token)
    const leaseToken = getNextFencingToken();
    const abortController = new AbortController();
    const acquiredAt = Date.now();

    const scheduleInactivityTimer = () => {
      let timerId;
      timerId = setTimeout(() => {
        const active = activeLaneLeases.get(waiter.uid);
        if (active && active.leaseToken === leaseToken && active.leaseTimer === timerId) {
          console.warn(`[LaneLocker] ⚠️ WARNING: Lane "${waiter.uid}" (LeaseToken: ${leaseToken}) idle for over ${LANE_INACTIVITY_TIMEOUT_MS / 1000}s with no progress. Triggering a Safe Abort before reclaiming.`);
          try {
            abortController.abort(new Error(`Lane inactivity timeout expired (${LANE_INACTIVITY_TIMEOUT_MS / 1000}s)`));
          } catch (_) {}
          activeLaneLeases.delete(waiter.uid);
          busyBuffLanes.delete(waiter.uid);
          pumpBuffLanes();
        }
      }, LANE_INACTIVITY_TIMEOUT_MS);
      return timerId;
    };

    let leaseTimer = scheduleInactivityTimer();

    const touchHeartbeat = () => {
      const active = activeLaneLeases.get(waiter.uid);
      if (active && active.leaseToken === leaseToken && !abortController.signal.aborted) {
        if (Date.now() - acquiredAt < LANE_MAX_TIMEOUT_MS) {
          clearTimeout(active.leaseTimer);
          active.leaseTimer = scheduleInactivityTimer();
          active.lastHeartbeat = Date.now();
        }
      }
    };

    activeLaneLeases.set(waiter.uid, {
      leaseToken,
      abortController,
      leaseTimer,
      acquiredAt,
      touchHeartbeat,
    });
    busyBuffLanes.add(waiter.uid);

    waiter.resolve({
      leaseToken,
      abortController,
      signal: abortController.signal,
      touch: touchHeartbeat,
      heartbeat: touchHeartbeat,
      isStale: () => {
        const cur = activeLaneLeases.get(waiter.uid);
        return !cur || cur.leaseToken !== leaseToken || abortController.signal.aborted;
      },
    });
  }
}

async function withBuffLane(uid, fn) {
  const key = uid || 'unknown';
  const leaseContext = await new Promise((resolve, reject) => {
    let waiterObj;
    const waiterTimer = setTimeout(() => {
      const idx = buffLaneWaiters.indexOf(waiterObj);
      if (idx !== -1) {
        buffLaneWaiters.splice(idx, 1);
        reject(new Error(`The queue for Via resource [${key}] timed out (${WAITER_TIMEOUT_MS / 1000}s). Skipping automatically to prevent congestion.`));
      }
    }, WAITER_TIMEOUT_MS);

    waiterObj = { uid: key, resolve, reject, waiterTimer };
    buffLaneWaiters.push(waiterObj);
    pumpBuffLanes();
  });

  const { leaseToken } = leaseContext;

  try {
    return await fn(leaseContext);
  } finally {
    const active = activeLaneLeases.get(key);
    // ONLY release the lock if this task's Fencing Token matches the Token that owns the lane
    if (active && active.leaseToken === leaseToken) {
      clearTimeout(active.leaseTimer);
      activeLaneLeases.delete(key);
      busyBuffLanes.delete(key);
      pumpBuffLanes();
    } else {
      console.warn(`[LaneLocker] 🛡️ Fencing Guard: not releasing lane [${key}] because LeaseToken ${leaseToken} was revoked/expired.`);
    }
  }
}

async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

const deadBuffVias = new Map();
const DEAD_VIA_TTL_MS = 60 * 60 * 1000;
const DEAD_VIA_ERR_RE = /hết hạn|checkpoint|đăng nhập|xác minh|expired|log ?in|verif/i;

// When a run reports a cookie error: re-verify with a real login session; if it really is expired/checkpointed
// write the status to MySQL (so the UI shows a warning) and send Telegram. Avoids false alarms from transient errors.
async function confirmAndRecordDeadVia(via) {
  try {
    const status = await fbBuffTool.validateViaSession(via.cookieString, { proxyUrl: via.proxyUrl, timeoutMs: 18000 });
    if (status.isLive || (status.status !== 'EXPIRED' && status.status !== 'CHECKPOINT')) return;
    await db.updateTokenStatus(via.id, status.status).catch(() => {});
    notifyViaDead(
      { uid: via.uid, viaName: via.viaName, proxyUrl: via.proxyUrl, tokenStatus: status.status },
      status.status === 'CHECKPOINT' ? 'Facebook requires verification (checkpoint)' : 'Cookie expired or logged out'
    ).catch(() => {});
  } catch (e) {
    console.warn(`[ViaHealth] ⚠️ Could not verify Via ${via.viaName}: ${e.message}`);
  }
}

/** After a Via page-fetch error: verify the real Cookie (at most once per hour per Via) and warn if it is dead */
function verifyViaAfterRunError(via) {
  if (!via?.uid || typeof via.id !== 'number' || !via.cookieString || isBuffViaDead(via.uid)) return;
  deadBuffVias.set(via.uid, Date.now() + DEAD_VIA_TTL_MS); // used as a "just checked" marker
  confirmAndRecordDeadVia(via);
}

function isBuffViaDead(uid) {
  const until = deadBuffVias.get(uid);
  if (!until) return false;
  if (Date.now() > until) {
    deadBuffVias.delete(uid);
    return false;
  }
  return true;
}

async function resolveViaProxy(cookieString, explicitProxy = '') {
  if (explicitProxy) return explicitProxy;
  try {
    const vias = await db.getLiveVias();
    const targetUid = fbBuffTool.getUserIdFromCookie(cookieString);
    if (targetUid) {
      const found = vias.find((v) => v.uid === targetUid);
      if (found && found.proxyUrl) return found.proxyUrl;
    }
  } catch (e) {}
  return '';
}

/** Automatically reconciles and assigns the correct owning Via Cookie to each Fanpage from MySQL Workbench */
async function resolvePagesWithOwningVias(selectedPages = [], fallbackCookie = '') {
  if (!Array.isArray(selectedPages) || selectedPages.length === 0) return [];
  let liveVias = [];
  try {
    liveVias = await db.getLiveVias();
  } catch (_) {}

  const viaByUid = new Map(liveVias.map((v) => [String(v.uid), v]));
  const pageViaMap = new Map();
  try {
    const [rows] = await db.getPool().execute(
      `SELECT page_id, personal_profile_id
       FROM facebook_page_accesses
       WHERE active = 1
       ORDER BY CASE WHEN verification_status = 'VERIFIED' THEN 0 ELSE 1 END, id ASC`
    );
    for (const r of rows) {
      const pid = String(r.page_id);
      const viaUid = String(r.personal_profile_id);
      if (!pageViaMap.has(pid) && viaByUid.has(viaUid)) {
        pageViaMap.set(pid, viaUid);
      }
    }
  } catch (_) {}

  return selectedPages.map((p) => {
    const pid = String(p.id || '');
    let viaCookie = p.viaCookie;
    let viaName = p.viaName;
    let proxyUrl = p.proxyUrl || '';

    if (!viaCookie) {
      const owningUid = pageViaMap.get(pid);
      if (owningUid && viaByUid.has(owningUid)) {
        const matchedVia = viaByUid.get(owningUid);
        viaCookie = matchedVia.cookieString;
        viaName = matchedVia.viaName;
        proxyUrl = matchedVia.proxyUrl || '';
      }
    }

    const resolvedCookie = viaCookie || fallbackCookie;
    if (!viaName && resolvedCookie) {
      const resolvedUid = fbBuffTool.getUserIdFromCookie(resolvedCookie);
      if (resolvedUid && viaByUid.has(resolvedUid)) {
        viaName = viaByUid.get(resolvedUid).viaName;
      }
    }

    return {
      ...p,
      viaCookie: resolvedCookie,
      viaName: viaName || 'Via',
      proxyUrl,
    };
  });
}

/**
 * Automatically finds and tops up valid Fanpages from LIVE Vias in MySQL Workbench
 * Ensures these Pages never engaged with targetUrl, so the KPI is reached without duplicates.
 */
async function getAutoReplenishPages(targetUrl, excludePageIds = new Set(), count = 50) {
  if (count <= 0) return [];
  try {
    const normUrl = normalizeFbPostUrl(targetUrl);
    await resolvePostUrlCanonical(targetUrl).catch(() => normUrl);
    const interactedSet = getPostInteractedPageIds(normUrl);

    const liveVias = await db.getLiveVias();
    if (!liveVias || liveVias.length === 0) return [];

    const viaByUid = new Map(liveVias.map((v) => [String(v.uid), v]));
    const liveUids = Array.from(viaByUid.keys());
    if (liveUids.length === 0) return [];

    const placeholders = liveUids.map(() => '?').join(',');
    const [rows] = await db.getPool().execute(
      `SELECT page_id, page_name, personal_profile_id 
       FROM facebook_page_accesses 
       WHERE active = 1 AND personal_profile_id IN (${placeholders})
       ORDER BY CASE WHEN verification_status = 'VERIFIED' THEN 0 ELSE 1 END, id ASC`,
      liveUids
    );

    const replenishPages = [];
    for (const r of rows) {
      const pid = String(r.page_id);
      if (excludePageIds.has(pid) || interactedSet.has(pid)) continue;
      const owningVia = viaByUid.get(String(r.personal_profile_id));
      if (!owningVia) continue;

      replenishPages.push({
        id: pid,
        name: r.page_name,
        viaCookie: owningVia.cookieString,
        viaName: owningVia.viaName,
        proxyUrl: owningVia.proxyUrl || '',
      });
      excludePageIds.add(pid);
      if (replenishPages.length >= count) break;
    }
    return replenishPages;
  } catch (err) {
    console.warn('[AutoReplenish] ⚠️ Error finding auto top-up pages:', err.message);
    return [];
  }
}

// =============================================================================
// AUTHENTICATION, JWT (RFC 7519 HMAC-SHA256) & ACCESS CONTROL
// =============================================================================
const JWT_SECRET_FILE = path.join(DATA_DIR, '.jwt_secret');

// Passwords are stored as: scrypt$<saltHex>$<hashHex>
const PASSWORD_HASH_PREFIX = 'scrypt$';
const SCRYPT_KEYLEN = 64;
const scryptAsync = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => (err ? reject(err) : resolve(key)))
  );

function isHashedPassword(stored) {
  return typeof stored === 'string' && stored.startsWith(PASSWORD_HASH_PREFIX);
}

function formatPasswordHash(salt, hash) {
  return `${PASSWORD_HASH_PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
}

function hashPasswordSync(plain) {
  const salt = crypto.randomBytes(16);
  return formatPasswordHash(salt, crypto.scryptSync(String(plain), salt, SCRYPT_KEYLEN));
}

async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  return formatPasswordHash(salt, await scryptAsync(String(plain), salt));
}

async function verifyPassword(plain, stored) {
  if (!isHashedPassword(stored)) return false;
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(String(plain), Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Seed default accounts for standalone desktop app & fresh databases
function getSeedUsers() {
  const adminPass = process.env.ADMIN_PASSWORD || 'admin';
  return [
    {
      id: 1,
      username: (process.env.ADMIN_USERNAME || 'admin').trim(),
      password: hashPasswordSync(adminPass),
      email: 'admin@viplike.vn',
      aliases: ['admin@gmail.com'],
      fullName: 'Quản Trị Viên VIPLIKE',
      role: 'ADMIN',
    },
    {
      id: 2,
      username: 'thanhan',
      password: hashPasswordSync('123'),
      email: 'thanhan@viplike.vn',
      fullName: 'Thành An (Nick Mẹ 512 Page)',
      role: 'ADMIN',
    },
    {
      id: 3,
      username: 'huynhthanhphu',
      password: hashPasswordSync('123'),
      email: 'phu@viplike.vn',
      fullName: 'Huỳnh Thạnh Phú',
      role: 'ADMIN',
    },
  ];
}

function loadUsers() {
  let data = store.read('users');
  if (!Array.isArray(data) || data.length === 0) {
    const seeded = getSeedUsers();
    saveUsers(seeded);
    return seeded;
  }

  // Ensure default seed accounts exist if only a partial list is present
  const seedUsers = getSeedUsers();
  let modified = false;
  for (const su of seedUsers) {
    const existing = data.find((u) => String(u.username).toLowerCase() === su.username.toLowerCase());
    if (!existing) {
      data.push(su);
      modified = true;
    }
  }

  // Convert plaintext passwords to scrypt exactly once
  const migrated = [];
  for (const u of data) {
    if (u.password && !isHashedPassword(u.password)) {
      u.password = hashPasswordSync(u.password);
      migrated.push(u.username);
    }
  }
  if (migrated.length > 0 || modified) {
    saveUsers(data);
    if (migrated.length > 0) {
      console.log(`[Auth] 🔐 Hashed passwords (scrypt) for accounts: ${migrated.join(', ')}`);
    }
  }
  return data;
}

function saveUsers(users) {
  store.write('users', users);
  try {
    db.syncUsersToDb(users).catch(() => {});
  } catch (_) {}
}

function publicUser(user) {
  const { password, ...rest } = user;
  return rest;
}

// JWT_SECRET: prefer env, otherwise generate a random one and save it to data/.jwt_secret (reused on restart)
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    if (fs.existsSync(JWT_SECRET_FILE)) {
      const saved = fs.readFileSync(JWT_SECRET_FILE, 'utf-8').trim();
      if (saved.length >= 32) return saved;
    }
  } catch (e) {}
  const secret = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(JWT_SECRET_FILE, secret, { encoding: 'utf-8', mode: 0o600 });
    console.log('[Auth] 🔑 Generated a random JWT_SECRET and saved it to data/.jwt_secret');
  } catch (e) {
    console.warn('[Auth] ⚠️ Could not save data/.jwt_secret, login sessions will be lost on restart:', e.message);
  }
  return secret;
}

const JWT_SECRET = loadJwtSecret();

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function generateJwtToken(user, expiresInSeconds = 86400 * 10) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSeconds;
  const payload = {
    sub: user.username,
    id: user.id,
    email: user.email,
    fullName: user.fullName || user.username,
    role: user.role || 'USER',
    iat: now,
    exp,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwtToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Token expired
    }
    return payload;
  } catch {
    return null;
  }
}

// Failed-login limit within 60 seconds → 429:
//  - more than 5 attempts per IP + username
//  - more than 20 attempts per IP alone (blocks probing many usernames from one machine)
const LOGIN_MAX_FAILURES = 5;
const LOGIN_IP_MAX_FAILURES = 20;
const LOGIN_WINDOW_MS = 60 * 1000;
const loginFailures = new Map(); // key -> { count, firstAt }

function getLoginRateKey(req, username) {
  return `${req.ip}|${String(username).trim().toLowerCase()}`;
}

function getLoginIpRateKey(req) {
  return `ip:${req.ip}`;
}

function getLoginRetryAfterSec(key, max = LOGIN_MAX_FAILURES) {
  const entry = loginFailures.get(key);
  if (!entry) return 0;
  const elapsed = Date.now() - entry.firstAt;
  if (elapsed >= LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return 0;
  }
  return entry.count >= max ? Math.ceil((LOGIN_WINDOW_MS - elapsed) / 1000) : 0;
}

// Find the user in priority order: username → email → alias (avoids false matches on overlapping strings)
function findUserByLogin(users, value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  return (
    users.find((x) => String(x.username || '').toLowerCase() === v) ||
    users.find((x) => String(x.email || '').toLowerCase() === v) ||
    users.find((x) => Array.isArray(x.aliases) && x.aliases.some((a) => String(a).toLowerCase() === v)) ||
    null
  );
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.firstAt >= LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
  if (loginFailures.size > 5000) {
    for (const [k, v] of loginFailures) {
      if (now - v.firstAt >= LOGIN_WINDOW_MS) loginFailures.delete(k);
    }
  }
}

const authHandler = {
  login: async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Please enter both username and password!' });
      }

      const rateKey = getLoginRateKey(req, username);
      const ipRateKey = getLoginIpRateKey(req);
      const retryAfterSec = Math.max(
        getLoginRetryAfterSec(rateKey),
        getLoginRetryAfterSec(ipRateKey, LOGIN_IP_MAX_FAILURES)
      );
      if (retryAfterSec > 0) {
        res.set('Retry-After', String(retryAfterSec));
        return res.status(429).json({
          success: false,
          error: `Too many failed login attempts. Please try again in ${retryAfterSec} seconds!`,
        });
      }

      const users = loadUsers();
      const user = findUserByLogin(users, username);

      // Compare the password against the scrypt hash (timing-safe)
      let isMatch = user ? await verifyPassword(password.trim(), user.password) : false;

      // Fallback for default seed accounts (only before the user has customized their password)
      if (!isMatch && user && !user.passwordChangedAt) {
        const uLower = String(user.username || '').toLowerCase();
        const expectedAdminPass = process.env.ADMIN_PASSWORD || 'admin';
        if (
          (uLower === 'admin' && password.trim() === expectedAdminPass) ||
          ((uLower === 'thanhan' || uLower === 'huynhthanhphu') && password.trim() === '123')
        ) {
          user.password = hashPasswordSync(password.trim());
          saveUsers(users);
          isMatch = true;
        }
      }

      // Same message for "no such account" and "wrong password" so existing usernames aren't revealed
      if (!user || !isMatch) {
        recordLoginFailure(rateKey);
        recordLoginFailure(ipRateKey);
        return res.status(401).json({
          success: false,
          error: 'Incorrect username or password. Please check and try again!',
        });
      }

      loginFailures.delete(rateKey);

      // Check if the user logged in with a default initial password
      const uLower = String(user.username || '').toLowerCase();
      const expectedAdminPass = process.env.ADMIN_PASSWORD || 'admin';
      const isDefault =
        (uLower === 'admin' && password.trim() === expectedAdminPass) ||
        ((uLower === 'thanhan' || uLower === 'huynhthanhphu') && password.trim() === '123');

      // Generate a standard RFC 7519 HMAC-SHA256 JWT (valid for 10 days)
      const token = generateJwtToken(user, 86400 * 10);
      return res.json({
        success: true,
        token,
        tokenType: 'Bearer',
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName || user.username,
          role: user.role || 'USER',
          isDefaultPassword: isDefault,
        },
        data: {
          token,
          tokenType: 'Bearer',
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName || user.username,
          role: user.role || 'USER',
          isDefaultPassword: isDefault,
        },
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
  register: async (req, res) => {
    try {
      const { username, password, email, fullName } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Please enter both username and password!' });
      }
      const users = loadUsers();
      // A new username/email must not match any user's username, email or alias
      if (findUserByLogin(users, username)) {
        return res.status(400).json({ success: false, error: 'Username already exists!' });
      }
      if (email && findUserByLogin(users, email)) {
        return res.status(400).json({ success: false, error: 'Email is already in use!' });
      }
      const newUser = {
        id: Date.now(),
        username: username.trim(),
        password: await hashPassword(password.trim()),
        email: email || `${username.trim()}@viplike.vn`,
        fullName: fullName || username.trim(),
        role: 'USER',
      };
      users.push(newUser);
      saveUsers(users);
      const token = generateJwtToken(newUser, 86400 * 10);
      const safeUser = publicUser(newUser);
      return res.json({
        success: true,
        token,
        tokenType: 'Bearer',
        user: safeUser,
        data: { token, tokenType: 'Bearer', ...safeUser },
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
  me: async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
    if (!token) {
      return res.status(401).json({ success: false, authenticated: false, error: 'Login required. No JWT token provided.' });
    }
    const decoded = verifyJwtToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, authenticated: false, error: 'The login session (JWT) is invalid or expired.' });
    }
    let isDefault = false;
    try {
      const users = loadUsers();
      const currentUsername = decoded.sub || decoded.username;
      const user = users.find((u) => u.id === decoded.id || String(u.username).toLowerCase() === String(currentUsername).toLowerCase());
      if (user) {
        const uLower = String(user.username || '').toLowerCase();
        if (uLower === 'admin') {
          isDefault = await verifyPassword(process.env.ADMIN_PASSWORD || 'admin', user.password);
        } else if (uLower === 'thanhan' || uLower === 'huynhthanhphu') {
          isDefault = await verifyPassword('123', user.password);
        }
      }
    } catch (_) {}

    return res.json({
      success: true,
      authenticated: true,
      user: {
        id: decoded.id,
        username: decoded.sub || decoded.username,
        email: decoded.email,
        fullName: decoded.fullName,
        role: decoded.role,
        isDefaultPassword: isDefault,
      },
    });
  },
  changePassword: async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 4) {
        return res.status(400).json({
          success: false,
          error: 'Mật khẩu mới phải có ít nhất 4 ký tự!',
        });
      }

      const users = loadUsers();
      const currentUsername = req.user?.username || req.user?.sub;
      const user = users.find(
        (u) =>
          u.id === req.user?.id ||
          String(u.username).toLowerCase() === String(currentUsername).toLowerCase()
      );

      if (!user) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản!' });
      }

      if (currentPassword) {
        const isMatch = await verifyPassword(currentPassword.trim(), user.password);
        const uLower = String(user.username || '').toLowerCase();
        const expectedAdminPass = process.env.ADMIN_PASSWORD || 'admin';
        const isDefaultMatch =
          (uLower === 'admin' && currentPassword.trim() === expectedAdminPass) ||
          ((uLower === 'thanhan' || uLower === 'huynhthanhphu') && currentPassword.trim() === '123');

        if (!isMatch && !isDefaultMatch) {
          return res.status(400).json({ success: false, error: 'Mật khẩu hiện tại không chính xác!' });
        }
      }

      user.password = await hashPassword(newPassword.trim());
      user.passwordChangedAt = new Date().toISOString();
      saveUsers(users);

      return res.json({
        success: true,
        message: 'Đổi mật khẩu thành công! Hãy ghi nhớ mật khẩu mới của bạn.',
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  },
};

// Authentication routes (public) — register requires ADMIN and is registered after the JWT middleware below
app.post('/api/auth/login', authHandler.login);
app.post('/auth/login', authHandler.login);
app.get('/api/auth/me', authHandler.me);
app.get('/auth/me', authHandler.me);

// Mandatory JWT authentication middleware for every system API
function authenticateJwt(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  const publicPaths = [
    '/api/auth/login',
    '/auth/login',
    '/api/auth/me',
    '/auth/me',
    '/api/db/test',
    '/db/test',
    '/api/health',
    '/health',
    '/api/readiness',
    '/readiness',
    '/api/system/observability',
    '/api/license/activate',
    '/api/license/status',
    '/api/buff-cached-pages',
    '/api/buff-live/clear',
    '/api/buff-live/status',
    '/api/buff-live/active',
    '/api/buff-live/stop',
  ];

  const currentPath = req.path.toLowerCase();
  const isPublic = publicPaths.some(
    (p) => currentPath === p.toLowerCase() || currentPath === p.toLowerCase() + '/'
  );

  if (isPublic) return next();

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Login required. No JWT token (Bearer token) found.',
    });
  }

  const decoded = verifyJwtToken(token);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'The login session (JWT) is invalid or expired. Please log in again.',
    });
  }

  req.user = decoded;
  next();
}

// Only allow ADMIN accounts (use after authenticateJwt)
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'You do not have permission to do this. Only ADMIN accounts are allowed!',
    });
  }
  next();
}

app.use(authenticateJwt);

// Create a new account: ADMIN only
app.post('/api/auth/register', requireAdmin, authHandler.register);
app.post('/auth/register', requireAdmin, authHandler.register);

// Change password for the currently logged in account
app.post('/api/auth/change-password', authHandler.changePassword);
app.post('/auth/change-password', authHandler.changePassword);

// Real-time Proxy health and speed check
app.post('/api/proxy/test', async (req, res) => {
  const { proxyUrl } = req.body;
  if (!proxyUrl || typeof proxyUrl !== 'string' || !proxyUrl.trim()) {
    return res.status(400).json({ success: false, error: 'Please provide the Proxy string to check' });
  }

  try {
    const result = await fbBuffTool.testProxy(proxyUrl.trim(), 8000);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Get the Proxy Pool from system settings
app.get('/api/proxy-pool', (req, res) => {
  try {
    const settings = loadBuffSettings();
    return res.json({ success: true, proxyPool: settings.proxyPool || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Update the Proxy Pool
app.post('/api/proxy-pool', (req, res) => {
  try {
    const { proxyPool } = req.body;
    if (!Array.isArray(proxyPool)) {
      return res.status(400).json({ success: false, error: 'proxyPool must be an array of proxy strings' });
    }
    const cleanPool = proxyPool
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => Boolean(p));

    const updated = saveBuffSettings({ proxyPool: cleanPool });
    return res.json({ success: true, proxyPool: updated?.proxyPool || cleanPool });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Check the health of every Proxy in the Pool in parallel
app.post('/api/proxy-pool/test', async (req, res) => {
  try {
    const { proxies } = req.body;
    const pool = Array.isArray(proxies) ? proxies : (loadBuffSettings().proxyPool || []);
    if (!pool.length) {
      return res.json({ success: true, results: [] });
    }

    const results = await Promise.all(
      pool.map(async (proxyStr) => {
        const health = await fbBuffTool.testProxyHealth(proxyStr, 6000);
        return {
          proxy: proxyStr,
          ...health,
        };
      })
    );
    return res.json({ success: true, results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// 3. API ROUTES - MYSQL WORKBENCH DATABASE
// =============================================================================

// Check the connection to MySQL Workbench
app.get('/api/db/test', async (req, res) => {
  const result = await db.testConnection();
  return res.json(result);
});

// -----------------------------------------------------------------------------
// VIA ACCOUNTS: normalize Cookies, mask sensitive data, block duplicates
// -----------------------------------------------------------------------------
const MYSQL_SAVE_WARNING =
  'Could not save to MySQL; the new data is only stored temporarily on this machine. Check the MySQL connection and try again.';

/**
 * Accepts Cookies as a plain string ("c_user=...; xs=..."), JSON (Cookie-Editor / J2Team), or "UID|PASS|2FA|COOKIE".
 * Returns the cleaned cookie, the UID, and valid=true when both c_user + xs are present.
 */
function normalizeFbCookie(input) {
  let cookie = String(input || '').trim();
  cookie = cookie.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. Parse JSON formats (Cookie-Editor, J2Team, DevTools export...)
  if ((cookie.startsWith('{') && cookie.endsWith('}')) || (cookie.startsWith('[') && cookie.endsWith(']'))) {
    try {
      const parsedJson = JSON.parse(cookie);
      let list = [];
      if (Array.isArray(parsedJson)) list = parsedJson;
      else if (parsedJson && Array.isArray(parsedJson.cookies)) list = parsedJson.cookies;
      else if (parsedJson && typeof parsedJson === 'object') {
        list = Object.entries(parsedJson).map(([name, value]) => ({ name, value: String(value) }));
      }
      if (list.length > 0) {
        let cUser = '';
        let xs = '';
        const pairs = [];
        for (const item of list) {
          if (!item || !item.name) continue;
          const name = String(item.name).trim();
          const val = item.value != null ? String(item.value).trim() : '';
          const lowerName = name.toLowerCase();
          if (lowerName === 'c_user') cUser = val;
          if (lowerName === 'xs') xs = val;
          pairs.push(`${name}=${val}`);
        }
        if (!cUser) {
          const pasItem = list.find((it) => it.name && it.name.toLowerCase() === 'pas');
          if (pasItem && pasItem.value) {
            const m = String(pasItem.value).match(/([0-9]{6,})/);
            if (m) cUser = m[1];
          }
        }
        const fullCookieStr = pairs.join('; ') + ';';
        return {
          cookie: fullCookieStr,
          uid: cUser,
          valid: Boolean(cUser && xs),
          isJson: true,
          cookieList: list,
        };
      }
    } catch (_) {}
  }

  // 2. Parse the pipe | format (UID|PASS|2FA|COOKIE)
  if (cookie.includes('|')) {
    const parts = cookie.split('|').map((p) => p.trim());
    const cookiePart =
      parts.find((p) => p.startsWith('{') || p.startsWith('[') || /c_user=/.test(p) || /(?:^|;\s*)xs=/.test(p)) || '';
    const uidPart = /^[0-9]{6,}$/.test(parts[0]) ? parts[0] : '';
    if (cookiePart) {
      const parsedPart = normalizeFbCookie(cookiePart);
      if (parsedPart.valid) {
        if (!parsedPart.uid && uidPart) {
          parsedPart.uid = uidPart;
          parsedPart.cookie = `c_user=${uidPart}; ${parsedPart.cookie}`;
        }
        return parsedPart;
      }
    }
  }

  const uid = cookie.match(/(?:^|;\s*)c_user=([^;\s]+)/)?.[1] || '';
  const hasXs = /(?:^|;\s*)xs=[^;\s]+/.test(cookie);
  return { cookie, uid, valid: Boolean(uid && hasXs) };
}

function maskProxyUrl(proxy) {
  const v = String(proxy || '');
  if (!v) return '';
  if (v.includes('@')) return v.replace(/\/\/[^@]*@/, '//***@').replace(/^[^/@]*:[^/@]*@/, '***@');
  const parts = v.split(':');
  return parts.length > 2 ? `${parts[0]}:${parts[1]}:***` : v;
}

/** Non-ADMIN accounts only see the UID, not the Cookie or proxy password */
function redactAccountForNonAdmin(acc) {
  const uid =
    (acc.cookieString || acc.accessToken || '').match(/(?:^|;\s*)c_user=([^;\s]+)/)?.[1] || acc.platformAccountId || '';
  const safeCookie = uid && /^[0-9]+$/.test(uid) ? `c_user=${uid}` : '';
  return { ...acc, cookieString: safeCookie, accessToken: safeCookie, proxyUrl: maskProxyUrl(acc.proxyUrl) };
}

function findViaByUid(rows, uid) {
  return rows.find((r) => {
    if (r.platform === 'FACEBOOK_GROUP') return false;
    const own = (r.cookieString || r.accessToken || '').match(/(?:^|;\s*)c_user=([^;\s]+)/)?.[1];
    return own === uid;
  });
}

// Get every Via & Fanpage account from MySQL Workbench
app.get('/api/connections', async (req, res) => {
  try {
    const accounts = await db.getSocialAccounts();
    const isAdmin = req.user?.role === 'ADMIN';
    return res.json(isAdmin ? accounts : accounts.map(redactAccountForNonAdmin));
  } catch (err) {
    console.error('[API /connections] ❌ Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Add a new Via account to MySQL Workbench (ADMIN only)
app.post('/api/connections', requireAdmin, async (req, res) => {
  try {
    const {
      pageName = '',
      cookieString = '',
      proxyUrl = '',
      platform = 'FACEBOOK_PROFILE',
      accountType = 'PERSONAL_PROFILE_COOKIE',
    } = req.body;

    if (!String(cookieString).trim()) {
      return res.status(400).json({ success: false, error: 'Missing the Facebook Cookie (cookieString)' });
    }

    let finalCookie = String(cookieString).trim();
    if (accountType === 'PERSONAL_PROFILE_COOKIE') {
      const norm = normalizeFbCookie(cookieString);
      if (!norm.valid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Cookie: both c_user and xs are required (or a UID|PASS|2FA|COOKIE string containing them).',
        });
      }
      finalCookie = norm.cookie;

      const existing = findViaByUid(await db.getSocialAccounts(), norm.uid);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: `This Via already exists in the system (${existing.pageName || norm.uid}). Use "Change Cookie" to update it.`,
          existingId: existing.id,
        });
      }
    }

    const created = await db.addSocialAccount({
      pageName,
      cookieString: finalCookie,
      proxyUrl,
      platform,
      accountType,
    });

    const { dbSaved, ...account } = created;
    return res.json({ success: true, account, ...(dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Update an account in MySQL Workbench (ADMIN only)
app.put('/api/connections/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { pageName, proxyUrl, tokenStatus } = req.body;
    let { cookieString } = req.body;
    if (cookieString !== undefined) {
      const norm = normalizeFbCookie(cookieString);
      if (!norm.valid) {
        return res.status(400).json({ success: false, error: 'Invalid Cookie: both c_user and xs are required.' });
      }
      cookieString = norm.cookie;
    }
    const result = await db.updateSocialAccount(id, { pageName, cookieString, proxyUrl, tokenStatus });
    return res.json({ success: true, ...(result.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Update a Via's Cookie (by UID) — ADMIN only
app.post('/api/vias/update-cookie', requireAdmin, async (req, res) => {
  try {
    const { uid, cookieString, proxyUrl, force = false } = req.body;
    if (!cookieString || !String(cookieString).trim()) {
      return res.status(400).json({ success: false, error: 'Please provide the new Facebook Cookie string!' });
    }

    const norm = normalizeFbCookie(cookieString);
    if (!norm.valid) {
      return res.status(400).json({ success: false, error: 'Invalid Cookie: both c_user and xs are required.' });
    }
    const targetUid = uid || norm.uid;
    if (uid && /^[0-9]+$/.test(String(uid)) && norm.uid && String(uid) !== norm.uid && !force) {
      return res.status(400).json({
        success: false,
        error: `This Cookie belongs to account ${norm.uid}, which doesn't match Via ${uid}. Please check.`,
        uidMismatch: true,
        cookieUid: norm.uid,
      });
    }

    // 1. Update the DB & Cache for this UID
    const result = await db.updateViaCookieByUid(targetUid, norm.cookie, proxyUrl);

    // 2. Remove it from the deadBuffVias blacklist so the queue uses it again automatically
    deadBuffVias.delete(targetUid);
    if (norm.uid) deadBuffVias.delete(norm.uid);

    console.log(`[ViaManager] 🔄 Saved the new Cookie for Via UID: ${targetUid}`);
    return res.json({
      success: true,
      message: `Saved the new Cookie for Via UID ${targetUid}`,
      detectedUid: norm.uid,
      cookieString: norm.cookie,
      ...(result?.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Delete an account from MySQL Workbench
app.delete('/api/connections/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.deleteSocialAccount(id);
    return res.json({ success: true, ...(result.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Engagement history (one record per run) stored in MySQL Workbench
app.get('/api/buff-logs', async (req, res) => {
  try {
    await syncCompletedQueueTasksToBuffLogs(true).catch(() => {});
    const summaryOnly = req.query.summary === 'true' || req.query.summary === '1';
    const limit = parseInt(req.query.limit, 10) || 50;
    const cursorCreatedAt = req.query.cursorCreatedAt || null;
    const cursorId = req.query.cursorId || null;
    const result = await db.getBuffLogs({ limit, summaryOnly, cursorCreatedAt, cursorId });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Full details of a run (including the Fanpage details array)
app.get('/api/buff-logs/:id', async (req, res) => {
  try {
    const result = await db.getBuffLogById(req.params.id);
    if (!result) return res.status(404).json({ success: false, error: 'Engagement log not found' });
    return res.json({ success: true, log: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Body: { log } for 1 run, or { logs: [...] } when migrating old data
app.post('/api/buff-logs', async (req, res) => {
  try {
    const { log, logs } = req.body || {};
    const input = Array.isArray(logs) ? logs.slice(0, 2000) : log;
    if (!input) {
      return res.status(400).json({ success: false, error: 'Missing log data' });
    }
    const result = await db.saveBuffLogs(input);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/buff-logs', async (req, res) => {
  try {
    await db.clearBuffLogs();
    return res.json({ success: true });
  } catch (err) {
    return res.status(503).json({
      success: false,
      error: `Could not delete history because MySQL is not connected: ${err.message}`,
    });
  }
});

// =============================================================================
// 4. API ROUTES - FANPAGE & BUFF INTERACTION
// =============================================================================

// Scan the Fanpage list from the parent account Cookie (Profile Pages / New Page Experience)
app.post('/api/buff-get-pages', async (req, res) => {
  const { cookieString, forceRefresh = false, viaName = '', proxyUrl: explicitProxy = '' } = req.body;
  if (!cookieString) {
    return res.status(400).json({ success: false, error: 'Missing cookieString' });
  }
  try {
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const pages = await fbBuffTool.getManagedPages(cookieString, {
      forceRefresh: Boolean(forceRefresh),
      viaName,
      proxyUrl,
    });
    return res.json({ success: true, count: pages.length, pages });
  } catch (err) {
    console.error('[Buff API] ❌ Page scan error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Get the Fanpage list from MySQL Workbench facebook_page_accesses (with standard Avatar status)
app.get('/api/buff-cached-pages', async (req, res) => {
  try {
    const { uid } = req.query;
    const avatarCache = avatarTool.loadAvatarCache() || {};
    let pages = [];

    if (uid) {
      pages = fbBuffTool.getCachedPages(String(uid)) || [];
      if (!pages || pages.length === 0) {
        // Load directly from the facebook_page_accesses table in MySQL Workbench
        try {
          pages = await db.getFacebookPageAccesses(1, String(uid));
        } catch (e) {}
      }
      if (!pages || pages.length === 0) {
        // Fallback: look in accounts_cache
        try {
          const cachedAccounts = db.loadAccountsCache() || [];
          const matched = cachedAccounts.filter(
            (a) =>
              a.platform === 'FACEBOOK_PAGE' &&
              ((a.cookieString && a.cookieString.includes(`c_user=${uid}`)) || (a.accessToken && a.accessToken.includes(`c_user=${uid}`)))
          );
          if (matched.length > 0) {
            pages = matched.map((m) => ({
              id: m.platformAccountId || m.pageId || String(m.id),
              name: m.pageName || `Fanpage ${m.id}`,
              url: `https://www.facebook.com/${m.platformAccountId || m.pageId || m.id}`,
            }));
          }
        } catch (e) {}
      }

      // Attach the detailed Avatar status to each Page
      const enrichedPages = pages.map((p) => {
        const id = String(p.id || p.pageId || p.platformAccountId);
        const av = avatarCache[id];
        const hasAvatar = Boolean(av && av.hasAvatar && !av.isSilhouette);
        return {
          id,
          name: p.name || p.pageName || `Fanpage ${id.slice(-4)}`,
          url: p.url || `https://www.facebook.com/${id}`,
          hasAvatar,
          isSilhouette: Boolean(!av || av.isSilhouette || !av.hasAvatar),
          avatarUrl: av?.avatarUrl || '',
        };
      });

      return res.json({ success: true, uid, count: enrichedPages.length, pages: enrichedPages });
    }

    // If no UID is passed, prefer loading everything from the facebook_page_accesses table in MySQL
    try {
      const dbPages = await db.getFacebookPageAccesses(1, null);
      if (dbPages.length > 0) {
        const enrichedList = dbPages.map((p) => {
          const id = String(p.id);
          const av = avatarCache[id];
          return {
            id,
            name: p.name,
            url: p.url,
            personalProfileId: p.personalProfileId || null,
            profileName: p.profileName || '',
            hasAvatar: Boolean(av && av.hasAvatar && !av.isSilhouette),
            isSilhouette: Boolean(!av || av.isSilhouette || !av.hasAvatar),
            avatarUrl: av?.avatarUrl || '',
          };
        });

        const cacheGrouped = {};
        for (const p of enrichedList) {
          const vUid = p.personalProfileId || 'default';
          if (!cacheGrouped[vUid]) {
            cacheGrouped[vUid] = {
              uid: vUid,
              viaName: p.profileName || `Via_${vUid}`,
              count: 0,
              pages: [],
            };
          }
          cacheGrouped[vUid].pages.push(p);
          cacheGrouped[vUid].count++;
        }

        return res.json({ success: true, count: enrichedList.length, cache: cacheGrouped, pages: enrichedList });
      }
    } catch (e) {}

    const allCache = fbBuffTool.loadPagesCache();
    return res.json({ success: true, cache: allCache });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Manually save / update the Page list in MySQL facebook_page_accesses and the cache
app.post('/api/buff-cache-pages', async (req, res) => {
  try {
    const { uid, pages, viaName = '' } = req.body;
    if (!uid || !Array.isArray(pages)) {
      return res.status(400).json({ success: false, error: 'Missing uid or pages' });
    }
    fbBuffTool.setCachedPages(String(uid), pages, viaName);
    await db.saveFacebookPageAccesses(pages, uid, viaName);
    return res.json({ success: true, message: `Saved ${pages.length} Pages for UID ${uid} to MySQL Workbench and the cache` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Generate natural comments from the post context with Gemini AI
app.post('/api/buff-ai-generate-comments', async (req, res) => {
  try {
    const { topic = 'GENERAL', postContent = '', postUrl = '', count = 8, tone = 'natural' } = req.body;
    const comments = await generateSeedingComments({ topic, postContent, postUrl, count, tone });
    return res.json({ success: true, count: comments.length, comments });
  } catch (err) {
    console.error('[AI Seeding API] ❌ AI comment generation error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Software license (License Key) check helper for the main engagement features (DISABLED)
async function checkLicenseOrReject(req, res) {
  // License check disabled: always allow all operations to proceed without restrictions
  return true;
}

// Buff Like & Comment (synchronous)
app.post('/api/buff-like', async (req, res) => {
  if (!(await checkLicenseOrReject(req, res))) return;

  const {
    cookieString,
    targetUrl,
    reactionType = 'LIKE',
    selectedPages = [],
    delayMs = 2500,
    speedMode = 'NORMAL',
    enableLike = true,
    enableComment = false,
    enableShare = false,
    enableHumanBehavior = true,
    fastSwitch = true,
    cooldownEvery = 25,
    cooldownDurationMs = 20000,
    comments = [],
    proxyUrl: explicitProxy = '',
    concurrency = 1,
    dripFeedMode = false,
    dripDurationMinutes = 30,
  } = req.body;

  if (!cookieString || !targetUrl) {
    return res.status(400).json({ success: false, error: 'Missing cookieString or targetUrl' });
  }

  if (isEmergencyStopped()) {
    const sysSettings = loadBuffSettings();
    const reason = sysSettings.emergencyReason || 'An administrator triggered EMERGENCY STOP';
    return res.status(403).json({
      success: false,
      isEmergencyStopped: true,
      error: `The system is in EMERGENCY STOP: "${reason}". Click "Resume operations" (Resume) in the toolbar to continue.`,
    });
  }

  try {
    const sysSettings = loadBuffSettings();
    const proxyPool = Array.isArray(sysSettings.proxyPool) ? sysSettings.proxyPool : [];
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const laneUid = fbBuffTool.getUserIdFromCookie(cookieString);
    const startMs = Date.now();

    notifyBuffStarted({
      targetUrl,
      total: selectedPages?.length || 0,
      reactionType,
      speedMode,
      concurrency: Math.max(1, Math.min(5, parseInt(concurrency, 10) || 1)),
      accountName: 'Via ' + (laneUid || 'FB'),
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Error sending the buff-start notification:', err.message));

    const resolvedPages = await resolvePagesWithOwningVias(selectedPages, cookieString);
    const viaGroupsMap = new Map();
    for (const p of resolvedPages) {
      const vKey = (p.viaCookie || cookieString).trim();
      if (!viaGroupsMap.has(vKey)) {
        const laneId = fbBuffTool.getUserIdFromCookie(vKey) || 'default';
        viaGroupsMap.set(vKey, {
          cookieString: vKey,
          laneUid: laneId,
          viaName: p.viaName || ('Via ' + laneId),
          proxyUrl: p.proxyUrl || proxyUrl,
          pages: [],
        });
      }
      viaGroupsMap.get(vKey).pages.push(p);
    }

    const allDetails = [];
    const viaGroups = Array.from(viaGroupsMap.values());
    const parallelVias = resolveSafeParallelVias(viaGroups, concurrency, sysSettings);
    const hasProxyPool = proxyPool.length >= 2;

    await runWithConcurrency(viaGroups, parallelVias, async (group) => {
      const grpProxy = await resolveViaProxy(group.cookieString, group.proxyUrl || explicitProxy);
      const subResult = await withBuffLane(group.laneUid, (fence) =>
        fbBuffTool.buffLikesWithPages(group.cookieString, targetUrl, {
          reactionType,
          selectedPages: group.pages,
          delayMs,
          speedMode,
          enableLike,
          enableComment,
          enableShare,
          enableHumanBehavior,
          fastSwitch,
          cooldownEvery,
          cooldownDurationMs,
          comments,
          proxyUrl: grpProxy,
          proxyPool,
          concurrency: hasProxyPool && !enableComment && !dripFeedMode && group.pages.length >= 15
            ? Math.max(1, Math.min(3, parseInt(concurrency, 10) || 1))
            : 1,
          dripFeedMode: Boolean(dripFeedMode),
          dripDurationMinutes: parseInt(dripDurationMinutes, 10) || 30,
          fence,
          touch: fence?.touch,
          shouldStop: () => fence?.isStale() || isEmergencyStopped(),
        })
      );
      if (subResult?.details) {
        allDetails.push(
          ...subResult.details.map((d) => ({
            ...d,
            viaName: d.viaName || group.viaName,
            viaUid: d.viaUid || group.laneUid,
          }))
        );
      }
    });
    const result = { details: allDetails, total: selectedPages.length };

    const durationSec = Math.max(1, Math.round((Date.now() - startMs) / 1000));
    const totalCount = selectedPages?.length || result?.total || 0;
    const successCount = result?.successCount ?? (result?.details ? result.details.filter((d) => d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED').length : 0);
    const failedCount = result?.failedCount ?? (result?.details ? result.details.filter((d) => d.status === 'ERROR' || d.status === 'FAILED' || d.status === 'NO_BUTTON').length : 0);

    let screenshotPath = null;
    try {
      const shot = await fbBuffTool.capturePostScreenshot(targetUrl, {
        cookieStr: cookieString,
        proxyUrl,
        timeoutMs: 25000,
      });
      if (shot && shot.success && shot.filePath) {
        screenshotPath = shot.filePath;
      }
    } catch (e) {
      console.warn('[ScreenshotProof] ⚠️ Ignoring post screenshot error:', e.message);
    }

    notifyBuffCompleted({
      targetUrl,
      success: successCount,
      total: totalCount,
      failed: failedCount,
      durationSec,
      reactionType,
      screenshotPath,
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Error sending the buff-complete notification:', err.message));

    // Automatically save the buff history to MySQL right on the Server
    if (result && Array.isArray(result.details) && result.details.length > 0) {
      db.saveBuffLogs({
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        type: 'SINGLE',
        targetUrl,
        reactionType,
        totalPages: totalCount,
        targetLikes: (kpiTarget && kpiTarget > 0) ? kpiTarget : totalCount,
        successCount,
        alreadyLikedCount: result.details.filter((d) => d.status === 'ALREADY_LIKED').length,
        failedCount,
        engagementMode: enableComment ? (enableLike ? 'BOTH' : 'COMMENT_ONLY') : 'LIKE_ONLY',
        commentCount: result.details.filter((d) => d.commentStatus === 'SUCCESS').length,
        accountName: 'Via Facebook',
        details: result.details,
      }).catch((e) => console.warn('[DB] ⚠️ Error auto-saving buff_logs from the server:', e.message));
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('[Buff API] ❌ Buff Like/Comment error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// State of live Buff sessions running in the background (keeps progress when the user reloads the page)
let activeLiveBuffSession = null;
const activeLiveBuffSessions = new Map();

telemetry.setContext({
  busyBuffLanes,
  buffLaneWaiters,
  activeLiveBuffSessions,
  activeBuffTaskIds,
  db,
  getQueueStats: () => {
    try {
      const qd = loadBuffQueue();
      const items = qd?.items || [];
      return {
        total: items.length,
        queued: items.filter((it) => it.status === 'QUEUED').length,
        running: items.filter((it) => it.status === 'RUNNING').length,
        completed: items.filter((it) => it.status === 'COMPLETED').length,
        partial: items.filter((it) => it.status === 'PARTIAL').length,
        deadLetter: items.filter((it) => it.status === 'DEAD_LETTER').length,
      };
    } catch (e) {
      return { total: 0, queued: 0, running: 0, completed: 0, partial: 0, deadLetter: 0 };
    }
  },
  getWorkerHealth: () => {
    return {
      status: 'ACTIVE',
      consecutiveFailures: typeof consecutiveQueueFailures !== 'undefined' ? consecutiveQueueFailures : 0,
      maxParallelVias: typeof getBuffParallelVias === 'function' ? getBuffParallelVias() : 2,
      maxParallelTasks: typeof getMaxParallelBuff === 'function' ? getMaxParallelBuff() : 2,
    };
  },
});

// =============================================================================
// OBSERVABILITY & HEALTH METRICS (BUFF LIKE 3.0 ENTERPRISE)
// =============================================================================
app.get('/api/system/observability', async (req, res) => {
  try {
    const metrics = await telemetry.getMetrics();
    return res.json({ success: true, metrics });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  return res.json({
    status: 'UP',
    version: '3.0.0-enterprise',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: {
      rssMB: Number((mem.rss / 1024 / 1024).toFixed(2)),
      heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
    },
  });
});

app.get('/api/readiness', async (req, res) => {
  try {
    const pool = db.getPool();
    if (!pool) {
      return res.status(503).json({ ready: false, error: 'Database pool unavailable' });
    }
    await pool.execute('SELECT 1');
    return res.json({ ready: true, status: 'READY' });
  } catch (err) {
    return res.status(503).json({ ready: false, error: err.message });
  }
});

// Get info on live Buff sessions running in the background
// The frontend only runs multiple Via groups in parallel when the backend can enforce the KPI per run and stop the whole session
const BUFF_LIVE_CAPABILITIES = ['RUN_KPI_CAP', 'STOP_ALL'];

/**
 * Merges Via groups of the same run (sessionId "<runId>_g<n>", possibly running in parallel) into 1 session
 * so the Progress screen after a reload shows the run's total likes, not just 1 Via.
 * Sessions that aren't part of a multi-group run are returned as is.
 */
function getMergedLiveSession(sess) {
  if (!sess || !/_g\d+$/.test(String(sess.sessionId || ''))) return sess;
  const runPrefix = String(sess.sessionId).replace(/_g\d+$/, '');
  const group = [...activeLiveBuffSessions.values()].filter(
    (s) => s && String(s.sessionId || '').startsWith(runPrefix + '_g')
  );
  if (group.length <= 1) return sess;

  const sum = (key) => group.reduce((acc, s) => acc + (Number(s[key]) || 0), 0);
  const runKpi = Math.max(0, ...group.map((s) => Number(s.runKpi) || 0));
  const total = runKpi > 0 ? runKpi : sum('total');
  const success = sum('success');
  const alreadyLiked = sum('alreadyLiked');
  const anyRunning = group.some((s) => s.status === 'RUNNING');
  const status = anyRunning
    ? 'RUNNING'
    : group.some((s) => s.status === 'STOPPED') ? 'STOPPED'
    : group.some((s) => s.status === 'ERROR') ? 'ERROR'
    : 'DONE';
  const seenPages = new Set();
  const details = [];
  for (const s of group) {
    for (const d of s.details || []) {
      const key = String(d.pageId || '');
      if (key && seenPages.has(key)) continue;
      if (key) seenPages.add(key);
      details.push(d);
    }
  }
  const times = (key) => group.map((s) => new Date(s[key] || 0).getTime()).filter((t) => t > 0);
  return {
    ...sess,
    sessionId: runPrefix,
    status,
    total,
    success,
    alreadyLiked,
    failed: sum('failed'),
    done: sum('done'),
    percent: Math.min(100, Math.round(((success + alreadyLiked) / Math.max(1, total)) * 100)),
    startedAt: times('startedAt').length ? new Date(Math.min(...times('startedAt'))).toISOString() : sess.startedAt,
    updatedAt: times('updatedAt').length ? new Date(Math.max(...times('updatedAt'))).toISOString() : sess.updatedAt,
    currentRunningPageName: group.filter((s) => s.status === 'RUNNING' && s.currentRunningPageName).map((s) => s.currentRunningPageName).join(' · '),
    details,
    logs: group.flatMap((s) => (Array.isArray(s.logs) ? s.logs : [])),
    kpiReached: group.some((s) => s.kpiReached) || (runKpi > 0 && success >= runKpi),
    stopRequested: group.some((s) => s.stopRequested),
    groupCount: group.length,
  };
}

app.get('/api/buff-live/active', (req, res) => {
  try {
    const reqSessionId = req.query.sessionId;
    if (reqSessionId && activeLiveBuffSessions.has(reqSessionId)) {
      return res.json({ success: true, capabilities: BUFF_LIVE_CAPABILITIES, activeSession: activeLiveBuffSessions.get(reqSessionId) });
    }
    if (!activeLiveBuffSession) {
      return res.json({ success: true, capabilities: BUFF_LIVE_CAPABILITIES, activeSession: null });
    }
    const view = getMergedLiveSession(activeLiveBuffSession);
    // Auto-clean up once the session is done and 30 minutes have passed
    if (
      view.status !== 'RUNNING' &&
      Date.now() - new Date(view.updatedAt).getTime() > 30 * 60 * 1000
    ) {
      activeLiveBuffSession = null;
      return res.json({ success: true, capabilities: BUFF_LIVE_CAPABILITIES, activeSession: null });
    }
    return res.json({ success: true, capabilities: BUFF_LIVE_CAPABILITIES, activeSession: view });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Stop command for a live Buff task
app.post('/api/buff-live/stop', (req, res) => {
  try {
    const reqSessionId = req.body?.sessionId;
    if (reqSessionId && activeLiveBuffSessions.has(reqSessionId)) {
      const sess = activeLiveBuffSessions.get(reqSessionId);
      sess.stopRequested = true;
      // The browser stopped on its own (KPI reached / Stop clicked) → the browser saves the history itself
      sess.stoppedByClient = true;
      sess.status = 'STOPPED';
      sess.updatedAt = new Date().toISOString();
      return res.json({ success: true, message: 'Stop command sent for session ' + reqSessionId, activeSession: sess });
    }
    if (!reqSessionId) {
      // No session given → stop EVERY running Via group (a single-link run may run several groups in parallel)
      let stoppedCount = 0;
      for (const sess of activeLiveBuffSessions.values()) {
        if (sess && sess.status === 'RUNNING') {
          sess.stopRequested = true;
          sess.status = 'STOPPED';
          sess.updatedAt = new Date().toISOString();
          stoppedCount++;
        }
      }
      if (stoppedCount > 0) {
        console.log(`[BuffStream] 🛑 Received a stop command for ${stoppedCount} running live buff sessions`);
        return res.json({ success: true, message: `Stop command sent for ${stoppedCount} live buff sessions`, activeSession: activeLiveBuffSession });
      }
    }
    if (activeLiveBuffSession && activeLiveBuffSession.status === 'RUNNING') {
      activeLiveBuffSession.stopRequested = true;
      activeLiveBuffSession.status = 'STOPPED';
      activeLiveBuffSession.updatedAt = new Date().toISOString();
      console.log(`[BuffStream] 🛑 Received a stop command for the live buff task (Session: ${activeLiveBuffSession.sessionId})`);
      return res.json({ success: true, message: 'Stop command sent for the live buff run', activeSession: activeLiveBuffSession });
    }
    return res.json({ success: true, message: 'No live buff session is running' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Clear the live Buff session cache
app.post('/api/buff-live/clear', (req, res) => {
  try {
    const reqSessionId = req.body?.sessionId;
    if (reqSessionId) {
      activeLiveBuffSessions.delete(reqSessionId);
    } else {
      activeLiveBuffSession = null;
      activeLiveBuffSessions.clear();
    }
    return res.json({ success: true, message: 'Live buff session info cleared' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Real-time Buff Like & Comment Stream (SSE)
app.post('/api/buff-like-stream', async (req, res) => {
  if (!(await checkLicenseOrReject(req, res))) return;

  const {
    sessionId = null,
    totalSelectedCount = 0,
    kpiTarget = 0,
    autoReplenish = true,
    cookieString,
    targetUrl,
    reactionType = 'LIKE',
    selectedPages = [],
    delayMs = 2500,
    speedMode = 'NORMAL',
    enableLike = true,
    enableComment = false,
    enableShare = false,
    enableHumanBehavior = true,
    fastSwitch = true,
    cooldownEvery = 25,
    cooldownDurationMs = 20000,
    comments = [],
    proxyUrl: explicitProxy = '',
    concurrency = 1,
    dripFeedMode = false,
    dripDurationMinutes = 30,
    clientSavesLog = false,
  } = req.body;

  if (!cookieString || !targetUrl) {
    return res.status(400).json({ success: false, error: 'Missing cookieString or targetUrl' });
  }

  if (isEmergencyStopped()) {
    const sysSettings = loadBuffSettings();
    const reason = sysSettings.emergencyReason || 'An administrator triggered EMERGENCY STOP';
    return res.status(403).json({
      success: false,
      isEmergencyStopped: true,
      error: `The system is in EMERGENCY STOP: "${reason}". Click "Resume operations" (Resume) in the toolbar to continue.`,
    });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let clientGone = false;
  const heartbeatTimer = setInterval(() => {
    if (clientGone || res.writableEnded) {
      clearInterval(heartbeatTimer);
      return;
    }
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeatTimer);
    }
  }, 10000);

  res.on('close', () => {
    clearInterval(heartbeatTimer);
    if (!res.writableFinished) {
      clientGone = true;
      console.log('[BuffStream] 🔌 Client disconnected from SSE (page reload or tab switch). The background worker keeps running safely...');
    }
  });

  const sendEvent = (event, data) => {
    if (clientGone || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {}
  };

  const sessionKey = sessionId || ('live_' + Date.now());
  const targetKpi = parseInt(kpiTarget || totalSelectedCount, 10) || selectedPages.length;

  // KPI for the WHOLE run: Via groups of the same run have sessionIds "<runId>_g<n>" and may run in parallel.
  // Sum the successes of every group in the run → never overshoot the target, even if the browser reloads / disconnects.
  const runKpi = parseInt(totalSelectedCount, 10) || 0;
  const runPrefix = /_g\d+$/.test(String(sessionKey)) ? String(sessionKey).replace(/_g\d+$/, '') : null;
  const runKpiReached = () => {
    if (!runPrefix || runKpi <= 0) return false;
    let runSuccess = 0;
    for (const sess of activeLiveBuffSessions.values()) {
      if (sess && String(sess.sessionId || '').startsWith(runPrefix + '_g')) runSuccess += sess.success || 0;
    }
    return runSuccess >= runKpi;
  };

  if (activeLiveBuffSession && activeLiveBuffSession.sessionId === sessionKey && activeLiveBuffSession.status === 'RUNNING') {
    activeLiveBuffSession.updatedAt = new Date().toISOString();
    activeLiveBuffSession.targetUrl = targetUrl;
    activeLiveBuffSession.reactionType = reactionType;
  } else {
    activeLiveBuffSession = {
      sessionId: sessionKey,
      targetUrl,
      reactionType,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      total: Math.max(targetKpi, selectedPages.length),
      done: 0,
      success: 0,
      alreadyLiked: 0,
      failed: 0,
      percent: 0,
      currentRunningPageName: '',
      details: [],
      stopRequested: false,
      runKpi,
    };
  }
  activeLiveBuffSessions.set(sessionKey, activeLiveBuffSession);

  try {
    const sysSettings = loadBuffSettings();
    const proxyPool = Array.isArray(sysSettings.proxyPool) ? sysSettings.proxyPool : [];
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const laneUid = fbBuffTool.getUserIdFromCookie(cookieString);

    notifyBuffStarted({
      targetUrl,
      total: Math.max(targetKpi, selectedPages.length),
      reactionType,
      speedMode,
      concurrency: Math.max(1, Math.min(5, parseInt(concurrency, 10) || 1)),
      accountName: 'Via ' + (laneUid || 'FB'),
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Error sending the stream-start notification:', err.message));

    const normStreamUrl = normalizeFbPostUrl(targetUrl);
    await resolvePostUrlCanonical(targetUrl).catch(() => normStreamUrl);
    const knownInteractedIds = getPostInteractedPageIds(normStreamUrl);

    const resolvedPages = await resolvePagesWithOwningVias(selectedPages, cookieString);
    const allPages = [];
    const excludeIds = new Set();
    for (const p of resolvedPages) {
      const pid = String(p.id || '');
      if (pid) excludeIds.add(pid);
      if (pid && knownInteractedIds.has(pid)) {
        const curSess = activeLiveBuffSessions.get(sessionKey) || activeLiveBuffSession;
        if (curSess) {
          curSess.done = (curSess.done || 0) + 1;
          curSess.alreadyLiked = (curSess.alreadyLiked || 0) + 1;
          curSess.details.push({
            pageId: p.id,
            pageName: p.name,
            viaName: p.viaName,
            status: 'ALREADY_LIKED',
            likeStatus: 'ALREADY_LIKED',
            message: 'Already liked (skipped automatically from saved data)',
          });
        }
        sendEvent('progress', {
          type: 'PAGE_FINISH',
          pageId: p.id,
          pageName: p.name,
          viaName: p.viaName,
          status: 'ALREADY_LIKED',
          likeStatus: 'ALREADY_LIKED',
          message: 'Already liked (skipped automatically from saved data)',
        });
        continue;
      }
      allPages.push(p);
    }

    // Smart Auto-Replenish: if there are fewer Pages than the KPI target, top up from the LIVE Via pool
    if (autoReplenish !== false && targetKpi > allPages.length) {
      const needed = targetKpi - allPages.length;
      console.log(`[BuffStream] ⚡ Smart Auto-Replenish: looking for ${needed} more Pages from the LIVE Via pool...`);
      const replenished = await getAutoReplenishPages(targetUrl, excludeIds, needed);
      if (replenished.length > 0) {
        console.log(`[BuffStream] ✅ Added ${replenished.length} Pages from the backup pool!`);
        allPages.push(...replenished);
      }
    }

    if (activeLiveBuffSession && activeLiveBuffSession.sessionId === sessionKey) {
      // Displayed target = the KPI the user set. allPages includes the backup Page pool for failures (possibly hundreds);
      // previously max(...) was used, so after a reload the UI said "Target 516 accounts" instead of 10.
      activeLiveBuffSession.total = targetKpi > 0 ? targetKpi : allPages.length;
    }

    const viaGroupsMap = new Map();
    for (const p of allPages) {
      const vKey = (p.viaCookie || cookieString).trim();
      if (!viaGroupsMap.has(vKey)) {
        const laneId = fbBuffTool.getUserIdFromCookie(vKey) || 'default';
        viaGroupsMap.set(vKey, {
          cookieString: vKey,
          laneUid: laneId,
          viaName: p.viaName || ('Via ' + laneId),
          proxyUrl: p.proxyUrl || proxyUrl,
          pages: [],
        });
      }
      viaGroupsMap.get(vKey).pages.push(p);
    }

    const viaGroups = Array.from(viaGroupsMap.values());
    const parallelVias = resolveSafeParallelVias(viaGroups, concurrency, sysSettings);
    const hasProxyPool = proxyPool.length >= 2;
    console.log(`[BuffStream] 🚀 Safe dispatch: running ${parallelVias} Vias at once (1 thread/Via) across ${viaGroups.length} Via groups (${allPages.length} Pages)`);

    const allStreamDetails = [];
    await runWithConcurrency(viaGroups, parallelVias, async (group, gIdx) => {
      const curSession = activeLiveBuffSessions.get(sessionKey) || activeLiveBuffSession;
      if (isEmergencyStopped()) {
        sendEvent('error', {
          isEmergencyStopped: true,
          error: 'The system is in EMERGENCY STOP. The task stopped immediately to keep accounts safe.',
        });
        return;
      }
      if (Boolean(curSession?.stopRequested)) return;
      const currentDone = curSession?.success || 0;
      if ((targetKpi > 0 && currentDone >= targetKpi) || runKpiReached()) {
        if (curSession) curSession.stopRequested = true;
        return;
      }

      const remainingForGroup = targetKpi > 0 ? Math.max(1, targetKpi - currentDone) : 0;
      const grpProxy = await resolveViaProxy(group.cookieString, group.proxyUrl || explicitProxy);
      const subResult = await withBuffLane(group.laneUid, async (fence) => {
        return await fbBuffTool.buffLikesWithPages(group.cookieString, targetUrl, {
          reactionType,
          selectedPages: group.pages,
          kpiTarget: remainingForGroup,
          delayMs,
          speedMode,
          enableLike,
          enableComment,
          enableShare,
          enableHumanBehavior,
          fastSwitch,
          cooldownEvery,
          cooldownDurationMs,
          comments,
          proxyUrl: grpProxy,
          proxyPool,
          concurrency: hasProxyPool && !enableComment && !dripFeedMode && group.pages.length >= 15
            ? Math.max(1, Math.min(3, parseInt(concurrency, 10) || 1))
            : 1,
          dripFeedMode: Boolean(dripFeedMode),
          dripDurationMinutes: parseInt(dripDurationMinutes, 10) || 30,
          fence,
          touch: fence?.touch,
          // ONLY STOP WHEN THE USER CLICKS STOP, EMERGENCY STOP, THE LEASE EXPIRES OR THE KPI IS REACHED
          shouldStop: () => {
            const liveSess = activeLiveBuffSessions.get(sessionKey) || activeLiveBuffSession;
            const liveDone = liveSess?.success || 0;
            return (
              Boolean(fence?.isStale()) ||
              Boolean(liveSess?.stopRequested) ||
              isEmergencyStopped() ||
              (targetKpi > 0 && liveDone >= targetKpi) ||
              runKpiReached()
            );
          },
          onProgress: (evt) => {
            fence?.touch?.();
            const curSession = activeLiveBuffSessions.get(sessionKey) || activeLiveBuffSession;
            if (curSession) {
              curSession.updatedAt = new Date().toISOString();
              if (evt.type === 'COOLDOWN_START') {
                curSession.currentRunningPageName = evt.message || `🛡️ Cooling down the Via (${evt.durationSec}s)...`;
                curSession.isCoolingDown = true;
                curSession.cooldownSec = evt.durationSec;
              } else if (evt.type === 'COOLDOWN_END') {
                curSession.isCoolingDown = false;
                curSession.cooldownSec = 0;
              } else if (evt.type === 'PAGE_START') {
                curSession.currentRunningPageName = evt.pageName || '';
              } else if (evt.type === 'PAGE_FINISH') {
                curSession.isCoolingDown = false;
                curSession.done = (curSession.done || 0) + 1;
                if (evt.status === 'SUCCESS') curSession.success++;
                else if (evt.status === 'ALREADY_LIKED') curSession.alreadyLiked++;
                else if (evt.status === 'FAILED' || evt.status === 'ERROR') curSession.failed++;
                curSession.percent = Math.min(
                  100,
                  Math.round((curSession.done / Math.max(1, curSession.total)) * 100)
                );

                const detailItem = {
                  pageId: evt.pageId,
                  pageName: evt.pageName,
                  viaName: evt.viaName || group.viaName,
                  status: evt.status,
                  likeStatus: evt.likeStatus,
                  commentStatus: evt.commentStatus,
                  shareStatus: evt.shareStatus,
                  commentText: evt.commentText,
                  message: evt.message,
                  error: evt.error,
                };
                const exIdx = curSession.details.findIndex((d) => d.pageId === evt.pageId);
                if (exIdx >= 0) {
                  curSession.details[exIdx] = { ...curSession.details[exIdx], ...detailItem };
                } else {
                  curSession.details.push(detailItem);
                }

                const curTotalDone = curSession.success || 0;
                if (targetKpi > 0 && curTotalDone >= targetKpi) {
                  curSession.stopRequested = true;
                  sendEvent('progress', {
                    type: 'KPI_REACHED',
                    kpiTarget: targetKpi,
                    success: curSession.success,
                    failed: curSession.failed,
                    percent: 100,
                    message: `🎯 Reached KPI ${curSession.success}/${targetKpi} successful Likes!`,
                  });
                }

                if (evt.actionBlocked) {
                  group.isBlocked = true;
                  console.warn(`[BuffStream] ⚠️ Via "${group.viaName}" hit a Facebook Rate Limit / Action Blocked. Handing over to the next Via group automatically...`);
                  notifyActionBlocked({
                    viaName: evt.viaName || group.viaName,
                    viaUid: group.laneUid,
                    postUrl: targetUrl,
                    reason: 'Facebook temporarily blocked fast actions (Action Blocked)',
                  }).catch((err) => console.warn('[TelegramAlert] ⚠️ Error sending the Action Blocked alert:', err.message));

                  // Only stop everything if every Via group is blocked
                  const hasRemainingHealthyVias = viaGroups.some((g) => !g.isBlocked);
                  if (!hasRemainingHealthyVias) {
                    curSession.stopRequested = true;
                    curSession.status = 'STOPPED';
                    curSession.error = 'Every Via was temporarily restricted by Facebook (Action Blocked). The system auto-triggered an emergency stop to keep accounts safe!';
                    console.warn('[BuffStream] 🛑 Run stopped automatically because every Via is Action Blocked.');
                  }
                }
              }
            }
            sendEvent('progress', {
              ...evt,
              viaName: evt.viaName || group.viaName,
              viaUid: evt.viaUid || group.laneUid,
            });
          },
        });
      });
      if (subResult?.details) {
        allStreamDetails.push(
          ...subResult.details.map((d) => ({
            ...d,
            viaName: d.viaName || group.viaName,
            viaUid: d.viaUid || group.laneUid,
          }))
        );
      }
    });
    const result = { details: allStreamDetails, total: selectedPages.length };

    const sess = activeLiveBuffSessions.get(sessionKey) || activeLiveBuffSession;
    if (sess) {
      if (sess.stopRequested) {
        sess.status = 'STOPPED';
      } else if (targetKpi > 0 && sess.success >= targetKpi) {
        sess.status = 'DONE';
      } else if (sess.done >= sess.total) {
        sess.status = 'DONE';
      } else {
        // Went through every available account this round (even if short of the KPI) -> finish the session instead of hanging in RUNNING
        sess.status = 'DONE';
      }
      sess.currentRunningPageName = '';
      sess.updatedAt = new Date().toISOString();
    }

    const streamStartMs = activeLiveBuffSession?.startedAt ? new Date(activeLiveBuffSession.startedAt).getTime() : Date.now();
    const durationSec = Math.max(1, Math.round((Date.now() - streamStartMs) / 1000));
    const totalCount = selectedPages?.length || result?.total || 0;
    const successCount = result?.successCount ?? (result?.details ? result.details.filter((d) => d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED').length : 0);
    const failedCount = result?.failedCount ?? (result?.details ? result.details.filter((d) => d.status === 'ERROR' || d.status === 'FAILED' || d.status === 'NO_BUTTON').length : 0);

    let screenshotPath = null;
    try {
      const shot = await fbBuffTool.capturePostScreenshot(targetUrl, {
        cookieStr: cookieString,
        proxyUrl,
        timeoutMs: 25000,
      });
      if (shot && shot.success && shot.filePath) {
        screenshotPath = shot.filePath;
      }
    } catch (e) {
      console.warn('[ScreenshotProof] ⚠️ Ignoring stream post screenshot error:', e.message);
    }

    notifyBuffCompleted({
      targetUrl,
      success: successCount,
      total: totalCount,
      failed: failedCount,
      durationSec,
      reactionType,
      screenshotPath,
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Error sending the stream-done notification:', err.message));

    // Automatically save the buff history to MySQL right on the Server (so logs are never lost).
    // If the browser said it would save (clientSavesLog) and is still connected, skip to avoid writing 2 copies;
    // when the browser has disconnected (reload / tab closed) the server still saves a fallback.
    // The browser stopping on its own (KPI reached) also disconnects → not treated as "lost connection", avoiding duplicates.
    const stoppedByClient = Boolean((activeLiveBuffSessions.get(sessionKey) || {}).stoppedByClient);
    if (result && Array.isArray(result.details) && result.details.length > 0 && !(clientSavesLog && (!clientGone || stoppedByClient))) {
      db.saveBuffLogs({
        id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        type: 'SINGLE',
        targetUrl,
        reactionType,
        totalPages: totalCount,
        targetLikes: (kpiTarget && kpiTarget > 0) ? kpiTarget : totalCount,
        successCount,
        alreadyLikedCount: result.details.filter((d) => d.status === 'ALREADY_LIKED').length,
        failedCount,
        engagementMode: enableComment ? (enableLike ? 'BOTH' : 'COMMENT_ONLY') : 'LIKE_ONLY',
        commentCount: result.details.filter((d) => d.commentStatus === 'SUCCESS').length,
        accountName: 'Via Facebook',
        details: result.details,
      }).catch((e) => console.warn('[DB] ⚠️ Error auto-saving buff_logs from the stream:', e.message));
    }

    sendEvent('done', { result });
    clearInterval(heartbeatTimer);
    res.end();
  } catch (err) {
    clearInterval(heartbeatTimer);
    console.error('[BuffStream] ❌ Stream error:', err.message);
    const errSess = activeLiveBuffSessions.get(sessionKey) || activeLiveBuffSession;
    if (errSess) {
      errSess.status = 'ERROR';
      errSess.error = err.message;
      errSess.currentRunningPageName = '';
      errSess.updatedAt = new Date().toISOString();
    }
    sendEvent('error', { error: err.message });
    res.end();
  }
});

// Buff View Video / Reels Facebook
app.post('/api/buff-view', async (req, res) => {
  const { targetUrl, targetViews = 10, concurrency = 2, watchTimeSeconds = 6, cookieString = null } = req.body;
  if (!targetUrl) {
    return res.status(400).json({ success: false, error: 'Missing targetUrl' });
  }
  try {
    const result = await fbBuffTool.buffViews(targetUrl, {
      targetViews: parseInt(targetViews, 10) || 10,
      concurrency: parseInt(concurrency, 10) || 2,
      watchTimeSeconds: parseInt(watchTimeSeconds, 10) || 6,
      cookieStr: cookieString,
    });
    return res.json({ success: true, result });
  } catch (err) {
    console.error('[Buff API] ❌ View Buff error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// 5. API ROUTES - QUEUE & HISTORY
// =============================================================================

function addBuffQueueTask(taskPayload) {
  const queueData = loadBuffQueue();
  const history = loadBuffHistory();
  const normUrl = normalizeFbPostUrl(taskPayload.targetUrl);

  const isRebuff = Boolean(
    taskPayload.allowRebuff ||
    taskPayload.force ||
    taskPayload.source?.includes('REBUFF') ||
    taskPayload.source === 'MANUAL' ||
    taskPayload.source === 'RESUME_REMAINING'
  );
  // Only auto-skip when it's the Post Hunter BOT (AUTO_MONITOR) scanning a duplicate post;
  // user-created orders or resumes are always allowed (the Anti-Overlap filter drops old Pages automatically)
  if (history[normUrl] && !isRebuff && taskPayload.source === 'AUTO_MONITOR') {
    return { skipped: true, history: history[normUrl] };
  }

  // Check the Idempotency Key (absolute dedupe when a laggy network causes multiple clicks)
  if (taskPayload.idempotencyKey) {
    const byKey = queueData.items.find((it) => it.idempotencyKey === taskPayload.idempotencyKey);
    if (byKey) {
      return { alreadyQueued: true, task: byKey, idempotent: true };
    }
  }

  // Only block if the post is ACTUALLY RUNNING or WAITING in the queue
  const existing = queueData.items.find(
    (it) => it.normalizedUrl === normUrl && (it.status === 'QUEUED' || it.status === 'RUNNING')
  );
  if (existing) {
    return { alreadyQueued: true, task: existing };
  }

  const delayMin = parseDelayMinutes(taskPayload.delayMinutes);
  const newTask = {
    id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    idempotencyKey: taskPayload.idempotencyKey || null,
    source: taskPayload.source || 'MANUAL',
    monitorId: taskPayload.monitorId || null,
    monitorName: taskPayload.monitorName || null,
    targetUrl: taskPayload.targetUrl,
    normalizedUrl: normUrl,
    targetLikes: parseTargetLikes(taskPayload.targetLikes),
    reactionType: taskPayload.reactionType || 'RANDOM_POSITIVE',
    enableLike: taskPayload.enableLike !== false,
    enableComment: Boolean(taskPayload.enableComment),
    enableShare: Boolean(taskPayload.enableShare),
    comments: Array.isArray(taskPayload.comments) ? taskPayload.comments : [],
    delayMinutes: delayMin,
    speedMode: taskPayload.speedMode || 'SMART',
    dripFeedMode: Boolean(taskPayload.dripFeedMode),
    dripDurationMinutes: Number(taskPayload.dripDurationMinutes) || 20,
    addedAt: new Date().toISOString(),
    runAfter: new Date(Date.now() + delayMin * 60 * 1000).toISOString(),
    status: 'QUEUED',
    cookieString: taskPayload.cookieString || 'ALL_VIAS',
    attempts: 0,
  };

  queueData.items.unshift(newTask);
  saveBuffQueue(queueData);
  return { task: newTask };
}

app.post('/api/buff-queue/add', async (req, res) => {
  try {
    if (!(await checkLicenseOrReject(req, res))) return;

    if (!req.body.targetUrl) {
      return res.status(400).json({ success: false, error: 'Missing targetUrl' });
    }
    const result = addBuffQueueTask(req.body);
    if (result.skipped) {
      return res.json({
        success: true,
        skipped: true,
        message: 'This post was already buffed before; skipped automatically to avoid duplicates.',
        history: result.history,
      });
    }
    if (result.alreadyQueued) {
      return res.json({
        success: true,
        alreadyQueued: true,
        message: 'This post is already in the processing queue.',
        task: result.task,
      });
    }

    notifyQueueAdded({
      targetUrl: req.body.targetUrl,
      targetLikes: req.body.targetLikes || 30,
      reactionType: req.body.reactionType || 'LIKE',
      delayMinutes: req.body.delayMinutes || 0,
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Error sending the queue notification:', err.message));

    return res.json({ success: true, task: result.task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// TOP-UP: posts from today that got fewer likes than asked (e.g. a Via's cookie died mid-day)
// ==========================================

/** Not-yet-liked Pages of every live Via for a post, deduped by Page id */
async function countAvailablePagesForPost(normUrl, liveVias) {
  const seen = new Set();
  for (const via of liveVias) {
    const uid = via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString);
    const pages = await fbBuffTool.mergeCachedAndDbPages(uid, via.viaName).catch(() => []);
    for (const p of filterAvailablePagesForPost(normUrl, pages || [])) seen.add(String(p.id));
  }
  return seen.size;
}

/**
 * Posts worked on today whose successful likes are below the largest target asked for them today.
 * missing = min(asked - got, Pages that can still like it now), so a post is only offered when a top-up can help.
 */
async function findShortPostsToday() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sinceMs = startOfDay.getTime();

  const targets = new Map(); // normUrl -> { url, requested, reactionType }
  const addTarget = (url, requested, reactionType) => {
    const n = Number(requested);
    if (!url || !Number.isFinite(n) || n <= 0) return;
    const norm = normalizeFbPostUrl(url);
    const cur = targets.get(norm);
    if (!cur || n > cur.requested) targets.set(norm, { url, requested: n, reactionType: reactionType || cur?.reactionType });
  };

  const queue = loadBuffQueue();
  const busy = new Set();
  for (const it of queue.items || []) {
    const norm = it.normalizedUrl || normalizeFbPostUrl(it.targetUrl);
    if (it.status === 'QUEUED' || it.status === 'RUNNING') busy.add(norm);
    if (Date.parse(it.addedAt || '') >= sinceMs) addTarget(it.targetUrl, it.targetLikes, it.reactionType);
  }
  try {
    const [rows] = await db.getPool().execute(
      `SELECT target_url, target_likes, reaction_type FROM buff_logs WHERE created_at >= ? AND target_likes IS NOT NULL`,
      [startOfDay]
    );
    for (const r of rows) addTarget(r.target_url, r.target_likes, r.reaction_type);
  } catch (e) {
    console.warn('[TopUp] ⚠️ Could not read today\'s buff_logs:', e.message);
  }

  const liveVias = await db.getLiveVias().catch(() => []);
  const result = [];
  for (const [norm, t] of targets) {
    if (busy.has(norm)) continue;
    const achieved = countPostSuccessSince(norm, sinceMs);
    const shortBy = t.requested - achieved;
    if (shortBy <= 0) continue;
    const available = await countAvailablePagesForPost(norm, liveVias);
    const missing = Math.min(shortBy, available);
    if (missing > 0) {
      result.push({ url: t.url, requested: t.requested, achieved, available, missing, reactionType: t.reactionType || 'LIKE' });
    }
  }
  return result.sort((a, b) => b.missing - a.missing);
}

app.get('/api/buff-topup/candidates', async (req, res) => {
  try {
    const posts = await findShortPostsToday();
    return res.json({ success: true, posts, totalMissing: posts.reduce((s, p) => s + p.missing, 0) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Body: { urls?: string[] } — top up only these posts, or every candidate when omitted
app.post('/api/buff-topup/run', async (req, res) => {
  try {
    if (!(await checkLicenseOrReject(req, res))) return;
    const only = Array.isArray(req.body?.urls) ? new Set(req.body.urls.map((u) => normalizeFbPostUrl(u))) : null;
    const posts = (await findShortPostsToday()).filter((p) => !only || only.has(normalizeFbPostUrl(p.url)));
    const queued = [];
    for (const p of posts) {
      const r = addBuffQueueTask({
        targetUrl: p.url,
        targetLikes: p.missing,
        reactionType: p.reactionType,
        source: 'RESUME_REMAINING',
        speedMode: 'SMART',
      });
      if (r.task && !r.alreadyQueued) queued.push({ url: p.url, likes: p.missing, taskId: r.task.id });
    }
    console.log(`[TopUp] 🔁 Queued top-ups for ${queued.length} posts (${queued.reduce((s, q) => s + q.likes, 0)} likes).`);
    return res.json({ success: true, queued });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/batch-add', async (req, res) => {
  try {
    if (!(await checkLicenseOrReject(req, res))) return;
    const {
      urls = [],
      targetLikes = 30,
      reactionType = 'RANDOM_POSITIVE',
      delayMinutes = 0,
      enableLike = true,
      enableComment = false,
      comments = [],
      speedMode = 'SMART',
      staggerMinutes = 3,
    } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing the urls list' });
    }

    const baseDelay = parseDelayMinutes(delayMinutes);
    const stagger = Math.max(0, Number(staggerMinutes) || 0);

    const added = [];
    const skipped = [];
    const alreadyQueued = [];

    urls.forEach((u, idx) => {
      const cleanUrl = String(u || '').trim();
      if (!cleanUrl) return;

      const calculatedDelay = baseDelay + idx * stagger;
      const result = addBuffQueueTask({
        targetUrl: cleanUrl,
        targetLikes,
        reactionType,
        enableLike,
        enableComment,
        comments,
        speedMode,
        delayMinutes: calculatedDelay,
        source: 'BATCH_MANUAL',
      });

      if (result.skipped) {
        skipped.push({ url: cleanUrl, reason: 'Already buffed' });
      } else if (result.alreadyQueued) {
        alreadyQueued.push({ url: cleanUrl, taskId: result.task?.id });
      } else if (result.task) {
        added.push(result.task);
      }
    });

    if (added.length > 0) {
      notifyQueueAdded({
        targetUrl: `${added.length} posts (Combined order)`,
        targetLikes: `${targetLikes} likes/post`,
        reactionType,
        delayMinutes: baseDelay,
      }).catch((err) => console.warn('[TelegramAlert] ⚠️ Error sending the batch queue notification:', err.message));
    }

    return res.json({
      success: true,
      totalReceived: urls.length,
      addedCount: added.length,
      skippedCount: skipped.length,
      alreadyQueuedCount: alreadyQueued.length,
      added,
      skipped,
      alreadyQueued,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/buff-queue/check', (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url' });
    const normalizedUrl = normalizeFbPostUrl(String(url));
    const history = loadBuffHistory();
    const queueData = loadBuffQueue();

    const isBuffed = Boolean(history[normalizedUrl]);
    const queueTask = queueData.items.find((it) => it.normalizedUrl === normalizedUrl);

    return res.json({
      success: true,
      url,
      normalizedUrl,
      isBuffed,
      history: history[normalizedUrl] || null,
      inQueue: Boolean(queueTask),
      queueTask: queueTask || null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/buff-queue/list', (req, res) => {
  try {
    const queueData = loadBuffQueue();
    const history = loadBuffHistory();
    const getTaskTimestamp = (t) => {
      if (t.addedAt) {
        const ms = new Date(t.addedAt).getTime();
        if (!isNaN(ms)) return ms;
      }
      if (t.startedAt) {
        const ms = new Date(t.startedAt).getTime();
        if (!isNaN(ms)) return ms;
      }
      if (t.finishedAt) {
        const ms = new Date(t.finishedAt).getTime();
        if (!isNaN(ms)) return ms;
      }
      if (t.id && t.id.startsWith('task_')) {
        const ts = parseInt(t.id.split('_')[1], 10);
        if (!isNaN(ts)) return ts;
      }
      return 0;
    };
    const sortedQueue = [...(queueData.items || [])].sort((a, b) => getTaskTimestamp(b) - getTaskTimestamp(a));
    return res.json({
      success: true,
      queue: sortedQueue,
      historyCount: Object.keys(history).length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/buff-queue/remove/:id', (req, res) => {
  try {
    const { id } = req.params;
    cancelledTaskIds.add(id);
    const queueData = loadBuffQueue();
    const prevLen = queueData.items.length;
    queueData.items = queueData.items.filter((it) => it.id !== id);
    saveBuffQueue(queueData);
    return res.json({ success: true, deleted: queueData.items.length < prevLen });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/stop/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const task = queueData.items.find((it) => it.id === id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found in the queue' });

    if (task.status !== 'RUNNING' && task.status !== 'QUEUED') {
      return res.status(400).json({ success: false, error: `The task is in status ${task.status}, no need to stop.` });
    }

    task.stopReason = 'USER_STOP';
    if (task.status === 'RUNNING') {
      cancelledTaskIds.add(id);
      task.stopRequested = true;
      task.error = 'Stopping the task at the user\'s request...';
      saveBuffQueue(queueData);
      return res.json({
        success: true,
        message: 'Stop command sent for this post. The worker will stop after the current Page.',
        task,
      });
    }

    task.status = 'STOPPED';
    task.executionStage = 'STOPPED';
    task.finishedAt = new Date().toISOString();
    task.stopRequested = false;
    task.error = 'Stopped at the user\'s request.';
    saveBuffQueue(queueData);
    return res.json({ success: true, message: 'Stopped the task waiting in the queue.', task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/run-now/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const task = queueData.items.find((it) => it.id === id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    cancelledTaskIds.delete(id);
    delete task.stopReason;
    delete task.stopRequested;
    task.runAfter = new Date().toISOString();
    task.status = 'QUEUED';
    saveBuffQueue(queueData);

    setImmediate(runQueueWorker);

    return res.json({ success: true, message: 'Task triggered to run now!', task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/retry/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const task = queueData.items.find((it) => it.id === id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    cancelledTaskIds.delete(id);
    delete task.stopReason;
    delete task.stopRequested;
    task.runAfter = new Date().toISOString();
    task.status = 'QUEUED';
    task.error = null;
    task.attempts = 0;
    saveBuffQueue(queueData);

    setImmediate(runQueueWorker);

    return res.json({ success: true, message: 'Task re-queued to run again!', task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Manual reconciliation for tasks needing review (NEEDS_REVIEW)
app.post('/api/buff-queue/review-resolve/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'RESUME' | 'COMPLETE' | 'CANCEL'
    const queueData = loadBuffQueue();
    const task = queueData.items.find((it) => it.id === id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (task.status !== 'NEEDS_REVIEW' && task.status !== 'FAILED') {
      return res.status(400).json({ success: false, error: `The task is in status ${task.status}, no reconciliation needed.` });
    }

    if (action === 'RESUME') {
      const currentSuccess = Number(task.progress?.success || task.progressLikes || 0);
      const originalTarget = parseTargetLikes(task.targetLikes, 30);
      const remainingTarget = originalTarget === 'ALL' ? 'ALL' : Math.max(1, originalTarget - currentSuccess);

      task.status = 'QUEUED';
      task.executionStage = 'INITIALIZED';
      task.error = null;
      task.runAfter = new Date().toISOString();
      task.reviewResolvedAt = new Date().toISOString();
      task.reviewResolution =
        originalTarget === 'ALL'
          ? `Continue running all remaining pages (${currentSuccess} likes were done earlier).`
          : `Continue running the ${remainingTarget} missing likes to reach the KPI of ${originalTarget} (${currentSuccess} likes were done earlier).`;
      saveBuffQueue(queueData);
      setImmediate(runQueueWorker);
      return res.json({ success: true, message: `Task re-queued to run the ${remainingTarget} missing likes`, task });
    } else if (action === 'COMPLETE') {
      task.status = 'COMPLETED';
      task.executionStage = 'COMPLETED';
      task.finishedAt = new Date().toISOString();
      task.reviewResolvedAt = new Date().toISOString();
      task.reviewResolution = 'Accepted the current result and closed the task.';
      saveBuffQueue(queueData);
      return res.json({ success: true, message: 'Task completed per reconciliation', task });
    } else if (action === 'CANCEL') {
      task.status = 'CANCELLED';
      task.executionStage = 'CANCELLED';
      task.reviewResolvedAt = new Date().toISOString();
      task.reviewResolution = 'Task cancelled per reconciliation.';
      saveBuffQueue(queueData);
      return res.json({ success: true, message: 'Task cancelled', task });
    } else {
      return res.status(400).json({ success: false, error: 'Invalid action. Supported: RESUME, COMPLETE, CANCEL.' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// QUEUE WORKER ENGINE (AUTOMATIC QUEUE PROCESSING)
// =============================================================================

async function executeQueueTask(task) {
  if (activeBuffTaskIds.has(task.id)) return;
  activeBuffTaskIds.add(task.id);

  const queueData = loadBuffQueue();
  const currentTask = queueData.items.find((it) => it.id === task.id);
  if (!currentTask) {
    activeBuffTaskIds.delete(task.id);
    return;
  }

  currentTask.status = 'RUNNING';
  currentTask.executionStage = 'PREPARING';
  currentTask.startedAt = new Date().toISOString();
  currentTask.error = null;
  currentTask.finishedAt = null;
  saveBuffQueue(queueData);

  const startTime = Date.now();
  console.log(`[BuffQueue Worker] 🚀 Running Task ${task.id} for post: ${task.targetUrl}`);

  try {
    let targetVias = [];
    if (task.cookieString && task.cookieString !== 'ALL_VIAS') {
      const liveVias = await db.getLiveVias();
      const matched = liveVias.find(
        (v) => v.cookieString === task.cookieString || v.uid === fbBuffTool.getUserIdFromCookie(task.cookieString)
      );
      if (matched) {
        targetVias = [matched];
      } else {
        // The post is pinned to a specific Via that is currently marked as failing: don't reuse the old dead Cookie
        const pinnedUid = fbBuffTool.getUserIdFromCookie(task.cookieString);
        const deadRow = pinnedUid
          ? (await db.getSocialAccounts()).find(
              (r) =>
                r.platform !== 'FACEBOOK_GROUP' &&
                (r.cookieString || r.accessToken || '').match(/(?:^|;\s*)c_user=([^;\s]+)/)?.[1] === pinnedUid &&
                (r.tokenStatus === 'EXPIRED' || r.tokenStatus === 'CHECKPOINT')
            )
          : null;
        if (deadRow) {
          throw new Error(
            `Via ${deadRow.pageName || pinnedUid} is ${deadRow.tokenStatus === 'CHECKPOINT' ? 'checkpointed' : 'cookie-expired'}. Update its Cookie on the Vias & Fanpages page, then click Retry.`
          );
        }
        targetVias = [
          {
            id: 'task_via',
            uid: fbBuffTool.getUserIdFromCookie(task.cookieString) || 'custom',
            viaName: 'Dedicated Via',
            cookieString: task.cookieString,
            proxyUrl: '',
          },
        ];
      }
    } else {
      targetVias = await db.getLiveVias();
    }

    if (targetVias.length === 0) {
      throw new Error('No usable Via account found in the system');
    }

    // Multi-worker distribution: prefer idle Vias (no busy lane) so 2 Workers running 2 posts in parallel don't congest
    targetVias.sort((a, b) => {
      const aBusy = busyBuffLanes.has(a.uid) ? 1 : 0;
      const bBusy = busyBuffLanes.has(b.uid) ? 1 : 0;
      return aBusy - bBusy;
    });

    let allAvailablePages = [];
    for (const via of targetVias) {
      if (isEmergencyStopped()) break;
      const uid = via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString);
      let pages = await fbBuffTool.mergeCachedAndDbPages(uid, via.viaName);
      if (!pages || pages.length === 0) {
        try {
          pages = await fbBuffTool.getManagedPages(via.cookieString, {
            forceRefresh: false,
            viaName: via.viaName,
            proxyUrl: via.proxyUrl,
          });
        } catch (e) {
          console.warn(`[BuffQueue Worker] ⚠️ Could not get pages from via ${via.viaName}:`, e.message);
          verifyViaAfterRunError({ ...via, uid });
          continue;
        }
      }

      for (const p of pages || []) {
        allAvailablePages.push({
          ...p,
          viaAccountId: via.id,
          viaName: via.viaName,
          viaCookie: via.cookieString,
          proxyUrl: via.proxyUrl,
        });
      }
    }

    const normUrl = normalizeFbPostUrl(task.targetUrl);
    await resolvePostUrlCanonical(task.targetUrl).catch(() => normUrl);
    allAvailablePages = filterAvailablePagesForPost(normUrl, allAvailablePages);

    if (allAvailablePages.length === 0) {
      console.log(`[BuffQueue Worker] ℹ️ Every page already engaged with post "${task.targetUrl}". Completing the task.`);
      const qd = loadBuffQueue();
      const t = qd.items.find((it) => it.id === task.id);
      if (t) {
        t.status = 'COMPLETED';
        t.finishedAt = new Date().toISOString();
        t.result = { total: 0, success: 0, failed: 0, message: 'Already liked or no new pages left' };
        saveBuffQueue(qd);
      }
      return;
    }

    let totalSuccess = Number(currentTask?.progress?.success ?? currentTask?.progress_likes ?? currentTask?.progressLikes ?? task?.progress_likes ?? 0);
    let totalDone = Number(currentTask?.progress?.done ?? totalSuccess);
    let totalFailed = Number(currentTask?.progress?.failed ?? 0);

    const maxPages = getMaxPagesPerPost();
    const desiredLikes =
      task.targetLikes === 'ALL'
        ? Math.min(totalSuccess + allAvailablePages.length, maxPages)
        : Math.min(task.targetLikes || 30, totalSuccess + allAvailablePages.length);
    const remainingDesired = Math.max(1, desiredLikes - totalSuccess);

    // Distribute Pages evenly across Vias round-robin (avoids piling work onto a single Via)
    const pagesByVia = new Map();
    for (const p of allAvailablePages) {
      const vKey = p.viaCookie || 'default';
      if (!pagesByVia.has(vKey)) pagesByVia.set(vKey, []);
      pagesByVia.get(vKey).push(p);
    }

    const balancedPages = [];
    let hasMore = true;
    let round = 0;
    while (hasMore) {
      hasMore = false;
      for (const list of pagesByVia.values()) {
        if (round < list.length) {
          balancedPages.push(list[round]);
          hasMore = true;
        }
      }
      round++;
    }

    // Prepare the Page list: with a specific KPI target, take extra backups (+50% or at least +40 Pages) to auto-replace failed Pages
    const reserveCount =
      task.targetLikes === 'ALL'
        ? remainingDesired
        : Math.min(balancedPages.length, Math.max(Math.ceil(remainingDesired * 1.5), remainingDesired + 40));
    const pagesToBuff = balancedPages.slice(0, reserveCount);

    const viaGroupsMap = new Map();
    for (const p of pagesToBuff) {
      const key = p.viaCookie || 'unknown';
      if (!viaGroupsMap.has(key)) {
        viaGroupsMap.set(key, {
          cookieString: p.viaCookie,
          viaName: p.viaName || 'Via',
          proxyUrl: p.proxyUrl || '',
          pages: [],
        });
      }
      const commentLines = Array.isArray(task.comments) ? task.comments : [];
      viaGroupsMap.get(key).pages.push({
        id: p.id,
        name: p.name,
        comment: commentLines.length > 0 ? commentLines[Math.floor(Math.random() * commentLines.length)] : '',
      });
    }

    const viaGroups = Array.from(viaGroupsMap.values());
    const sysSettings = loadBuffSettings();
    const proxyPool = Array.isArray(sysSettings.proxyPool) ? sysSettings.proxyPool : [];
    const maxViaParallel = resolveSafeParallelVias(viaGroups, getMaxParallelBuff(), sysSettings);

    notifyBuffStarted({
      targetUrl: task.targetUrl,
      total: pagesToBuff.length,
      reactionType: task.reactionType || 'RANDOM_POSITIVE',
      speedMode: task.speedMode || sysSettings.defaultSpeedMode || 'NORMAL',
      concurrency: maxViaParallel,
      accountName: 'Queue Worker Auto',
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Error notifying queue worker start:', err.message));

    const qdDispatch = loadBuffQueue();
    const tDispatch = qdDispatch.items.find((it) => it.id === task.id);
    if (tDispatch) {
      tDispatch.executionStage = 'DISPATCHING';
      tDispatch.dispatchedAt = new Date().toISOString();
      saveBuffQueue(qdDispatch);
    }

    const isTaskCancelled = () => cancelledTaskIds.has(task.id) || (isPostHunterPaused() && isPostHunterTask(task));
    const laneErrors = [];

    // Run 1 thread per Via sequentially (avoids the "using this too fast" warning) and allow up to 2 different Vias in parallel
    await runWithConcurrency(viaGroups, maxViaParallel, async (group) => {
      if (isEmergencyStopped() || isTaskCancelled()) return;
      if (task.targetLikes !== 'ALL' && totalSuccess >= desiredLikes) return;

      const laneUid = fbBuffTool.getUserIdFromCookie(group.cookieString);
      const effectiveSpeedMode = task.speedMode || sysSettings.defaultSpeedMode || 'NORMAL';
      const workerConcurrency =
        proxyPool.length >= 2 && !task.enableComment && !task.dripFeedMode && group.pages.length >= 15
          ? (effectiveSpeedMode === 'TURBO' ? 3 : 2)
          : 1;
      try {
        await withBuffLane(laneUid, (fence) =>
          fbBuffTool.buffLikesWithPages(group.cookieString, task.targetUrl, {
            reactionType: task.reactionType || 'RANDOM_POSITIVE',
            speedMode: effectiveSpeedMode,
            concurrency: workerConcurrency,
            selectedPages: group.pages,
            kpiTarget: remainingDesired,
            delayMs: resolveDefaultDelayForMode(effectiveSpeedMode),
            enableLike: task.enableLike !== false,
            enableComment: Boolean(task.enableComment),
            enableShare: Boolean(task.enableShare),
            dripFeedMode: Boolean(task.dripFeedMode),
            dripDurationMinutes: Number(task.dripDurationMinutes) || 20,
            enableHumanBehavior: true,
            fastSwitch: true,
            cooldownEvery: sysSettings.cooldownEveryPages || 25,
            cooldownDurationMs: (sysSettings.cooldownDurationSec || 20) * 1000,
            comments: task.comments || [],
            proxyUrl: group.proxyUrl,
            proxyPool,
            shouldStop: () => fence?.isStale() || isEmergencyStopped() || isTaskCancelled() || (task.targetLikes !== 'ALL' && totalSuccess >= desiredLikes),
            onProgress: (ev) => {
              fence?.touch?.();
              if (ev.actionBlocked) {
                console.warn(`[QueueWorker] 🛑 Via rate-limited by Facebook (Action Blocked) on task ${task.id}. Stopping the task to protect the Via!`);
                notifyActionBlocked({
                  viaName: group.viaName || 'Via',
                  viaUid: laneUid,
                  postUrl: task.targetUrl,
                  reason: 'Facebook temporarily blocked fast actions (Action Blocked)',
                }).catch(() => {});
              }
              if (ev.type === 'PAGE_FINISH') {
                fence?.touch?.();
                totalDone++;
                if (ev.status === 'SUCCESS') totalSuccess++;
                else if (ev.status === 'ERROR' || ev.status === 'FAILED') totalFailed++;

                const qd = loadBuffQueue();
                const t = qd.items.find((it) => it.id === task.id);
                if (t) {
                  t.executionStage = 'INTERACTING';
                  t.progress = { done: totalDone, total: desiredLikes, success: totalSuccess, failed: totalFailed, kpiTarget: desiredLikes };
                  t.pageDetails = t.pageDetails || [];
                  t.pageDetails.push({
                    pageId: ev.pageId,
                    pageName: ev.pageName,
                    viaName: ev.viaName || group.viaName || 'Via',
                    status: ev.status,
                    likeStatus: ev.likeStatus,
                    commentStatus: ev.commentStatus,
                    shareStatus: ev.shareStatus,
                    reaction: ev.reaction || task.reactionType,
                    comment: ev.comment || '',
                    error: ev.error || null,
                    time: new Date().toLocaleTimeString(),
                  });
                  saveBuffQueue(qd);
                }
              }
            },
          })
        );
      } catch (laneErr) {
        const errMsg = laneErr?.message || String(laneErr);
        laneErrors.push(`${group.viaName || laneUid}: ${errMsg}`);
        console.warn(`[QueueWorker] ⚠️ Via ${group.viaName || laneUid} can't run this turn (${errMsg}). Continuing with other Vias...`);
      }
    });

    const durationSec = Math.round((Date.now() - startTime) / 1000);
    const cancelled = isTaskCancelled();
    cancelledTaskIds.delete(task.id);
    // Look this up before loading the queue: awaiting between load and save could overwrite other workers' writes
    const deadViaNames = await listDeadViaNames();

    const qd = loadBuffQueue();
    const t = qd.items.find((it) => it.id === task.id);
    if (t) {
      const finalSuccess = (t.pageDetails || []).filter((d) => d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED').length;
      const finalFailed = (t.pageDetails || []).filter((d) => d.status === 'ERROR' || d.status === 'FAILED').length;
      const autoRefilledCount = Math.max(0, (finalSuccess + finalFailed) - desiredLikes);
      // Judge against what the user asked for, not desiredLikes: desiredLikes is already shrunk to the Pages
      // available when the task started, so a run cut short by dead Vias used to show as "COMPLETED 74/200".
      const requestedLikes = task.targetLikes === 'ALL' ? desiredLikes : Number(task.targetLikes) || 30;
      const isTargetMet = task.targetLikes === 'ALL' || finalSuccess >= requestedLikes;
      const pageShortage = Math.max(0, requestedLikes - desiredLikes);

      const userStopped = cancelled && t.stopReason === 'USER_STOP';
      t.status = userStopped ? 'STOPPED' : cancelled ? 'CANCELLED' : isEmergencyStopped() ? 'STOPPED' : isTargetMet ? 'COMPLETED' : 'PARTIAL';
      t.executionStage = userStopped ? 'STOPPED' : cancelled ? 'CANCELLED' : isEmergencyStopped() ? 'STOPPED' : isTargetMet ? 'COMPLETED' : 'PARTIAL';
      t.stopRequested = false;
      t.finishedAt = new Date().toISOString();
      if (userStopped) {
        t.error = 'Stopped at the user\'s request.';
      } else if (cancelled) {
        t.error = t.error || 'Cancelled because Post Hunter was paused.';
      } else if (finalSuccess === 0 && laneErrors.length > 0) {
        t.error = `Run error: ${laneErrors.join(' | ')}`;
      }
      t.result = {
        total: requestedLikes,
        targetKpi: requestedLikes,
        availablePages: desiredLikes,
        deadVias: deadViaNames,
        autoRefilledCount,
        success: finalSuccess,
        failed: finalFailed,
        durationSec,
        note: userStopped
          ? `Task stopped midway as requested (${finalSuccess} likes done).`
          : cancelled
          ? `Task cancelled midway (${finalSuccess} likes done before cancelling).`
          : !isTargetMet && laneErrors.length > 0 && finalSuccess === 0
          ? `Task stopped due to an error: ${laneErrors.join(' | ')}`
          : !isTargetMet
          ? `Completed ${finalSuccess}/${requestedLikes} likes (${requestedLikes - finalSuccess} short). ` +
            (pageShortage > 0
              ? `Only ${desiredLikes} Pages could still like this post when it ran` +
                (deadViaNames.length ? `; Vias with a dead cookie: ${deadViaNames.join(', ')}. Update their Cookies, then top up.` : '.')
              : 'Some Pages failed or a Via disconnected mid-run.')
          : undefined,
      };
      saveBuffQueue(qd);

      // Automatically record into the shared engagement History (buff_logs) so it shows in the "History" tab
      const alreadyLikedCount = (t.pageDetails || []).filter((d) => d.status === 'ALREADY_LIKED').length;
      const displayAccountName = Array.from(viaGroupsMap.values()).map((g) => g.viaName).filter(Boolean).join(', ') || 'VIP LIKE Queue';
      db.saveBuffLogs({
        id: 'log_' + task.id,
        createdAt: t.finishedAt,
        type: 'QUEUE',
        targetUrl: task.targetUrl,
        reactionType: task.reactionType || 'LIKE',
        engagementMode: task.enableComment ? 'BOTH' : 'LIKE_ONLY',
        accountName: displayAccountName,
        totalPages: pagesToBuff.length,
        targetLikes: task.targetLikes !== 'ALL' && typeof task.targetLikes === 'number' ? task.targetLikes : (desiredLikes || pagesToBuff.length),
        successCount: finalSuccess,
        alreadyLikedCount,
        failedCount: finalFailed,
        commentCount: 0,
        details: t.pageDetails || [],
      }).catch((e) => console.warn('[BuffQueue Worker] ⚠️ Error saving buff_logs from the queue:', e.message));
    }

    if (cancelled) {
      console.log(`[BuffQueue Worker] 🛑 Cancelled Task ${task.id} (${task.targetUrl}) after ${durationSec}s.`);
      return;
    }

    const history = loadBuffHistory();
    history[normUrl] = {
      url: task.targetUrl,
      normalizedUrl: normUrl,
      firstBuffedAt: history[normUrl]?.firstBuffedAt || new Date().toISOString(),
      lastBuffedAt: new Date().toISOString(),
      totalSuccess: (history[normUrl]?.totalSuccess || 0) + totalSuccess,
      reactionType: task.reactionType || 'RANDOM_POSITIVE',
      lastTaskId: task.id,
    };
    saveBuffHistory(history);

    let screenshotPath = null;
    try {
      const firstVia = viaGroupsMap.values().next()?.value;
      const shot = await fbBuffTool.capturePostScreenshot(task.targetUrl, {
        cookieStr: firstVia?.cookieString || null,
        proxyUrl: firstVia?.proxyUrl || null,
        timeoutMs: 25000,
      });
      if (shot && shot.success && shot.filePath) {
        screenshotPath = shot.filePath;
      }
    } catch (e) {
      console.warn('[ScreenshotProof] ⚠️ Ignoring queue post screenshot error:', e.message);
    }

    notifyBuffCompleted({
      targetUrl: task.targetUrl,
      success: totalSuccess,
      total: pagesToBuff.length,
      originalTarget: task.targetLikes !== 'ALL' && typeof task.targetLikes === 'number' ? task.targetLikes : pagesToBuff.length,
      autoRefilled: Math.max(0, (totalSuccess + totalFailed) - desiredLikes),
      failed: totalFailed,
      durationSec,
      reactionType: task.reactionType,
      screenshotPath,
    }).catch(() => {});

    console.log(`[BuffQueue Worker] ✅ Completed Task ${task.id}: ${totalSuccess}/${pagesToBuff.length} successful (${durationSec}s)`);

    consecutiveQueueFailures = 0;
    const stillBusy = loadBuffQueue().items.some(
      (it) => it.id !== task.id && (it.status === 'QUEUED' || it.status === 'RUNNING')
    );
    if (!stillBusy) notifyQueueIdle({ completedCount: queueCompletedSinceIdle + 1 }).catch(() => {});
    queueCompletedSinceIdle = stillBusy ? queueCompletedSinceIdle + 1 : 0;
  } catch (err) {
    console.error(`[BuffQueue Worker] ❌ Task ${task.id} error:`, err.message);
    const qd = loadBuffQueue();
    const t = qd.items.find((it) => it.id === task.id);
    if (t) {
      const attempts = (t.attempts || 0) + 1;
      t.attempts = attempts;
      t.finishedAt = new Date().toISOString();

      // Exponential Backoff & Dead-letter Queue (Phase 4 SaaS 3.0)
      if (attempts < 3) {
        t.status = 'QUEUED';
        const backoffSec = Math.pow(2, attempts) * 30; // 1st: 60s, 2nd: 120s
        t.runAfter = new Date(Date.now() + backoffSec * 1000).toISOString();
        t.error = `Retrying automatically (${attempts}/3) in ${backoffSec}s (Exponential Backoff): ${err.message}`;
        console.log(`[BuffQueue Worker] 🔄 Task ${task.id} scheduled for retry ${attempts}/3 in ${backoffSec}s.`);
      } else {
        t.status = 'DEAD_LETTER';
        t.error = `Failed after ${attempts} attempts (moved to DEAD_LETTER): ${err.message}`;
        console.warn(`[BuffQueue Worker] ☠️ Task ${task.id} moved to DEAD_LETTER.`);
      }
      saveBuffQueue(qd);

      // Save the error state to buff_logs so the user can check it right in History
      db.saveBuffLogs({
        id: 'log_' + task.id,
        createdAt: t.finishedAt,
        type: 'QUEUE',
        targetUrl: task.targetUrl,
        reactionType: task.reactionType || 'LIKE',
        engagementMode: task.enableComment ? 'BOTH' : 'LIKE_ONLY',
        accountName: 'VIP LIKE Queue (Error)',
        totalPages: typeof task.targetLikes === 'number' ? task.targetLikes : 30,
        targetLikes: typeof task.targetLikes === 'number' ? task.targetLikes : 30,
        successCount: Number(t.progress?.success || 0),
        alreadyLikedCount: 0,
        failedCount: Math.max(1, Number(t.progress?.failed || 1)),
        commentCount: 0,
        details: Array.isArray(t.pageDetails) && t.pageDetails.length > 0 ? t.pageDetails : [{
          pageName: 'Queue system',
          status: 'FAILED',
          error: err.message,
          time: new Date().toLocaleTimeString(),
        }],
      }).catch(() => {});
    }
    consecutiveQueueFailures += 1;
    if (consecutiveQueueFailures === 3) {
      notifyQueueTrouble({
        consecutiveFailures: consecutiveQueueFailures,
        lastError: err.message,
        lastUrl: task.targetUrl,
      }).catch(() => {});
    }
  } finally {
    activeBuffTaskIds.delete(task.id);
  }
}

// Count consecutive failed posts / posts finished since the queue was last empty (for Telegram notifications)
let consecutiveQueueFailures = 0;
let queueCompletedSinceIdle = 0;

async function runQueueWorker() {
  if (!store.isReady()) return;
  if (isEmergencyStopped()) return;
  const maxParallel = getMaxParallelBuff();
  if (activeBuffTaskIds.size >= maxParallel) return;

  const queueData = loadBuffQueue();
  const now = new Date();

  // Auto-Recovery of tasks stuck in RUNNING for over 15 minutes (due to a server restart/crash)
  for (const it of queueData.items || []) {
    if (it.status === 'RUNNING' && !activeBuffTaskIds.has(it.id)) {
      const runningDuration = it.startedAt ? (now.getTime() - new Date(it.startedAt).getTime()) : 9999999;
      if (runningDuration > 15 * 60 * 1000) {
        console.warn(`[BuffQueue Recovery] 🚑 Task ${it.id} stuck in RUNNING for over 15 minutes. Restoring to QUEUED automatically.`);
        it.status = 'QUEUED';
        it.runAfter = new Date().toISOString();
        it.error = 'Recovered automatically after a stuck run (Crash/Timeout Auto-Recovery)';
      }
    }
  }

  // Priority order: HIGH (3) > NORMAL (2) > LOW (1) combined with FIFO
  const priorityWeight = { HIGH: 3, NORMAL: 2, LOW: 1 };
  const availableSlots = maxParallel - activeBuffTaskIds.size;
  const hunterPaused = isPostHunterPaused();
  const tasksToRun = (queueData.items || [])
    .filter((it) => it.status === 'QUEUED' && new Date(it.runAfter || 0) <= now && !activeBuffTaskIds.has(it.id) && !(hunterPaused && isPostHunterTask(it)))
    .sort((a, b) => {
      const pA = priorityWeight[a.priority] || 2;
      const pB = priorityWeight[b.priority] || 2;
      if (pB !== pA) return pB - pA;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    })
    .slice(0, availableSlots);

  for (const task of tasksToRun) {
    executeQueueTask(task);
  }
}

// Run the queue check loop every 6 seconds
setInterval(runQueueWorker, 6000);

app.post('/api/buff-queue/clear-completed', async (req, res) => {
  try {
    await syncCompletedQueueTasksToBuffLogs().catch(() => {});
    const queueData = loadBuffQueue();
    const prevLen = queueData.items.length;
    queueData.items = queueData.items.filter((it) => it.status === 'QUEUED' || it.status === 'RUNNING');
    saveBuffQueue(queueData);
    await db.getPool().execute('DELETE FROM buff_queue WHERE status IN ("COMPLETED", "FAILED", "STOPPED", "CANCELLED")').catch(() => {});
    return res.json({ success: true, cleared: prevLen - queueData.items.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/clear-all', async (req, res) => {
  try {
    const queueData = loadBuffQueue();
    const prevLen = queueData.items.length;
    queueData.items = [];
    saveBuffQueue(queueData);
    await db.getPool().execute('DELETE FROM buff_queue').catch(() => {});
    return res.json({ success: true, cleared: prevLen });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// 6. API ROUTES - POST HUNTER (AUTO-HUNT NEW POSTS)
// =============================================================================

app.get('/api/buff-monitors', (req, res) => {
  try {
    const data = loadBuffMonitors();
    const queueData = loadBuffQueue();
    const history = loadBuffHistory();
    return res.json({
      success: true,
      // postLog/seenPostUrls are heavy and polled often: send only counts here, full log via /posts
      monitors: (data.monitors || []).map(({ postLog, seenPostUrls, ...m }) => ({
        ...m,
        postLogCount: Array.isArray(postLog) ? postLog.length : 0,
        skippedLimitCount: Array.isArray(postLog) ? postLog.filter((e) => e.status === 'SKIPPED_LIMIT').length : 0,
      })),
      postHunterPaused: isPostHunterPaused(),
      queueCount: (queueData.items || []).filter((it) => it.status === 'QUEUED').length,
      historyCount: Object.keys(history).length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-hunter/pause', requireAdmin, (req, res) => {
  try {
    const paused = Boolean(req.body?.paused);
    const pauseMonitors = req.body?.pauseMonitors !== false;
    const cancelPendingTasks = req.body?.cancelPendingTasks !== false;

    const updated = saveBuffSettings({ postHunterPaused: paused });
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Không lưu được trạng thái Săn bài' });
    }

    let pausedMonitors = 0;
    let cancelledTaskList = [];

    if (paused) {
      if (pauseMonitors) {
        const monData = loadBuffMonitors();
        for (const mon of monData.monitors || []) {
          if (mon.status === 'ACTIVE') {
            mon.status = 'PAUSED';
            pausedMonitors++;
          }
        }
        if (pausedMonitors > 0) saveBuffMonitors(monData);
      }
      if (cancelPendingTasks) {
        cancelledTaskList = cancelPendingPostHunterTasks('Cancelled because Post Hunter was paused');
      }
      console.log(`[PostHunter] ⏸️ Paused Post Hunter entirely (paused ${pausedMonitors} monitors, cancelled ${cancelledTaskList.length} tasks).`);
    } else {
      console.log('[PostHunter] ▶️ Post Hunter re-enabled.');
    }

    return res.json({
      success: true,
      postHunterPaused: paused,
      pausedMonitors,
      cancelledTasks: cancelledTaskList.length,
      cancelledTaskIds: cancelledTaskList,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-monitors', (req, res) => {
  try {
    const {
      id,
      targetName,
      targetUrl,
      targetType = 'PAGE',
      checkIntervalMinutes = 10,
      buffConfig = {},
      status = 'ACTIVE',
    } = req.body;

    if (!targetUrl || !String(targetUrl).trim()) {
      return res.status(400).json({ success: false, error: 'Thiếu link mục tiêu cần theo dõi' });
    }

    const data = loadBuffMonitors();
    let monitorId = id;

    if (monitorId) {
      const idx = data.monitors.findIndex((m) => m.id === monitorId);
      if (idx !== -1) {
        const urlChanged = String(targetUrl).trim() !== data.monitors[idx].targetUrl;
        data.monitors[idx] = {
          ...data.monitors[idx],
          ...(urlChanged ? { baselineDone: false, seenPostUrls: [], postLog: [] } : {}),
          targetName: targetName ? String(targetName).trim() : data.monitors[idx].targetName,
          targetUrl: String(targetUrl).trim(),
          expiresAt: req.body.expiresAt !== undefined ? req.body.expiresAt : data.monitors[idx].expiresAt,
          targetType,
          checkIntervalMinutes: parseInt(checkIntervalMinutes, 10) || 10,
          buffConfig: {
            ...data.monitors[idx].buffConfig,
            ...buffConfig,
          },
          status,
          updatedAt: new Date().toISOString(),
        };
        saveBuffMonitors(data);
        return res.json({ success: true, monitor: data.monitors[idx] });
      }
    }

    monitorId = `mon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newMon = {
      id: monitorId,
      targetName: targetName ? String(targetName).trim() : `Target ${data.monitors.length + 1}`,
      targetUrl: String(targetUrl).trim(),
      targetType,
      expiresAt: req.body.expiresAt || null,
      checkIntervalMinutes: parseInt(checkIntervalMinutes, 10) || 10,
      buffConfig: {
        targetLikes: parseTargetLikes(buffConfig.targetLikes, 'ALL'),
        variancePercent: parseInt(buffConfig.variancePercent, 10) || 0,
        maxPostsPerDay: parseInt(buffConfig.maxPostsPerDay, 10) || 5,
        enableDripFeed: Boolean(buffConfig.enableDripFeed),
        dripDurationMinutes: parseInt(buffConfig.dripDurationMinutes, 10) || 20,
        reactionType: buffConfig.reactionType || 'RANDOM_POSITIVE',
        enableLike: buffConfig.enableLike !== false,
        enableComment: Boolean(buffConfig.enableComment),
        enableShare: Boolean(buffConfig.enableShare),
        comments: Array.isArray(buffConfig.comments) ? buffConfig.comments : [],
        delayMinutes: parseDelayMinutes(buffConfig.delayMinutes),
        viaMode: buffConfig.viaMode || 'ALL_VIAS',
        cookieString: buffConfig.cookieString || '',
      },
      status: isPostHunterPaused() ? 'PAUSED' : 'ACTIVE',
      totalDetected: 0,
      lastCheckedAt: null,
      lastFoundPostUrl: null,
      createdAt: new Date().toISOString(),
    };

    data.monitors.unshift(newMon);
    saveBuffMonitors(data);
    return res.json({ success: true, monitor: newMon });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/buff-monitors/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = loadBuffMonitors();
    const prevLen = data.monitors.length;
    data.monitors = data.monitors.filter((m) => m.id !== id);
    saveBuffMonitors(data);
    return res.json({ success: true, deleted: data.monitors.length < prevLen });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-monitors/:id/toggle', (req, res) => {
  try {
    const { id } = req.params;
    const data = loadBuffMonitors();
    const mon = data.monitors.find((m) => m.id === id);
    if (!mon) return res.status(404).json({ success: false, error: 'Không tìm thấy monitor' });
    if (mon.status !== 'ACTIVE' && isPostHunterPaused()) {
      return res.status(400).json({
        success: false,
        error: 'Săn bài đang tạm dừng. Hãy bật lại Săn bài trước khi bật monitor.',
      });
    }
    mon.status = mon.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    saveBuffMonitors(data);
    return res.json({ success: true, monitor: mon });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-hunter/test-scan', async (req, res) => {
  try {
    const { targetUrl, cookieString = '' } = req.body;
    if (!targetUrl || !String(targetUrl).trim()) {
      return res.status(400).json({ success: false, error: 'Thiếu link để quét thử' });
    }

    let scanCookie = cookieString;
    let scanProxy = '';
    let scanViaName = null;
    if (!scanCookie) {
      const liveVias = await db.getLiveVias();
      if (liveVias.length > 0) {
        scanCookie = liveVias[0].cookieString;
        scanProxy = liveVias[0].proxyUrl || '';
        scanViaName = liveVias[0].viaName;
      }
    }

    const posts = await fbBuffTool.scanTargetForPosts(String(targetUrl).trim(), {
      cookieStr: scanCookie,
      proxyUrl: scanProxy,
      maxPosts: 8,
    });

    const history = loadBuffHistory();
    const queueData = loadBuffQueue();

    const annotatedPosts = (posts || []).map((p) => {
      const normUrl = p.normalizedUrl || normalizeFbPostUrl(p.url);
      return {
        ...p,
        isAlreadyBuffed: Boolean(history[normUrl]),
        isInQueue: queueData.items.some((it) => it.normalizedUrl === normUrl),
      };
    });

    return res.json({
      success: true,
      scanVia: scanViaName,
      total: annotatedPosts.length,
      posts: annotatedPosts,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Per-monitor log of scanned posts (newest first, capped) so the UI can show what was caught and why
const MONITOR_POST_LOG_LIMIT = 50;
function logMonitorPost(mon, post, status, extra = {}) {
  if (!Array.isArray(mon.postLog)) mon.postLog = [];
  const normUrl = post.normalizedUrl || normalizeFbPostUrl(post.url);
  const nowIso = new Date().toISOString();
  const idx = mon.postLog.findIndex((e) => e.normalizedUrl === normUrl);
  const prev = idx !== -1 ? mon.postLog.splice(idx, 1)[0] : null;
  mon.postLog.unshift({
    url: post.url,
    normalizedUrl: normUrl,
    title: String(post.title || prev?.title || '').split('\n')[0].slice(0, 200),
    firstSeenAt: prev?.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    status,
    taskId: extra.taskId || prev?.taskId || null,
    note: extra.note || null,
  });
  if (mon.postLog.length > MONITOR_POST_LOG_LIMIT) mon.postLog.length = MONITOR_POST_LOG_LIMIT;
}

// Scan the target and queue new posts
async function scanMonitorTarget(monitorId, options = {}) {
  const data = loadBuffMonitors();
  const mon = data.monitors.find((m) => m.id === monitorId);
  if (!mon) throw new Error('Không tìm thấy monitor');

  // 1. Check the VIP plan expiry date
  if (mon.expiresAt && new Date(mon.expiresAt).getTime() < Date.now()) {
    mon.status = 'PAUSED';
    mon.expiredReason = 'Gói VIP đã hết hạn';
    saveBuffMonitors(data);
    console.warn(`[PostHunter] ⏸️ Monitor ${mon.targetName} VIP plan expired (${mon.expiresAt}). Pausing automatically.`);
    return { postsFound: 0, newPostsEnqueued: 0, expired: true };
  }

  // 2. Check and reset the daily post limit (Daily Posts Limit)
  const todayDateKey = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (mon.dailyStatsDate !== todayDateKey) {
    mon.dailyStatsDate = todayDateKey;
    mon.dailyPostsCount = 0;
  }
  const maxDaily = parseInt(mon.buffConfig?.maxPostsPerDay, 10) || 5;

  const history = loadBuffHistory();

  let cookieStr = mon.buffConfig?.cookieString || '';
  let proxyUrl = '';
  let scanViaName = null;
  if (!cookieStr) {
    const liveVias = await db.getLiveVias();
    if (liveVias.length > 0) {
      cookieStr = liveVias[0].cookieString;
      proxyUrl = liveVias[0].proxyUrl || '';
      scanViaName = liveVias[0].viaName;
    }
  }

  let posts;
  try {
    posts = await fbBuffTool.scanTargetForPosts(mon.targetUrl, {
      cookieStr,
      proxyUrl,
      maxPosts: 8,
      browser: options.browser || null,
    });
  } catch (err) {
    // Remember why the scan failed so the UI can explain it (and don't hammer FB every 30s)
    mon.lastCheckedAt = new Date().toISOString();
    mon.lastScanError = err.message;
    mon.lastScanErrorCode = err.scanCode || 'SCAN_FAILED';
    if (scanViaName) mon.lastScanVia = scanViaName;
    saveBuffMonitors(data);
    throw err;
  }

  const postsFound = posts.length;
  mon.lastScanError = null;
  mon.lastScanErrorCode = null;
  mon.lastCheckedAt = new Date().toISOString();
  mon.lastPostsFound = postsFound;
  if (scanViaName) mon.lastScanVia = scanViaName;

  if (!Array.isArray(mon.seenPostUrls)) {
    mon.seenPostUrls = [];
  }

  if (!mon.baselineDone) {
    mon.baselineDone = true;
    mon.seenPostUrls = Array.from(new Set([...mon.seenPostUrls, ...posts.map((p) => p.normalizedUrl || normalizeFbPostUrl(p.url))]));
    for (const p of [...posts].reverse()) logMonitorPost(mon, p, 'BASELINE', { note: 'Existing post at first scan' });
    saveBuffMonitors(data);
    return {
      baseline: true,
      postsFound,
      newPostsEnqueued: 0,
      posts,
    };
  }

  const newPosts = [];
  for (const post of posts) {
    const normUrl = post.normalizedUrl || normalizeFbPostUrl(post.url);
    if (mon.seenPostUrls.includes(normUrl)) continue;
    if (post.isPinned) {
      // Old pinned post: remember it in seenPostUrls so it's never buffed by mistake
      mon.seenPostUrls.push(normUrl);
      logMonitorPost(mon, post, 'PINNED', { note: 'Pinned post, not buffed' });
      continue;
    }
    if (history[normUrl]) {
      mon.seenPostUrls.push(normUrl);
      logMonitorPost(mon, post, 'ALREADY_BUFFED', { taskId: history[normUrl].lastTaskId || null, note: 'Already buffed before' });
      continue;
    }
    newPosts.push(post);
  }

  let newPostsEnqueued = 0;
  let skippedByLimit = 0;
  for (const newPost of newPosts) {
    const normUrl = newPost.normalizedUrl || normalizeFbPostUrl(newPost.url);
    if ((mon.dailyPostsCount || 0) >= maxDaily) {
      // Do NOT mark as seen: it is retried on the next scan once the daily counter resets
      skippedByLimit++;
      logMonitorPost(mon, newPost, 'SKIPPED_LIMIT', { note: `Daily limit ${maxDaily} posts reached` });
      continue;
    }

    // Compute a naturally randomized like count (Random Likes Variance)
    let finalTargetLikes = mon.buffConfig?.targetLikes || 30;
    if (typeof finalTargetLikes === 'number' && mon.buffConfig?.variancePercent) {
      const vPct = Math.min(30, Math.max(5, parseInt(mon.buffConfig.variancePercent, 10)));
      const delta = Math.round(finalTargetLikes * (vPct / 100));
      const jitter = Math.floor(Math.random() * (delta * 2 + 1)) - delta;
      finalTargetLikes = Math.max(10, finalTargetLikes + jitter);
    }

    const queuePayload = {
      source: `POST_HUNTER:${mon.targetName || mon.id}`,
      monitorId: mon.id,
      monitorName: mon.targetName || null,
      targetUrl: newPost.url,
      targetLikes: finalTargetLikes,
      reactionType: mon.buffConfig?.reactionType || 'RANDOM_POSITIVE',
      enableLike: mon.buffConfig?.enableLike !== false,
      enableComment: Boolean(mon.buffConfig?.enableComment),
      enableShare: Boolean(mon.buffConfig?.enableShare),
      comments: mon.buffConfig?.comments || [],
      delayMinutes: mon.buffConfig?.delayMinutes ?? 3,
      speedMode: mon.buffConfig?.speedMode || 'SMART',
      dripFeedMode: Boolean(mon.buffConfig?.enableDripFeed),
      dripDurationMinutes: Number(mon.buffConfig?.dripDurationMinutes) || 20,
      cookieString: mon.buffConfig?.viaMode || 'ALL_VIAS',
    };

    const addRes = addBuffQueueTask(queuePayload);
    if (addRes.skipped) {
      mon.seenPostUrls.push(normUrl);
      logMonitorPost(mon, newPost, 'ALREADY_BUFFED', { note: 'Already buffed before' });
      continue;
    }
    if (!addRes.task) continue;

    mon.seenPostUrls.push(normUrl);
    if (addRes.alreadyQueued) {
      logMonitorPost(mon, newPost, 'QUEUED', { taskId: addRes.task.id, note: 'Already in the queue' });
      continue;
    }

    newPostsEnqueued++;
    mon.dailyPostsCount = (mon.dailyPostsCount || 0) + 1;
    mon.totalDetected = (mon.totalDetected || 0) + 1;
    mon.lastFoundPostUrl = newPost.url;
    logMonitorPost(mon, newPost, 'QUEUED', { taskId: addRes.task.id });

    notifyPostHunted({
      targetName: mon.targetName,
      targetUrl: mon.targetUrl,
      postUrl: newPost.url,
      delayMinutes: queuePayload.delayMinutes,
      targetLikes: queuePayload.targetLikes,
    }).catch(() => {});
  }
  if (skippedByLimit > 0) {
    console.log(`[PostHunter] ⚠️ Monitor ${mon.targetName} hit its limit of ${maxDaily} posts/day. ${skippedByLimit} new post(s) will be retried after the daily reset.`);
  }

  saveBuffMonitors(data);

  return {
    baseline: false,
    postsFound,
    newPostsEnqueued,
    skippedByLimit,
    posts,
  };
}

// =============================================================================
// POST SCANNER TAB (ported from TOOLZUTTER feed hunter): read posts of a Group/Fanpage/keyword
// with caption, posted time and engagement counts. Read-only, never engages.
// =============================================================================
const { huntFacebookFeed } = require('./fb-feed-hunter');

app.get('/api/post-scan/vias', async (req, res) => {
  try {
    const vias = await db.getLiveVias();
    return res.json({
      success: true,
      vias: vias.map((v) => ({
        id: v.id,
        name: v.viaName || 'Via',
        uid: (String(v.cookieString || '').match(/c_user=(\d+)/) || [])[1] || null,
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

let postScanRunning = false;
app.post('/api/post-scan', async (req, res) => {
  if (postScanRunning) {
    return res.status(429).json({ success: false, error: 'Đang có một lượt quét khác chạy, vui lòng đợi xong rồi quét tiếp.' });
  }
  try {
    const {
      targetUrl = '',
      keyword = '',
      limit = 20,
      dateFrom = null,
      dateTo = null,
      sortViral = false,
      minReactions = 0,
      viaId = null,
    } = req.body || {};
    if (!String(targetUrl).trim() && !String(keyword).trim()) {
      return res.status(400).json({ success: false, error: 'Nhập link Group/Fanpage hoặc từ khóa cần quét.' });
    }

    const vias = await db.getLiveVias();
    const via = (viaId && vias.find((v) => String(v.id) === String(viaId))) || vias[0];
    if (!via) {
      return res.status(400).json({
        success: false,
        error: 'Chưa có Via nào còn sống để quét. Vào "Via & Fanpage" thêm ít nhất 1 Via (Group kín thì Via phải là thành viên).',
      });
    }

    postScanRunning = true;
    const result = await huntFacebookFeed({
      groupUrl: String(targetUrl).trim(),
      keyword: String(keyword).trim(),
      limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
      cookieString: via.cookieString,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sortViral: Boolean(sortViral),
      minReactions: Math.max(0, parseInt(minReactions, 10) || 0),
    });

    const body = result.body || {};
    if (body.success && Array.isArray(body.items)) {
      const history = loadBuffHistory();
      const queueItems = loadBuffQueue().items || [];
      body.items = body.items.map((it) => {
        const normUrl = normalizeFbPostUrl(it.url);
        const hist = history[normUrl];
        const task = queueItems.find((q) => q.normalizedUrl === normUrl && (q.status === 'QUEUED' || q.status === 'RUNNING'));
        return {
          ...it,
          normalizedUrl: normUrl,
          buffedLikes: hist ? hist.totalSuccess || 0 : 0,
          isAlreadyBuffed: Boolean(hist),
          queueStatus: task ? task.status : null,
        };
      });
    }
    body.scanVia = via.viaName || null;
    return res.status(result.status || 200).json(body);
  } catch (err) {
    console.error('[PostScan] ❌', err.message);
    return res.status(500).json({ success: false, error: `Lỗi khi quét: ${err.message}` });
  } finally {
    postScanRunning = false;
  }
});

// API: scanned-post log of 1 monitor, merged with the live queue task and buff history
app.get('/api/buff-monitors/:id/posts', (req, res) => {
  try {
    const mon = (loadBuffMonitors().monitors || []).find((m) => m.id === req.params.id);
    if (!mon) return res.status(404).json({ success: false, error: 'Không tìm thấy monitor' });
    const queueItems = loadBuffQueue().items || [];
    const history = loadBuffHistory();
    const posts = (mon.postLog || []).map((entry) => {
      const task =
        (entry.taskId && queueItems.find((it) => it.id === entry.taskId)) ||
        queueItems.find((it) => it.normalizedUrl === entry.normalizedUrl && (it.status === 'QUEUED' || it.status === 'RUNNING')) ||
        null;
      const hist = history[entry.normalizedUrl] || null;
      return {
        ...entry,
        task: task
          ? {
              id: task.id,
              status: task.status,
              runAfter: task.runAfter || null,
              progress: task.progress || null,
              result: task.result || null,
              targetLikes: task.targetLikes,
              error: task.error || task.lastError || null,
            }
          : null,
        buffed: hist ? { totalSuccess: hist.totalSuccess || 0, lastBuffedAt: hist.lastBuffedAt || null } : null,
      };
    });
    return res.json({ success: true, monitorId: mon.id, posts });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: manually scan 1 monitor right now
app.post('/api/buff-monitors/:id/scan-now', async (req, res) => {
  try {
    if (isPostHunterPaused()) {
      return res.status(400).json({
        success: false,
        error: 'Săn bài đang tạm dừng. Hãy bật lại Săn bài trước khi quét.',
      });
    }
    const { id } = req.params;
    const result = await scanMonitorTarget(id);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error(`[PostHunter] ❌ Error scanning monitor ${req.params.id}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Post Hunter Background Scheduler (optimized: one shared Browser per scan batch to save 90% CPU & RAM)
let isHunterScanning = false;
async function runHunterScheduler() {
  if (!store.isReady()) return;
  if (isHunterScanning || isEmergencyStopped() || isPostHunterPaused()) return;
  const data = loadBuffMonitors();
  const activeMonitors = (data.monitors || []).filter((m) => m.status === 'ACTIVE');
  if (activeMonitors.length === 0) return;

  const now = Date.now();
  const dueMonitors = [];
  for (const mon of activeMonitors) {
    const intervalMs = Math.max(1, mon.checkIntervalMinutes || 10) * 60 * 1000;
    const lastChecked = mon.lastCheckedAt ? new Date(mon.lastCheckedAt).getTime() : 0;
    if (now - lastChecked >= intervalMs) {
      dueMonitors.push(mon);
    }
  }

  if (dueMonitors.length === 0) return;

  isHunterScanning = true;
  let sharedBrowser = null;
  try {
    const { chromium } = require('playwright');
    sharedBrowser = await chromium.launch({
      headless: true,
      args: fbBuffTool.OPTIMIZED_CHROMIUM_ARGS || [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-notifications',
        '--mute-audio',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--js-flags=--max-old-space-size=256',
        '--renderer-process-limit=4',
      ],
    }).catch(() => null);

    for (const mon of dueMonitors) {
      if (isEmergencyStopped()) break;
      try {
        console.log(`[PostHunter Scheduler] ⏰ Time to scan monitor: ${mon.targetName} (${mon.targetUrl})`);
        await scanMonitorTarget(mon.id, { browser: sharedBrowser });
      } catch (err) {
        console.warn(`[PostHunter Scheduler] ⚠️ Scan of monitor ${mon.targetName} failed:`, err.message);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    if (sharedBrowser) await sharedBrowser.close().catch(() => { });
    isHunterScanning = false;
  }
}

// Run the Hunter Scheduler check every 30 seconds
setInterval(runHunterScheduler, 30000);

// Auto Memory Guard: periodically free memory every 15 minutes
setInterval(() => {
  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  if (global.gc && (rssMB > 350 || heapMB > 200)) {
    try {
      global.gc();
      const afterMem = process.memoryUsage();
      console.log(`[MemoryGuard] 🧹 Auto-freed RAM: ${rssMB}MB -> ${Math.round(afterMem.rss / 1024 / 1024)}MB`);
    } catch (_) { }
  }
}, 15 * 60 * 1000);

// Quick health check for a Fanpage list (Public / Restricted / Live)
app.post('/api/buff-check-pages-health', async (req, res) => {
  try {
    const axios = require('axios');
    const { pageIds = [] } = req.body;
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return res.json({ success: true, results: {} });
    }
    const targetIds = pageIds.slice(0, 150);
    const results = {};

    await runWithConcurrency(targetIds, 8, async (id) => {
      try {
        const testUrl = `https://mbasic.facebook.com/${id}`;
        const resp = await axios.get(testUrl, {
          timeout: 6000,
          validateStatus: (s) => s < 500,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (resp.status === 404 || resp.data?.includes('Trang không tìm thấy') || resp.data?.includes('Page Not Found')) {
          results[id] = 'NOT_FOUND';
        } else if (resp.data?.includes('bị hạn chế') || resp.data?.includes('Restricted')) {
          results[id] = 'RESTRICTED';
        } else {
          results[id] = 'LIVE';
        }
      } catch (e) {
        results[id] = 'LIVE';
      }
    });

    return res.json({ success: true, results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Quick Cookie update for a Via from the alert (CookieAlertManager)
app.post('/api/buff-vias/quick-update-cookie', async (req, res) => {
  try {
    const { uid, cookieString, proxyUrl } = req.body;
    if (!cookieString || !String(cookieString).trim()) {
      return res.status(400).json({ success: false, error: 'Please provide the new Facebook Cookie string!' });
    }
    const norm = normalizeFbCookie(cookieString);
    if (!norm.valid) {
      return res.status(400).json({ success: false, error: 'Invalid Cookie: both c_user and xs are required.' });
    }
    const targetUid = uid || norm.uid;
    const result = await db.updateViaCookieByUid(targetUid, norm.cookie, proxyUrl);
    deadBuffVias.delete(targetUid);
    if (norm.uid) deadBuffVias.delete(norm.uid);
    return res.json({
      success: true,
      message: `Saved the new Cookie for Via UID ${targetUid}`,
      detectedUid: norm.uid,
      cookieString: norm.cookie,
      ...(result?.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Check the Via fleet's health and UPDATE MySQL Workbench DIRECTLY (social_accounts)
app.post('/api/buff-vias/health-check', async (req, res) => {
  try {
    const { cookieString, viaId } = req.body;
    let targetVias = [];

    if (cookieString) {
      const norm = normalizeFbCookie(cookieString);
      targetVias.push({
        id: viaId || 'custom',
        viaName: 'Test Via',
        cookieString: norm.valid ? norm.cookie : String(cookieString).trim(),
        proxyUrl: '',
      });
    } else {
      targetVias = await db.getLiveVias();
    }

    console.log(`[ViaHealth] 🩺 Starting health check of ${targetVias.length} Via accounts...`);
    const checkResults = [];

    for (const via of targetVias) {
      try {
        const status = await fbBuffTool.validateViaSession(via.cookieString, {
          proxyUrl: via.proxyUrl,
          timeoutMs: 18000,
        });

        if (typeof via.id === 'number') {
          const dbStatus = status.isLive ? 'OK' : status.status === 'CHECKPOINT' ? 'CHECKPOINT' : 'EXPIRED';
          await db.updateTokenStatus(via.id, dbStatus).catch(() => {});
        }

        if (!status.isLive) {
          notifyViaDead(
            {
              uid: via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString),
              viaName: via.viaName,
              proxyUrl: via.proxyUrl,
              tokenStatus: status.status,
            },
            status.error || 'Login session unavailable'
          ).catch(() => {});
        }

        checkResults.push({
          id: via.id,
          uid: via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString),
          viaName: via.viaName,
          proxyUrl: via.proxyUrl,
          isLive: status.isLive,
          status: status.status,
          name: status.name,
          error: status.error,
          checkedAt: new Date().toISOString(),
        });
      } catch (checkErr) {
        checkResults.push({
          id: via.id,
          uid: via.uid,
          viaName: via.viaName,
          isLive: false,
          status: 'ERROR',
          error: checkErr.message,
          checkedAt: new Date().toISOString(),
        });
      }
    }

    const liveCount = checkResults.filter((r) => r.isLive).length;
    return res.json({
      success: true,
      total: checkResults.length,
      liveCount,
      deadCount: checkResults.length - liveCount,
      vias: checkResults,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// PERIODIC CHECK FOR COOKIE-EXPIRED / CHECKPOINTED VIAS → UPDATE STATUS + TELEGRAM ALERT
// =============================================================================
const VIA_HEALTH_INTERVAL_MS = 30 * 60 * 1000;
const VIA_HEALTH_FIRST_RUN_MS = 3 * 60 * 1000;
let isViaHealthScanning = false;

async function runScheduledViaHealthCheck() {
  if (!store.isReady() || isViaHealthScanning) return;
  // Yield to running tasks so we don't compete for browser resources
  if (isHunterScanning || activeLiveBuffSession) return;
  try {
    if (loadBuffSettings().isEmergencyStopped) return;
    if (loadBuffQueue().items.some((it) => it.status === 'RUNNING')) return;
  } catch (e) {
    return;
  }

  isViaHealthScanning = true;
  try {
    // getLiveVias only returns Vias not yet marked as failing → each Via is alerted only once when it turns bad
    const vias = (await db.getLiveVias()).filter((v) => typeof v.id === 'number');
    if (vias.length === 0) return;
    console.log(`[ViaHealth] ⏱️ Periodic check of ${vias.length} Vias...`);

    for (const via of vias) {
      if (loadBuffSettings().isEmergencyStopped) break;
      try {
        const status = await fbBuffTool.validateViaSession(via.cookieString, {
          proxyUrl: via.proxyUrl,
          timeoutMs: 18000,
        });
        // Only treat it as an error when certain (expired / checkpoint); network errors or timeouts are ignored to avoid false alarms
        if (status.isLive || (status.status !== 'EXPIRED' && status.status !== 'CHECKPOINT')) continue;

        await db.updateTokenStatus(via.id, status.status).catch(() => {});
        notifyViaDead(
          {
            uid: via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString),
            viaName: via.viaName,
            proxyUrl: via.proxyUrl,
            tokenStatus: status.status,
          },
          status.status === 'CHECKPOINT' ? 'Facebook requires verification (checkpoint)' : 'Cookie expired or logged out'
        ).catch(() => {});
      } catch (err) {
        console.warn(`[ViaHealth] ⚠️ Skipping Via ${via.viaName || via.id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[ViaHealth] ⚠️ Periodic check failed: ${err.message}`);
  } finally {
    isViaHealthScanning = false;
  }
}

setTimeout(() => {
  runScheduledViaHealthCheck();
  setInterval(runScheduledViaHealthCheck, VIA_HEALTH_INTERVAL_MS);
}, VIA_HEALTH_FIRST_RUN_MS);

// =============================================================================
// TELEGRAM: DAILY REPORT + /status COMMAND
// =============================================================================
async function getViaCounts() {
  let total = 0;
  let dead = 0;
  try {
    const seen = new Set();
    for (const row of await db.getSocialAccounts()) {
      if (row.platform === 'FACEBOOK_GROUP' || !row.cookieString) continue;
      const m = row.cookieString.match(/(?:^|;\s*)c_user=([^;]+)/);
      if (!m || seen.has(m[1])) continue;
      seen.add(m[1]);
      total++;
      if (row.tokenStatus === 'EXPIRED' || row.tokenStatus === 'CHECKPOINT') dead++;
    }
  } catch (e) {
    return null;
  }
  return { total, dead, live: total - dead };
}

function summarizeQueueSince(sinceMs) {
  const items = loadBuffQueue().items || [];
  const finished = items.filter((it) => it.finishedAt && new Date(it.finishedAt).getTime() >= sinceMs);
  const done = finished.filter((it) => it.status === 'COMPLETED');
  return {
    completed: done.length,
    failed: finished.filter((it) => it.status === 'FAILED').length,
    success: done.reduce((a, it) => a + (it.result?.success || 0), 0),
    total: done.reduce((a, it) => a + (it.result?.total || 0), 0),
    totalSec: done.reduce((a, it) => a + (it.result?.durationSec || 0), 0),
    queued: items.filter((it) => it.status === 'QUEUED').length,
    running: items.filter((it) => it.status === 'RUNNING').length,
  };
}

async function buildStatusText() {
  const st = loadBuffSettings();
  const q = summarizeQueueSince(Date.now() - 24 * 3600 * 1000);
  const v = await getViaCounts();
  return [
    `📊 <b>[SYSTEM STATUS]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    st.isEmergencyStopped ? `⛔ <b>EMERGENCY STOP active</b> — send /resume to restore` : `🟢 Operating normally`,
    v ? `👤 Vias: ${v.live}/${v.total} active${v.dead ? ` · <b>${v.dead} need a Cookie update</b>` : ''}` : `👤 Vias: could not read data`,
    `📋 Queue: ${q.running} running · ${q.queued} waiting`,
    `📈 Last 24 hours: ${q.completed} posts done · ${q.failed} failed`,
  ].join('\n');
}

async function buildDailyReport() {
  const q = summarizeQueueSince(Date.now() - 24 * 3600 * 1000);
  const v = await getViaCounts();
  const rate = q.total > 0 ? Math.round((q.success / q.total) * 100) : 0;
  return [
    `🗓️ <b>[LAST 24 HOURS REPORT]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `✅ Posts completed: <b>${q.completed}</b>${q.failed ? ` · ❌ failed: <b>${q.failed}</b>` : ''}`,
    `❤️ Successful engagements: <b>${q.success}</b> / ${q.total}${q.total ? ` (${rate}%)` : ''}`,
    `⏱️ Total run time: ${formatDurationVi(q.totalSec)}`,
    v ? `👤 Vias: ${v.live}/${v.total} active${v.dead ? ` · <b>${v.dead} need a Cookie update</b>` : ''}` : '',
    `📋 Waiting in the queue: ${q.queued}`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function runDailyReportTick() {
  if (!store.isReady()) return;
  try {
    const st = loadBuffSettings();
    if (!st.dailyReportEnabled || !st.telegramBotToken || !st.telegramChatId) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (now.getHours() !== Number(st.dailyReportHour) || st.lastDailyReportDate === today) return;
    saveBuffSettings({ lastDailyReportDate: today }); // write first so it isn't resent if something fails midway
    await sendAlert(await buildDailyReport());
  } catch (err) {
    console.warn(`[DailyReport] ⚠️ ${err.message}`);
  }
}
setInterval(runDailyReportTick, 60 * 1000);

// Handle buff requests from Telegram ("Chat to Buff" & Callback Buttons)
async function handleBuffRequestedFromTelegram({
  targetUrl,
  targetLikes = 50,
  reactionType = 'LIKE',
  enableLike = true,
  enableShare = false,
  source = 'TELEGRAM',
  allowRebuff = false,
}) {
  const isShareOnly = enableShare && !enableLike;
  const actionLabel = isShareOnly
    ? `${targetLikes} Shares (Share Fanpage)`
    : enableShare
    ? `${targetLikes} Like + Share`
    : `${targetLikes} Like`;

  console.log(`[TelegramBot] 📥 Received a buff request from Telegram: ${targetUrl} | ${actionLabel} | ${reactionType} | Source: ${source}`);

  const normUrl = normalizeFbPostUrl(targetUrl);
  const queueResult = addBuffQueueTask({
    targetUrl,
    targetLikes,
    reactionType,
    enableLike,
    enableComment: false,
    enableShare,
    speedMode: 'SMART',
    delayMinutes: 0,
    source,
    allowRebuff,
  });

  if (queueResult.skipped) {
    const shortId = registerShortUrl(targetUrl);
    await sendTelegramMessage(
      `⚠️ <b>[POST ALREADY BUFFED]</b>\nThis post is already in the buff history, skipped to avoid duplicates.\n🔗 <a href="${targetUrl}">${targetUrl}</a>\n\n👉 <i>If you want to buff more from the remaining Pages, tap "Buff more" below:</i>`,
      'HTML',
      {
        inline_keyboard: [
          [
            { text: '🔁 Force buff 50 more Likes', callback_data: `rebuff:${shortId}:50` },
            { text: '🔁 Force buff 100 more Likes', callback_data: `rebuff:${shortId}:100` },
          ],
        ],
      }
    );
    return { success: false, reason: 'ALREADY_BUFFED' };
  }

  if (queueResult.alreadyQueued) {
    await sendTelegramMessage(
      `⏳ <b>[POST ALREADY IN THE QUEUE]</b>\nThe post is already in the queue and will be processed automatically soon:\n🔗 <a href="${targetUrl}">${targetUrl}</a>\n🎯 Target: ${queueResult.task?.targetLikes || targetLikes}`
    );
    return { success: true, alreadyQueued: true };
  }

  const shortId = registerShortUrl(targetUrl);
  const confirmMsg = [
    `📥 <b>[TELEGRAM ORDER RECEIVED]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔗 <b>Post:</b> <a href="${targetUrl}">${targetUrl}</a>`,
    `🎯 <b>Item:</b> <b>${actionLabel}</b>`,
    !isShareOnly ? `💖 <b>Reaction:</b> ${reactionType}` : `🚀 <b>Feature:</b> Share the post to the Fanpage wall`,
    `⚡ <b>Status:</b> Added to the Queue (runs as soon as its turn comes)`,
    `⏰ <b>Time:</b> ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🚀 <i>The Playwright bot is preparing the Pages to engage with the post...</i>`,
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🛑 Stop now', callback_data: 'stop' },
        { text: '📋 View queue', callback_data: 'status' },
      ],
      [
        { text: '📊 Available Pages', callback_data: 'check_pages' },
        { text: '🔁 100 more Likes', callback_data: `rebuff:${shortId}:100` },
      ],
    ],
  };

  await sendTelegramMessage(confirmMsg, 'HTML', replyMarkup);
  return { success: true, task: queueResult.task };
}

async function getPagesStatsForTelegram() {
  try {
    const pages = await db.getFacebookPageAccesses();
    const activePages = (pages || []).filter((p) => p.active);

    const viaMap = {};
    activePages.forEach((p) => {
      const vName = p.profile_name || p.personal_profile_id || 'Other Via';
      viaMap[vName] = (viaMap[vName] || 0) + 1;
    });

    const breakdown = Object.entries(viaMap)
      .map(([name, count]) => `• <b>${name}:</b> ${count} Fanpages`)
      .join('\n');

    return [
      `📊 <b>[ACTIVE FANPAGE STATS]</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `🟢 <b>Total Pages ready:</b> <b>${activePages.length}</b> Pages`,
      `━━━━━━━━━━━━━━━━━━`,
      `<b>Breakdown by Via:</b>`,
      breakdown || '• No breakdown yet',
      `━━━━━━━━━━━━━━━━━━`,
      `🛡️ <i>All of the Pages above are healthy and ready for buff commands!</i>`,
    ].join('\n');
  } catch (err) {
    return `⚠️ Could not get page stats: ${err.message}`;
  }
}

// Detailed report of the posts in the queue
async function buildQueueText() {
  const q = loadBuffQueue();
  const items = q.items || [];
  const queued = items.filter((it) => it.status === 'QUEUED');
  const running = items.find((it) => it.status === 'RUNNING');

  const lines = [
    `📋 <b>[QUEUE DETAILS]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
  ];

  if (running) {
    const prog = running.progress || {};
    const percent = prog.total > 0 ? Math.round(((prog.done || 0) / prog.total) * 100) : 0;
    lines.push(`⚡ <b>Running:</b>`);
    lines.push(`• Link: <a href="${running.targetUrl}">${running.targetUrl}</a>`);
    lines.push(`• Progress: <b>${prog.success || 0}/${prog.total || running.targetLikes}</b> likes (${percent}%)`);
    lines.push(`• Reaction: ${running.reactionType}`);
    lines.push(`━━━━━━━━━━━━━━━━━━`);
  } else {
    lines.push(`🟢 <i>No order is running right now. The system is ready!</i>`);
    lines.push(`━━━━━━━━━━━━━━━━━━`);
  }

  if (queued.length > 0) {
    lines.push(`⏳ <b>Waiting in line (${queued.length} posts):</b>`);
    queued.slice(0, 5).forEach((it, idx) => {
      lines.push(`${idx + 1}. <a href="${it.targetUrl}">${it.targetUrl.slice(0, 42)}...</a> (${it.targetLikes} like - ${it.reactionType})`);
    });
    if (queued.length > 5) {
      lines.push(`<i>... and ${queued.length - 5} more posts in the queue.</i>`);
    }
  } else {
    lines.push(`⏳ The queue is empty (0 posts waiting).`);
  }

  return lines.join('\n');
}

// Automatically clean up old debug / proof screenshots (> 3 days) so the disk doesn't fill up
function cleanOldScreenshots(maxAgeDays = 3) {
  try {
    const dirs = [
      path.join(DATA_DIR, 'screenshots'),
      path.join(DATA_DIR, 'debug_screens'),
    ];
    const maxAgeMs = maxAgeDays * 24 * 3600 * 1000;
    let cleaned = 0;

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.png') && !file.endsWith('.jpg')) continue;
        const fp = path.join(dir, file);
        try {
          const stats = fs.statSync(fp);
          if (Date.now() - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(fp);
            cleaned++;
          }
        } catch (_) {}
      }
    }
    if (cleaned > 0) {
      console.log(`[StorageCleaner] 🧹 Cleaned up ${cleaned} old debug/proof screenshots (> ${maxAgeDays} days)`);
    }
  } catch (err) {
    console.warn('[StorageCleaner] ⚠️ Error cleaning up old screenshots:', err.message);
  }
}
cleanOldScreenshots(3);
setInterval(() => cleanOldScreenshots(3), 6 * 3600 * 1000);

// Handle /status /queue /pages /stop /resume commands and two-way control from Telegram
startCommandListener({
  getStatusText: buildStatusText,
  onBuffRequested: handleBuffRequestedFromTelegram,
  getPagesStats: getPagesStatsForTelegram,
  getQueueText: buildQueueText,
});

// Get the built-in Seeding Comment script library (Smart Seeding Presets)
app.get('/api/buff-seeding-presets', (req, res) => {
  return res.json({
    success: true,
    presets: fbBuffTool.SEEDING_PRESETS || [],
  });
});

// Get IDs of Fanpages that already liked/engaged with the target post (instant dedupe, including /share/ aliases)
app.get('/api/buff-post-interacted-pages', async (req, res) => {
  if (!(await checkLicenseOrReject(req, res))) return;
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.json({ success: true, count: 0, interactedPageIds: [] });
  }
  const normUrl = normalizeFbPostUrl(targetUrl);
  const canonicalUrl = await resolvePostUrlCanonical(targetUrl).catch(() => normUrl);
  const interactedSet = getPostInteractedPageIds(normUrl);
  const interactedPageIds = Array.from(interactedSet);
  return res.json({
    success: true,
    normalizedUrl: normUrl,
    canonicalUrl,
    count: interactedPageIds.length,
    interactedPageIds,
  });
});

// Get the daily overview report data (for the Post Hunter & VIP Like page)
app.get('/api/buff-daily-report', async (req, res) => {
  try {
    const q = summarizeQueueSince(Date.now() - 24 * 3600 * 1000);
    const v = await getViaCounts();
    const rate = q.total > 0 ? Math.round((q.success / q.total) * 100) : 0;
    const history = loadBuffHistory();
    const historyList = Object.values(history);
    const today24h = historyList.filter(
      (h) => h.lastBuffedAt && Date.now() - new Date(h.lastBuffedAt).getTime() < 24 * 3600 * 1000
    );
    return res.json({
      success: true,
      report: {
        completedPosts: q.completed,
        failedPosts: q.failed,
        totalLikesSuccess: q.success,
        totalLikesTarget: q.total,
        successRate: rate,
        runningTimeSec: q.totalSec,
        queuedCount: q.queued,
        liveVias: v?.live || 0,
        totalVias: v?.total || 0,
        todayHistoryCount: today24h.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Button to send the 24h summary report to Telegram
app.post('/api/buff-daily-report/send', async (req, res) => {
  try {
    const reportText = await buildDailyReport();
    const result = await sendAlert(reportText, { critical: true });
    return res.json({ success: true, message: 'Daily summary report sent to Telegram!', result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// System health overview (queries MySQL Workbench directly)
// Real 7-day success rate per Via (from buff history), cached for 5 minutes because the overview is called every 15 seconds
let viaSuccessRateCache = { at: 0, byVia: {} };
async function getViaSuccessRates() {
  if (Date.now() - viaSuccessRateCache.at < 5 * 60 * 1000) return viaSuccessRateCache.byVia;
  const byVia = {};
  try {
    const [rows] = await db.getPool().query(
      "SELECT details FROM buff_logs WHERE created_at > NOW() - INTERVAL 7 DAY AND account_name <> 'Via Facebook'"
    );
    for (const r of rows) {
      let details = [];
      try { details = typeof r.details === 'string' ? JSON.parse(r.details) : (r.details || []); } catch (_) {}
      for (const d of details) {
        if (!d || !d.viaName) continue;
        if (['WAITING', 'RUNNING', 'SKIPPED', 'ALREADY_LIKED'].includes(d.status)) continue; // only count turns that were actually attempted
        const e = byVia[d.viaName] || (byVia[d.viaName] = { tried: 0, success: 0 });
        e.tried++;
        if (d.status === 'SUCCESS') e.success++;
      }
    }
  } catch (e) {
    console.warn('[BuffOverview] ⚠️ Could not compute the success rate per Via:', e.message);
  }
  viaSuccessRateCache = { at: Date.now(), byVia };
  return byVia;
}

app.get('/api/buff-vias/overview', async (req, res) => {
  try {
    let totalVias = 0;
    let liveVias = 0;
    let viaRows = [];

    try {
      const allAccounts = await db.getSocialAccounts();
      const seenCUsers = new Set();
      for (const row of allAccounts) {
        // Skip Groups and rows without a cookie
        if (row.platform === 'FACEBOOK_GROUP') continue;
        if (!row.cookieString || !row.cookieString.includes('c_user=')) continue;
        const m = row.cookieString.match(/(?:^|;\s*)c_user=([^;]+)/);
        if (!m) continue;
        const uid = m[1];
        if (!seenCUsers.has(uid)) {
          seenCUsers.add(uid);
          const isLive = row.tokenStatus !== 'EXPIRED' && row.tokenStatus !== 'CHECKPOINT';
          if (isLive) liveVias++;
          totalVias++;
          viaRows.push({
            id: row.id,
            uid,
            viaName: row.pageName,
            tokenStatus: row.tokenStatus || 'OK',
            proxyUrl: row.proxyUrl || '',
            lastCheckedAt: row.tokenCheckedAt,
          });
        }
      }
    } catch (dbErr) {
      console.warn(`[BuffOverview] DB warning: ${dbErr.message}`);
    }

    const pagesCache = fbBuffTool.loadPagesCache();
    let totalCachedPages = 0;
    for (const uid in pagesCache) {
      if (Array.isArray(pagesCache[uid]?.pages)) {
        totalCachedPages += pagesCache[uid].pages.length;
      }
    }
    // Capacity per Via: usable Pages (quarantined Pages already removed from the list) / quarantined / verified,
    // plus the real 7-day success rate to estimate actual likes (the Page list can be bigger than the real capacity)
    const successRates = await getViaSuccessRates();
    viaRows = viaRows.map((v) => {
      const entry = pagesCache[v.uid] || {};
      const pages = Array.isArray(entry.pages) ? entry.pages : [];
      const displayName = entry.viaName || v.viaName;
      const rate = successRates[displayName];
      return {
        ...v,
        displayName,
        usablePages: pages.length,
        verifiedPages: pages.filter((p) => p && p.verified).length,
        quarantinedPages: Object.keys(entry.quarantined || {}).length,
        recentTried: rate?.tried || 0,
        recentSuccess: rate?.success || 0,
      };
    });

    const queueData = loadBuffQueue();
    const history = loadBuffHistory();
    const monitorsData = loadBuffMonitors();
    const registryStats = getGlobalRegistryStats();
    const sysSettings = loadBuffSettings();

    return res.json({
      success: true,
      bmHealth: {
        totalVias,
        liveVias,
        deadVias: totalVias - liveVias,
        vias: viaRows,
        totalCachedPages,
        safeDailyCapacity: liveVias * 200,
        dailyGovernorLimitPerPage: sysSettings.maxDailyPageActions || 25,
      },
      stats: {
        queueCount: (queueData.items || []).filter((it) => it.status === 'QUEUED').length,
        runningCount: (queueData.items || []).filter((it) => it.status === 'RUNNING').length,
        historyCount: Object.keys(history).length,
        monitorsCount: (monitorsData.monitors || []).length,
        activeMonitorsCount: (monitorsData.monitors || []).filter((m) => m.status === 'ACTIVE').length,
      },
      antiOverlap: registryStats,
      system: {
        isEmergencyStopped: isEmergencyStopped(),
        emergencyReason: sysSettings.emergencyReason || '',
        emergencyStoppedAt: sysSettings.emergencyStoppedAt || null,
        postHunterPaused: isPostHunterPaused(),
        autoBuffOwnPosts: Boolean(sysSettings.autoBuffOwnPosts),
        maxPagesPerPost: Number(sysSettings.maxPagesPerPost) || 60,
        telegramConfigured: Boolean(sysSettings.telegramBotToken && sysSettings.telegramChatId),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// 8. API ROUTES - SYSTEM SETTINGS & EMERGENCY STOP
// =============================================================================

let cachedTelegramBotInfo = null;
let lastBotTokenChecked = '';

async function getTelegramBotInfo(token) {
  if (!token) return null;
  if (cachedTelegramBotInfo && lastBotTokenChecked === token) return cachedTelegramBotInfo;
  try {
    const axios = require('axios');
    const resp = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 4000 });
    if (resp.data?.ok) {
      cachedTelegramBotInfo = {
        id: resp.data.result.id,
        firstName: resp.data.result.first_name,
        username: resp.data.result.username,
      };
      lastBotTokenChecked = token;
      return cachedTelegramBotInfo;
    }
  } catch {}
  return null;
}

// The real token is only returned to ADMIN (to show/edit in the UI); other accounts only see the masked version
function publicBuffSettings(s) {
  const maskedToken = s.telegramBotToken
    ? `${s.telegramBotToken.slice(0, 6)}...${s.telegramBotToken.slice(-4)}`
    : '';
  return {
    ...s,
    telegramBotToken: s.telegramBotToken || '',
    telegramBotTokenMasked: maskedToken,
    hasBotToken: Boolean(s.telegramBotToken),
  };
}

app.get('/api/buff-settings', async (req, res) => {
  try {
    const raw = loadBuffSettings();
    const botInfo = await getTelegramBotInfo(raw.telegramBotToken);
    return res.json({
      success: true,
      settings: {
        ...publicBuffSettings(raw),
        botInfo,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-settings', requireAdmin, async (req, res) => {
  try {
    const updated = saveBuffSettings(req.body);
    if (!updated) return res.status(500).json({ success: false, error: 'Could not save the settings file' });
    const botInfo = await getTelegramBotInfo(updated.telegramBotToken);
    try {
      const db = require('./db');
      await db.syncTelegramSettingsToDb({ ...updated, botInfo });
    } catch {}
    return res.json({ success: true, settings: { ...publicBuffSettings(updated), botInfo } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Get the Telegram notification history stored in MySQL
app.get('/api/telegram/history', async (req, res) => {
  try {
    const db = require('./db');
    const limit = parseInt(req.query.limit || '50', 10);
    const notifications = await db.getTelegramNotifications(limit);
    return res.json({ success: true, notifications });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Fire test scenarios so the user can see how Telegram helps
app.post('/api/telegram/test-scenario', async (req, res) => {
  try {
    const { scenario = 'TEST' } = req.body;
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    let text = '';

    if (scenario === 'BUFF_COMPLETED') {
      text = [
        `🎉 <b>[SIMULATION: BUFF CAMPAIGN COMPLETE]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `🔗 <b>Post:</b> <a href="https://facebook.com/groups/947583488284655/posts/1174580982251570">VIP Facebook Group 947583488...</a>`,
        `❤️ <b>Reaction type:</b> LIKE & LOVE`,
        `✅ <b>Success:</b> <b>26 / 26</b> Pages (100%)`,
        `❌ <b>Failed:</b> 0`,
        `⏱️ <b>Processing time:</b> 42s (2 parallel threads)`,
        `⏰ <b>Completed at:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `✨ <i>Campaign completed brilliantly, every Page is safe!</i>`,
      ].join('\n');
    } else if (scenario === 'VIA_DEAD') {
      text = [
        `⚠️ <b>[SIMULATION: VIA DIE / CHECKPOINT ALERT]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `🚨 <b>Via account needs attention now:</b>`,
        `👤 <b>Via name:</b> (4) Facebook`,
        `🆔 <b>UID:</b> <code>100009194846268</code>`,
        `❌ <b>Status:</b> Cookie expired / Verification required`,
        `⏰ <b>Detected at:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `🛡️ <i>The system quarantined this Via automatically so its child Pages don't get locked!</i>`,
      ].join('\n');
    } else if (scenario === 'EMERGENCY_STOP') {
      text = [
        `🛑 <b>[SIMULATION: EMERGENCY STOP ALERT]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `👤 <b>Triggered by:</b> Administrator (Admin)`,
        `⚠️ <b>Reason:</b> Routine system safety check`,
        `⏰ <b>Time:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `⛔ <i>Every Playwright browser and the Queue were shut down immediately!</i>`,
      ].join('\n');
    } else if (scenario === 'ACTION_BLOCKED') {
      text = [
        `🚨 <b>[SIMULATION: VIA PROTECTION ALERT - ACTION BLOCKED]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `👤 <b>Via:</b> Thành An (<code>100023403136194</code>)`,
        `🔗 <b>Post:</b> <a href="https://facebook.com/share/p/19XPWpxegi/">facebook.com/share/p/19XPWpxegi/</a>`,
        `⚠️ <b>Facebook said:</b> "You're temporarily blocked for going too fast"`,
        `🛡️ <b>Automatic action:</b> The system AUTO-STOPPED to protect the Via from a checkpoint!`,
        `💡 <b>Recommendation:</b> Rest 30-45 minutes before buffing this post again, or buff another post / switch to Via 2 as usual.`,
        `⏰ <b>Time:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `✨ <i>Smart Adaptive Pacing is active to protect all 506 child Fanpages.</i>`,
      ].join('\n');
    } else if (scenario === 'HUNTER') {
      text = [
        `🎯 <b>[SIMULATION: NEW POST CAUGHT]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `📢 <b>Monitored source:</b> Fanpage "VIP LIKE OFFICIAL"`,
        `🔗 <b>New post:</b> <a href="https://facebook.com/viplike/posts/123456789">facebook.com/viplike/posts/123456789</a>`,
        `⏳ <b>Plan:</b> Auto-buff 50 Likes in 3 minutes`,
        `⏰ <b>Detected at:</b> ${now}`,
      ].join('\n');
    } else {
      text = [
        `🤖 <b>[TEST SUCCESSFUL: VIP LIKE OPS BOT]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `✅ Telegram Bot connection is 100% clear!`,
        `⏰ Time: ${now}`,
        `🛡️ <i>Data is stored and controlled directly in the MySQL Database!</i>`,
      ].join('\n');
    }

    const result = await sendTelegramMessage(text, 'HTML');
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.reason || 'Could not send the message' });
    }
    return res.json({ success: true, message: 'Simulation sent to Telegram and saved to the Database!', result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-settings/test-telegram', async (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const customMsg = [
      `🤖 <b>[TEST SUCCESSFUL: VIP LIKE OPS BOT]</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `✅ Telegram Bot connection is 100% clear!`,
      `⏰ Time: ${now}`,
      `🛡️ <i>Via & Fanpage monitoring and protection is ready 24/7!</i>`,
    ].join('\n');

    let result;
    if (botToken && chatId) {
      const axios = require('axios');
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const resp = await axios.post(
        url,
        { chat_id: chatId, text: customMsg, parse_mode: 'HTML' },
        { timeout: 8000 }
      );
      const msgId = resp.data?.result?.message_id || null;
      try {
        const db = require('./db');
        await db.saveTelegramNotification({
          chatId,
          eventType: 'TEST',
          title: 'TEST SUCCESSFUL: VIP LIKE OPS BOT',
          message: customMsg.replace(/<[^>]*>/g, ''),
          status: 'SENT',
          telegramMessageId: msgId,
        });
      } catch {}
      result = { success: true, data: resp.data };
    } else {
      result = await sendTelegramMessage(customMsg);
    }

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.reason || 'Send failed' });
    }
    return res.json({ success: true, message: 'Test message sent to Telegram!' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/emergency-stop', (req, res) => {
  try {
    const { reason = 'An administrator triggered EMERGENCY STOP' } = req.body;
    setEmergencyStop(true, reason);
    return res.json({ success: true, isEmergencyStopped: true, reason });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/resume', (req, res) => {
  try {
    setEmergencyStop(false);
    return res.json({ success: true, isEmergencyStopped: false, message: 'Operations restored successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/buff-registry/stats', (req, res) => {
  try {
    const stats = getGlobalRegistryStats();
    return res.json({ success: true, ...stats });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-registry/clear-post', (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url' });
    const normUrl = normalizeFbPostUrl(url);
    const cleared = clearPostInteractions(normUrl);
    return res.json({ success: true, cleared, normalizedUrl: normUrl });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// LICENSE & SOFTWARE RENTAL MANAGEMENT API (TAURI / SAAS LICENSING)
// =============================================================================

// 1. Check the current license status
// Only returns a license bound to the requesting machine's HWID (x-hardware-hwid header)
function maskLicenseKey(key) {
  const s = String(key || '');
  return s.length <= 4 ? s : '*'.repeat(s.length - 4) + s.slice(-4);
}

app.get('/api/license/status', async (req, res) => {
  try {
    const hardwareHwid = String(req.headers['x-hardware-hwid'] || '').trim();
    const active = await db.verifyLicenseActive(hardwareHwid || null);
    if (!active || (active.hardwareHwid && hardwareHwid && active.hardwareHwid !== hardwareHwid)) {
      return res.json({
        success: true,
        activated: false,
        message: 'No license activated or the rental has expired',
      });
    }

    const now = new Date();
    const expire = new Date(active.expiresAt);
    const daysRemaining = Math.max(0, Math.ceil((expire.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const isExpired = expire < now;

    return res.json({
      success: true,
      activated: !isExpired,
      license: {
        licenseKey: maskLicenseKey(active.licenseKey),
        customerName: active.customerName,
        packageType: active.packageType,
        maxVias: active.maxVias,
        expiresAt: active.expiresAt,
        daysRemaining,
        isExpired,
        status: isExpired ? 'EXPIRED' : active.status,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Activate a new License key on a client machine
app.post('/api/license/activate', async (req, res) => {
  try {
    const { licenseKey, hardwareHwid } = req.body;
    if (!licenseKey) {
      return res.status(400).json({ success: false, error: 'Please provide a License Key' });
    }
    const result = await db.activateLicense({ licenseKey: licenseKey.trim(), hardwareHwid });
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Admin: list every renter
app.get('/api/license/admin/list', requireAdmin, async (req, res) => {
  try {
    const licenses = await db.getLicenses();
    return res.json({ success: true, licenses });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Admin: create a new rental key for a partner/customer
app.post('/api/license/admin/create', requireAdmin, async (req, res) => {
  try {
    const { customerName, customerContact, packageType, maxVias, days, notes } = req.body;
    if (!customerName) {
      return res.status(400).json({ success: false, error: 'The renter name is required' });
    }
    const newLicense = await db.createLicense({
      customerName,
      customerContact,
      packageType,
      maxVias: Number(maxVias) || 50,
      days: Number(days) || 30,
      notes,
    });
    return res.json({ success: true, license: newLicense });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Admin: update status or extend (+30 days)
app.post('/api/license/admin/update-status', requireAdmin, async (req, res) => {
  try {
    const { id, status, addDays } = req.body;
    const result = await db.updateLicenseStatus(id, status, Number(addDays) || 0);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Start the server

// Load data from MySQL (or migrate old JSON to MySQL the first time) before accepting requests
store
  .init(db)
  .then(async (r) => {
    console.log(
      r.dbOk
        ? `[StateStore] ✅ Loaded data from MySQL${r.pendingSync.length ? ` (pending sync: ${r.pendingSync.join(', ')})` : ''}.`
        : '[StateStore] ⚠️ MySQL unavailable, running on the backup JSON files; will resync automatically once MySQL is back.'
    );
    // Initialize the durable Fencing Token Epoch from MySQL
    await initFenceEpoch();
    // Automatically check and recover tasks stuck in RUNNING once the MySQL data is fully loaded into memory!
    recoverStaleRunningQueueTasks();
    // Background-sync old /share/ links in the dedupe registry to the original post URL to detect duplicates across share links
    backfillShareAliases().catch((err) => console.warn('[PagePostRegistry] ⚠️ Alias backfill error:', err.message));
  })
  .catch((err) => console.error('[StateStore] ❌ Initialization error:', err.message));

// Server shutdown: flush pending data and release locks
let isShuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Server] 🛑 Received signal ${sig}. Releasing lane locks and flushing data...`);
    try {
      busyBuffLanes.clear();
      buffLaneWaiters.length = 0;
      await Promise.race([store.flush(), new Promise((r) => setTimeout(r, 4000))]);
    } catch (_) {}
    process.exit(0);
  });
}

// Desktop app: the Tauri shell holds our stdin open. When the app quits (or crashes) the pipe closes,
// so shut down cleanly instead of staying behind as an orphan holding port 3100.
if (process.env.VIPLIKE_PARENT_PIPE === '1') {
  process.stdin.on('end', () => process.emit('SIGTERM'));
  process.stdin.on('error', () => process.emit('SIGTERM'));
  process.stdin.resume();
}

async function autoSeedPagesIfEmpty() {
  try {
    const pool = db.getPool();
    if (!pool) return;
    const [rows] = await pool.query('SELECT COUNT(*) as cnt FROM facebook_page_accesses').catch(() => [[]]);
    if (rows && rows[0]?.cnt > 0) return;

    const seedFile = process.env.VIPLIKE_SEED_FILE || path.join(__dirname, '../frontend/src/config/seedViasAndPages.json');
    if (!fs.existsSync(seedFile)) return;
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    console.log(`[Seed] 📦 Starting to auto-load ${seed.totalCount} sample Fanpages into MySQL...`);

    for (const v of seed.vias || []) {
      await pool.query(
        `INSERT IGNORE INTO social_accounts (id, user_id, platform, platform_account_id, page_name, account_type, token_status)
         VALUES (?, 1, ?, ?, ?, ?, ?)`,
        [v.id, v.platform, v.platformAccountId, v.pageName, v.accountType, v.tokenStatus || 'OK']
      ).catch(() => {});
    }

    for (const [uid, pages] of Object.entries(seed.pagesByUid || {})) {
      for (const p of pages) {
        await pool.query(
          `INSERT IGNORE INTO facebook_page_accesses (page_id, page_name, page_url, personal_profile_id, profile_name, active, verification_status, user_id)
           VALUES (?, ?, ?, ?, ?, 1, 'VERIFIED', 1)`,
          [p.id, p.name, p.url, p.personalProfileId, p.profileName]
        ).catch(() => {});
      }
    }
    console.log(`[Seed] ✅ Loaded ${seed.totalCount} sample Fanpages into MySQL!`);
  } catch (err) {
    console.warn(`[Seed] ⚠️ Could not auto-load seed pages: ${err.message}`);
  }
}

app.listen(PORT, async () => {
  console.log(`\n================================================================`);
  console.log(`✨ VIP LIKE BACKEND RUNNING AT http://localhost:${PORT}`);
  console.log(`================================================================`);

  // Check the MySQL Workbench connection right at startup
  const dbStatus = await db.testConnection();
  if (dbStatus.connected) {
    if (db.DB_DRIVER === 'sqlite') console.log(`✅ Using embedded SQLite database (${db.SQLITE_FILE})`);
    else console.log(`✅ Connected to MySQL Workbench (Database: ${db.dbConfig.database}) SUCCESSFULLY!`);
    // Auto-load the 508 seed Fanpages if the facebook_page_accesses table is empty
    autoSeedPagesIfEmpty().catch(() => {});
    // Auto-sync completed Queue campaigns into the engagement History
    syncCompletedQueueTasksToBuffLogs().catch(() => {});
  } else {
    console.warn(`⚠️ MySQL Workbench not connected: ${dbStatus.error}`);
    console.warn(`👉 Check the MySQL Server (Port 3306) or the settings in the .env file`);
  }

  // Automatically check and recover tasks stuck in RUNNING after a server restart
  recoverStaleRunningQueueTasks();
});
