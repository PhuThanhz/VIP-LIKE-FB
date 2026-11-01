const fs = require('fs');
const path = require('path');
const axios = require('axios');
const store = require('./state-store');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Bộ nhớ đệm Short URL để tránh vượt quá giới hạn 64 byte của Telegram callback_data
const shortUrlRegistry = new Map();
function registerShortUrl(url) {
  if (shortUrlRegistry.size > 500) {
    const first = shortUrlRegistry.keys().next().value;
    shortUrlRegistry.delete(first);
  }
  const shortId = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  shortUrlRegistry.set(shortId, url);
  return shortId;
}
function getShortUrl(shortId) {
  return shortUrlRegistry.get(shortId) || null;
}

const DEFAULT_SETTINGS = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  notifyOnViaDead: true,
  notifyOnHunter: true,
  notifyOnBuffStart: true,
  notifyOnBuffDone: true,
  notifyOnQueueIssue: true,
  notifyOnActionBlocked: true,
  // Smart Adaptive Pacing & Chống hạn chế FB:
  defaultSpeedMode: 'FAST',
  smartAdaptivePacing: true,
  cooldownEveryPages: 25,
  cooldownDurationSec: 20,
  autoStopOnActionBlocked: true,
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
  maxPagesPerPost: 250,
  buffParallelVias: 4,
  maxParallelTasks: 2, // Số bài viết chạy song song cùng lúc trong hàng đợi
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
async function sendTelegramMessage(text, parseMode = 'HTML', replyMarkup = null) {
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
  else if (upper.includes('HẠN CHẾ') || upper.includes('ACTION_BLOCKED') || upper.includes('CHẶN') || upper.includes('QUÁ NHANH')) eventType = 'ACTION_BLOCKED';
  else if (upper.includes('KHẨN CẤP') || upper.includes('DỪNG')) eventType = 'EMERGENCY_STOP';
  else if (upper.includes('BÀI VIẾT MỚI') || upper.includes('HUNTER')) eventType = 'HUNTER';
  else if (upper.includes('HÀNG ĐỢI')) eventType = 'QUEUE_IDLE';
  else if (upper.includes('TEST') || upper.includes('XÁC NHẬN KẾT NỐI')) eventType = 'TEST';

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  };
  if (replyMarkup) {
    payload.reply_markup = typeof replyMarkup === 'string' ? JSON.parse(replyMarkup) : replyMarkup;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(url, payload, { timeout: 8000 });
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

/**
 * Gửi ảnh qua Telegram (dùng cho báo cáo chụp ảnh nghiệm thu)
 */
async function sendTelegramPhoto(photoPathOrBuffer, caption = '', { parseMode = 'HTML', replyMarkup = null } = {}) {
  const settings = loadSettings();
  const token = settings.telegramBotToken;
  const chatId = settings.telegramChatId;

  if (!token || !chatId) {
    return { success: false, reason: 'Chưa cấu hình Telegram Bot Token hoặc Chat ID' };
  }

  const url = `https://api.telegram.org/bot${token}/sendPhoto`;
  try {
    const formData = new FormData();
    formData.append('chat_id', chatId);

    if (typeof photoPathOrBuffer === 'string') {
      if (fs.existsSync(photoPathOrBuffer)) {
        const fileBuf = fs.readFileSync(photoPathOrBuffer);
        formData.append('photo', new Blob([fileBuf]), path.basename(photoPathOrBuffer));
      } else {
        console.warn(`[Telegram] ⚠️ File ảnh không tồn tại, fallback gửi text: ${photoPathOrBuffer}`);
        if (caption) return sendTelegramMessage(caption, parseMode, replyMarkup);
        return { success: false, reason: 'File không tồn tại' };
      }
    } else if (Buffer.isBuffer(photoPathOrBuffer)) {
      formData.append('photo', new Blob([photoPathOrBuffer]), 'proof.png');
    }

    if (caption) {
      // Telegram caption giới hạn 1024 ký tự
      const safeCaption = caption.length > 1000 ? caption.slice(0, 995) + '...' : caption;
      formData.append('caption', safeCaption);
      formData.append('parse_mode', parseMode);
    }

    if (replyMarkup) {
      formData.append(
        'reply_markup',
        typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup)
      );
    }

    const res = await axios.post(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 35000,
    });

    console.log('[Telegram] 📸 Đã gửi ảnh nghiệm thu thành công lên Telegram!');
    return { success: true, data: res.data };
  } catch (err) {
    const errMsg = err.response?.data?.description || err.message;
    console.warn(`[Telegram] ⚠️ Lỗi gửi ảnh: ${errMsg}, fallback sang gửi tin nhắn text.`);
    if (caption) {
      await sendTelegramMessage(caption, parseMode, replyMarkup);
    }
    return { success: false, reason: errMsg };
  }
}

