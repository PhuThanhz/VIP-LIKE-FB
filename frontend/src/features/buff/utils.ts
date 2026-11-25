import { WORKER_BASE_URL } from '../../config/axios';
import { triggerCookieExpiredAlert } from '../../components/common/CookieAlertManager';
import type {
  FanpageItem,
  AutoBuffResultDetail,
  BuffStreamProgressEvent,
  BuffRunResult,
  ViaGroup,
  BuffLogEntry,
} from './types';
import {
  LEGACY_BUFF_LOGS_STORAGE_KEY,
  SPEED_PRESETS,
  VIA_PAGES_STORAGE_KEY,
} from './constants';

export const formatDuration = (totalSec: number): string => {
  const sec = Math.max(0, Math.round(totalSec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}p ${sec % 60}s`;
  return `${Math.floor(m / 60)}g ${m % 60}p`;
};

export class BuffStreamError extends Error {
  receivedAny: boolean;
  constructor(message: string, receivedAny: boolean) {
    super(message);
    this.receivedAny = receivedAny;
  }
}

// Calls /api/buff-like-stream and reads the SSE. receivedAny tells whether the worker has started processing:
// once an event has been received that group must NOT be re-run (avoids duplicate likes/comments).
export async function runBuffStream(
  payload: Record<string, unknown>,
  onProgress: (event: BuffStreamProgressEvent) => void,
  signal?: AbortSignal
): Promise<BuffRunResult> {
  let receivedAny = false;
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('viplike_token') : null;
    const response = await fetch(`${WORKER_BASE_URL}/api/buff-like-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok || !response.body) {
      let errText = `Worker stream error: ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson?.error) errText = errJson.error;
      } catch (_) {}
      throw new BuffStreamError(errText, false);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const eventType = chunk.match(/^event:\s*(\w+)/m)?.[1];
        const raw = chunk.match(/^data:\s*(.*)$/m)?.[1];
        if (!eventType || !raw) continue; // heartbeat
        let data: any;
        try {
          data = JSON.parse(raw);
        } catch {
          continue;
        }
        receivedAny = true;
        if (eventType === 'progress') {
          onProgress(data);
        } else if (eventType === 'cookie_expired') {
          triggerCookieExpiredAlert({
            uid: data?.uid,
            viaName: data?.viaName,
            reason: data?.message || data?.error,
            isCheckpoint: data?.isCheckpoint,
          });
        } else if (eventType === 'done') {
          return (data?.result || { total: 0, success: 0, failed: 0, details: [] }) as BuffRunResult;
        } else if (eventType === 'error') {
          if (data?.cookieDead || /hết hạn|checkpoint|đăng nhập|xác minh|expired|log ?in|verif/i.test(data?.error || '')) {
            triggerCookieExpiredAlert({
              uid: data?.uid,
              viaName: data?.viaName,
              reason: data?.error,
              isCheckpoint: data?.isCheckpoint || /checkpoint/i.test(data?.error || ''),
            });
          }
          throw new BuffStreamError(data?.error || 'Error while running the engagement buff', true);
        }
      }
    }
    throw new BuffStreamError('Connection to the worker dropped before completion', receivedAny);
  } catch (err: any) {
    if (err instanceof BuffStreamError) throw err;
    throw new BuffStreamError(err?.name === 'AbortError' ? 'Stopped' : err?.message || 'Stream connection error', receivedAny);
  }
}

// Group Pages by owning Via: each Page must run with the cookie of the Via that manages it
export function groupPagesByVia(pages: FanpageItem[], fallbackCookie: string, fallbackViaName: string): ViaGroup[] {
  const groups: ViaGroup[] = [];
  const byCookie = new Map<string, ViaGroup>();
  for (const page of pages) {
    const cookie = (page.viaCookie || fallbackCookie).trim();
    if (!byCookie.has(cookie)) {
      const group = { viaName: page.viaName || fallbackViaName, cookieString: cookie, pages: [] as FanpageItem[] };
      byCookie.set(cookie, group);
      groups.push(group);
    }
    byCookie.get(cookie)!.pages.push(page);
  }
  return groups;
}

export function summarizeBuffDetails(details: AutoBuffResultDetail[]) {
  return {
    success: details.filter((d) => d.status === 'SUCCESS').length,
    alreadyLiked: details.filter((d) => d.status === 'ALREADY_LIKED').length,
    unverified: details.filter((d) => d.status === 'UNVERIFIED').length,
    failed: details.filter((d) => d.status === 'ERROR' || d.status === 'NO_BUTTON').length,
    comments: details.filter((d) => d.commentStatus === 'SUCCESS').length,
  };
}

// Recount from details so old logs (missing SKIPPED/UNVERIFIED) still display correctly
export function getLogCounts(log: BuffLogEntry) {
  if (!log.details?.length) {
    return {
      total: log.totalPages || 0,
      success: log.successCount || 0,
      alreadyLiked: log.alreadyLikedCount || 0,
      unverified: 0,
      failed: log.failedCount || 0,
      skipped: 0,
      comments: log.commentCount || 0,
    };
  }
  const c = summarizeBuffDetails(log.details);
  const total = log.details.length;
  return { ...c, total, skipped: total - c.success - c.alreadyLiked - c.unverified - c.failed };
}

// Victory chime when a buff completes
export function playVictoryChime() {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.12 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.4);
    });
  } catch (e) {
    // Audio might be muted or blocked by browser policy
  }
}

export const readLegacyBuffLogs = (): BuffLogEntry[] => {
  try {
    const raw = localStorage.getItem(LEGACY_BUFF_LOGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Merge by id, preferring the `primary` copy, sorted newest first
export const mergeBuffLogs = (primary: BuffLogEntry[], secondary: BuffLogEntry[]): BuffLogEntry[] => {
  const seen = new Set(primary.map((l) => l.id));
  return [...primary, ...secondary.filter((l) => !seen.has(l.id))].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
};

export function resolveSpintax(text: string): string {
  const spintaxRegex = /\{([^{}]+)\}/g;
  let result = text;
  while (spintaxRegex.test(result)) {
    result = result.replace(spintaxRegex, (_, choices) => {
      const parts = choices.split('|');
      return parts[Math.floor(Math.random() * parts.length)].trim();
    });
  }
  return result;
}

export function isFacebookPostUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'facebook.com' ||
        url.hostname.endsWith('.facebook.com') ||
        url.hostname === 'fb.com' ||
        url.hostname.endsWith('.fb.com'))
    );
  } catch {
    return false;
  }
}

export function normalizeFbPostUrlClient(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.trim());
    if (/(^|\.)facebook\.com$/i.test(parsed.hostname) || /(^|\.)fb\.com$/i.test(parsed.hostname)) {
      parsed.hostname = 'www.facebook.com';
    }
    const trackingPrefixes = [
      'fbclid', 'mibextid', 'rdid', 'share_url', 'ref', 'ref_src', 'ref_url', 'paipv', 'eav', 'sfnsn', 'locale',
      '__cft__', '__tn__', 'notif_t', 'notif_id', 'comment_id', 'reply_comment_id', 'extid', 'idorvanity',
    ];
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (trackingPrefixes.some((p) => key === p || key.startsWith(p))) {
        parsed.searchParams.delete(key);
      }
    }
    let clean = parsed.origin + parsed.pathname.replace(/\/+$/, '');
    if (parsed.searchParams.toString()) {
      clean += '?' + parsed.searchParams.toString();
    }
    return clean;
  } catch {
    return rawUrl.trim().replace(/[?&](?:mibextid|fbclid|rdid|share_url)=[^&]*/g, '').replace(/\/+$/, '');
  }
}

export function extractCUser(cookieString?: string) {
  return cookieString?.match(/(?:^|;\s*)c_user=([^;]+)/i)?.[1]?.trim() || '';
}

export function extractPageId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^\d{8,}$/.test(trimmed)) {
    return trimmed;
  }
  const idMatch = trimmed.match(/[?&]id=(\d+)/);
  if (idMatch) return idMatch[1];
  const profileMatch = trimmed.match(/profile\.php\?id=(\d+)/);
  if (profileMatch) return profileMatch[1];
  const trailingDigits = trimmed.match(/\/(\d{8,})\/?$/);
  if (trailingDigits) return trailingDigits[1];
  return null;
}

export function isPersonalCookieAccount(account: any) {
  return account?.accountType === 'PERSONAL_COOKIE' || account?.accountType === 'PERSONAL_PROFILE_COOKIE';
}

export const formatDelaySeconds = (ms: number) => `${Number((ms / 1000).toFixed(1))}s`;

/** Speed label shared by the badge, description line and Summary panel */
export const getSpeedLabel = (speedMode: string, customSpeed: boolean, delayMs: number, hasComment = false) => {
  // With comments the minimum gap is 12s, so calling it "Very fast · 12s" would be misleading
  if (hasComment) return `${formatDelaySeconds(delayMs)} (with comments)`;
  const name = customSpeed ? 'Custom' : SPEED_PRESETS.find((p) => p.key === speedMode)?.name || 'Standard';
  return `${name} · ${formatDelaySeconds(delayMs)}`;
};

export function cleanPageName(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw
    .replace(/^(?:Chưa đọc|Unread)[\s\S]*?[·•]\s*/i, '')
    .replace(/(?:\r?\n|^)\s*\d+\s*(?:thông báo|tin nhắn|notifications?|messages?)[^\n]*/gi, '')
    .replace(/(?:\r?\n|^)\s*(?:Chuyển sang|Chuyển ngay|Switch into|Switch now|Quản lý|Manage|Xem trang)[^\n]*/gi, '')
    .replace(/^[·•\s-]+|[·•\s-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || raw.trim();
}

export const getInitials = (name: string): string => {
  if (!name) return 'FP';
  const clean = cleanPageName(name);
  const parts = clean.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const getAvatarGradient = (str: string): string => {
  const gradients = ['bg-slate-600', 'bg-blue-700'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return gradients[Math.abs(hash) % gradients.length];
};

export function getViaKey(account: any, customCookie?: string): string {
  if (!account || account === 'CUSTOM') {
    const c = extractCUser(customCookie);
    return c ? `cuser_${c}` : 'custom_manual';
  }
  const c = extractCUser(account?.cookieString || account?.accessToken);
  if (c) return `cuser_${c}`;
  return `acc_${account?.id || 'unknown'}`;
}

export function getStoredPagesForVia(viaKey: string): FanpageItem[] {
  try {
    const raw = localStorage.getItem(VIA_PAGES_STORAGE_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw);
    const pages = map[viaKey];
    if (!Array.isArray(pages)) return [];
    return pages.map((p) => ({
      ...p,
      name: cleanPageName(p.name),
    }));
  } catch {
    return [];
  }
}

export function saveStoredPagesForVia(viaKey: string, pages: FanpageItem[]) {
  try {
    const raw = localStorage.getItem(VIA_PAGES_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[viaKey] = pages;
    localStorage.setItem(VIA_PAGES_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('Error saving via pages to localStorage:', e);
  }
}

/** A Via whose cookie can't be used right now (expired or checkpointed): its Pages are skipped when picking Pages */
export function isDeadViaStatus(status?: string | null): boolean {
  return status === 'EXPIRED' || status === 'CHECKPOINT';
}
