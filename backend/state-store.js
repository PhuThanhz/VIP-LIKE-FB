/**
 * Kho trạng thái dùng chung: MySQL là nguồn chính, file JSON là bản dự phòng.
 *
 *  - Đọc luôn đồng bộ, lấy từ bộ nhớ (giữ nguyên cách code cũ đang dùng).
 *  - Ghi: cập nhật bộ nhớ → ghi file JSON → đẩy lên MySQL (gộp theo thời gian).
 *  - Khởi động (init): lấy từ MySQL; nếu MySQL chưa có thì chuyển (migrate) dữ liệu JSON cũ lên;
 *    nếu file mới hơn MySQL (do MySQL từng lỗi) thì dùng file và đẩy ngược lên MySQL.
 *  - MySQL lỗi: vẫn chạy bằng JSON, tự thử đồng bộ lại mỗi phút.
 */
const fs = require('fs');
const path = require('path');

/** key → { file, default, flushMs } */
const KEYS = {
  users: { file: 'users.json', default: () => [], flushMs: 300 },
  system_settings: { file: 'system_settings.json', default: () => ({}), flushMs: 300 },
  buff_queue: { file: 'buff_queue.json', default: () => ({ items: [] }), flushMs: 1500 },
  buff_history: { file: 'buff_history.json', default: () => ({}), flushMs: 1500 },
  buff_monitors: { file: 'buff_monitors.json', default: () => ({ monitors: [] }), flushMs: 800 },
  page_post_registry: { file: 'page_post_registry.json', default: () => ({}), flushMs: 5000 },
  post_url_aliases: { file: 'post_url_aliases.json', default: () => ({}), flushMs: 5000 },
  pages_cache: { file: 'pages_cache.json', default: () => ({}), flushMs: 1500 },
  page_usage: { file: 'page_usage.json', default: () => ({}), flushMs: 5000 },
};

const FILE_NEWER_TOLERANCE_MS = 5000;
const RETRY_INTERVAL_MS = 60 * 1000;

function createStateStore({ dataDir = path.join(__dirname, 'data'), keys = KEYS, log = console } = {}) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const cache = new Map(); // key → object đang dùng
  const dirty = new Set(); // key chưa đẩy được lên MySQL
  const timers = new Map();
  let db = null;
  let ready = false;
  let retryTimer = null;
  let lastWarnAt = 0;

  const filePath = (key) => path.join(dataDir, keys[key].file);

  function warnOnce(msg) {
    if (Date.now() - lastWarnAt > 60 * 1000) {
      lastWarnAt = Date.now();
      log.warn(msg);
    }
  }

  /** Đọc file JSON; file hỏng được đổi tên để giữ lại, không ghi đè. */
  function readFile(key) {
    const fp = filePath(key);
    if (!fs.existsSync(fp)) return null;
    try {
      return { value: JSON.parse(fs.readFileSync(fp, 'utf-8')), mtimeMs: fs.statSync(fp).mtimeMs };
    } catch (e) {
      const backup = `${fp}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(fp, backup);
      } catch (_) {}
      log.error(`[StateStore] ❌ ${keys[key].file} bị lỗi định dạng (${e.message}); đã giữ lại bản sao ${path.basename(backup)}`);
      return null;
    }
  }

  function writeFile(key, value) {
    if (db) return; // Đã có MySQL Workbench làm nguồn chính, không cần ghi file JSON
    try {
      const fp = filePath(key);
      const tmp = `${fp}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
      fs.renameSync(tmp, fp);
    } catch (_) {}
  }

  async function pushToDb(key) {
    if (!db) return false;
    try {
      await db.saveAppState(key, JSON.stringify(cache.get(key)));
      dirty.delete(key);
      return true;
    } catch (e) {
      dirty.add(key);
      warnOnce(`[StateStore] ⚠️ Chưa lưu được "${key}" lên MySQL: ${e.message}`);
      return false;
    }
  }

  function startRetryLoop() {
    if (retryTimer) return;
    retryTimer = setInterval(async () => {
      if (dirty.size === 0) return;
      for (const key of [...dirty]) await pushToDb(key);
    }, RETRY_INTERVAL_MS);
    retryTimer.unref?.();
  }

  /** Gọi 1 lần lúc khởi động, trước khi nhận request / chạy tác vụ nền. */
  async function init(database) {
    db = database;
    let dbOk = true;
    try {
      await db.ensureAppStateTable();
    } catch (e) {
      dbOk = false;
      log.warn(`[StateStore] ⚠️ Không tạo/kiểm tra được bảng app_state: ${e.message}`);
    }

    for (const key of Object.keys(keys)) {
      const file = readFile(key);
      let row = null;
      if (dbOk) {
        try {
          row = await db.getAppState(key);
        } catch (e) {
          dbOk = false;
          log.warn(`[StateStore] ⚠️ Không đọc được "${key}" từ MySQL: ${e.message}`);
        }
      }

      let dbValue = null;
      if (row) {
        try {
          dbValue = JSON.parse(row.value);
        } catch (e) {
          log.error(`[StateStore] ❌ Dữ liệu "${key}" trên MySQL bị lỗi định dạng: ${e.message}`);
        }
      }

      if (dbValue !== null) {
        cache.set(key, dbValue);
      } else if (file) {
        cache.set(key, file.value);
        if (dbOk) {
          log.log(`[StateStore] 📦 Chuyển "${key}" từ JSON lên MySQL (lần đầu).`);
          dirty.add(key);
        }
      } else {
        cache.set(key, keys[key].default());
      }
    }

    for (const key of [...dirty]) await pushToDb(key);
    startRetryLoop();
    ready = true;
    return { dbOk, pendingSync: [...dirty] };
  }

  /** Đọc đồng bộ. Trước khi init xong chỉ đọc file (không lưu vào bộ nhớ) để không lệch dữ liệu. */
  function read(key) {
    if (!keys[key]) throw new Error(`Khóa không tồn tại: ${key}`);
    if (cache.has(key)) return cache.get(key);
    const file = readFile(key);
    return file ? file.value : keys[key].default();
  }

  /** Ghi: bộ nhớ + file (gộp theo thời gian) + MySQL. */
  function write(key, value) {
    if (!keys[key]) throw new Error(`Khóa không tồn tại: ${key}`);
    cache.set(key, value);
    dirty.add(key);
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        try {
          writeFile(key, cache.get(key));
        } catch (e) {
          log.warn(`[StateStore] ⚠️ Lỗi ghi file ${keys[key].file}: ${e.message}`);
        }
        if (ready) pushToDb(key);
      }, keys[key].flushMs)
    );
    return value;
  }

  /** Ghi ngay mọi thay đổi đang chờ (dùng khi tắt server). */
  async function flush() {
    for (const [key, t] of timers) {
      clearTimeout(t);
      timers.delete(key);
      try {
        writeFile(key, cache.get(key));
      } catch (_) {}
    }
    for (const key of [...dirty]) await pushToDb(key);
  }

  return { init, read, write, flush, isReady: () => ready, pendingKeys: () => [...dirty], _cache: cache };
}

const defaultStore = createStateStore();
module.exports = defaultStore;
module.exports.createStateStore = createStateStore;
module.exports.KEYS = KEYS;