/**
 * Phản hồi Callback Query để tắt biểu tượng loading trên nút bấm Telegram
 */
async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
  const settings = loadSettings();
  const token = settings.telegramBotToken;
  if (!token || !callbackQueryId) return;

  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/answerCallbackQuery`,
      {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      },
      { timeout: 8000 }
    );
  } catch (_) {}
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
function sendAlert(text, { critical = false, replyMarkup = null } = {}) {
  if (critical) return sendTelegramMessage(text, 'HTML', replyMarkup);
  const settings = loadSettings();
  if (!settings.telegramBotToken || !settings.telegramChatId) {
    return Promise.resolve({ success: false, reason: 'Chưa cấu hình Telegram' });
  }
  pendingDigest.push({ text, at: Date.now(), replyMarkup });
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
async function notifyBuffCompleted({
  targetUrl,
  success,
  total,
  originalTarget = 0,
  failed,
  autoRefilled = 0,
  durationSec,
  reactionType,
  screenshotPath = null,
}) {
  const settings = loadSettings();
  if (!settings.notifyOnBuffDone) return;

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
  const statusEmoji = successRate >= 80 ? '🎉' : '⚠️';
  const refillText = autoRefilled > 0 ? ` <i>(Đã tự động bù ${autoRefilled} Page lỗi để đủ KPI)</i>` : '';

  const requestedKpi = parseInt(originalTarget, 10) || total;
  const isCapped = requestedKpi > total;

  const msg = [
    `${statusEmoji} <b>[BUFF HOÀN TẤT CHIẾN DỊCH]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔗 <b>Bài viết:</b> <a href="${targetUrl}">${targetUrl}</a>`,
    `❤️ <b>Loại Reaction:</b> ${reactionType || 'RANDOM'}`,
    isCapped
      ? `🎯 <b>Mục tiêu ban đầu:</b> <b>${requestedKpi}</b> like\n⚠️ <b>Số Page khả dụng chưa like:</b> <b>${total}</b> Page <i>(Đã chạy hết 100% Page khả dụng hiện có của các Via đang LIVE)</i>`
      : `🎯 <b>KPI Mục tiêu:</b> <b>${total}</b> like`,
    `✅ <b>Thành công:</b> <b>${success}</b> / ${total} like khả dụng (${successRate}%)${refillText}`,
    failed > 0 ? `❌ <b>Bị lỗi đã bù:</b> ${failed} Page` : ``,
    `⏱️ <b>Thời gian xử lý:</b> ${formatDurationVi(durationSec)}`,
    `⏰ <b>Hoàn tất lúc:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    screenshotPath ? `📸 <i>Ảnh chụp màn hình nghiệm thu thực tế bài viết đã lên like</i>` : ``,
  ]
    .filter(Boolean)
    .join('\n');

  const shortId = registerShortUrl(targetUrl);
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🔁 Buff tiếp 50 Like', callback_data: `rebuff:${shortId}:50` },
        { text: '🔁 Buff tiếp 100 Like', callback_data: `rebuff:${shortId}:100` },
      ],
      [
        { text: '📊 Kiểm tra hệ thống', callback_data: 'status' },
      ],
    ],
  };

  if (screenshotPath && fs.existsSync(screenshotPath)) {
    return sendTelegramPhoto(screenshotPath, msg, { replyMarkup });
  }

  return sendAlert(msg, { critical: true, replyMarkup });
}

