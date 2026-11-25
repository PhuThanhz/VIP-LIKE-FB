// popup.js - Manages the VIPLIKE Avatar Fast Uploader popup UI

const BACKEND_URL = 'http://localhost:3100';

let currentTabId = null;
let fbUser = null;
let isRunning = false;
let isPaused = false;
let syncTimer = null;

// Fanpage list and filter state
let allLoadedPages = [];
let selectedPageIds = new Set();
let searchQuery = '';

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

// Page selection elements
const pillMissingCount = document.getElementById('pill-missing-count');
const pillHasCount = document.getElementById('pill-has-count');
const btnReloadPages = document.getElementById('btn-reload-pages');
const btnFilterMissingOnly = document.getElementById('btn-filter-missing-only');
const btnFilterSelectAll = document.getElementById('btn-filter-select-all');
const btnFilterDeselectAll = document.getElementById('btn-filter-deselect-all');
const pagesSearchInput = document.getElementById('pages-search-input');
const pagesListEl = document.getElementById('pages-list');
const selectedCountEl = document.getElementById('selected-count');
const totalPagesCountEl = document.getElementById('total-pages-count');

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

// Runs when the popup opens
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  loadSavedState();
  await checkActiveTab();
  await loadPagesList();
  await syncJobStateFromStorage();

  // Periodic polling sync to stay continuously in sync
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

  pageSourceSelect.addEventListener('change', async (e) => {
    const val = e.target.value;
    chrome.storage.local.set({ pageSource: val });
    if (customPagesGroup) {
      customPagesGroup.style.display = val === 'custom_list' ? 'block' : 'none';
    }
    await loadPagesList();
  });

  if (customPagesInput) {
    customPagesInput.addEventListener('input', (e) => {
      chrome.storage.local.set({ customPagesText: e.target.value });
      if (pageSourceSelect.value === 'custom_list') {
        loadPagesList();
      }
    });
  }

  btnReloadPages.addEventListener('click', loadPagesList);

  btnFilterMissingOnly.addEventListener('click', () => {
    setFilterButtonActive(btnFilterMissingOnly);
    selectedPageIds.clear();
    allLoadedPages.forEach((p) => {
      if (!p.hasAvatar) selectedPageIds.add(p.id);
    });
    renderPagesList();
  });

  btnFilterSelectAll.addEventListener('click', () => {
    setFilterButtonActive(btnFilterSelectAll);
    selectedPageIds.clear();
    allLoadedPages.forEach((p) => selectedPageIds.add(p.id));
    renderPagesList();
  });

  btnFilterDeselectAll.addEventListener('click', () => {
    setFilterButtonActive(btnFilterDeselectAll);
    selectedPageIds.clear();
    renderPagesList();
  });

  pagesSearchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderPagesList();
  });

  btnRefreshUser.addEventListener('click', async () => {
    await checkActiveTab();
    await loadPagesList();
  });

  btnStart.addEventListener('click', handleStart);
  btnPause.addEventListener('click', handlePause);
  btnStop.addEventListener('click', handleStop);

  btnClearLogs.addEventListener('click', async () => {
    logsList.innerHTML = '<div class="empty-log">No activity logged yet.</div>';
    const { activeJob } = await chrome.storage.local.get('activeJob');
    if (activeJob) {
      activeJob.logs = [];
      await chrome.storage.local.set({ activeJob });
    }
  });

  // Listen for messages directly from the Content Script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'AVATAR_PROGRESS') {
      renderProgress(msg.data);
    }
  });
}

function setFilterButtonActive(activeBtn) {
  [btnFilterMissingOnly, btnFilterSelectAll, btnFilterDeselectAll].forEach((b) => b.classList.remove('active'));
  if (activeBtn) activeBtn.classList.add('active');
}

