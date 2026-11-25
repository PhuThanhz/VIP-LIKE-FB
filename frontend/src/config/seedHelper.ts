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
 * Returns the 3 default parent accounts (Thành An, Hồng Phước, Thạnh Phú),
 * automatically merging the latest cookie saved in LocalStorage if the user has updated it.
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
 * Returns all 508 sample Fanpages grouped by parent account UID.
 */
export function getInitialSeedPages(): Record<string, SeedPage[]> {
  return (seedData.pagesByUid || {}) as Record<string, SeedPage[]>;
}

/**
 * Reads the cookie saved on this machine for a UID.
 */
export function getStoredCookieForVia(uid: string): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(`${VIA_COOKIE_PREFIX}${uid}`) || '';
}

/**
 * Saves an updated cookie for a UID to LocalStorage.
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
 * Automatically loads the 508 Fanpages into LocalStorage the first time the app opens on a machine or when it is empty.
 */
export function seedLocalStorageIfEmpty(): void {
  if (typeof window === 'undefined') return;

  const seedPages = getInitialSeedPages();

  // 1. Sync the 'toolzutter:via_fanpages_map_v3' key (used by BuffEngagement)
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
    console.warn('[Seed] Failed to seed toolzutter:via_fanpages_map_v3:', e);
  }

  // 2. Sync the 'buff_via_fanpages' key (used by ViaManagementPage)
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
    console.warn('[Seed] Failed to seed buff_via_fanpages:', e);
  }
}
