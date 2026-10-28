const fs = require('fs');
const path = require('path');
const axios = require('axios');
const store = require('./state-store');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DEFAULT_SETTINGS = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  notifyOnViaDead: true,
  notifyOnHunter: true,
  notifyOnBuffDone: true,
  notifyOnQueueIssue: true,
  // Giờ yên tĩnh: trong khung này chỉ gửi tin nghiêm trọng, tin còn lại được gom lại gửi sau
  quietHoursEnabled: false,
  quietStart: '23:00',
  quietEnd: '07:00',
  // Báo cáo tổng kết hằng ngày
  dailyReportEnabled: true,
  dailyReportHour: 8,
  lastDailyReportDate: '',
  // Cho phép nhắn lệnh /status /stop /resume cho bot (chỉ nhận từ đúng Chat ID đã cấu hình)
  telegramCommands: true,
  maxDailyPageActions: 25,
  // Tự buff bài do chính app vừa đăng (Fanpage / Group) xoay vòng page của mọi via
  autoBuffOwnPosts: false,
  autoBuffOwnFanpage: true,
  autoBuffOwnGroup: true,
  autoBuffDelayMinutes: 3,
  autoBuffReaction: 'RANDOM_POSITIVE',
  // Quy mô lớn (1000+ page): số page tối đa cho 1 bài khi chọn "xoay vòng", số via chạy song song
  maxPagesPerPost: 150,
  buffParallelVias: 4,
  isEmergencyStopped: false,
  emergencyReason: '',
  emergencyStoppedAt: null,
  proxyPool: [],
};

