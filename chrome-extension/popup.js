// popup.js - Quản lý giao diện Popup của VIPLIKE Avatar Fast Uploader

const BACKEND_URL = 'http://localhost:3100';

let currentTabId = null;
let fbUser = null;
let isRunning = false;
let isPaused = false;
let syncTimer = null;

// DOM Elements
const fbStatusPill = document.getElementById('fb-status-pill');
const fbStatusText = document.getElementById('fb-status-text');
const userNameEl = document.getElementById('user-name');
const userUidEl = document.getElementById('user-uid');
const userAvatarEl = document.getElementById('user-avatar-placeholder');
const btnRefreshUser = document.getElementById('btn-refresh-user');

const avatarPresetSelect = document.getElementById('avatar-preset');
const pageSourceSelect = document.getElementById('page-source');
const customPagesGroup = document.getElementById('custom-pages-group');
const customPagesInput = document.getElementById('custom-pages-input');
const delaySlider = document.getElementById('delay-slider');
const delayVal = document.getElementById('delay-val');

const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnStop = document.getElementById('btn-stop');

const progressPercent = document.getElementById('progress-percent');
const progressBarFill = document.getElementById('progress-bar-fill');
const statTotal = document.getElementById('stat-total');
const statSuccess = document.getElementById('stat-success');
const statFailed = document.getElementById('stat-failed');
const currentPageStatus = document.getElementById('current-page-status');
const logsList = document.getElementById('logs-list');
const btnClearLogs = document.getElementById('btn-clear-logs');

// Khởi chạy khi mở popup
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  loadSavedState();
  await checkActiveTab();
  await syncJobStateFromStorage();

  // Polling sync định kỳ để đồng bộ liên tục
  syncTimer = setInterval(syncJobStateFromStorage, 1000);
});

window.addEventListener('unload', () => {
  if (syncTimer) clearInterval(syncTimer);
});

function setupEventListeners() {
  delaySlider.addEventListener('input', (e) => {
    delayVal.textContent = `${parseFloat(e.target.value).toFixed(1)}s`;
    chrome.storage.local.set({ delaySeconds: parseFloat(e.target.value) });
  });

  avatarPresetSelect.addEventListener('change', (e) => {
    chrome.storage.local.set({ avatarPreset: e.target.value });
  });

  pageSourceSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    chrome.storage.local.set({ pageSource: val });
    if (customPagesGroup) {
      customPagesGroup.style.display = val === 'custom_list' ? 'block' : 'none';
    }
  });

  if (customPagesInput) {
    customPagesInput.addEventListener('input', (e) => {
      chrome.storage.local.set({ customPagesText: e.target.value });
    });
  }

  btnRefreshUser.addEventListener('click', checkActiveTab);
  btnStart.addEventListener('click', handleStart);
  btnPause.addEventListener('click', handlePause);
  btnStop.addEventListener('click', handleStop);

  btnClearLogs.addEventListener('click', async () => {
    logsList.innerHTML = '<div class="empty-log">Chưa có nhật ký hoạt động.</div>';
    const { activeJob } = await chrome.storage.local.get('activeJob');
    if (activeJob) {
      activeJob.logs = [];
      await chrome.storage.local.set({ activeJob });
    }
  });

  // Lắng nghe thông điệp trực tiếp từ Content Script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'AVATAR_PROGRESS') {
      renderProgress(msg.data);
    }
  });
}

// Kiểm tra tab Facebook hiện tại
async function checkActiveTab() {
  setConnectionStatus(false, 'Đang kiểm tra tab...');
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      setConnectionStatus(false, 'Không tìm thấy tab');
      return;
    }

    currentTabId = tabs[0].id;
    const url = tabs[0].url || '';

    if (!url.includes('facebook.com')) {
      setConnectionStatus(false, 'Hãy mở tab Facebook');
      userNameEl.textContent = 'Bạn chưa mở Facebook!';
      userUidEl.textContent = 'Vui lòng mở trang Facebook trên tab này';
      btnStart.disabled = true;
      return;
    }

    // Gửi message tới content script để lấy thông tin đăng nhập
    chrome.tabs.sendMessage(currentTabId, { action: 'GET_FB_INFO' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        setConnectionStatus(false, 'Cần F5 tab Facebook');
        userNameEl.textContent = 'Chưa tải được Script';
        userUidEl.textContent = 'Hãy F5 lại tab Facebook và mở lại extension';
        btnStart.disabled = false; // Vẫn cho phép thử lại
        return;
      }

      if (res.loggedIn && res.uid) {
        fbUser = res;
        setConnectionStatus(true, 'Facebook Đã Kết Nối');
        userNameEl.textContent = res.name || 'Nick Facebook';
        userUidEl.textContent = `UID: ${res.uid}`;
        if (res.avatarUrl) {
          userAvatarEl.innerHTML = `<img src="${res.avatarUrl}" alt="avatar">`;
        }
        btnStart.disabled = false;
      } else {
        setConnectionStatus(false, 'Chưa đăng nhập FB');
        userNameEl.textContent = 'Chưa đăng nhập Facebook';
        userUidEl.textContent = 'Hãy đăng nhập vào Facebook trên tab này';
        btnStart.disabled = true;
      }
    });
  } catch (e) {
    setConnectionStatus(false, 'Lỗi kết nối');
  }
}

