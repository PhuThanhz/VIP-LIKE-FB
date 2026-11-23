/**
 * VIPLIKE RADIANT - BACKEND SERVER
 * Tích hợp trực tiếp với MySQL Workbench (viplike_radiant), Playwright Automation & Gemini AI
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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

// Trong vài giây đầu, dữ liệu đang được nạp từ MySQL: chặn request để không đọc/ghi lệch dữ liệu
app.use((req, res, next) => {
  if (req.method === 'OPTIONS' || store.isReady()) return next();
  return res.status(503).json({ success: false, error: 'Hệ thống đang khởi động, vui lòng thử lại sau vài giây.' });
});

// Đảm bảo thư mục lưu trữ dữ liệu tồn tại
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// =============================================================================
// 1. DATA HELPERS (QUEUE, HISTORY, MONITORS)
//    Lưu qua state-store: MySQL (bảng app_state) là nguồn chính, file JSON trong data/ là bản dự phòng.
// =============================================================================

function loadBuffQueue() {
  const data = store.read('buff_queue');
  if (data && Array.isArray(data.items)) return data;
  console.warn('[BuffQueue] ⚠️ Dữ liệu hàng đợi sai định dạng, khởi tạo lại.');
  return store.write('buff_queue', { items: [] });
}

function saveBuffQueue(queueData) {
  store.write('buff_queue', queueData);
  syncBuffQueueToMysql(queueData).catch(() => {});
}

// Dấu vân tay từng mục hàng đợi đã ghi vào MySQL (id → các trường được đồng bộ).
// saveBuffQueue được gọi rất thường xuyên (cả khi worker đang chạy) → chỉ ghi mục thực sự thay đổi.
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

// Tập hợp taskId bị yêu cầu hủy chủ động (ví dụ: tắt tính năng Săn bài tự động)
const cancelledTaskIds = new Set();

function isPostHunterTask(task) {
  const src = String(task?.source || '');
  return src.startsWith('POST_HUNTER') || src === 'AUTO_OWN_POST';
}

function isPostHunterPaused() {
  return Boolean(loadBuffSettings().postHunterPaused);
}

/** Hủy toàn bộ tác vụ Săn bài tự động đang chờ hoặc đang chạy mà không chạm vào đơn chạy tay */
function cancelPendingPostHunterTasks(reason = 'Đã hủy do tạm dừng tính năng Săn bài tự động') {
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
        it.error = 'Đã hủy do tính năng Săn bài tự động đang tạm dừng.';
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
          // Đã hoàn thành tương tác, chỉ chưa kịp sync log -> hoàn tất an toàn
          it.status = 'COMPLETED';
          it.executionStage = 'COMPLETED';
          it.finishedAt = it.finishedAt || new Date().toISOString();
          completedCount++;
        } else if (!hasExternalSideEffects) {
          // Chưa gửi bất kỳ thao tác nào ra nền tảng bên ngoài -> An toàn phục hồi về QUEUED
          it.status = 'QUEUED';
          it.executionStage = 'INITIALIZED';
          it.error = 'Máy chủ đã khởi động lại trước khi tác vụ bắt đầu thao tác bên ngoài. Đã phục hồi về hàng đợi an toàn.';
          recoveredCount++;
        } else {
          // ĐÃ hoặc ĐANG thực hiện thao tác ra nền tảng bên ngoài -> Chuyển sang NEEDS_REVIEW, cấm tự động retry
          it.status = 'NEEDS_REVIEW';
          it.executionStage = 'NEEDS_REVIEW';
          it.reviewReason = 'CRASH_DURING_EXTERNAL_INTERACTION';
          it.error = `Tác vụ bị gián đoạn khi máy chủ khởi động lại trong lúc đang tương tác bên ngoài (Đã like thành công: ${it.progress?.success || it.progressLikes || 0}). Chuyển sang NEEDS_REVIEW để đối soát thủ công, chống duplicate tương tác.`;
          reviewCount++;
        }
      }
    }
    if (recoveredCount > 0 || reviewCount > 0 || completedCount > 0 || cancelledHunterCount > 0) {
      saveBuffQueue(qd);
      console.log(`[Queue Recovery] 🔄 Phục hồi sau restart/crash: ${recoveredCount} task về QUEUED, ${completedCount} task sync xong về COMPLETED, ${reviewCount} task chuyển sang NEEDS_REVIEW, ${cancelledHunterCount} task Post Hunter đã hủy.`);
    }
  } catch (e) {
    console.warn('[Queue Recovery] ⚠️ Lỗi kiểm tra phục hồi task:', e.message);
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
    // Đồng bộ toàn bộ các task hàng đợi đã hoàn tất hoặc kết thúc (COMPLETED, PARTIAL, FAILED, STOPPED)
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
        accountName: t.accountName || (t.status === 'FAILED' ? 'Hàng Đợi VIP LIKE (Thất bại)' : 'Hàng Đợi VIP LIKE'),
        totalPages,
        targetLikes: typeof t.targetLikes === 'number' ? t.targetLikes : undefined,
        successCount,
        alreadyLikedCount,
        failedCount,
        commentCount: 0,
        details: Array.isArray(t.pageDetails) && t.pageDetails.length > 0 ? t.pageDetails : (t.error ? [{
          pageName: 'Hệ thống hàng đợi',
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
    console.warn('[BuffLogs] ⚠️ Lỗi đồng bộ completed queue sang buff_logs:', err.message);
  }
}

// Dấu vân tay các mục buff_history đã có trong MySQL (url → lastBuffedAt|totalSuccess).
// Trước đây mỗi lần lưu lại INSERT toàn bộ lịch sử → bảng phình thành hàng chục nghìn dòng trùng.
const syncedHistorySignatures = new Map();
let historySignaturesSeeded = false;
const historySignature = (item) => `${item?.lastBuffedAt || ''}|${item?.totalSuccess || 0}`;
function seedHistorySignatures(data) {
  if (historySignaturesSeeded) return;
  historySignaturesSeeded = true;
  // Lịch sử đang có lúc khởi động đã được đồng bộ ở các lần lưu trước → chỉ ghi nhận, không ghi lại
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
      if (syncedHistorySignatures.get(url) === sig) continue; // không đổi kể từ lần đồng bộ trước
      const targetUrl = item.url || item.normalizedUrl || url;
      const reaction = item.reactionType || 'LIKE';
      const status = 'COMPLETED';
      const createdAt = item.lastBuffedAt ? new Date(item.lastBuffedAt) : new Date();
      await p.execute(
        `INSERT INTO buff_history (user_id, target_url, page_id, page_name, interaction_type, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [1, targetUrl, 'ALL_PAGES', `Đã tương tác (${item.totalSuccess || 1} lượt)`, reaction, status, createdAt]
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

// FENCING TOKEN ENGINE ĐƠN ĐIỆU BỀN VỮNG (MONOTONIC DISTRIBUTED FENCING)
let currentFenceEpoch = 0;
async function initFenceEpoch() {
  try {
    currentFenceEpoch = await db.allocateFencingToken();
    console.log(`[Fencing Token] 🛡️ Đã cấp phát Epoch phân tán bền vững từ MySQL: ${currentFenceEpoch}`);
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

const LANE_INACTIVITY_TIMEOUT_MS = 6 * 60 * 1000; // 6 phút không có tiến trình/heartbeat mới coi là deadlock
const LANE_MAX_TIMEOUT_MS = 120 * 60 * 1000; // 120 phút tối đa cho toàn bộ chiến dịch lớn (200-500 like)
const WAITER_TIMEOUT_MS = 30 * 60 * 1000; // 30 phút chờ tối đa trong hàng chờ (chờ bài khác xong)

function getBuffParallelVias() {
  const n = parseInt(loadBuffSettings().buffParallelVias, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : 2;
}

/**
 * Giới hạn số luồng chạy song song trên cùng 1 Via và số Via chạy đồng thời theo Proxy thực tế.
 * Không có Proxy riêng => chạy tuần tự 1 luồng/Via để tránh Meta phát hiện nhiều phiên cùng lúc.
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
      waiter.reject(new Error('Dừng khẩn cấp'));
      continue;
    }
    if (busyBuffLanes.has(waiter.uid)) continue;
    buffLaneWaiters.splice(i--, 1);
    if (waiter.waiterTimer) clearTimeout(waiter.waiterTimer);

    // Cấp phát Fencing Token độc nhất và tăng dần (Monotonic Lease Token)
    const leaseToken = getNextFencingToken();
    const abortController = new AbortController();
    const acquiredAt = Date.now();

    const scheduleInactivityTimer = () => {
      let timerId;
      timerId = setTimeout(() => {
        const active = activeLaneLeases.get(waiter.uid);
        if (active && active.leaseToken === leaseToken && active.leaseTimer === timerId) {
          console.warn(`[LaneLocker] ⚠️ CẢNH BÁO: Lane "${waiter.uid}" (LeaseToken: ${leaseToken}) bất động quá ${LANE_INACTIVITY_TIMEOUT_MS / 1000}s không có tiến trình. Kích hoạt hủy bỏ an toàn (Safe Abort) trước khi thu hồi.`);
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
        reject(new Error(`Hàng chờ tài nguyên Via [${key}] đã quá hạn (${WAITER_TIMEOUT_MS / 1000}s). Tự động bỏ qua để chống nghẽn.`));
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
    // CHỈ giải phóng khoá nếu Fencing Token của tác vụ này trùng khớp với Token đang sở hữu làn
    if (active && active.leaseToken === leaseToken) {
      clearTimeout(active.leaseTimer);
      activeLaneLeases.delete(key);
      busyBuffLanes.delete(key);
      pumpBuffLanes();
    } else {
      console.warn(`[LaneLocker] 🛡️ Fencing Guard: Bỏ qua giải phóng làn [${key}] vì LeaseToken ${leaseToken} đã bị thu hồi/hết hạn.`);
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
const DEAD_VIA_ERR_RE = /hết hạn|checkpoint|đăng nhập|xác minh/i;

// Khi một lượt chạy báo lỗi cookie: xác minh lại bằng phiên đăng nhập thật; nếu đúng là hết hạn/checkpoint
// thì ghi trạng thái vào MySQL (để giao diện hiện cảnh báo) và gửi Telegram. Tránh báo nhầm vì lỗi tạm thời.
async function confirmAndRecordDeadVia(via) {
  try {
    const status = await fbBuffTool.validateViaSession(via.cookieString, { proxyUrl: via.proxyUrl, timeoutMs: 18000 });
    if (status.isLive || (status.status !== 'EXPIRED' && status.status !== 'CHECKPOINT')) return;
    await db.updateTokenStatus(via.id, status.status).catch(() => {});
    notifyViaDead(
      { uid: via.uid, viaName: via.viaName, proxyUrl: via.proxyUrl, tokenStatus: status.status },
      status.status === 'CHECKPOINT' ? 'Facebook yêu cầu xác minh (checkpoint)' : 'Cookie hết hạn hoặc đã đăng xuất'
    ).catch(() => {});
  } catch (e) {
    console.warn(`[ViaHealth] ⚠️ Không xác minh được Via ${via.viaName}: ${e.message}`);
  }
}

/** Sau một lỗi lấy Page của Via: xác minh Cookie thật (tối đa 1 lần/giờ cho mỗi Via) và cảnh báo nếu đã chết */
function verifyViaAfterRunError(via) {
  if (!via?.uid || typeof via.id !== 'number' || !via.cookieString || isBuffViaDead(via.uid)) return;
  deadBuffVias.set(via.uid, Date.now() + DEAD_VIA_TTL_MS); // dùng làm mốc "vừa kiểm tra"
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

/** Tự động đối soát và gắn đúng Via Cookie sở hữu cho từng Fanpage từ MySQL Workbench */
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
 * Tự động tìm và bù các Fanpage hợp lệ từ các Via LIVE trong MySQL Workbench
 * Đảm bảo các Page này chưa từng tương tác với targetUrl để đạt đủ KPI mà không bị trùng lặp.
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
    console.warn('[AutoReplenish] ⚠️ Lỗi tìm trang bù tự động:', err.message);
    return [];
  }
}

// =============================================================================
// AUTHENTICATION, JWT (RFC 7519 HMAC-SHA256) & ACCESS CONTROL
// =============================================================================
const JWT_SECRET_FILE = path.join(DATA_DIR, '.jwt_secret');

// Mật khẩu lưu dạng: scrypt$<saltHex>$<hashHex>
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

// Khi chưa có users.json: tạo 1 ADMIN từ ADMIN_USERNAME / ADMIN_PASSWORD (env), thiếu thì sinh mật khẩu ngẫu nhiên
function createSeedAdmin() {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = crypto.randomBytes(12).toString('base64url');
    console.log(`\n================================================================`);
    console.log(`🔑 [Auth] Đã tạo tài khoản ADMIN mặc định (chỉ hiển thị 1 lần):`);
    console.log(`   Tên đăng nhập: ${username}`);
    console.log(`   Mật khẩu:      ${password}`);
    console.log(`👉 Hãy đăng nhập và đổi mật khẩu, hoặc đặt ADMIN_USERNAME / ADMIN_PASSWORD trong .env`);
    console.log(`================================================================\n`);
  }
  return {
    id: 1,
    username,
    password: hashPasswordSync(password),
    email: `${username}@viplike.vn`,
    fullName: 'Quản Trị Viên VIPLIKE',
    role: 'ADMIN',
  };
}

function loadUsers() {
  const data = store.read('users');
  if (Array.isArray(data) && data.length > 0) {
    // Chuyển mật khẩu dạng chữ thường (plaintext) sang scrypt một lần duy nhất
    const migrated = [];
    for (const u of data) {
      if (u.password && !isHashedPassword(u.password)) {
        u.password = hashPasswordSync(u.password);
        migrated.push(u.username);
      }
    }
    if (migrated.length > 0) {
      saveUsers(data);
      console.log(`[Auth] 🔐 Đã mã hóa mật khẩu (scrypt) cho tài khoản: ${migrated.join(', ')}`);
    }
    return data;
  }
  const seeded = [createSeedAdmin()];
  saveUsers(seeded);
  return seeded;
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

// JWT_SECRET: ưu tiên env, nếu thiếu thì sinh ngẫu nhiên và lưu vào data/.jwt_secret (dùng lại khi khởi động lại)
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
    console.log('[Auth] 🔑 Đã sinh JWT_SECRET ngẫu nhiên và lưu vào data/.jwt_secret');
  } catch (e) {
    console.warn('[Auth] ⚠️ Không lưu được data/.jwt_secret, phiên đăng nhập sẽ mất khi khởi động lại:', e.message);
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
      return null; // Token hết hạn
    }
    return payload;
  } catch {
    return null;
  }
}

// Giới hạn đăng nhập sai trong 60 giây → 429:
//  - quá 5 lần theo IP + tên đăng nhập
//  - quá 20 lần theo riêng IP (chặn dò nhiều tên đăng nhập từ một máy)
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

// Tìm user theo thứ tự ưu tiên: username → email → alias (tránh khớp nhầm khi trùng chuỗi)
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
        return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!' });
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
          error: `Bạn đã đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${retryAfterSec} giây!`,
        });
      }

      const users = loadUsers();
      const user = findUserByLogin(users, username);

      // So khớp mật khẩu với hash scrypt (timing-safe)
      const isMatch = user ? await verifyPassword(password.trim(), user.password) : false;

      // Cùng một thông báo cho "không có tài khoản" và "sai mật khẩu" để không lộ tên đăng nhập nào tồn tại
      if (!user || !isMatch) {
        recordLoginFailure(rateKey);
        recordLoginFailure(ipRateKey);
        return res.status(401).json({
          success: false,
          error: 'Sai tên đăng nhập hoặc mật khẩu. Vui lòng kiểm tra lại!',
        });
      }

      loginFailures.delete(rateKey);

      // Sinh JWT chuẩn RFC 7519 HMAC-SHA256 (hạn 10 ngày)
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
        },
        data: {
          token,
          tokenType: 'Bearer',
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName || user.username,
          role: user.role || 'USER',
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
        return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!' });
      }
      const users = loadUsers();
      // Username/email mới không được trùng username, email hay alias của bất kỳ user nào
      if (findUserByLogin(users, username)) {
        return res.status(400).json({ success: false, error: 'Tên đăng nhập đã tồn tại!' });
      }
      if (email && findUserByLogin(users, email)) {
        return res.status(400).json({ success: false, error: 'Email đã được sử dụng!' });
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
  me: (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
    if (!token) {
      return res.status(401).json({ success: false, authenticated: false, error: 'Yêu cầu đăng nhập. Chưa có mã xác thực JWT.' });
    }
    const decoded = verifyJwtToken(token);
    if (!decoded) {
      return res.status(401).json({ success: false, authenticated: false, error: 'Phiên đăng nhập (JWT) không hợp lệ hoặc đã hết hạn.' });
    }
    return res.json({
      success: true,
      authenticated: true,
      user: {
        id: decoded.id,
        username: decoded.sub || decoded.username,
        email: decoded.email,
        fullName: decoded.fullName,
        role: decoded.role,
      },
    });
  },
};

// Các route xác thực (Công khai) — register yêu cầu ADMIN, đăng ký sau middleware JWT bên dưới
app.post('/api/auth/login', authHandler.login);
app.post('/auth/login', authHandler.login);
app.get('/api/auth/me', authHandler.me);
app.get('/auth/me', authHandler.me);

// Middleware xác thực JWT bắt buộc cho toàn bộ API hệ thống
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
      error: 'Yêu cầu đăng nhập. Không tìm thấy mã xác thực JWT (Bearer token).',
    });
  }

  const decoded = verifyJwtToken(token);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Phiên đăng nhập (JWT) không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
    });
  }

  req.user = decoded;
  next();
}

// Chỉ cho phép tài khoản ADMIN (dùng sau authenticateJwt)
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'Bạn không có quyền thực hiện thao tác này. Chỉ tài khoản ADMIN được phép!',
    });
  }
  next();
}

app.use(authenticateJwt);

// Tạo tài khoản mới: chỉ ADMIN
app.post('/api/auth/register', requireAdmin, authHandler.register);
app.post('/auth/register', requireAdmin, authHandler.register);

// Kiểm tra sức khỏe và tốc độ Proxy thời gian thực
app.post('/api/proxy/test', async (req, res) => {
  const { proxyUrl } = req.body;
  if (!proxyUrl || typeof proxyUrl !== 'string' || !proxyUrl.trim()) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp chuỗi Proxy cần kiểm tra' });
  }

  try {
    const result = await fbBuffTool.testProxy(proxyUrl.trim(), 8000);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy danh sách Proxy Pool từ cài đặt hệ thống
app.get('/api/proxy-pool', (req, res) => {
  try {
    const settings = loadBuffSettings();
    return res.json({ success: true, proxyPool: settings.proxyPool || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật danh sách Proxy Pool
app.post('/api/proxy-pool', (req, res) => {
  try {
    const { proxyPool } = req.body;
    if (!Array.isArray(proxyPool)) {
      return res.status(400).json({ success: false, error: 'proxyPool phải là một mảng chuỗi proxy' });
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

// Kiểm tra sức khỏe toàn bộ Proxy trong Pool song song
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

// Kiểm tra kết nối tới MySQL Workbench
app.get('/api/db/test', async (req, res) => {
  const result = await db.testConnection();
  return res.json(result);
});

// -----------------------------------------------------------------------------
// TÀI KHOẢN VIA: chuẩn hoá Cookie, che dữ liệu nhạy cảm, chặn trùng
// -----------------------------------------------------------------------------
const MYSQL_SAVE_WARNING =
  'Chưa lưu được vào MySQL, dữ liệu mới chỉ được lưu tạm trên máy này. Hãy kiểm tra kết nối MySQL rồi thử lại.';

/**
 * Nhận Cookie dạng chuỗi thường ("c_user=...; xs=..."), JSON (Cookie-Editor / J2Team), hoặc "UID|PASS|2FA|COOKIE".
 * Trả về cookie đã tách sạch, UID, và valid=true khi có đủ c_user + xs.
 */
function normalizeFbCookie(input) {
  let cookie = String(input || '').trim();
  cookie = cookie.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. Phân tích nếu là định dạng JSON (Cookie-Editor, J2Team, DevTools export...)
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

  // 2. Phân tích nếu là dạng pipe | (UID|PASS|2FA|COOKIE)
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

/** Tài khoản không phải ADMIN chỉ thấy UID, không thấy Cookie hay mật khẩu proxy */
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

// Lấy danh sách toàn bộ tài khoản Via & Fanpage từ MySQL Workbench
app.get('/api/connections', async (req, res) => {
  try {
    const accounts = await db.getSocialAccounts();
    const isAdmin = req.user?.role === 'ADMIN';
    return res.json(isAdmin ? accounts : accounts.map(redactAccountForNonAdmin));
  } catch (err) {
    console.error('[API /connections] ❌ Lỗi:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Thêm tài khoản Via mới vào MySQL Workbench (chỉ ADMIN)
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
      return res.status(400).json({ success: false, error: 'Thiếu Cookie Facebook (cookieString)' });
    }

    let finalCookie = String(cookieString).trim();
    if (accountType === 'PERSONAL_PROFILE_COOKIE') {
      const norm = normalizeFbCookie(cookieString);
      if (!norm.valid) {
        return res.status(400).json({
          success: false,
          error: 'Cookie không hợp lệ: cần có đủ c_user và xs (hoặc dạng UID|PASS|2FA|COOKIE chứa 2 giá trị này).',
        });
      }
      finalCookie = norm.cookie;

      const existing = findViaByUid(await db.getSocialAccounts(), norm.uid);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: `Via này đã có trong hệ thống (${existing.pageName || norm.uid}). Dùng "Đổi Cookie" nếu muốn cập nhật.`,
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

// Cập nhật tài khoản trong MySQL Workbench (chỉ ADMIN)
app.put('/api/connections/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { pageName, proxyUrl, tokenStatus } = req.body;
    let { cookieString } = req.body;
    if (cookieString !== undefined) {
      const norm = normalizeFbCookie(cookieString);
      if (!norm.valid) {
        return res.status(400).json({ success: false, error: 'Cookie không hợp lệ: cần có đủ c_user và xs.' });
      }
      cookieString = norm.cookie;
    }
    const result = await db.updateSocialAccount(id, { pageName, cookieString, proxyUrl, tokenStatus });
    return res.json({ success: true, ...(result.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật Cookie mới cho Via (theo UID) — chỉ ADMIN
app.post('/api/vias/update-cookie', requireAdmin, async (req, res) => {
  try {
    const { uid, cookieString, proxyUrl, force = false } = req.body;
    if (!cookieString || !String(cookieString).trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp chuỗi Cookie Facebook mới!' });
    }

    const norm = normalizeFbCookie(cookieString);
    if (!norm.valid) {
      return res.status(400).json({ success: false, error: 'Cookie không hợp lệ: cần có đủ c_user và xs.' });
    }
    const targetUid = uid || norm.uid;
    if (uid && /^[0-9]+$/.test(String(uid)) && norm.uid && String(uid) !== norm.uid && !force) {
      return res.status(400).json({
        success: false,
        error: `Cookie này thuộc tài khoản ${norm.uid}, không khớp với Via ${uid}. Hãy kiểm tra lại.`,
        uidMismatch: true,
        cookieUid: norm.uid,
      });
    }

    // 1. Cập nhật vào DB & Cache cho UID này
    const result = await db.updateViaCookieByUid(targetUid, norm.cookie, proxyUrl);

    // 2. Gỡ bỏ khỏi danh sách đen deadBuffVias để hàng đợi tự động sử dụng lại
    deadBuffVias.delete(targetUid);
    if (norm.uid) deadBuffVias.delete(norm.uid);

    console.log(`[ViaManager] 🔄 Đã cập nhật Cookie mới thành công cho Via UID: ${targetUid}`);
    return res.json({
      success: true,
      message: `Đã cập nhật Cookie mới cho Via UID ${targetUid}`,
      detectedUid: norm.uid,
      cookieString: norm.cookie,
      ...(result?.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Xóa tài khoản khỏi MySQL Workbench
app.delete('/api/connections/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.deleteSocialAccount(id);
    return res.json({ success: true, ...(result.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lịch sử tương tác (mỗi lượt chạy một bản ghi) lưu trên MySQL Workbench
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

// Chi tiết đầy đủ của một lượt chạy (kèm mảng details Fanpage)
app.get('/api/buff-logs/:id', async (req, res) => {
  try {
    const result = await db.getBuffLogById(req.params.id);
    if (!result) return res.status(404).json({ success: false, error: 'Không tìm thấy nhật ký tương tác này' });
    return res.json({ success: true, log: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Body: { log } cho 1 lượt chạy, hoặc { logs: [...] } khi chuyển dữ liệu cũ lên
app.post('/api/buff-logs', async (req, res) => {
  try {
    const { log, logs } = req.body || {};
    const input = Array.isArray(logs) ? logs.slice(0, 2000) : log;
    if (!input) {
      return res.status(400).json({ success: false, error: 'Thiếu dữ liệu log' });
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
      error: `Không xoá được lịch sử vì MySQL chưa kết nối: ${err.message}`,
    });
  }
});

// =============================================================================
// 4. API ROUTES - FANPAGE & BUFF INTERACTION
// =============================================================================

// Quét danh sách Fanpage từ Cookie nick mẹ (Profile Pages / New Page Experience)
app.post('/api/buff-get-pages', async (req, res) => {
  const { cookieString, forceRefresh = false, viaName = '', proxyUrl: explicitProxy = '' } = req.body;
  if (!cookieString) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString' });
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
    console.error('[Buff API] ❌ Lỗi quét Page:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy danh sách Fanpage từ MySQL Workbench facebook_page_accesses (kèm trạng thái Avatar chuẩn)
app.get('/api/buff-cached-pages', async (req, res) => {
  try {
    const { uid } = req.query;
    const avatarCache = avatarTool.loadAvatarCache() || {};
    let pages = [];

    if (uid) {
      pages = fbBuffTool.getCachedPages(String(uid)) || [];
      if (!pages || pages.length === 0) {
        // Nạp trực tiếp từ bảng facebook_page_accesses trên MySQL Workbench
        try {
          pages = await db.getFacebookPageAccesses(1, String(uid));
        } catch (e) {}
      }
      if (!pages || pages.length === 0) {
        // Fallback: Tìm trong accounts_cache
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

      // Gắn trạng thái Avatar chi tiết cho từng Page
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

    // Nếu không truyền UID, ưu tiên nạp toàn bộ từ bảng facebook_page_accesses trên MySQL
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

// Lưu / cập nhật thủ công danh sách Page vào MySQL facebook_page_accesses và cache
app.post('/api/buff-cache-pages', async (req, res) => {
  try {
    const { uid, pages, viaName = '' } = req.body;
    if (!uid || !Array.isArray(pages)) {
      return res.status(400).json({ success: false, error: 'Thiếu uid hoặc pages' });
    }
    fbBuffTool.setCachedPages(String(uid), pages, viaName);
    await db.saveFacebookPageAccesses(pages, uid, viaName);
    return res.json({ success: true, message: `Đã lưu MySQL Workbench và cache ${pages.length} Page cho UID ${uid}` });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Tạo bình luận tự nhiên theo ngữ cảnh bài viết bằng Gemini AI
app.post('/api/buff-ai-generate-comments', async (req, res) => {
  try {
    const { topic = 'GENERAL', postContent = '', postUrl = '', count = 8, tone = 'natural' } = req.body;
    const comments = await generateSeedingComments({ topic, postContent, postUrl, count, tone });
    return res.json({ success: true, count: comments.length, comments });
  } catch (err) {
    console.error('[AI Seeding API] ❌ Lỗi tạo comment AI:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Helper xác thực Bản quyền phần mềm (License Key) cho các tính năng tương tác chính
async function checkLicenseOrReject(req, res) {
  try {
    const hwid = req.headers['x-hardware-hwid'] || req.body?.hardwareHwid || req.query?.hardwareHwid;
    const active = await db.verifyLicenseActive(hwid);
    if (!active) {
      res.status(403).json({
        success: false,
        error: 'Bản quyền phần mềm chưa kích hoạt hoặc đã hết hạn thuê. Vui lòng vào mục "Cho Thuê & Bản Quyền" để kích hoạt License Key.',
      });
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[License Check] ⚠️ Bỏ qua lỗi kiểm tra license:', err.message);
    return true;
  }
}

// Buff Like & Comment (Đồng bộ)
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
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc targetUrl' });
  }

  if (isEmergencyStopped()) {
    const sysSettings = loadBuffSettings();
    const reason = sysSettings.emergencyReason || 'Người quản trị kích hoạt DỪNG KHẨN CẤP';
    return res.status(403).json({
      success: false,
      isEmergencyStopped: true,
      error: `Hệ thống đang ở trạng thái DỪNG KHẨN CẤP (Emergency Stop): "${reason}". Vui lòng bấm nút "Khôi phục hoạt động" (Resume) ở thanh công cụ để tiếp tục.`,
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
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Lỗi gửi thông báo bắt đầu buff:', err.message));

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
      console.warn('[ScreenshotProof] ⚠️ Bỏ qua lỗi chụp ảnh bài viết:', e.message);
    }

    notifyBuffCompleted({
      targetUrl,
      success: successCount,
      total: totalCount,
      failed: failedCount,
      durationSec,
      reactionType,
      screenshotPath,
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Lỗi gửi thông báo hoàn tất buff:', err.message));

    // Tự động lưu lịch sử buff vào MySQL ngay trên Server
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
      }).catch((e) => console.warn('[DB] ⚠️ Lỗi tự động lưu buff_logs từ server:', e.message));
    }

    return res.json({ success: true, result });
  } catch (err) {
    console.error('[Buff API] ❌ Lỗi Buff Like/Comment:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Trạng thái phiên Buff trực tiếp đang chạy ngầm (hỗ trợ duy trì tiến trình khi người dùng F5 / reload trang)
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

// Lấy thông tin phiên Buff trực tiếp đang chạy ngầm
// Frontend chỉ chạy song song nhiều nhóm Via khi backend hỗ trợ chặn KPI theo cả lượt và dừng toàn bộ phiên
const BUFF_LIVE_CAPABILITIES = ['RUN_KPI_CAP', 'STOP_ALL'];

app.get('/api/buff-live/active', (req, res) => {
  try {
    const reqSessionId = req.query.sessionId;
    if (reqSessionId && activeLiveBuffSessions.has(reqSessionId)) {
      return res.json({ success: true, capabilities: BUFF_LIVE_CAPABILITIES, activeSession: activeLiveBuffSessions.get(reqSessionId) });
    }
    if (!activeLiveBuffSession) {
      return res.json({ success: true, capabilities: BUFF_LIVE_CAPABILITIES, activeSession: null });
    }
    // Tự động dọn dẹp nếu phiên đã xong và qua 30 phút
    if (
      activeLiveBuffSession.status !== 'RUNNING' &&
      Date.now() - new Date(activeLiveBuffSession.updatedAt).getTime() > 30 * 60 * 1000
    ) {
      activeLiveBuffSession = null;
      return res.json({ success: true, capabilities: BUFF_LIVE_CAPABILITIES, activeSession: null });
    }
    return res.json({ success: true, capabilities: BUFF_LIVE_CAPABILITIES, activeSession: activeLiveBuffSession });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lệnh dừng tác vụ Buff trực tiếp
app.post('/api/buff-live/stop', (req, res) => {
  try {
    const reqSessionId = req.body?.sessionId;
    if (reqSessionId && activeLiveBuffSessions.has(reqSessionId)) {
      const sess = activeLiveBuffSessions.get(reqSessionId);
      sess.stopRequested = true;
      sess.status = 'STOPPED';
      sess.updatedAt = new Date().toISOString();
      return res.json({ success: true, message: 'Đã gửi lệnh dừng tiến trình session ' + reqSessionId, activeSession: sess });
    }
    if (!reqSessionId) {
      // Không chỉ định session → dừng MỌI nhóm Via đang chạy (chạy 1 link có thể chạy song song nhiều nhóm)
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
        console.log(`[BuffStream] 🛑 Đã nhận lệnh dừng ${stoppedCount} phiên buff trực tiếp đang chạy`);
        return res.json({ success: true, message: `Đã gửi lệnh dừng ${stoppedCount} phiên buff trực tiếp`, activeSession: activeLiveBuffSession });
      }
    }
    if (activeLiveBuffSession && activeLiveBuffSession.status === 'RUNNING') {
      activeLiveBuffSession.stopRequested = true;
      activeLiveBuffSession.status = 'STOPPED';
      activeLiveBuffSession.updatedAt = new Date().toISOString();
      console.log(`[BuffStream] 🛑 Đã nhận lệnh dừng tác vụ buff trực tiếp (Session: ${activeLiveBuffSession.sessionId})`);
      return res.json({ success: true, message: 'Đã gửi lệnh dừng tiến trình buff trực tiếp', activeSession: activeLiveBuffSession });
    }
    return res.json({ success: true, message: 'Không có phiên buff trực tiếp nào đang chạy' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Xóa cache phiên Buff trực tiếp
app.post('/api/buff-live/clear', (req, res) => {
  try {
    const reqSessionId = req.body?.sessionId;
    if (reqSessionId) {
      activeLiveBuffSessions.delete(reqSessionId);
    } else {
      activeLiveBuffSession = null;
      activeLiveBuffSessions.clear();
    }
    return res.json({ success: true, message: 'Đã xóa thông tin phiên buff trực tiếp' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Buff Like & Comment Stream thời gian thực (SSE)
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
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc targetUrl' });
  }

  if (isEmergencyStopped()) {
    const sysSettings = loadBuffSettings();
    const reason = sysSettings.emergencyReason || 'Người quản trị kích hoạt DỪNG KHẨN CẤP';
    return res.status(403).json({
      success: false,
      isEmergencyStopped: true,
      error: `Hệ thống đang ở trạng thái DỪNG KHẨN CẤP (Emergency Stop): "${reason}". Vui lòng bấm nút "Khôi phục hoạt động" (Resume) ở thanh công cụ để tiếp tục.`,
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
      console.log('[BuffStream] 🔌 Client đã ngắt kết nối SSE (reload trang hoặc chuyển tab). Background worker vẫn tiếp tục chạy an toàn...');
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

  // KPI của CẢ lượt chạy: các nhóm Via cùng lượt có sessionId dạng "<runId>_g<n>" và có thể chạy song song.
  // Cộng thành công của mọi nhóm cùng lượt → không vượt mục tiêu kể cả khi trình duyệt F5 / mất kết nối.
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
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Lỗi gửi thông báo stream bắt đầu:', err.message));

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
            message: 'Đã like trước đó (bỏ qua tự động từ dữ liệu đã lưu)',
          });
        }
        sendEvent('progress', {
          type: 'PAGE_FINISH',
          pageId: p.id,
          pageName: p.name,
          viaName: p.viaName,
          status: 'ALREADY_LIKED',
          likeStatus: 'ALREADY_LIKED',
          message: 'Đã like trước đó (bỏ qua tự động từ dữ liệu đã lưu)',
        });
        continue;
      }
      allPages.push(p);
    }

    // Smart Auto-Replenish: Nếu số Page hiện tại ít hơn mục tiêu KPI, tự động bù thêm từ kho Via LIVE
    if (autoReplenish !== false && targetKpi > allPages.length) {
      const needed = targetKpi - allPages.length;
      console.log(`[BuffStream] ⚡ Smart Auto-Replenish: Đang tìm bù ${needed} Page từ kho Via LIVE...`);
      const replenished = await getAutoReplenishPages(targetUrl, excludeIds, needed);
      if (replenished.length > 0) {
        console.log(`[BuffStream] ✅ Đã bổ sung thành công ${replenished.length} Page từ kho dự phòng!`);
        allPages.push(...replenished);
      }
    }

    if (activeLiveBuffSession && activeLiveBuffSession.sessionId === sessionKey) {
      // Mục tiêu hiển thị = KPI người dùng đặt. allPages gồm cả kho Page dự phòng để bù lỗi (có thể hàng trăm),
      // trước đây lấy max(...) làm UI sau khi tải lại trang báo "Mục tiêu 516 nick" thay vì 10.
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
    console.log(`[BuffStream] 🚀 Điều phối an toàn: Chạy đồng thời ${parallelVias} Via (1 luồng/Via) trên tổng ${viaGroups.length} nhóm Via (${allPages.length} Pages)`);

    const allStreamDetails = [];
    await runWithConcurrency(viaGroups, parallelVias, async (group, gIdx) => {
      const curSession = activeLiveBuffSessions.get(sessionKey) || activeLiveBuffSession;
      if (isEmergencyStopped()) {
        sendEvent('error', {
          isEmergencyStopped: true,
          error: 'Hệ thống đang ở trạng thái DỪNG KHẨN CẤP. Tác vụ đã dừng ngay lập tức để bảo vệ an toàn tài khoản.',
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
          // CHỈ DỪNG KHI NGƯỜI DÙNG BẤM NÚT DỪNG, DỪNG KHẨN CẤP, HẾT HẠN LEASE HOẶC ĐẠT ĐỦ KPI
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
                curSession.currentRunningPageName = evt.message || `🛡️ Đang hạ nhiệt Via (${evt.durationSec}s)...`;
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
                    message: `🎯 Đã đạt đủ KPI ${curSession.success}/${targetKpi} Like thành công!`,
                  });
                }

                if (evt.actionBlocked) {
                  group.isBlocked = true;
                  console.warn(`[BuffStream] ⚠️ Via "${group.viaName}" bị Facebook Rate Limit / Action Blocked. Tự động chuyển giao cho nhóm Via tiếp theo...`);
                  notifyActionBlocked({
                    viaName: evt.viaName || group.viaName,
                    viaUid: group.laneUid,
                    postUrl: targetUrl,
                    reason: 'Facebook tạm thời chặn do thao tác nhanh (Action Blocked)',
                  }).catch((err) => console.warn('[TelegramAlert] ⚠️ Lỗi gửi cảnh báo Action Blocked:', err.message));

                  // Chỉ dừng toàn bộ nếu tất cả các nhóm Via đều bị chặn
                  const hasRemainingHealthyVias = viaGroups.some((g) => !g.isBlocked);
                  if (!hasRemainingHealthyVias) {
                    curSession.stopRequested = true;
                    curSession.status = 'STOPPED';
                    curSession.error = 'Toàn bộ dàn Via đều bị Facebook tạm thời hạn chế hành động (Action Blocked). Hệ thống đã tự động dừng khẩn cấp để bảo vệ an toàn tài khoản!';
                    console.warn('[BuffStream] 🛑 Đã tự động ngắt tiến trình do toàn bộ Via bị Action Blocked.');
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
        // Đã duyệt hết nick khả dụng trong đợt này (dù thiếu KPI do cạn nick) -> hoàn tất phiên, không treo RUNNING
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
      console.warn('[ScreenshotProof] ⚠️ Bỏ qua lỗi chụp ảnh bài viết stream:', e.message);
    }

    notifyBuffCompleted({
      targetUrl,
      success: successCount,
      total: totalCount,
      failed: failedCount,
      durationSec,
      reactionType,
      screenshotPath,
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Lỗi gửi thông báo stream xong:', err.message));

    // Tự động lưu lịch sử buff vào MySQL ngay trên Server (đảm bảo không bao giờ bị mất log).
    // Nếu trình duyệt báo sẽ tự lưu (clientSavesLog) và vẫn còn kết nối thì bỏ qua để không ghi trùng 2 bản;
    // khi trình duyệt đã ngắt (F5 / đóng tab) thì server vẫn lưu dự phòng.
    if (result && Array.isArray(result.details) && result.details.length > 0 && !(clientSavesLog && !clientGone)) {
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
      }).catch((e) => console.warn('[DB] ⚠️ Lỗi tự động lưu buff_logs từ stream:', e.message));
    }

    sendEvent('done', { result });
    clearInterval(heartbeatTimer);
    res.end();
  } catch (err) {
    clearInterval(heartbeatTimer);
    console.error('[BuffStream] ❌ Lỗi stream:', err.message);
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
    return res.status(400).json({ success: false, error: 'Thiếu targetUrl' });
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
    console.error('[Buff API] ❌ Lỗi Buff View:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// 5. API ROUTES - HÀNG ĐỢI (QUEUE) & THỐNG KÊ (HISTORY)
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
  // Chỉ tự động bỏ qua nếu là BOT săn bài tự động (AUTO_MONITOR) quét bài trùng,
  // còn người dùng chủ động tạo đơn hoặc chạy tiếp thì luôn cho phép chạy (có bộ lọc Anti-Overlap tự loại Page cũ)
  if (history[normUrl] && !isRebuff && taskPayload.source === 'AUTO_MONITOR') {
    return { skipped: true, history: history[normUrl] };
  }

  // Kiểm tra Idempotency Key (chống trùng lặp tuyệt đối khi mạng lag bấm nhiều lần)
  if (taskPayload.idempotencyKey) {
    const byKey = queueData.items.find((it) => it.idempotencyKey === taskPayload.idempotencyKey);
    if (byKey) {
      return { alreadyQueued: true, task: byKey, idempotent: true };
    }
  }

  // Chỉ chặn nếu bài viết THỰC SỰ ĐANG CHẠY hoặc ĐANG CHỜ trong hàng đợi
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
      return res.status(400).json({ success: false, error: 'Thiếu targetUrl' });
    }
    const result = addBuffQueueTask(req.body);
    if (result.skipped) {
      return res.json({
        success: true,
        skipped: true,
        message: 'Bài viết này đã từng được buff trước đó, tự động bỏ qua để tránh trùng lặp.',
        history: result.history,
      });
    }
    if (result.alreadyQueued) {
      return res.json({
        success: true,
        alreadyQueued: true,
        message: 'Bài viết đang nằm sẵn trong hàng đợi xử lý.',
        task: result.task,
      });
    }

    notifyQueueAdded({
      targetUrl: req.body.targetUrl,
      targetLikes: req.body.targetLikes || 30,
      reactionType: req.body.reactionType || 'LIKE',
      delayMinutes: req.body.delayMinutes || 0,
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Lỗi gửi thông báo hàng đợi:', err.message));

    return res.json({ success: true, task: result.task });
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
      return res.status(400).json({ success: false, error: 'Thiếu danh sách urls' });
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
        skipped.push({ url: cleanUrl, reason: 'Đã buff trước đó' });
      } else if (result.alreadyQueued) {
        alreadyQueued.push({ url: cleanUrl, taskId: result.task?.id });
      } else if (result.task) {
        added.push(result.task);
      }
    });

    if (added.length > 0) {
      notifyQueueAdded({
        targetUrl: `${added.length} bài viết (Gộp đơn)`,
        targetLikes: `${targetLikes} like/bài`,
        reactionType,
        delayMinutes: baseDelay,
      }).catch((err) => console.warn('[TelegramAlert] ⚠️ Lỗi gửi thông báo batch hàng đợi:', err.message));
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
    if (!url) return res.status(400).json({ success: false, error: 'Thiếu url' });
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
    if (!task) return res.status(404).json({ success: false, error: 'Không tìm thấy tác vụ trong hàng đợi' });

    if (task.status !== 'RUNNING' && task.status !== 'QUEUED') {
      return res.status(400).json({ success: false, error: `Tác vụ đang ở trạng thái ${task.status}, không cần dừng.` });
    }

    task.stopReason = 'USER_STOP';
    if (task.status === 'RUNNING') {
      cancelledTaskIds.add(id);
      task.stopRequested = true;
      task.error = 'Đang dừng tác vụ theo yêu cầu người dùng...';
      saveBuffQueue(queueData);
      return res.json({
        success: true,
        message: 'Đã gửi lệnh dừng riêng cho bài này. Worker sẽ dừng sau lượt Page hiện tại.',
        task,
      });
    }

    task.status = 'STOPPED';
    task.executionStage = 'STOPPED';
    task.finishedAt = new Date().toISOString();
    task.stopRequested = false;
    task.error = 'Đã dừng theo yêu cầu người dùng.';
    saveBuffQueue(queueData);
    return res.json({ success: true, message: 'Đã dừng tác vụ đang chờ trong hàng đợi.', task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/run-now/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const task = queueData.items.find((it) => it.id === id);
    if (!task) return res.status(404).json({ success: false, error: 'Không tìm thấy task' });

    cancelledTaskIds.delete(id);
    delete task.stopReason;
    delete task.stopRequested;
    task.runAfter = new Date().toISOString();
    task.status = 'QUEUED';
    saveBuffQueue(queueData);

    setImmediate(runQueueWorker);

    return res.json({ success: true, message: 'Đã kích hoạt task chạy ngay!', task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/retry/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const task = queueData.items.find((it) => it.id === id);
    if (!task) return res.status(404).json({ success: false, error: 'Không tìm thấy task' });

    cancelledTaskIds.delete(id);
    delete task.stopReason;
    delete task.stopRequested;
    task.runAfter = new Date().toISOString();
    task.status = 'QUEUED';
    task.error = null;
    task.attempts = 0;
    saveBuffQueue(queueData);

    setImmediate(runQueueWorker);

    return res.json({ success: true, message: 'Đã đưa task vào hàng đợi chạy lại!', task });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Xử lý đối soát thủ công cho các task cần duyệt (NEEDS_REVIEW)
app.post('/api/buff-queue/review-resolve/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'RESUME' | 'COMPLETE' | 'CANCEL'
    const queueData = loadBuffQueue();
    const task = queueData.items.find((it) => it.id === id);
    if (!task) return res.status(404).json({ success: false, error: 'Không tìm thấy task' });

    if (task.status !== 'NEEDS_REVIEW' && task.status !== 'FAILED') {
      return res.status(400).json({ success: false, error: `Task đang ở trạng thái ${task.status}, không cần đối soát.` });
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
          ? `Tiếp tục chạy nốt toàn bộ page còn lại (đã hoàn thành ${currentSuccess} like trước đó).`
          : `Tiếp tục chạy nốt ${remainingTarget} like còn thiếu để đủ KPI ${originalTarget} (đã hoàn thành ${currentSuccess} like trước đó).`;
      saveBuffQueue(queueData);
      setImmediate(runQueueWorker);
      return res.json({ success: true, message: `Đã đưa task trở lại hàng đợi để chạy tiếp ${remainingTarget} like còn thiếu`, task });
    } else if (action === 'COMPLETE') {
      task.status = 'COMPLETED';
      task.executionStage = 'COMPLETED';
      task.finishedAt = new Date().toISOString();
      task.reviewResolvedAt = new Date().toISOString();
      task.reviewResolution = 'Chấp nhận kết quả hiện tại và đóng tác vụ.';
      saveBuffQueue(queueData);
      return res.json({ success: true, message: 'Đã hoàn tất tác vụ theo đối soát', task });
    } else if (action === 'CANCEL') {
      task.status = 'CANCELLED';
      task.executionStage = 'CANCELLED';
      task.reviewResolvedAt = new Date().toISOString();
      task.reviewResolution = 'Hủy bỏ tác vụ theo đối soát.';
      saveBuffQueue(queueData);
      return res.json({ success: true, message: 'Đã hủy tác vụ', task });
    } else {
      return res.status(400).json({ success: false, error: 'Hành động không hợp lệ. Hỗ trợ: RESUME, COMPLETE, CANCEL.' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// QUEUE WORKER ENGINE (XỬ LÝ HÀNG ĐỢI TỰ ĐỘNG)
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
  console.log(`[BuffQueue Worker] 🚀 Đang chạy Task ${task.id} cho bài viết: ${task.targetUrl}`);

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
        // Bài được gắn với 1 Via cụ thể nhưng Via đó đang bị đánh dấu lỗi: không dùng lại Cookie cũ đã chết
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
            `Via ${deadRow.pageName || pinnedUid} đang ${deadRow.tokenStatus === 'CHECKPOINT' ? 'bị checkpoint' : 'hết hạn Cookie'}. Hãy cập nhật Cookie ở trang Via & Fanpage rồi bấm Thử lại.`
          );
        }
        targetVias = [
          {
            id: 'task_via',
            uid: fbBuffTool.getUserIdFromCookie(task.cookieString) || 'custom',
            viaName: 'Via Riêng',
            cookieString: task.cookieString,
            proxyUrl: '',
          },
        ];
      }
    } else {
      targetVias = await db.getLiveVias();
    }

    if (targetVias.length === 0) {
      throw new Error('Không tìm thấy tài khoản Via khả dụng nào trong hệ thống');
    }

    // Tối ưu hóa phân phối đa luồng: Ưu tiên các Via đang rảnh (chưa bận lane) để 2 Worker chạy song song 2 bài không bị nghẽn
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
          console.warn(`[BuffQueue Worker] ⚠️ Không lấy được page từ via ${via.viaName}:`, e.message);
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
      console.log(`[BuffQueue Worker] ℹ️ Toàn bộ page đã tương tác với bài "${task.targetUrl}". Hoàn tất task.`);
      const qd = loadBuffQueue();
      const t = qd.items.find((it) => it.id === task.id);
      if (t) {
        t.status = 'COMPLETED';
        t.finishedAt = new Date().toISOString();
        t.result = { total: 0, success: 0, failed: 0, message: 'Đã like trước đó hoặc không còn page mới' };
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

    // Phân bổ Page cân bằng giữa các Via theo cơ chế Round-Robin (tránh dồn việc lên 1 Via duy nhất)
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

    // Chuẩn bị danh sách Page: Nếu có mục tiêu KPI cụ thể, lấy thêm dự phòng (+50% hoặc tối thiểu +40 Page) để tự động bù nếu có Page lỗi
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
    }).catch((err) => console.warn('[TelegramAlert] ⚠️ Lỗi thông báo queue worker bắt đầu:', err.message));

    const qdDispatch = loadBuffQueue();
    const tDispatch = qdDispatch.items.find((it) => it.id === task.id);
    if (tDispatch) {
      tDispatch.executionStage = 'DISPATCHING';
      tDispatch.dispatchedAt = new Date().toISOString();
      saveBuffQueue(qdDispatch);
    }

    const isTaskCancelled = () => cancelledTaskIds.has(task.id) || (isPostHunterPaused() && isPostHunterTask(task));
    const laneErrors = [];

    // Chạy tuần tự 1 luồng/Via (tránh cảnh báo "sử dụng quá nhanh") và cho phép chạy song song tối đa 2 Via khác nhau
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
                console.warn(`[QueueWorker] 🛑 Phát hiện Via bị Facebook hạn chế tốc độ (Action Blocked) trên task ${task.id}. Tự động ngắt task bảo vệ Via!`);
                notifyActionBlocked({
                  viaName: group.viaName || 'Via',
                  viaUid: laneUid,
                  postUrl: task.targetUrl,
                  reason: 'Facebook tạm thời chặn do thao tác nhanh (Action Blocked)',
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
        console.warn(`[QueueWorker] ⚠️ Via ${group.viaName || laneUid} không thể chạy lượt này (${errMsg}). Tiếp tục các Via khác...`);
      }
    });

    const durationSec = Math.round((Date.now() - startTime) / 1000);
    const cancelled = isTaskCancelled();
    cancelledTaskIds.delete(task.id);

    const qd = loadBuffQueue();
    const t = qd.items.find((it) => it.id === task.id);
    if (t) {
      const finalSuccess = (t.pageDetails || []).filter((d) => d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED').length;
      const finalFailed = (t.pageDetails || []).filter((d) => d.status === 'ERROR' || d.status === 'FAILED').length;
      const autoRefilledCount = Math.max(0, (finalSuccess + finalFailed) - desiredLikes);
      const isTargetMet = task.targetLikes === 'ALL' || finalSuccess >= desiredLikes;

      const userStopped = cancelled && t.stopReason === 'USER_STOP';
      t.status = userStopped ? 'STOPPED' : cancelled ? 'CANCELLED' : isEmergencyStopped() ? 'STOPPED' : isTargetMet ? 'COMPLETED' : 'PARTIAL';
      t.executionStage = userStopped ? 'STOPPED' : cancelled ? 'CANCELLED' : isEmergencyStopped() ? 'STOPPED' : isTargetMet ? 'COMPLETED' : 'PARTIAL';
      t.stopRequested = false;
      t.finishedAt = new Date().toISOString();
      if (userStopped) {
        t.error = 'Đã dừng theo yêu cầu người dùng.';
      } else if (cancelled) {
        t.error = t.error || 'Đã hủy do tạm dừng tính năng Săn bài tự động.';
      } else if (finalSuccess === 0 && laneErrors.length > 0) {
        t.error = `Lỗi luồng chạy: ${laneErrors.join(' | ')}`;
      }
      t.result = {
        total: desiredLikes,
        targetKpi: desiredLikes,
        autoRefilledCount,
        success: finalSuccess,
        failed: finalFailed,
        durationSec,
        note: userStopped
          ? `Đã dừng tác vụ giữa chừng theo yêu cầu (${finalSuccess} like đã thực hiện).`
          : cancelled
          ? `Đã hủy tác vụ giữa chừng (${finalSuccess} like đã thực hiện trước khi hủy).`
          : !isTargetMet && laneErrors.length > 0 && finalSuccess === 0
          ? `Tác vụ dừng do lỗi: ${laneErrors.join(' | ')}`
          : !isTargetMet
          ? `Đã hoàn thành ${finalSuccess}/${desiredLikes} like (${desiredLikes - finalSuccess} like chưa đạt do hết Fanpage khả dụng hoặc Via bị ngắt kết nối).`
          : undefined,
      };
      saveBuffQueue(qd);

      // Tự động ghi nhớ vào Lịch Sử tương tác chung (buff_logs) để hiển thị đầy đủ tại tab "Lịch sử"
      const alreadyLikedCount = (t.pageDetails || []).filter((d) => d.status === 'ALREADY_LIKED').length;
      const displayAccountName = Array.from(viaGroupsMap.values()).map((g) => g.viaName).filter(Boolean).join(', ') || 'Hàng Đợi VIP LIKE';
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
      }).catch((e) => console.warn('[BuffQueue Worker] ⚠️ Lỗi lưu buff_logs từ queue:', e.message));
    }

    if (cancelled) {
      console.log(`[BuffQueue Worker] 🛑 Đã hủy Task ${task.id} (${task.targetUrl}) sau ${durationSec}s.`);
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
      console.warn('[ScreenshotProof] ⚠️ Bỏ qua lỗi chụp ảnh bài viết queue:', e.message);
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

    console.log(`[BuffQueue Worker] ✅ Hoàn tất Task ${task.id}: Thành công ${totalSuccess}/${pagesToBuff.length} (${durationSec}s)`);

    consecutiveQueueFailures = 0;
    const stillBusy = loadBuffQueue().items.some(
      (it) => it.id !== task.id && (it.status === 'QUEUED' || it.status === 'RUNNING')
    );
    if (!stillBusy) notifyQueueIdle({ completedCount: queueCompletedSinceIdle + 1 }).catch(() => {});
    queueCompletedSinceIdle = stillBusy ? queueCompletedSinceIdle + 1 : 0;
  } catch (err) {
    console.error(`[BuffQueue Worker] ❌ Task ${task.id} lỗi:`, err.message);
    const qd = loadBuffQueue();
    const t = qd.items.find((it) => it.id === task.id);
    if (t) {
      const attempts = (t.attempts || 0) + 1;
      t.attempts = attempts;
      t.finishedAt = new Date().toISOString();

      // Exponential Backoff & Dead-letter Queue (Phase 4 SaaS 3.0)
      if (attempts < 3) {
        t.status = 'QUEUED';
        const backoffSec = Math.pow(2, attempts) * 30; // Lần 1: 60s, Lần 2: 120s
        t.runAfter = new Date(Date.now() + backoffSec * 1000).toISOString();
        t.error = `Tự động thử lại (${attempts}/3) sau ${backoffSec}s (Exponential Backoff): ${err.message}`;
        console.log(`[BuffQueue Worker] 🔄 Task ${task.id} được lên lịch retry lần ${attempts}/3 sau ${backoffSec}s.`);
      } else {
        t.status = 'DEAD_LETTER';
        t.error = `Đã thất bại sau ${attempts} lần thử (Chuyển sang DEAD_LETTER): ${err.message}`;
        console.warn(`[BuffQueue Worker] ☠️ Task ${task.id} chuyển sang trạng thái DEAD_LETTER.`);
      }
      saveBuffQueue(qd);

      // Lưu trạng thái lỗi vào buff_logs để người dùng kiểm tra được ngay trong Lịch sử
      db.saveBuffLogs({
        id: 'log_' + task.id,
        createdAt: t.finishedAt,
        type: 'QUEUE',
        targetUrl: task.targetUrl,
        reactionType: task.reactionType || 'LIKE',
        engagementMode: task.enableComment ? 'BOTH' : 'LIKE_ONLY',
        accountName: 'Hàng Đợi VIP LIKE (Gặp lỗi)',
        totalPages: typeof task.targetLikes === 'number' ? task.targetLikes : 30,
        targetLikes: typeof task.targetLikes === 'number' ? task.targetLikes : 30,
        successCount: Number(t.progress?.success || 0),
        alreadyLikedCount: 0,
        failedCount: Math.max(1, Number(t.progress?.failed || 1)),
        commentCount: 0,
        details: Array.isArray(t.pageDetails) && t.pageDetails.length > 0 ? t.pageDetails : [{
          pageName: 'Hệ thống hàng đợi',
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

// Đếm bài thất bại liên tiếp / số bài đã xong từ lần hàng đợi trống gần nhất (phục vụ thông báo Telegram)
let consecutiveQueueFailures = 0;
let queueCompletedSinceIdle = 0;

async function runQueueWorker() {
  if (!store.isReady()) return;
  if (isEmergencyStopped()) return;
  const maxParallel = getMaxParallelBuff();
  if (activeBuffTaskIds.size >= maxParallel) return;

  const queueData = loadBuffQueue();
  const now = new Date();

  // Tự động giải cứu (Auto-Recovery) các task bị kẹt RUNNING quá 15 phút (do server restart/crash)
  for (const it of queueData.items || []) {
    if (it.status === 'RUNNING' && !activeBuffTaskIds.has(it.id)) {
      const runningDuration = it.startedAt ? (now.getTime() - new Date(it.startedAt).getTime()) : 9999999;
      if (runningDuration > 15 * 60 * 1000) {
        console.warn(`[BuffQueue Recovery] 🚑 Phát hiện Task ${it.id} bị kẹt RUNNING quá 15 phút. Tự động phục hồi sang QUEUED.`);
        it.status = 'QUEUED';
        it.runAfter = new Date().toISOString();
        it.error = 'Tự động phục hồi sau sự cố kẹt tiến trình (Crash/Timeout Auto-Recovery)';
      }
    }
  }

  // Sắp xếp ưu tiên: HIGH (3) > NORMAL (2) > LOW (1) kết hợp FIFO
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

// Chạy vòng lặp kiểm tra hàng đợi mỗi 6 giây
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
// 6. API ROUTES - POST HUNTER (TỰ SĂN BÀI MỚI)
// =============================================================================

app.get('/api/buff-monitors', (req, res) => {
  try {
    const data = loadBuffMonitors();
    const queueData = loadBuffQueue();
    const history = loadBuffHistory();
    return res.json({
      success: true,
      monitors: data.monitors || [],
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
      return res.status(500).json({ success: false, error: 'Không lưu được trạng thái Săn bài tự động' });
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
        cancelledTaskList = cancelPendingPostHunterTasks('Đã hủy do tạm dừng tính năng Săn bài tự động');
      }
      console.log(`[PostHunter] ⏸️ Đã tạm dừng toàn bộ tính năng Săn bài tự động (tạm dừng ${pausedMonitors} mục tiêu, hủy ${cancelledTaskList.length} tác vụ).`);
    } else {
      console.log('[PostHunter] ▶️ Đã bật lại tính năng Săn bài tự động.');
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
      return res.status(400).json({ success: false, error: 'Thiếu link mục tiêu (targetUrl)' });
    }

    const data = loadBuffMonitors();
    let monitorId = id;

    if (monitorId) {
      const idx = data.monitors.findIndex((m) => m.id === monitorId);
      if (idx !== -1) {
        const urlChanged = String(targetUrl).trim() !== data.monitors[idx].targetUrl;
        data.monitors[idx] = {
          ...data.monitors[idx],
          ...(urlChanged ? { baselineDone: false, seenPostUrls: [] } : {}),
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
      targetName: targetName ? String(targetName).trim() : `Mục tiêu ${data.monitors.length + 1}`,
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
    if (!mon) return res.status(404).json({ success: false, error: 'Không tìm thấy mục tiêu theo dõi' });
    if (mon.status !== 'ACTIVE' && isPostHunterPaused()) {
      return res.status(400).json({
        success: false,
        error: 'Tính năng Săn bài tự động đang tạm dừng. Vui lòng bật lại trước khi kích hoạt mục tiêu.',
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
      return res.status(400).json({ success: false, error: 'Thiếu link mục tiêu cần test quét' });
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

// Quét mục tiêu và nạp bài viết mới vào hàng đợi
async function scanMonitorTarget(monitorId, options = {}) {
  const data = loadBuffMonitors();
  const mon = data.monitors.find((m) => m.id === monitorId);
  if (!mon) throw new Error('Không tìm thấy mục tiêu theo dõi');

  // 1. Kiểm tra ngày hết hạn gói VIP
  if (mon.expiresAt && new Date(mon.expiresAt).getTime() < Date.now()) {
    mon.status = 'PAUSED';
    mon.expiredReason = 'Gói VIP đã hết hạn sử dụng';
    saveBuffMonitors(data);
    console.warn(`[PostHunter] ⏸️ Mục tiêu ${mon.targetName} đã hết hạn gói VIP (${mon.expiresAt}). Tự động tạm dừng.`);
    return { postsFound: 0, newPostsEnqueued: 0, expired: true };
  }

  // 2. Kiểm tra và làm mới giới hạn bài đăng trong ngày (Daily Posts Limit)
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

  const posts = await fbBuffTool.scanTargetForPosts(mon.targetUrl, {
    cookieStr,
    proxyUrl,
    maxPosts: 8,
    browser: options.browser || null,
  });

  const postsFound = posts.length;
  mon.lastCheckedAt = new Date().toISOString();
  mon.lastPostsFound = postsFound;
  if (scanViaName) mon.lastScanVia = scanViaName;

  if (!Array.isArray(mon.seenPostUrls)) {
    mon.seenPostUrls = [];
  }

  if (!mon.baselineDone) {
    mon.baselineDone = true;
    mon.seenPostUrls = Array.from(new Set([...mon.seenPostUrls, ...posts.map((p) => p.normalizedUrl)]));
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
    if (post.isPinned) {
      // Bài viết đã ghim cũ: ghi nhớ vào seenPostUrls để không bao giờ buff nhầm
      if (!mon.seenPostUrls.includes(normUrl)) mon.seenPostUrls.push(normUrl);
      continue;
    }
    if (!mon.seenPostUrls.includes(normUrl) && !history[normUrl]) {
      newPosts.push(post);
      mon.seenPostUrls.push(normUrl);
    }
  }

  let newPostsEnqueued = 0;
  for (const newPost of newPosts) {
    if (mon.dailyPostsCount >= maxDaily) {
      console.log(`[PostHunter] ⚠️ Mục tiêu ${mon.targetName} đã đạt hạn mức ${maxDaily} bài/ngày hôm nay. Tạm bỏ qua bài mới: ${newPost.url}`);
      break;
    }

    // Tính toán số like có biên độ ngẫu nhiên tự nhiên (Random Likes Variance)
    let finalTargetLikes = mon.buffConfig?.targetLikes || 30;
    if (typeof finalTargetLikes === 'number' && mon.buffConfig?.variancePercent) {
      const vPct = Math.min(30, Math.max(5, parseInt(mon.buffConfig.variancePercent, 10)));
      const delta = Math.round(finalTargetLikes * (vPct / 100));
      const jitter = Math.floor(Math.random() * (delta * 2 + 1)) - delta;
      finalTargetLikes = Math.max(10, finalTargetLikes + jitter);
    }

    const queuePayload = {
      source: `POST_HUNTER:${mon.targetName || mon.id}`,
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
    if (addRes.task) {
      newPostsEnqueued++;
      mon.dailyPostsCount = (mon.dailyPostsCount || 0) + 1;
      mon.totalDetected = (mon.totalDetected || 0) + 1;
      mon.lastFoundPostUrl = newPost.url;

      notifyPostHunted({
        targetName: mon.targetName,
        targetUrl: mon.targetUrl,
        postUrl: newPost.url,
        delayMinutes: queuePayload.delayMinutes,
        targetLikes: queuePayload.targetLikes,
      }).catch(() => {});
    }
  }

  saveBuffMonitors(data);

  return {
    baseline: false,
    postsFound,
    newPostsEnqueued,
    posts,
  };
}

// API Quét thủ công ngay lập tức cho 1 mục tiêu theo dõi
app.post('/api/buff-monitors/:id/scan-now', async (req, res) => {
  try {
    if (isPostHunterPaused()) {
      return res.status(400).json({
        success: false,
        error: 'Tính năng Săn bài tự động đang tạm dừng. Vui lòng bật lại trước khi quét.',
      });
    }
    const { id } = req.params;
    const result = await scanMonitorTarget(id);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error(`[PostHunter] ❌ Lỗi quét mục tiêu ${req.params.id}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Post Hunter Background Scheduler (Tối ưu hóa: Dùng chung 1 Browser cho cả mẻ quét để tiết kiệm 90% CPU & RAM)
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
        console.log(`[PostHunter Scheduler] ⏰ Đến lịch quét mục tiêu: ${mon.targetName} (${mon.targetUrl})`);
        await scanMonitorTarget(mon.id, { browser: sharedBrowser });
      } catch (err) {
        console.warn(`[PostHunter Scheduler] ⚠️ Quét mục tiêu ${mon.targetName} lỗi:`, err.message);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    if (sharedBrowser) await sharedBrowser.close().catch(() => { });
    isHunterScanning = false;
  }
}

// Chạy Hunter Scheduler kiểm tra mỗi 30 giây
setInterval(runHunterScheduler, 30000);

// Bộ bảo vệ RAM tự động (Auto Memory Guard): giải phóng bộ nhớ định kỳ mỗi 15 phút
setInterval(() => {
  const mem = process.memoryUsage();
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  if (global.gc && (rssMB > 350 || heapMB > 200)) {
    try {
      global.gc();
      const afterMem = process.memoryUsage();
      console.log(`[MemoryGuard] 🧹 Đã dọn RAM tự động: ${rssMB}MB -> ${Math.round(afterMem.rss / 1024 / 1024)}MB`);
    } catch (_) { }
  }
}, 15 * 60 * 1000);

// Kiểm tra sức khỏe nhanh cho danh sách Fanpage (Public / Restricted / Live)
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

// Cập nhật nhanh Cookie cho Via từ Cảnh báo (CookieAlertManager)
app.post('/api/buff-vias/quick-update-cookie', async (req, res) => {
  try {
    const { uid, cookieString, proxyUrl } = req.body;
    if (!cookieString || !String(cookieString).trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp chuỗi Cookie Facebook mới!' });
    }
    const norm = normalizeFbCookie(cookieString);
    if (!norm.valid) {
      return res.status(400).json({ success: false, error: 'Cookie không hợp lệ: cần có đủ c_user và xs.' });
    }
    const targetUid = uid || norm.uid;
    const result = await db.updateViaCookieByUid(targetUid, norm.cookie, proxyUrl);
    deadBuffVias.delete(targetUid);
    if (norm.uid) deadBuffVias.delete(norm.uid);
    return res.json({
      success: true,
      message: `Đã cập nhật Cookie mới cho Via UID ${targetUid}`,
      detectedUid: norm.uid,
      cookieString: norm.cookie,
      ...(result?.dbSaved === false ? { warning: MYSQL_SAVE_WARNING } : {}),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Kiểm tra sức khỏe dàn Via và CẬP NHẬT TRỰC TIẾP vào MySQL Workbench (social_accounts)
app.post('/api/buff-vias/health-check', async (req, res) => {
  try {
    const { cookieString, viaId } = req.body;
    let targetVias = [];

    if (cookieString) {
      const norm = normalizeFbCookie(cookieString);
      targetVias.push({
        id: viaId || 'custom',
        viaName: 'Via Kiểm Tra',
        cookieString: norm.valid ? norm.cookie : String(cookieString).trim(),
        proxyUrl: '',
      });
    } else {
      targetVias = await db.getLiveVias();
    }

    console.log(`[ViaHealth] 🩺 Bắt đầu kiểm tra sức khỏe ${targetVias.length} tài khoản Via...`);
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
            status.error || 'Phiên đăng nhập không khả dụng'
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
// KIỂM TRA ĐỊNH KỲ VIA HẾT HẠN COOKIE / CHECKPOINT → CẬP NHẬT TRẠNG THÁI + CẢNH BÁO TELEGRAM
// =============================================================================
const VIA_HEALTH_INTERVAL_MS = 30 * 60 * 1000;
const VIA_HEALTH_FIRST_RUN_MS = 3 * 60 * 1000;
let isViaHealthScanning = false;

async function runScheduledViaHealthCheck() {
  if (!store.isReady() || isViaHealthScanning) return;
  // Nhường chỗ cho tác vụ đang chạy để không tranh tài nguyên trình duyệt
  if (isHunterScanning || activeLiveBuffSession) return;
  try {
    if (loadBuffSettings().isEmergencyStopped) return;
    if (loadBuffQueue().items.some((it) => it.status === 'RUNNING')) return;
  } catch (e) {
    return;
  }

  isViaHealthScanning = true;
  try {
    // getLiveVias chỉ trả về Via chưa bị đánh dấu lỗi → mỗi Via chỉ bị cảnh báo 1 lần khi vừa chuyển sang lỗi
    const vias = (await db.getLiveVias()).filter((v) => typeof v.id === 'number');
    if (vias.length === 0) return;
    console.log(`[ViaHealth] ⏱️ Kiểm tra định kỳ ${vias.length} Via...`);

    for (const via of vias) {
      if (loadBuffSettings().isEmergencyStopped) break;
      try {
        const status = await fbBuffTool.validateViaSession(via.cookieString, {
          proxyUrl: via.proxyUrl,
          timeoutMs: 18000,
        });
        // Chỉ coi là lỗi khi chắc chắn (hết hạn / checkpoint); lỗi mạng hoặc timeout bỏ qua để không báo nhầm
        if (status.isLive || (status.status !== 'EXPIRED' && status.status !== 'CHECKPOINT')) continue;

        await db.updateTokenStatus(via.id, status.status).catch(() => {});
        notifyViaDead(
          {
            uid: via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString),
            viaName: via.viaName,
            proxyUrl: via.proxyUrl,
            tokenStatus: status.status,
          },
          status.status === 'CHECKPOINT' ? 'Facebook yêu cầu xác minh (checkpoint)' : 'Cookie hết hạn hoặc đã đăng xuất'
        ).catch(() => {});
      } catch (err) {
        console.warn(`[ViaHealth] ⚠️ Bỏ qua Via ${via.viaName || via.id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[ViaHealth] ⚠️ Kiểm tra định kỳ thất bại: ${err.message}`);
  } finally {
    isViaHealthScanning = false;
  }
}

setTimeout(() => {
  runScheduledViaHealthCheck();
  setInterval(runScheduledViaHealthCheck, VIA_HEALTH_INTERVAL_MS);
}, VIA_HEALTH_FIRST_RUN_MS);

// =============================================================================
// TELEGRAM: BÁO CÁO HẰNG NGÀY + LỆNH /status
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
    `📊 <b>[TÌNH TRẠNG HỆ THỐNG]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    st.isEmergencyStopped ? `⛔ <b>Đang DỪNG KHẨN CẤP</b> — gửi /resume để khôi phục` : `🟢 Đang hoạt động bình thường`,
    v ? `👤 Via: ${v.live}/${v.total} hoạt động${v.dead ? ` · <b>${v.dead} cần cập nhật Cookie</b>` : ''}` : `👤 Via: không đọc được dữ liệu`,
    `📋 Hàng đợi: ${q.running} đang chạy · ${q.queued} đang chờ`,
    `📈 24 giờ qua: ${q.completed} bài xong · ${q.failed} thất bại`,
  ].join('\n');
}

async function buildDailyReport() {
  const q = summarizeQueueSince(Date.now() - 24 * 3600 * 1000);
  const v = await getViaCounts();
  const rate = q.total > 0 ? Math.round((q.success / q.total) * 100) : 0;
  return [
    `🗓️ <b>[BÁO CÁO 24 GIỜ QUA]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `✅ Bài hoàn tất: <b>${q.completed}</b>${q.failed ? ` · ❌ thất bại: <b>${q.failed}</b>` : ''}`,
    `❤️ Lượt thành công: <b>${q.success}</b> / ${q.total}${q.total ? ` (${rate}%)` : ''}`,
    `⏱️ Tổng thời gian chạy: ${formatDurationVi(q.totalSec)}`,
    v ? `👤 Via: ${v.live}/${v.total} hoạt động${v.dead ? ` · <b>${v.dead} cần cập nhật Cookie</b>` : ''}` : '',
    `📋 Đang chờ trong hàng đợi: ${q.queued}`,
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
    saveBuffSettings({ lastDailyReportDate: today }); // ghi trước để không gửi lặp nếu có lỗi giữa chừng
    await sendAlert(await buildDailyReport());
  } catch (err) {
    console.warn(`[DailyReport] ⚠️ ${err.message}`);
  }
}
setInterval(runDailyReportTick, 60 * 1000);

// Xử lý yêu cầu buff từ Telegram ("Chat là Buff" & Callback Button)
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
    ? `${targetLikes} Chia sẻ (Share Fanpage)`
    : enableShare
    ? `${targetLikes} Like + Share`
    : `${targetLikes} Like`;

  console.log(`[TelegramBot] 📥 Nhận yêu cầu buff từ Telegram: ${targetUrl} | ${actionLabel} | ${reactionType} | Nguồn: ${source}`);

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
      `⚠️ <b>[BÀI VIẾT ĐÃ TỪNG BUFF TRƯỚC ĐÓ]</b>\nBài viết này đã có trong lịch sử buff để tránh trùng lặp.\n🔗 <a href="${targetUrl}">${targetUrl}</a>\n\n👉 <i>Nếu bạn muốn buff thêm lượt mới từ các Page còn lại, hãy bấm nút "Buff tiếp" bên dưới:</i>`,
      'HTML',
      {
        inline_keyboard: [
          [
            { text: '🔁 Ép buộc buff thêm 50 Like', callback_data: `rebuff:${shortId}:50` },
            { text: '🔁 Ép buộc buff thêm 100 Like', callback_data: `rebuff:${shortId}:100` },
          ],
        ],
      }
    );
    return { success: false, reason: 'ALREADY_BUFFED' };
  }

  if (queueResult.alreadyQueued) {
    await sendTelegramMessage(
      `⏳ <b>[BÀI VIẾT ĐANG TRONG HÀNG ĐỢI]</b>\nBài viết đang có sẵn trong hàng đợi và sẽ sớm được xử lý tự động:\n🔗 <a href="${targetUrl}">${targetUrl}</a>\n🎯 Mục tiêu: ${queueResult.task?.targetLikes || targetLikes} lượt`
    );
    return { success: true, alreadyQueued: true };
  }

  const shortId = registerShortUrl(targetUrl);
  const confirmMsg = [
    `📥 <b>[TIẾP NHẬN ĐƠN TỪ TELEGRAM THÀNH CÔNG]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔗 <b>Bài viết:</b> <a href="${targetUrl}">${targetUrl}</a>`,
    `🎯 <b>Hạng mục:</b> <b>${actionLabel}</b>`,
    !isShareOnly ? `💖 <b>Cảm xúc:</b> ${reactionType}` : `🚀 <b>Tính năng:</b> Chia sẻ bài viết về tường Fanpage`,
    `⚡ <b>Trạng thái:</b> Đã đưa vào Hàng đợi (Sẽ chạy ngay khi tới lượt)`,
    `⏰ <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🚀 <i>Bot Playwright đang chuẩn bị dàn Page để tương tác bài viết...</i>`,
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🛑 Dừng ngay', callback_data: 'stop' },
        { text: '📋 Xem hàng đợi', callback_data: 'status' },
      ],
      [
        { text: '📊 Số Page khả dụng', callback_data: 'check_pages' },
        { text: '🔁 Thêm 100 Like nữa', callback_data: `rebuff:${shortId}:100` },
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
      const vName = p.profile_name || p.personal_profile_id || 'Via khác';
      viaMap[vName] = (viaMap[vName] || 0) + 1;
    });

    const breakdown = Object.entries(viaMap)
      .map(([name, count]) => `• <b>${name}:</b> ${count} Fanpages`)
      .join('\n');

    return [
      `📊 <b>[THỐNG KÊ DÀN FANPAGE ACTIVE]</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `🟢 <b>Tổng số Page sẵn sàng:</b> <b>${activePages.length}</b> Page`,
      `━━━━━━━━━━━━━━━━━━`,
      `<b>Chi tiết theo từng Via:</b>`,
      breakdown || '• Chưa có phân bổ chi tiết',
      `━━━━━━━━━━━━━━━━━━`,
      `🛡️ <i>Tất cả các Page trên đều đang hoạt động tốt và sẵn sàng nhận lệnh buff!</i>`,
    ].join('\n');
  } catch (err) {
    return `⚠️ Không lấy được thống kê page: ${err.message}`;
  }
}

// Báo cáo chi tiết các bài trong hàng đợi
async function buildQueueText() {
  const q = loadBuffQueue();
  const items = q.items || [];
  const queued = items.filter((it) => it.status === 'QUEUED');
  const running = items.find((it) => it.status === 'RUNNING');

  const lines = [
    `📋 <b>[CHI TIẾT HÀNG ĐỢI XỬ LÝ]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
  ];

  if (running) {
    const prog = running.progress || {};
    const percent = prog.total > 0 ? Math.round(((prog.done || 0) / prog.total) * 100) : 0;
    lines.push(`⚡ <b>Đang thực thi:</b>`);
    lines.push(`• Link: <a href="${running.targetUrl}">${running.targetUrl}</a>`);
    lines.push(`• Tiến độ: <b>${prog.success || 0}/${prog.total || running.targetLikes}</b> like (${percent}%)`);
    lines.push(`• Cảm xúc: ${running.reactionType}`);
    lines.push(`━━━━━━━━━━━━━━━━━━`);
  } else {
    lines.push(`🟢 <i>Hiện không có đơn nào đang chạy. Hệ thống sẵn sàng!</i>`);
    lines.push(`━━━━━━━━━━━━━━━━━━`);
  }

  if (queued.length > 0) {
    lines.push(`⏳ <b>Đang xếp hàng chờ (${queued.length} bài):</b>`);
    queued.slice(0, 5).forEach((it, idx) => {
      lines.push(`${idx + 1}. <a href="${it.targetUrl}">${it.targetUrl.slice(0, 42)}...</a> (${it.targetLikes} like - ${it.reactionType})`);
    });
    if (queued.length > 5) {
      lines.push(`<i>... và còn ${queued.length - 5} bài nữa trong hàng đợi.</i>`);
    }
  } else {
    lines.push(`⏳ Hàng đợi trống (0 bài chờ).`);
  }

  return lines.join('\n');
}

// Tự động dọn dẹp các file ảnh debug / ảnh nghiệm thu cũ (> 3 ngày) tránh đầy dung lượng đĩa
function cleanOldScreenshots(maxAgeDays = 3) {
  try {
    const dirs = [
      path.join(__dirname, 'data', 'screenshots'),
      path.join(__dirname, 'data', 'debug_screens'),
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
      console.log(`[StorageCleaner] 🧹 Đã dọn dẹp ${cleaned} file ảnh chụp debug/nghiệm thu cũ (> ${maxAgeDays} ngày)`);
    }
  } catch (err) {
    console.warn('[StorageCleaner] ⚠️ Lỗi dọn dẹp ảnh cũ:', err.message);
  }
}
cleanOldScreenshots(3);
setInterval(() => cleanOldScreenshots(3), 6 * 3600 * 1000);

// Nhận lệnh /status /queue /pages /stop /resume và điều khiển 2 chiều từ Telegram
startCommandListener({
  getStatusText: buildStatusText,
  onBuffRequested: handleBuffRequestedFromTelegram,
  getPagesStats: getPagesStatsForTelegram,
  getQueueText: buildQueueText,
});

// Lấy kho kịch bản Seeding Comment có sẵn (Smart Seeding Presets)
app.get('/api/buff-seeding-presets', (req, res) => {
  return res.json({
    success: true,
    presets: fbBuffTool.SEEDING_PRESETS || [],
  });
});

// Lấy danh sách ID các Fanpage đã từng like/tương tác với bài viết mục tiêu (chống trùng lặp tức thì, gộp cả alias /share/)
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

// Lấy dữ liệu báo cáo tổng quan ngày (cho trang Săn bài & VIP Like)
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

// Bấm nút gửi báo cáo tổng kết 24h về Telegram
app.post('/api/buff-daily-report/send', async (req, res) => {
  try {
    const reportText = await buildDailyReport();
    const result = await sendAlert(reportText, { critical: true });
    return res.json({ success: true, message: 'Đã gửi báo cáo tổng kết ngày về Telegram!', result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Tổng quan sức khỏe hệ thống (truy vấn trực tiếp MySQL Workbench)
app.get('/api/buff-vias/overview', async (req, res) => {
  try {
    let totalVias = 0;
    let liveVias = 0;
    let viaRows = [];

    try {
      const allAccounts = await db.getSocialAccounts();
      const seenCUsers = new Set();
      for (const row of allAccounts) {
        // Bỏ qua Nhóm (Group) và các dòng không có cookie
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
// 8. API ROUTES - CÀI ĐẶT HỆ THỐNG & DỪNG KHẨN CẤP
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

// Token thật chỉ trả về cho ADMIN (để hiện/sửa trên giao diện); tài khoản khác chỉ thấy bản che
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
    if (!updated) return res.status(500).json({ success: false, error: 'Không lưu được file cài đặt' });
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

// Lấy lịch sử thông báo Telegram lưu trong MySQL
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

// Bắn thử các tình huống thực tế để người dùng thấy Telegram giúp gì
app.post('/api/telegram/test-scenario', async (req, res) => {
  try {
    const { scenario = 'TEST' } = req.body;
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    let text = '';

    if (scenario === 'BUFF_COMPLETED') {
      text = [
        `🎉 <b>[MÔ PHỎNG: BUFF HOÀN TẤT CHIẾN DỊCH]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `🔗 <b>Bài viết:</b> <a href="https://facebook.com/groups/947583488284655/posts/1174580982251570">Nhóm Facebook VIP 947583488...</a>`,
        `❤️ <b>Loại Reaction:</b> LIKE & LOVE (Yêu thích)`,
        `✅ <b>Thành công:</b> <b>26 / 26</b> Page (100%)`,
        `❌ <b>Thất bại:</b> 0`,
        `⏱️ <b>Thời gian xử lý:</b> 42s (2 luồng song song)`,
        `⏰ <b>Hoàn tất lúc:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `✨ <i>Chiến dịch hoàn thành xuất sắc, toàn bộ Page an toàn!</i>`,
      ].join('\n');
    } else if (scenario === 'VIA_DEAD') {
      text = [
        `⚠️ <b>[MÔ PHỎNG: CẢNH BÁO VIA DIE / CHECKPOINT]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `🚨 <b>Phát hiện tài khoản Via cần xử lý ngay:</b>`,
        `👤 <b>Tên Via:</b> (4) Facebook`,
        `🆔 <b>UID:</b> <code>100009194846268</code>`,
        `❌ <b>Trạng thái:</b> Cookie hết hạn / Yêu cầu xác minh`,
        `⏰ <b>Thời điểm phát hiện:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `🛡️ <i>Hệ thống đã tự động cách ly Via này để tránh bị khóa dàn Page con!</i>`,
      ].join('\n');
    } else if (scenario === 'EMERGENCY_STOP') {
      text = [
        `🛑 <b>[MÔ PHỎNG: BÁO ĐỘNG DỪNG KHẨN CẤP]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `👤 <b>Người kích hoạt:</b> Quản trị viên (Admin)`,
        `⚠️ <b>Lý do:</b> Kiểm tra an toàn định kỳ hệ thống`,
        `⏰ <b>Thời gian:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `⛔ <i>Tất cả trình duyệt Playwright và Hàng đợi Queue đã được đóng ngay lập tức!</i>`,
      ].join('\n');
    } else if (scenario === 'ACTION_BLOCKED') {
      text = [
        `🚨 <b>[MÔ PHỎNG: CẢNH BÁO BẢO VỆ VIA - ACTION BLOCKED]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `👤 <b>Via:</b> Thành An (<code>100023403136194</code>)`,
        `🔗 <b>Bài viết:</b> <a href="https://facebook.com/share/p/19XPWpxegi/">facebook.com/share/p/19XPWpxegi/</a>`,
        `⚠️ <b>Facebook báo:</b> "Bạn tạm thời bị chặn do sử dụng quá nhanh"`,
        `🛡️ <b>Hành động tự động:</b> Hệ thống đã TỰ ĐỘNG DỪNG khẩn cấp để bảo vệ Via không bị checkpoint!`,
        `💡 <b>Khuyến nghị:</b> Nghỉ 30-45 phút trước khi buff lại bài này, hoặc buff bài viết khác / đổi Via 2 bình thường.`,
        `⏰ <b>Thời điểm:</b> ${now}`,
        `━━━━━━━━━━━━━━━━━━`,
        `✨ <i>Thuật toán Smart Adaptive Pacing đang hoạt động để bảo vệ toàn bộ 506 Fanpage con.</i>`,
      ].join('\n');
    } else if (scenario === 'HUNTER') {
      text = [
        `🎯 <b>[MÔ PHỎNG: SĂN BÀI VIẾT MỚI THÀNH CÔNG]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `📢 <b>Nguồn theo dõi:</b> Fanpage "VIP LIKE OFFICIAL"`,
        `🔗 <b>Bài viết mới:</b> <a href="https://facebook.com/viplike/posts/123456789">facebook.com/viplike/posts/123456789</a>`,
        `⏳ <b>Kế hoạch:</b> Tự động buff 50 Like sau 3 phút nữa`,
        `⏰ <b>Phát hiện lúc:</b> ${now}`,
      ].join('\n');
    } else {
      text = [
        `🤖 <b>[TEST THÀNH CÔNG: VIP LIKE OPS BOT]</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `✅ Kết nối Telegram Bot thông suốt 100%!`,
        `⏰ Thời gian: ${now}`,
        `🛡️ <i>Dữ liệu đã được lưu trữ và kiểm soát trực tiếp trong MySQL Database!</i>`,
      ].join('\n');
    }

    const result = await sendTelegramMessage(text, 'HTML');
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.reason || 'Không gửi được tin nhắn' });
    }
    return res.json({ success: true, message: 'Đã gửi mô phỏng về Telegram và lưu vào Database!', result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-settings/test-telegram', async (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const customMsg = [
      `🤖 <b>[TEST THÀNH CÔNG: VIP LIKE OPS BOT]</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `✅ Kết nối Telegram Bot thông suốt 100%!`,
      `⏰ Thời gian: ${now}`,
      `🛡️ <i>Hệ thống giám sát và bảo vệ dàn Via & Fanpage đã sẵn sàng 24/7!</i>`,
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
          title: 'TEST THÀNH CÔNG: VIP LIKE OPS BOT',
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
      return res.status(400).json({ success: false, error: result.reason || 'Gửi thất bại' });
    }
    return res.json({ success: true, message: 'Đã gửi tin nhắn thử nghiệm thành công vào Telegram!' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/emergency-stop', (req, res) => {
  try {
    const { reason = 'Người quản trị kích hoạt DỪNG KHẨN CẤP' } = req.body;
    setEmergencyStop(true, reason);
    return res.json({ success: true, isEmergencyStopped: true, reason });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-queue/resume', (req, res) => {
  try {
    setEmergencyStop(false);
    return res.json({ success: true, isEmergencyStopped: false, message: 'Đã khôi phục hoạt động thành công' });
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
    if (!url) return res.status(400).json({ success: false, error: 'Thiếu url' });
    const normUrl = normalizeFbPostUrl(url);
    const cleared = clearPostInteractions(normUrl);
    return res.json({ success: true, cleared, normalizedUrl: normUrl });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================================
// API QUẢN LÝ BẢN QUYỀN & CHO THUÊ PHẦN MỀM (TAURI / SAAS LICENSING)
// =============================================================================

// 1. Kiểm tra trạng thái bản quyền hiện tại
// Chỉ trả về license đã gắn đúng HWID của máy gửi yêu cầu (header x-hardware-hwid)
function maskLicenseKey(key) {
  const s = String(key || '');
  return s.length <= 4 ? s : '*'.repeat(s.length - 4) + s.slice(-4);
}

app.get('/api/license/status', async (req, res) => {
  try {
    const hardwareHwid = String(req.headers['x-hardware-hwid'] || '').trim();
    const active = hardwareHwid ? await db.verifyLicenseActive(hardwareHwid) : null;
    if (!active || active.hardwareHwid !== hardwareHwid) {
      return res.json({
        success: true,
        activated: false,
        message: 'Chưa kích hoạt bản quyền hoặc đã hết hạn thuê',
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

// 2. Kích hoạt mã License mới trên máy khách
app.post('/api/license/activate', async (req, res) => {
  try {
    const { licenseKey, hardwareHwid } = req.body;
    if (!licenseKey) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp mã License Key' });
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

// 3. Admin: Danh sách tất cả khách thuê
app.get('/api/license/admin/list', requireAdmin, async (req, res) => {
  try {
    const licenses = await db.getLicenses();
    return res.json({ success: true, licenses });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Admin: Tạo mã thuê mới cho đối tác/khách hàng
app.post('/api/license/admin/create', requireAdmin, async (req, res) => {
  try {
    const { customerName, customerContact, packageType, maxVias, days, notes } = req.body;
    if (!customerName) {
      return res.status(400).json({ success: false, error: 'Tên khách hàng thuê là bắt buộc' });
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

// 5. Admin: Cập nhật trạng thái hoặc gia hạn (+30 ngày)
app.post('/api/license/admin/update-status', requireAdmin, async (req, res) => {
  try {
    const { id, status, addDays } = req.body;
    const result = await db.updateLicenseStatus(id, status, Number(addDays) || 0);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Khởi động server

// Nạp dữ liệu từ MySQL (hoặc chuyển JSON cũ lên MySQL lần đầu) rồi mới nhận request
store
  .init(db)
  .then(async (r) => {
    console.log(
      r.dbOk
        ? `[StateStore] ✅ Đã nạp dữ liệu từ MySQL${r.pendingSync.length ? ` (chờ đồng bộ: ${r.pendingSync.join(', ')})` : ''}.`
        : '[StateStore] ⚠️ MySQL không dùng được, đang chạy bằng file JSON dự phòng; sẽ tự đồng bộ lại khi MySQL sống.'
    );
    // Khởi tạo Fencing Token Epoch bền vững từ MySQL
    await initFenceEpoch();
    // Tự động kiểm tra và phục hồi các task bị treo ở trạng thái RUNNING sau khi dữ liệu MySQL đã nạp hoàn tất vào bộ nhớ!
    recoverStaleRunningQueueTasks();
    // Đồng bộ ngầm các link /share/ cũ trong sổ chống trùng về URL bài viết gốc để nhận diện trùng giữa nhiều share link
    backfillShareAliases().catch((err) => console.warn('[PagePostRegistry] ⚠️ Lỗi backfill alias:', err.message));
  })
  .catch((err) => console.error('[StateStore] ❌ Lỗi khởi tạo:', err.message));

// Tắt server: ghi nốt dữ liệu đang chờ và giải phóng locks
let isShuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Server] 🛑 Nhận tín hiệu ${sig}. Đang giải phóng lane locks và xả dữ liệu...`);
    try {
      busyBuffLanes.clear();
      buffLaneWaiters.length = 0;
      await Promise.race([store.flush(), new Promise((r) => setTimeout(r, 4000))]);
    } catch (_) {}
    process.exit(0);
  });
}

async function autoSeedPagesIfEmpty() {
  try {
    const pool = db.getPool();
    if (!pool) return;
    const [rows] = await pool.query('SELECT COUNT(*) as cnt FROM facebook_page_accesses').catch(() => [[]]);
    if (rows && rows[0]?.cnt > 0) return;

    const seedFile = path.join(__dirname, '../frontend/src/config/seedViasAndPages.json');
    if (!fs.existsSync(seedFile)) return;
    const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    console.log(`[Seed] 📦 Bắt đầu tự động nạp ${seed.totalCount} Fanpage mẫu vào MySQL...`);

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
    console.log(`[Seed] ✅ Đã nạp thành công ${seed.totalCount} Fanpage mẫu vào MySQL!`);
  } catch (err) {
    console.warn(`[Seed] ⚠️ Không tự động nạp được seed pages: ${err.message}`);
  }
}

app.listen(PORT, async () => {
  console.log(`\n================================================================`);
  console.log(`✨ VIP LIKE BACKEND ĐANG CHẠY TẠI http://localhost:${PORT}`);
  console.log(`================================================================`);

  // Kiểm tra kết nối MySQL Workbench ngay khi khởi động
  const dbStatus = await db.testConnection();
  if (dbStatus.connected) {
    console.log(`✅ Kết nối MySQL Workbench (Database: ${db.dbConfig.database}) THÀNH CÔNG!`);
    // Tự động nạp seed 508 Fanpage nếu bảng facebook_page_accesses đang trống
    autoSeedPagesIfEmpty().catch(() => {});
    // Tự động đồng bộ các chiến dịch Hàng đợi đã hoàn thành vào Lịch sử tương tác
    syncCompletedQueueTasksToBuffLogs().catch(() => {});
  } else {
    console.warn(`⚠️ MySQL Workbench chưa kết nối: ${dbStatus.error}`);
    console.warn(`👉 Kiểm tra MySQL Server (Port 3306) hoặc cấu hình trong file .env`);
  }

  // Tự động kiểm tra và phục hồi các task bị treo ở trạng thái RUNNING do khởi động lại server
  recoverStaleRunningQueueTasks();
});