// Check the current Facebook tab
async function checkActiveTab() {
  setConnectionStatus(false, 'Checking tab...');
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      setConnectionStatus(false, 'No tab found');
      return;
    }

    currentTabId = tabs[0].id;
    const url = tabs[0].url || '';

    if (!url.includes('facebook.com')) {
      setConnectionStatus(false, 'Please open a Facebook tab');
      userNameEl.textContent = 'Facebook is not open!';
      userUidEl.textContent = 'Please open Facebook in this tab';
      btnStart.disabled = true;
      return;
    }

    // Message the content script to get login info
    chrome.tabs.sendMessage(currentTabId, { action: 'GET_FB_INFO' }, async (res) => {
      if (chrome.runtime.lastError || !res) {
        // Auto-inject the script if the tab hasn't been reloaded
        try {
          await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            files: ['avatars-data.js', 'content.js'],
          });
          setTimeout(() => {
            chrome.tabs.sendMessage(currentTabId, { action: 'GET_FB_INFO' }, (retryRes) => {
              if (retryRes && retryRes.loggedIn) {
                applyConnectedUser(retryRes);
              } else {
                setConnectionStatus(false, 'Reload the Facebook tab');
                userNameEl.textContent = 'Script not loaded';
                userUidEl.textContent = 'Press Cmd+R (F5) on the Facebook tab behind!';
              }
            });
          }, 400);
          return;
        } catch (injectErr) {
          setConnectionStatus(false, 'Reload the Facebook tab');
          userNameEl.textContent = 'Script not loaded';
          userUidEl.textContent = 'Press Cmd+R (F5) on the Facebook tab behind!';
          return;
        }
      }

      if (res.loggedIn && res.uid) {
        applyConnectedUser(res);
      } else {
        setConnectionStatus(false, 'Not logged in to FB');
        userNameEl.textContent = 'Not logged in to Facebook';
        userUidEl.textContent = 'Please log in to Facebook in this tab';
      }
    });
  } catch (e) {
    setConnectionStatus(false, 'Connection error');
  }
}

function applyConnectedUser(user) {
  fbUser = user;
  setConnectionStatus(true, 'Facebook Connected');
  userNameEl.textContent = user.name || 'Nick Facebook';
  userUidEl.textContent = `UID: ${user.uid}`;
  if (user.avatarUrl) {
    userAvatarEl.innerHTML = `<img src="${user.avatarUrl}" alt="avatar">`;
  }
  loadPagesList();
}

function setConnectionStatus(connected, text) {
  fbStatusText.textContent = text;
  if (connected) {
    fbStatusPill.className = 'status-pill status-connected';
  } else {
    fbStatusPill.className = 'status-pill status-disconnected';
  }
}

// =========================================================================
// LOAD AND SELECT THE FANPAGE LIST
// =========================================================================

async function loadPagesList() {
  pagesListEl.innerHTML = '<div class="empty-pages-msg">⏳ Loading Fanpage list...</div>';
  const source = pageSourceSelect.value;
  let pages = [];

  // 1. Manually entered ID / link list
  if (source === 'custom_list') {
    const rawText = customPagesInput ? customPagesInput.value : '';
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const seen = new Set();
    for (const line of lines) {
      const m = line.match(/(?:id=|\/)?([0-9]{12,})/);
      const id = m ? m[1] : line.replace(/[^0-9]/g, '');
      if (id && !seen.has(id)) {
        seen.add(id);
        pages.push({
          id,
          name: `Fanpage ${id.slice(-4)}`,
          hasAvatar: false, // Manually entered pages are assumed to need a change
          isSilhouette: true,
          avatarUrl: '',
        });
      }
    }
  }

  // 2. Load from VIPLIKE RADIANT (:3100)
  if (source === 'viplike_backend') {
    try {
      const uidQuery = fbUser && fbUser.uid ? `?uid=${fbUser.uid}` : '';
      const res = await fetch(`${BACKEND_URL}/api/buff-cached-pages${uidQuery}`);
      const data = await res.json();
      if (data?.pages && data.pages.length > 0) {
        pages = data.pages;
      } else {
        const resAll = await fetch(`${BACKEND_URL}/api/buff-cached-pages`);
        const dataAll = await resAll.json();
        if (dataAll?.pages && dataAll.pages.length > 0) {
          pages = dataAll.pages;
        }
      }
    } catch (e) {
      console.warn('Backend did not respond when loading pages');
    }
  }

  // 3. Scan from the current Facebook tab
  if (source === 'fb_tab') {
    try {
      const resScan = await new Promise((resolve) => {
        chrome.tabs.sendMessage(currentTabId, { action: 'SCAN_DOM_PAGES' }, resolve);
      });
      if (resScan && Array.isArray(resScan.pages) && resScan.pages.length > 0) {
        pages = resScan.pages.map((p) => ({
          ...p,
          hasAvatar: false,
          isSilhouette: true,
          avatarUrl: '',
        }));
      }
    } catch (e) {}
  }

  allLoadedPages = pages;

  // STRICT SAFETY RULE AS REQUESTED:
  // BY DEFAULT ONLY TICK PAGES WITHOUT AN AVATAR (!p.hasAvatar)
  // Accounts that already have an avatar are left unticked (must not be changed by mistake)
  selectedPageIds.clear();
  allLoadedPages.forEach((p) => {
    if (!p.hasAvatar) {
      selectedPageIds.add(p.id);
    }
  });

  renderPagesList();
}