function setConnectionStatus(connected, text) {
  fbStatusText.textContent = text;
  if (connected) {
    fbStatusPill.className = 'status-pill status-connected';
  } else {
    fbStatusPill.className = 'status-pill status-disconnected';
  }
}

// Đồng bộ trạng thái Job từ Chrome Storage
async function syncJobStateFromStorage() {
  const { activeJob } = await chrome.storage.local.get('activeJob');
  if (!activeJob) return;

  isRunning = Boolean(activeJob.isRunning);
  isPaused = Boolean(activeJob.isPaused);

  updateRunningUI(isRunning, isPaused);

  const percent = activeJob.total > 0 ? Math.round((activeJob.currentIndex / activeJob.total) * 100) : 0;

  renderProgress({
    total: activeJob.total || 0,
    current: activeJob.currentIndex || 0,
    success: activeJob.success || 0,
    failed: activeJob.failed || 0,
    percent: activeJob.completed ? 100 : percent,
    pageName: activeJob.currentPageName || '',
    status: activeJob.completed ? 'DONE' : activeJob.isPaused ? 'PAUSED' : isRunning ? 'RUNNING' : 'STOPPED',
    message: activeJob.statusMessage || '',
  });

  if (Array.isArray(activeJob.logs) && activeJob.logs.length > 0) {
    renderLogs(activeJob.logs);
  }
}

// Bắt đầu tiến trình cập nhật Avatar
async function handleStart() {
  const preset = avatarPresetSelect.value;
  const source = pageSourceSelect.value;
  const delaySec = parseFloat(delaySlider.value);

  currentPageStatus.textContent = '⏳ Đang chuẩn bị danh sách Fanpage...';
  btnStart.disabled = true;

  let pages = [];

  // 1. Tự nhập ID / Link
  if (source === 'custom_list') {
    const rawText = customPagesInput ? customPagesInput.value : '';
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const seen = new Set();
    for (const line of lines) {
      const m = line.match(/(?:id=|\/)?([0-9]{12,})/);
      const id = m ? m[1] : line.replace(/[^0-9]/g, '');
      if (id && !seen.has(id)) {
        seen.add(id);
        pages.push({ id, name: `Fanpage ${id.slice(-4)}` });
      }
    }
  }

  // 2. Nạp từ VIPLIKE RADIANT (:3100)
  if (source === 'viplike_backend') {
    try {
      const uidQuery = fbUser && fbUser.uid ? `?uid=${fbUser.uid}` : '';
      const res = await fetch(`${BACKEND_URL}/api/buff-cached-pages${uidQuery}`);
      const data = await res.json();
      if (data?.pages && data.pages.length > 0) {
        pages = data.pages;
      } else {
        // Fallback lấy toàn bộ
        const resAll = await fetch(`${BACKEND_URL}/api/buff-cached-pages`);
        const dataAll = await resAll.json();
        if (dataAll?.pages && dataAll.pages.length > 0) {
          pages = dataAll.pages;
        }
      }
    } catch (e) {
      console.warn('Backend không phản hồi, thử quét từ tab');
    }
  }

  // 3. Quét trực tiếp từ Tab Facebook nếu chưa có danh sách
  if (pages.length === 0 && currentTabId) {
    try {
      const resScan = await new Promise((resolve) => {
        chrome.tabs.sendMessage(currentTabId, { action: 'SCAN_DOM_PAGES' }, resolve);
      });
      if (resScan && Array.isArray(resScan.pages) && resScan.pages.length > 0) {
        pages = resScan.pages;
      }
    } catch (e) {}
  }

  if (pages.length === 0) {
    btnStart.disabled = false;
    alert('Không tìm thấy Fanpage nào! Vui lòng chọn "Tự nhập danh sách ID" hoặc mở tab Facebook có Fanpage.');
    currentPageStatus.textContent = '⚠️ Không có danh sách Fanpage để thực thi.';
    return;
  }

  // Lưu Job mới vào chrome.storage.local
  const newJob = {
    isRunning: true,
    isPaused: false,
    completed: false,
    preset,
    delaySeconds: delaySec,
    pages,
    total: pages.length,
    currentIndex: 0,
    success: 0,
    failed: 0,
    phase: 'INIT',
    currentPageName: pages[0].name,
    statusMessage: `Chuẩn bị cập nhật ${pages.length} Fanpage...`,
    logs: [{
      time: new Date().toLocaleTimeString(),
      text: `🚀 Bắt đầu cập nhật ${pages.length} Fanpage (Kho: ${preset}, Chờ: ${delaySec}s)`,
      type: 'info'
    }],
    startedAt: Date.now(),
  };

  await chrome.storage.local.set({ activeJob: newJob });

  updateRunningUI(true, false);
  renderProgress({
    total: newJob.total,
    current: 0,
    success: 0,
    failed: 0,
    percent: 0,
    pageName: pages[0].name,
    status: 'RUNNING',
    message: `Đã khởi động tiến trình ${pages.length} Page`,
  });

  // Đánh thức Content Script trong tab Facebook
  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { action: 'TRIGGER_RESUME' });
  }

  btnStart.disabled = false;
}

