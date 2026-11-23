import seedData from './seedViasAndPages.json';

export interface SeedVia {
  id: number;
  pageName: string;
  platformAccountId: string;
  platform: string;
  accountType: string;
  tokenStatus: string;
  cookieString: string;
  accessToken: string;
}

export interface SeedPage {
  id: string;
  name: string;
  url: string;
  personalProfileId: string;
  profileName: string;
  viaAccountId?: number | 'CUSTOM';
  viaName?: string;
  viaStatus?: string;
}

const VIA_COOKIE_PREFIX = 'viplike_via_cookie_';
const VIA_PAGES_STORAGE_KEY_V3 = 'toolzutter:via_fanpages_map_v3';
const VIA_PAGES_STORAGE_KEY_BUFF = 'buff_via_fanpages';

/**
 * Lấy danh sách 3 Nick Mẹ mặc định (Thành An, Hồng Phước, Thạnh Phú),
 * tự động ghép Cookie mới nhất đã lưu trong LocalStorage nếu người dùng đã cập nhật.
 */
export function getInitialSeedVias(): SeedVia[] {
  const vias: SeedVia[] = (seedData.vias as SeedVia[]).map((v) => {
    const savedCookie = getStoredCookieForVia(v.platformAccountId);
    return {
      ...v,
      cookieString: savedCookie || v.cookieString || '',
      accessToken: savedCookie || v.accessToken || '',
      tokenStatus: savedCookie ? 'OK' : v.tokenStatus || 'OK',
    };
  });
  return vias;
}

/**
 * Lấy toàn bộ 508 Fanpage mẫu phân theo từng UID nick mẹ.
 */
export function getInitialSeedPages(): Record<string, SeedPage[]> {
  return (seedData.pagesByUid || {}) as Record<string, SeedPage[]>;
}

/**
 * Lấy cookie đã lưu trong máy cho một UID.
 */
export function getStoredCookieForVia(uid: string): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(`${VIA_COOKIE_PREFIX}${uid}`) || '';
}

/**
 * Lưu cookie cập nhật cho một UID vào LocalStorage.
 */
export function saveStoredCookieForVia(uid: string, cookie: string): void {
  if (typeof window === 'undefined' || !uid) return;
  if (cookie && cookie.trim()) {
    localStorage.setItem(`${VIA_COOKIE_PREFIX}${uid}`, cookie.trim());
  } else {
    localStorage.removeItem(`${VIA_COOKIE_PREFIX}${uid}`);
  }
}

/**
 * Tự động nạp 508 Fanpage vào LocalStorage nếu máy mới mở app lần đầu hoặc đang trống.
 */
export function seedLocalStorageIfEmpty(): void {
  if (typeof window === 'undefined') return;

  const seedPages = getInitialSeedPages();

  // 1. Đồng bộ cho key 'toolzutter:via_fanpages_map_v3' (BuffEngagement dùng)
  try {
    const rawV3 = localStorage.getItem(VIA_PAGES_STORAGE_KEY_V3);
    const mapV3: Record<string, any[]> = rawV3 ? JSON.parse(rawV3) : {};
    let changedV3 = false;

    for (const [uid, pages] of Object.entries(seedPages)) {
      const key = `cuser_${uid}`;
      if (!mapV3[key] || mapV3[key].length === 0) {
        mapV3[key] = pages;
        changedV3 = true;
      }
    }

    if (changedV3 || !rawV3) {
      localStorage.setItem(VIA_PAGES_STORAGE_KEY_V3, JSON.stringify(mapV3));
    }
  } catch (e) {
    console.warn('[Seed] Lỗi seed toolzutter:via_fanpages_map_v3:', e);
  }

  // 2. Đồng bộ cho key 'buff_via_fanpages' (ViaManagementPage dùng)
  try {
    const rawBuff = localStorage.getItem(VIA_PAGES_STORAGE_KEY_BUFF);
    const mapBuff: Record<string, any[]> = rawBuff ? JSON.parse(rawBuff) : {};
    let changedBuff = false;

    for (const [uid, pages] of Object.entries(seedPages)) {
      if (!mapBuff[uid] || mapBuff[uid].length === 0) {
        mapBuff[uid] = pages;
        changedBuff = true;
      }
    }

    if (changedBuff || !rawBuff) {
      localStorage.setItem(VIA_PAGES_STORAGE_KEY_BUFF, JSON.stringify(mapBuff));
    }
  } catch (e) {
    console.warn('[Seed] Lỗi seed buff_via_fanpages:', e);
  }
}
