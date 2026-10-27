// content.js - Engine tự động hóa trình duyệt chạy trực tiếp trên Tab Facebook
// Tự động duy trì trạng thái qua các lần chuyển danh tính Fanpage (Profile Switch) bằng chrome.storage.local

(function () {
  if (window.__VIPLIKE_AVATAR_INJECTED__) return;
  window.__VIPLIKE_AVATAR_INJECTED__ = true;

  console.log('[VIPLIKE Avatar Uploader] 🚀 Content Script đã kích hoạt trên Facebook!');

  let floatingHud = null;
  let isExecuting = false;

  // 1. Lắng nghe thông điệp từ Extension Popup
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

  // Tự động kiểm tra và tiếp tục tiến trình ngay khi trang Facebook tải xong
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(checkAndResumeEngine, 1500));
  } else {
    setTimeout(checkAndResumeEngine, 1500);
  }

  // =========================================================================
  // CORE ENGINE: KIỂM TRA TRẠNG THÁI & THỰC THI QUA NAVIGATION
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

      // Khởi động chạy bước tiếp theo
      isExecuting = true;
      createFloatingHud(activeJob);
      await executeNextStep(activeJob);
    } catch (err) {
      console.error('[VIPLIKE Avatar] Lỗi trong Engine:', err);
    } finally {
      isExecuting = false;
    }
  }

  async function executeNextStep(job) {
    if (job.currentIndex >= job.total) {
      job.isRunning = false;
      job.completed = true;
      job.statusMessage = `🎉 Hoàn tất toàn bộ: ${job.success} thành công, ${job.failed} lỗi!`;
      await chrome.storage.local.set({ activeJob: job });
      updateFloatingHud(job);
      notifyPopup(job);
      return;
    }

    const targetPage = job.pages[job.currentIndex];
    job.currentPageName = targetPage.name;
    updateFloatingHud(job);
    notifyPopup(job);

    // Kiểm tra xem chúng ta đã ở đúng trang Fanpage này chưa
    const activeProfileId = getActiveProfileId();
    const isSwitchedToPage = activeProfileId === String(targetPage.id);
    const onTargetPageUrl =
      window.location.href.includes(targetPage.id) ||
      document.documentElement.innerHTML.includes(`"page_id":"${targetPage.id}"`) ||
      document.documentElement.innerHTML.includes(`"entity_id":"${targetPage.id}"`);

    const readyToUpload = isSwitchedToPage || (job.switchedToId === targetPage.id && onTargetPageUrl);

    if (!readyToUpload) {
      // 1. Chuyển sang danh tính Fanpage (Profile Switch)
      job.statusMessage = `🔄 Đang chuyển sang: ${targetPage.name}...`;
      job.switchedToId = targetPage.id;
      job.phase = 'SWITCHING';
      await chrome.storage.local.set({ activeJob: job });
      updateFloatingHud(job);

      // Thử xác nhận hộp thoại nếu đang ở trang có nút Chuyển
      await autoConfirmSwitchDialog();

      await sleep(800);
      const switchUrl = `https://www.facebook.com/profile/switch/?target_id=${targetPage.id}`;
      console.log(`[VIPLIKE Avatar] Chuyển danh tính sang Page: ${targetPage.name} (${targetPage.id})`);
      window.location.href = switchUrl;
      // Trình duyệt sẽ navigate sang trang mới. Content script trên trang mới sẽ tự tiếp tục!
      return;
    }

    // 2. Chúng ta đã ở trên đúng Page -> Tiến hành đổi Avatar
    job.switchedToId = null; // Đã đến nơi, reset cờ
    job.phase = 'UPLOADING';
    job.statusMessage = `📸 Đang cập nhật ảnh đại diện: ${targetPage.name}...`;
    await chrome.storage.local.set({ activeJob: job });
    updateFloatingHud(job);

    try {
      await autoConfirmSwitchDialog();
      await sleep(2500);
      await dismissFacebookPopups();

      // KIỂM TRA BẢO VỆ AN TOÀN TRƯỚC KHI TẢI:
      // Nếu phát hiện Page này trên thực tế ĐÃ CÓ avatar thật trên Facebook (không phải bóng mờ silhouette)
      const hasRealAvatarOnFb = detectIfPageHasAvatarOnFacebook();
      if (hasRealAvatarOnFb && !targetPage.forceUpdate) {
        console.log(`[VIPLIKE Avatar] 🛡️ Page "${targetPage.name}" đã có Avatar thật trên Facebook. Bỏ qua an toàn!`);
        addLog(job, `🛡️ Bỏ qua an toàn: ${targetPage.name} (Đã có Avatar thật)`, 'info');
        job.statusMessage = `🛡️ Đã có avatar thật: Bỏ qua ${targetPage.name}...`;
        await chrome.storage.local.set({ activeJob: job });
        updateFloatingHud(job);
        notifyPopup(job);
        await sleep(1500);
      } else {
        const preset = job.preset || 'mix';
        const avatarUrl = window.getRandomAvatar
          ? window.getRandomAvatar(preset)
          : 'https://randomuser.me/api/portraits/women/1.jpg';

        console.log(`[VIPLIKE Avatar] Tải ảnh đại diện mẫu: ${avatarUrl}`);
        const imageFile = await urlToFile(avatarUrl, `avatar_${targetPage.id}.jpg`);

        await processAvatarUploadOnPage(imageFile, targetPage.name);

        job.success++;
        addLog(job, `✅ Thành công: ${targetPage.name}`, 'success');
        console.log(`[VIPLIKE Avatar] ✅ Cập nhật thành công cho ${targetPage.name}`);
      }
    } catch (err) {
      console.warn(`[VIPLIKE Avatar] ⚠️ Lỗi Page ${targetPage.name}:`, err.message);
      job.failed++;
      addLog(job, `⚠️ Lỗi [${targetPage.name}]: ${err.message}`, 'error');
    }

    // Bước tiếp theo
    job.currentIndex++;
    if (job.currentIndex >= job.total) {
      job.isRunning = false;
      job.completed = true;
      job.statusMessage = `🎉 Hoàn tất: ${job.success} thành công, ${job.failed} lỗi!`;
      await chrome.storage.local.set({ activeJob: job });
      updateFloatingHud(job);
      notifyPopup(job);
      return;
    }

    // Chuẩn bị sang Page kế tiếp
    const nextTarget = job.pages[job.currentIndex];
    job.currentPageName = nextTarget.name;
    job.switchedToId = null;
    const delay = job.delaySeconds || 4.0;
    job.statusMessage = `⏳ Nghỉ ${delay}s trước khi chuyển sang ${nextTarget.name}...`;
    await chrome.storage.local.set({ activeJob: job });
    updateFloatingHud(job);
    notifyPopup(job);

    await sleep(delay * 1000);

    // Kiểm tra lại nếu người dùng đã bấm Tạm dừng / Dừng trong lúc ngủ
    const { activeJob: checkJob } = await chrome.storage.local.get('activeJob');
    if (!checkJob || !checkJob.isRunning || checkJob.isPaused) {
      return;
    }

    // Chuyển trang tiếp theo
    checkJob.switchedToId = nextTarget.id;
    checkJob.phase = 'SWITCHING';
    await chrome.storage.local.set({ activeJob: checkJob });
    window.location.href = `https://www.facebook.com/profile/switch/?target_id=${nextTarget.id}`;
  }

  // =========================================================================
  // DOM INTERACTIONS: CLICK NÚT CAMERA & NẠP ẢNH TRÊN FACEBOOK COMET
  // =========================================================================

  async function processAvatarUploadOnPage(imageFile, pageName) {
    // 1. Tắt popup quảng cáo / chào mừng nếu có
    await dismissFacebookPopups();

    // 2. Tìm nút Camera trên Avatar Page
    let cameraBtn = null;
    for (let retry = 0; retry < 6; retry++) {
      cameraBtn = findCameraBtn();
      if (cameraBtn) break;
      await sleep(1000);
      await dismissFacebookPopups();
    }

    if (!cameraBtn) {
      throw new Error('Không tìm thấy nút Camera đại diện (Hãy chắc chắn nick có quyền Admin Page)');
    }

    console.log('[VIPLIKE Avatar] Đã tìm thấy nút Camera, đang click...');
    cameraBtn.click();
    await sleep(1800);

    // 3. Nhấp chọn "Chọn ảnh đại diện" hoặc "Tải ảnh lên" trong menu bật lên
    const menuButtons = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="button"], span'));
    const uploadOption = menuButtons.find((el) => {
      const text = (el.innerText || el.textContent || '').trim().toLowerCase();
      return (
        text.includes('chọn ảnh đại diện') ||
        text.includes('tải ảnh lên') ||
        text.includes('choose profile picture') ||
        text.includes('upload photo')
      );
    });

    if (uploadOption) {
      uploadOption.click();
      await sleep(1500);
    }

    // 4. Tìm thẻ input[type="file"]
    let fileInput = document.querySelector('div[role="dialog"] input[type="file"], input[type="file"]');
    if (!fileInput) {
      // Tìm nút "Tải ảnh lên" bên trong Dialog
      const dialogBtns = Array.from(document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] button'));
      const uploadDialogBtn = dialogBtns.find((b) => {
        const txt = (b.innerText || '').toLowerCase();
        return txt.includes('tải ảnh') || txt.includes('upload');
      });
      if (uploadDialogBtn) {
        uploadDialogBtn.click();
        await sleep(1200);
        fileInput = document.querySelector('div[role="dialog"] input[type="file"], input[type="file"]');
      }
    }

    if (!fileInput) {
      throw new Error('Không tìm thấy input[type="file"] tải ảnh');
    }

    // 5. Nạp file ảnh bằng DataTransfer
    console.log('[VIPLIKE Avatar] Nạp file ảnh vào input[type="file"]...');
    const dt = new DataTransfer();
    dt.items.add(imageFile);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    // 6. Chờ nút "Lưu" (Save) xuất hiện và nhấp Lưu (tối đa 15s)
    console.log('[VIPLIKE Avatar] Đang đợi nút "Lưu" xuất hiện...');
    let saveClicked = false;

    for (let s = 0; s < 15; s++) {
      await sleep(1000);
      const allButtons = Array.from(
        document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] button, [aria-label="Lưu"], [aria-label="Save"]')
      );

      const saveBtn = allButtons.find((b) => {
        const txt = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return (txt === 'lưu' || txt === 'save' || txt === 'xong' || txt === 'hoàn tất') && b.offsetParent !== null;
      });

      if (saveBtn) {
        console.log('[VIPLIKE Avatar] 💾 Đã bấm nút "Lưu"!');
        saveBtn.click();
        saveClicked = true;
        break;
      }
    }

    if (!saveClicked) {
      throw new Error('Nút "Lưu" không xuất hiện (Thời gian tải ảnh lên Facebook quá hạn)');
    }

    // Chờ 3.5s để Facebook xử lý xong
    await sleep(3500);
    return true;
  }

  // Lấy ID danh tính đang hoạt động (i_user: ID Fanpage nếu đã switch, c_user: nick mẹ)
  function getActiveProfileId() {
    const m = document.cookie.match(/(?:^|;\s*)i_user=([^;]+)/);
    if (m) return m[1];
    const c = document.cookie.match(/(?:^|;\s*)c_user=([^;]+)/);
    return c ? c[1] : null;
  }

  // Tự động click xác nhận Chuyển trang nếu Facebook hiện hộp thoại xác nhận
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
        console.log('[VIPLIKE Avatar] 🔄 Tự động click xác nhận Chuyển trang...');
        confirmBtn.click();
        await sleep(1500);
        break;
      }
      await sleep(500);
    }
  }

  function findCameraBtn() {
    // 1. Tìm trực tiếp bằng các nhãn aria-label phổ biến của Facebook tiếng Việt & Anh
    const directCandidates = Array.from(
      document.querySelectorAll(
        'div[aria-label*="ảnh đại diện"], div[aria-label*="Hành động với ảnh đại diện"], div[aria-label*="Cập nhật ảnh đại diện"], div[aria-label*="Chỉnh sửa ảnh đại diện"], div[aria-label*="Profile picture" i], div[aria-label*="Update profile picture" i], div[aria-label*="Avatar" i]'
      )
    );

    for (const el of directCandidates) {
      const rect = el.getBoundingClientRect();
      const isTopRightNav = rect.top < 60 && rect.right > window.innerWidth - 150;
      if (!isTopRightNav && rect.width > 0 && rect.height > 0) {
        return el;
      }
    }

    // 2. Tìm qua icon camera bên trong nút hành động
    const cameraIcons = Array.from(document.querySelectorAll('i, svg'));
    for (const ic of cameraIcons) {
      const label = (ic.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('camera') || label.includes('ảnh đại diện') || label.includes('đại diện')) {
        const btn = ic.closest('div[role="button"], button');
        if (btn) {
          const rect = btn.getBoundingClientRect();
          const isTopRightNav = rect.top < 60 && rect.right > window.innerWidth - 150;
          if (!isTopRightNav && rect.width > 0 && rect.height > 0) {
            return btn;
          }
        }
      }
    }

    // 3. Tìm nút tròn nhỏ đè ngay trên khung Avatar chính của Fanpage
    const mainAvatarImg = document.querySelector('svg[role="img"] image, a[href*="/photo"] img, a[href*="profile"] img');
    if (mainAvatarImg) {
      const avatarRect = mainAvatarImg.getBoundingClientRect();
      if (avatarRect.width >= 50 && avatarRect.height >= 50 && avatarRect.top < 450) {
        const nearbyBtns = Array.from(document.querySelectorAll('div[role="button"]')).filter((b) => {
          const r = b.getBoundingClientRect();
          return (
            Math.abs(r.left - avatarRect.left) < 180 &&
            Math.abs(r.top - avatarRect.top) < 180 &&
            r.width > 0 &&
            r.width < 90
          );
        });
        if (nearbyBtns.length > 0) {
          const camBtn = nearbyBtns.find((b) => (b.getAttribute('aria-label') || '').includes('ảnh') || b.querySelector('i, svg'));
          return camBtn || nearbyBtns[0];
        }
      }
    }

    return null;
  }

  // Phát hiện xem Page hiện tại trên Facebook đã có avatar thật hay chỉ là silhouette mặc định
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
        // Ảnh đại diện chính thường nằm ở phần header (top < 450px) và kích thước lớn (>= 50px)
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

  // Tải ảnh từ URL về Blob và File
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

  // Lấy thông tin tài khoản Facebook từ Cookie
  function getFacebookUserInfo() {
    const cUserMatch = document.cookie.match(/(?:^|;\s*)c_user=([^;]+)/);
    const uid = cUserMatch ? cUserMatch[1] : null;

    if (!uid) return { loggedIn: false };

    let name = 'Tài khoản Facebook';
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

  // Quét danh sách Fanpage từ DOM
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
  // FLOATING HUD: THANH ĐIỀU KHIỂN NỔI NGAY TRÊN FACEBOOK
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
        <button id="vl-hud-btn-close" class="vl-hud-btn-sm" title="Đóng bảng">✕</button>
      </div>
      <div class="vl-hud-body">
        <div class="vl-hud-bar-bg">
          <div id="vl-hud-bar-fill" class="vl-hud-bar-fill" style="width: 0%;"></div>
        </div>
        <div class="vl-hud-stats">
          <span>Tiến trình: <b id="vl-hud-current">0</b>/${job.total || 0}</span>
          <span style="color: #34d399;">Thành công: <b id="vl-hud-success">${job.success || 0}</b></span>
          <span style="color: #f87171;">Lỗi: <b id="vl-hud-failed">${job.failed || 0}</b></span>
        </div>
        <div id="vl-hud-page-name" class="vl-hud-current-page">Đang khởi động...</div>
      </div>
      <div class="vl-hud-footer">
        <button id="vl-hud-btn-pause" class="vl-hud-btn-action">⏸️ Tạm dừng</button>
        <button id="vl-hud-btn-stop" class="vl-hud-btn-action vl-hud-btn-danger">⏹️ Dừng</button>
      </div>
    `;

    document.body.appendChild(floatingHud);

    // CSS Styling trực tiếp cho Floating Widget
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

    // Gắn sự kiện điều khiển
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
    if (pageNameEl) pageNameEl.textContent = job.statusMessage || (job.currentPageName ? `Đang xử lý: ${job.currentPageName}` : 'Đang xử lý...');

    updateHudControls(job.isPaused);
  }

  function updateHudControls(isPaused) {
    const btnPause = document.getElementById('vl-hud-btn-pause');
    if (btnPause) {
      btnPause.textContent = isPaused ? '▶️ Tiếp tục' : '⏸️ Tạm dừng';
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