// Tạm dừng / Tiếp tục
async function handlePause() {
  const { activeJob } = await chrome.storage.local.get('activeJob');
  if (!activeJob) return;

  const nextPaused = !activeJob.isPaused;
  activeJob.isPaused = nextPaused;
  activeJob.statusMessage = nextPaused ? 'Đã tạm dừng' : 'Đang tiếp tục...';
  await chrome.storage.local.set({ activeJob });

  updateRunningUI(true, nextPaused);

  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { action: nextPaused ? 'PAUSE_JOB' : 'TRIGGER_RESUME' });
  }
}

// Dừng hoàn toàn
async function handleStop() {
  const { activeJob } = await chrome.storage.local.get('activeJob');
  if (activeJob) {
    activeJob.isRunning = false;
    activeJob.isPaused = false;
    activeJob.statusMessage = 'Đã dừng theo yêu cầu';
    await chrome.storage.local.set({ activeJob });
  }

  updateRunningUI(false, false);
  currentPageStatus.textContent = '⏹️ Đã dừng tiến trình.';

  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { action: 'STOP_JOB' });
  }
}

function updateRunningUI(running, paused) {
  isRunning = running;
  isPaused = paused;

  if (running) {
    btnStart.style.display = 'none';
    btnPause.style.display = 'flex';
    btnStop.style.display = 'flex';
    btnPause.innerHTML = paused ? '<span>▶️</span> Tiếp tục' : '<span>⏸️</span> Tạm dừng';
  } else {
    btnStart.style.display = 'flex';
    btnPause.style.display = 'none';
    btnStop.style.display = 'none';
  }
}

function renderProgress(data) {
  const { total = 0, current = 0, success = 0, failed = 0, percent = 0, pageName = '', status = '', message = '' } = data;

  statTotal.textContent = total;
  statSuccess.textContent = success;
  statFailed.textContent = failed;
  progressPercent.textContent = `${percent}%`;
  progressBarFill.style.width = `${percent}%`;

  if (status === 'RUNNING') {
    currentPageStatus.textContent = `⚡ [${current + 1}/${total}] Đang xử lý: ${pageName || 'Fanpage'}...`;
  } else if (status === 'PAUSED') {
    currentPageStatus.textContent = `⏸️ Đang tạm dừng tại [${current}/${total}]`;
  } else if (status === 'DONE') {
    currentPageStatus.textContent = `🎉 Hoàn tất toàn bộ ${success}/${total} Fanpage!`;
    updateRunningUI(false, false);
  } else if (status === 'STOPPED') {
    currentPageStatus.textContent = '⏹️ Đã dừng tiến trình.';
    updateRunningUI(false, false);
  } else if (message) {
    currentPageStatus.textContent = message;
  }
}

function renderLogs(logs) {
  if (!logsList) return;
  const empty = logsList.querySelector('.empty-log');
  if (empty) empty.remove();

  logsList.innerHTML = '';
  const recentLogs = logs.slice(-30).reverse();
  for (const log of recentLogs) {
    const item = document.createElement('div');
    item.className = `log-item ${log.type === 'success' ? 'success' : log.type === 'error' ? 'error' : ''}`;
    item.innerHTML = `
      <span style="font-weight: 600; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${log.text}</span>
      <span style="font-size: 10px; color: #64748b;">${log.time || ''}</span>
    `;
    logsList.appendChild(item);
  }
}

function loadSavedState() {
  chrome.storage.local.get(['delaySeconds', 'avatarPreset', 'pageSource', 'customPagesText'], (res) => {
    if (res.delaySeconds) {
      delaySlider.value = res.delaySeconds;
      delayVal.textContent = `${res.delaySeconds}s`;
    }
    if (res.avatarPreset) avatarPresetSelect.value = res.avatarPreset;
    if (res.pageSource) {
      pageSourceSelect.value = res.pageSource;
      if (customPagesGroup) {
        customPagesGroup.style.display = res.pageSource === 'custom_list' ? 'block' : 'none';
      }
    }
    if (res.customPagesText && customPagesInput) {
      customPagesInput.value = res.customPagesText;
    }
  });
}
