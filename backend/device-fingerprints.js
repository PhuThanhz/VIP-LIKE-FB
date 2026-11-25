/**
 * device-fingerprints.js
 * Diverse hardware device identity & User-Agent emulator
 * Prevents Meta Fingerprinting from grouping Vias onto the same computer
 */

const DEVICE_PROFILES = [
  {
    name: 'MacBook Pro M3 (macOS Sonoma)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    platform: 'MacIntel',
    vendor: 'Google Inc.',
  },
  {
    name: 'Windows 11 PC (Chrome 133)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    vendor: 'Google Inc.',
  },
  {
    name: 'Dell XPS 15 (Windows 11 Pro)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
    viewport: { width: 1536, height: 864 },
    deviceScaleFactor: 1.25,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    vendor: 'Google Inc.',
  },
  {
    name: 'iMac 24-inch M3 (macOS Chrome 134)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1680, height: 1050 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    platform: 'MacIntel',
    vendor: 'Google Inc.',
  },
  {
    name: 'Asus ZenBook 14 (Windows 11 Chrome 134)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.25,
    isMobile: false,
    hasTouch: false,
    platform: 'Win32',
    vendor: 'Google Inc.',
  },
  {
    name: 'ThinkPad X1 Carbon (Linux Ubuntu)',
    type: 'DESKTOP',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    platform: 'Linux x86_64',
    vendor: 'Google Inc.',
  },
];

/**
 * Returns a stable device emulation config per UID (the same UID always uses its familiar device type)
 */
function getDeviceForUid(uid = '') {
  if (!uid) {
    return DEVICE_PROFILES[Math.floor(Math.random() * DEVICE_PROFILES.length)];
  }
  // Hash the UID string to pin a device per account (like a real person using their familiar phone/computer)
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash << 5) - hash + uid.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % DEVICE_PROFILES.length;
  return DEVICE_PROFILES[index];
}

/**
 * Applies the config and the stealth script to the context
 */
async function applyFingerprintToContext(context, profile) {
  await context.addInitScript((prof) => {
    // 1. Hide Playwright/Selenium webdriver traces
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // 2. Mock vendor & platform
    if (prof.vendor) {
      Object.defineProperty(navigator, 'vendor', {
        get: () => prof.vendor,
      });
    }
    if (prof.platform) {
      Object.defineProperty(navigator, 'platform', {
        get: () => prof.platform,
      });
    }

    // 3. Mock Vietnamese & English languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['vi-VN', 'vi', 'en-US', 'en'],
    });

    // 4. Mock window.chrome for Chromium-based browsers
    if (!window.chrome) {
      window.chrome = {
        runtime: {},
        loadTimes: () => {},
        csi: () => {},
      };
    }
  }, profile);
}

module.exports = {
  DEVICE_PROFILES,
  getDeviceForUid,
  applyFingerprintToContext,
};