function renderPagesList() {
  const missingCount = allLoadedPages.filter((p) => !p.hasAvatar).length;
  const hasCount = allLoadedPages.filter((p) => p.hasAvatar).length;

  pillMissingCount.textContent = `${missingCount} missing`;
  pillHasCount.textContent = `${hasCount} have one`;
  totalPagesCountEl.textContent = allLoadedPages.length;

  // Filter by search keyword
  let displayPages = allLoadedPages;
  if (searchQuery) {
    displayPages = allLoadedPages.filter((p) => {
      return (p.name || '').toLowerCase().includes(searchQuery) || (p.id || '').includes(searchQuery);
    });
  }

  if (displayPages.length === 0) {
    pagesListEl.innerHTML = `
      <div class="empty-pages-msg">
        ${allLoadedPages.length === 0 ? 'No Fanpages found yet.' : 'No Fanpages match the search.'}
      </div>
    `;
    updateSelectedCountUI();
    return;
  }

  pagesListEl.innerHTML = '';

  for (const page of displayPages) {
    const isSelected = selectedPageIds.has(page.id);
    const row = document.createElement('div');
    row.className = `page-row ${isSelected ? 'selected' : ''}`;
    row.dataset.id = page.id;

    // Mini avatar
    let thumbHtml = '<div class="page-thumb-placeholder">👤</div>';
    if (page.avatarUrl) {
      thumbHtml = `<img src="${page.avatarUrl}" class="page-thumb-img" alt="avatar" onerror="this.outerHTML='<div class=\\'page-thumb-placeholder\\'>👤</div>'">`;
    }

    // Status tag
    const statusTag = page.hasAvatar
      ? '<span class="page-status-tag tag-has">🟢 Has Avatar</span>'
      : '<span class="page-status-tag tag-missing">🔴 No Avatar</span>';

    row.innerHTML = `
      <input type="checkbox" class="page-checkbox" ${isSelected ? 'checked' : ''}>
      <div class="page-thumb-box">${thumbHtml}</div>
      <div class="page-details">
        <div class="page-row-name" title="${page.name}">${page.name}</div>
        <div class="page-row-id">${page.id}</div>
      </div>
      ${statusTag}
    `;

    // Click the checkbox or the row to select/deselect
    const cb = row.querySelector('.page-checkbox');
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      togglePageSelection(page.id, cb.checked, row);
    });

    row.addEventListener('click', (e) => {
      if (e.target !== cb) {
        cb.checked = !cb.checked;
        togglePageSelection(page.id, cb.checked, row);
      }
    });

    pagesListEl.appendChild(row);
  }

  updateSelectedCountUI();
}

