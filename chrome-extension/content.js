// content.js - Browser automation engine running directly in the Facebook tab
// Keeps state across Fanpage identity switches (Profile Switch) via chrome.storage.local

(function () {
  if (window.__VIPLIKE_AVATAR_INJECTED__) return;
  window.__VIPLIKE_AVATAR_INJECTED__ = true;

  console.log('[VIPLIKE Avatar Uploader] 🚀 Content Script activated on Facebook!');

  let floatingHud = null;
  let isExecuting = false;

  // 1. Listen for messages from the Extension Popup
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'GET_FB_INFO') {
      sendResponse(getFacebookUserInfo());
      return true;
    }

    if (req.action === 'SCAN_DOM_PAGES') {
      scanPagesFromFacebookDom().then((pages) => sendResponse({ success: true, pages }));
      return true;
    }

    if (req.action === 'TRIGGER_RESUME') {
      checkAndResumeEngine();
      sendResponse({ success: true });
      return true;
    }

    if (req.action === 'PAUSE_JOB') {
      updateHudControls(true);
      sendResponse({ success: true });
      return true;
    }

    if (req.action === 'STOP_JOB') {
      removeFloatingHud();
      sendResponse({ success: true });
      return true;
    }
  });

  // Automatically check and resume the run as soon as the Facebook page finishes loading
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(checkAndResumeEngine, 1500));
  } else {
    setTimeout(checkAndResumeEngine, 1500);
  }

  // =========================================================================
  // CORE ENGINE: CHECK STATE & EXECUTE ACROSS NAVIGATION
  // =========================================================================
  async function checkAndResumeEngine() {
    if (isExecuting) return;

    try {
      const { activeJob } = await chrome.storage.local.get('activeJob');
      if (!activeJob || !activeJob.isRunning) {
        removeFloatingHud();
        return;
      }

      if (activeJob.completed) {
        createFloatingHud(activeJob);
        updateFloatingHud(activeJob);
        return;
      }

      if (activeJob.isPaused) {
        createFloatingHud(activeJob);
        updateFloatingHud(activeJob);
        return;
      }

      // Start the next step
      isExecuting = true;
      createFloatingHud(activeJob);
      await executeNextStep(activeJob);
    } catch (err) {
      console.error('[VIPLIKE Avatar] Engine error:', err);
    } finally {
      isExecuting = false;
    }
  }

  async function executeNextStep(job) {
    if (job.currentIndex >= job.total) {
      job.isRunning = false;
      job.completed = true;
      job.statusMessage = `🎉 All done: ${job.success} successful, ${job.failed} errors!`;
      await chrome.storage.local.set({ activeJob: job });
      updateFloatingHud(job);
      notifyPopup(job);
      return;
    }

    const targetPage = job.pages[job.currentIndex];
    job.currentPageName = targetPage.name;
    updateFloatingHud(job);
    notifyPopup(job);

    // Check whether we're already on this Fanpage
    const activeProfileId = getActiveProfileId();
    const isSwitchedToPage = activeProfileId === String(targetPage.id);
    const onTargetPageUrl =
      window.location.href.includes(targetPage.id) ||
      document.documentElement.innerHTML.includes(`"page_id":"${targetPage.id}"`) ||
      document.documentElement.innerHTML.includes(`"entity_id":"${targetPage.id}"`);

    const readyToUpload = isSwitchedToPage || (job.switchedToId === targetPage.id && onTargetPageUrl);

    if (!readyToUpload) {
      // 1. Switch to the Fanpage identity (Profile Switch)
      job.statusMessage = `🔄 Switching to: ${targetPage.name}...`;
      job.switchedToId = targetPage.id;
      job.phase = 'SWITCHING';
      await chrome.storage.local.set({ activeJob: job });
      updateFloatingHud(job);

      // Try to confirm the dialog if this page has a Switch button
      await autoConfirmSwitchDialog();

      await sleep(800);
      const switchUrl = `https://www.facebook.com/profile/switch/?target_id=${targetPage.id}`;
      console.log(`[VIPLIKE Avatar] Switching identity to Page: ${targetPage.name} (${targetPage.id})`);
      window.location.href = switchUrl;
      // The browser navigates to the new page; the content script there resumes automatically!
      return;
    }

    // 2. We're on the right Page -> change the Avatar
    job.switchedToId = null; // Arrived, reset the flag
    job.phase = 'UPLOADING';
    job.statusMessage = `📸 Updating avatar: ${targetPage.name}...`;
    await chrome.storage.local.set({ activeJob: job });
    updateFloatingHud(job);

    try {
      await autoConfirmSwitchDialog();
      await sleep(2500);
      await dismissFacebookPopups();

      // SAFETY CHECK BEFORE UPLOADING:
      // If this Page actually ALREADY HAS a real avatar on Facebook (not the default silhouette)
      const hasRealAvatarOnFb = detectIfPageHasAvatarOnFacebook();
      if (hasRealAvatarOnFb && !targetPage.forceUpdate) {
        console.log(`[VIPLIKE Avatar] 🛡️ Page "${targetPage.name}" already has a real Avatar on Facebook. Skipping safely!`);
        addLog(job, `🛡️ Skipped safely: ${targetPage.name} (already has a real Avatar)`, 'info');
        job.statusMessage = `🛡️ Real avatar exists: skipping ${targetPage.name}...`;
        await chrome.storage.local.set({ activeJob: job });
        updateFloatingHud(job);
        notifyPopup(job);
        await sleep(1500);
      } else {
        const preset = job.preset || 'mix';
        const avatarUrl = window.getRandomAvatar
          ? window.getRandomAvatar(preset)
          : 'https://randomuser.me/api/portraits/women/1.jpg';

        console.log(`[VIPLIKE Avatar] Downloading sample avatar: ${avatarUrl}`);
        const imageFile = await urlToFile(avatarUrl, `avatar_${targetPage.id}.jpg`);

        await processAvatarUploadOnPage(imageFile, targetPage.name);

        job.success++;
        addLog(job, `✅ Success: ${targetPage.name}`, 'success');
        console.log(`[VIPLIKE Avatar] ✅ Updated successfully for ${targetPage.name}`);
      }
    } catch (err) {
      console.warn(`[VIPLIKE Avatar] ⚠️ Page error ${targetPage.name}:`, err.message);
      job.failed++;
      addLog(job, `⚠️ Error [${targetPage.name}]: ${err.message}`, 'error');
    }

    // Next step
    job.currentIndex++;
    if (job.currentIndex >= job.total) {
      job.isRunning = false;
      job.completed = true;
      job.statusMessage = `🎉 Done: ${job.success} successful, ${job.failed} errors!`;
      await chrome.storage.local.set({ activeJob: job });
      updateFloatingHud(job);
      notifyPopup(job);
      return;
    }

    // Prepare for the next Page
    const nextTarget = job.pages[job.currentIndex];
    job.currentPageName = nextTarget.name;
    job.switchedToId = null;
    const delay = job.delaySeconds || 4.0;
    job.statusMessage = `⏳ Resting ${delay}s before switching to ${nextTarget.name}...`;
    await chrome.storage.local.set({ activeJob: job });
    updateFloatingHud(job);
    notifyPopup(job);

    await sleep(delay * 1000);

    // Re-check whether the user clicked Pause / Stop while sleeping
    const { activeJob: checkJob } = await chrome.storage.local.get('activeJob');
    if (!checkJob || !checkJob.isRunning || checkJob.isPaused) {
      return;
    }

    // Move to the next page
    checkJob.switchedToId = nextTarget.id;
    checkJob.phase = 'SWITCHING';
    await chrome.storage.local.set({ activeJob: checkJob });
    window.location.href = `https://www.facebook.com/profile/switch/?target_id=${nextTarget.id}`;
  }

  // =========================================================================
  // DOM INTERACTIONS: CLICK THE CAMERA BUTTON & UPLOAD THE IMAGE ON FACEBOOK COMET
  // =========================================================================

  async function processAvatarUploadOnPage(imageFile, pageName) {
    // 1. Close any promo / welcome popup
    await dismissFacebookPopups();

    // 2. Find the avatar-change trigger (camera button, round avatar image, or Edit button)
    let trigger = null;
    for (let retry = 0; retry < 8; retry++) {
      trigger = findAvatarTrigger();
      if (trigger) break;
      await sleep(1000);
      await dismissFacebookPopups();
    }

    if (!trigger) {
      throw new Error('Avatar trigger not found on this Fanpage');
    }

    console.log('[VIPLIKE Avatar] 🎯 Found the trigger, clicking...', trigger);
    trigger.click();
    await sleep(2000);

    // 3. After clicking the trigger:
    // 3a. If a menu popup opens (Choose profile picture / Update profile picture / Upload photo)
    const menuButtons = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="button"], span'));
    const uploadOption = menuButtons.find((el) => {
      const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
      return (
        text.includes('chọn ảnh đại diện') ||
        text.includes('cập nhật ảnh đại diện') ||
        text.includes('tải ảnh lên') ||
        text.includes('choose profile picture') ||
        text.includes('upload photo')
      );
    });

    if (uploadOption) {
      console.log('[VIPLIKE Avatar] Clicking menu item:', uploadOption.innerText || uploadOption.textContent);
      uploadOption.click();
      await sleep(1800);
    }

    // 3b. If the "Edit profile" modal opens (from clicking the "Edit" button)
    // This modal has an "Add" or "Edit" button under the Profile picture section
    const dialogBtns = Array.from(document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] button'));
    const modalAvatarEditBtn = dialogBtns.find((b) => {
      const txt = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
      return (
        txt === 'chỉnh sửa' ||
        txt === 'thêm' ||
        txt.includes('chỉnh sửa ảnh') ||
        txt.includes('thêm ảnh') ||
        txt === 'add' ||
        txt === 'edit'
      );
    });

    if (modalAvatarEditBtn && !document.querySelector('div[role="dialog"] input[type="file"]')) {
      console.log('[VIPLIKE Avatar] Clicking the change-photo button in the Edit profile modal...');
      modalAvatarEditBtn.click();
      await sleep(1800);
    }

    // 4. Find the input[type="file"]
    let fileInput = document.querySelector('div[role="dialog"] input[type="file"], input[type="file"]');
    if (!fileInput) {
      // Find the "Upload photo" button inside the Dialog
      const dialogUploadBtn = Array.from(document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] button')).find((b) => {
        const txt = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
        return txt.includes('tải ảnh') || txt.includes('upload');
      });
      if (dialogUploadBtn) {
        dialogUploadBtn.click();
        await sleep(1500);
        fileInput = document.querySelector('div[role="dialog"] input[type="file"], input[type="file"]');
      }
    }

    if (!fileInput) {
      throw new Error('Facebook file picker input not found');
    }

    // 5. Load the image file via DataTransfer
    console.log('[VIPLIKE Avatar] 📁 Loading image file into input[type="file"]...');
    const dt = new DataTransfer();
    dt.items.add(imageFile);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // 6. Wait for the "Save" button to appear and click it (up to 18s)
    console.log('[VIPLIKE Avatar] ⏳ Waiting for the "Save" button to appear...');
    let saveClicked = false;

    for (let s = 0; s < 18; s++) {
      await sleep(1000);
      const allButtons = Array.from(
        document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] button, [aria-label="Lưu"], [aria-label="Save"]')
      );

      const saveBtn = allButtons.find((b) => {
        const txt = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return (txt === 'lưu' || txt === 'save' || txt === 'xong' || txt === 'hoàn tất') && b.offsetParent !== null;
      });

      if (saveBtn) {
        console.log('[VIPLIKE Avatar] 💾 Clicked "Save"!');
        saveBtn.click();
        saveClicked = true;
        break;
      }
    }

    if (!saveClicked) {
      throw new Error('"Save" button did not appear (image upload to Facebook timed out)');
    }

    // Wait 3.5s for Facebook to finish processing
    await sleep(3500);
    return true;
  }

  // Get the active identity ID (i_user: Fanpage ID if switched, c_user: parent account)
  function getActiveProfileId() {
    const m = document.cookie.match(/(?:^|;\s*)i_user=([^;]+)/);
    if (m) return m[1];
    const c = document.cookie.match(/(?:^|;\s*)c_user=([^;]+)/);
    return c ? c[1] : null;
  }

  // Automatically confirm the page switch if Facebook shows a confirmation dialog
  async function autoConfirmSwitchDialog() {
    for (let r = 0; r < 4; r++) {
      const btns = Array.from(
        document.querySelectorAll(
          'div[role="dialog"] div[role="button"], div[role="button"], button, [aria-label*="Chuyển"], [aria-label*="Switch"]'
        )
      );
      const confirmBtn = btns.find((b) => {
        const txt = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return (
          txt === 'chuyển' ||
          txt === 'chuyển ngay' ||
          txt === 'dùng trang' ||
          txt === 'switch' ||
          txt === 'switch now'
        );
      });
      if (confirmBtn && confirmBtn.offsetParent !== null) {
        console.log('[VIPLIKE Avatar] 🔄 Automatically confirming the page switch...');
        confirmBtn.click();
        await sleep(1500);
        break;
      }
      await sleep(500);
    }
  }

  // Find the avatar-change trigger with 3 flexible strategies
  function findAvatarTrigger() {
    // Strategy 1: scan every element with an avatar-related aria-label (case-insensitive)
    const elementsWithAria = Array.from(
      document.querySelectorAll('div[role="button"], button, [aria-label], svg, image')
    );

    for (const el of elementsWithAria) {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      if (
        label.includes('ảnh đại diện') ||
        label.includes('đại diện') ||
        label.includes('hành động với ảnh') ||
        label.includes('cập nhật ảnh') ||
        label.includes('chỉnh sửa ảnh') ||
        label.includes('profile picture') ||
        label.includes('update profile') ||
        label.includes('avatar')
      ) {
        const rect = el.getBoundingClientRect();
        const isTopRightNav = rect.top < 60 && rect.right > window.innerWidth - 150;
        if (!isTopRightNav && rect.width > 0 && rect.height > 0) {
          return el.closest('div[role="button"], button, a') || el;
        }
      }
    }

    // Strategy 2: click the round Avatar / large silhouette on the Fanpage directly
    const roundAvatars = Array.from(
      document.querySelectorAll('svg[role="img"], div[role="img"], image, img')
    ).filter((el) => {
      const rect = el.getBoundingClientRect();
      const isTopNav = rect.top < 60;
      // Main large avatar frame (>= 70px, inside the header area)
      return !isTopNav && rect.width >= 70 && rect.height >= 70 && rect.top < 500 && rect.top > 80;
    });

    if (roundAvatars.length > 0) {
      const avatarEl = roundAvatars[0];
      return avatarEl.closest('div[role="button"], a, div[tabindex="0"]') || avatarEl;
    }

    // Strategy 3: click the "Edit" button (pencil icon next to the Fanpage name)
    const editBtns = Array.from(
      document.querySelectorAll('div[role="button"], button')
    ).filter((b) => {
      const txt = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
      const isEdit = txt === 'chỉnh sửa' || txt === 'chỉnh sửa trang cá nhân' || txt === 'edit' || txt === 'edit profile';
      const rect = b.getBoundingClientRect();
      return isEdit && rect.top < 500 && rect.top > 120 && rect.width > 0;
    });

    if (editBtns.length > 0) {
      return editBtns[0];
    }

    return null;
  }

  // Detect whether the current Page on Facebook has a real avatar or just the default silhouette
  function detectIfPageHasAvatarOnFacebook() {
    try {
      const avatarImgs = Array.from(
        document.querySelectorAll('image, img[src*="scontent"], div[role="img"] image, a[href*="/photo"] img')
      );
      for (const el of avatarImgs) {
        const src = el.getAttribute('xlink:href') || el.getAttribute('src') || '';
        if (!src) continue;
        const isSilhouette =
          src.includes('t1.30497-1') ||
          src.includes('silhouette') ||
          src.includes('default_profile') ||
          src.includes('static.xx.fbcdn.net/rsrc.php');
        const isRealPhoto = (src.includes('t39.30808-1') || src.includes('fbcdn.net')) && !isSilhouette;

        const rect = el.getBoundingClientRect();
        // The main avatar usually sits in the header (top < 450px) and is large (>= 50px)
        if (isRealPhoto && rect.width >= 50 && rect.height >= 50 && rect.top < 450) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  async function dismissFacebookPopups() {
    const closeBtns = Array.from(
      document.querySelectorAll(
        'div[aria-label="Đóng"], div[aria-label="Close"], div[aria-label="Để sau"], div[role="button"]:has-text("Dùng Trang"), div[role="button"]:has-text("Chuyển")'
      )
    );
    for (const b of closeBtns) {
      try {
        b.click();
      } catch (e) {}
    }
  }

  // Download an image from a URL into a Blob and File
  async function urlToFile(imageUrl, filename = 'avatar.jpg') {
    const res = await fetch(imageUrl);
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || 'image/jpeg' });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function addLog(job, text, type = 'info') {
    if (!Array.isArray(job.logs)) job.logs = [];
    job.logs.push({
      time: new Date().toLocaleTimeString(),
      text,
      type,
    });
    if (job.logs.length > 50) job.logs = job.logs.slice(-50);
  }

  function notifyPopup(job) {
    try {
      const percent = job.total > 0 ? Math.round((job.currentIndex / job.total) * 100) : 0;
      chrome.runtime.sendMessage({
        type: 'AVATAR_PROGRESS',
        data: {
          total: job.total,
          current: job.currentIndex,
          success: job.success,
          failed: job.failed,
          percent: job.completed ? 100 : percent,
          pageName: job.currentPageName,
          status: job.completed ? 'DONE' : job.isPaused ? 'PAUSED' : job.isRunning ? 'RUNNING' : 'STOPPED',
          message: job.statusMessage,
        },
      });
    } catch (e) {}
  }

  // Get Facebook account info from the Cookie
  function getFacebookUserInfo() {
    const cUserMatch = document.cookie.match(/(?:^|;\s*)c_user=([^;]+)/);
    const uid = cUserMatch ? cUserMatch[1] : null;

    if (!uid) return { loggedIn: false };

    let name = 'Facebook account';
    const profileLink = document.querySelector('a[href*="/me/"], a[href*="/profile.php"], div[aria-label="Tài khoản"], div[aria-label="Account"]');
    if (profileLink) {
      name = profileLink.getAttribute('aria-label') || profileLink.innerText || name;
    }

    const avatarImg = document.querySelector('svg[aria-label*="cá nhân"] image, div[aria-label="Tài khoản"] image, a[href*="/me/"] img');
    const avatarUrl = avatarImg ? (avatarImg.getAttribute('xlink:href') || avatarImg.getAttribute('src') || '') : '';

    return {
      loggedIn: true,
      uid,
      name: name.replace(/^Tài khoản của\s*/i, '').trim(),
      avatarUrl,
    };
  }

  // Scan the Fanpage list from the DOM
  async function scanPagesFromFacebookDom() {
    const pages = [];
    const seen = new Set();
    const links = document.querySelectorAll('a[href*="/profile.php?id="], a[href*="/pages/"]');
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/id=([0-9]{12,})/);
      if (m && !seen.has(m[1])) {
        const id = m[1];
        seen.add(id);
        const rawName = a.innerText || a.textContent || '';
        const name = rawName.replace(/[\n\r]+/g, ' ').trim() || `Fanpage ${id.slice(-4)}`;
        pages.push({ id, name, url: href });
      }
    }
    return pages;
  }

  // =========================================================================
  // FLOATING HUD: FLOATING CONTROL BAR RIGHT ON FACEBOOK
  // =========================================================================

  function createFloatingHud(job) {
    if (floatingHud) return;

    floatingHud = document.createElement('div');
    floatingHud.id = 'viplike-avatar-hud';
    floatingHud.innerHTML = `
      <div class="vl-hud-header">
        <span class="vl-hud-badge">⚡ VIPLIKE</span>
        <span class="vl-hud-title">Avatar Uploader</span>
        <span id="vl-hud-percent" class="vl-hud-percent">0%</span>
        <button id="vl-hud-btn-close" class="vl-hud-btn-sm" title="Close panel">✕</button>
      </div>
      <div class="vl-hud-body">
        <div class="vl-hud-bar-bg">
          <div id="vl-hud-bar-fill" class="vl-hud-bar-fill" style="width: 0%;"></div>
        </div>
        <div class="vl-hud-stats">
          <span>Progress: <b id="vl-hud-current">0</b>/${job.total || 0}</span>
          <span style="color: #34d399;">Success: <b id="vl-hud-success">${job.success || 0}</b></span>
          <span style="color: #f87171;">Errors: <b id="vl-hud-failed">${job.failed || 0}</b></span>
        </div>
        <div id="vl-hud-page-name" class="vl-hud-current-page">Starting...</div>
      </div>
      <div class="vl-hud-footer">
        <button id="vl-hud-btn-pause" class="vl-hud-btn-action">⏸️ Pause</button>
        <button id="vl-hud-btn-stop" class="vl-hud-btn-action vl-hud-btn-danger">⏹️ Stop</button>
      </div>
    `;

    document.body.appendChild(floatingHud);

    // Inline CSS styling for the Floating Widget
    if (!document.getElementById('viplike-avatar-hud-style')) {
      const style = document.createElement('style');
      style.id = 'viplike-avatar-hud-style';
      style.textContent = `
        #viplike-avatar-hud {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 330px;
          background: rgba(9, 13, 22, 0.95);
          backdrop-filter: blur(14px);
          border: 1px solid rgba(14, 165, 233, 0.4);
          border-radius: 14px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7), 0 0 16px rgba(14, 165, 233, 0.25);
          z-index: 9999999;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #f1f5f9;
          font-size: 12px;
          line-height: 1.4;
          padding: 12px;
          animation: viplikeSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes viplikeSlideUp {
          from { transform: translateY(30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .vl-hud-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(51, 65, 85, 0.5);
        }
        .vl-hud-badge {
          font-size: 10px;
          font-weight: 800;
          background: linear-gradient(135deg, #0284c7, #06b6d4);
          color: #fff;
          padding: 1px 6px;
          border-radius: 6px;
        }
        .vl-hud-title {
          font-weight: 700;
          font-size: 12px;
          flex: 1;
        }
        .vl-hud-percent {
          font-weight: 800;
          color: #38bdf8;
          font-family: monospace;
        }
        .vl-hud-btn-sm {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-size: 12px;
          padding: 2px 4px;
        }
        .vl-hud-btn-sm:hover { color: #fff; }
        .vl-hud-body {
          padding: 8px 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .vl-hud-bar-bg {
          width: 100%;
          height: 6px;
          background: #1e293b;
          border-radius: 3px;
          overflow: hidden;
        }
        .vl-hud-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #0284c7, #10b981);
          transition: width 0.3s;
        }
        .vl-hud-stats {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #94a3b8;
        }
        .vl-hud-stats b { font-family: monospace; }
        .vl-hud-current-page {
          font-size: 11px;
          font-weight: 600;
          color: #38bdf8;
          background: rgba(2, 132, 199, 0.12);
          border: 1px solid rgba(2, 132, 199, 0.3);
          padding: 5px 8px;
          border-radius: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vl-hud-footer {
          display: flex;
          gap: 6px;
          padding-top: 6px;
        }
        .vl-hud-btn-action {
          flex: 1;
          padding: 6px 10px;
          background: #1e293b;
          color: #f1f5f9;
          border: 1px solid #334155;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
        }
        .vl-hud-btn-action:hover {
          background: #334155;
        }
        .vl-hud-btn-danger {
          background: rgba(220, 38, 38, 0.2);
          border-color: rgba(220, 38, 38, 0.5);
          color: #f87171;
        }
        .vl-hud-btn-danger:hover {
          background: #dc2626;
          color: #fff;
        }
      `;
      document.head.appendChild(style);
    }

    // Attach control events
    document.getElementById('vl-hud-btn-close').addEventListener('click', removeFloatingHud);

    document.getElementById('vl-hud-btn-pause').addEventListener('click', async () => {
      const { activeJob } = await chrome.storage.local.get('activeJob');
      if (!activeJob) return;
      activeJob.isPaused = !activeJob.isPaused;
      await chrome.storage.local.set({ activeJob });
      updateHudControls(activeJob.isPaused);
      if (!activeJob.isPaused) {
        checkAndResumeEngine();
      }
    });

    document.getElementById('vl-hud-btn-stop').addEventListener('click', async () => {
      const { activeJob } = await chrome.storage.local.get('activeJob');
      if (activeJob) {
        activeJob.isRunning = false;
        await chrome.storage.local.set({ activeJob });
      }
      removeFloatingHud();
    });

    updateFloatingHud(job);
  }

  function updateFloatingHud(job) {
    if (!floatingHud) return;
    const barFill = document.getElementById('vl-hud-bar-fill');
    const percentEl = document.getElementById('vl-hud-percent');
    const currentEl = document.getElementById('vl-hud-current');
    const successEl = document.getElementById('vl-hud-success');
    const failedEl = document.getElementById('vl-hud-failed');
    const pageNameEl = document.getElementById('vl-hud-page-name');

    const percent = job.total > 0 ? Math.round((job.currentIndex / job.total) * 100) : 0;

    if (barFill) barFill.style.width = `${job.completed ? 100 : percent}%`;
    if (percentEl) percentEl.textContent = `${job.completed ? 100 : percent}%`;
    if (currentEl) currentEl.textContent = job.currentIndex || 0;
    if (successEl) successEl.textContent = job.success || 0;
    if (failedEl) failedEl.textContent = job.failed || 0;
    if (pageNameEl) pageNameEl.textContent = job.statusMessage || (job.currentPageName ? `Processing: ${job.currentPageName}` : 'Processing...');

    updateHudControls(job.isPaused);
  }

  function updateHudControls(isPaused) {
    const btnPause = document.getElementById('vl-hud-btn-pause');
    if (btnPause) {
      btnPause.textContent = isPaused ? '▶️ Resume' : '⏸️ Pause';
      btnPause.style.background = isPaused ? '#d97706' : '#1e293b';
    }
  }

  function removeFloatingHud() {
    if (floatingHud) {
      floatingHud.remove();
      floatingHud = null;
    }
    const style = document.getElementById('viplike-avatar-hud-style');
    if (style) style.remove();
  }
})();
