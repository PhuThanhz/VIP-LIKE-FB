/**
 * VIPLIKE RADIANT - BACKEND SERVER
 * Tích hợp trực tiếp với MySQL Workbench (autopost_saas), Playwright Automation & Gemini AI
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const db = require('./db');
const fbBuffTool = require('./fb-buff-tool');
const {
  isEmergencyStopped,
  setEmergencyStop,
  loadSettings: loadBuffSettings,
  saveSettings: saveBuffSettings,
  notifyViaDead,
  notifyBuffCompleted,
  notifyPostHunted,
  sendTelegramMessage,
} = require('./telegram-alert');
const {
  filterAvailablePagesForPost,
  getGlobalRegistryStats,
  normalizeFbPostUrl,
  clearPostInteractions,
} = require('./page-post-registry');
const { generateSeedingComments } = require('./ai-seeding');

const app = express();
const PORT = process.env.PORT || 3100;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Đảm bảo thư mục lưu trữ dữ liệu tồn tại
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const BUFF_QUEUE_FILE = path.join(DATA_DIR, 'buff_queue.json');
const BUFF_HISTORY_FILE = path.join(DATA_DIR, 'buff_history.json');
const BUFF_MONITORS_FILE = path.join(DATA_DIR, 'buff_monitors.json');

// =============================================================================
// 1. DATA HELPERS (QUEUE, HISTORY, MONITORS) - TỐI ƯU IN-MEMORY & DEBOUNCED I/O
// =============================================================================

let cachedBuffQueue = null;
let saveQueueTimer = null;

function loadBuffQueue() {
  if (cachedBuffQueue) return cachedBuffQueue;
  try {
    if (fs.existsSync(BUFF_QUEUE_FILE)) {
      const data = JSON.parse(fs.readFileSync(BUFF_QUEUE_FILE, 'utf-8'));
      if (Array.isArray(data.items)) {
        cachedBuffQueue = data;
        return cachedBuffQueue;
      }
    }
  } catch (e) {
    console.warn('[BuffQueue] ⚠️ Không đọc được queue, khởi tạo lại:', e.message);
  }
  cachedBuffQueue = { items: [] };
  return cachedBuffQueue;
}

function saveBuffQueue(queueData) {
  cachedBuffQueue = queueData;
  if (saveQueueTimer) clearTimeout(saveQueueTimer);
  saveQueueTimer = setTimeout(() => {
    try {
      const tmp = `${BUFF_QUEUE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cachedBuffQueue, null, 2));
      fs.renameSync(tmp, BUFF_QUEUE_FILE);
    } catch (e) {
      console.warn('[BuffQueue] ⚠️ Lỗi lưu file hàng đợi:', e.message);
    }
  }, 200);
}

let cachedBuffHistory = null;
let saveHistoryTimer = null;

function loadBuffHistory() {
  if (cachedBuffHistory) return cachedBuffHistory;
  try {
    if (fs.existsSync(BUFF_HISTORY_FILE)) {
      cachedBuffHistory = JSON.parse(fs.readFileSync(BUFF_HISTORY_FILE, 'utf-8'));
      return cachedBuffHistory;
    }
  } catch (e) {
    console.warn('[BuffHistory] ⚠️ Không đọc được history:', e.message);
  }
  cachedBuffHistory = {};
  return cachedBuffHistory;
}

function saveBuffHistory(historyData) {
  cachedBuffHistory = historyData;
  if (saveHistoryTimer) clearTimeout(saveHistoryTimer);
  saveHistoryTimer = setTimeout(() => {
    try {
      const tmp = `${BUFF_HISTORY_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cachedBuffHistory, null, 2));
      fs.renameSync(tmp, BUFF_HISTORY_FILE);
    } catch (e) {
      console.warn('[BuffHistory] ⚠️ Lỗi lưu file history:', e.message);
    }
  }, 300);
}


function loadBuffMonitors() {
  try {
    if (fs.existsSync(BUFF_MONITORS_FILE)) {
      const data = JSON.parse(fs.readFileSync(BUFF_MONITORS_FILE, 'utf-8'));
      if (Array.isArray(data.monitors)) return data;
    }
  } catch (e) {
    console.warn('[PostHunter] ⚠️ Không đọc được file monitors:', e.message);
  }
  return { monitors: [] };
}

function saveBuffMonitors(data) {
  try {
    const tmp = `${BUFF_MONITORS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, BUFF_MONITORS_FILE);
  } catch (e) {
    console.warn('[PostHunter] ⚠️ Lỗi lưu file monitors:', e.message);
  }
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
const MAX_PARALLEL_BUFF = 2;
const busyBuffLanes = new Set();
const buffLaneWaiters = [];

function getBuffParallelVias() {
  const n = parseInt(loadBuffSettings().buffParallelVias, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : 4;
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
      waiter.reject(new Error('Dừng khẩn cấp'));
      continue;
    }
    if (busyBuffLanes.has(waiter.uid)) continue;
    buffLaneWaiters.splice(i--, 1);
    busyBuffLanes.add(waiter.uid);
    waiter.resolve();
  }
}

async function withBuffLane(uid, fn) {
  const key = uid || 'unknown';
  await new Promise((resolve, reject) => {
    buffLaneWaiters.push({ uid: key, resolve, reject });
    pumpBuffLanes();
  });
  try {
    return await fn();
  } finally {
    busyBuffLanes.delete(key);
    pumpBuffLanes();
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

function markBuffViaDeadIfCookieError(via, err) {
  if (!via?.uid || !DEAD_VIA_ERR_RE.test(err?.message || '')) return false;
  deadBuffVias.set(via.uid, Date.now() + DEAD_VIA_TTL_MS);
  console.warn(`[BuffQueue] 🚫 Via ${via.viaName} (UID ${via.uid}) lỗi cookie/checkpoint → tạm bỏ qua 1h.`);
  return true;
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

// =============================================================================
// 3. API ROUTES - MYSQL WORKBENCH DATABASE
// =============================================================================

// Kiểm tra kết nối tới MySQL Workbench
app.get('/api/db/test', async (req, res) => {
  const result = await db.testConnection();
  return res.json(result);
});

// Lấy danh sách toàn bộ tài khoản Via & Fanpage từ MySQL Workbench
app.get('/api/connections', async (req, res) => {
  try {
    const accounts = await db.getSocialAccounts();
    return res.json(accounts);
  } catch (err) {
    console.error('[API /connections] ❌ Lỗi:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Thêm tài khoản Via mới vào MySQL Workbench
app.post('/api/connections', async (req, res) => {
  try {
    const {
      pageName = '',
      cookieString = '',
      proxyUrl = '',
      platform = 'FACEBOOK_PROFILE',
      accountType = 'PERSONAL_PROFILE_COOKIE',
    } = req.body;

    if (!cookieString) {
      return res.status(400).json({ success: false, error: 'Thiếu Cookie Facebook (cookieString)' });
    }

    const created = await db.addSocialAccount({
      pageName,
      cookieString,
      proxyUrl,
      platform,
      accountType,
    });

    return res.json({ success: true, account: created });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật tài khoản trong MySQL Workbench
app.put('/api/connections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { pageName, cookieString, proxyUrl, tokenStatus } = req.body;
    await db.updateSocialAccount(id, { pageName, cookieString, proxyUrl, tokenStatus });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Xóa tài khoản khỏi MySQL Workbench
app.delete('/api/connections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteSocialAccount(id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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

// Lấy danh sách Fanpage đã cache từ trước
app.get('/api/buff-cached-pages', (req, res) => {
  try {
    const { uid } = req.query;
    if (uid) {
      const pages = fbBuffTool.getCachedPages(String(uid)) || [];
      return res.json({ success: true, uid, count: pages.length, pages });
    }
    const allCache = fbBuffTool.loadPagesCache();
    return res.json({ success: true, cache: allCache });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lưu / cập nhật thủ công danh sách Page vào cache
app.post('/api/buff-cache-pages', (req, res) => {
  try {
    const { uid, pages, viaName = '' } = req.body;
    if (!uid || !Array.isArray(pages)) {
      return res.status(400).json({ success: false, error: 'Thiếu uid hoặc pages' });
    }
    fbBuffTool.setCachedPages(String(uid), pages, viaName);
    return res.json({ success: true, message: `Đã lưu cache ${pages.length} Page cho UID ${uid}` });
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

// Buff Like & Comment (Đồng bộ)
app.post('/api/buff-like', async (req, res) => {
  const {
    cookieString,
    targetUrl,
    reactionType = 'LIKE',
    selectedPages = [],
    delayMs = 1500,
    enableLike = true,
    enableComment = false,
    enableHumanBehavior = true,
    fastSwitch = true,
    cooldownEvery = 15,
    cooldownDurationMs = 3500,
    comments = [],
    proxyUrl: explicitProxy = '',
  } = req.body;

  if (!cookieString || !targetUrl) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc targetUrl' });
  }

  try {
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const laneUid = fbBuffTool.getUserIdFromCookie(cookieString);
    const result = await withBuffLane(laneUid, () =>
      fbBuffTool.buffLikesWithPages(cookieString, targetUrl, {
        reactionType,
        selectedPages,
        delayMs,
        enableLike,
        enableComment,
        enableHumanBehavior,
        fastSwitch,
        cooldownEvery,
        cooldownDurationMs,
        comments,
        proxyUrl,
      })
    );
    return res.json({ success: true, result });
  } catch (err) {
    console.error('[Buff API] ❌ Lỗi Buff Like/Comment:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Buff Like & Comment Stream thời gian thực (SSE)
app.post('/api/buff-like-stream', async (req, res) => {
  const {
    cookieString,
    targetUrl,
    reactionType = 'LIKE',
    selectedPages = [],
    delayMs = 1500,
    enableLike = true,
    enableComment = false,
    enableHumanBehavior = true,
    fastSwitch = true,
    cooldownEvery = 15,
    cooldownDurationMs = 3500,
    comments = [],
    proxyUrl: explicitProxy = '',
  } = req.body;

  if (!cookieString || !targetUrl) {
    return res.status(400).json({ success: false, error: 'Thiếu cookieString hoặc targetUrl' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let clientGone = false;
  res.on('close', () => {
    if (!res.writableFinished) {
      clientGone = true;
      console.log('[BuffStream] 🔌 Client đã ngắt kết nối SSE.');
    }
  });

  const sendEvent = (event, data) => {
    if (clientGone || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {}
  };

  try {
    const proxyUrl = await resolveViaProxy(cookieString, explicitProxy);
    const laneUid = fbBuffTool.getUserIdFromCookie(cookieString);

    const result = await withBuffLane(laneUid, () =>
      fbBuffTool.buffLikesWithPages(cookieString, targetUrl, {
        reactionType,
        selectedPages,
        delayMs,
        enableLike,
        enableComment,
        enableHumanBehavior,
        fastSwitch,
        cooldownEvery,
        cooldownDurationMs,
        comments,
        proxyUrl,
        shouldStop: () => clientGone || isEmergencyStopped(),
        onProgress: (evt) => {
          sendEvent('progress', evt);
        },
      })
    );

    sendEvent('done', { result });
    res.end();
  } catch (err) {
    console.error('[BuffStream] ❌ Lỗi stream:', err.message);
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

  if (history[normUrl]) {
    return { skipped: true, history: history[normUrl] };
  }

  const existing = queueData.items.find((it) => it.normalizedUrl === normUrl && it.status !== 'FAILED');
  if (existing) {
    return { alreadyQueued: true, task: existing };
  }

  const delayMin = parseDelayMinutes(taskPayload.delayMinutes);
  const newTask = {
    id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    source: taskPayload.source || 'MANUAL',
    targetUrl: taskPayload.targetUrl,
    normalizedUrl: normUrl,
    targetLikes: parseTargetLikes(taskPayload.targetLikes),
    reactionType: taskPayload.reactionType || 'RANDOM_POSITIVE',
    enableLike: taskPayload.enableLike !== false,
    enableComment: Boolean(taskPayload.enableComment),
    comments: Array.isArray(taskPayload.comments) ? taskPayload.comments : [],
    delayMinutes: delayMin,
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
    return res.json({ success: true, task: result.task });
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
    return res.json({
      success: true,
      queue: queueData.items || [],
      historyCount: Object.keys(history).length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/buff-queue/remove/:id', (req, res) => {
  try {
    const { id } = req.params;
    const queueData = loadBuffQueue();
    const prevLen = queueData.items.length;
    queueData.items = queueData.items.filter((it) => it.id !== id);
    saveBuffQueue(queueData);
    return res.json({ success: true, deleted: queueData.items.length < prevLen });
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

    task.runAfter = new Date().toISOString();
    task.status = 'QUEUED';
    task.error = null;
    saveBuffQueue(queueData);

    setImmediate(runQueueWorker);

    return res.json({ success: true, message: 'Đã đưa task vào hàng đợi chạy lại!', task });
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
  currentTask.startedAt = new Date().toISOString();
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

    let allAvailablePages = [];
    for (const via of targetVias) {
      if (isEmergencyStopped()) break;
      const uid = via.uid || fbBuffTool.getUserIdFromCookie(via.cookieString);
      let pages = fbBuffTool.getCachedPages(uid);
      if (!pages || pages.length === 0) {
        try {
          pages = await fbBuffTool.getManagedPages(via.cookieString, {
            forceRefresh: false,
            viaName: via.viaName,
            proxyUrl: via.proxyUrl,
          });
        } catch (e) {
          console.warn(`[BuffQueue Worker] ⚠️ Không lấy được page từ via ${via.viaName}:`, e.message);
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

    const maxPages = getMaxPagesPerPost();
    const desiredLikes =
      task.targetLikes === 'ALL'
        ? Math.min(allAvailablePages.length, maxPages)
        : Math.min(task.targetLikes || 30, allAvailablePages.length);

    const pagesToBuff = allAvailablePages.slice(0, desiredLikes);

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

    let totalSuccess = 0;
    let totalFailed = 0;
    let totalDone = 0;

    for (const group of viaGroupsMap.values()) {
      if (isEmergencyStopped()) break;
      const laneUid = fbBuffTool.getUserIdFromCookie(group.cookieString);
      const res = await withBuffLane(laneUid, () =>
        fbBuffTool.buffLikesWithPages(group.cookieString, task.targetUrl, {
          reactionType: task.reactionType || 'RANDOM_POSITIVE',
          selectedPages: group.pages,
          delayMs: 3500,
          enableLike: task.enableLike !== false,
          enableComment: Boolean(task.enableComment),
          enableHumanBehavior: true,
          fastSwitch: true,
          cooldownEvery: 15,
          cooldownDurationMs: 4000,
          comments: task.comments || [],
          proxyUrl: group.proxyUrl,
          shouldStop: () => isEmergencyStopped(),
          onProgress: (ev) => {
            if (ev.type === 'PAGE_FINISH') {
              totalDone++;
              if (ev.status === 'SUCCESS') totalSuccess++;
              else if (ev.status === 'ERROR' || ev.status === 'FAILED') totalFailed++;

              const qd = loadBuffQueue();
              const t = qd.items.find((it) => it.id === task.id);
              if (t) {
                t.progress = { done: totalDone, total: pagesToBuff.length, success: totalSuccess };
                saveBuffQueue(qd);
              }
            }
          },
        })
      );

      if (res) {
        totalSuccess += res.success || 0;
        totalFailed += res.failed || 0;
      }
    }

    const durationSec = Math.round((Date.now() - startTime) / 1000);

    const qd = loadBuffQueue();
    const t = qd.items.find((it) => it.id === task.id);
    if (t) {
      t.status = isEmergencyStopped() ? 'STOPPED' : 'COMPLETED';
      t.finishedAt = new Date().toISOString();
      t.result = {
        total: pagesToBuff.length,
        success: totalSuccess,
        failed: totalFailed,
        durationSec,
      };
      saveBuffQueue(qd);
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

    notifyBuffCompleted({
      targetUrl: task.targetUrl,
      success: totalSuccess,
      total: pagesToBuff.length,
      failed: totalFailed,
      durationSec,
      reactionType: task.reactionType,
    }).catch(() => {});

    console.log(`[BuffQueue Worker] ✅ Hoàn tất Task ${task.id}: Thành công ${totalSuccess}/${pagesToBuff.length} (${durationSec}s)`);
  } catch (err) {
    console.error(`[BuffQueue Worker] ❌ Task ${task.id} lỗi:`, err.message);
    const qd = loadBuffQueue();
    const t = qd.items.find((it) => it.id === task.id);
    if (t) {
      t.status = 'FAILED';
      t.finishedAt = new Date().toISOString();
      t.error = err.message;
      t.attempts = (t.attempts || 0) + 1;
      saveBuffQueue(qd);
    }
  } finally {
    activeBuffTaskIds.delete(task.id);
  }
}

async function runQueueWorker() {
  if (isEmergencyStopped()) return;
  if (activeBuffTaskIds.size >= MAX_PARALLEL_BUFF) return;

  const queueData = loadBuffQueue();
  const now = new Date();

  const taskToRun = (queueData.items || []).find(
    (it) => it.status === 'QUEUED' && new Date(it.runAfter) <= now && !activeBuffTaskIds.has(it.id)
  );

  if (taskToRun) {
    executeQueueTask(taskToRun);
  }
}

// Chạy vòng lặp kiểm tra hàng đợi mỗi 6 giây
setInterval(runQueueWorker, 6000);

app.post('/api/buff-queue/clear-completed', (req, res) => {
  try {
    const queueData = loadBuffQueue();
    const prevLen = queueData.items.length;
    queueData.items = queueData.items.filter((it) => it.status === 'QUEUED' || it.status === 'RUNNING');
    saveBuffQueue(queueData);
    return res.json({ success: true, cleared: prevLen - queueData.items.length });
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
      queueCount: (queueData.items || []).filter((it) => it.status === 'QUEUED').length,
      historyCount: Object.keys(history).length,
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
      checkIntervalMinutes: parseInt(checkIntervalMinutes, 10) || 10,
      buffConfig: {
        targetLikes: parseTargetLikes(buffConfig.targetLikes, 'ALL'),
        reactionType: buffConfig.reactionType || 'RANDOM_POSITIVE',
        enableLike: buffConfig.enableLike !== false,
        enableComment: Boolean(buffConfig.enableComment),
        comments: Array.isArray(buffConfig.comments) ? buffConfig.comments : [],
        delayMinutes: parseDelayMinutes(buffConfig.delayMinutes),
        viaMode: buffConfig.viaMode || 'ALL_VIAS',
        cookieString: buffConfig.cookieString || '',
      },
      status: 'ACTIVE',
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

    const posts = await fbBuffTool.scanTargetForPosts(String(targetUrl).trim(), {
      cookieStr: cookieString,
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
      total: annotatedPosts.length,
      posts: annotatedPosts,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Quét mục tiêu và nạp bài viết mới vào hàng đợi
async function scanMonitorTarget(monitorId) {
  const data = loadBuffMonitors();
  const mon = data.monitors.find((m) => m.id === monitorId);
  if (!mon) throw new Error('Không tìm thấy mục tiêu theo dõi');

  const history = loadBuffHistory();

  let cookieStr = mon.buffConfig?.cookieString || '';
  let proxyUrl = '';
  if (!cookieStr) {
    const liveVias = await db.getLiveVias();
    if (liveVias.length > 0) {
      cookieStr = liveVias[0].cookieString;
      proxyUrl = liveVias[0].proxyUrl || '';
    }
  }

  const posts = await fbBuffTool.scanTargetForPosts(mon.targetUrl, {
    cookieStr,
    proxyUrl,
    maxPosts: 8,
  });

  const postsFound = posts.length;
  mon.lastCheckedAt = new Date().toISOString();
  mon.lastPostsFound = postsFound;

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
    if (!mon.seenPostUrls.includes(normUrl) && !history[normUrl]) {
      newPosts.push(post);
      mon.seenPostUrls.push(normUrl);
    }
  }

  let newPostsEnqueued = 0;
  for (const newPost of newPosts) {
    const queuePayload = {
      source: `POST_HUNTER:${mon.targetName || mon.id}`,
      targetUrl: newPost.url,
      targetLikes: mon.buffConfig?.targetLikes || 30,
      reactionType: mon.buffConfig?.reactionType || 'RANDOM_POSITIVE',
      enableLike: mon.buffConfig?.enableLike !== false,
      enableComment: Boolean(mon.buffConfig?.enableComment),
      comments: mon.buffConfig?.comments || [],
      delayMinutes: mon.buffConfig?.delayMinutes ?? 3,
      cookieString: mon.buffConfig?.viaMode || 'ALL_VIAS',
    };

    const addRes = addBuffQueueTask(queuePayload);
    if (addRes.task) {
      newPostsEnqueued++;
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
    const { id } = req.params;
    const result = await scanMonitorTarget(id);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error(`[PostHunter] ❌ Lỗi quét mục tiêu ${req.params.id}:`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Post Hunter Background Scheduler
let isHunterScanning = false;
async function runHunterScheduler() {
  if (isHunterScanning || isEmergencyStopped()) return;
  const data = loadBuffMonitors();
  const activeMonitors = (data.monitors || []).filter((m) => m.status === 'ACTIVE');
  if (activeMonitors.length === 0) return;

  const now = Date.now();
  for (const mon of activeMonitors) {
    if (isEmergencyStopped()) break;
    const intervalMs = Math.max(1, mon.checkIntervalMinutes || 10) * 60 * 1000;
    const lastChecked = mon.lastCheckedAt ? new Date(mon.lastCheckedAt).getTime() : 0;
    if (now - lastChecked >= intervalMs) {
      isHunterScanning = true;
      try {
        console.log(`[PostHunter Scheduler] ⏰ Đến lịch quét mục tiêu: ${mon.targetName} (${mon.targetUrl})`);
        await scanMonitorTarget(mon.id);
      } catch (err) {
        console.warn(`[PostHunter Scheduler] ⚠️ Quét mục tiêu ${mon.targetName} lỗi:`, err.message);
      } finally {
        isHunterScanning = false;
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

// Chạy Hunter Scheduler kiểm tra mỗi 30 giây
setInterval(runHunterScheduler, 30000);

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

// Kiểm tra sức khỏe dàn Via và CẬP NHẬT TRỰC TIẾP vào MySQL Workbench (social_accounts)
app.post('/api/buff-vias/health-check', async (req, res) => {
  try {
    const { cookieString, viaId } = req.body;
    let targetVias = [];

    if (cookieString) {
      targetVias.push({
        id: viaId || 'custom',
        viaName: 'Via Kiểm Tra',
        cookieString: String(cookieString).trim(),
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
        const m = (row.cookieString || '').match(/(?:^|;\s*)c_user=([^;]+)/);
        const uid = m ? m[1] : `id_${row.id}`;
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

function publicBuffSettings(s) {
  const maskedToken = s.telegramBotToken
    ? `${s.telegramBotToken.slice(0, 6)}...${s.telegramBotToken.slice(-4)}`
    : '';
  return {
    ...s,
    telegramBotToken: '',
    telegramBotTokenMasked: maskedToken,
    hasBotToken: Boolean(s.telegramBotToken),
  };
}

app.get('/api/buff-settings', (req, res) => {
  try {
    return res.json({ success: true, settings: publicBuffSettings(loadBuffSettings()) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-settings', (req, res) => {
  try {
    const updated = saveBuffSettings(req.body);
    if (!updated) return res.status(500).json({ success: false, error: 'Không lưu được file cài đặt' });
    return res.json({ success: true, settings: publicBuffSettings(updated) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/buff-settings/test-telegram', async (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    const customMsg = [
      `🤖 <b>[TEST THÀNH CÔNG: VIPLIKE RADIANT OPS BOT]</b>`,
      `━━━━━━━━━━━━━━━━━━`,
      `✅ Kết nối Telegram Bot thông suốt 100%!`,
      `⏰ Thời gian: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
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
app.get('/api/license/status', async (req, res) => {
  try {
    const licenses = await db.getLicenses();
    const active = licenses.find((l) => l.status === 'ACTIVE');
    if (!active) {
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
        licenseKey: active.licenseKey,
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
app.get('/api/license/admin/list', async (req, res) => {
  try {
    const licenses = await db.getLicenses();
    return res.json({ success: true, licenses });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Admin: Tạo mã thuê mới cho đối tác/khách hàng
app.post('/api/license/admin/create', async (req, res) => {
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
app.post('/api/license/admin/update-status', async (req, res) => {
  try {
    const { id, status, addDays } = req.body;
    const result = await db.updateLicenseStatus(id, status, Number(addDays) || 0);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Khởi động server

app.listen(PORT, async () => {
  console.log(`\n================================================================`);
  console.log(`✨ VIPLIKE RADIANT BACKEND ĐANG CHẠY TẠI http://localhost:${PORT}`);
  console.log(`================================================================`);

  // Kiểm tra kết nối MySQL Workbench ngay khi khởi động
  const dbStatus = await db.testConnection();
  if (dbStatus.connected) {
    console.log(`✅ Kết nối MySQL Workbench (Database: ${db.dbConfig.database}) THÀNH CÔNG!`);
  } else {
    console.warn(`⚠️ MySQL Workbench chưa kết nối: ${dbStatus.error}`);
    console.warn(`👉 Kiểm tra MySQL Server (Port 3306) hoặc cấu hình trong file .env`);
  }
});