function togglePageSelection(pageId, isChecked, rowEl) {
  if (isChecked) {
    selectedPageIds.add(pageId);
    rowEl.classList.add('selected');
  } else {
    selectedPageIds.delete(pageId);
    rowEl.classList.remove('selected');
  }
  updateSelectedCountUI();
}

function updateSelectedCountUI() {
  const count = selectedPageIds.size;
  selectedCountEl.textContent = count;

  if (count === 0) {
    btnStart.disabled = true;
    btnStart.innerHTML = '<span>⚠️</span> Select at least 1 Page to change';
  } else {
    btnStart.disabled = false;
    btnStart.innerHTML = `<span>🚀</span> Start changing Avatars (${count} Pages selected)`;
  }
}

// Sync Job status from Chrome Storage
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

// Start the Avatar update run
async function handleStart() {
  const preset = avatarPresetSelect.value;
  const delaySec = parseFloat(delaySlider.value);

  // ONLY TAKE PAGES THE USER TICKED
  const pagesToRun = allLoadedPages.filter((p) => selectedPageIds.has(p.id));

  if (pagesToRun.length === 0) {
    alert('Please tick at least one Fanpage to change its avatar!');
    return;
  }

  currentPageStatus.textContent = `⏳ Preparing to run for ${pagesToRun.length} selected Fanpages...`;
  btnStart.disabled = true;

  // Save the new Job to chrome.storage.local
  const newJob = {
    isRunning: true,
    isPaused: false,
    completed: false,
    preset,
    delaySeconds: delaySec,
    pages: pagesToRun,
    total: pagesToRun.length,
    currentIndex: 0,
    success: 0,
    failed: 0,
    phase: 'INIT',
    currentPageName: pagesToRun[0].name,
    statusMessage: `Starting update of ${pagesToRun.length} selected Fanpages...`,
    logs: [{
      time: new Date().toLocaleTimeString(),
      text: `🚀 Starting Avatar change for ${pagesToRun.length} Fanpages (Library: ${preset}, Wait: ${delaySec}s)`,
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
    pageName: pagesToRun[0].name,
    status: 'RUNNING',
    message: `Started a run for ${pagesToRun.length} Pages`,
  });

  // Wake up the Content Script in the Facebook tab
  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { action: 'TRIGGER_RESUME' });
  }

  btnStart.disabled = false;
}

// Pause / Resume
async function handlePause() {
  const { activeJob } = await chrome.storage.local.get('activeJob');
  if (!activeJob) return;

  const nextPaused = !activeJob.isPaused;
  activeJob.isPaused = nextPaused;
  activeJob.statusMessage = nextPaused ? 'Paused' : 'Resuming...';
  await chrome.storage.local.set({ activeJob });

  updateRunningUI(true, nextPaused);

  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { action: nextPaused ? 'PAUSE_JOB' : 'TRIGGER_RESUME' });
  }
}

// Stop completely
async function handleStop() {
  const { activeJob } = await chrome.storage.local.get('activeJob');
  if (activeJob) {
    activeJob.isRunning = false;
    activeJob.isPaused = false;
    activeJob.statusMessage = 'Stopped as requested';
    await chrome.storage.local.set({ activeJob });
  }

  updateRunningUI(false, false);
  currentPageStatus.textContent = '⏹️ Run stopped.';

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
    btnPause.innerHTML = paused ? '<span>▶️</span> Resume' : '<span>⏸️</span> Pause';
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
    currentPageStatus.textContent = `⚡ [${current + 1}/${total}] Processing: ${pageName || 'Fanpage'}...`;
  } else if (status === 'PAUSED') {
    currentPageStatus.textContent = `⏸️ Paused at [${current}/${total}]`;
  } else if (status === 'DONE') {
    currentPageStatus.textContent = `🎉 Finished all ${success}/${total} Fanpages!`;
    updateRunningUI(false, false);
  } else if (status === 'STOPPED') {
    currentPageStatus.textContent = '⏹️ Run stopped.';
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