function loadSettings() {
  try {
    const data = store.read('system_settings');
    return { ...DEFAULT_SETTINGS, ...(data && typeof data === 'object' ? data : {}) };
  } catch (err) {
    console.warn(`[Settings] ⚠️ Lỗi đọc cài đặt: ${err.message}`);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    const current = loadSettings();
    const incoming = { ...settings };
    // Các trường chỉ để hiển thị (do publicBuffSettings sinh ra) không được lưu
    delete incoming.telegramBotTokenMasked;
    delete incoming.hasBotToken;
    delete incoming.botInfo;
    // API không bao giờ trả token thật về giao diện, nên token rỗng nghĩa là "giữ nguyên", không phải "xoá"
    if (!incoming.telegramBotToken) delete incoming.telegramBotToken;
    const updated = { ...current, ...incoming };
    store.write('system_settings', updated);
    try {
      const db = require('./db');
      db.syncTelegramSettingsToDb(updated).catch(() => {});
    } catch (_) {}
    return updated;
  } catch (err) {
    console.error(`[Settings] ❌ Lỗi ghi cài đặt: ${err.message}`);
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Gửi 1 tin; thử lại tối đa 2 lần khi lỗi mạng / Telegram quá tải (5xx, 429) */
async function sendTelegramMessage(text, parseMode = 'HTML') {
  const settings = loadSettings();
  const token = settings.telegramBotToken;
  const chatId = settings.telegramChatId;

  if (!token || !chatId) {
    return { success: false, reason: 'Chưa cấu hình Telegram Bot Token hoặc Chat ID' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const maxAttempts = 3;
  let lastErr = '';

  const cleanText = (text || '').replace(/<[^>]*>/g, '');
  const firstLine = (text || '').split('\n')[0]?.replace(/<[^>]*>/g, '')?.trim() || 'Thông báo Telegram';
  let eventType = 'GENERAL';
  const upper = (text || '').toUpperCase();
  if (upper.includes('BUFF HOÀN TẤT') || upper.includes('CHIẾN DỊCH')) eventType = 'BUFF_COMPLETED';
  else if (upper.includes('CHECKPOINT') || (upper.includes('VIA') && upper.includes('HẾT HẠN'))) eventType = 'VIA_DEAD';
  else if (upper.includes('KHẨN CẤP') || upper.includes('DỪNG')) eventType = 'EMERGENCY_STOP';
  else if (upper.includes('BÀI VIẾT MỚI') || upper.includes('HUNTER')) eventType = 'HUNTER';
  else if (upper.includes('HÀNG ĐỢI')) eventType = 'QUEUE_IDLE';
  else if (upper.includes('TEST') || upper.includes('XÁC NHẬN KẾT NỐI')) eventType = 'TEST';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(
        url,
        { chat_id: chatId, text, parse_mode: parseMode, disable_web_page_preview: true },
        { timeout: 8000 }
      );
      const msgId = res.data?.result?.message_id || null;
      try {
        const db = require('./db');
        await db.saveTelegramNotification({
          chatId,
          eventType,
          title: firstLine,
          message: cleanText,
          status: 'SENT',
          telegramMessageId: msgId,
        });
      } catch {}
      return { success: true, data: res.data };
    } catch (err) {
      const status = err.response?.status;
      lastErr = err.response?.data?.description || err.message;
      const retryable = !status || status >= 500 || status === 429;
      if (!retryable || attempt === maxAttempts) break;
      const wait = status === 429 ? (err.response?.data?.parameters?.retry_after || 3) * 1000 : attempt * 1500;
      await sleep(Math.min(wait, 10000));
    }
  }
  console.warn(`[Telegram] ⚠️ Không gửi được tin nhắn: ${lastErr}`);
  try {
    const db = require('./db');
    await db.saveTelegramNotification({
      chatId,
      eventType,
      title: firstLine,
      message: cleanText,
      status: 'FAILED',
      errorMessage: lastErr,
    });
  } catch {}
  return { success: false, reason: lastErr };
}

// ---------------------------------------------------------------------------
// GIỜ YÊN TĨNH + GOM TIN
// ---------------------------------------------------------------------------
const DIGEST_MIN_AGE_MS = 20 * 1000; // chờ 20s để gom các tin xuất hiện gần nhau
const TELEGRAM_MAX_CHARS = 3800;
let pendingDigest = [];

function toMinutes(hhmm, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return fallback;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

/** Đang trong giờ yên tĩnh không? (hỗ trợ khung qua nửa đêm, ví dụ 23:00–07:00) */
function isQuietNow(settings = loadSettings(), now = new Date()) {
  if (!settings.quietHoursEnabled) return false;
  const start = toMinutes(settings.quietStart, 23 * 60);
  const end = toMinutes(settings.quietEnd, 7 * 60);
  if (start === end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

/**
 * Gửi thông báo. critical=true → gửi ngay kể cả giờ yên tĩnh.
 * Tin thường được đưa vào hộp chờ và gom lại (xem flushDigest).
 */
function sendAlert(text, { critical = false } = {}) {
  if (critical) return sendTelegramMessage(text);
  const settings = loadSettings();
  if (!settings.telegramBotToken || !settings.telegramChatId) {
    return Promise.resolve({ success: false, reason: 'Chưa cấu hình Telegram' });
  }
  pendingDigest.push({ text, at: Date.now() });
  return Promise.resolve({ success: true, queued: true });
}

async function flushDigest() {
  if (pendingDigest.length === 0) return;
  if (isQuietNow()) return;
  if (Date.now() - pendingDigest[0].at < DIGEST_MIN_AGE_MS) return;

  const items = pendingDigest;
  pendingDigest = [];
  if (items.length === 1) {
    await sendTelegramMessage(items[0].text);
    return;
  }

  const sep = '\n\n';
  let chunk = `📬 <b>${items.length} thông báo</b>`;
  for (const it of items) {
    if ((chunk + sep + it.text).length > TELEGRAM_MAX_CHARS) {
      await sendTelegramMessage(chunk);
      chunk = it.text;
    } else {
      chunk += sep + it.text;
    }
  }
  await sendTelegramMessage(chunk);
}

const digestTimer = setInterval(() => {
  flushDigest().catch(() => {});
}, 15 * 1000);
digestTimer.unref?.();

// 1. CẢNH BÁO VIA CHECKPOINT / EXPIRED
async function notifyViaDead(viaInfo = {}, error = '') {
  const settings = loadSettings();
  if (!settings.notifyOnViaDead) return;

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const msg = [
    `🚨 <b>[CẢNH BÁO BẢO VỆ VIA FB]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `👤 <b>Tên Via:</b> ${viaInfo.viaName || viaInfo.name || 'Không rõ'}`,
    `🆔 <b>UID:</b> <code>${viaInfo.uid || 'N/A'}</code>`,
    `🌐 <b>Proxy:</b> <code>${viaInfo.proxyUrl ? viaInfo.proxyUrl.replace(/:[^:]+@/, ':***@') : 'Direct IP'}</code>`,
    `⚠️ <b>Trạng thái:</b> <b>${viaInfo.tokenStatus || 'CHECKPOINT / DIE'}</b>`,
    `📝 <b>Chi tiết:</b> ${error || 'Cookie hết hạn hoặc FB yêu cầu xác minh'}`,
    `⏰ <b>Thời gian:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🛡️ <i>Via này đã được đánh dấu lỗi và sẽ không được dùng cho các lượt chạy mới. Hãy cập nhật Cookie để dùng lại.</i>`,
  ].join('\n');

  return sendAlert(msg, { critical: true });
}

// 2. THÔNG BÁO HUNTER PHÁT HIỆN BÀI MỚI
async function notifyPostHunted({ targetName, targetUrl, postUrl, delayMinutes, targetLikes }) {
  const settings = loadSettings();
  if (!settings.notifyOnHunter) return;

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const msg = [
    `🎯 <b>[HUNTER: PHÁT HIỆN BÀI VIẾT MỚI]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `📌 <b>Mục tiêu:</b> ${targetName || 'Fanpage/Group'}`,
    `🔗 <b>Link bài:</b> <a href="${postUrl}">${postUrl}</a>`,
    `⚡ <b>Mục tiêu buff:</b> ${targetLikes === 'ALL' ? 'xoay vòng page (theo giới hạn mỗi bài)' : `${targetLikes || 30} lượt thích & tương tác`}`,
    `⏳ <b>Chờ tự nhiên:</b> ${delayMinutes || 3} phút trước khi kích hoạt`,
    `⏰ <b>Thời gian phát hiện:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🤖 <i>Đã tự động xếp vào Hàng đợi Buff Tự Động!</i>`,
  ].join('\n');

  return sendAlert(msg);
}

// 3. THÔNG BÁO CHIẾN DỊCH HOÀN TẤT
async function notifyBuffCompleted({ targetUrl, success, total, failed, durationSec, reactionType }) {
  const settings = loadSettings();
  if (!settings.notifyOnBuffDone) return;

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
  const statusEmoji = successRate >= 80 ? '🎉' : '⚠️';

  const msg = [
    `${statusEmoji} <b>[BUFF HOÀN TẤT CHIẾN DỊCH]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔗 <b>Bài viết:</b> <a href="${targetUrl}">${targetUrl}</a>`,
    `❤️ <b>Loại Reaction:</b> ${reactionType || 'RANDOM'}`,
    `✅ <b>Thành công:</b> <b>${success}</b> / ${total} Page (${successRate}%)`,
    `❌ <b>Thất bại:</b> ${failed || 0}`,
    `⏱️ <b>Thời gian xử lý:</b> ${formatDurationVi(durationSec)}`,
    `⏰ <b>Hoàn tất lúc:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
  ].join('\n');

  return sendAlert(msg, { critical: true });
}

// 4. CẢNH BÁO DỪNG KHẨN CẤP
async function notifyEmergencyStop({ triggeredBy = 'Admin', reason = '' }) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const msg = [
    `🛑 <b>[KHẨN CẤP: TOÀN BỘ HỆ THỐNG ĐÃ DỪNG]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `👤 <b>Người kích hoạt:</b> ${triggeredBy}`,
    `⚠️ <b>Lý do:</b> ${reason || 'Yêu cầu dừng khẩn cấp từ người quản trị'}`,
    `⏰ <b>Thời gian:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    `⛔ <i>Tất cả trình duyệt Playwright và Queue đã được tạm dừng ngay lập tức.</i>`,
  ].join('\n');

  return sendAlert(msg, { critical: true });
}

function formatDurationVi(totalSec) {
  const sec = Math.max(0, Math.round(Number(totalSec) || 0));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}p ${sec % 60}s`;
  return `${Math.floor(m / 60)}g ${m % 60}p`;
}

// 5. HÀNG ĐỢI ĐÃ XỬ LÝ XONG TOÀN BỘ
async function notifyQueueIdle({ completedCount = 0 } = {}) {
  const settings = loadSettings();
  if (!settings.notifyOnBuffDone) return;
  return sendAlert(
    [`✅ <b>[HÀNG ĐỢI ĐÃ TRỐNG]</b>`, `Đã xử lý xong tất cả bài trong hàng đợi (${completedCount} bài vừa hoàn tất).`].join('\n')
  );
}

// 6. NHIỀU BÀI THẤT BẠI LIÊN TIẾP
async function notifyQueueTrouble({ consecutiveFailures = 0, lastError = '', lastUrl = '' } = {}) {
  const settings = loadSettings();
  if (!settings.notifyOnQueueIssue) return;
  const msg = [
    `⚠️ <b>[HÀNG ĐỢI: ${consecutiveFailures} BÀI THẤT BẠI LIÊN TIẾP]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    lastUrl ? `🔗 Bài gần nhất: <a href="${lastUrl}">${lastUrl}</a>` : '',
    `📝 Lỗi: ${String(lastError || 'Không rõ').slice(0, 300)}`,
    `👉 Kiểm tra Via (cookie/proxy) hoặc mạng, rồi bấm Thử lại trong tab Hàng đợi.`,
  ]
    .filter(Boolean)
    .join('\n');
  return sendAlert(msg, { critical: true });
}

// ---------------------------------------------------------------------------
// LỆNH BOT: /status /stop /resume /help  (chỉ nhận từ đúng Chat ID đã cấu hình)
// ---------------------------------------------------------------------------
let commandListenerStarted = false;

function startCommandListener({ getStatusText } = {}) {
  if (commandListenerStarted) return;
  commandListenerStarted = true;

  let offset = null; // null = lần đầu: bỏ qua toàn bộ tin cũ để không chạy lại lệnh cũ
  const loop = async () => {
    let waitMs = 3000;
    try {
      const st = loadSettings();
      if (!st.telegramBotToken || !st.telegramChatId || !st.telegramCommands) {
        offset = null;
        waitMs = 15000;
      } else {
        const base = `https://api.telegram.org/bot${st.telegramBotToken}/getUpdates`;
        if (offset === null) {
          const r = await axios.get(base, { params: { offset: -1, timeout: 0 }, timeout: 10000 });
          const last = (r.data?.result || []).slice(-1)[0];
          offset = last ? last.update_id + 1 : 0;
        } else {
          const r = await axios.get(base, {
            params: { offset, timeout: 20, allowed_updates: JSON.stringify(['message']) },
            timeout: 30000,
          });
          for (const u of r.data?.result || []) {
            offset = u.update_id + 1;
            const msg = u.message;
            if (!msg?.text || String(msg.chat?.id) !== String(st.telegramChatId)) continue;
            await handleCommand(msg.text, getStatusText);
          }
          waitMs = 500;
        }
      }
    } catch (err) {
      const code = err.response?.status;
      // 409: có nơi khác đang nhận tin của bot này (webhook hoặc bản chạy khác) → chờ lâu hơn
      waitMs = code === 409 || code === 401 ? 60000 : 10000;
    }
    const t = setTimeout(loop, waitMs);
    t.unref?.();
  };
  loop();
}

async function handleCommand(text, getStatusText) {
  const cmd = String(text).trim().split(/[\s@]/)[0].toLowerCase();
  if (cmd === '/status') {
    const body = getStatusText ? await getStatusText() : 'Chưa có dữ liệu.';
    return sendTelegramMessage(body);
  }
  if (cmd === '/stop') {
    if (isEmergencyStopped()) return sendTelegramMessage('⛔ Hệ thống đã ở trạng thái dừng khẩn cấp rồi.');
    setEmergencyStop(true, 'Dừng khẩn cấp từ lệnh Telegram');
    return;
  }
  if (cmd === '/resume') {
    if (!isEmergencyStopped()) return sendTelegramMessage('▶️ Hệ thống đang chạy bình thường.');
    setEmergencyStop(false);
    return sendTelegramMessage('▶️ Đã khôi phục hoạt động. Hàng đợi sẽ tiếp tục chạy.');
  }
  if (cmd === '/help' || cmd === '/start') {
    return sendTelegramMessage(
      [
        `🤖 <b>Lệnh có thể dùng</b>`,
        `/status — xem tình trạng hệ thống`,
        `/stop — dừng khẩn cấp toàn bộ`,
        `/resume — khôi phục sau khi dừng`,
      ].join('\n')
    );
  }
}

function isEmergencyStopped() {
  const settings = loadSettings();
  return Boolean(settings.isEmergencyStopped);
}

function setEmergencyStop(stopped, reason = '') {
  const updated = saveSettings({
    isEmergencyStopped: Boolean(stopped),
    emergencyReason: stopped ? reason : '',
    emergencyStoppedAt: stopped ? new Date().toISOString() : null,
  });
  if (stopped) {
    notifyEmergencyStop({ reason });
  }
  return updated;
}

module.exports = {
  loadSettings,
  saveSettings,
  sendTelegramMessage,
  notifyViaDead,
  notifyPostHunted,
  notifyBuffCompleted,
  notifyEmergencyStop,
  notifyQueueIdle,
  notifyQueueTrouble,
  sendAlert,
  isQuietNow,
  formatDurationVi,
  startCommandListener,
  isEmergencyStopped,
  setEmergencyStop,
};