// 3.1. THÔNG BÁO BẮT ĐẦU CHIẾN DỊCH BUFF MỚI
async function notifyBuffStarted({
  targetUrl,
  total,
  reactionType = 'LIKE',
  speedMode = 'NORMAL',
  concurrency = 2,
  accountName = 'Dàn Via Facebook',
}) {
  const settings = loadSettings();
  if (settings.notifyOnBuffStart === false) return;

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const reactionEmoji =
    reactionType === 'LIKE' ? '👍 Thích (Like)'
    : reactionType === 'LOVE' ? '❤️ Thả tim (Love)'
    : reactionType === 'CARE' ? '🥰 Thương thương (Care)'
    : reactionType === 'HAHA' ? '😆 Haha'
    : reactionType === 'WOW' ? '😮 Wow'
    : reactionType === 'SAD' ? '😢 Buồn (Sad)'
    : reactionType === 'ANGRY' ? '😡 Phẫn nộ (Angry)'
    : reactionType === 'RANDOM_POSITIVE' ? '🎲 Random tích cực (Like/Love/Care)'
    : reactionType;

  const msg = [
    `📥 <b>[ĐÃ NHẬN CHIẾN DỊCH BUFF MỚI]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔗 <b>Bài viết:</b> <a href="${targetUrl}">${targetUrl}</a>`,
    `🎯 <b>Mục tiêu:</b> <b>${total}</b> like`,
    `💖 <b>Cảm xúc:</b> ${reactionEmoji}`,
    `⚡ <b>Tốc độ:</b> ${concurrency} luồng (${speedMode})`,
    `🤖 <b>Tài khoản:</b> ${accountName}`,
    `⏰ <b>Bắt đầu lúc:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🚀 <i>Bot Playwright đang tiến hành điều phối và tương tác trực tiếp...</i>`,
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🛑 Dừng ngay', callback_data: 'stop' },
        { text: '📊 Số Page khả dụng', callback_data: 'check_pages' },
      ],
      [
        { text: '📋 Hàng đợi xử lý', callback_data: 'status' },
      ],
    ],
  };

  return sendAlert(msg, { critical: true, replyMarkup });
}

// 3.2. THÔNG BÁO THÊM ĐƠN VÀO HÀNG ĐỢI
async function notifyQueueAdded({
  targetUrl,
  targetLikes,
  reactionType = 'LIKE',
  delayMinutes = 0,
}) {
  const settings = loadSettings();
  if (settings.notifyOnBuffStart === false) return;

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const delayText = delayMinutes > 0 ? `Sau ${delayMinutes} phút` : 'Ngay khi tới lượt';

  const msg = [
    `📥 <b>[ĐÃ THÊM VÀO HÀNG ĐỢI BUFF]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔗 <b>Bài viết:</b> <a href="${targetUrl}">${targetUrl}</a>`,
    `🎯 <b>Số lượng:</b> <b>${targetLikes}</b> like`,
    `💖 <b>Cảm xúc:</b> ${reactionType}`,
    `⏳ <b>Lịch chạy:</b> ${delayText}`,
    `⏰ <b>Thời gian nhận:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    `📋 <i>Hệ thống sẽ tự động xếp lịch và xoay vòng dàn Page chạy nối tiếp.</i>`,
  ].join('\n');

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🛑 Dừng ngay', callback_data: 'stop' },
        { text: '📋 Xem hàng đợi', callback_data: 'status' },
      ],
      [
        { text: '📊 Số Page khả dụng', callback_data: 'check_pages' },
      ],
    ],
  };

  return sendAlert(msg, { critical: true, replyMarkup });
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

// 4.5. CẢNH BÁO FACEBOOK HẠN CHẾ THAO TÁC (ACTION BLOCKED - TỰ ĐỘNG DỪNG BẢO VỆ VIA)
async function notifyActionBlocked({ viaName = '', viaUid = '', postUrl = '', reason = '', stoppedAt = null } = {}) {
  const settings = loadSettings();
  if (settings.notifyOnActionBlocked === false) return;
  const now = stoppedAt || new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const cleanPostUrl = (postUrl || '').split('?')[0];
  const msg = [
    `🚨 <b>[CẢNH BÁO BẢO VỆ VIA: PHÁT HIỆN HẠN CHẾ THAO TÁC]</b>`,
    `━━━━━━━━━━━━━━━━━━`,
    `👤 <b>Via:</b> ${viaName || 'Via'} (<code>${viaUid || 'N/A'}</code>)`,
    cleanPostUrl ? `🔗 <b>Bài viết:</b> <a href="${postUrl}">${cleanPostUrl.slice(0, 45)}...</a>` : '',
    `⚠️ <b>Facebook báo:</b> "Bạn tạm thời bị chặn do sử dụng quá nhanh"`,
    `🛡️ <b>Hành động tự động:</b> Hệ thống đã TỰ ĐỘNG DỪNG phiên buff ngay lập tức để bảo vệ an toàn cho Via & dàn Fanpage con!`,
    `💡 <b>Khuyến nghị:</b> Bạn có thể buff bài viết khác hoặc đổi Via bình thường. Đối với bài viết này, hãy để nghỉ 30-45 phút trước khi buff tiếp.`,
    `⏰ <b>Thời gian:</b> ${now}`,
    `━━━━━━━━━━━━━━━━━━`,
    `✨ <i>Thuật toán Smart Adaptive Pacing đang hoạt động để bảo toàn độ bền Via.</i>`,
  ].filter(Boolean).join('\n');

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
// LỆNH BOT & ĐIỀU KHIỂN 2 CHIỀU: "CHAT LÀ BUFF" + NÚT INLINE MENU
// ---------------------------------------------------------------------------
let commandListenerStarted = false;

function startCommandListener({ getStatusText, onBuffRequested, getPagesStats } = {}) {
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
            params: {
              offset,
              timeout: 20,
              allowed_updates: JSON.stringify(['message', 'callback_query']),
            },
            timeout: 30000,
          });

          for (const u of r.data?.result || []) {
            offset = u.update_id + 1;

            // 1. XỬ LÝ TIN NHẮN (MESSAGE)
            if (u.message) {
              const msg = u.message;
              if (msg.text && String(msg.chat?.id) === String(st.telegramChatId)) {
                await handleIncomingMessage(msg.text, { getStatusText, onBuffRequested, getPagesStats });
              }
            }

            // 2. XỬ LÝ NÚT BẤM INLINE (CALLBACK QUERY)
            if (u.callback_query) {
              const cq = u.callback_query;
              if (String(cq.from?.id) === String(st.telegramChatId)) {
                await handleCallbackQuery(cq, { getStatusText, onBuffRequested, getPagesStats });
              }
            }
          }
          waitMs = 500;
        }
      }
    } catch (err) {
      const code = err.response?.status;
      waitMs = code === 409 || code === 401 ? 60000 : 10000;
    }
    const t = setTimeout(loop, waitMs);
    t.unref?.();
  };
  loop();
}

async function handleIncomingMessage(text, { getStatusText, onBuffRequested, getPagesStats }) {
  const clean = String(text || '').trim();
  const cmd = clean.split(/[\s@]/)[0].toLowerCase();

  if (cmd === '/status') {
    const body = getStatusText ? await getStatusText() : 'Chưa có dữ liệu hệ thống.';
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '🛑 Dừng khẩn cấp', callback_data: 'stop' },
          { text: '📊 Số Page khả dụng', callback_data: 'check_pages' },
        ],
      ],
    };
    return sendTelegramMessage(body, 'HTML', replyMarkup);
  }

  if (cmd === '/stop') {
    if (isEmergencyStopped()) return sendTelegramMessage('⛔ Hệ thống đã ở trạng thái dừng khẩn cấp rồi.');
    setEmergencyStop(true, 'Dừng khẩn cấp từ lệnh Telegram');
    return;
  }

  if (cmd === '/resume') {
    if (!isEmergencyStopped()) return sendTelegramMessage('▶️ Hệ thống đang chạy bình thường.');
    setEmergencyStop(false);
    return sendTelegramMessage('▶️ Đã khôi phục hoạt động. Hàng đợi sẽ tiếp tục xử lý các bài chờ.');
  }

  if (cmd === '/pages' || cmd === '/check_pages') {
    const body = getPagesStats ? await getPagesStats() : 'Chưa có dữ liệu thống kê Page.';
    return sendTelegramMessage(body);
  }

  if (cmd === '/queue') {
    const body = getQueueText ? await getQueueText() : 'Chưa có thông tin hàng đợi.';
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '🛑 Dừng ngay', callback_data: 'stop' },
          { text: '📊 Tình trạng hệ thống', callback_data: 'status' },
        ],
      ],
    };
    return sendTelegramMessage(body, 'HTML', replyMarkup);
  }

  if (cmd === '/help' || cmd === '/start') {
    return sendTelegramMessage(
      [
        `🤖 <b>HỆ THỐNG VIPLIKE RADIANT - ĐIỀU KHIỂN TELEGRAM</b>`,
        `━━━━━━━━━━━━━━━━━━`,
        `👉 <b>CÁCH BUFF TƯƠNG TÁC ("CHAT LÀ BUFF"):</b>`,
        `Chỉ cần gửi link Facebook kèm số lượng và loại tương tác:`,
        `• <code>https://facebook.com/share/p/xxx 100 LIKE</code> (Buff 100 Like)`,
        `• <code>https://facebook.com/share/p/xxx 200 LOVE</code> (Buff 200 Tim)`,
        `• <code>https://facebook.com/share/p/xxx 500 RANDOM</code> (Buff 500 Cảm xúc)`,
        `• <code>https://facebook.com/share/p/xxx 20 SHARE</code> (Chia sẻ bài viết lên Fanpage)`,
        `• <code>/share https://facebook.com/share/p/xxx 30</code> (Lệnh chia sẻ nhanh)`,
        `<i>(Hoặc chỉ cần dán mỗi link bài viết, Bot sẽ hiện menu nút bấm chọn nhanh!)</i>`,
        ``,
        `🛠️ <b>CÁC LỆNH HỆ THỐNG:</b>`,
        `/status — Xem tình trạng tổng quan & dàn Via`,
        `/queue — Xem chi tiết các bài đang chạy & chờ`,
        `/pages — Xem chi tiết số Fanpage khả dụng`,
        `/stop — Dừng khẩn cấp toàn bộ hệ thống`,
        `/resume — Khôi phục hoạt động hàng đợi`,
        `/help — Hướng dẫn sử dụng`,
      ].join('\n')
    );
  }

  // 3. PHÁT HIỆN LINK FACEBOOK TRONG TIN NHẮN ("CHAT LÀ BUFF")
  const fbMatch = clean.match(/(https?:\/\/(?:www\.|m\.|web\.|mbasic\.)?(?:facebook\.com|fb\.watch)\/[^\s]+)/i);
  if (fbMatch) {
    const rawUrl = fbMatch[1];
    const restText = clean.replace(rawUrl, '').replace(/\/buff\s*/i, '').replace(/\/share\s*/i, '').trim();

    // Tìm số like/share
    const numMatch = restText.match(/\b(\d{1,5})\b/);
    const targetLikes = numMatch ? parseInt(numMatch[1], 10) : null;

    // Tìm loại tương tác (Like, Love, Care, Share...)
    let reactionType = 'LIKE';
    const upperRest = restText.toUpperCase();
    const isShareOrder = cmd === '/share' || upperRest.includes('SHARE') || upperRest.includes('CHIA SẺ') || upperRest.includes('CHIASE');

    if (isShareOrder) {
      reactionType = 'SHARE';
    } else if (upperRest.includes('LOVE') || upperRest.includes('TIM')) reactionType = 'LOVE';
    else if (upperRest.includes('CARE') || upperRest.includes('THƯƠNG')) reactionType = 'CARE';
    else if (upperRest.includes('HAHA')) reactionType = 'HAHA';
    else if (upperRest.includes('WOW')) reactionType = 'WOW';
    else if (upperRest.includes('SAD') || upperRest.includes('BUỒN')) reactionType = 'SAD';
    else if (upperRest.includes('ANGRY') || upperRest.includes('GIẬN') || upperRest.includes('PHẪN')) reactionType = 'ANGRY';
    else if (upperRest.includes('RANDOM')) reactionType = 'RANDOM_POSITIVE';

    if (targetLikes && targetLikes > 0) {
      if (typeof onBuffRequested === 'function') {
        if (isShareOrder) {
          return onBuffRequested({
            targetUrl: rawUrl,
            targetLikes,
            reactionType: 'SHARE',
            enableLike: false,
            enableShare: true,
            source: 'TELEGRAM_DIRECT_SHARE',
          });
        }
        return onBuffRequested({ targetUrl: rawUrl, targetLikes, reactionType, source: 'TELEGRAM_DIRECT' });
      }
    } else {
      // Người dùng chỉ dán mỗi link -> Hiển thị menu chọn nhanh
      const shortId = registerShortUrl(rawUrl);
      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '👍 50 Like', callback_data: `qb:${shortId}:50:LIKE` },
            { text: '👍 100 Like', callback_data: `qb:${shortId}:100:LIKE` },
            { text: '👍 200 Like', callback_data: `qb:${shortId}:200:LIKE` },
          ],
          [
            { text: '❤️ 100 Tim', callback_data: `qb:${shortId}:100:LOVE` },
            { text: '🎲 200 Random', callback_data: `qb:${shortId}:200:RANDOM_POSITIVE` },
            { text: '🚀 20 Share', callback_data: `qb:${shortId}:20:SHARE` },
          ],
          [
            { text: '❌ Huỷ bỏ', callback_data: 'cancel_buff' },
          ],
        ],
      };
      return sendTelegramMessage(
        [
          `🎯 <b>[PHÁT HIỆN LINK BÀI VIẾT FACEBOOK]</b>`,
          `━━━━━━━━━━━━━━━━━━`,
          `🔗 <b>Link:</b> <a href="${rawUrl}">${rawUrl}</a>`,
          ``,
          `👇 <i>Bấm chọn nhanh gói tương tác bạn muốn buff:</i>`,
        ].join('\n'),
        'HTML',
        replyMarkup
      );
    }
  }
}

async function handleCallbackQuery(cq, { getStatusText, onBuffRequested, getPagesStats }) {
  const data = String(cq.data || '');
  await answerCallbackQuery(cq.id, 'Đã nhận lệnh!');

  if (data === 'stop') {
    if (isEmergencyStopped()) {
      return sendTelegramMessage('⛔ Hệ thống đã ở trạng thái dừng khẩn cấp rồi.');
    }
    setEmergencyStop(true, 'Dừng khẩn cấp từ nút bấm Telegram');
    return;
  }

  if (data === 'resume') {
    if (!isEmergencyStopped()) {
      return sendTelegramMessage('▶️ Hệ thống đang chạy bình thường.');
    }
    setEmergencyStop(false);
    return sendTelegramMessage('▶️ Đã khôi phục hoạt động. Hàng đợi sẽ tiếp tục xử lý các bài chờ.');
  }

  if (data === 'status') {
    const body = getStatusText ? await getStatusText() : 'Chưa có dữ liệu hệ thống.';
    return sendTelegramMessage(body);
  }

  if (data === 'check_pages') {
    const body = getPagesStats ? await getPagesStats() : 'Chưa có dữ liệu thống kê Page.';
    return sendTelegramMessage(body);
  }

  if (data.startsWith('qb:')) {
    // Format: qb:shortId:count:reaction
    const parts = data.split(':');
    const shortId = parts[1];
    const count = parseInt(parts[2], 10) || 50;
    const reaction = parts[3] || 'LIKE';
    const targetUrl = getShortUrl(shortId);

    if (!targetUrl) {
      return sendTelegramMessage('⚠️ Link bài viết này đã hết hạn lưu tạm. Vui lòng gửi lại link bài viết vào bot.');
    }

    if (typeof onBuffRequested === 'function') {
      if (reaction === 'SHARE') {
        return onBuffRequested({
          targetUrl,
          targetLikes: count,
          reactionType: 'SHARE',
          enableLike: false,
          enableShare: true,
          source: 'TELEGRAM_QUICK_SHARE',
        });
      }
      return onBuffRequested({ targetUrl, targetLikes: count, reactionType: reaction, source: 'TELEGRAM_QUICK' });
    }
  }

  if (data.startsWith('rebuff:')) {
    // Format: rebuff:shortId:count
    const parts = data.split(':');
    const shortId = parts[1];
    const count = parseInt(parts[2], 10) || 100;
    const targetUrl = getShortUrl(shortId);

    if (!targetUrl) {
      return sendTelegramMessage('⚠️ Link bài viết này đã hết hạn lưu tạm. Vui lòng gửi lại link bài viết vào bot.');
    }

    if (typeof onBuffRequested === 'function') {
      return onBuffRequested({
        targetUrl,
        targetLikes: count,
        reactionType: 'LIKE',
        source: 'TELEGRAM_REBUFF',
        allowRebuff: true,
      });
    }
  }

  if (data === 'cancel_buff') {
    return sendTelegramMessage('ℹ️ Đã huỷ thao tác buff bài viết.');
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
  sendTelegramPhoto,
  answerCallbackQuery,
  registerShortUrl,
  getShortUrl,
  notifyViaDead,
  notifyPostHunted,
  notifyBuffStarted,
  notifyQueueAdded,
  notifyBuffCompleted,
  notifyEmergencyStop,
  notifyActionBlocked,
  notifyQueueIdle,
  notifyQueueTrouble,
  sendAlert,
  isQuietNow,
  formatDurationVi,
  startCommandListener,
  isEmergencyStopped,
  setEmergencyStop,
};
