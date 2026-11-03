import React, { useEffect, useMemo, useState, useRef, useCallback, lazy, Suspense, memo, type ReactNode } from 'react';
import {
  Card,
  Input,
  Button,
  Select,
  Tag,
  App,
  Row,
  Col,
  Checkbox,
  Progress,
  Tabs,
  Modal,
  InputNumber,
  Segmented,
  Switch,
  Dropdown,
  Spin,
  Table,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  EyeOutlined,
  MoreOutlined,
  ThunderboltFilled,
  ReloadOutlined,
  PlayCircleOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CloseCircleFilled,
  ExportOutlined,
  RobotOutlined,
  UserOutlined,
  SearchOutlined,
  CheckOutlined,
  PauseOutlined,
  StopOutlined,
  PlusOutlined,
  DeleteOutlined,
  IdcardOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  PauseCircleOutlined,
  CaretRightOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
  CopyOutlined,
  CommentOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  BellOutlined,
  RocketFilled,
  ShareAltOutlined,
  ExclamationCircleOutlined,
  CodeOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import api, { WORKER_BASE_URL } from '../config/axios';
import PasteLinkInput from '../components/common/PasteLinkInput';
import { triggerCookieExpiredAlert, useCookieAlert } from '../components/common/CookieAlertManager';
import { TableSkeleton, PageSkeleton, CardSkeleton } from '../components/common/SaaSLoadingSkeleton';

export const formatDuration = (totalSec: number): string => {
  const sec = Math.max(0, Math.round(totalSec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}p ${sec % 60}s`;
  return `${Math.floor(m / 60)}g ${m % 60}p`;
};

// Tách nhỏ bundle (Code-splitting) với React.lazy cho các phân hệ quản trị lớn
const PostHunterTab = lazy(() => import('../components/buff/PostHunterTab'));
const BuffQueueTab = lazy(() => import('../components/buff/BuffQueueTab'));
const ViaManagementPage = lazy(() => import('./ViaManagementPage'));
const SystemSettingsPage = lazy(() => import('./SystemSettingsPage'));
const LicenseManagementPage = lazy(() => import('./LicenseManagementPage'));

interface FanpageItem {
  id: string;
  name: string;
  url: string;
  avatarUrl?: string;
  viaAccountId?: number | 'CUSTOM';
  viaName?: string;
  viaCookie?: string;
  viaStatus?: 'OK' | 'EXPIRED' | string;
  isProfile?: boolean;
}

interface AutoBuffResultDetail {
  pageId: string;
  pageName: string;
  viaName?: string;
  status: 'WAITING' | 'RUNNING' | 'SUCCESS' | 'ALREADY_LIKED' | 'UNVERIFIED' | 'NO_BUTTON' | 'ERROR' | 'FAILED' | 'SKIPPED';
  likeStatus?: 'WAITING' | 'RUNNING' | 'SUCCESS' | 'ALREADY_LIKED' | 'UNVERIFIED' | 'NO_BUTTON' | 'ERROR' | 'FAILED' | 'SKIPPED';
  commentStatus?: 'WAITING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'ERROR';
  shareStatus?: 'WAITING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'ERROR';
  commentText?: string;
  message?: string;
  error?: string;
}

interface AutoBuffProgress {
  total: number;
  success: number;
  failed: number;
  alreadyLiked: number;
  percent: number;
  currentRunningPageName?: string;
  status: 'IDLE' | 'RUNNING' | 'DONE' | 'ERROR' | 'STOPPED';
  details: AutoBuffResultDetail[];
  logs?: string[];
  autoRefilled?: number;
  kpiReached?: boolean;
  isStopped?: boolean;
  error?: string;
}

interface BuffStreamProgressEvent {
  type: 'PAGE_START' | 'PAGE_FINISH' | 'COOLDOWN_START' | 'COOLDOWN_END' | 'KPI_REACHED' | 'COOKIE_EXPIRED';
  index?: number;
  total?: number;
  pageId?: string;
  pageName?: string;
  percent?: number;
  status?: AutoBuffResultDetail['status'];
  likeStatus?: AutoBuffResultDetail['likeStatus'];
  commentStatus?: AutoBuffResultDetail['commentStatus'];
  commentText?: string;
  message?: string;
  error?: string;
  durationSec?: number;
  kpiTarget?: number;
  success?: number;
  autoRefilled?: number;
  uid?: string;
}

interface BuffRunResult {
  total: number;
  success: number;
  failed: number;
  unverified?: number;
  stopped?: boolean;
  details: AutoBuffResultDetail[];
}

class BuffStreamError extends Error {
  receivedAny: boolean;
  constructor(message: string, receivedAny: boolean) {
    super(message);
    this.receivedAny = receivedAny;
  }
}

// Gọi /api/buff-like-stream và đọc SSE. receivedAny cho biết worker đã bắt đầu xử lý hay chưa:
// nếu đã nhận event thì KHÔNG được chạy lại nhóm đó (tránh like/comment lặp).
async function runBuffStream(
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
          if (data?.cookieDead || /hết hạn|checkpoint|đăng nhập|xác minh/i.test(data?.error || '')) {
            triggerCookieExpiredAlert({
              uid: data?.uid,
              viaName: data?.viaName,
              reason: data?.error,
              isCheckpoint: data?.isCheckpoint || /checkpoint/i.test(data?.error || ''),
            });
          }
          throw new BuffStreamError(data?.error || 'Lỗi khi thực hiện buff tương tác', true);
        }
      }
    }
    throw new BuffStreamError('Kết nối tới worker bị ngắt trước khi hoàn tất', receivedAny);
  } catch (err: any) {
    if (err instanceof BuffStreamError) throw err;
    throw new BuffStreamError(err?.name === 'AbortError' ? 'Đã dừng' : err?.message || 'Lỗi kết nối stream', receivedAny);
  }
}

interface ViaGroup {
  viaName: string;
  cookieString: string;
  pages: FanpageItem[];
}

// Nhóm Page theo Via sở hữu: mỗi Page phải chạy bằng đúng cookie của Via quản lý nó
function groupPagesByVia(pages: FanpageItem[], fallbackCookie: string, fallbackViaName: string): ViaGroup[] {
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

function summarizeBuffDetails(details: AutoBuffResultDetail[]) {
  return {
    success: details.filter((d) => d.status === 'SUCCESS').length,
    alreadyLiked: details.filter((d) => d.status === 'ALREADY_LIKED').length,
    unverified: details.filter((d) => d.status === 'UNVERIFIED').length,
    failed: details.filter((d) => d.status === 'ERROR' || d.status === 'NO_BUTTON').length,
    comments: details.filter((d) => d.commentStatus === 'SUCCESS').length,
  };
}

// Đếm lại từ details để log cũ (lưu thiếu SKIPPED/UNVERIFIED) vẫn hiển thị đúng
function getLogCounts(log: BuffLogEntry) {
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

// Âm thanh chuông báo chiến thắng khi buff hoàn tất
function playVictoryChime() {
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

export interface BuffMonitor {
  id: string;
  targetName: string;
  targetUrl: string;
  targetType: 'PAGE' | 'GROUP' | 'PROFILE';
  checkIntervalMinutes: number;
  buffConfig: {
    targetLikes: number | 'ALL';
    reactionType: string;
    enableLike: boolean;
    enableComment: boolean;
    comments: string[];
    delayMinutes: number;
    viaMode: string;
    cookieString?: string;
  };
  status: 'ACTIVE' | 'PAUSED';
  totalDetected: number;
  lastCheckedAt: string | null;
  lastFoundPostUrl: string | null;
  baselineDone?: boolean;
  lastPostsFound?: number;
  lastScanVia?: string | null;
  createdAt: string;
}

export interface BatchOrder {
  id: number;
  url: string;
  orderNumber: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'PAUSED' | 'FAILED';
  successLikes: number;
  totalLikesTarget: number;
  percent?: number;
  currentRunningPageName?: string;
  error?: string;
  details?: AutoBuffResultDetail[];
}

export interface BuffLogEntry {
  id: string;
  createdAt: string;
  type: 'SINGLE' | 'BATCH' | 'QUEUE';
  targetUrl: string;
  reactionType: string;
  totalPages: number;
  successCount: number;
  alreadyLikedCount: number;
  failedCount: number;
  engagementMode?: 'LIKE_ONLY' | 'COMMENT_ONLY' | 'LIKE_AND_COMMENT';
  commentCount?: number;
  accountName?: string;
  details: AutoBuffResultDetail[];
}

// Lịch sử nay lưu trên MySQL (API /buff-logs); key cũ chỉ còn dùng để chuyển dữ liệu lên một lần
const LEGACY_BUFF_LOGS_STORAGE_KEY = 'toolzutter:buff-engagement-logs';

const readLegacyBuffLogs = (): BuffLogEntry[] => {
  try {
    const raw = localStorage.getItem(LEGACY_BUFF_LOGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Gộp theo id, ưu tiên bản trong `primary`, sắp xếp mới nhất trước
const mergeBuffLogs = (primary: BuffLogEntry[], secondary: BuffLogEntry[]): BuffLogEntry[] => {
  const seen = new Set(primary.map((l) => l.id));
  return [...primary, ...secondary.filter((l) => !seen.has(l.id))].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
};

export const SEEDING_NICHE_PRESETS: Record<string, { label: string; icon: string; templates: string[] }> = {
  GENERAL: {
    label: 'Tương Tác Xã Hội & Đẩy Reach',
    icon: '',
    templates: [
'{Bài viết chia sẻ rất hay|Nội dung chất lượng quá|Bổ ích ghê} {ad ơi|ạ|nha bạn} {👏|🌟|❤️}',
'{Đã lưu lại khi cần|Thả tim cho bài viết tuyệt vời này|Theo dõi page lâu rồi vẫn thích} {ạ|nhé|nè} {🥰|✨|🍀}',
'{Chuẩn luôn|Rất đồng quan điểm với bài viết|Chia sẻ chính xác quá} {ạ|nha|bạn ơi} {💯|👌|🔥}',
'{Chúc trang ngày càng phát triển|Luôn ủng hộ các bài viết của bạn|Tiếp tục phát huy nhé} {nha|ạ|nhé ad} {🚀|🎉|💖}',
'{Quá tuyệt vời luôn|Rất đáng để học hỏi|Thích cách trình bày này ghê} {ạ|nè bạn|ơi} {🍀|✨|👍}',
    ],
  },
  FASHION: {
    label: 'Thời Trang & Làm Đẹp',
    icon: '',
    templates: [
'{Shop ơi|Ad ơi} {check ib em|tư vấn em với} {size M|màu đen|mẫu này} {ạ|nha shop|với ạ} {❤️|✨|🛍️}',
'{Vải mặc mát không shop|Chất này có co giãn không ạ|Form áo chuẩn không ad} {ơi|nha|nhé} {🥰|🌟}',
'{Mới nhận hàng hôm qua|Vừa nhận được áo|Đồ đẹp lắm shop ơi} {ưng cái bụng ghê|chất vải mê ly|sẽ ủng hộ tiếp} {ạ|nha|💯} {👏|💖}',
'{Mẫu này nữ cao 1m6 mặc vừa không shop|Cho mình hỏi còn size L không|Ship về Hà Nội/HCM mất mấy ngày} {ạ|vậy ad} {✨|🍀}',
'{Đẹp quá|Nhìn mê chữ ê kéo dài luôn|Xinh xỉu luôn shop ơi} {nè|quá chừng|ạ} {😍|🔥|👌}',
    ],
  },
  FNB: {
    label: 'Ẩm Thực & Quán Xá',
    icon: '',
    templates: [
'{Quán mở cửa tới mấy giờ|Menu này giá bao nhiêu|Có cần đặt bàn trước không} {vậy shop|ạ|ạ ad} {🍲|😋|✨}',
'{Nhìn hấp dẫn quá|Thèm rớt nước miếng|Món này cay nhiều không} {bạn ơi|ạ|ad ơi} {🤤|❤️|👌}',
'{Hôm trước vừa ghé ăn|Cuối tuần này phải rủ bạn ghé mới được|Đồ ăn ở đây ngon đỉnh} {nha mọi người|ạ|nè} {🌟|👍|🎉}',
'{Địa chỉ ở đâu vậy bạn|Có ship qua Now/Grab/ShopeeFood không|Quán ở quận mấy} {ạ|ơi|nhé} {🛵|🍽️}',
'{Lưu lại ngay|Cuối tuần set kèo đi thử|Trông chất lượng quá} {bạn ơi|ạ|nhé cả nhà} {👏|💯|🔥}',
    ],
  },
  SERVICES: {
    label: 'Dịch Vụ & BĐS & Khóa Học',
    icon: '',
    templates: [
'{Cho mình xin thông tin chi tiết|Dự án này pháp lý thế nào|Học phí khóa này bao nhiêu} {ạ|vậy ad|ơi shop} {🏢|📋|💡}',
'{Đã inbox ad tư vấn giúp em|Quan tâm dịch vụ bên mình|Ad check tin nhắn chờ giúp} {nhé|ạ|nha} {📩|🤝|✨}',
'{Dịch vụ uy tín chuyên nghiệp|Đã từng trải nghiệm rất hài lòng|Ủng hộ team} {nha|ạ|nhe} {🌟|👏|💯}',
'{Chính sách ưu đãi tháng này thế nào ad|Cho mình hỏi thời gian học/triển khai} {với ạ|nhé|nha} {📊|👍}',
'{Nội dung chia sẻ rất thực tế|Kiến thức bổ ích quá|Cảm ơn team nhiều} {ạ|nha|nhé} {🔥|❤️|🍀}',
    ],
  },
  TECH: {
    label: 'Công Nghệ & Thiết Bị',
    icon: '',
    templates: [
'{Mẫu này còn hàng không shop|Bản này có bảo hành chính hãng không|Có hỗ trợ ship COD không} {ạ|ad ơi|nhé} {📱|⚡|🔥}',
'{Máy dùng mượt mà|Pin trâu thật sự|Shop đóng gói rất kỹ} {nha cả nhà|ạ|luôn} {👍|✨|🔋}',
'{Giá bao gồm VAT chưa shop|Có hỗ trợ trả góp 0% không|Tặng kèm những phụ kiện gì} {ạ|vậy shop} {💳|📦}',
'{Bền đẹp|Dùng 6 tháng rồi vẫn ngon lành|Đáng đồng tiền bát gạo} {nha|luôn bạn ơi|ạ} {💯|🌟}',
    ],
  },
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

const ENGAGEMENT_STORAGE_KEY = 'toolzutter:assisted-page-engagement';

function isFacebookPostUrl(rawUrl: string) {
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

function extractCUser(cookieString?: string) {
  return cookieString?.match(/(?:^|;\s*)c_user=([^;]+)/i)?.[1]?.trim() || '';
}

function extractPageId(input: string): string | null {
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

function isPersonalCookieAccount(account: any) {
  return account?.accountType === 'PERSONAL_COOKIE' || account?.accountType === 'PERSONAL_PROFILE_COOKIE';
}

interface ReactionOption {
  key: string;
  label: string;
  shortLabel: string;
  emoji: string;
  color: string;
  isRandom: boolean;
  desc?: string;
}

const REACTIONS: ReactionOption[] = [
  { key: 'LIKE', label: 'Thích (Like)', shortLabel: 'Thích', emoji: '👍', color: '#1877f2', isRandom: false },
  { key: 'LOVE', label: 'Yêu thích (Love)', shortLabel: 'Thả Tim', emoji: '❤️', color: '#f33e58', isRandom: false },
  { key: 'CARE', label: 'Thương thương (Care)', shortLabel: 'Thương', emoji: '🥰', color: '#f7b125', isRandom: false },
  { key: 'HAHA', label: 'Haha (Cười vui)', shortLabel: 'Haha', emoji: '😆', color: '#f7b125', isRandom: false },
  { key: 'WOW', label: 'Wow (Bất ngờ)', shortLabel: 'Wow', emoji: '😮', color: '#f7b125', isRandom: false },
  { key: 'SAD', label: 'Buồn (Sad)', shortLabel: 'Buồn', emoji: '😢', color: '#f7b125', isRandom: false },
  { key: 'ANGRY', label: 'Phẫn nộ (Angry)', shortLabel: 'Phẫn nộ', emoji: '😡', color: '#e9710f', isRandom: false },
  {
    key: 'RANDOM_POSITIVE',
    label: 'Trộn Cảm Xúc Tự Nhiên (Like • Tim • Thương)',
    shortLabel: 'Trộn Tự Nhiên (Like/Tim)',
    emoji: '🎲',
    color: '#ec4899',
    isRandom: true,
    desc: '65% Thích + 25% Thả Tim + 10% Thương Thương (Khuyên dùng cho bài bán hàng)',
  },
  {
    key: 'RANDOM_ALL',
    label: 'Trộn Đa Dạng (Tất cả cảm xúc Facebook)',
    shortLabel: 'Trộn Đa Dạng',
    emoji: '🌈',
    color: '#8b5cf6',
    isRandom: true,
    desc: 'Bao gồm cả Haha & Wow xen kẽ cho bài viết viral, giải trí',
  },
];

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

const getInitials = (name: string): string => {
  if (!name) return 'FP';
  const clean = cleanPageName(name);
  const parts = clean.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const getAvatarGradient = (str: string): string => {
  const gradients = ['bg-slate-600', 'bg-blue-700'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return gradients[Math.abs(hash) % gradients.length];
};

interface PageCardItemProps {
  page: FanpageItem;
  isChecked: boolean;
  isAlreadyLiked: boolean;
  cleanName: string;
  avatarUrl: string;
  actorMode: 'VIAS' | 'FANPAGES';
  selectedAccountId: string | number;
  onToggle: (pageId: string) => void;
}

const PageCardItem = memo<PageCardItemProps>(({
  page,
  isChecked,
  isAlreadyLiked,
  cleanName,
  avatarUrl,
  actorMode,
  selectedAccountId,
  onToggle,
}) => {
  return (
    <div
      onClick={() => onToggle(page.id)}
      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all active:scale-[0.99] ${
        isChecked
          ? 'border-blue-500/80 bg-blue-950/40 text-white shadow-sm shadow-blue-500/10'
          : 'border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700 hover:bg-slate-900/60'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative w-7 h-7 shrink-0 rounded-lg overflow-hidden bg-slate-800 border border-slate-700/60 shadow-sm flex items-center justify-center">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={cleanName}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
                const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                if (fallback) fallback.classList.remove('hidden');
              }}
            />
          ) : null}
          <div
            className={`w-full h-full text-on-accent font-semibold text-[10px] items-center justify-center ${
              actorMode === 'VIAS' ? 'bg-emerald-600' : getAvatarGradient(cleanName)
            } ${avatarUrl ? 'hidden' : 'flex'}`}
          >
            {getInitials(cleanName)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="font-bold text-xs truncate max-w-[125px] sm:max-w-[135px]" title={cleanName}>
            {cleanName}
          </div>
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400 truncate">
            <span>ID: {page.id}</span>
            {isAlreadyLiked && (
              <Tag color="orange" className="text-[9px] m-0 border-0 px-1 py-0 leading-tight">
                Đã like
              </Tag>
            )}
            {actorMode === 'VIAS' ? (
              <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 font-sans font-medium">
                Via
              </span>
            ) : (
              page.viaName && selectedAccountId === 'ALL_VIAS' && (
                <span className="text-[9px] px-1 py-0.2 rounded bg-blue-950/80 text-blue-300 border border-blue-800/80 font-sans font-medium">
                  {page.viaName}
                </span>
              )
            )}
            {page.viaStatus === 'EXPIRED' ? (
              <span className="text-[9px] px-1 py-0.2 rounded bg-rose-950/90 text-rose-300 border border-rose-800/80 font-sans font-medium">
                🔴 Hết cookie
              </span>
            ) : page.viaStatus === 'OK' && selectedAccountId === 'ALL_VIAS' ? (
              <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 font-sans font-medium">
                🟢 Live
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <Checkbox
        checked={isChecked}
        onChange={(e) => {
          e.stopPropagation();
          onToggle(page.id);
        }}
      />
    </div>
  );
});

const VIA_PAGES_STORAGE_KEY = 'toolzutter:via_fanpages_map_v3';

function getViaKey(account: any, customCookie?: string): string {
  if (!account || account === 'CUSTOM') {
    const c = extractCUser(customCookie);
    return c ? `cuser_${c}` : 'custom_manual';
  }
  const c = extractCUser(account?.cookieString || account?.accessToken);
  if (c) return `cuser_${c}`;
  return `acc_${account?.id || 'unknown'}`;
}

function getStoredPagesForVia(viaKey: string): FanpageItem[] {
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

function saveStoredPagesForVia(viaKey: string, pages: FanpageItem[]) {
  try {
    const raw = localStorage.getItem(VIA_PAGES_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[viaKey] = pages;
    localStorage.setItem(VIA_PAGES_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.error('Error saving via pages to localStorage:', e);
  }
}

export interface BuffEngagementProps {
  activeTabKey?: string;
  onTabChange?: (key: string) => void;
  onOpenViaManager?: () => void;
  onOpenSettings?: () => void;
  isExternalSettingsOpen?: boolean;
  onCloseExternalSettings?: () => void;
  dbStatus?: any;
  onCheckDb?: () => void;
  onStatsUpdate?: (stats: {
    queueCount: number;
    historyCount: number;
    monitorsCount: number;
    accountsCount: number;
  }) => void;
}

export default function BuffEngagement(props: BuffEngagementProps = {}) {
  const [searchParams] = useSearchParams();
  const { message, modal, notification } = App.useApp();
  const { openModal: openCookieAlertModal } = useCookieAlert();

  const [internalActiveTabKey, setInternalActiveTabKey] = useState<string>('buff-like');
  const activeTabKey = props.activeTabKey !== undefined ? props.activeTabKey : internalActiveTabKey;
  const setActiveTabKey = (k: string) => {
    setInternalActiveTabKey(k);
    props.onTabChange?.(k);
  };

  // Shared State
  const [selectedAccountId, setSelectedAccountId] = useState<number | 'CUSTOM' | 'ALL_VIAS'>('ALL_VIAS');
  const [customCookie, setCustomCookie] = useState('');
  const [targetPostUrl, setTargetPostUrl] = useState('');
  const [selectedReaction, setSelectedReaction] = useState('LIKE');
  const [scannedPages, setScannedPages] = useState<FanpageItem[]>([]);
  const [actorMode, setActorMode] = useState<'VIAS' | 'FANPAGES'>('VIAS');
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const handleTogglePageId = useCallback((pageId: string) => {
    setSelectedPageIds((prev) =>
      prev.includes(pageId) ? prev.filter((id) => id !== pageId) : [...prev, pageId]
    );
  }, []);
  const [pageSearchQuery, setPageSearchQuery] = useState('');
  const [viaFilter, setViaFilter] = useState<string>('ALL');
  const [speedMode, setSpeedMode] = useState<'SMART' | 'TURBO' | 'FAST' | 'NORMAL' | 'SAFE'>('FAST');
  const [delayMs, setDelayMs] = useState<number>(2200);
  const [enableHumanBehavior, setEnableHumanBehavior] = useState<boolean>(true);
  const [fastSwitch, setFastSwitch] = useState<boolean>(true);
  const [antiCheckpointGuard, setAntiCheckpointGuard] = useState<boolean>(true);
  const [isAiGeneratingComments, setIsAiGeneratingComments] = useState<boolean>(false);
  const [concurrency, setConcurrency] = useState<number>(2);
  const [dripFeedMode, setDripFeedMode] = useState<boolean>(false);
  const [dripDurationMinutes, setDripDurationMinutes] = useState<number>(30);
  const [autoFailoverLiveVia, setAutoFailoverLiveVia] = useState<boolean>(true);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);
  const [aiPostPrompt, setAiPostPrompt] = useState<string>('');
  const [aiTone, setAiTone] = useState<string>('customer_inquiry');
  const [aiCount, setAiCount] = useState<number>(10);
  const [avatarCacheMap, setAvatarCacheMap] = useState<Record<string, { pageId: string; name?: string; avatarUrl?: string; hasAvatar?: boolean }>>({});

  // Tải trạng thái và URL Avatar của các Fanpage
  useEffect(() => {
    api
      .get('/avatars/cached-status')
      .then((res) => {
        if (res.data?.results) {
          setAvatarCacheMap(res.data.results);
        }
      })
      .catch(() => {});
  }, []);

  // Nhận link bài viết tự động truyền từ Job Kinh Tế
  useEffect(() => {
    const urlParam = searchParams.get('url') || searchParams.get('targetUrl');
    if (urlParam) {
      setTargetPostUrl(urlParam);
      message.info(`Đã nạp link bài viết từ Job Kinh Tế: ${urlParam}`);
    }
  }, [searchParams]);

  // Auto Buff State (Playwright Bot)
  const [autoBuffProgress, setAutoBuffProgress] = useState<AutoBuffProgress>({
    total: 0,
    success: 0,
    failed: 0,
    alreadyLiked: 0,
    percent: 0,
    status: 'IDLE',
    details: [],
  });

  // Thông tin bài viết và cấu hình đang chạy trực tiếp (giúp giải phóng form Tạo mới để nhập link khác)
  const [runningTargetInfo, setRunningTargetInfo] = useState<{
    url: string;
    reaction: string;
    count: number;
    startedAt: number;
    actorMode?: 'VIAS' | 'FANPAGES';
    speedMode?: string;
  } | null>(null);
  const [runningFilter, setRunningFilter] = useState<'ALL' | 'SUCCESS' | 'ALREADY_LIKED' | 'FAILED' | 'RUNNING' | 'WAITING'>('ALL');
  const [runningSearch, setRunningSearch] = useState<string>('');
  const initialFinishedRestoreDoneRef = useRef(false);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [showLiveTerminal, setShowLiveTerminal] = useState<boolean>(true);

  const addLiveLog = useCallback((logMsg: string) => {
    const time = new Date().toLocaleTimeString('vi-VN');
    const entry = `[${time}] ${logMsg}`;
    setLiveLogs((prev) => {
      const updated = [...prev, entry];
      return updated.length > 200 ? updated.slice(updated.length - 200) : updated;
    });
  }, []);

  // Đồng hồ cho lượt chạy trực tiếp: thời điểm bắt đầu/kết thúc và nhịp cập nhật mỗi giây
  const [runTiming, setRunTiming] = useState<{ start: number | null; end: number | null }>({ start: null, end: null });
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    const status = autoBuffProgress.status;
    const isWaitingOrRunning = autoBuffProgress.details.some((d) => d.status === 'WAITING' || d.status === 'RUNNING');
    if (status === 'RUNNING' && (autoBuffProgress.details.length === 0 || isWaitingOrRunning)) {
      setRunTiming((t) => (t.start && !t.end ? t : { start: Date.now(), end: null }));
    } else if (
      status === 'DONE' ||
      status === 'ERROR' ||
      status === 'STOPPED' ||
      (autoBuffProgress.details.length > 0 && !isWaitingOrRunning)
    ) {
      setRunTiming((t) => (t.start && !t.end ? { ...t, end: Date.now() } : t));
    }
  }, [autoBuffProgress.status, autoBuffProgress.details]);

  useEffect(() => {
    const isWaitingOrRunning = autoBuffProgress.details.some((d) => d.status === 'WAITING' || d.status === 'RUNNING');
    if (autoBuffProgress.status !== 'RUNNING' || (autoBuffProgress.details.length > 0 && !isWaitingOrRunning)) return;
    const id = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [autoBuffProgress.status, autoBuffProgress.details]);

  // Khôi phục phiên Buff trực tiếp hoặc tác vụ Hàng đợi đang chạy ngầm nếu người dùng F5 hoặc mở trang
  useEffect(() => {
    let pollTimer: any = null;
    let idleCheckTimer: any = null;

    const restoreActiveSession = async () => {
      try {
        if (buffAbortRef.current) return;
        const res = await axios.get(`${WORKER_BASE_URL}/api/buff-live/active`);
        const session = res.data?.activeSession;
        if (!session) return;

        if (session.status === 'RUNNING') {
          if (session.targetUrl && !targetPostUrl) setTargetPostUrl(session.targetUrl);
          if (session.reactionType) setSelectedReaction(session.reactionType);
          if (session.startedAt) setRunTiming({ start: new Date(session.startedAt).getTime(), end: null });
          if (Array.isArray(session.logs) && session.logs.length > 0) setLiveLogs(session.logs);
          setRunningTargetInfo({
            url: session.targetUrl,
            reaction: session.reactionType || 'LIKE',
            count: session.total || 50,
            startedAt: session.startedAt ? new Date(session.startedAt).getTime() : Date.now(),
          });

          setAutoBuffProgress({
            total: session.total || 0,
            success: session.success || 0,
            failed: session.failed || 0,
            alreadyLiked: session.alreadyLiked || 0,
            percent: session.percent || 0,
            status: 'RUNNING',
            currentRunningPageName: session.currentRunningPageName || 'Đang thực thi...',
            details: session.details || [],
            logs: session.logs || [],
            autoRefilled: session.autoRefilled,
            kpiReached: session.kpiReached,
          });

          if (!pollTimer) {
            pollTimer = setInterval(async () => {
              try {
                if (buffAbortRef.current) return;
                const pollRes = await axios.get(`${WORKER_BASE_URL}/api/buff-live/active`);
                const live = pollRes.data?.activeSession;
                if (!live) {
                  clearInterval(pollTimer);
                  pollTimer = null;
                  return;
                }

                if (live.targetUrl) {
                  setRunningTargetInfo((prev) => prev || {
                    url: live.targetUrl,
                    reaction: live.reactionType || 'LIKE',
                    count: live.total || 50,
                    startedAt: live.startedAt ? new Date(live.startedAt).getTime() : Date.now(),
                  });
                }

                if (Array.isArray(live.logs) && live.logs.length > 0) {
                  setLiveLogs(live.logs);
                }

                setAutoBuffProgress({
                  total: live.total || 0,
                  success: live.success || 0,
                  failed: live.failed || 0,
                  alreadyLiked: live.alreadyLiked || 0,
                  percent: live.percent || 0,
                  status: live.status,
                  currentRunningPageName: live.currentRunningPageName || '',
                  details: live.details || [],
                  logs: live.logs || [],
                  autoRefilled: live.autoRefilled,
                  kpiReached: live.kpiReached,
                });

                if (live.status !== 'RUNNING') {
                  clearInterval(pollTimer);
                  pollTimer = null;
                  if (live.status === 'DONE') {
                    message.success({
                      content: `🎉 Tác vụ buff ngầm đã hoàn tất: ${live.success}/${live.total} thành công!`,
                      key: 'restore-buff-session',
                      duration: 5,
                    });
                  } else if (live.status === 'STOPPED') {
                    message.warning({
                      content: 'Đã dừng tác vụ buff ngầm theo yêu cầu.',
                      key: 'restore-buff-session',
                    });
                  }
                }
              } catch (err) {
                console.error('Lỗi kiểm tra tiến trình:', err);
              }
            }, 1200);
          }
        } else if (
          !initialFinishedRestoreDoneRef.current &&
          (session.status === 'DONE' || session.status === 'FAILED' || session.status === 'STOPPED') &&
          Date.now() - new Date(session.updatedAt || session.startedAt).getTime() < 4 * 60 * 60 * 1000
        ) {
          initialFinishedRestoreDoneRef.current = true;
          if (buffAbortRef.current) return;
          if (session.targetUrl && !targetPostUrl) setTargetPostUrl(session.targetUrl);
          if (session.reactionType) setSelectedReaction(session.reactionType);
          if (session.startedAt) {
            setRunTiming({
              start: new Date(session.startedAt).getTime(),
              end: session.updatedAt ? new Date(session.updatedAt).getTime() : Date.now(),
            });
          }
          if (Array.isArray(session.logs) && session.logs.length > 0) setLiveLogs(session.logs);
          setRunningTargetInfo({
            url: session.targetUrl,
            reaction: session.reactionType || 'LIKE',
            count: session.total || 50,
            startedAt: session.startedAt ? new Date(session.startedAt).getTime() : Date.now(),
          });
          setAutoBuffProgress({
            total: session.total || 0,
            success: session.success || 0,
            failed: session.failed || 0,
            alreadyLiked: session.alreadyLiked || 0,
            percent: session.percent || Math.min(100, Math.round(((session.success || 0) / Math.max(1, session.total || 1)) * 100)),
            status: session.status === 'FAILED' ? 'ERROR' : 'DONE',
            details: session.details || [],
          });
        }
      } catch (e) {
        // bỏ qua nếu backend không phản hồi
      }
    };

    restoreActiveSession();
    // Tự động kiểm tra mỗi 2.5 giây khi không có pollTimer để bắt kịp bất kỳ tác vụ Hàng đợi / Săn bài / Tiếp tục chạy
    idleCheckTimer = setInterval(() => {
      if (!pollTimer) {
        restoreActiveSession();
      }
    }, 2500);

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (idleCheckTimer) clearInterval(idleCheckTimer);
    };
  }, []);

  // Tab 3: Buff View State
  const [targetViewUrl, setTargetViewUrl] = useState('');
  const [targetViews, setTargetViews] = useState(20);
  const [viewConcurrency, setViewConcurrency] = useState(2);
  const [watchTimeSeconds, setWatchTimeSeconds] = useState(8);
  const [viewProgress, setViewProgress] = useState<{ total: number; done: number; status: 'IDLE' | 'RUNNING' | 'DONE' }>({
    total: 0,
    done: 0,
    status: 'IDLE',
  });

  // Chế độ Buff: 1 Link đơn lẻ hoặc Nhiều bài viết hàng loạt
  const [buffMode, setBuffMode] = useState<'SINGLE' | 'BATCH'>('SINGLE');

  // Chế độ tương tác: Thả Cảm xúc, Viết Bình luận, hoặc Cả Hai
  const [engagementMode, setEngagementMode] = useState<'LIKE_AND_COMMENT' | 'LIKE_ONLY' | 'COMMENT_ONLY'>('LIKE_AND_COMMENT');
  const [commentListText, setCommentListText] = useState<string>(
    [
'Bài viết hay và rất ý nghĩa ạ! 👍',
'Thông tin rất bổ ích, cảm ơn bạn đã chia sẻ ❤️',
'Quan tâm dịch vụ, xin thêm tư vấn với shop ơi! ✨',
'Đã lưu lại khi cần, tuyệt vời quá ạ 🌟',
'Uy tín và chất lượng luôn bạn ơi! 🚀',
'Ủng hộ nhiệt tình, chúc trang ngày càng phát triển nhé! 👏',
'Quá hay, chấm hóng các bài viết tiếp theo ạ! 🍀',
    ].join('\n')
  );

  // Buff Share: Tự động chia sẻ bài viết lên tường Fanpage
  const [enableShare, setEnableShare] = useState<boolean>(false);
  const [seedingPresets, setSeedingPresets] = useState<{ id: string; name: string; badge?: string; comments: string[] }[]>([]);

  useEffect(() => {
    api.get('/buff-seeding-presets')
      .then((res) => {
        if (res.data?.success && Array.isArray(res.data.presets)) {
          setSeedingPresets(res.data.presets);
        }
      })
      .catch(() => {});
  }, []);

  // Danh sách ID các Fanpage đã từng like link bài viết này trong hệ thống backend
  const [interactedPageIds, setInteractedPageIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!targetPostUrl || !targetPostUrl.includes('facebook.com')) {
      setInteractedPageIds(new Set());
      return;
    }
    const timer = setTimeout(() => {
      api.get('/api/buff-post-interacted-pages', { params: { url: targetPostUrl.trim() } })
        .then((res) => {
          if (res.data?.success && Array.isArray(res.data.interactedPageIds)) {
            setInteractedPageIds(new Set(res.data.interactedPageIds));
          }
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [targetPostUrl]);

  // Auto-Buff Queue State (Hunter-Ready & Background Pipeline)
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [queueUrlInput, setQueueUrlInput] = useState<string>('');
  const [queueTargetLikes, setQueueTargetLikes] = useState<number>(30);
  const [queueDelayMinutes, setQueueDelayMinutes] = useState<number>(3);
  const [queueReaction, setQueueReaction] = useState<string>('RANDOM_POSITIVE');
  const [queueLoading, setQueueLoading] = useState<boolean>(false);

  const fetchBuffQueue = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-queue/list`);
      if (res.data?.success) {
        setQueueItems(res.data.queue || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchBuffQueue();
    const hasRunning = queueItems.some((i) => i.status === 'RUNNING');
    const interval = setInterval(fetchBuffQueue, hasRunning ? 3000 : 8000);
    return () => clearInterval(interval);
  }, [fetchBuffQueue, queueItems]);

  // Tab Tạo mới: chạy ngay hoặc đưa vào hàng đợi
  const [runMode, setRunMode] = useState<'NOW' | 'QUEUE'>('NOW');
  const [queueStartAfter, setQueueStartAfter] = useState<number | 'AT'>(0);
  const [queueStartAt, setQueueStartAt] = useState<string>('');
  const [queueStagger, setQueueStagger] = useState<number>(3);
  const [isEnqueueing, setIsEnqueueing] = useState(false);

  const handleEnqueueFromForm = async () => {
    const urls = buffMode === 'BATCH' ? parsedBatchLinks : [targetPostUrl.trim()].filter(Boolean);
    if (urls.length === 0) {
      message.warning('Vui lòng dán link bài viết!');
      return;
    }
    if (selectedPageIds.length === 0) {
      message.warning('Vui lòng chọn tài khoản thực hiện!');
      return;
    }

    let delayMinutes = typeof queueStartAfter === 'number' ? queueStartAfter : 0;
    if (queueStartAfter === 'AT') {
      if (!queueStartAt) {
        message.warning('Vui lòng chọn giờ bắt đầu!');
        return;
      }
      const [hh, mm] = queueStartAt.split(':').map(Number);
      const target = new Date();
      target.setHours(hh, mm, 0, 0);
      if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1); // giờ đã qua → hẹn ngày mai
      delayMinutes = Math.max(0, Math.round((target.getTime() - Date.now()) / 60000));
    }

    const payload = {
      targetLikes: selectedPageIds.length,
      reactionType: selectedReaction,
      enableLike: engagementMode !== 'COMMENT_ONLY',
      enableComment: engagementMode !== 'LIKE_ONLY',
      enableShare,
      comments:
        engagementMode !== 'LIKE_ONLY'
          ? commentListText.split('\n').map((c) => c.trim()).filter(Boolean)
          : [],
      speedMode,
      delayMinutes,
    };

    setIsEnqueueing(true);
    try {
      if (urls.length === 1) {
        const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/add`, {
          ...payload,
          targetUrl: urls[0],
          source: 'MANUAL',
        });
        if (res.data?.skipped) {
          message.info(res.data.message || 'Bài viết đã từng chạy trước đó.');
          return;
        }
        if (res.data?.alreadyQueued) {
          message.info(res.data.message || 'Bài viết đã có trong hàng đợi.');
          return;
        }
        message.success('Đã thêm vào hàng đợi');
      } else {
        const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/batch-add`, {
          ...payload,
          urls,
          staggerMinutes: queueStagger,
        });
        message.success(`Đã thêm ${res.data?.addedCount ?? 0}/${res.data?.totalReceived ?? urls.length} bài vào hàng đợi`);
        if (res.data?.skippedCount > 0) message.info(`Bỏ qua ${res.data.skippedCount} bài đã chạy trước đó.`);
      }
      if (buffMode === 'BATCH') setBatchLinksText('');
      else setTargetPostUrl('');
      fetchBuffQueue();
      setActiveTabKey('buff-queue');
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || 'Không thể thêm vào hàng đợi');
    } finally {
      setIsEnqueueing(false);
    }
  };

  const handleAddQueueTask = async () => {
    if (!queueUrlInput.trim()) {
      message.warning('Vui lòng nhập link bài viết Facebook!');
      return;
    }
    setQueueLoading(true);
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/add`, {
        targetUrl: queueUrlInput.trim(),
        targetLikes: queueTargetLikes,
        reactionType: queueReaction,
        enableComment: false,
        delayMinutes: queueDelayMinutes,
        skipIfBuffed: true,
      });
      if (res.data?.success) {
        if (res.data.skipped) {
          message.warning(res.data.message);
        } else {
          message.success('Đã nạp bài viết vào hàng đợi tự động thành công!');
          setQueueUrlInput('');
          fetchBuffQueue();
        }
      } else {
        message.error(res.data?.error || 'Lỗi thêm vào hàng đợi');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setQueueLoading(false);
    }
  };

  const handleRunNowQueueTask = async (id: string) => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/run-now/${id}`);
      if (res.data?.success) {
        message.success('Đã kích hoạt task chạy ngay!');
        fetchBuffQueue();
      }
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleRemoveQueueTask = (id: string) => {
    modal.confirm({
      title: 'Xoá task này khỏi hàng đợi?',
      okText: 'Xoá',
      cancelText: 'Huỷ',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.delete(`${WORKER_BASE_URL}/api/buff-queue/remove/${id}`);
          if (res.data?.success) {
            message.success('Đã xoá task khỏi hàng đợi.');
            fetchBuffQueue();
          }
        } catch (err: any) {
          message.error(err.message);
        }
      },
    });
  };

  const handleClearCompletedQueue = async () => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/clear-completed`);
      if (res.data?.success) {
        message.success(`Đã dọn dẹp ${res.data.cleared} bài viết hoàn tất!`);
        fetchBuffQueue();
      }
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleClearAllQueue = () => {
    modal.confirm({
      title: 'Xoá toàn bộ hàng đợi?',
      content: 'Thao tác này sẽ xoá sạch tất cả các bài viết trong hàng đợi.',
      okText: 'Xoá tất cả',
      cancelText: 'Huỷ',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/clear-all`);
          if (res.data?.success) {
            message.success('Đã xoá sạch toàn bộ hàng đợi!');
            fetchBuffQueue();
          }
        } catch (err: any) {
          message.error(err.message);
        }
      },
    });
  };

  const handleRetryQueueTask = async (id: string) => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/retry/${id}`);
      if (res.data?.success) {
        message.success('Đã đưa bài viết vào hàng đợi chạy lại!');
        fetchBuffQueue();
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // POST HUNTER & AUTO-MONITORS STATE & HANDLERS
  // ─────────────────────────────────────────────────────────────────────────────
  const [monitors, setMonitors] = useState<BuffMonitor[]>([]);
  const [loadingMonitors, setLoadingMonitors] = useState<boolean>(false);
  const [isMonitorModalOpen, setIsMonitorModalOpen] = useState<boolean>(false);
  const [editingMonitorId, setEditingMonitorId] = useState<string | null>(null);

  // Monitor Form state
  const [monTargetUrl, setMonTargetUrl] = useState<string>('');
  const [monTargetName, setMonTargetName] = useState<string>('');
  const [monTargetType, setMonTargetType] = useState<'PAGE' | 'GROUP' | 'PROFILE'>('PAGE');
  const [monInterval, setMonInterval] = useState<number>(10);
  const [monTargetLikes, setMonTargetLikes] = useState<number | 'ALL'>('ALL');
  const [monReaction, setMonReaction] = useState<string>('RANDOM_POSITIVE');
  const [monEnableComment, setMonEnableComment] = useState<boolean>(false);
  const [monCommentText, setMonCommentText] = useState<string>(
    '{Sản phẩm|Mẫu này} đẹp quá shop ơi! {Tư vấn|Inbox} em nhé! ❤️\n' +
    'Đẹp xuất sắc luôn ạ! Chúc shop {bão đơn|buôn may bán đắt} nha! 🌟\n' +
    'Chất lượng tuyệt vời, giá cả hợp lý! Đã ủng hộ shop nhiều lần 👍'
  );
  const [monDelayMinutes, setMonDelayMinutes] = useState<number>(3);
  const [monViaMode, setMonViaMode] = useState<string>('ALL_VIAS');
  const [spintaxSampleOutputs, setSpintaxSampleOutputs] = useState<string[]>([]);


  const fetchBuffMonitors = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-monitors`);
      if (res.data?.success) {
        setMonitors(res.data.monitors || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchBuffMonitors();
    const interval = setInterval(fetchBuffMonitors, 15000);
    return () => clearInterval(interval);
  }, [fetchBuffMonitors]);

  // Via Health & Enterprise BM Overview State
  const [checkingViaHealth, setCheckingViaHealth] = useState<boolean>(false);
  const [viaHealthResults, setViaHealthResults] = useState<any[]>([]);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState<boolean>(false);
  const [bmOverview, setBmOverview] = useState<any>(null);

  // Enterprise Ops Settings & Telegram Bot State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [systemSettings, setSystemSettings] = useState<any>({
    telegramBotToken: '',
    telegramBotTokenMasked: '',
    telegramChatId: '',
    notifyOnViaDead: true,
    notifyOnHunter: true,
    notifyOnBuffDone: true,
    maxDailyPageActions: 25,
  });
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [testingTelegram, setTestingTelegram] = useState<boolean>(false);

  const fetchBmOverview = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-vias/overview`);
      if (res.data?.success) {
        setBmOverview({
          ...(res.data.bmHealth || {}),
          antiOverlap: res.data.antiOverlap || { totalTrackedPosts: 0, totalProtectedInteractions: 0 },
          system: res.data.system || { isEmergencyStopped: false, telegramConfigured: false },
          stats: res.data.stats || {},
        });
      }
    } catch {}
  }, []);

  // Via có cookie hết hạn hoặc bị checkpoint (lấy từ dữ liệu tổng quan, tự làm mới mỗi 15 giây)
  const deadViaList = useMemo<{ uid: string; viaName?: string; tokenStatus: string }[]>(
    () =>
      (bmOverview?.vias || []).filter(
        (v: any) => v.tokenStatus === 'EXPIRED' || v.tokenStatus === 'CHECKPOINT'
      ),
    [bmOverview]
  );
  const notifiedDeadViaRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!bmOverview) return;
    const current = new Set(deadViaList.map((v) => v.uid));
    // Lần tải đầu chỉ ghi nhận, không bật thông báo; sau đó báo khi có Via mới chuyển sang lỗi
    if (notifiedDeadViaRef.current) {
      const newlyDead = deadViaList.filter((v) => !notifiedDeadViaRef.current!.has(v.uid));
      if (newlyDead.length > 0) {
        notification.warning({
          key: 'via-dead',
          message: newlyDead.length === 1 ? 'Via cần cập nhật Cookie' : `${newlyDead.length} Via cần cập nhật Cookie`,
          description: (
            <div className="space-y-0.5">
              {newlyDead.map((v) => (
                <div key={v.uid}>
                  {v.viaName || v.uid} · {v.tokenStatus === 'CHECKPOINT' ? 'bị checkpoint' : 'cookie hết hạn'}
                </div>
              ))}
            </div>
          ),
          placement: 'bottomRight',
          duration: 0,
        });
      }
    }
    notifiedDeadViaRef.current = current;
  }, [bmOverview, deadViaList, notification]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get(`${WORKER_BASE_URL}/api/buff-settings`);
      if (res.data?.success && res.data.settings) {
        setSystemSettings(res.data.settings);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchBmOverview();
    fetchSettings();
    const interval = setInterval(fetchBmOverview, 15000);
    return () => clearInterval(interval);
  }, [fetchBmOverview, fetchSettings]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-settings`, systemSettings);
      if (res.data?.success) {
        message.success('Đã lưu cấu hình Hệ thống & Telegram Ops Bot thành công!');
        setIsSettingsModalOpen(false);
        fetchBmOverview();
        fetchSettings();
      } else {
        message.error(res.data?.error || 'Lỗi lưu cấu hình');
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestTelegram = async () => {
    setTestingTelegram(true);
    message.loading({ content: 'Đang gửi tin nhắn thử nghiệm tới Telegram...', key: 'testTele' });
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-settings/test-telegram`, {
        botToken: systemSettings.telegramBotToken || undefined,
        chatId: systemSettings.telegramChatId || undefined,
      });
      if (res.data?.success) {
        message.success({ content: 'Gửi tin nhắn Telegram thành công! Hãy kiểm tra điện thoại của bạn.', key: 'testTele', duration: 4 });
      } else {
        message.error({ content: res.data?.error || 'Gửi thất bại', key: 'testTele' });
      }
    } catch (e: any) {
      message.error({ content: e.response?.data?.error || e.message, key: 'testTele' });
    } finally {
      setTestingTelegram(false);
    }
  };

  const handleEmergencyStop = async () => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/emergency-stop`, {
        reason: 'Quản trị viên kích hoạt Dừng Khẩn Cấp từ Command Bar',
      });
      if (res.data?.success) {
        message.warning(
          res.data.jobStillFinishing
            ? 'Đã bật dừng khẩn cấp. Job đang chạy sẽ dừng sau Page hiện tại.'
            : 'Đã bật dừng khẩn cấp. Hàng đợi và Săn bài tạm ngưng.'
        );
        fetchBmOverview();
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleResumeSystem = async () => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/resume`);
      if (res.data?.success) {
        message.success('Đã khôi phục hoạt động bình thường của hệ thống!');
        fetchBmOverview();
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleRunViaHealthCheck = async () => {
    setCheckingViaHealth(true);
    message.loading({ content: 'Đang kiểm tra kết nối và tình trạng từng Via trên Facebook...', key: 'viaHealth' });
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-vias/health-check`);
      if (res.data?.success) {
        setViaHealthResults(res.data.vias || []);
        setIsHealthModalOpen(true);
        message.success({
          content: `Kiểm tra hoàn tất: ${res.data.liveCount}/${res.data.total} Via đang HOẠT ĐỘNG TỐT (LIVE)!`,
          key: 'viaHealth',
          duration: 4,
        });
        fetchBmOverview();
        refetchAccounts();
      } else {
        message.error({ content: res.data?.error || 'Lỗi kiểm tra Via', key: 'viaHealth' });
      }
    } catch (err: any) {
      message.error({ content: err.message, key: 'viaHealth' });
    } finally {
      setCheckingViaHealth(false);
    }
  };

  const handleOpenAddMonitorModal = (existing?: BuffMonitor, prefillUrl?: string) => {
    if (existing) {
      setEditingMonitorId(existing.id);
      setMonTargetUrl(existing.targetUrl);
      setMonTargetName(existing.targetName);
      setMonTargetType(existing.targetType || 'PAGE');
      setMonInterval(existing.checkIntervalMinutes || 10);
      setMonTargetLikes(existing.buffConfig?.targetLikes || 'ALL');
      setMonReaction(existing.buffConfig?.reactionType || 'RANDOM_POSITIVE');
      setMonEnableComment(Boolean(existing.buffConfig?.enableComment));
      setMonCommentText(
        Array.isArray(existing.buffConfig?.comments) && existing.buffConfig.comments.length > 0
          ? existing.buffConfig.comments.join('\n')
          : '{Sản phẩm|Mẫu này} đẹp quá shop ơi! {Tư vấn|Inbox} em nhé! ❤️\nĐẹp xuất sắc luôn ạ! 🌟'
      );
      setMonDelayMinutes(existing.buffConfig?.delayMinutes || 3);
      setMonViaMode(existing.buffConfig?.viaMode || 'ALL_VIAS');
    } else {
      setEditingMonitorId(null);
      setMonTargetUrl(prefillUrl || '');
      setMonTargetName('');
      setMonTargetType('PAGE');
      setMonInterval(10);
      setMonTargetLikes('ALL');
      setMonReaction('RANDOM_POSITIVE');
      setMonEnableComment(false);
      setMonDelayMinutes(3);
      setMonViaMode('ALL_VIAS');
    }
    setSpintaxSampleOutputs([]);
    setIsMonitorModalOpen(true);
  };

  const handleSaveMonitor = async () => {
    if (!monTargetUrl.trim()) {
      message.warning('Vui lòng nhập Link trang Fanpage / Group / Profile cần theo dõi!');
      return;
    }
    setLoadingMonitors(true);
    try {
      const commentsList = monCommentText.split('\n').map((s) => s.trim()).filter(Boolean);
      const payload = {
        id: editingMonitorId || undefined,
        targetUrl: monTargetUrl.trim(),
        targetName: monTargetName.trim() || undefined,
        targetType: monTargetType,
        checkIntervalMinutes: monInterval,
        buffConfig: {
          targetLikes: monTargetLikes,
          reactionType: monReaction,
          enableLike: true,
          enableComment: monEnableComment,
          comments: commentsList,
          delayMinutes: monDelayMinutes,
          viaMode: monViaMode,
        },
        status: 'ACTIVE',
      };
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-monitors`, payload);
      if (res.data?.success) {
        message.success(editingMonitorId ? 'Đã cập nhật mục tiêu theo dõi!' : 'Đã thêm mục tiêu theo dõi tự động mới!');
        setIsMonitorModalOpen(false);
        fetchBuffMonitors();
      } else {
        message.error(res.data?.error || 'Lỗi lưu mục tiêu theo dõi');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setLoadingMonitors(false);
    }
  };

  const handleDeleteMonitor = (id: string) => {
    modal.confirm({
      title: 'Xoá mục tiêu theo dõi này?',
      content: 'Hệ thống sẽ ngừng tự quét bài mới từ mục tiêu này.',
      okText: 'Xoá',
      cancelText: 'Huỷ',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.delete(`${WORKER_BASE_URL}/api/buff-monitors/${id}`);
          if (res.data?.success) {
            message.success('Đã xoá mục tiêu theo dõi.');
            fetchBuffMonitors();
          }
        } catch (err: any) {
          message.error(err.message);
        }
      },
    });
  };

  const handleToggleMonitor = async (id: string) => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-monitors/${id}/toggle`);
      if (res.data?.success) {
        message.success(res.data.monitor?.status === 'ACTIVE' ? 'Đã bật theo dõi định kỳ!' : 'Đã tạm dừng theo dõi!');
        fetchBuffMonitors();
      }
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleScanNowMonitor = async (id: string) => {
    try {
      message.loading({ content: 'Đang quét bài viết mới từ mục tiêu...', key: 'scanMon' });
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-monitors/${id}/scan-now`);
      if (res.data?.success) {
        message.success({
          content: res.data.baseline
            ? `Lần quét đầu: đã ghi nhận ${res.data.postsFound} bài hiện có làm mốc. Từ giờ chỉ buff bài đăng sau thời điểm này.`
            : `Quét hoàn tất: Phát hiện ${res.data.postsFound} bài viết, đã nạp ${res.data.newPostsEnqueued} bài mới vào hàng đợi!`,
          key: 'scanMon',
          duration: 4,
        });
        fetchBuffMonitors();
        fetchBuffQueue();
      } else {
        message.error({ content: res.data?.error || 'Lỗi quét mục tiêu', key: 'scanMon' });
      }
    } catch (err: any) {
      message.error({ content: err.message, key: 'scanMon' });
    }
  };

  const handleTestSpintaxInForm = () => {
    const lines = monCommentText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) {
      message.warning('Vui lòng nhập ít nhất 1 dòng bình luận hoặc Spintax!');
      return;
    }
    const samples: string[] = [];
    for (let i = 0; i < 4; i++) {
      const picked = lines[i % lines.length];
      samples.push(resolveSpintax(picked));
    }
    setSpintaxSampleOutputs(samples);
    message.info('Đã tạo 4 mẫu bình luận ngẫu nhiên từ cấu trúc Spintax!');
  };

  // AI Seeding Studio & Spintax State
  const [aiStudioModalOpen, setAiStudioModalOpen] = useState(false);
  const [selectedNiche, setSelectedNiche] = useState<string>('GENERAL');
  const [previewSamples, setPreviewSamples] = useState<string[]>([]);

  // Gọi Gemini AI tạo bình luận tự nhiên theo bài viết
  const handleGenerateAiComments = async () => {
    if (!targetPostUrl.trim() && !aiPostPrompt.trim()) {
      message.warning('Vui lòng dán link bài viết hoặc nhập chủ đề bài viết để AI phân tích tạo bình luận!');
      return;
    }
    setIsAiGeneratingComments(true);
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-ai-generate-comments`, {
        topic: selectedNiche || 'GENERAL',
        postContent: aiPostPrompt.trim() || undefined,
        postUrl: targetPostUrl.trim() || undefined,
        count: aiCount || 10,
        tone: aiTone || 'natural',
      });
      if (res.data?.success && Array.isArray(res.data.comments) && res.data.comments.length > 0) {
        setCommentListText(res.data.comments.join('\n'));
        if (engagementMode === 'LIKE_ONLY') {
          setEngagementMode('LIKE_AND_COMMENT');
        }
        message.success(`Gemini AI đã sinh ${res.data.comments.length} bình luận tự nhiên theo ngữ cảnh bài viết!`);
      } else {
        message.warning('Không nhận được bình luận từ AI, vui lòng thử lại.');
      }
    } catch (err: any) {
      message.error(`Lỗi tạo bình luận AI: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsAiGeneratingComments(false);
    }
  };

  // Cảnh báo từ khóa dễ bị bắt spam trong Group (test, bot, tool, tự động...)
  const detectedSpamKeywords = useMemo(() => {
    if (engagementMode === 'LIKE_ONLY' || !commentListText.trim()) return [];
    const lower = commentListText.toLowerCase();
    const badWords = ['test', 'tự động', 'bot', 'tool', 'toolzutter', 'buff', 'hack', 'spam'];
    return badWords.filter((w) => lower.includes(w));
  }, [engagementMode, commentListText]);

  // Tự động chuyển giãn cách an toàn khi bật bình luận
  useEffect(() => {
    if (engagementMode !== 'LIKE_ONLY') {
      if (delayMs < 12000) {
        setDelayMs(12000); // 12 giây an toàn khi có bình luận
      }
    } else if (delayMs >= 12000) {
      setDelayMs(speedMode === 'TURBO' ? 4000 : speedMode === 'FAST' ? 5000 : speedMode === 'SAFE' ? 9000 : 6000);
    }
  }, [engagementMode, speedMode]);

  // History & Anti-Duplicate States
  const [buffLogs, setBuffLogs] = useState<BuffLogEntry[]>([]);
  const [buffLogsLoading, setBuffLogsLoading] = useState(true);
  const [loadingLogDetailId, setLoadingLogDetailId] = useState<string | null>(null);

  const handleViewLogDetail = useCallback(async (log: BuffLogEntry) => {
    if (Array.isArray(log.details) && log.details.length > 0) {
      setSelectedLogDetail(log);
      return;
    }
    try {
      setLoadingLogDetailId(log.id);
      const res = await api.get(`/buff-logs/${log.id}`);
      if (res.data?.success && res.data.log) {
        setSelectedLogDetail(res.data.log);
        setBuffLogs((prev) =>
          prev.map((item) => (item.id === log.id ? { ...item, details: res.data.log.details } : item))
        );
      } else {
        setSelectedLogDetail(log);
      }
    } catch {
      setSelectedLogDetail(log);
    } finally {
      setLoadingLogDetailId(null);
    }
  }, []);

  const reloadBuffLogs = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setBuffLogsLoading(true);
        // Tối ưu hóa siêu tốc: chỉ nạp summary không nạp mảng JSON details nặng nề
        const res = await api.get('/buff-logs', { params: { limit: 500, summary: 'true' } });
        const fetched: BuffLogEntry[] = Array.isArray(res.data?.logs) ? res.data.logs : [];
        setBuffLogs((prev) => mergeBuffLogs(fetched, prev));
      } catch (err: any) {
        if (!silent) message.error(`Không tải được lịch sử: ${err.response?.data?.error || err.message}`);
      } finally {
        if (!silent) setBuffLogsLoading(false);
      }
    },
    [message]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Chuyển lịch sử cũ trong localStorage lên MySQL (ghi đè theo id nên chạy lại không bị trùng)
        const legacy = readLegacyBuffLogs();
        if (legacy.length > 0) {
          await api.post('/buff-logs', { logs: legacy });
          localStorage.removeItem(LEGACY_BUFF_LOGS_STORAGE_KEY);
          if (!cancelled) message.success(`Đã đồng bộ ${legacy.length} lượt lịch sử cũ lên hệ thống`);
        }
        const res = await api.get('/buff-logs', { params: { limit: 500, summary: 'true' } });
        const fetched: BuffLogEntry[] = Array.isArray(res.data?.logs) ? res.data.logs : [];
        // Giữ log vừa chạy xong trong lúc đang tải
        if (!cancelled) setBuffLogs((prev) => mergeBuffLogs(fetched, prev));
      } catch (err: any) {
        if (!cancelled) message.error(`Không tải được lịch sử: ${err.response?.data?.error || err.message}`);
      } finally {
        if (!cancelled) setBuffLogsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  // Tự động làm mới khi người dùng mở tab Lịch sử
  useEffect(() => {
    if (activeTabKey === 'buff-history') {
      reloadBuffLogs(true);
    }
  }, [activeTabKey, reloadBuffLogs]);

  const addBuffLog = useCallback(
    (log: BuffLogEntry) => {
      setBuffLogs((prev) => [log, ...prev]);
      api.post('/buff-logs', { log }).catch((err) => {
        message.warning(`Chưa lưu được lịch sử lên máy chủ: ${err.response?.data?.error || err.message}`);
      });
    },
    [message]
  );

  // Xuất Báo Cáo Lịch Sử Tương Tác ra file CSV (UTF-8 BOM chuẩn Excel)
  const handleExportLogsToCsv = () => {
    if (filteredBuffLogs.length === 0) {
      message.warning('Không có dòng nào khớp bộ lọc để xuất báo cáo!');
      return;
    }
    const headers = [
      'Thời Gian',
      'Loại Chiến Dịch',
      'Link Bài Viết',
      'Tài Khoản / Via',
      'Cảm Xúc',
      'Tổng Số Page',
      'Thành Công',
      'Đã Like Trước',
      'Thất Bại',
      'Chi Tiết Dàn Page',
    ];
    const rows = filteredBuffLogs.map((log) => {
      const time = new Date(log.createdAt).toLocaleString('vi-VN');
      const type = log.type === 'QUEUE' ? 'Hàng Đợi' : log.type === 'BATCH' ? 'Hàng Loạt' : 'Đơn Lẻ';
      const url = `"${(log.targetUrl || '').replace(/"/g, '""')}"`;
      const acc = `"${(log.accountName || '').replace(/"/g, '""')}"`;
      const reaction = log.reactionType || 'LIKE';
      const counts = getLogCounts(log);
      const total = counts.total;
      const success = counts.success;
      const already = counts.alreadyLiked;
      const failed = counts.failed;
      const pageNames = `"${log.details.map((d) => `${d.pageName} [${d.status}]`).join('; ').replace(/"/g, '""')}"`;
      return [time, type, url, acc, reaction, total, success, already, failed, pageNames].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Bao_Cao_Buff_Tuong_Tac_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    message.success(`Đã xuất ${filteredBuffLogs.length} dòng ra file CSV!`);
  };



  // Đồng bộ mở modal Cài đặt từ Sidebar
  useEffect(() => {
    if (props.isExternalSettingsOpen) {
      fetchSettings();
      setIsSettingsModalOpen(true);
      props.onCloseExternalSettings?.();
    }
  }, [props.isExternalSettingsOpen]);
  const [autoSkipAlreadyLiked, setAutoSkipAlreadyLiked] = useState<boolean>(true);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logFilterReaction, setLogFilterReaction] = useState<string>('ALL');
  const [logFilterTime, setLogFilterTime] = useState<'ALL' | 'TODAY' | '7D' | '30D'>('ALL');
  const [logFilterType, setLogFilterType] = useState<'ALL' | 'SINGLE' | 'BATCH' | 'QUEUE'>('ALL');
  const [logFilterVia, setLogFilterVia] = useState<string>('ALL');
  const [logFilterResult, setLogFilterResult] = useState<'ALL' | 'CLEAN' | 'UNVERIFIED' | 'FAILED'>('ALL');

  const logViaOptions = useMemo(
    () => Array.from(new Set(buffLogs.map((l) => l.accountName).filter(Boolean) as string[])).sort(),
    [buffLogs]
  );

  const hasActiveLogFilter =
    Boolean(logSearchQuery.trim()) ||
    logFilterReaction !== 'ALL' ||
    logFilterTime !== 'ALL' ||
    logFilterType !== 'ALL' ||
    logFilterVia !== 'ALL' ||
    logFilterResult !== 'ALL';

  const resetLogFilters = () => {
    setLogSearchQuery('');
    setLogFilterReaction('ALL');
    setLogFilterTime('ALL');
    setLogFilterType('ALL');
    setLogFilterVia('ALL');
    setLogFilterResult('ALL');
  };

  const filteredBuffLogs = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const minTime =
      logFilterTime === 'TODAY'
        ? startOfToday.getTime()
        : logFilterTime === '7D'
          ? Date.now() - 7 * 86400000
          : logFilterTime === '30D'
            ? Date.now() - 30 * 86400000
            : 0;
    const q = logSearchQuery.toLowerCase().trim();

    return buffLogs.filter((log) => {
      if (minTime && new Date(log.createdAt).getTime() < minTime) return false;
      if (logFilterType !== 'ALL' && log.type !== logFilterType) return false;
      if (logFilterVia !== 'ALL' && log.accountName !== logFilterVia) return false;
      if (logFilterReaction !== 'ALL' && log.reactionType !== logFilterReaction) return false;
      if (logFilterResult !== 'ALL') {
        const c = getLogCounts(log);
        if (logFilterResult === 'CLEAN' && (c.failed > 0 || c.unverified > 0)) return false;
        if (logFilterResult === 'UNVERIFIED' && c.unverified === 0) return false;
        if (logFilterResult === 'FAILED' && c.failed === 0) return false;
      }
      if (!q) return true;
      return (
        (log.targetUrl || '').toLowerCase().includes(q) ||
        Boolean((log.accountName || '').toLowerCase().includes(q)) ||
        (Array.isArray(log.details) &&
          log.details.some(
            (d) =>
              (d.pageName || '').toLowerCase().includes(q) ||
              String(d.pageId || '').includes(q)
          ))
      );
    });
  }, [buffLogs, logSearchQuery, logFilterReaction, logFilterTime, logFilterType, logFilterVia, logFilterResult]);
  const [selectedLogDetail, setSelectedLogDetail] = useState<BuffLogEntry | null>(null);

  // Tính toán các Fanpage đã từng like link bài viết này trong lịch sử
  const alreadyLikedPagesForUrl = useMemo(() => {
    if (!targetPostUrl.trim()) return [];
    const normalizedTarget = targetPostUrl.trim();
    const matchingLogs = buffLogs.filter((log) => log.targetUrl === normalizedTarget);
    const pageMap = new Map<string, { pageId: string; pageName: string; reactionType: string; date: string }>();
    for (const log of matchingLogs) {
      for (const d of log.details || []) {
        if (d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED') {
          if (!pageMap.has(d.pageId)) {
            pageMap.set(d.pageId, {
              pageId: d.pageId,
              pageName: d.pageName,
              reactionType: log.reactionType,
              date: log.createdAt,
            });
          }
        }
      }
    }
    return Array.from(pageMap.values());
  }, [targetPostUrl, buffLogs]);

  // Batch Buff State (Chạy like hàng loạt nhiều bài viết)
  const [batchLinksText, setBatchLinksText] = useState<string>('');
  const [batchLikesPerOrder, setBatchLikesPerOrder] = useState<number>(20);
  const [batchLinkConcurrency, setBatchLinkConcurrency] = useState<number>(2); // 1: Tuần tự, 2: Song song 2 link cùng lúc
  const batchWaitSeconds = 2;
  const [batchOrders, setBatchOrders] = useState<BatchOrder[]>([]);
  const [expandedBatchOrderIds, setExpandedBatchOrderIds] = useState<Set<number>>(new Set());
  const [pageDisplayLimit, setPageDisplayLimit] = useState<number>(60);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [isBatchPaused, setIsBatchPaused] = useState<boolean>(false);
  const batchAbortRef = useRef<boolean>(false);
  const batchPauseRef = useRef<boolean>(false);
  const buffAbortRef = useRef<AbortController | null>(null);
  const batchStreamAbortControllersRef = useRef<Set<AbortController>>(new Set());

  const isBatch = (buffMode === 'BATCH' || batchOrders.length > 0) && batchOrders.length > 0;
  const totalBatchLikesTarget = batchOrders.reduce((sum, o) => sum + (o.totalLikesTarget || 0), 0);
  const totalBatchSuccess = batchOrders.reduce((sum, o) => sum + (o.successLikes || 0), 0);
  const totalBatchAlreadyLiked = batchOrders.reduce((sum, o) => sum + (o.details?.filter((d) => d.status === 'ALREADY_LIKED').length || 0), 0);
  const totalBatchFailed = batchOrders.reduce((sum, o) => sum + (o.details?.filter((d) => d.status === 'FAILED' || d.status === 'ERROR').length || 0), 0);

  // Rời trang thì huỷ mọi stream đang chạy (worker sẽ dừng sau page hiện tại)
  useEffect(() => {
    return () => {
      batchAbortRef.current = true;
      batchPauseRef.current = false;
      buffAbortRef.current?.abort();
      batchStreamAbortControllersRef.current.forEach((c) => c.abort());
      batchStreamAbortControllersRef.current.clear();
    };
  }, []);

  // Quản lý & Khai báo thêm i_user (Fanpage) cho từng Via
  const queryClient = useQueryClient();
  const [managePagesModalOpen, setManagePagesModalOpen] = useState<boolean>(false);
  const [targetViaForModal, setTargetViaForModal] = useState<number | 'CUSTOM'>('CUSTOM');
  const [refreshViaPagesKey, setRefreshViaPagesKey] = useState<number>(0);
  const [addMode, setAddMode] = useState<'BULK' | 'SINGLE'>('BULK');
  const [newPageName, setNewPageName] = useState<string>('');
  const [newPageIdOrUrl, setNewPageIdOrUrl] = useState<string>('');
  const [bulkPagesText, setBulkPagesText] = useState<string>('');

  // Fetch accounts from backend with staleTime 0 so newly added Vias appear instantly
  const { data: accounts = [], isLoading: loadingAccounts, refetch: refetchAccounts } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => (await api.get('/connections')).data || [],
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  // Deduplicate mother account by c_user
  const fbAccounts = useMemo(() => {
    const byCUser = new Map<string, any>();
    for (const account of accounts as any[]) {
      if (!isPersonalCookieAccount(account) || account.platform === 'FACEBOOK_GROUP') continue;
      const cUser = extractCUser(account.cookieString || account.accessToken);
      if (!cUser) continue;
      const existing = byCUser.get(cUser);
      const accountIsProfile =
        account.platform === 'FACEBOOK_PROFILE' || account.accountType === 'PERSONAL_PROFILE_COOKIE';
      const existingIsProfile =
        existing?.platform === 'FACEBOOK_PROFILE' || existing?.accountType === 'PERSONAL_PROFILE_COOKIE';
      if (
        !existing ||
        (accountIsProfile && !existingIsProfile) ||
        (accountIsProfile === existingIsProfile && existing.tokenStatus !== 'OK' && account.tokenStatus === 'OK') ||
        (accountIsProfile === existingIsProfile && existing.tokenStatus === account.tokenStatus && account.id > existing.id)
      ) {
        byCUser.set(cUser, account);
      }
    }

    return Array.from(byCUser.values());
  }, [accounts]);

  // Đồng bộ số liệu thống kê lên Sidebar Ant Design
  useEffect(() => {
    props.onStatsUpdate?.({
      queueCount: queueItems.filter((i) => i.status === 'QUEUED').length,
      historyCount: buffLogs.length,
      monitorsCount: (monitors || []).length,
      accountsCount: fbAccounts.length,
    });
  }, [queueItems, buffLogs, monitors, fbAccounts]);

  // Active Cookie string
  const activeCookie = useMemo(() => {
    if (selectedAccountId === 'CUSTOM') return customCookie.trim();
    if (selectedAccountId === 'ALL_VIAS') {
      return fbAccounts[0]?.cookieString || fbAccounts[0]?.accessToken || '';
    }
    const acc = fbAccounts.find((a: any) => a.id === selectedAccountId);
    return acc?.cookieString || acc?.accessToken || '';
  }, [selectedAccountId, customCookie, fbAccounts]);

  const currentViaAccount = useMemo(() => {
    if (selectedAccountId === 'CUSTOM' || selectedAccountId === 'ALL_VIAS') return null;
    return fbAccounts.find((a: any) => a.id === selectedAccountId) || null;
  }, [selectedAccountId, fbAccounts]);

  const modalViaAccount = useMemo(() => {
    if (targetViaForModal === 'CUSTOM') return null;
    return fbAccounts.find((a: any) => a.id === targetViaForModal) || null;
  }, [targetViaForModal, fbAccounts]);

  const targetViaKey = useMemo(() => {
    return getViaKey(modalViaAccount, customCookie);
  }, [modalViaAccount, customCookie]);

  const currentModalPages = useMemo(() => {
    void refreshViaPagesKey;
    return getStoredPagesForVia(targetViaKey);
  }, [targetViaKey, refreshViaPagesKey]);

  const handleOpenManagePages = (viaId?: number | 'CUSTOM' | 'ALL_VIAS') => {
    const id = viaId !== undefined && viaId !== 'ALL_VIAS' ? viaId : (fbAccounts[0]?.id || 'CUSTOM');
    setTargetViaForModal(id);
    setManagePagesModalOpen(true);
  };

  // Auto select ALL_VIAS if multiple accounts exist, else first account
  useEffect(() => {
    if (selectedAccountId === 'CUSTOM' && !customCookie.trim() && fbAccounts.length > 0) {
      setSelectedAccountId(fbAccounts.length > 1 ? 'ALL_VIAS' : fbAccounts[0].id);
    }
  }, [fbAccounts, selectedAccountId, customCookie]);

  // Đồng bộ Fanpage từ Backend Cache vào LocalStorage khi khởi động
  useEffect(() => {
    api.get('/buff-cached-pages').then((res) => {
      if (res.data?.success && res.data.cache) {
        const raw = localStorage.getItem(VIA_PAGES_STORAGE_KEY);
        const map = raw ? JSON.parse(raw) : {};
        let changed = false;
        for (const [uid, item] of Object.entries(res.data.cache as Record<string, any>)) {
          const key = `cuser_${uid}`;
          if (Array.isArray(item.pages) && item.pages.length > 0) {
            if (!map[key] || map[key].length < item.pages.length) {
              map[key] = item.pages;
              changed = true;
            }
          }
        }
        if (changed) {
          localStorage.setItem(VIA_PAGES_STORAGE_KEY, JSON.stringify(map));
          setRefreshViaPagesKey((prev) => prev + 1);
        }
      }
    }).catch(() => {});
  }, []);

  // Load persistent Fanpages for selected Via or ALL_VIAS
  useEffect(() => {
    if (selectedAccountId === 'CUSTOM') {
      const viaKey = getViaKey('CUSTOM', customCookie);
      const saved = getStoredPagesForVia(viaKey);
      setScannedPages(saved);
      setSelectedPageIds(saved.map((p) => p.id));
      return;
    }

    // NẾU ĐANG CHỌN CHẾ ĐỘ DÀN VIA CÁ NHÂN: DÙNG TRỰC TIẾP TỪNG NICK VIA
    if (actorMode === 'VIAS') {
      if (selectedAccountId === 'ALL_VIAS') {
        const viaItems: FanpageItem[] = fbAccounts.map((a: any) => {
          const cUser = extractCUser(a.cookieString || a.accessToken) || String(a.platformAccountId || a.id);
          return {
            id: cUser,
            name: a.pageName || `Via ${cUser}`,
            url: `https://www.facebook.com/profile.php?id=${cUser}`,
            viaAccountId: a.id,
            viaName: a.pageName || `Via ${cUser}`,
            viaCookie: a.cookieString || a.accessToken,
            viaStatus: a.tokenStatus || 'OK',
            isProfile: true,
          };
        });
        setScannedPages(viaItems);
        setSelectedPageIds(viaItems.map((p) => p.id));
        return;
      }

      const sourceAccount = fbAccounts.find((account: any) => account.id === selectedAccountId);
      if (sourceAccount) {
        const cUser = extractCUser(sourceAccount.cookieString || sourceAccount.accessToken) || String(sourceAccount.platformAccountId || sourceAccount.id);
        const item: FanpageItem = {
          id: cUser,
          name: sourceAccount.pageName || `Via ${cUser}`,
          url: `https://www.facebook.com/profile.php?id=${cUser}`,
          viaAccountId: sourceAccount.id,
          viaName: sourceAccount.pageName || `Via ${cUser}`,
          viaCookie: sourceAccount.cookieString || sourceAccount.accessToken,
          viaStatus: sourceAccount.tokenStatus || 'OK',
          isProfile: true,
        };
        setScannedPages([item]);
        setSelectedPageIds([item.id]);
        return;
      }
    }

    if (selectedAccountId === 'ALL_VIAS') {
      const allPages: FanpageItem[] = [];
      const seenPageIds = new Set<string>();

      // Thu thập toàn bộ page của từng via
      const viaPageMaps = new Map<number, FanpageItem[]>();

      for (const account of fbAccounts) {
        const sourceCUser = extractCUser(account?.cookieString || account?.accessToken);
        const viaKey = getViaKey(account);
        const localSaved = getStoredPagesForVia(viaKey);

        const dbPages: FanpageItem[] = (accounts as any[])
          .filter(
            (acc) =>
              acc.platform === 'FACEBOOK_PAGE' &&
              acc.accountType === 'PERSONAL_COOKIE' &&
              (sourceCUser ? extractCUser(acc.cookieString || acc.accessToken) === sourceCUser : true)
          )
          .map((acc) => ({
            id: String(acc.platformAccountId),
            name: acc.pageName || `Facebook Page ${acc.platformAccountId}`,
            url: `https://www.facebook.com/profile.php?id=${acc.platformAccountId}`,
          }));

        const map = new Map<string, FanpageItem>();
        for (const p of localSaved) {
          if (p.id) map.set(p.id, p);
        }
        for (const p of dbPages) {
          if (p.id && !map.has(p.id)) {
            map.set(p.id, p);
          }
        }
        viaPageMaps.set(account.id, Array.from(map.values()));
      }

      // THUẬT TOÁN CÂN BẰNG TẢI THÔNG MINH (SMART LOAD BALANCER):
      // Ưu tiên các Via có tệp page nhỏ hơn (Hồng Phước 92, Phú 28) lên trước để phân phối đều,
      // sau đó Via lớn (Thành An 514) gánh phần còn lại, giúp giảm tải nhiệt cho tất cả các nick mẹ.
      const sortedAccounts = [...fbAccounts].sort((a, b) => {
        const countA = viaPageMaps.get(a.id)?.length || 0;
        const countB = viaPageMaps.get(b.id)?.length || 0;
        return countA - countB;
      });

      for (const account of sortedAccounts) {
        const pages = viaPageMaps.get(account.id) || [];
        for (const p of pages) {
          if (!seenPageIds.has(p.id)) {
            seenPageIds.add(p.id);
            allPages.push({
              ...p,
              viaAccountId: account.id,
              viaName: account.pageName || 'Via Facebook',
              viaCookie: account.cookieString || account.accessToken,
              viaStatus: account.tokenStatus || 'OK',
            });
          }
        }
      }

      setScannedPages(allPages);
      setSelectedPageIds(allPages.map((p) => p.id));
      return;
    }

    const sourceAccount = fbAccounts.find((account: any) => account.id === selectedAccountId);
    if (!sourceAccount) return;
    const sourceCUser = extractCUser(sourceAccount?.cookieString || sourceAccount?.accessToken);
    const viaKey = getViaKey(sourceAccount);

    const localSaved = getStoredPagesForVia(viaKey);

    const dbPages: FanpageItem[] = (accounts as any[])
      .filter(
        (account) =>
          account.platform === 'FACEBOOK_PAGE' &&
          account.accountType === 'PERSONAL_COOKIE' &&
          (sourceCUser ? extractCUser(account.cookieString || account.accessToken) === sourceCUser : true)
      )
      .map((account) => ({
        id: String(account.platformAccountId),
        name: account.pageName || `Facebook Page ${account.platformAccountId}`,
        url: `https://www.facebook.com/profile.php?id=${account.platformAccountId}`,
      }));

    // Merge unique by ID: localSaved takes precedence, then dbPages
    const map = new Map<string, FanpageItem>();
    for (const p of localSaved) {
      if (p.id) map.set(p.id, p);
    }
    for (const p of dbPages) {
      if (p.id && !map.has(p.id)) {
        map.set(p.id, p);
      }
    }
    const mergedList = Array.from(map.values())
      .map((p) => ({
        ...p,
        viaAccountId: sourceAccount.id,
        viaName: sourceAccount.pageName || 'Via Facebook',
        viaCookie: sourceAccount.cookieString || sourceAccount.accessToken,
        viaStatus: sourceAccount.tokenStatus || 'OK',
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

    if (mergedList.length > 0) {
      saveStoredPagesForVia(viaKey, mergedList);
    }
    setScannedPages(mergedList);
    setSelectedPageIds(mergedList.map((p) => p.id));
  }, [accounts, fbAccounts, selectedAccountId, actorMode]);

  useEffect(() => {
    if (scannedPages.length > 0) {
      setBatchLikesPerOrder((prev) => (prev === 20 || prev === 0 ? scannedPages.length : prev));
    }
  }, [scannedPages]);

  const { parsedBatchLinks, rawBatchLinesCount, invalidBatchLinesCount } = useMemo(() => {
    const rawTokens = batchLinksText
      .split(/[\r\n,;]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const validUrls: string[] = [];
    const seen = new Set<string>();
    let invalidCount = 0;

    for (const token of rawTokens) {
      let url = token;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com')) {
          url = 'https://' + url.replace(/^\/+/, '');
        }
      }
      if (
        (url.startsWith('http://') || url.startsWith('https://')) &&
        (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com'))
      ) {
        if (!seen.has(url)) {
          seen.add(url);
          validUrls.push(url);
        }
      } else {
        invalidCount++;
      }
    }

    return {
      parsedBatchLinks: validUrls,
      rawBatchLinesCount: rawTokens.length,
      invalidBatchLinesCount: invalidCount,
    };
  }, [batchLinksText]);

  // Ước tính thời gian chạy: ưu tiên tốc độ thực tế từ các bài đã hoàn tất, nếu chưa có thì tính theo giãn cách đang chọn
  const runEstimate = useMemo(() => {
    const links = buffMode === 'BATCH' ? parsedBatchLinks.length : targetPostUrl.trim() ? 1 : 0;
    const accounts = selectedPageIds.length;
    if (links === 0 || accounts === 0) return null;

    const samples = (queueItems as any[])
      .filter((t) => t.status === 'COMPLETED' && t.result?.durationSec > 0 && t.result?.total > 0)
      .slice(-20)
      .map((t) => t.result.durationSec / t.result.total)
      .sort((a, b) => a - b);

    let perPage: number;
    let basis: 'history' | 'settings';
    if (samples.length >= 3) {
      perPage = samples[Math.floor(samples.length / 2)]; // trung vị, ít bị ảnh hưởng bởi lần chạy bất thường
      basis = 'history';
    } else {
      perPage = delayMs / 1000 / Math.max(1, concurrency) + 3;
      basis = 'settings';
    }
    const perLink = perPage * accounts;
    return { total: perLink * links, perLink, links, basis };
  }, [buffMode, parsedBatchLinks.length, targetPostUrl, selectedPageIds.length, queueItems, delayMs, concurrency]);


  // Bóc tách danh sách Fanpage từ ô nhập hàng loạt
  const parsedBulkPages = useMemo(() => {
    if (!bulkPagesText.trim()) return [];
    const lines = bulkPagesText.split('\n');
    const results: { pageName: string; platformAccountId: string }[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let id = '';
      let name = '';
      if (trimmed.includes('|')) {
        const parts = trimmed.split('|').map((p) => p.trim());
        const firstIsId = extractPageId(parts[0]);
        const secondIsId = extractPageId(parts[1]);
        if (firstIsId) {
          id = firstIsId;
          name = parts[1] || `Fanpage (${id.slice(-4)})`;
        } else if (secondIsId) {
          id = secondIsId;
          name = parts[0] || `Fanpage (${id.slice(-4)})`;
        }
      } else {
        const extracted = extractPageId(trimmed);
        if (extracted) {
          id = extracted;
          name = `Fanpage (${id.slice(-4)})`;
        }
      }
      if (id && !results.some((r) => r.platformAccountId === id)) {
        results.push({ pageName: name, platformAccountId: id });
      }
    }
    return results;
  }, [bulkPagesText]);

  // Mutation: Lưu các Fanpage mới vào Via
  const savePagesMutation = useMutation({
    mutationFn: async (pagesToAdd: { pageName: string; platformAccountId: string }[]) => {
      const motherAccount = fbAccounts.find((a: any) => a.id === (targetViaForModal !== 'CUSTOM' ? targetViaForModal : selectedAccountId));
      const motherCookie = motherAccount?.cookieString || motherAccount?.accessToken || customCookie;
      if (!motherCookie) {
        return [];
      }

      const created = [];
      for (const p of pagesToAdd) {
        try {
          const res = await api.post('/connections', {
            platform: 'FACEBOOK_PAGE',
            accountType: 'PERSONAL_COOKIE',
            platformAccountId: p.platformAccountId,
            pageName: p.pageName,
            accessToken: motherCookie,
            tokenStatus: 'OK',
          });
          created.push(res.data);
        } catch {
          // Ignore backend conflict if already exists
        }
      }
      return created;
    },
    onSuccess: (res) => {
      if (res.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      }
    },
    onError: () => {},
  });

  // Handlers lưu / xóa Fanpage cho Via cụ thể
  const handleSavePagesForTargetVia = (pagesToAdd: FanpageItem[]) => {
    const existing = getStoredPagesForVia(targetViaKey);
    const merged = [...existing];
    for (const p of pagesToAdd) {
      const idx = merged.findIndex((m) => m.id === p.id);
      if (idx >= 0) {
        if (p.name) merged[idx] = { ...merged[idx], name: p.name };
      } else {
        merged.push(p);
      }
    }
    saveStoredPagesForVia(targetViaKey, merged);
    setRefreshViaPagesKey((prev) => prev + 1);

    if (targetViaForModal === selectedAccountId) {
      setScannedPages(merged);
      setSelectedPageIds(merged.map((p) => p.id));
    }

    message.success(`Đã lưu ${pagesToAdd.length} Fanpage cho Via ${modalViaAccount?.pageName || 'này'}!`);

    savePagesMutation.mutate(pagesToAdd.map((p) => ({ pageName: p.name, platformAccountId: p.id })));
  };

  const handleDeletePageForTargetVia = (pageId: string) => {
    const existing = getStoredPagesForVia(targetViaKey);
    const updated = existing.filter((p) => p.id !== pageId);
    saveStoredPagesForVia(targetViaKey, updated);
    setRefreshViaPagesKey((prev) => prev + 1);

    if (targetViaForModal === selectedAccountId) {
      setScannedPages(updated);
      setSelectedPageIds((prev) => prev.filter((id) => id !== pageId));
    }

    message.success('Đã xóa Fanpage khỏi danh sách của Via!');
    deletePageMutation.mutate(pageId);
  };

  const handleClearPagesForTargetVia = () => {
    saveStoredPagesForVia(targetViaKey, []);
    setRefreshViaPagesKey((prev) => prev + 1);
    if (targetViaForModal === selectedAccountId) {
      setScannedPages([]);
      setSelectedPageIds([]);
    }
    message.info('Đã xóa danh sách để nhập lại.');
  };

  // Mutation: Xoá Fanpage khỏi hệ thống
  const deletePageMutation = useMutation({
    mutationFn: async (pageId: string) => {
      const acc = (accounts as any[]).find(
        (a) => a.platform === 'FACEBOOK_PAGE' && String(a.platformAccountId) === String(pageId)
      );
      if (acc) {
        await api.delete(`/connections/${acc.id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: () => {},
  });

  // Thống kê số lượng Page theo từng Via khi chọn ALL_VIAS
  const viaGroupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of scannedPages) {
      const vName = p.viaName || 'Khác';
      counts[vName] = (counts[vName] || 0) + 1;
    }
    return counts;
  }, [scannedPages]);

  // Filter pages by search query and viaFilter
  const filteredPages = useMemo(() => {
    let list = scannedPages;
    if (viaFilter !== 'ALL') {
      list = list.filter((p) => p.viaName === viaFilter || String(p.viaAccountId) === viaFilter);
    }
    if (!pageSearchQuery.trim()) return list;
    const q = pageSearchQuery.toLowerCase().trim();
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.includes(q) ||
        (p.viaName && p.viaName.toLowerCase().includes(q))
    );
  }, [scannedPages, pageSearchQuery, viaFilter]);

  // Set lookup tối ưu O(1) thay cho .includes() / .some() O(N*M)
  const selectedPageIdsSet = useMemo(() => new Set(selectedPageIds), [selectedPageIds]);
  const alreadyLikedPageIdsSet = useMemo(
    () => new Set(alreadyLikedPagesForUrl.map((al) => al.pageId)),
    [alreadyLikedPagesForUrl]
  );

  // Đếm số lượng Page thuộc Via hết hạn Cookie đang được người dùng chọn (O(N) thay vì O(N^2))
  const expiredPagesSelectedCount = useMemo(() => {
    return scannedPages.filter((p) => selectedPageIdsSet.has(p.id) && p.viaStatus === 'EXPIRED').length;
  }, [scannedPages, selectedPageIdsSet]);

  // Tự động thay thế toàn bộ Page thuộc Via hết cookie bằng Page từ các Via đang LIVE
  const handleReplaceExpiredPagesWithLiveOnes = () => {
    const expiredSelected = scannedPages.filter(
      (p) => selectedPageIdsSet.has(p.id) && p.viaStatus === 'EXPIRED'
    );
    if (expiredSelected.length === 0) {
      message.info('Không có Page nào thuộc Via hết cookie trong danh sách đang chọn.');
      return;
    }
    const unselectedLivePages = scannedPages.filter(
      (p) =>
        p.viaStatus !== 'EXPIRED' &&
        !selectedPageIdsSet.has(p.id) &&
        !interactedPageIds.has(p.id) &&
        !alreadyLikedPageIdsSet.has(p.id)
    );

    const needed = expiredSelected.length;
    const replacement = unselectedLivePages.slice(0, needed);
    const expiredIds = new Set(expiredSelected.map((p) => p.id));
    const newSelected = selectedPageIds
      .filter((id) => !expiredIds.has(id))
      .concat(replacement.map((p) => p.id));

    setSelectedPageIds(newSelected);
    if (replacement.length > 0) {
      message.success(
        `🛡️ [Auto-Failover] Đã tự động thay thế ${replacement.length}/${needed} Page từ các Via LIVE đang hoạt động tốt!`
      );
    } else {
      message.warning('Không tìm thấy thêm Page dự phòng từ Via Live để bù vào.');
    }
  };

  // Chọn nhanh N Fanpage phân bổ cân bằng giữa các Via mẹ (Multi-Via Balanced Distribution)
  const handleSelectRandomPages = (count: number) => {
    if (scannedPages.length === 0) return;
    const freshPages = scannedPages.filter(
      (p) => !interactedPageIds.has(p.id) && !alreadyLikedPageIdsSet.has(p.id)
    );
    // TỰ ĐỘNG THAY THẾ BẰNG VIA LIVE: Ưu tiên chọn 100% từ các Via đang LIVE, loại bỏ Via hết cookie
    const liveFreshPages = freshPages.filter((p) => p.viaStatus !== 'EXPIRED');
    const pool =
      autoFailoverLiveVia && liveFreshPages.length > 0
        ? liveFreshPages
        : freshPages.length > 0
        ? freshPages
        : scannedPages;
    const targetCount = Math.min(count, pool.length);

    // Phân bổ đều theo từng Via mẹ để tránh dồn gánh nặng vào 1 Via duy nhất (chống Action Blocked)
    const pagesByVia: Record<string, FanpageItem[]> = {};
    for (const p of pool) {
      const viaKey = p.viaCookie || p.viaName || String(p.viaAccountId || 'default');
      if (!pagesByVia[viaKey]) pagesByVia[viaKey] = [];
      pagesByVia[viaKey].push(p);
    }

    // Shuffle từng nhóm via
    Object.keys(pagesByVia).forEach((k) => {
      pagesByVia[k] = pagesByVia[k].sort(() => 0.5 - Math.random());
    });

    // Round-robin nhặt lần lượt từ từng Via
    const selectedList: FanpageItem[] = [];
    const viaKeys = Object.keys(pagesByVia);
    let added = true;
    while (selectedList.length < targetCount && added) {
      added = false;
      for (const k of viaKeys) {
        if (selectedList.length >= targetCount) break;
        if (pagesByVia[k].length > 0) {
          selectedList.push(pagesByVia[k].shift()!);
          added = true;
        }
      }
    }

    const selected = selectedList.map((p) => p.id);
    setSelectedPageIds(selected);
    const viaCount = new Set(selectedList.map((p) => p.viaName || 'Via')).size;
    const hasFilteredExpired = autoFailoverLiveVia && liveFreshPages.length < freshPages.length;

    if (hasFilteredExpired) {
      message.success(
        `🛡️ [Auto-Failover] Đã tự động loại trừ Via hết cookie và chọn cân bằng ${selected.length} Fanpage trên ${viaCount} Via LIVE sẵn sàng tương tác!`
      );
    } else if (freshPages.length < scannedPages.length && pool === freshPages) {
      message.success(`Đã tự động loại trừ Page cũ và phân bổ đều ${selected.length} Fanpage trên ${viaCount} Via!`);
    } else {
      message.success(`Đã chọn cân bằng ${selected.length} Fanpage trên ${viaCount} Via sẵn sàng tương tác!`);
    }
  };

  // Mutation: Scan Fanpages from Cookie (Merges & preserves pages, never drops count)
  const scanPagesMutation = useMutation({
    mutationFn: async (cookie: string) => {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-get-pages`, {
        cookieString: cookie,
        forceRefresh: true,
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success && data.pages) {
        const sourceAccount = fbAccounts.find((account: any) => account.id === selectedAccountId);
        const viaKey = getViaKey(sourceAccount, customCookie);
        const existing = getStoredPagesForVia(viaKey);
        const merged = [...existing];
        let newCount = 0;
        for (const p of data.pages) {
          const idx = merged.findIndex((m) => m.id === p.id);
          if (idx >= 0) {
            if (p.name && (!merged[idx].name || merged[idx].name.includes('Fanpage ('))) {
              merged[idx] = { ...merged[idx], name: p.name };
            }
          } else {
            merged.push(p);
            newCount++;
          }
        }
        saveStoredPagesForVia(viaKey, merged);
        setRefreshViaPagesKey((prev) => prev + 1);
        setScannedPages(merged);
        setSelectedPageIds(merged.map((p: FanpageItem) => p.id));
        message.success(
          `Đã quét xong Facebook! Tổng cộng giữ đủ ${merged.length} Fanpage cho Via này${
            newCount > 0 ? ` (tìm thấy thêm ${newCount} Page mới)` : ''
          }.`
        );
      } else {
        message.warning('Không tìm thấy Fanpage nào hoặc cookie hết hạn.');
      }
    },
    onError: (err: any) => {
      message.error(`Lỗi khi quét Fanpage: ${err.response?.data?.error || err.message}`);
    },
  });

  // Mutation: Auto Buff Like (Playwright Bot - Real-time SSE Stream)
  const autoBuffMutation = useMutation({
    mutationFn: async () => {
      if (bmOverview?.system?.isEmergencyStopped) {
        throw new Error('Hệ thống đang ở trạng thái DỪNG KHẨN CẤP (Emergency Stop)! Vui lòng bấm nút "Khôi phục hoạt động" màu xanh ở góc trên thanh công cụ trước khi bắt đầu.');
      }
      if (!activeCookie) {
        throw new Error('Vui lòng chọn tài khoản hoặc dán Cookie Facebook!');
      }
      if (!isFacebookPostUrl(targetPostUrl)) {
        throw new Error('Vui lòng nhập link bài viết Facebook hợp lệ (https://facebook.com/...)');
      }
      if (selectedPageIds.length === 0) {
        throw new Error('Vui lòng chọn ít nhất 1 Fanpage để thả Like!');
      }

      let pagesToBuff = scannedPages.filter((p) => selectedPageIdsSet.has(p.id));

      if (autoSkipAlreadyLiked && alreadyLikedPageIdsSet.size > 0) {
        const filtered = pagesToBuff.filter((p) => !alreadyLikedPageIdsSet.has(p.id));
        if (filtered.length === 0) {
          throw new Error('Tất cả các Page bạn chọn đã từng like bài viết này trước đó rồi! Vui lòng chọn Page khác hoặc tắt mục "Tự động bỏ qua các Page đã Like".');
        }
        pagesToBuff = filtered;
      }

      const targetKpi = pagesToBuff.length;

      // THUẬT TOÁN SMART KPI AUTO-REFILL:
      // Chuẩn bị kho Page dự phòng chưa được chọn. Nếu bất kỳ Page nào trong danh sách chính bị lỗi,
      // hệ thống sẽ tự động bốc Page dự phòng này thế chỗ cho đến khi đạt đủ targetKpi like thành công!
      const chosenIds = new Set(pagesToBuff.map((p) => p.id));
      const backupPages = scannedPages.filter(
        (p) =>
          !chosenIds.has(p.id) &&
          !interactedPageIds.has(p.id) &&
          !alreadyLikedPageIdsSet.has(p.id)
      );
      const fullCandidatePages = [...pagesToBuff, ...backupPages];

      const initialDetails: AutoBuffResultDetail[] = pagesToBuff.map((p) => ({
        pageId: p.id,
        pageName: p.name,
        viaName: p.viaName,
        status: 'WAITING',
        message: 'Đang xếp hàng chờ...',
      }));

      setRunTiming({ start: Date.now(), end: null });
      const initLog = `[${new Date().toLocaleTimeString('vi-VN')}] 🚀 Bắt đầu chiến dịch tương tác ${targetKpi} nick cho bài viết: ${targetPostUrl.trim().slice(0, 45)}...`;
      setLiveLogs([initLog]);

      setAutoBuffProgress({
        total: targetKpi,
        success: 0,
        failed: 0,
        alreadyLiked: 0,
        percent: 0,
        currentRunningPageName: pagesToBuff[0]?.name,
        status: 'RUNNING',
        details: initialDetails,
        logs: [initLog],
      });

      // Chốt link tại thời điểm bắt đầu (người dùng có thể sửa ô link trong lúc chạy)
      const runTargetUrl = targetPostUrl.trim();
      setRunningTargetInfo({
        url: runTargetUrl,
        reaction: selectedReaction,
        count: targetKpi,
        startedAt: Date.now(),
        actorMode,
        speedMode,
      });
      // Tự động chuyển sang tab 'Tiến trình chạy' để theo dõi chi tiết
      setActiveTabKey('buff-running');
      // Làm trống ô link ở tab Tạo mới để người dùng rảnh tay dán link khác ngay lập tức
      setTargetPostUrl('');
      const runAccountName =
        selectedAccountId === 'ALL_VIAS'
          ? `Toàn bộ dàn Via (${fbAccounts.length} Via)`
          : (fbAccounts as any[]).find((a) => a.id === selectedAccountId)?.pageName || 'Via Facebook';
      const commentLines = commentListText.split('\n').map((s) => s.trim()).filter(Boolean);
      const viaGroups = groupPagesByVia(
        fullCandidatePages,
        activeCookie,
        (selectedAccountId !== 'CUSTOM' && selectedAccountId !== 'ALL_VIAS' ? currentViaAccount?.pageName : '') || 'Via Facebook'
      );

      const liveSessionId = 'live_' + Date.now();
      const controller = new AbortController();
      buffAbortRef.current = controller;

      // Bản sao cục bộ của tiến trình: updater của setState chỉ copy, không có side-effect
      const liveDetails: AutoBuffResultDetail[] = [...initialDetails];
      let finishedPagesCount = 0;
      const publish = (currentRunningPageName?: string) => {
        const counts = summarizeBuffDetails(liveDetails);
        const snapshot = [...liveDetails];
        const effectiveDone = counts.success + counts.alreadyLiked;
        setAutoBuffProgress((prev) => ({
          ...prev,
          total: targetKpi,
          success: counts.success,
          alreadyLiked: counts.alreadyLiked,
          failed: counts.failed,
          percent: Math.min(100, Math.round((effectiveDone / Math.max(1, targetKpi)) * 100)),
          currentRunningPageName,
          details: snapshot,
        }));
      };
      const patchDetail = (pageId: string, patch: Partial<AutoBuffResultDetail>) => {
        const idx = liveDetails.findIndex((d) => d.pageId === pageId);
        if (idx !== -1) {
          liveDetails[idx] = { ...liveDetails[idx], ...patch };
        } else {
          liveDetails.push({
            pageId,
            pageName: patch.pageName || 'Page Dự Phòng',
            viaName: patch.viaName,
            status: patch.status || 'RUNNING',
            likeStatus: patch.likeStatus,
            commentStatus: patch.commentStatus,
            commentText: patch.commentText,
            message: patch.message || '⚡ Tự động bù từ kho dự phòng cho đủ KPI',
            error: patch.error,
          });
        }
      };

      for (let gIdx = 0; gIdx < viaGroups.length; gIdx++) {
        if (controller.signal.aborted) break;
        const currentCounts = summarizeBuffDetails(liveDetails);
        if (currentCounts.success + currentCounts.alreadyLiked >= targetKpi) {
          console.log(`[LiveBuff] 🎯 Đã đạt đủ KPI ${currentCounts.success}/${targetKpi} like. Hoàn tất sớm!`);
          break;
        }
        const group = viaGroups[gIdx];

        // KIỂM TRA PRE-FLIGHT AUTO-FAILOVER: Nếu Via này đã bị EXPIRED cookie trước đó
        const isGroupExpired = group.pages.some((p) => p.viaStatus === 'EXPIRED');
        if (autoFailoverLiveVia && isGroupExpired) {
          console.warn(`[AutoFailover] Via [${group.viaName}] đã hết cookie! Đang tự động bù Page từ Via LIVE...`);
          publish(`🛡️ [Auto-Failover] Via [${group.viaName}] hết cookie. Đang tự động đổi sang Page từ Via Live...`);

          for (const p of group.pages) {
            patchDetail(p.id, {
              status: 'SKIPPED',
              message: `⚠️ Via [${group.viaName}] hết cookie -> Tự động chuyển sang Page dự phòng từ Via Live`,
            });
          }

          const alreadyUsedIds = new Set(liveDetails.map((d) => d.pageId));
          const availableLivePages = scannedPages.filter(
            (p) =>
              p.viaStatus !== 'EXPIRED' &&
              !alreadyUsedIds.has(p.id) &&
              !interactedPageIds.has(p.id) &&
              !alreadyLikedPagesForUrl.some((al) => al.pageId === p.id)
          );

          if (availableLivePages.length > 0) {
            const neededCount = group.pages.length;
            const replacementPages = availableLivePages.slice(0, neededCount);
            for (const rp of replacementPages) {
              liveDetails.push({
                pageId: rp.id,
                pageName: rp.name,
                viaName: rp.viaName,
                status: 'WAITING',
                message: `⚡ Tự động bù thay cho Via [${group.viaName}] hết cookie`,
              });
            }
            const failoverGroups = groupPagesByVia(replacementPages, activeCookie, 'Via Live Facebook');
            for (const fg of failoverGroups) {
              viaGroups.push(fg);
            }
            publish(undefined);
            continue;
          }
        }

        if (gIdx > 0) {
          publish(`Chuyển sang Via [${group.viaName}] (nghỉ an toàn 3s)...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (controller.signal.aborted) break;
        }

        const selectedPagesPayload = group.pages.map((p, pIdx) => ({
          id: p.id,
          name: p.name,
          isProfile: p.isProfile ?? (actorMode === 'VIAS'),
          comment: commentLines.length > 0 ? commentLines[(finishedPagesCount + pIdx) % commentLines.length] : '',
        }));
        const payload = {
          sessionId: `${liveSessionId}_g${gIdx}`,
          totalSelectedCount: targetKpi,
          kpiTarget: targetKpi,
          cookieString: group.cookieString,
          targetUrl: runTargetUrl,
          reactionType: selectedReaction,
          selectedPages: selectedPagesPayload,
          delayMs,
          speedMode,
          enableLike: engagementMode !== 'COMMENT_ONLY',
          enableComment: engagementMode !== 'LIKE_ONLY',
          enableShare,
          enableHumanBehavior,
          fastSwitch,
          cooldownEvery: antiCheckpointGuard ? (speedMode === 'TURBO' ? 40 : speedMode === 'FAST' ? 35 : 25) : 9999,
          cooldownDurationMs: speedMode === 'TURBO' ? 8000 : speedMode === 'FAST' ? 12000 : 16000,
          comments: commentLines,
          concurrency,
          dripFeedMode,
          dripDurationMinutes,
        };

        const applyFinalDetails = (details: AutoBuffResultDetail[]) => {
          for (const d of details) patchDetail(d.pageId, { ...d, viaName: group.viaName });
        };

        try {
          const result = await runBuffStream(
            payload,
            (ev) => {
              if (ev.type === 'PAGE_START') {
                patchDetail(ev.pageId || '', {
                  viaName: group.viaName,
                  status: 'RUNNING',
                  message: `[${group.viaName}] Đang mở bài và tương tác...`,
                });
                publish(`[${group.viaName}] ${ev.pageName}`);
                addLiveLog(`⚡ [${group.viaName}] Bắt đầu tương tác bằng: "${ev.pageName || ev.pageId}"`);
              } else if (ev.type === 'PAGE_FINISH') {
                finishedPagesCount++;
                patchDetail(ev.pageId || '', {
                  viaName: group.viaName,
                  status: ev.status,
                  likeStatus: ev.likeStatus,
                  commentStatus: ev.commentStatus,
                  commentText: ev.commentText,
                  message: ev.message,
                  error: ev.error,
                });
                publish(undefined);
                const icon = ev.status === 'SUCCESS' ? '✅' : (ev.status === 'ALREADY_LIKED' ? 'ℹ️' : '❌');
                addLiveLog(`${icon} [${ev.pageName}] ${ev.message || (ev.status === 'SUCCESS' ? 'Thành công' : 'Lỗi')}`);
              } else if (ev.type === 'COOLDOWN_START') {
                addLiveLog(`🛡️ [Hạ nhiệt Via] Tạm dừng ${ev.durationSec}s để bảo vệ tài khoản.`);
              } else if (ev.type === 'KPI_REACHED') {
                addLiveLog(`🎯 [Đạt KPI] Hoàn thành đủ ${ev.success}/${ev.kpiTarget} Like! Bù ${ev.autoRefilled || 0} Page lỗi.`);
              }
            },
            controller.signal
          );
          applyFinalDetails(result.details || []);
        } catch (streamErr: any) {
          const isCookieDead =
            !streamErr.receivedAny &&
            (/hết hạn|checkpoint|đăng nhập|xác minh|login/i.test(streamErr.message) ||
              /network error/i.test(streamErr.message) ||
              group.pages.some((p) => p.viaStatus === 'EXPIRED'));

          if (autoFailoverLiveVia && isCookieDead && !controller.signal.aborted) {
            console.warn(`[AutoFailover] Phát hiện Via [${group.viaName}] lỗi cookie khi đang chạy. Đang tự động bù Page từ Via LIVE...`);
            publish(`🛡️ [Auto-Failover] Via [${group.viaName}] lỗi cookie! Tự động bù ${group.pages.length} Page từ Via Live...`);

            for (const p of group.pages) {
              const current = liveDetails.find((d) => d.pageId === p.id);
              if (current && (current.status === 'WAITING' || current.status === 'RUNNING')) {
                patchDetail(p.id, {
                  status: 'SKIPPED',
                  message: `⚠️ Via [${group.viaName}] lỗi cookie -> Tự động chuyển sang Page dự phòng từ Via Live`,
                  error: undefined,
                });
              }
            }

            const alreadyUsedIds = new Set(liveDetails.map((d) => d.pageId));
            const availableLivePages = scannedPages.filter(
              (p) =>
                p.viaStatus !== 'EXPIRED' &&
                !alreadyUsedIds.has(p.id) &&
                !interactedPageIds.has(p.id) &&
                !alreadyLikedPagesForUrl.some((al) => al.pageId === p.id)
            );

            if (availableLivePages.length > 0) {
              const neededCount = group.pages.length;
              const replacementPages = availableLivePages.slice(0, neededCount);
              for (const rp of replacementPages) {
                liveDetails.push({
                  pageId: rp.id,
                  pageName: rp.name,
                  viaName: rp.viaName,
                  status: 'WAITING',
                  message: `⚡ Tự động bù thay cho Via [${group.viaName}] hết cookie`,
                });
              }
              const failoverGroups = groupPagesByVia(replacementPages, activeCookie, 'Via Live Facebook');
              for (const fg of failoverGroups) {
                viaGroups.push(fg);
              }
            }
            finishedPagesCount = liveDetails.filter((d) => d.status !== 'WAITING' && d.status !== 'RUNNING').length;
            publish(undefined);
            continue;
          }

          const canFallback = !streamErr.receivedAny && !controller.signal.aborted;
          if (canFallback) {
            // Stream chưa khởi động được (worker cũ / proxy chặn SSE) → chạy bản đồng bộ đúng 1 lần
            console.warn(`Fallback sang /api/buff-like cho nhóm ${group.viaName}:`, streamErr.message);
            try {
              const res = await axios.post(`${WORKER_BASE_URL}/api/buff-like`, payload, { signal: controller.signal });
              applyFinalDetails(res.data?.result?.details || []);
            } catch (syncErr: any) {
              const errData = syncErr.response?.data;
              if (errData?.cookieDead || /hết hạn|checkpoint|đăng nhập|xác minh/i.test(errData?.error || syncErr.message)) {
                triggerCookieExpiredAlert({
                  uid: group.cookieString.match(/(?:^|;\s*)c_user=([^;]+)/)?.[1] || '',
                  viaName: group.viaName,
                  reason: errData?.error || syncErr.message,
                  isCheckpoint: /checkpoint/i.test(errData?.error || syncErr.message),
                });
              }
              for (const p of group.pages) {
                const current = liveDetails.find((d) => d.pageId === p.id);
                if (current && (current.status === 'WAITING' || current.status === 'RUNNING')) {
                  patchDetail(p.id, { status: 'ERROR', error: syncErr.response?.data?.error || syncErr.message });
                }
              }
            }
          } else {
            const isAborted = controller.signal.aborted;
            const isConnDrop = !streamErr.receivedAny || /ngắt|kết nối|network|abort|timeout/i.test(streamErr.message);
            const statusToSet = isAborted || isConnDrop ? 'SKIPPED' : 'ERROR';
            const reason = isAborted
              ? 'Đã dừng'
              : isConnDrop
              ? 'Chưa chạy do kết nối stream gián đoạn (đã chuyển tiếp hoặc bấm Chạy tiếp)'
              : streamErr.message;
            for (const p of group.pages) {
              const current = liveDetails.find((d) => d.pageId === p.id);
              if (current && (current.status === 'WAITING' || current.status === 'RUNNING')) {
                patchDetail(p.id, {
                  status: statusToSet,
                  message: reason,
                  error: isAborted || isConnDrop ? undefined : reason,
                });
              }
            }
          }
          finishedPagesCount = liveDetails.filter((d) => d.status !== 'WAITING' && d.status !== 'RUNNING').length;
          publish(undefined);
        }
      }

      buffAbortRef.current = null;
      return { details: [...liveDetails], runTargetUrl, runAccountName, stopped: controller.signal.aborted };
    },
    onSuccess: ({ details, runTargetUrl, runAccountName, stopped }) => {
      const counts = summarizeBuffDetails(details);
      const hasAnyExecuted = details.some((d) => d.status !== 'WAITING');
      if (runTargetUrl && details.length > 0 && hasAnyExecuted) {
        const newLog: BuffLogEntry = {
          id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
          createdAt: new Date().toISOString(),
          type: 'SINGLE',
          targetUrl: runTargetUrl,
          reactionType: selectedReaction,
          totalPages: details.length,
          successCount: counts.success,
          alreadyLikedCount: counts.alreadyLiked,
          failedCount: counts.failed,
          engagementMode,
          commentCount: counts.comments,
          accountName: runAccountName,
          details,
        };
        addBuffLog(newLog);
      }

      setAutoBuffProgress((prev) => ({
        ...prev,
        total: prev.total || details.length,
        success: counts.success,
        alreadyLiked: counts.alreadyLiked,
        failed: counts.failed,
        percent: 100,
        currentRunningPageName: undefined,
        status: 'DONE',
        details,
      }));

      if (stopped) {
        message.info(`Đã dừng. ${counts.success} thành công, các Page còn lại được bỏ qua. Đã lưu vào lịch sử.`);
      } else {
        playVictoryChime();
        notification.success({
          message: '🎉 CHIẾN DỊCH BUFF HOÀN TẤT!',
          description: `Đã tương tác thành công ${counts.success}/${details.length} lượt (${Math.round((counts.success / Math.max(1, details.length)) * 100)}%). Báo cáo chi tiết đã được gửi về Telegram của bạn!`,
          duration: 9,
          placement: 'topRight',
        });
      }
    },
    onError: (err: any) => {
      buffAbortRef.current = null;
      setAutoBuffProgress((prev) => ({ ...prev, status: 'ERROR', currentRunningPageName: undefined }));
      message.error(`Lỗi hệ thống: ${err.response?.data?.error || err.message}`);
    },
  });

  const handleStopAutoBuff = () => {
    buffAbortRef.current?.abort();
    axios.post(`${WORKER_BASE_URL}/api/buff-live/stop`).catch(() => {});
    message.info('Đang dừng: worker sẽ dừng sau Page hiện tại.');
  };

  const [isResumingRemaining, setIsResumingRemaining] = useState(false);
  const handleResumeRemaining = async (customLog?: any) => {
    const targetUrl = customLog?.targetUrl || runningTargetInfo?.url || targetPostUrl;
    if (!targetUrl) return;
    const totalTarget = customLog ? (customLog.totalPages || 299) : (autoBuffProgress.total || 50);
    const doneCount = customLog ? (customLog.successCount || 0) : (autoBuffProgress.success || 0);
    const missing = Math.max(1, totalTarget - doneCount);
    try {
      setIsResumingRemaining(true);
      message.loading({ content: `Đang kích hoạt chạy tiếp ${missing} like còn thiếu...`, key: 'resume-rem' });
      await api.post('/buff-queue/add', {
        targetUrl,
        targetLikes: missing,
        reactionType: customLog?.reactionType || runningTargetInfo?.reaction || selectedReaction || 'LIKE',
        delayMinutes: 0,
        source: 'MANUAL',
      });
      message.success({ content: `Đã đưa ${missing} like vào Hàng đợi! Tiến trình đang bắt đầu chạy.`, key: 'resume-rem' });
      // Reset trạng thái form trực tiếp về IDLE để giao diện tự động kết nối và hiển thị Live Worker của Hàng Đợi
      setAutoBuffProgress({
        total: 0,
        success: 0,
        failed: 0,
        alreadyLiked: 0,
        percent: 0,
        status: 'IDLE',
        details: [],
        logs: [],
      });
      setRunningTargetInfo(null);
      setActiveTabKey('buff-running');
      queryClient.invalidateQueries();
    } catch (err: any) {
      message.error({ content: `Lỗi kích hoạt: ${err.message}`, key: 'resume-rem' });
    } finally {
      setIsResumingRemaining(false);
    }
  };

  // Mutation: Buff View
  const buffViewMutation = useMutation({
    mutationFn: async () => {
      setViewProgress({ total: targetViews, done: 0, status: 'RUNNING' });
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-view`, {
        targetUrl: targetViewUrl,
        targetViews,
        concurrency: viewConcurrency,
        watchTimeSeconds,
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success && data.result) {
        setViewProgress({ total: targetViews, done: data.result.completed, status: 'DONE' });
        message.success(`Đã buff xong ${data.result.completed}/${targetViews} Views cho video!`);
      }
    },
    onError: (err: any) => {
      setViewProgress((prev) => ({ ...prev, status: 'IDLE' }));
      message.error(`Lỗi buff View: ${err.response?.data?.error || err.message}`);
    },
  });

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ENGAGEMENT_STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved);
      if (typeof data.targetPostUrl === 'string') setTargetPostUrl(data.targetPostUrl);
      if (typeof data.selectedReaction === 'string') setSelectedReaction(data.selectedReaction);
    } catch {
      window.localStorage.removeItem(ENGAGEMENT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ENGAGEMENT_STORAGE_KEY, JSON.stringify({ targetPostUrl, selectedReaction }));
    } catch {}
  }, [targetPostUrl, selectedReaction]);

  const handleScanPages = () => {
    if (!activeCookie) {
      message.warning('Vui lòng chọn tài khoản hoặc dán Cookie trước khi quét Fanpage!');
      return;
    }
    scanPagesMutation.mutate(activeCookie);
  };

  const handleStartAutoBuff = () => {
    if (!isFacebookPostUrl(targetPostUrl)) {
      message.warning('Vui lòng nhập link bài viết Facebook hợp lệ (https://facebook.com/...).');
      return;
    }
    if (selectedPageIds.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 Fanpage.');
      return;
    }
    autoBuffMutation.mutate();
  };

  const handleStartBatchBuff = async () => {
    if (!activeCookie) {
      message.warning('Vui lòng chọn tài khoản hoặc dán Cookie Facebook trước!');
      return;
    }
    if (parsedBatchLinks.length === 0) {
      message.warning('Vui lòng dán ít nhất 1 liên kết Facebook hợp lệ vào danh sách!');
      return;
    }
    if (scannedPages.length === 0) {
      message.warning('Chưa có Fanpage nào được tải! Hãy bấm "Quét lại danh sách Fanpage" trước.');
      return;
    }

    const rawPages =
      selectedPageIds.length > 0
        ? scannedPages.filter((p) => selectedPageIdsSet.has(p.id))
        : scannedPages;

    const liveAvailablePages = rawPages.filter((p) => p.viaStatus !== 'EXPIRED');
    const availablePages =
      autoFailoverLiveVia && liveAvailablePages.length > 0 ? liveAvailablePages : rawPages;

    if (availablePages.length === 0) {
      message.warning('Vui lòng chọn ít nhất 1 Fanpage để thả like!');
      return;
    }

    if (actorMode === 'VIAS' && batchLikesPerOrder > availablePages.length) {
      message.error(
        `Bạn đang chọn Dàn Nick cá nhân (${availablePages.length} Via) nên mỗi bài chỉ buff được tối đa ${availablePages.length} like (1 nick cá nhân chỉ like được 1 lần). Vui lòng bấm chọn "Page" (Dàn Fanpage vệ tinh) ở Bước 2 để buff đủ ${batchLikesPerOrder} like!`
      );
      return;
    }

    const targetLikes = Math.min(batchLikesPerOrder, availablePages.length);

    const initialOrders: BatchOrder[] = parsedBatchLinks.map((url, idx) => ({
      id: idx + 1,
      url,
      orderNumber: idx + 1,
      status: 'PENDING',
      successLikes: 0,
      totalLikesTarget: targetLikes,
      percent: 0,
      details: availablePages.slice(0, targetLikes).map((p) => ({
        pageId: p.id,
        pageName: p.name,
        status: 'WAITING',
        message: 'Chờ đến lượt bài viết...',
      })),
    }));

    const commentLines = commentListText.split('\n').map((s) => s.trim()).filter(Boolean);
    const batchAccountName =
      selectedAccountId === 'ALL_VIAS'
        ? `Toàn bộ dàn Via (${fbAccounts.length} Via)`
        : (fbAccounts as any[]).find((a) => a.id === selectedAccountId)?.pageName || 'Via Facebook';

    const batchStartTime = Date.now();
    setRunTiming({ start: batchStartTime, end: null });
    setBatchOrders(initialOrders);
    setIsBatchRunning(true);
    setIsBatchPaused(false);
    batchAbortRef.current = false;
    batchPauseRef.current = false;
    setActiveTabKey('buff-running');

    const batchLiveId = 'batch_' + Date.now();
    const allViaGroups = groupPagesByVia(availablePages, activeCookie, batchAccountName);

    // Thuật toán xoay vòng nhóm Via cho từng order:
    // Khi chạy song song 2 link, Order 0 ưu tiên Via Group 0, Order 1 ưu tiên Via Group 1...
    // Nhờ vậy 2 link nạp 2 cookie Via mẹ khác nhau -> không bị nghẽn withBuffLane và không xung đột session!
    const getViaGroupsForOrder = (orderIdx: number) => {
      if (allViaGroups.length <= 1) return allViaGroups;
      const offset = orderIdx % allViaGroups.length;
      return [...allViaGroups.slice(offset), ...allViaGroups.slice(0, offset)];
    };

    const executeSingleOrder = async (i: number, assignedViaGroups: ViaGroup[]) => {
      if (batchAbortRef.current) return;

      while (batchPauseRef.current) {
        if (batchAbortRef.current) return;
        await new Promise((r) => setTimeout(r, 600));
      }
      if (batchAbortRef.current) return;

      setBatchOrders((prev) =>
        prev.map((o, idx) => (idx === i ? { ...o, status: 'RUNNING' } : o))
      );

      const orderUrl = initialOrders[i].url;
      const orderDetails: AutoBuffResultDetail[] = [...(initialOrders[i].details || [])];
      const patchOrderDetail = (pageId: string, patch: Partial<AutoBuffResultDetail>) => {
        const dIdx = orderDetails.findIndex((d) => d.pageId === pageId);
        if (dIdx !== -1) {
          orderDetails[dIdx] = { ...orderDetails[dIdx], ...patch };
        } else {
          orderDetails.push({
            pageId,
            pageName: patch.pageName || 'Page Dự Phòng',
            viaName: patch.viaName,
            status: patch.status || 'RUNNING',
            likeStatus: patch.likeStatus,
            commentStatus: patch.commentStatus,
            commentText: patch.commentText,
            message: patch.message || '⚡ Tự động bù từ kho dự phòng cho đủ KPI',
            error: patch.error,
          });
        }
      };

      const publishOrder = (patch: Partial<BatchOrder>) => {
        const snapshot = [...orderDetails];
        const successLikes = snapshot.filter((d) => d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED').length;
        setBatchOrders((prev) =>
          prev.map((o, idx) =>
            idx === i
              ? {
                  ...o,
                  successLikes,
                  percent: Math.min(100, Math.round((successLikes / Math.max(1, targetLikes)) * 100)),
                  details: snapshot,
                  ...patch,
                }
              : o
          )
        );
      };

      const controller = new AbortController();
      batchStreamAbortControllersRef.current.add(controller);
      let orderError = '';

      for (let gIdx = 0; gIdx < assignedViaGroups.length; gIdx++) {
        if (controller.signal.aborted || batchAbortRef.current) break;
        const currentSuccess = orderDetails.filter((d) => d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED').length;
        if (currentSuccess >= targetLikes) {
          console.log(`[BatchBuff] 🎯 Order ${i + 1} đã đạt đủ KPI ${currentSuccess}/${targetLikes} like. Hoàn tất sớm!`);
          break;
        }
        const group = assignedViaGroups[gIdx];
        if (gIdx > 0) await new Promise((r) => setTimeout(r, 2000));

        try {
          const result = await runBuffStream(
            {
              sessionId: `${batchLiveId}_o${i}_g${gIdx}`,
              cookieString: group.cookieString,
              targetUrl: orderUrl,
              reactionType: selectedReaction,
              kpiTarget: targetLikes,
              totalSelectedCount: targetLikes,
              autoReplenish: true,
              selectedPages: group.pages.map((p, pIdx) => ({
                id: p.id,
                name: p.name,
                isProfile: p.isProfile ?? (actorMode === 'VIAS'),
                comment: commentLines.length > 0 ? commentLines[pIdx % commentLines.length] : '',
              })),
              delayMs,
              speedMode,
              enableLike: engagementMode !== 'COMMENT_ONLY',
              enableComment: engagementMode !== 'LIKE_ONLY',
              enableShare,
              enableHumanBehavior,
              fastSwitch,
              cooldownEvery: antiCheckpointGuard ? (speedMode === 'TURBO' ? 40 : speedMode === 'FAST' ? 35 : 25) : 9999,
              cooldownDurationMs: speedMode === 'TURBO' ? 8000 : speedMode === 'FAST' ? 12000 : 16000,
              comments: commentLines,
              concurrency,
              dripFeedMode,
              dripDurationMinutes,
            },
            (ev) => {
              if (ev.type === 'PAGE_START') {
                patchOrderDetail(ev.pageId, { viaName: group.viaName, status: 'RUNNING', message: `[${group.viaName}] Đang mở bài và tương tác...` });
                publishOrder({ currentRunningPageName: ev.pageName });
              } else if (ev.type === 'PAGE_FINISH') {
                patchOrderDetail(ev.pageId, {
                  viaName: group.viaName,
                  status: ev.status,
                  likeStatus: ev.likeStatus,
                  commentStatus: ev.commentStatus,
                  commentText: ev.commentText,
                  message: ev.message,
                  error: ev.error,
                });
                publishOrder({});
              }
            },
            controller.signal
          );
          for (const d of result.details || []) patchOrderDetail(d.pageId, { ...d, viaName: group.viaName });
        } catch (err: any) {
          const stopped = controller.signal.aborted || batchAbortRef.current;
          orderError = stopped ? 'Đã dừng' : err.message;
          for (const p of group.pages) {
            const current = orderDetails.find((d) => d.pageId === p.id);
            if (current && (current.status === 'WAITING' || current.status === 'RUNNING')) {
              patchOrderDetail(p.id, { status: stopped ? 'SKIPPED' : 'ERROR', message: orderError, error: stopped ? undefined : orderError });
            }
          }
          if (stopped) break;
        }
      }

      batchStreamAbortControllersRef.current.delete(controller);

      const counts = summarizeBuffDetails(orderDetails);
      const wasStopped = controller.signal.aborted || batchAbortRef.current;
      const isTargetReached = counts.success >= targetLikes;
      const finalStatus: BatchOrder['status'] = wasStopped
        ? 'PAUSED'
        : isTargetReached
        ? 'COMPLETED'
        : counts.success + counts.alreadyLiked + counts.unverified > 0
        ? 'PARTIAL'
        : 'FAILED';

      const actualOrderPercent = Math.min(100, Math.round((counts.success / Math.max(1, targetLikes)) * 100));

      publishOrder({
        status: finalStatus,
        percent: isTargetReached ? 100 : actualOrderPercent,
        currentRunningPageName: undefined,
        ...(finalStatus === 'FAILED' ? { error: orderError || 'Không có Page nào tương tác thành công' } : {}),
      });

      if (orderDetails.some((d) => d.status !== 'WAITING')) {
        const newBatchLog: BuffLogEntry = {
          id: 'log_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substring(2, 9),
          createdAt: new Date().toISOString(),
          type: 'BATCH',
          targetUrl: orderUrl,
          reactionType: selectedReaction,
          totalPages: orderDetails.length,
          successCount: counts.success,
          alreadyLikedCount: counts.alreadyLiked,
          failedCount: counts.failed,
          engagementMode,
          commentCount: counts.comments,
          accountName: batchAccountName,
          details: [...orderDetails],
        };
        addBuffLog(newBatchLog);
      }
    };

    // POOL THỰC THI ĐA LUỒNG (1 HOẶC 2 LINK SONG SONG):
    const parallelWorkersCount = Math.max(1, Math.min(batchLinkConcurrency, initialOrders.length));
    let nextOrderIdx = 0;

    const workers = Array.from({ length: parallelWorkersCount }, async () => {
      while (nextOrderIdx < initialOrders.length && !batchAbortRef.current) {
        const currentIdx = nextOrderIdx++;
        await executeSingleOrder(currentIdx, getViaGroupsForOrder(currentIdx));
        if (batchWaitSeconds > 0 && nextOrderIdx < initialOrders.length && !batchAbortRef.current) {
          await new Promise((r) => setTimeout(r, batchWaitSeconds * 1000));
        }
      }
    });

    await Promise.all(workers);

    const batchEndTime = Date.now();
    setRunTiming((t) => ({ start: t.start || batchStartTime, end: batchEndTime }));
    setIsBatchRunning(false);
    setIsBatchPaused(false);
    if (batchAbortRef.current) {
      message.info('Đã dừng tiến trình chạy nhiều link.');
    } else {
      playVictoryChime();
      notification.success({
        message: '🎉 HOÀN TẤT CHẠY TẤT CẢ LIÊN KẾT!',
        description: `Đã chạy xong toàn bộ ${initialOrders.length} bài viết trong danh sách (${parallelWorkersCount > 1 ? 'Chế độ song song 2 link' : 'Chế độ tuần tự'}). Báo cáo chi tiết đã lưu vào lịch sử và gửi về Telegram!`,
        duration: 10,
        placement: 'topRight',
      });
    }
  };

  const handlePauseBatchBuff = () => {
    if (isBatchPaused) {
      batchPauseRef.current = false;
      setIsBatchPaused(false);
      message.info('Tiếp tục chạy...');
    } else {
      batchPauseRef.current = true;
      setIsBatchPaused(true);
      message.warning('Sẽ tạm dừng sau khi xong bài hiện tại.');
    }
  };

  const handleStopBatchBuff = () => {
    batchAbortRef.current = true;
    batchPauseRef.current = false;
    batchStreamAbortControllersRef.current.forEach((c) => c.abort());
    batchStreamAbortControllersRef.current.clear();
    setIsBatchPaused(false);
    setBatchOrders((prev) => prev.map((o) => (o.status === 'PENDING' ? { ...o, status: 'PAUSED' } : o)));
    axios.post(`${WORKER_BASE_URL}/api/buff-live/stop`).catch(() => {});
    message.info('Đang dừng: worker sẽ dừng sau Page hiện tại.');
  };

  const handleRefillSingleOrder = (order: BatchOrder) => {
    const missing = Math.max(0, order.totalLikesTarget - (order.successLikes || 0));
    if (missing <= 0) {
      message.info('Bài viết này đã đạt đủ mục tiêu Like!');
      return;
    }
    setBuffMode('SINGLE');
    setTargetPostUrl(order.url);
    setSelectedAccountId('ALL_VIAS');
    handleSelectRandomPages(missing);
    setActiveTabKey('buff-stream');
    message.success(`⚡ Đã chuyển sang chế độ Tương Tác Trực Tiếp và chọn sẵn ${missing} Fanpage từ kho LIVE để bù like! Bấm "Bắt đầu tương tác" để chạy.`);
  };

  const handleRefillBatchIncomplete = () => {
    const incompleteOrders = batchOrders.filter(
      (o) => (o.successLikes || 0) < o.totalLikesTarget
    );
    if (incompleteOrders.length === 0) {
      message.success('Tất cả các bài trong Batch đều đã đạt 100% KPI!');
      return;
    }
    const lines = incompleteOrders.map((o) => o.url).join('\n');
    const maxMissing = Math.max(...incompleteOrders.map((o) => o.totalLikesTarget - (o.successLikes || 0)));
    setBuffMode('BATCH');
    setBatchLinksText(lines);
    setBatchLikesPerOrder(maxMissing);
    setSelectedAccountId('ALL_VIAS');
    setActiveTabKey('buff-like');
    message.success(`⚡ Đã tải ${incompleteOrders.length} bài viết còn thiếu vào danh sách Batch với chế độ Gộp Toàn Bộ Via (${fbAccounts.length} Via)! Bấm "Bắt đầu tương tác" để chạy nốt.`);
  };

  // Quick Action Presets
  const handleQuickPresetLike24 = () => {
    setBuffMode('SINGLE');
    setEngagementMode('LIKE_ONLY');
    setSelectedReaction('LIKE');
    setActorMode('FANPAGES');
    setSelectedAccountId('ALL_VIAS');
    setSelectedPageIds(scannedPages.map((p) => p.id));
    message.success(`Đã kích hoạt Preset: Thả Like toàn bộ ${scannedPages.length} Fanpage!`);
  };

  const handleQuickPresetAiSeeding = async () => {
    setBuffMode('SINGLE');
    setEngagementMode('LIKE_AND_COMMENT');
    setSelectedReaction('RANDOM_POSITIVE');
    setActorMode('FANPAGES');
    setSelectedAccountId('ALL_VIAS');
    setSelectedPageIds(scannedPages.map((p) => p.id));
    if (targetPostUrl.trim()) {
      handleGenerateAiComments();
    } else {
      message.info('Đã bật chế độ Seeding (Like + Bình Luận AI). Vui lòng dán link bài viết để AI đọc nội dung!');
    }
  };

  const handleQuickPresetVias = () => {
    setBuffMode('SINGLE');
    setActorMode('VIAS');
    setSelectedAccountId('ALL_VIAS');
    message.success(`Đã chuyển sang Dàn ${fbAccounts.length} Via cá nhân!`);
  };

  // Kiểm tra xem hiện tại có bất kỳ tác vụ buff nào đang chạy không (0 bài thì làm mờ nút)
  const isAnyBuffRunning = Boolean(
    autoBuffMutation.isPending ||
    autoBuffProgress?.status === 'RUNNING' ||
    isBatchRunning ||
    queueItems.some((it) => it.status === 'RUNNING') ||
    (bmOverview?.stats?.runningCount || 0) > 0
  );

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto px-2 sm:px-4 md:px-6 pb-28 md:pb-12">
      {/* THANH TRẠNG THÁI DÀN VIA */}
      <div className="app-surface p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-100 text-sm sm:text-base">Dàn Via & Fanpage</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 mt-1.5">
            <span className="inline-flex items-center gap-1.5">
              Via:
              <span className="font-semibold text-emerald-400">{bmOverview?.liveVias ?? fbAccounts.length} hoạt động</span>
              {bmOverview?.deadVias > 0 && (
                <span className="font-semibold text-rose-400">· {bmOverview.deadVias} lỗi</span>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5">
              Fanpage: <strong className="text-slate-200 font-semibold">{scannedPages.length}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              Đã chống trùng: <strong className="text-slate-200 font-semibold">{bmOverview?.antiOverlap?.totalProtectedInteractions || 0}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              Telegram:
              <span className={bmOverview?.system?.telegramConfigured ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                {bmOverview?.system?.telegramConfigured ? 'Đã kết nối' : 'Chưa cấu hình'}
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button
            onClick={() => {
              fetchSettings();
              setActiveTabKey('system-settings');
            }}
          >
            Cài đặt
          </Button>
          <Button loading={checkingViaHealth} onClick={handleRunViaHealthCheck}>
            Kiểm tra Via
          </Button>
          {bmOverview?.system?.isEmergencyStopped ? (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleResumeSystem}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md shadow-emerald-600/30"
            >
              Khôi phục hoạt động
            </Button>
          ) : isAnyBuffRunning ? (
            <Tooltip title="Đang có bài buff chạy! Bấm để lập tức ngắt tiến trình nhằm bảo vệ tài khoản">
              <Button
                danger
                type="primary"
                icon={<StopOutlined />}
                onClick={handleEmergencyStop}
                className="bg-rose-600 hover:bg-rose-500 text-white font-bold animate-pulse shadow-lg shadow-rose-600/40"
              >
                Dừng khẩn cấp
              </Button>
            </Tooltip>
          ) : (
            <Tooltip title="Hiện không có tác vụ nào đang chạy (0 bài). Nút sẽ tự động bật sáng khi có bài bắt đầu buff để tránh bấm nhầm!">
              <Button
                disabled
                icon={<StopOutlined />}
                className="opacity-40 cursor-not-allowed border-slate-700 text-slate-500 bg-slate-900/40"
              >
                Dừng khẩn cấp
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* CẢNH BÁO VIA HẾT HẠN COOKIE / CHECKPOINT */}
      {deadViaList.length > 0 && (
        <div className="px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <div className="text-amber-200 font-medium">
              {deadViaList.length} Via cần cập nhật Cookie
            </div>
            <div className="text-xs text-amber-200/70 mt-0.5 truncate">
              {deadViaList
                .map((v) => `${v.viaName || v.uid} (${v.tokenStatus === 'CHECKPOINT' ? 'checkpoint' : 'hết hạn'})`)
                .join(' · ')}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="small" loading={checkingViaHealth} onClick={handleRunViaHealthCheck}>
              Kiểm tra lại
            </Button>
            <Button
              size="small"
              type="primary"
              danger
              icon={<ThunderboltOutlined />}
              onClick={() => openCookieAlertModal(deadViaList[0]?.uid)}
              className="font-semibold shadow-sm"
            >
              Cập nhật Cookie ngay
            </Button>
          </div>
        </div>
      )}

      {/* BANNER CẢNH BÁO NẾU HỆ THỐNG ĐANG DỪNG KHẨN CẤP */}
      {bmOverview?.system?.isEmergencyStopped && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 flex items-center justify-between text-xs gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <StopOutlined className="text-rose-400 text-base shrink-0" />
            <div>
              <strong className="text-rose-200 text-xs font-semibold uppercase tracking-wider">Hệ thống đang dừng khẩn cấp (Emergency Stop)</strong>
              <div className="text-rose-300/80 text-[11px] mt-0.5">
                Toàn bộ hàng đợi tự động và tác vụ Playwright đang tạm dừng an toàn ({bmOverview?.system?.emergencyReason || 'Bởi Quản trị viên'}).
              </div>
            </div>
          </div>
          <Button
            size="small"
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleResumeSystem}
            className="bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold shrink-0 rounded-lg"
          >
            Khôi phục ngay
          </Button>
        </div>
      )}

      {/* Chuyển nhanh: Tạo mới / Tiến trình chạy / Hàng đợi / Lịch sử / Săn bài tự động (cùng một trang) */}
      {(activeTabKey === 'buff-like' || activeTabKey === 'buff-running' || activeTabKey === 'buff-queue' || activeTabKey === 'buff-history' || activeTabKey === 'buff-hunter') && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-800/80">
          <div role="tablist" className="flex items-center gap-1 -mb-px">
            {[
              { key: 'buff-like', label: 'Tạo mới', count: 0 },
              {
                key: 'buff-running',
                label: '⚡ Tiến trình chạy',
                count: (autoBuffProgress.status === 'RUNNING' || isBatchRunning || queueItems.some((i) => i.status === 'RUNNING')) ? 1 : 0,
                isPulse: (autoBuffProgress.status === 'RUNNING' || isBatchRunning || queueItems.some((i) => i.status === 'RUNNING')),
              },
              { key: 'buff-queue', label: 'Hàng đợi', count: queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length },
              { key: 'buff-history', label: 'Lịch sử', count: buffLogs.length },
              { key: 'buff-hunter', label: '🎯 Săn bài tự động (VIP Like)', count: monitors.length },
            ].map((t) => {
              const active = activeTabKey === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTabKey(t.key)}
                  className={`px-4 py-2.5 text-sm border-b-2 transition-colors cursor-pointer bg-transparent flex items-center gap-1.5 ${
                    active
                      ? 'border-blue-500 text-slate-100 font-semibold'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                  {t.isPulse && (
                    <span className="relative flex h-2 w-2 ml-0.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </span>
                  )}
                  {t.count > 0 && !t.isPulse && (
                    <span
                      className={`ml-2 px-1.5 rounded-md text-xs tabular-nums ${
                        active ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Tabs
        activeKey={activeTabKey}
        onChange={(k) => setActiveTabKey(k)}
        renderTabBar={() => null}
        animated={false}
        destroyOnHidden={false}
        tabBarExtraContent={<span className="text-xs text-slate-400">{fbAccounts.length} nick · {scannedPages.length} Page</span>}
        items={[
          {
            key: 'buff-like',
            label: 'Like & bình luận',
            children: (
              <div className="space-y-5">
                <Row gutter={[20, 20]} align="top">
                  {/* CỘT TRÁI: 1. Bài viết → 2. Tương tác → 3. Tài khoản */}
                  <Col xs={24} lg={15}>
                    <div className="space-y-4">
                      {/* TOP HERO COMMAND BAR: DÁN LINK & QUICK PRESETS */}
                      <div className="app-surface p-5 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                          <div className="flex items-center gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-semibold flex items-center justify-center text-xs shrink-0">
                                  1
                                </span>
                                <span className="text-sm sm:text-base font-semibold text-slate-100">
                                  Bài viết
                                </span>
                                {targetPostUrl && (
                                  <span className="text-xs text-slate-400">
                                    {targetPostUrl.includes('/groups/')
                                      ? 'Nhóm Facebook'
                                      : targetPostUrl.includes('/reel')
                                      ? 'Video Reels'
                                      : 'Bài Viết'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <Segmented
                            size="middle"
                            value={buffMode}
                            onChange={(val) => setBuffMode(val as 'SINGLE' | 'BATCH')}
                            options={[
                              { label: '1 link', value: 'SINGLE' },
                              { label: 'Nhiều link', value: 'BATCH' },
                            ]}
                          />
                        </div>

                        {/* Input link hoặc danh sách link */}
                        {buffMode === 'SINGLE' ? (
                          <div>
                            <PasteLinkInput
                              value={targetPostUrl}
                              onChange={(val) => setTargetPostUrl(val)}
                              placeholder="Dán link bài viết Facebook (Group, Fanpage, Profile, Reels)"
                            />

                            {/* Cảnh báo nếu đã từng like bài viết này */}
                            {alreadyLikedPagesForUrl.length > 0 && (
                              <div className="mt-3 p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
                                <span className="text-amber-300 font-semibold flex items-center gap-2">
                                  <InfoCircleOutlined className="text-amber-400 text-sm" />
                                  <span>Đã có <b>{alreadyLikedPagesForUrl.length} Page/Via</b> từng tương tác link này trước đó trong lịch sử</span>
                                </span>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => {
                                    const alreadyIds = alreadyLikedPagesForUrl.map((p) => p.pageId);
                                    setSelectedPageIds((prev) => prev.filter((id) => !alreadyIds.includes(id)));
                                    message.success(`Đã tự động bỏ chọn ${alreadyIds.length} tài khoản đã tương tác trước!`);
                                  }}
                                  className="text-xs p-0 h-auto text-amber-400 font-bold hover:underline shrink-0"
                                >
                                  Bỏ chọn {alreadyLikedPagesForUrl.length} tài khoản này
                                </Button>
                              </div>
                            )}

                            {/* Thanh Chọn Nhanh Số Lượng Like Ngay Dưới Ô Nhập Link (Không cần cuộn chuột) */}
                            {scannedPages.length > 0 && (
                              <div className="mt-3 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                                    <ThunderboltFilled className="text-amber-400" /> Mục tiêu Like:
                                  </span>
                                  <span className="text-[11px] text-cyan-400 font-mono font-bold">
                                    {selectedPageIds.length > 0 ? `${selectedPageIds.length} Like` : 'Chưa chọn'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {[30, 50, 100, 200, 300]
                                    .filter((n) => n <= scannedPages.length)
                                    .map((num) => {
                                      const isSelected = selectedPageIds.length === num;
                                      return (
                                        <button
                                          key={num}
                                          type="button"
                                          onClick={() => handleSelectRandomPages(num)}
                                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                                            isSelected
                                              ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'
                                              : 'bg-slate-900 text-slate-300 border-slate-700/80 hover:border-blue-400 hover:text-white'
                                          }`}
                                        >
                                          {num} Like
                                        </button>
                                      );
                                    })}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedPageIds(scannedPages.map((p) => p.id));
                                      message.success(`Đã chọn toàn bộ ${scannedPages.length} Fanpage!`);
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                                      selectedPageIds.length === scannedPages.length && scannedPages.length > 0
                                        ? 'bg-cyan-600 text-white border-cyan-500 shadow-md'
                                        : 'bg-cyan-950/60 text-cyan-300 border-cyan-800/80 hover:border-cyan-400'
                                    }`}
                                  >
                                    👑 Tất cả ({scannedPages.length})
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-slate-200">
                                Danh sách link Facebook (Mỗi dòng một link):
                              </span>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono px-2.5 py-0.5 rounded-md bg-blue-950/90 border border-blue-700/70 text-blue-300 font-bold">
                                  {parsedBatchLinks.length} link hợp lệ
                                </span>
                                {invalidBatchLinesCount > 0 && (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-amber-950/90 border border-amber-700/70 text-amber-300 font-semibold" title="Có dòng không nhận diện được định dạng Facebook hợp lệ">
                                    ⚠️ {invalidBatchLinesCount} dòng lỗi/bỏ qua
                                  </span>
                                )}
                                {batchLinksText && (
                                  <Button
                                    type="link"
                                    size="small"
                                    danger
                                    onClick={() => setBatchLinksText('')}
                                    className="text-xs p-0 h-auto font-semibold"
                                  >
                                    Xóa hết
                                  </Button>
                                )}
                              </div>
                            </div>
                            <Input.TextArea
                              rows={4}
                              value={batchLinksText}
                              onChange={(e) => setBatchLinksText(e.target.value)}
                              placeholder={`https://www.facebook.com/groups/123456/posts/7891011/\nfacebook.com/share/p/1CmWWe4m7g/\nhttps://www.facebook.com/share/p/19ivmH7zUw/`}
                              className="font-mono text-xs bg-slate-950 text-slate-100 border-slate-700 rounded-xl placeholder:text-slate-500 focus:border-blue-400"
                            />

                            {/* Bộ chọn luồng chạy Song Song vs Tuần Tự */}
                            <div className="mt-2.5 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm">
                              <div>
                                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                                  <ThunderboltFilled className="text-cyan-400" /> Luồng thực thi liên kết:
                                </span>
                                <span className="text-[10px] text-slate-400 block mt-0.5">
                                  {batchLinkConcurrency === 2
                                    ? '⚡ Chạy song song 2 link cùng lúc (Tự động xoay vòng phân tách dàn Via mẹ tránh nghẽn)'
                                    : '🛡️ Chạy tuần tự từng link (Xong link 1 mới bắt đầu link 2, an toàn tối đa)'}
                                </span>
                              </div>
                              <Segmented
                                size="small"
                                value={batchLinkConcurrency}
                                onChange={(val) => setBatchLinkConcurrency(Number(val))}
                                options={[
                                  { label: '🛡️ Tuần tự (1 link)', value: 1 },
                                  { label: '⚡ Song song (2 link)', value: 2 },
                                ]}
                                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs shrink-0"
                              />
                            </div>

                            {/* Chọn & Nhập Số Lượng Like Mỗi Bài trong Batch */}
                            <div className="mt-2.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5 shadow-sm">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div>
                                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                                    <ThunderboltFilled className="text-amber-400" /> Mục tiêu Like mỗi bài:
                                  </span>
                                  <span className="text-[10px] text-slate-400 block mt-0.5">
                                    Nhập số Like mong muốn cho từng bài viết trong danh sách
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <InputNumber
                                    min={1}
                                    max={Math.max(1, scannedPages.length || 1000)}
                                    value={batchLikesPerOrder}
                                    onChange={(val) => setBatchLikesPerOrder(Number(val) || 1)}
                                    className="w-28 text-center font-mono font-bold bg-slate-900 border-slate-700 text-cyan-300"
                                    addonAfter="Like"
                                  />
                                </div>
                              </div>

                              {/* Nút chọn nhanh */}
                              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-800/60">
                                <span className="text-[11px] text-slate-400 font-medium mr-1">Gợi ý nhanh:</span>
                                {[10, 20, 50, 100, 200].map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => {
                                      setBatchLikesPerOrder(n);
                                      if (n > fbAccounts.length && actorMode === 'VIAS') {
                                        setActorMode('FANPAGES');
                                        message.info(`Đã tự động chuyển sang Dàn Fanpage vệ tinh để có đủ ${n} like!`);
                                      }
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                                      batchLikesPerOrder === n
                                        ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                                        : 'bg-slate-900 text-slate-300 border-slate-700/80 hover:border-blue-400'
                                    }`}
                                  >
                                    {n} Like
                                  </button>
                                ))}
                                {scannedPages.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setBatchLikesPerOrder(scannedPages.length)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                                      batchLikesPerOrder === scannedPages.length
                                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                                        : 'bg-slate-900 text-emerald-300 border-emerald-800/60 hover:border-emerald-400'
                                    }`}
                                  >
                                    Tối đa ({scannedPages.length})
                                  </button>
                                )}
                              </div>

                              {/* Cảnh báo nếu đang ở chế độ Nick cá nhân mà chỉ có 3 Via */}
                              {actorMode === 'VIAS' && (
                                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-1">
                                  <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
                                    <span>⚠️ Đang ở <b>Nick cá nhân ({fbAccounts.length} Via)</b>: Chỉ tối đa {fbAccounts.length} like/bài (1 nick chỉ like được 1 lần).</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActorMode('FANPAGES');
                                      message.success('Đã chuyển sang Dàn Fanpage vệ tinh! Bạn có thể buff 100+ like mỗi bài.');
                                    }}
                                    className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer shrink-0 border-none transition-all shadow-sm"
                                  >
                                    👉 Bấm để chuyển sang Dàn Fanpage (634 Page)
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* 3 CẤU HÌNH NHANH (SMART PRESET TOOLBAR) */}
                        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
                            <ThunderboltFilled className="text-amber-400" /> Cấu hình nhanh:
                          </span>
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={handleQuickPresetLike24}
                              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-950/60 to-slate-900 hover:from-blue-900/60 hover:to-slate-800 border border-blue-500/30 hover:border-blue-400 text-blue-200 text-xs font-semibold transition-all cursor-pointer shadow-sm hover:shadow-blue-500/10 active:scale-[0.98] flex items-center gap-1.5"
                            >
                              <ThunderboltFilled className="text-blue-400" />
                              <span>Toàn bộ Page ({scannedPages.length})</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleQuickPresetAiSeeding}
                              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-950/60 to-slate-900 hover:from-purple-900/60 hover:to-slate-800 border border-purple-500/30 hover:border-purple-400 text-purple-200 text-xs font-semibold transition-all cursor-pointer shadow-sm hover:shadow-purple-500/10 active:scale-[0.98] flex items-center gap-1.5"
                            >
                              <RobotOutlined className="text-purple-400" />
                              <span>Like + Bình luận AI</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleQuickPresetVias}
                              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-950/60 to-slate-900 hover:from-emerald-900/60 hover:to-slate-800 border border-emerald-500/30 hover:border-emerald-400 text-emerald-200 text-xs font-semibold transition-all cursor-pointer shadow-sm hover:shadow-emerald-500/10 active:scale-[0.98] flex items-center gap-1.5"
                            >
                              <UserOutlined className="text-emerald-400" />
                              <span>Nick cá nhân ({fbAccounts.length})</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* BẢNG CẤU HÌNH TINH CHỈNH TƯƠNG TÁC */}
                      <div className="p-4 sm:p-5 app-surface space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                          <span className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-semibold flex items-center justify-center text-xs shrink-0">
                              2
                            </span>
                            <span className="text-sm sm:text-base font-semibold text-slate-100">Tương tác</span>
                          </span>
                        </div>

                        {/* 1. Hình thức tương tác: Combo / Like / Comment */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Hình thức tương tác:
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() => setEngagementMode('LIKE_ONLY')}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                engagementMode === 'LIKE_ONLY'
                                  ? 'border-blue-500 bg-blue-600/30 text-white font-bold shadow-md shadow-blue-500/20'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                              }`}
                            >
                              <span className="text-base">👍</span>
                              <span className="text-xs font-bold">Chỉ Thả Like/Tim</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEngagementMode('LIKE_AND_COMMENT')}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                engagementMode === 'LIKE_AND_COMMENT'
                                  ? 'border-blue-500 bg-blue-600/30 text-white font-bold shadow-md shadow-blue-500/20'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                              }`}
                            >
                              <span className="text-base">💬</span>
                              <span className="text-xs font-bold">Like + Bình luận</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEngagementMode('COMMENT_ONLY')}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                engagementMode === 'COMMENT_ONLY'
                                  ? 'border-blue-500 bg-blue-600/30 text-white font-bold shadow-md shadow-blue-500/20'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                              }`}
                            >
                              <span className="text-base">✍️</span>
                              <span className="text-xs font-bold">Chỉ Bình luận</span>
                            </button>
                          </div>
                        </div>

                        {/* Tùy chọn Buff Share (Chia sẻ lên tường Fanpage) */}
                        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 transition-all flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-base shadow-sm shadow-emerald-500/10">
                              <ShareAltOutlined />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-200">Chia sẻ bài viết lên tường Fanpage (Buff Share)</span>
                                <Tag color="green" className="m-0 text-[10px] font-bold border-0 px-1.5 py-0 rounded">MỚI • VIRAL</Tag>
                              </div>
                              <p className="text-[11px] text-slate-400 m-0 mt-0.5">Fanpage tự động bấm Chia sẻ ngay về dòng thời gian, kéo reach và tương tác chéo cực mạnh</p>
                            </div>
                          </div>
                          <Switch checked={enableShare} onChange={setEnableShare} />
                        </div>

                        {/* 2. Reaction Picker: 7 Cảm xúc Facebook + 2 Thẻ Trộn Tự Nhiên */}
                        {engagementMode !== 'COMMENT_ONLY' && (
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                                <span>Cảm xúc tăng (Reaction):</span>
                              </label>
                              <Tag color="cyan" className="m-0 text-[11px] font-semibold rounded-md border-0 px-2 py-0.5">
                                Đang chọn:{' '}
                                {(() => {
                                  const cur = REACTIONS.find((r) => r.key === selectedReaction);
                                  return cur ? `${cur.emoji} ${cur.shortLabel}` : selectedReaction;
                                })()}
                              </Tag>
                            </div>

                            {/* Hàng 1: 7 Cảm xúc chuẩn Facebook */}
                            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                              {REACTIONS.filter((r) => !r.isRandom).map((r) => {
                                const isSelected = selectedReaction === r.key;
                                return (
                                  <button
                                    key={r.key}
                                    type="button"
                                    onClick={() => setSelectedReaction(r.key)}
                                    className={`py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer border active:scale-[0.95] hover:scale-[1.02] ${
                                      isSelected
                                        ? 'bg-blue-600/30 border-blue-500 text-white shadow-md shadow-blue-500/20'
                                        : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                                    }`}
                                    title={r.label}
                                  >
                                    <span className="text-2xl leading-none">{r.emoji}</span>
                                    <span className="text-[10px] sm:text-[11px] font-semibold">{r.shortLabel}</span>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Hàng 2: 2 Chế độ Trộn Cảm Xúc Thông Minh (Chống quét & Tự nhiên nhất) */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {REACTIONS.filter((r) => r.isRandom).map((r) => {
                                const isSelected = selectedReaction === r.key;
                                return (
                                  <button
                                    key={r.key}
                                    type="button"
                                    onClick={() => setSelectedReaction(r.key)}
                                    className={`p-2.5 rounded-xl flex items-center gap-2.5 transition-all cursor-pointer border text-left ${
                                      isSelected
                                        ? 'bg-purple-950/40 border-purple-500 text-white shadow-md shadow-purple-500/20'
                                        : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                    }`}
                                  >
                                    <span className="text-2xl shrink-0">{r.emoji}</span>
                                    <div className="min-w-0">
                                      <div className="text-xs font-bold text-slate-200 flex items-center gap-1">
                                        <span>{r.shortLabel}</span>
                                        {isSelected && <Tag color="purple" className="text-[9px] px-1 py-0 m-0 border-0">Đang bật</Tag>}
                                      </div>
                                      <div className="text-[10px] text-slate-400 truncate mt-0.5">{r.desc}</div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 3. Khối Cài Đặt Nâng Cao & Tốc Độ (Thu Gọn / Collapsible) */}
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                          <div
                            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                            className="p-3 flex items-center justify-between cursor-pointer hover:bg-slate-900/40 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <SettingOutlined className="text-cyan-400 text-sm" />
                              <span className="text-xs font-bold text-slate-200">
                                ⚙️ Cài Đặt Nâng Cao &amp; Tốc Độ (Tùy chọn)
                              </span>
                              <span className="text-[10px] text-cyan-300 font-mono bg-cyan-950/80 border border-cyan-800/60 px-2 py-0.5 rounded-full">
                                {speedMode === 'SMART' ? '🛡️ Smart Pacing' : speedMode === 'TURBO' ? '⚡ Siêu Tốc' : speedMode === 'FAST' ? '🚀 Nhanh' : speedMode === 'SAFE' ? '🛡️ An Toàn' : '⚖️ Chuẩn'} • {concurrency} luồng • {delayMs / 1000}s • {dripFeedMode ? `${dripDurationMinutes}p Drip` : 'Chạy ngay'}
                              </span>
                            </div>
                            <span className="text-xs text-cyan-400 font-bold">
                              {showAdvancedSettings ? 'Thu gọn ▲' : 'Mở rộng ▼'}
                            </span>
                          </div>

                          {!showAdvancedSettings && (
                            <div className="px-3 pb-2.5 text-[11px] text-slate-400 flex items-center gap-1.5">
                              <CheckCircleFilled className="text-emerald-400 text-xs shrink-0" />
                              <span>Đang chạy ở chế độ <strong>{speedMode === 'SMART' ? '🛡️ Smart Pacing (Thích ứng an toàn)' : speedMode === 'TURBO' ? '⚡ Siêu Tốc' : speedMode === 'FAST' ? '🚀 Nhanh Mượt' : speedMode === 'SAFE' ? '🛡️ An Toàn' : '⚖️ Chuẩn'}</strong> ({concurrency} luồng song song, giãn cách {delayMs / 1000}s).</span>
                            </div>
                          )}

                          {showAdvancedSettings && (
                            <div className="p-3 pt-0 border-t border-slate-800/80 space-y-2.5 mt-1">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                                {/* TỐC ĐỘ BUFF (SPEED MODE PRESET) */}
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-cyan-800/60 text-xs shadow-sm sm:col-span-2 gap-2">
                                  <div>
                                    <span className="text-cyan-300 font-bold block flex items-center gap-1">
                                      <ThunderboltFilled className="text-amber-400" /> Tốc Độ Buff (Speed Mode):
                                    </span>
                                    <span className="text-[10px] text-slate-400">Tối ưu Playwright, bỏ qua ảnh nặng, phản hồi tức thì</span>
                                  </div>
                                  <Segmented
                                    size="small"
                                    value={speedMode}
                                    onChange={(val) => {
                                      const mode = val as 'SMART' | 'TURBO' | 'FAST' | 'NORMAL' | 'SAFE';
                                      setSpeedMode(mode);
                                      if (mode === 'SMART') {
                                        setDelayMs(2800);
                                        setEnableHumanBehavior(true);
                                        setFastSwitch(true);
                                      } else if (mode === 'TURBO') {
                                        setDelayMs(1200);
                                        setEnableHumanBehavior(false);
                                        setFastSwitch(true);
                                      } else if (mode === 'FAST') {
                                        setDelayMs(2000);
                                        setEnableHumanBehavior(true);
                                        setFastSwitch(true);
                                      } else if (mode === 'NORMAL') {
                                        setDelayMs(3500);
                                        setEnableHumanBehavior(true);
                                        setFastSwitch(true);
                                      } else if (mode === 'SAFE') {
                                        setDelayMs(5500);
                                        setEnableHumanBehavior(true);
                                        setFastSwitch(true);
                                      }
                                    }}
                                    options={[
                                      { label: '⚡ Siêu Tốc (1.2s)', value: 'TURBO' },
                                      { label: '🚀 Nhanh (2.0s)', value: 'FAST' },
                                      { label: '🛡️ Tự Động (2.8s)', value: 'SMART' },
                                      { label: '⚖️ Chuẩn (3.5s)', value: 'NORMAL' },
                                      { label: '🛡️ An Toàn (5.5s)', value: 'SAFE' },
                                    ]}
                                    className="bg-slate-900 border border-slate-700 text-slate-200"
                                  />
                                </div>

                                {speedMode === 'SMART' && (
                                  <div className="sm:col-span-2 flex items-center gap-2 p-2 rounded-lg bg-cyan-950/40 border border-cyan-800/40 text-[11px] text-cyan-300">
                                    <SafetyCertificateOutlined className="text-cyan-400 text-sm shrink-0" />
                                    <span>
                                      <b>Safe Human Pacing đang bật:</b> Tự động giãn nhịp an toàn ({selectedPageIds.length <= 20 ? '~5.2s' : selectedPageIds.length <= 60 ? '~6.5s' : selectedPageIds.length <= 120 ? '~8.0s' : '~9.5s'}), thời gian đọc bài 2s - 4s và nghỉ hạ nhiệt 45s sau mỗi 15-20 page để Via không bao giờ bị Facebook gắn cờ spam.
                                    </span>
                                  </div>
                                )}
                                {selectedPageIds.length > 80 && (speedMode === 'TURBO' || speedMode === 'FAST') && (
                                  <div className="sm:col-span-2 flex items-center gap-2 p-2 rounded-lg bg-amber-950/40 border border-amber-700/50 text-[11px] text-amber-300">
                                    <ThunderboltFilled className="text-amber-400 text-sm shrink-0" />
                                    <span>
                                      <b>Lưu ý an toàn:</b> Bạn đang chọn {selectedPageIds.length} Page với tốc độ {speedMode === 'TURBO' ? 'Nhanh Vừa' : 'Nhanh'}. Khuyên dùng <b>Safe Smart</b> hoặc <b>Siêu An Toàn</b> để tránh bị Facebook hạn chế thao tác.
                                    </span>
                                  </div>
                                )}

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-emerald-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-slate-200 font-bold block">Mô phỏng người dùng</span>
                                    <span className="text-[10px] text-slate-400">Lướt đọc bài tự nhiên (2s - 4s)</span>
                                  </div>
                                  <Checkbox
                                    checked={enableHumanBehavior}
                                    onChange={(e) => setEnableHumanBehavior(e.target.checked)}
                                    className="text-emerald-400 font-bold"
                                  >
                                    Bật
                                  </Checkbox>
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs shadow-sm">
                                  <div>
                                    <span className="text-slate-200 font-bold block">Giãn cách:</span>
                                    <span className="text-[10px] text-slate-400">Nghỉ giữa 2 nick</span>
                                  </div>
                                  <Select
                                    size="small"
                                    value={delayMs}
                                    onChange={(val) => setDelayMs(val)}
                                    className="w-36"
                                    options={
                                      engagementMode !== 'LIKE_ONLY'
                                        ? [
                                            { value: 12000, label: '⚖️ 12s (Khuyên dùng)' },
                                            { value: 16000, label: '🛡️ 16s (An toàn cao)' },
                                            { value: 25000, label: '🌟 25s (Siêu an toàn)' },
                                          ]
                                        : [
                                            { value: 4000, label: '⚡ 4.0s (Nhanh)' },
                                            { value: 6000, label: '🛡️ 6.0s (Chuẩn an toàn)' },
                                            { value: 8000, label: '🌟 8.0s (Bền Via)' },
                                            { value: 12000, label: '💎 12s (Siêu chống spam)' },
                                          ]
                                    }
                                  />
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-blue-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-blue-300 font-bold block flex items-center gap-1">
                                      <span>Đổi Page trên bài (Fast-Switch)</span>
                                    </span>
                                    <span className="text-[10px] text-slate-400">Đổi trực tiếp qua Voice Switcher</span>
                                  </div>
                                  <Checkbox
                                    checked={fastSwitch}
                                    onChange={(e) => setFastSwitch(e.target.checked)}
                                    className="text-blue-400 font-bold"
                                  >
                                    Bật
                                  </Checkbox>
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-cyan-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-cyan-300 font-bold block flex items-center gap-1">
                                      <ThunderboltFilled className="text-cyan-400" /> Luồng chạy song song
                                    </span>
                                    <span className="text-[10px] text-slate-400">1 Luồng / Via (Chống checkpoint)</span>
                                  </div>
                                  <Segmented
                                    size="small"
                                    value={concurrency}
                                    onChange={(val) => setConcurrency(Number(val))}
                                    options={[
                                      { label: '🛡️ 1 Luồng (An toàn)', value: 1 },
                                      { label: '⚡ 2 Luồng (Cần Proxy)', value: 2 },
                                      { label: '🚀 3 Luồng (Dàn Via)', value: 3 },
                                    ]}
                                    className="bg-slate-900 border border-slate-700 text-slate-200"
                                  />
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-indigo-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-indigo-300 font-bold block flex items-center gap-1">
                                      <SafetyCertificateOutlined className="text-indigo-400" /> Buff rải đều (Drip-feed)
                                    </span>
                                    <span className="text-[10px] text-slate-400">Rải đều theo thời gian chống quét</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {dripFeedMode && (
                                      <Select
                                        size="small"
                                        value={dripDurationMinutes}
                                        onChange={(val) => setDripDurationMinutes(val)}
                                        className="w-24 text-xs"
                                        options={[
                                          { value: 15, label: '15 phút' },
                                          { value: 30, label: '30 phút' },
                                          { value: 60, label: '1 giờ' },
                                          { value: 120, label: '2 giờ' },
                                          { value: 240, label: '4 giờ' },
                                        ]}
                                      />
                                    )}
                                    <Switch
                                      checked={dripFeedMode}
                                      onChange={(val) => setDripFeedMode(val)}
                                      checkedChildren="Bật"
                                      unCheckedChildren="Tắt"
                                      className="bg-slate-800"
                                    />
                                  </div>
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-amber-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-amber-300 font-bold block flex items-center gap-1">
                                      <span>Bảo vệ BM &amp; Via</span>
                                    </span>
                                    <span className="text-[10px] text-slate-400">Batch Cooldown &amp; dừng khi bị chặn</span>
                                  </div>
                                  <Checkbox
                                    checked={antiCheckpointGuard}
                                    onChange={(e) => setAntiCheckpointGuard(e.target.checked)}
                                    className="text-amber-400 font-bold"
                                  >
                                    Bật
                                  </Checkbox>
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-emerald-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-emerald-300 font-bold block flex items-center gap-1">
                                      <SafetyCertificateOutlined className="text-emerald-400" /> Tự động bù Via Live (Auto-Failover)
                                    </span>
                                    <span className="text-[10px] text-slate-400">Tự động bù Page từ Via Live khi phát hiện Via hết cookie</span>
                                  </div>
                                  <Checkbox
                                    checked={autoFailoverLiveVia}
                                    onChange={(e) => setAutoFailoverLiveVia(e.target.checked)}
                                    className="text-emerald-400 font-bold"
                                  >
                                    Bật
                                  </Checkbox>
                                </div>
                              </div>

                              {/* Checkbox Tránh like trùng */}
                              <div className="flex items-center justify-between p-2.5 rounded-xl border border-slate-800/80 bg-slate-950/60 text-xs">
                                <Checkbox
                                  checked={autoSkipAlreadyLiked}
                                  onChange={(e) => setAutoSkipAlreadyLiked(e.target.checked)}
                                  className="text-slate-200 font-medium"
                                >
                                  Tự động bỏ qua nick/page đã like bài viết này trước đó
                                </Checkbox>
                                <span className="text-amber-400 font-semibold text-[11px] hidden sm:inline">
                                  Chống trùng lặp
                                </span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 4. Khối Bình Luận Seeding Studio (Nếu bật Comment) */}
                        {engagementMode !== 'LIKE_ONLY' && (
                          <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-950/80 border border-blue-900/50">
                            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                              <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                                <CommentOutlined /> Nội dung bình luận ({commentListText.split('\n').filter((s) => s.trim()).length} dòng)
                              </span>
                              <div className="flex items-center gap-1.5">
                                <Button
                                  size="small"
                                  type="primary"
                                  icon={<RobotOutlined spin={isAiGeneratingComments} />}
                                  loading={isAiGeneratingComments}
                                  onClick={handleGenerateAiComments}
                                  className="bg-blue-600 hover:bg-blue-500 text-on-accent font-bold text-xs h-7 px-2.5 rounded-lg border-none cursor-pointer"
                                >
                                  Tạo bình luận bằng AI
                                </Button>
                                <Button
                                  size="small"
                                  onClick={() => setAiStudioModalOpen(true)}
                                  className="text-xs h-7 px-2 rounded-lg bg-slate-800 border-slate-700 text-slate-200 cursor-pointer"
                                >
                                  Mẫu Seeding
                                </Button>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    const lines = commentListText.split('\n').filter((s) => s.trim());
                                    const shuffled = [...lines].sort(() => Math.random() - 0.5);
                                    setCommentListText(shuffled.join('\n'));
                                    message.info('Đã đảo ngẫu nhiên thứ tự bình luận!');
                                  }}
                                  className="text-xs h-7 px-2 rounded-lg bg-slate-800 border-slate-700 text-slate-200 cursor-pointer"
                                >
                                  Đảo
                                </Button>
                              </div>
                            </div>

                            {/* Kho kịch bản Seeding có sẵn (1-Click Apply) */}
                            {seedingPresets.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                                <span className="text-[11px] font-semibold text-slate-400">⚡ Gợi ý kịch bản:</span>
                                {seedingPresets.map((pr) => (
                                  <button
                                    key={pr.id}
                                    type="button"
                                    onClick={() => {
                                      setCommentListText(pr.comments.join('\n'));
                                      message.success(`Đã nạp kho seeding: ${pr.name}`);
                                    }}
                                    className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-blue-950/60 hover:bg-blue-900/80 text-blue-300 border border-blue-800/50 transition-colors cursor-pointer"
                                  >
                                    {pr.badge ? `[${pr.badge}] ` : ''}{pr.name}
                                  </button>
                                ))}
                              </div>
                            )}

                            <Input.TextArea
                              rows={5}
                              value={commentListText}
                              onChange={(e) => setCommentListText(e.target.value)}
                              placeholder={`Nhập hoặc dán các câu bình luận (mỗi câu 1 dòng):\nBài viết hay và rất ý nghĩa ạ! \nThông tin rất bổ ích, cảm ơn bạn đã chia sẻ \n...`}
                              className="font-sans text-xs bg-slate-900 text-slate-100 border-slate-700 rounded-xl placeholder:text-slate-500 focus:border-blue-400"
                            />
                          </div>
                        )}
                      </div>

                      <div className="app-surface p-5 space-y-4">
                        {/* Card Header */}
                        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-semibold flex items-center justify-center text-xs shrink-0">
                              3
                            </span>
                            <span className="text-sm sm:text-base font-semibold text-slate-100">Tài khoản thực hiện</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="text"
                              size="small"
                              icon={<ReloadOutlined spin={scanPagesMutation.isPending || loadingAccounts} />}
                              loading={scanPagesMutation.isPending || loadingAccounts}
                              onClick={async () => {
                                await queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
                                await refetchAccounts();
                                message.success(`Đã cập nhật: ${fbAccounts.length} Via sẵn sàng!`);
                                handleScanPages();
                              }}
                              className="text-slate-300 hover:text-blue-400 text-xs px-2.5 h-7 rounded-lg border border-slate-700 hover:border-blue-500 bg-slate-800/80 font-semibold cursor-pointer"
                              title="Làm mới dàn Via & Quét thêm Fanpage từ Facebook"
                            >
                              Quét lại
                            </Button>
                            <Button
                              type="primary"
                              size="small"
                              icon={<SettingOutlined />}
                              onClick={() => handleOpenManagePages(selectedAccountId)}
                              className="bg-blue-600 hover:bg-blue-500 text-on-accent font-bold rounded-lg text-xs h-7 px-2.5 shadow-sm border-none cursor-pointer"
                            >
                              Quản lý Page ({scannedPages.length})
                            </Button>
                          </div>
                        </div>

                        {/* Dropdown chọn nick mẹ */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-semibold text-slate-300">
                              Tài khoản Facebook sở hữu Page:
                            </label>
                            {currentViaAccount && (
                              <span className="text-[11px] text-blue-400 font-mono">
                                c_user: {extractCUser(currentViaAccount.cookieString || currentViaAccount.accessToken) || 'N/A'}
                              </span>
                            )}
                            {selectedAccountId === 'ALL_VIAS' && (
                              <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                {actorMode === 'VIAS'
                                  ? `Gộp ${fbAccounts.length} Nick Via (${selectedPageIds.length}/${scannedPages.length})`
                                  : `Gộp ${fbAccounts.length} Via (${scannedPages.length} Fanpage)`}
                              </span>
                            )}
                          </div>
                          <Select
                            className="w-full"
                            size="large"
                            loading={loadingAccounts}
                            value={selectedAccountId}
                            onChange={(val) => {
                              setSelectedAccountId(val);
                              if (val === 'CUSTOM') {
                                setScannedPages([]);
                                setSelectedPageIds([]);
                              }
                            }}
                            options={[
                              ...(fbAccounts.length > 1
                                ? [
                                    {
                                      value: 'ALL_VIAS',
                                      label: `Tất cả nick (${fbAccounts.length}): ${
                                        fbAccounts
                                          .slice(0, 4)
                                          .map((a) => a.pageName || `Via ${String(a.platformAccountId || a.id).slice(-4)}`)
                                          .join(' + ') +
                                        (fbAccounts.length > 4 ? ` + ${fbAccounts.length - 4} nick khác` : '')
                                      }`,
                                    },
                                  ]
                                : []),
                              { value: 'CUSTOM', label: 'Nhập cookie thủ công' },
                              ...fbAccounts.map((a) => ({
                                value: a.id,
                                label: `${a.pageName || `Via ${String(a.platformAccountId || a.id).slice(-4)}`} (${
                                  a.tokenStatus === 'OK' ? 'Cookie sống' : 'Cần kiểm tra'
                                })`,
                              })),
                            ]}
                          />
                        </div>

                        {/* Cookie thủ công nếu chọn CUSTOM */}
                        {selectedAccountId === 'CUSTOM' && (
                          <div className="space-y-3 p-3.5 rounded-xl border border-slate-800 bg-slate-950/70">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-bold text-slate-200">
                                Nhập Cookie nick Facebook mẹ:
                              </label>
                              <span className="text-[11px] text-slate-400">
                                (Chứa <b>c_user</b> & <b>xs</b>)
                              </span>
                            </div>

                            <Row gutter={10}>
                              <Col span={10}>
                                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                                  c_user:
                                </label>
                                <Input
                                  placeholder="10008321..."
                                  value={
                                    customCookie.match(/(?:^|;\s*)c_user=([^;]+)/)?.[1] ||
                                    (customCookie.includes('=') ? '' : customCookie)
                                  }
                                  onChange={(e) => {
                                    const cUser = e.target.value.trim();
                                    const currentXs = customCookie.match(/(?:^|;\s*)xs=([^;]+)/)?.[1] || '';
                                    setCustomCookie(
                                      cUser && currentXs
                                        ? `c_user=${cUser}; xs=${currentXs}`
                                        : cUser
                                        ? `c_user=${cUser}`
                                        : ''
                                    );
                                  }}
                                  className="font-mono text-xs rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                                />
                              </Col>
                              <Col span={14}>
                                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                                  xs:
                                </label>
                                <Input.Password
                                  placeholder="27%3ABc0..."
                                  value={customCookie.match(/(?:^|;\s*)xs=([^;]+)/)?.[1] || ''}
                                  onChange={(e) => {
                                    const xs = e.target.value.trim();
                                    const currentCUser = customCookie.match(/(?:^|;\s*)c_user=([^;]+)/)?.[1] || '';
                                    setCustomCookie(
                                      currentCUser && xs
                                        ? `c_user=${currentCUser}; xs=${xs}`
                                        : xs
                                        ? `xs=${xs}`
                                        : ''
                                    );
                                  }}
                                  className="font-mono text-xs rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                                />
                              </Col>
                            </Row>

                            <Input.TextArea
                              rows={2}
                              placeholder="Dán toàn bộ cookie dài vào đây..."
                              value={customCookie}
                              onChange={(e) => setCustomCookie(e.target.value)}
                              className="font-mono text-[11px] rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                            />
                          </div>
                        )}

                        {/* CHỌN: DÀN FANPAGE VỆ TINH HAY DÀN VIA CÁ NHÂN */}
                        <div className="p-1 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setActorMode('FANPAGES')}
                            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                              actorMode === 'FANPAGES'
                                ? 'bg-blue-600 text-on-accent'
                                : 'text-slate-400 hover:text-white hover:bg-slate-900'
                            }`}
                          >
                            <span>Page</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-950 border border-blue-700 text-blue-300">
                              {scannedPages.length}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setActorMode('VIAS')}
                            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                              actorMode === 'VIAS'
                                ? 'bg-blue-600 text-on-accent'
                                : 'text-slate-400 hover:text-white hover:bg-slate-900'
                            }`}
                          >
                            <span>Nick cá nhân</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300">
                              {fbAccounts.length}
                            </span>
                          </button>
                        </div>

                        {/* Danh sách Fanpage / Via với Interactive Grid Cards */}
                        {scannedPages.length > 0 ? (
                          <div className="space-y-2.5 pt-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-200">
                                {actorMode === 'VIAS' ? 'Chọn Nick Via tương tác:' : 'Chọn Fanpage tương tác:'}{' '}
                                <span className="text-blue-400 font-mono font-bold">
                                  ({selectedPageIds.length}/{scannedPages.length})
                                </span>
                              </span>
                              <Checkbox
                                checked={selectedPageIds.length === scannedPages.length && scannedPages.length > 0}
                                indeterminate={
                                  selectedPageIds.length > 0 && selectedPageIds.length < scannedPages.length
                                }
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedPageIds(scannedPages.map((p) => p.id));
                                  } else {
                                    setSelectedPageIds([]);
                                  }
                                }}
                              >
                                <span className="text-xs text-slate-300 font-semibold">Chọn tất cả</span>
                              </Checkbox>
                            </div>

                            {/* Thanh công cụ Chọn Nhanh Số Lượng Page (20, 50, 100, 200, 300, 400, 500, All) */}
                            {scannedPages.length > 5 && (
                              <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
                                <span className="text-[11px] text-slate-400 font-semibold">Chọn nhanh:</span>
                                {[20, 50, 100, 200, 300, 400, 500]
                                  .filter((n) => n <= scannedPages.length)
                                  .map((num) => (
                                    <Button
                                      key={num}
                                      size="small"
                                      onClick={() => handleSelectRandomPages(num)}
                                      className="bg-slate-900 border-slate-700/80 hover:border-cyan-500 text-slate-200 text-[11px] font-semibold rounded-lg px-2 h-6"
                                    >
                                      ⚡ {num} Page
                                    </Button>
                                  ))}
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setSelectedPageIds(scannedPages.map((p) => p.id));
                                    message.success(`Đã chọn toàn bộ ${scannedPages.length} Fanpage!`);
                                  }}
                                  className="bg-cyan-950/80 border-cyan-800 text-cyan-300 text-[11px] font-semibold rounded-lg px-2 h-6"
                                >
                                  👑 Tất cả ({scannedPages.length})
                                </Button>
                                {selectedPageIds.length > 0 && (
                                  <Button
                                    size="small"
                                    onClick={() => setSelectedPageIds([])}
                                    className="bg-slate-900 border-slate-800 text-slate-400 text-[11px] rounded-lg px-2 h-6"
                                  >
                                    Bỏ chọn
                                  </Button>
                                )}
                              </div>
                            )}

                            {/* Nút lọc nhanh theo từng Via khi chọn Gộp ALL_VIAS */}
                            {selectedAccountId === 'ALL_VIAS' && Object.keys(viaGroupCounts).length > 1 && (
                              <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
                                <span className="text-[11px] font-semibold text-slate-400">Xem theo Via:</span>
                                <button
                                  type="button"
                                  onClick={() => setViaFilter('ALL')}
                                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer border ${
                                    viaFilter === 'ALL'
                                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  Tất cả ({scannedPages.length})
                                </button>
                                {Object.entries(viaGroupCounts).map(([vName, count]) => (
                                  <button
                                    key={vName}
                                    type="button"
                                    onClick={() => setViaFilter(vName)}
                                    className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer border ${
                                      viaFilter === vName
                                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
                                    }`}
                                  >
                                    {vName} ({count})
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Ô tìm kiếm Page/Via */}
                            {scannedPages.length > 6 && (
                              <Input
                                prefix={<SearchOutlined className="text-slate-400" />}
                                placeholder={actorMode === 'VIAS' ? 'Tìm Via theo tên hoặc UID...' : 'Tìm Fanpage theo tên hoặc ID...'}
                                size="middle"
                                value={pageSearchQuery}
                                onChange={(e) => setPageSearchQuery(e.target.value)}
                                className="text-xs rounded-xl bg-slate-950/70 border-slate-700 text-slate-100"
                              />
                            )}

                            {/* Cảnh báo phát hiện Page thuộc Via đã hết hạn Cookie */}
                            {expiredPagesSelectedCount > 0 && (
                              <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm">
                                <span className="text-rose-300 font-medium flex items-center gap-1.5 text-[11px]">
                                  <ExclamationCircleOutlined className="text-rose-400 text-sm shrink-0" />
                                  <span>
                                    Phát hiện <b>{expiredPagesSelectedCount} Page</b> thuộc Via hết cookie (không like được).
                                  </span>
                                </span>
                                <Button
                                  size="small"
                                  onClick={handleReplaceExpiredPagesWithLiveOnes}
                                  className="text-[11px] h-6 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 border-none text-white font-semibold cursor-pointer shrink-0"
                                >
                                  ⚡ Tự động thay bằng Page từ Via Live
                                </Button>
                              </div>
                            )}

                            {/* Cảnh báo phát hiện Page đã từng tương tác bài viết này */}
                            {(interactedPageIds.size > 0 || alreadyLikedPagesForUrl.length > 0) && (
                              <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs flex items-center justify-between gap-2">
                                <span className="text-amber-300 font-medium flex items-center gap-1.5 text-[11px]">
                                  <InfoCircleOutlined className="text-amber-400" />
                                  <span>Phát hiện <b>{Math.max(interactedPageIds.size, alreadyLikedPagesForUrl.length)} Page</b> từng like link này. Nút "Chọn nhanh" sẽ tự động ưu tiên các Page mới chưa like!</span>
                                </span>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    const allInteracted = new Set([
                                      ...Array.from(interactedPageIds),
                                      ...alreadyLikedPagesForUrl.map((al) => al.pageId),
                                    ]);
                                    setSelectedPageIds((prev) => prev.filter((id) => !allInteracted.has(id)));
                                    message.success('Đã tự động bỏ chọn các Page đã từng like bài viết này!');
                                  }}
                                  className="text-[11px] h-6 px-2 rounded-lg bg-amber-900/60 border-amber-600/50 text-amber-200 cursor-pointer shrink-0"
                                >
                                  Bỏ chọn Page đã like
                                </Button>
                              </div>
                            )}

                            {/* Grid các Via/Fanpage card (Memoized Component tránh re-render giật lag) */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-1">
                              {filteredPages.slice(0, pageDisplayLimit).map((page) => {
                                const isChecked = selectedPageIdsSet.has(page.id);
                                const isAlreadyLiked = interactedPageIds.has(page.id) || alreadyLikedPageIdsSet.has(page.id);
                                const cleanName = cleanPageName(page.name);
                                const avatarInfo = avatarCacheMap[page.id];
                                const avatarUrl =
                                  page.avatarUrl ||
                                  avatarInfo?.avatarUrl ||
                                  (page.id ? `https://graph.facebook.com/${page.id}/picture?type=square` : '');
                                return (
                                  <PageCardItem
                                    key={page.id}
                                    page={page}
                                    isChecked={isChecked}
                                    isAlreadyLiked={isAlreadyLiked}
                                    cleanName={cleanName}
                                    avatarUrl={avatarUrl}
                                    actorMode={actorMode}
                                    selectedAccountId={selectedAccountId}
                                    onToggle={handleTogglePageId}
                                  />
                                );
                              })}

                              {/* Tải thêm / Hiển thị tất cả khi số Page lớn */}
                              {filteredPages.length > pageDisplayLimit && (
                                <div className="sm:col-span-2 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-300">
                                  <span>
                                    Đang hiển thị <b className="text-white">{pageDisplayLimit}</b> / <b className="text-white">{filteredPages.length}</b> tài khoản
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="small"
                                      onClick={() => setPageDisplayLimit((prev) => prev + 60)}
                                      className="text-xs h-7 rounded-lg bg-slate-800 border-slate-700 text-blue-400 hover:text-blue-300 cursor-pointer font-semibold"
                                    >
                                      Xem thêm +60
                                    </Button>
                                    <Button
                                      size="small"
                                      onClick={() => setPageDisplayLimit(filteredPages.length)}
                                      className="text-xs h-7 rounded-lg bg-slate-800 border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                                    >
                                      Hiện tất cả ({filteredPages.length})
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="p-5 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-400 space-y-2">
                            <p>Chưa có Fanpage nào được tải cho tài khoản này.</p>
                            <button
                              type="button"
                              onClick={() => handleOpenManagePages(selectedAccountId)}
                              className="text-blue-400 hover:underline font-bold cursor-pointer"
                            >
                              Bấm vào đây để nhập danh sách i_user
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </Col>

                  {/* CỘT PHẢI (ghim): tóm tắt, nút bắt đầu, tiến trình */}
                  <Col xs={24} lg={9}>
                    <div className="space-y-4 lg:sticky lg:top-24">
                      {/* Tóm tắt + nút bắt đầu */}
                      <div className="app-surface p-4 sm:p-5 space-y-4">
                        <div className="text-sm font-semibold text-slate-100">Tóm tắt</div>
                        <dl className="m-0 space-y-2 text-sm">
                          {[
                            {
                              k: 'Bài viết',
                              v:
                                buffMode === 'BATCH'
                                  ? `${parsedBatchLinks.length} link`
                                  : targetPostUrl
                                  ? targetPostUrl.replace(/^https?:\/\/(www\.)?/, '')
                                  : 'Chưa có',
                              muted: buffMode === 'SINGLE' ? !targetPostUrl : parsedBatchLinks.length === 0,
                            },
                            {
                              k: 'Hình thức',
                              v: engagementMode === 'LIKE_ONLY' ? 'Chỉ like' : engagementMode === 'COMMENT_ONLY' ? 'Chỉ bình luận' : 'Like + bình luận',
                            },
                            {
                              k: 'Cảm xúc',
                              v: (() => {
                                const r = REACTIONS.find((x) => x.key === selectedReaction);
                                return r ? `${r.emoji} ${r.shortLabel}` : selectedReaction;
                              })(),
                            },
                            {
                              k: 'Tài khoản',
                              v: `${selectedPageIds.length} ${actorMode === 'VIAS' ? 'nick cá nhân' : 'Page'}`,
                              muted: selectedPageIds.length === 0,
                            },
                            { k: 'Tốc độ', v: `${concurrency} luồng · ${delayMs / 1000}s` },
                            {
                              k: 'Dự kiến',
                              v: runEstimate
                                ? `~${formatDuration(runEstimate.total)}${runEstimate.links > 1 ? ` (${formatDuration(runEstimate.perLink)}/bài)` : ''}`
                                : 'Chưa đủ thông tin',
                              muted: !runEstimate,
                            },
                          ].map((row) => (
                            <div key={row.k} className="flex items-center justify-between gap-3">
                              <dt className="text-slate-400 shrink-0">{row.k}</dt>
                              <dd className={`m-0 truncate text-right ${row.muted ? 'text-slate-500' : 'text-slate-100'}`}>{row.v}</dd>
                            </div>
                          ))}
                        </dl>
                        {runEstimate && (
                          <p className="text-xs text-slate-500 m-0 -mt-2">
                            {runEstimate.basis === 'history'
                              ? 'Ước tính từ tốc độ thực tế của các bài đã chạy gần đây.'
                              : 'Ước tính sơ bộ theo cài đặt tốc độ, chính xác hơn sau vài bài chạy.'}
                          </p>
                        )}

                        {/* Chế độ chạy: Chạy ngay hoặc Đưa vào hàng đợi */}
                        <div className="space-y-3 pt-1">
                          <Segmented
                            block
                            value={runMode}
                            onChange={(v) => setRunMode(v as 'NOW' | 'QUEUE')}
                            disabled={autoBuffMutation.isPending || isBatchRunning}
                            options={[
                              { label: '⚡ Chạy ngay', value: 'NOW' },
                              { label: '⏳ Đưa vào hàng đợi', value: 'QUEUE' },
                            ]}
                          />

                          {runMode === 'QUEUE' && (
                            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-400 shrink-0 font-medium">Bắt đầu:</span>
                                <Select
                                  value={queueStartAfter}
                                  onChange={setQueueStartAfter}
                                  className="w-44"
                                  options={[
                                    { value: 0, label: '⚡ Ngay khi tới lượt' },
                                    { value: 5, label: '⏱️ Sau 5 phút' },
                                    { value: 15, label: '⏱️ Sau 15 phút' },
                                    { value: 30, label: '⏱️ Sau 30 phút' },
                                    { value: 60, label: '⏱️ Sau 1 giờ' },
                                    { value: 'AT', label: '📅 Vào giờ cụ thể' },
                                  ]}
                                />
                              </div>
                              {queueStartAfter === 'AT' && (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-400 shrink-0 font-medium">Giờ hẹn:</span>
                                  <Input
                                    type="time"
                                    value={queueStartAt}
                                    onChange={(e) => setQueueStartAt(e.target.value)}
                                    className="w-44"
                                  />
                                </div>
                              )}
                              {buffMode === 'BATCH' && (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-400 shrink-0 font-medium">Giãn cách:</span>
                                  <Select
                                    value={queueStagger}
                                    onChange={setQueueStagger}
                                    className="w-44"
                                    options={[
                                      { value: 0, label: 'Không giãn cách' },
                                      { value: 3, label: '3 phút' },
                                      { value: 5, label: '5 phút' },
                                      { value: 10, label: '10 phút' },
                                      { value: 30, label: '30 phút' },
                                    ]}
                                  />
                                </div>
                              )}
                              <p className="text-xs text-slate-500 m-0">
                                Hàng đợi tự động xử lý lần lượt theo lịch, hệ thống phân phối đều giữa các Via.
                              </p>
                            </div>
                          )}

                          {/* Action Buttons */}
                          {autoBuffProgress.status === 'RUNNING' || isBatchRunning ? (
                            <div className="space-y-2.5">
                              <div className="p-3 rounded-xl bg-blue-950/50 border border-blue-500/40 text-xs flex items-center justify-between shadow-sm">
                                <span className="text-blue-300 font-bold flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                                  Đang có bài chạy trực tiếp ({autoBuffProgress.percent}%)
                                </span>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => setActiveTabKey('buff-running')}
                                  className="text-xs p-0 text-cyan-400 font-semibold"
                                >
                                  Xem tiến trình →
                                </Button>
                              </div>
                              <Button
                                type="primary"
                                size="large"
                                loading={isEnqueueing}
                                disabled={selectedPageIds.length === 0 || !targetPostUrl.trim()}
                                onClick={handleEnqueueFromForm}
                                className="w-full h-11 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 border-none shadow-lg shadow-amber-600/25"
                              >
                                ⚡ Đưa bài mới này vào Hàng đợi (Chờ chạy tiếp theo)
                              </Button>
                            </div>
                          ) : runMode === 'QUEUE' ? (
                            <div className="space-y-2">
                              <Button
                                type="primary"
                                size="large"
                                loading={isEnqueueing}
                                disabled={
                                  selectedPageIds.length === 0 ||
                                  (buffMode === 'BATCH' ? parsedBatchLinks.length === 0 : !targetPostUrl.trim())
                                }
                                onClick={handleEnqueueFromForm}
                                className="w-full h-11 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 border-none shadow-md shadow-amber-600/20"
                              >
                                {(buffMode === 'BATCH' ? parsedBatchLinks.length === 0 : !targetPostUrl.trim())
                                  ? 'Dán link bài viết ở bước 1'
                                  : selectedPageIds.length === 0
                                  ? 'Chọn số Like ở bước 1 hoặc 3'
                                  : buffMode === 'BATCH'
                                  ? `⏳ Thêm ${parsedBatchLinks.length} bài vào hàng đợi`
                                  : '⏳ Xác nhận thêm vào hàng đợi'}
                              </Button>
                              <Button
                                type="text"
                                onClick={() => setRunMode('NOW')}
                                className="w-full text-xs text-slate-400 hover:text-blue-400"
                              >
                                ← Chuyển sang chế độ chạy ngay lập tức
                              </Button>
                            </div>
                          ) : buffMode === 'SINGLE' ? (
                            <div className="space-y-2">
                              <Button
                                type="primary"
                                size="large"
                                loading={autoBuffMutation.isPending}
                                disabled={selectedPageIds.length === 0 || !targetPostUrl}
                                onClick={handleStartAutoBuff}
                                className="w-full h-11 rounded-xl text-sm font-bold shadow-md shadow-blue-600/20"
                              >
                                {autoBuffMutation.isPending
                                  ? 'Đang khởi chạy...'
                                  : !targetPostUrl
                                  ? 'Dán link bài viết ở bước 1'
                                  : selectedPageIds.length === 0
                                  ? 'Chọn số Like ở bước 1 hoặc 3'
                                  : '🚀 Bắt đầu Chạy Ngay'}
                              </Button>
                              <Button
                                type="dashed"
                                onClick={() => {
                                  setRunMode('QUEUE');
                                  handleEnqueueFromForm();
                                }}
                                disabled={selectedPageIds.length === 0 || !targetPostUrl.trim()}
                                className="w-full h-9 rounded-xl text-xs font-semibold text-amber-400 border-amber-500/40 hover:border-amber-400 bg-amber-950/20"
                              >
                                ⏳ Hoặc đưa vào Hàng đợi để chạy ngầm
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {!isBatchRunning ? (
                                <Button
                                  type="primary"
                                  size="large"
                                  disabled={parsedBatchLinks.length === 0 || selectedPageIds.length === 0}
                                  onClick={handleStartBatchBuff}
                                  className="w-full h-11 rounded-xl text-sm font-bold shadow-md shadow-blue-600/20"
                                >
                                  {parsedBatchLinks.length === 0
                                    ? 'Dán danh sách link ở bước 1'
                                    : `🚀 Bắt đầu chạy ${parsedBatchLinks.length} bài viết`}
                                </Button>
                              ) : (
                                <Button
                                  danger
                                  size="large"
                                  onClick={handleStopBatchBuff}
                                  className="w-full h-11 rounded-xl text-sm font-bold"
                                >
                                  Dừng toàn bộ hàng loạt
                                </Button>
                              )}
                              <Button
                                type="dashed"
                                onClick={() => {
                                  setRunMode('QUEUE');
                                  handleEnqueueFromForm();
                                }}
                                disabled={parsedBatchLinks.length === 0 || selectedPageIds.length === 0}
                                className="w-full h-9 rounded-xl text-xs font-semibold text-amber-400 border-amber-500/40 hover:border-amber-400 bg-amber-950/20"
                              >
                                ⏳ Hoặc đưa toàn bộ {parsedBatchLinks.length} bài vào Hàng đợi
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* MINI STATUS WIDGET TRÊN TAB TẠO MỚI (KHÔNG CHIẾM DIỆN TÍCH FORM) */}
                      {autoBuffProgress.status === 'RUNNING' || isBatchRunning ? (
                        <div className="p-4 rounded-xl border border-blue-500/40 bg-blue-950/20 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-blue-800/30">
                            <span className="text-xs font-bold text-blue-300 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                              Có 1 tiến trình đang chạy ngầm
                            </span>
                            <span className="font-mono text-xs font-bold text-blue-300">{autoBuffProgress.percent}%</span>
                          </div>

                          <div className="space-y-2">
                            <div className="text-xs text-slate-300 truncate font-mono bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                              🎯 {runningTargetInfo?.url || 'Bài viết Facebook'}
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-400">
                              <span className="truncate max-w-[200px]">
                                Đang xử lý: <b className="text-white">{autoBuffProgress.currentRunningPageName || 'Đang mở Facebook...'}</b>
                              </span>
                              <span className="font-mono font-bold text-slate-200">
                                {autoBuffProgress.success + autoBuffProgress.alreadyLiked}/{autoBuffProgress.total}
                              </span>
                            </div>

                            <Progress percent={autoBuffProgress.percent} size={['100%', 5]} showInfo={false} />

                            <div className="grid grid-cols-4 gap-1.5 pt-1">
                              <div className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                                <div className="text-[10px] text-slate-400">Tổng</div>
                                <div className="text-xs font-bold text-slate-100">{autoBuffProgress.total}</div>
                              </div>
                              <div className="p-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-center">
                                <div className="text-[10px] text-emerald-400">Thành công</div>
                                <div className="text-xs font-bold text-emerald-300">{autoBuffProgress.success}</div>
                              </div>
                              <div className="p-1.5 rounded-lg bg-blue-950/40 border border-blue-800/50 text-center">
                                <div className="text-[10px] text-blue-400">Đã like</div>
                                <div className="text-xs font-bold text-blue-300">{autoBuffProgress.alreadyLiked}</div>
                              </div>
                              <div className="p-1.5 rounded-lg bg-rose-950/40 border border-rose-800/50 text-center">
                                <div className="text-[10px] text-rose-400">Lỗi</div>
                                <div className="text-xs font-bold text-rose-300">{autoBuffProgress.failed}</div>
                              </div>
                            </div>
                          </div>

                          <div className="pt-1 flex items-center gap-2">
                            <Button
                              type="primary"
                              size="middle"
                              onClick={() => setActiveTabKey('buff-running')}
                              className="flex-1 text-xs font-semibold rounded-lg"
                              icon={<ExportOutlined />}
                            >
                              Xem chi tiết tiến trình ➔
                            </Button>
                          </div>

                          <div className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
                            💡 <b>Mẹo:</b> Ô nhập link bên trái đã được làm trống. Bạn có thể dán tiếp link khác và bấm <b>"Đưa bài mới này vào hàng đợi"</b> để tự động chạy nối tiếp mà không cần chờ!
                          </div>
                        </div>
                      ) : autoBuffProgress.status === 'DONE' ? (
                        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                              <CheckCircleFilled className="text-emerald-400" /> Tiến trình vừa hoàn tất!
                            </span>
                            <Tag color="success">{autoBuffProgress.success}/{autoBuffProgress.total} Like</Tag>
                          </div>
                          <div className="text-xs text-slate-300 truncate font-mono bg-slate-950/50 p-2 rounded-lg border border-slate-800">
                            {runningTargetInfo?.url || 'Bài viết Facebook'}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => setActiveTabKey('buff-running')}
                              className="text-xs flex-1 rounded-lg"
                            >
                              Xem bảng kết quả ➔
                            </Button>
                            <Button
                              size="small"
                              onClick={() => setActiveTabKey('buff-history')}
                              className="text-xs rounded-lg"
                            >
                              Xem Lịch sử
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-5 rounded-xl border border-dashed border-slate-800 text-center text-slate-400 space-y-2 bg-slate-950/30">
                          <div className="w-10 h-10 mx-auto rounded-xl bg-blue-950/60 border border-blue-700/40 flex items-center justify-center text-xl text-blue-400">
                            <PlayCircleOutlined />
                          </div>
                          <div className="text-xs font-semibold text-slate-200">Sẵn sàng chạy tương tác</div>
                          <div className="text-[11px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                            Dán link bài viết và bấm <b>Bắt đầu</b>. Hệ thống sẽ tự động chuyển sang tab <b>Tiến trình chạy</b> để bạn quan sát từng lượt thả cảm xúc theo thời gian thực.
                          </div>
                        </div>
                      )}
                    </div>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'buff-running',
            label: (
              <span className="flex items-center gap-1.5">
                <PlayCircleOutlined className="text-blue-400" />
                <span>Tiến trình chạy</span>
                {(autoBuffProgress.status === 'RUNNING' || isBatchRunning || queueItems.some((i) => i.status === 'RUNNING')) && (
                  <span className="relative flex h-2 w-2 ml-0.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                )}
              </span>
            ),
            children: (
              <div className="space-y-4">
                {/* Header bar */}
                <div className="app-surface p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2 m-0">
                        <PlayCircleOutlined className="text-blue-400" /> Tiến trình tương tác trực tiếp
                      </h2>
                      {autoBuffProgress.status === 'RUNNING' || isBatchRunning ? (
                        <Tag color="processing" className="text-xs font-bold px-2.5 py-0.5 rounded-full border-blue-500/40">
                          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block mr-1.5"></span>
                          Đang chạy trực tiếp (Form)
                        </Tag>
                      ) : queueItems.some((i) => i.status === 'RUNNING') ? (
                        <Tag color="cyan" className="text-xs font-bold px-2.5 py-0.5 rounded-full border-cyan-500/40 bg-cyan-950/60 text-cyan-300">
                          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse inline-block mr-1.5"></span>
                          Hàng đợi đang xử lý ({queueItems.filter((i) => i.status === 'RUNNING').length} bài)
                        </Tag>
                      ) : autoBuffProgress.status === 'DONE' ? (
                        <Tag color="success" className="text-xs font-bold px-2.5 py-0.5 rounded-full">
                          <CheckCircleFilled className="mr-1" /> Đã hoàn thành
                        </Tag>
                      ) : (
                        <Tag className="text-xs font-medium px-2.5 py-0.5 rounded-full text-slate-400 bg-slate-800/60 border-slate-700/60">
                          Chưa có tiến trình
                        </Tag>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 mb-0">
                      {autoBuffProgress.status === 'RUNNING' || isBatchRunning
                        ? 'Hệ thống đang điều khiển Playwright tự động thả cảm xúc và bình luận theo thời gian thực.'
                        : queueItems.some((i) => i.status === 'RUNNING')
                        ? 'Hàng đợi tự động đang thực hiện nhiệm vụ bằng Playwright theo thời gian thực.'
                        : autoBuffProgress.status === 'DONE'
                        ? 'Chiến dịch vừa hoàn thành toàn bộ lượt tương tác.'
                        : 'Không có chiến dịch nào đang chạy. Bạn có thể sang tab Tạo mới để bắt đầu.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setTargetPostUrl('');
                        setAutoBuffProgress({
                          total: 0,
                          success: 0,
                          failed: 0,
                          alreadyLiked: 0,
                          percent: 0,
                          status: 'IDLE',
                          details: [],
                          logs: [],
                        });
                        setRunningTargetInfo(null);
                        initialFinishedRestoreDoneRef.current = true;
                        setActiveTabKey('buff-like');
                      }}
                      className="font-semibold rounded-xl text-xs sm:text-sm h-9"
                    >
                      Thêm link khác
                    </Button>
                    {queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length > 0 && (
                      <Button
                        icon={<ClockCircleOutlined />}
                        onClick={() => setActiveTabKey('buff-queue')}
                        className="rounded-xl text-xs sm:text-sm h-9"
                      >
                        Hàng đợi ({queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length})
                      </Button>
                    )}
                    {autoBuffProgress.status === 'RUNNING' && (
                      <Button
                        danger
                        type="primary"
                        icon={<StopOutlined />}
                        onClick={handleStopAutoBuff}
                        className="font-semibold rounded-xl text-xs sm:text-sm h-9"
                      >
                        Dừng khẩn cấp
                      </Button>
                    )}
                  </div>
                </div>

                {/* Empty State when IDLE or Active Queue Worker View */}
                {autoBuffProgress.status === 'IDLE' && !isBatchRunning && batchOrders.length === 0 ? (
                  queueItems.some((i) => i.status === 'RUNNING') ? (
                    <div className="space-y-4">
                      {queueItems
                        .filter((i) => i.status === 'RUNNING')
                        .map((task, idx) => {
                          const done = task.progress?.done || 0;
                          const total = task.progress?.total || (typeof task.targetLikes === 'number' ? task.targetLikes : 1);
                          const pct = Math.min(100, Math.max(0, Math.round((done / Math.max(1, total)) * 100)));
                          const successCount = task.progress?.success ?? (task.pageDetails?.filter((p: any) => p.status === 'SUCCESS').length || 0);
                          const failedCount = task.pageDetails?.filter((p: any) => p.status === 'FAILED' || p.status === 'ERROR').length || 0;
                          const rObj = REACTIONS.find((r) => r.key === task.reactionType) || REACTIONS[0];
                          const timing = (() => {
                            const started = task.startedAt ? new Date(task.startedAt).getTime() : 0;
                            if (!started) return null;
                            const elapsed = Math.max(0, (Date.now() - started) / 1000);
                            const remaining = done > 0 && total > done ? (elapsed / done) * (total - done) : null;
                            return { elapsed, remaining };
                          })();

                          return (
                            <div key={task.id || idx} className="app-surface p-5 rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-cyan-950/20 to-slate-900/60 space-y-4 shadow-xl">
                              {/* Header Card */}
                              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                                <div className="space-y-1.5 min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Tag color="cyan" className="font-bold text-xs px-2.5 py-0.5 rounded-full border-cyan-500/40">
                                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse inline-block mr-1.5 align-middle" />
                                      Hàng đợi tự động (Worker {idx + 1})
                                    </Tag>
                                    <Tag className="font-semibold text-xs rounded-full">
                                      {rObj.emoji} {rObj.shortLabel}
                                    </Tag>
                                    {task.viaName && (
                                      <Tag color="blue" className="text-xs rounded-full">
                                        Via: {task.viaName}
                                      </Tag>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 pt-1">
                                    <span className="text-xs text-slate-400 shrink-0">Link bài viết:</span>
                                    <a
                                      href={task.targetUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="font-mono text-sm text-cyan-300 hover:text-cyan-200 truncate underline max-w-xl"
                                    >
                                      {task.targetUrl}
                                    </a>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Button
                                    size="small"
                                    onClick={() => setActiveTabKey('buff-queue')}
                                    className="rounded-xl text-xs"
                                  >
                                    Xem hàng đợi
                                  </Button>
                                  <Button
                                    size="small"
                                    type="primary"
                                    ghost
                                    icon={<ExportOutlined />}
                                    onClick={() => window.open(task.targetUrl, '_blank')}
                                    className="rounded-xl text-xs"
                                  >
                                    Mở Facebook
                                  </Button>
                                </div>
                              </div>

                              {/* Metrics */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-center">
                                  <div className="text-[11px] text-slate-400 font-bold uppercase">Mục tiêu</div>
                                  <div className="text-xl font-bold text-slate-100 mt-0.5">{total} Page</div>
                                </div>
                                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-center">
                                  <div className="text-[11px] text-emerald-400 font-bold uppercase">Thành công</div>
                                  <div className="text-xl font-bold text-emerald-300 mt-0.5">{successCount}</div>
                                </div>
                                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-center">
                                  <div className="text-[11px] text-rose-400 font-bold uppercase">Lỗi / Bỏ qua</div>
                                  <div className="text-xl font-bold text-rose-300 mt-0.5">{failedCount}</div>
                                </div>
                                <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 text-center">
                                  <div className="text-[11px] text-blue-400 font-bold uppercase">Chờ thực hiện</div>
                                  <div className="text-xl font-bold text-blue-300 mt-0.5">{Math.max(0, total - done)}</div>
                                </div>
                              </div>

                              {/* Progress bar */}
                              <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-300 font-semibold">
                                    Tiến độ: <b className="text-cyan-400">{done}</b> / {total} Fanpage ({pct}%)
                                  </span>
                                  {timing && (
                                    <span className="text-slate-400 font-mono text-[11px]">
                                      Đã chạy {formatDuration(timing.elapsed)}
                                      {timing.remaining !== null && ` · còn ~${formatDuration(timing.remaining)}`}
                                    </span>
                                  )}
                                </div>
                                <Progress
                                  percent={pct}
                                  status="active"
                                  strokeColor={{ '0%': '#06b6d4', '100%': '#3b82f6' }}
                                  showInfo={false}
                                  className="m-0"
                                />
                              </div>

                              {/* Recent Fanpage Activities (Last 10) */}
                              {task.pageDetails && task.pageDetails.length > 0 && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                                    <span>Fanpage vừa tương tác ({task.pageDetails.length} đã xong):</span>
                                    <span className="text-[11px]">Tự động cập nhật thời gian thực</span>
                                  </div>
                                  <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/80 divide-y divide-slate-800/60">
                                    {[...task.pageDetails].reverse().slice(0, 10).map((p: any, pIdx: number) => (
                                      <div key={pIdx} className="px-3 py-2 flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-2 truncate">
                                          <span className="text-slate-500 font-mono text-[11px]">#{task.pageDetails.length - pIdx}</span>
                                          <span className="font-semibold text-slate-200 truncate">{p.pageName || p.pageId || 'Fanpage'}</span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          {p.status === 'SUCCESS' ? (
                                            <Tag color="success" className="text-[10px] m-0 border-0">
                                              ✅ Thành công
                                            </Tag>
                                          ) : (
                                            <Tag color="error" className="text-[10px] m-0 border-0">
                                              ❌ {p.error || 'Lỗi'}
                                            </Tag>
                                          )}
                                          <span className="text-[11px] font-mono text-slate-500">{p.time || 'vừa xong'}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}

                      {/* Next queued tasks teaser */}
                      {queueItems.filter((i) => i.status === 'QUEUED').length > 0 && (
                        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs">
                          <span className="text-slate-300">
                            ⏳ Có <b>{queueItems.filter((i) => i.status === 'QUEUED').length}</b> bài viết tiếp theo đang chờ trong hàng đợi
                          </span>
                          <Button size="small" type="link" onClick={() => setActiveTabKey('buff-queue')} className="text-cyan-400 p-0 text-xs">
                            Quản lý toàn bộ hàng đợi →
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-6 max-w-2xl mx-auto">
                      {/* Thẻ Chiến dịch vừa hoàn thành gần nhất */}
                      {buffLogs && buffLogs.length > 0 && (
                        <div className="app-surface p-5 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/20 via-slate-900/60 to-slate-900/80 shadow-xl space-y-3.5">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Tag color="success" className="font-bold text-xs px-2.5 py-0.5 rounded-full border-emerald-500/40">
                                <CheckCircleOutlined className="mr-1" />
                                Bài viết vừa hoàn thành phiên chạy
                              </Tag>
                              <span className="text-xs text-slate-400">
                                {new Date(buffLogs[0].createdAt).toLocaleTimeString('vi-VN')}
                              </span>
                            </div>
                            <Button
                              size="small"
                              type="link"
                              icon={<HistoryOutlined />}
                              onClick={() => setActiveTabKey('buff-history')}
                              className="text-cyan-400 p-0 text-xs hover:text-cyan-300"
                            >
                              Xem toàn bộ Lịch sử ({buffLogs.length}) →
                            </Button>
                          </div>

                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                                <span>Bài viết:</span>
                                <span className="font-semibold text-slate-200">
                                  {buffLogs[0].reactionType || 'LIKE'}
                                </span>
                              </div>
                              <a
                                href={buffLogs[0].targetUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-sm text-cyan-300 hover:text-cyan-200 truncate underline block max-w-md"
                              >
                                {buffLogs[0].targetUrl}
                              </a>
                            </div>

                            <div className="flex items-center gap-4 shrink-0">
                              <div className="text-right">
                                <div className="text-[11px] text-slate-400">Đã Like thành công</div>
                                <div className="text-xl font-bold text-emerald-400">
                                  {buffLogs[0].successCount} <span className="text-xs font-normal text-slate-400">lượt</span>
                                </div>
                              </div>

                              <Button
                                size="middle"
                                type="primary"
                                icon={<ThunderboltOutlined />}
                                loading={isResumingRemaining}
                                onClick={() => handleResumeRemaining(buffLogs[0])}
                                className="font-semibold text-xs rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border-none shadow-md shadow-cyan-600/20"
                              >
                                🚀 Tiếp tục chạy thêm like
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Empty State Banner */}
                      <div className="app-surface p-10 text-center space-y-4 rounded-2xl border border-dashed border-slate-800">
                        <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-950/60 border border-blue-500/30 flex items-center justify-center text-2xl text-blue-400 shadow-lg shadow-blue-500/10">
                          <PlayCircleOutlined />
                        </div>
                        <div className="space-y-1.5">
                          <h3 className="text-base font-bold text-slate-100">Hiện tại chưa có tiến trình nào đang chạy</h3>
                          <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
                            Khi bạn bấm <b>Bắt đầu</b> ở tab Tạo mới hoặc khi các bài trong Hàng đợi đến lượt chạy, toàn bộ tiến trình real-time của từng Fanpage/Via sẽ hiển thị chi tiết tại đây.
                          </p>
                        </div>
                        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                          <Button
                            type="primary"
                            size="large"
                            icon={<PlusOutlined />}
                            onClick={() => setActiveTabKey('buff-like')}
                            className="font-semibold rounded-xl text-xs sm:text-sm"
                          >
                            Tạo chiến dịch mới ngay
                          </Button>
                          {queueItems.filter((i) => i.status === 'QUEUED').length > 0 && (
                            <Button
                              size="large"
                              icon={<ClockCircleOutlined />}
                              onClick={() => setActiveTabKey('buff-queue')}
                              className="font-semibold rounded-xl text-amber-300 border-amber-500/40 bg-amber-950/30 text-xs sm:text-sm"
                            >
                              Xem hàng đợi ({queueItems.filter((i) => i.status === 'QUEUED').length} chờ)
                            </Button>
                          )}
                          {buffLogs.length > 0 && (
                            <Button
                              size="large"
                              icon={<HistoryOutlined />}
                              onClick={() => setActiveTabKey('buff-history')}
                              className="font-semibold rounded-xl text-xs sm:text-sm"
                            >
                              Xem lịch sử ({buffLogs.length})
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="space-y-4">
                    {/* Post Meta & Timing Banner */}
                    <div className="app-surface p-4 sm:p-5 space-y-4">
                      {/* Banner Header: Phân biệt chế độ BATCH vs SINGLE */}
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                        <div className="min-w-0 flex-1">
                          {buffMode === 'BATCH' && batchOrders.length > 0 ? (
                            <div>
                              <div className="text-xs text-slate-400 font-medium flex items-center gap-2">
                                <span>Chiến dịch tương tác nhiều bài viết (Batch Mode):</span>
                                <Tag color="cyan" className="m-0 text-[10px] font-bold border-0 px-2 py-0.5 rounded-full">
                                  {batchLinkConcurrency === 2 ? '⚡ Chạy song song 2 bài' : '🛡️ Chạy tuần tự 1 bài'}
                                </Tag>
                              </div>
                              {(() => {
                                const completedCount = batchOrders.filter((o) => o.status === 'COMPLETED').length;
                                const partialCount = batchOrders.filter((o) => o.status === 'PARTIAL').length;
                                const runningCount = batchOrders.filter((o) => o.status === 'RUNNING').length;
                                return (
                                  <div className="flex items-center gap-2.5 mt-1 flex-wrap">
                                    <span className="text-sm sm:text-base font-bold text-slate-100">
                                      Đã hoàn tất <b className="text-emerald-400">{completedCount}</b> / {batchOrders.length} bài viết
                                      {partialCount > 0 && (
                                        <span className="text-amber-400 font-semibold ml-2 text-xs sm:text-sm">
                                          ({partialCount} bài cần bù like)
                                        </span>
                                      )}
                                    </span>
                                    {runningCount > 0 && (
                                      <span className="text-[11px] text-cyan-300 font-semibold bg-cyan-950/70 border border-cyan-800/70 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse">
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                        {runningCount} bài đang chạy đồng thời
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="text-xs text-slate-400 font-medium">Bài viết đang tương tác:</div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono font-bold text-blue-300 truncate max-w-xl">
                                  {runningTargetInfo?.url || targetPostUrl || 'Bài viết Facebook'}
                                </span>
                                {(runningTargetInfo?.url || targetPostUrl) && (
                                  <Button
                                    type="text"
                                    size="small"
                                    icon={<ExportOutlined />}
                                    onClick={() => window.open(runningTargetInfo?.url || targetPostUrl, '_blank')}
                                    className="text-blue-400 hover:text-blue-300 text-xs shrink-0 p-1 h-auto"
                                    title="Mở link trên Facebook"
                                  >
                                    Mở Facebook
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Top-Right Info & ETA Card (Style chuẩn theo mẫu bài đăng) */}
                        {(() => {
                          const isBatch = (buffMode === 'BATCH' || batchOrders.length > 0) && batchOrders.length > 0;
                          const batchTotal = isBatch
                            ? batchOrders.reduce((s, o) => s + (o.totalLikesTarget || 0), 0)
                            : autoBuffProgress.total;
                          const batchDone = isBatch
                            ? batchOrders.reduce((s, o) => s + (o.successLikes || 0), 0)
                            : autoBuffProgress.success;
                          const overallPercent =
                            isBatch && batchTotal > 0
                              ? Math.min(100, Math.round((batchDone / batchTotal) * 100))
                              : autoBuffProgress.percent;

                          const isAllBatchOrdersDone = isBatch && batchOrders.length > 0 && batchOrders.every((o) => o.status === 'COMPLETED' || o.status === 'PARTIAL' || o.status === 'FAILED' || o.status === 'PAUSED');
                          const waitingCount = autoBuffProgress.details.filter((d) => d.status === 'WAITING').length;
                          const runningCount = autoBuffProgress.details.filter((d) => d.status === 'RUNNING').length;
                          const isWaitingOrRunning = waitingCount > 0 || runningCount > 0;
                          const isCooling = Boolean(autoBuffProgress.currentRunningPageName?.includes('🛡️'));
                          const isSingleRunning = autoBuffProgress.status === 'RUNNING' || isCooling;
                          const isAnyRunning = isBatch ? (isBatchRunning && !isAllBatchOrdersDone) : isSingleRunning;
                          const isDoneFull = isBatch ? (isAllBatchOrdersDone && batchDone >= batchTotal) : (autoBuffProgress.status === 'DONE' || overallPercent >= 100);
                          const isExhausted = !isAnyRunning && !isDoneFull && (
                            isBatch
                              ? (isAllBatchOrdersDone && batchDone < batchTotal)
                              : (autoBuffProgress.details.length > 0 && !isWaitingOrRunning)
                          );

                          const elapsedSec = Math.max(0, Math.round(((runTiming.end || clockNow) - (runTiming.start || clockNow)) / 1000));
                          const avgSecPerNick = Math.max(8, Math.round(((delayMs || 6000) + 4000) / 1000));
                          const remainingItems = isBatch
                            ? Math.max(0, batchTotal - batchDone)
                            : Math.max(0, autoBuffProgress.details.length > 0 ? (waitingCount + runningCount) : Math.max(0, autoBuffProgress.total - (autoBuffProgress.success + autoBuffProgress.alreadyLiked)));
                          const estimatedRemainingSec = isAnyRunning ? remainingItems * avgSecPerNick : 0;
                          const totalEstimatedSec = Math.max(elapsedSec + estimatedRemainingSec, (isBatch ? batchTotal : (autoBuffProgress.total || 1)) * avgSecPerNick);

                          return (
                            <div className="flex flex-wrap items-center gap-3 shrink-0 text-xs">
                              {/* Cảm xúc & Mục tiêu Tags */}
                              <div className="flex flex-col gap-1.5">
                                <div className="px-3 py-1 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center gap-1.5">
                                  <span className="text-slate-400">Cảm xúc:</span>
                                  <span className="font-bold text-slate-100">
                                    {(() => {
                                      const rxKey = runningTargetInfo?.reaction || selectedReaction;
                                      const r = REACTIONS.find((x) => x.key === rxKey);
                                      return r ? `${r.emoji} ${r.label}` : rxKey;
                                    })()}
                                  </span>
                                </div>
                                <div className="px-3 py-1 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center gap-1.5">
                                  <span className="text-slate-400">Mục tiêu:</span>
                                  <span className="font-bold text-slate-100 tabular-nums">
                                    {isBatch
                                      ? `${batchTotal} like (${batchOrders.length} link)`
                                      : `${autoBuffProgress.total || runningTargetInfo?.count || 0} nick`}
                                  </span>
                                </div>
                              </div>

                              {/* Card Thời gian & Tiến độ chuẩn y hệt mẫu Ảnh 2 */}
                              {runTiming.start && (
                                <div className="p-2.5 rounded-xl bg-slate-950/90 border border-cyan-500/40 shadow-lg shadow-cyan-950/40 min-w-[170px] space-y-1">
                                  <div className="flex items-center justify-between text-[11px] font-bold pb-0.5">
                                    {isAnyRunning ? (
                                      <span className="flex items-center gap-1.5 text-cyan-300">
                                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                                        ĐANG CHẠY
                                      </span>
                                    ) : isDoneFull ? (
                                      <span className="flex items-center gap-1.5 text-emerald-300">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                        HOÀN THÀNH
                                      </span>
                                    ) : autoBuffProgress.status === 'ERROR' ? (
                                      <span className="flex items-center gap-1.5 text-amber-300">
                                        <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                                        TẠM NGẮT
                                      </span>
                                    ) : (
                                      <span className="flex items-center gap-1.5 text-amber-300">
                                        <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                                        {isExhausted ? 'HẾT NICK' : 'ĐÃ DỪNG'}
                                      </span>
                                    )}
                                    <span className="text-slate-400 font-mono text-[10px]">~{totalEstimatedSec}s</span>
                                  </div>

                                  <div className="flex items-baseline justify-between py-0.5">
                                    <span className="text-lg font-mono font-extrabold text-white tabular-nums">
                                      {formatDuration(elapsedSec)}
                                    </span>
                                    <span className="text-xs font-mono font-extrabold text-cyan-300">
                                      {overallPercent}%
                                    </span>
                                  </div>

                                  <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-300 ${
                                        isDoneFull
                                          ? 'bg-emerald-400'
                                          : isAnyRunning
                                          ? 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                                          : 'bg-amber-400'
                                      }`}
                                      style={{ width: `${overallPercent}%` }}
                                    ></div>
                                  </div>

                                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-0.5">
                                    <span>{isAnyRunning ? `Ước tính: Còn ~${estimatedRemainingSec}s` : (isDoneFull ? 'Đã hoàn tất mục tiêu' : 'Đã kết thúc')}</span>
                                    <button
                                      type="button"
                                      onClick={() => setShowLiveTerminal((prev) => !prev)}
                                      className="text-cyan-400 hover:text-cyan-300 text-[10px] flex items-center gap-0.5 cursor-pointer"
                                      title="Xem nhật ký chi tiết"
                                    >
                                      <CodeOutlined /> Log
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Glowing Live Progress Bar & Status Pill Badge */}
                      {(() => {
                        const isBatch = (buffMode === 'BATCH' || batchOrders.length > 0) && batchOrders.length > 0;
                        const batchTotal = isBatch
                          ? batchOrders.reduce((s, o) => s + (o.totalLikesTarget || 0), 0)
                          : autoBuffProgress.total;
                        const batchDone = isBatch
                          ? batchOrders.reduce((s, o) => s + (o.successLikes || 0), 0)
                          : autoBuffProgress.success;
                        const overallPercent =
                          isBatch && batchTotal > 0
                            ? Math.min(100, Math.round((batchDone / batchTotal) * 100))
                            : autoBuffProgress.percent;

                        const isAllBatchOrdersDone = isBatch && batchOrders.length > 0 && batchOrders.every((o) => o.status === 'COMPLETED' || o.status === 'PARTIAL' || o.status === 'FAILED' || o.status === 'PAUSED');
                        const waitingCount = autoBuffProgress.details.filter((d) => d.status === 'WAITING').length;
                        const runningCount = autoBuffProgress.details.filter((d) => d.status === 'RUNNING').length;
                        const isWaitingOrRunning = waitingCount > 0 || runningCount > 0;
                        const isCooling = Boolean(autoBuffProgress.currentRunningPageName?.includes('🛡️'));
                        const isSingleRunning = autoBuffProgress.status === 'RUNNING' || isCooling;
                        const isAnyRunning = isBatch ? (isBatchRunning && !isAllBatchOrdersDone) : isSingleRunning;
                        const isDoneFull = isBatch ? (isAllBatchOrdersDone && batchDone >= batchTotal) : (autoBuffProgress.status === 'DONE' || overallPercent >= 100);
                        const isExhausted = !isAnyRunning && !isDoneFull && (
                          isBatch
                            ? (isAllBatchOrdersDone && batchDone < batchTotal)
                            : (autoBuffProgress.details.length > 0 && !isWaitingOrRunning)
                        );
                        const elapsedSec = Math.max(0, Math.round(((runTiming.end || clockNow) - (runTiming.start || clockNow)) / 1000));
                        const totalBatchLikesTarget = batchOrders.reduce((sum, o) => sum + (o.totalLikesTarget || 0), 0);
                        const totalBatchSuccess = batchOrders.reduce((sum, o) => sum + (o.successLikes || 0), 0);
                        const totalBatchAlreadyLiked = batchOrders.reduce((sum, o) => sum + (o.details?.filter((d) => d.status === 'ALREADY_LIKED').length || 0), 0);
                        const totalBatchFailed = batchOrders.reduce((sum, o) => sum + (o.details?.filter((d) => d.status === 'FAILED' || d.status === 'ERROR').length || 0), 0);
                        const currentSuccessCount = isBatch ? totalBatchSuccess : (autoBuffProgress.success || 0);
                        const speedLikesPerMin = elapsedSec >= 4 && currentSuccessCount > 0 ? Math.round((currentSuccessCount / elapsedSec) * 60) : 0;
                        const speedSecPerLike = currentSuccessCount > 0 && elapsedSec > 0 ? (elapsedSec / currentSuccessCount).toFixed(1) : '0';

                        return (
                          <div className="space-y-3">
                            {/* Alert hạ nhiệt nếu có */}
                            {autoBuffProgress.currentRunningPageName?.includes('🛡️') && (
                              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs shadow-md animate-pulse">
                                <ThunderboltFilled className="text-amber-400 text-sm flex-shrink-0" />
                                <span className="font-semibold">{autoBuffProgress.currentRunningPageName}</span>
                              </div>
                            )}

                            {/* Status Pill Badge & Hành động chi tiết (Thiết kế đồng bộ Ảnh 2) */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex items-start sm:items-center gap-2.5">
                                {/* Pill Badge */}
                                {isAnyRunning ? (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-950/70 border border-cyan-500/50 text-cyan-300 text-xs font-bold shadow-sm shadow-cyan-950/50">
                                    <LoadingOutlined spin className="text-cyan-400" />
                                    <span>Đang tương tác ({elapsedSec}s)</span>
                                  </div>
                                ) : isDoneFull ? (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 text-xs font-bold shadow-sm shadow-emerald-950/50">
                                    <CheckCircleFilled className="text-emerald-400" />
                                    <span>Hoàn thành 100% ({elapsedSec}s)</span>
                                  </div>
                                ) : autoBuffProgress.status === 'ERROR' ? (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-950/70 border border-amber-500/50 text-amber-300 text-xs font-bold shadow-sm shadow-amber-950/50">
                                    <span>⚠️ Tạm ngắt quãng ({elapsedSec}s)</span>
                                  </div>
                                ) : isExhausted ? (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-950/70 border border-amber-500/50 text-amber-300 text-xs font-bold shadow-sm shadow-amber-950/50">
                                    <span>🏁 Đã duyệt hết nick ({autoBuffProgress.details.length} nick)</span>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-950/70 border border-rose-500/50 text-rose-300 text-xs font-bold">
                                    <span>🛑 Đã dừng tiến trình ({elapsedSec}s)</span>
                                  </div>
                                )}

                                {/* Subtext mô tả chi tiết công việc Playwright đang thực hiện */}
                                <div className="text-xs text-slate-300">
                                  {isBatch ? (
                                    isBatchRunning ? (
                                      <span>Tiến độ toàn Batch: <b className="text-white font-bold">{batchDone}/{batchTotal} like hoàn tất</b></span>
                                    ) : isDoneFull ? (
                                      <span className="text-emerald-300 font-semibold">100% mục tiêu Batch đã hoàn tất</span>
                                    ) : (
                                      <span>Trạng thái Batch: <b className="text-white font-bold">Đã đạt {batchDone}/{batchTotal} like</b></span>
                                    )
                                  ) : isAnyRunning ? (
                                    <span>
                                      Playwright đang xử lý: <b className="text-cyan-300 font-bold">{autoBuffProgress.currentRunningPageName || 'Đang mở bài viết & kiểm tra nút like...'}</b>
                                    </span>
                                  ) : isDoneFull ? (
                                    <span className="text-emerald-300 font-semibold">
                                      🎉 Đã đạt mục tiêu KPI: {autoBuffProgress.success} Like thành công
                                    </span>
                                  ) : autoBuffProgress.status === 'ERROR' ? (
                                    <span className="text-amber-300 font-medium">
                                      Tiến trình tạm ngắt quãng do server khởi động lại. Đã like thành công {autoBuffProgress.success}/{autoBuffProgress.total} like. Bấm nút "Tiếp tục chạy nốt" bên dưới để hoàn tất {autoBuffProgress.total - autoBuffProgress.success} like còn thiếu!
                                    </span>
                                  ) : isExhausted ? (
                                    <span className="text-amber-300 font-medium flex items-center gap-1.5 flex-wrap">
                                      <span>
                                        Đã duyệt xong {autoBuffProgress.details.length} nick trong đợt này (Đạt <b className="text-emerald-300">{autoBuffProgress.success} like thành công</b>{autoBuffProgress.alreadyLiked > 0 ? `, ${autoBuffProgress.alreadyLiked} like trước` : ''}).
                                        {autoBuffProgress.total > autoBuffProgress.success && (
                                          <> Còn thiếu <b className="text-amber-300 font-bold">{(autoBuffProgress.total || 0) - (autoBuffProgress.success || 0)} like</b> để đủ {autoBuffProgress.total} KPI.</>
                                        )}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenManagePages(selectedAccountId)}
                                        className="text-cyan-300 hover:text-cyan-200 underline font-bold cursor-pointer ml-1 inline-flex items-center gap-1"
                                      >
                                        <PlusOutlined className="text-[10px]" /> Bổ sung thêm Via / Page ngay tại đây
                                      </button>
                                    </span>
                                  ) : (
                                    <span className="text-slate-400 font-medium">
                                      {autoBuffProgress.currentRunningPageName || 'Tiến trình đã được dừng an toàn.'}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {currentSuccessCount > 0 && speedLikesPerMin > 0 && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-800/80 text-cyan-300 font-mono text-xs font-bold shrink-0">
                                    <ThunderboltOutlined className="text-amber-400" />
                                    <span>{speedLikesPerMin} like/phút</span>
                                    <span className="text-slate-500">•</span>
                                    <span className="text-slate-300">~{speedSecPerLike}s/lượt</span>
                                  </span>
                                )}
                                <span className="font-mono text-base font-extrabold text-cyan-300 shrink-0">
                                  {overallPercent}%
                                </span>
                              </div>
                            </div>

                            <Progress
                              percent={overallPercent}
                              status={isAnyRunning ? 'active' : undefined}
                              strokeColor={{ '0%': '#06b6d4', '100%': '#10b981' }}
                              size={['100%', 10]}
                              showInfo={false}
                            />
                          </div>
                        );
                      })()}

                      {/* 4 KPI Metrics */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                        <div className="p-3.5 rounded-xl border bg-slate-950/80 border-slate-800 text-center">
                          <div className="text-xs text-slate-400 font-medium">
                            {isBatch ? 'Tổng like mục tiêu' : 'Tổng số nick'}
                          </div>
                          <div className="text-2xl font-extrabold text-slate-100 tabular-nums mt-1">
                            {isBatch ? `${totalBatchLikesTarget}` : (autoBuffProgress.total || 0)}
                          </div>
                          {isBatch && (
                            <div className="text-[10px] text-slate-400 mt-0.5 font-medium">{batchOrders.length} bài viết</div>
                          )}
                        </div>
                        <div className="p-3.5 rounded-xl border bg-emerald-950/40 border-emerald-800/50 text-center">
                          <div className="text-xs text-emerald-400 font-medium">Thành công</div>
                          <div className="text-2xl font-extrabold text-emerald-300 tabular-nums mt-1">
                            {isBatch ? totalBatchSuccess : (autoBuffProgress.success || 0)}
                          </div>
                          {isBatch && totalBatchLikesTarget > 0 && (
                            <div className="text-[10px] text-emerald-400 mt-0.5 font-medium">
                              Đạt {Math.min(100, Math.round((totalBatchSuccess / Math.max(1, totalBatchLikesTarget)) * 100))}%
                              {totalBatchSuccess > totalBatchLikesTarget && ' (Vượt KPI)'}
                            </div>
                          )}
                        </div>
                        <div className="p-3.5 rounded-xl border bg-blue-950/40 border-blue-800/50 text-center">
                          <div className="text-xs text-blue-400 font-medium">Đã like trước</div>
                          <div className="text-2xl font-extrabold text-blue-300 tabular-nums mt-1">
                            {isBatch ? totalBatchAlreadyLiked : (autoBuffProgress.alreadyLiked || 0)}
                          </div>
                        </div>
                        <div className={`p-3.5 rounded-xl border text-center ${
                          isBatch && totalBatchLikesTarget > totalBatchSuccess
                            ? 'bg-amber-950/40 border-amber-800/50'
                            : 'bg-rose-950/40 border-rose-800/50'
                        }`}>
                          <div className={`text-xs font-medium ${
                            isBatch && totalBatchLikesTarget > totalBatchSuccess ? 'text-amber-400' : 'text-rose-400'
                          }`}>
                            {isBatch && totalBatchLikesTarget > totalBatchSuccess ? 'Còn thiếu / Cần bù' : 'Lỗi / Bỏ qua'}
                          </div>
                          <div className={`text-2xl font-extrabold tabular-nums mt-1 ${
                            isBatch && totalBatchLikesTarget > totalBatchSuccess ? 'text-amber-300' : 'text-rose-300'
                          }`}>
                            {isBatch && totalBatchLikesTarget > totalBatchSuccess
                              ? totalBatchLikesTarget - totalBatchSuccess
                              : (isBatch ? totalBatchFailed : (autoBuffProgress.failed || 0))}
                          </div>
                          {isBatch && totalBatchLikesTarget > totalBatchSuccess && (
                            <div className="text-[10px] text-amber-400 mt-0.5 font-medium">
                              Thiếu {totalBatchLikesTarget - totalBatchSuccess} like
                            </div>
                          )}
                        </div>
                      </div>

                      {/* If DONE, ERROR or STOPPED: Action & Summary Box (Only show when NOT RUNNING) */}
                      {autoBuffProgress.status !== 'RUNNING' && !isBatchRunning && (autoBuffProgress.status === 'DONE' || autoBuffProgress.status === 'ERROR' || autoBuffProgress.status === 'STOPPED' || (isBatch ? (totalBatchSuccess > 0 || batchOrders.some((o) => o.status === 'COMPLETED' || o.status === 'PARTIAL')) : (autoBuffProgress.details.length > 0 && (autoBuffProgress.total || 0) > 0))) && (() => {
                        const success = isBatch ? totalBatchSuccess : (autoBuffProgress.success || 0);
                        const total = isBatch ? totalBatchLikesTarget : (autoBuffProgress.total || 0);
                        const failed = isBatch ? totalBatchFailed : (autoBuffProgress.failed || 0);
                        const isExhaustedBox = isBatch ? (totalBatchSuccess < totalBatchLikesTarget) : (autoBuffProgress.details.length > 0 && success + failed < total && total > 0);
                        const isError = autoBuffProgress.status === 'ERROR';
                        const isStopped = Boolean(autoBuffProgress.isStopped || autoBuffProgress.status === 'STOPPED' || isExhaustedBox);
                        const isHighFailure = failed > success || failed >= 5 || isError;
                        const missingLikes = Math.max(0, total - success);

                        if (isHighFailure || isStopped || isError || isExhaustedBox || success < total) {
                          const bannerTitle = isError
                            ? 'Chiến dịch tạm ngắt quãng do kết nối'
                            : isBatch
                            ? (success < total ? `Chiến dịch Batch hoàn tất một phần (${success}/${total} like - Đạt ${Math.round((success / Math.max(1, total)) * 100)}%)` : 'Chiến dịch Batch đã hoàn tất')
                            : isExhaustedBox
                            ? 'Chiến dịch tạm dừng do đã duyệt hết nick hiện có'
                            : isStopped
                            ? 'Chiến dịch đã dừng / kết thúc sớm'
                            : success < total
                            ? `Chiến dịch hoàn tất một phần (${success}/${total} like)`
                            : 'Chiến dịch hoàn tất có cảnh báo lỗi';
                          return (
                            <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl text-amber-400 shrink-0">
                                  {isError ? '⚠️' : success < total ? 'ℹ️' : '⏸️'}
                                </div>
                                <div>
                                  <div className="text-sm font-bold text-amber-300">
                                    {bannerTitle}
                                  </div>
                                  <div className="text-xs text-slate-400">
                                    Đã like thành công: <span className="text-emerald-400 font-semibold">{success}</span>/{total}
                                    {missingLikes > 0 && <> • Còn thiếu: <span className="text-amber-400 font-bold">{missingLikes} like</span></>}
                                    {failed > 0 && <> • Lỗi/bỏ qua: <span className="text-rose-400 font-semibold">{failed}</span></>}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                {isBatch && missingLikes > 0 && (
                                  <Button
                                    type="primary"
                                    icon={<ThunderboltOutlined />}
                                    onClick={handleRefillBatchIncomplete}
                                    className="font-semibold text-xs rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 border-none shadow-md shadow-amber-600/20"
                                  >
                                    🚀 Bù like cho các bài còn thiếu ({missingLikes} like)
                                  </Button>
                                )}
                                {!isBatch && missingLikes > 0 && (runningTargetInfo?.url || targetPostUrl) && (
                                  <Button
                                    type="primary"
                                    icon={<ThunderboltOutlined />}
                                    loading={isResumingRemaining}
                                    onClick={handleResumeRemaining}
                                    className="font-semibold text-xs rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border-none shadow-md shadow-cyan-600/20"
                                  >
                                    🚀 Tiếp tục chạy nốt ({missingLikes} like)
                                  </Button>
                                )}
                                <Button
                                  icon={<PlusOutlined />}
                                  onClick={() => handleOpenManagePages(selectedAccountId)}
                                  className="font-semibold text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                                >
                                  ➕ Bổ sung Via / Page
                                </Button>
                                {(runningTargetInfo?.url || targetPostUrl) && (
                                  <Button
                                    icon={<ExportOutlined />}
                                    onClick={() => window.open(runningTargetInfo?.url || targetPostUrl, '_blank')}
                                    className="font-semibold text-xs rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                                  >
                                    Kiểm tra bài
                                  </Button>
                                )}
                                <Button
                                  icon={<HistoryOutlined />}
                                  onClick={() => setActiveTabKey('buff-history')}
                                  className="text-xs rounded-xl"
                                >
                                  Xem Lịch sử
                                </Button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-xl text-emerald-400 shrink-0">
                                🎉
                              </div>
                              <div>
                                <div className="text-sm font-bold text-emerald-300">Chiến dịch tương tác hoàn tất xuất sắc 100%!</div>
                                <div className="text-xs text-slate-400">
                                  Đã hoàn thành {success}/{total} like. Dữ liệu đã lưu vào Lịch sử và gửi thông báo Telegram.
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {(runningTargetInfo?.url || targetPostUrl) && (
                                <Button
                                  type="primary"
                                  icon={<ExportOutlined />}
                                  onClick={() => window.open(runningTargetInfo?.url || targetPostUrl, '_blank')}
                                  className="font-semibold text-xs rounded-xl"
                                >
                                  Kiểm tra trên Facebook
                                </Button>
                              )}
                              <Button
                                icon={<HistoryOutlined />}
                                onClick={() => setActiveTabKey('buff-history')}
                                className="text-xs rounded-xl"
                              >
                                Xem Lịch sử
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Batch Orders View (if batch mode) */}
                    {buffMode === 'BATCH' && batchOrders.length > 0 && (
                      <div className="app-surface p-4 sm:p-5 space-y-3">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
                          <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                            <span>Danh sách bài viết trong Batch ({batchOrders.length} bài)</span>
                            {batchLinkConcurrency === 2 && (
                              <Tag color="cyan" className="m-0 text-[10px] font-bold border-0 px-2 py-0.5 rounded-full">
                                ⚡ Song song 2 bài
                              </Tag>
                            )}
                          </div>
                          <span className="text-xs text-slate-400">
                            Hoàn tất <b className="text-emerald-400">{batchOrders.filter((o) => o.status === 'COMPLETED').length}</b> / {batchOrders.length}
                          </span>
                        </div>
                        <div className="space-y-2.5">
                          {batchOrders.map((order) => {
                            const isRunning = order.status === 'RUNNING';
                            const isExpanded = expandedBatchOrderIds.has(order.id);
                            const orderPercent =
                              order.percent ||
                              Math.round(((order.successLikes || 0) / Math.max(1, order.totalLikesTarget)) * 100);
                            return (
                              <div
                                key={order.id}
                                className={`p-3.5 rounded-xl border transition-all ${
                                  isRunning
                                    ? 'border-cyan-500/70 bg-gradient-to-r from-cyan-950/30 to-slate-950/80 shadow-md shadow-cyan-500/10'
                                    : order.status === 'COMPLETED'
                                    ? 'border-emerald-800/40 bg-slate-950/50'
                                    : order.status === 'FAILED'
                                    ? 'border-rose-800/40 bg-slate-950/50'
                                    : 'border-slate-800 bg-slate-950/40'
                                }`}
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-mono font-bold text-slate-200">
                                        #{order.orderNumber}
                                      </span>
                                      <a
                                        href={order.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs font-mono text-cyan-400 hover:underline truncate max-w-xs sm:max-w-md block"
                                        title={order.url}
                                      >
                                        {order.url.replace(/^https?:\/\/(www\.)?/, '')}
                                      </a>
                                      {isRunning && (
                                        <span className="flex items-center gap-1 text-[10px] px-2 py-0.2 rounded-full bg-cyan-900/60 text-cyan-300 border border-cyan-700/60 font-semibold animate-pulse shrink-0">
                                          ⚡ Đang chạy
                                        </span>
                                      )}
                                    </div>
                                    {order.currentRunningPageName && isRunning && (
                                      <div className="text-[11px] text-cyan-300 mt-1 flex items-center gap-1.5">
                                        <LoadingOutlined spin className="text-cyan-400 text-xs" />
                                        <span>Đang thực hiện: <b>{order.currentRunningPageName}</b></span>
                                      </div>
                                    )}
                                    {order.status === 'FAILED' && order.error && (
                                      <div className="text-[11px] text-rose-300 mt-1">{order.error}</div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-xs text-slate-300 font-mono font-semibold tabular-nums">
                                      {order.successLikes >= order.totalLikesTarget
                                        ? `${order.totalLikesTarget}/${order.totalLikesTarget} like`
                                        : `${order.successLikes}/${order.totalLikesTarget} like`}
                                      {order.successLikes > order.totalLikesTarget && (
                                        <span className="text-emerald-400 font-normal ml-1 text-[10px]">
                                          (+{order.successLikes - order.totalLikesTarget} like)
                                        </span>
                                      )}
                                    </span>
                                    {order.status === 'COMPLETED' ? (
                                      <Tag color="success" className="text-xs font-semibold m-0">
                                        ✅ Hoàn thành 100%
                                      </Tag>
                                    ) : order.status === 'PARTIAL' ? (
                                      <Tag color="warning" className="text-xs font-semibold m-0">
                                        ⚠️ Đạt {order.successLikes}/{order.totalLikesTarget} (Thiếu {order.totalLikesTarget - order.successLikes})
                                      </Tag>
                                    ) : isRunning ? (
                                      <Tag color="processing" className="text-xs font-semibold m-0">
                                        ⚡ Đang chạy ({orderPercent}%)
                                      </Tag>
                                    ) : order.status === 'FAILED' ? (
                                      <Tag color="error" className="text-xs font-semibold m-0">
                                        ❌ Thất bại
                                      </Tag>
                                    ) : order.status === 'PAUSED' ? (
                                      <Tag color="warning" className="text-xs font-semibold m-0">
                                        ⏸️ Tạm dừng
                                      </Tag>
                                    ) : (
                                      <Tag color="default" className="text-xs font-semibold m-0">
                                        ⏳ Chờ đến lượt
                                      </Tag>
                                    )}

                                    {order.successLikes < order.totalLikesTarget && (order.status === 'PARTIAL' || order.status === 'COMPLETED') && (
                                      <Button
                                        size="small"
                                        type="primary"
                                        icon={<ThunderboltOutlined />}
                                        onClick={() => handleRefillSingleOrder(order)}
                                        className="bg-amber-600 hover:bg-amber-500 border-none text-[11px] font-bold h-6 px-2 shrink-0 shadow-sm"
                                      >
                                        🚀 Bù {order.totalLikesTarget - order.successLikes} like
                                      </Button>
                                    )}
                                    {order.details && order.details.length > 0 && (
                                      <Button
                                        type="text"
                                        size="small"
                                        onClick={() => {
                                          setExpandedBatchOrderIds((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(order.id)) next.delete(order.id);
                                            else next.add(order.id);
                                            return next;
                                          });
                                        }}
                                        className="text-[11px] text-slate-400 hover:text-cyan-300 p-1 h-auto"
                                      >
                                        {isExpanded ? 'Ẩn chi tiết ▲' : 'Xem chi tiết ▼'}
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {/* Mini Progress bar */}
                                <Progress
                                  percent={orderPercent}
                                  size={['100%', 4]}
                                  showInfo={false}
                                  strokeColor={{ '0%': '#06b6d4', '100%': '#10b981' }}
                                  trailColor="#1e293b"
                                  className="m-0 mt-2"
                                />

                                {/* Expanded list of pages for this order */}
                                {isExpanded && order.details && (
                                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                    <div className="text-[11px] font-semibold text-slate-400 mb-1">
                                      Chi tiết Page/Via tham gia bài viết này ({order.details.length} tài khoản):
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                      {order.details.map((d, dIdx) => (
                                        <div
                                          key={d.pageId + dIdx}
                                          className={`px-2 py-1.5 rounded-lg border text-[11px] flex items-center justify-between gap-1.5 ${
                                            d.status === 'SUCCESS' || d.status === 'ALREADY_LIKED'
                                              ? 'border-emerald-800/40 bg-emerald-950/20 text-emerald-300'
                                              : d.status === 'RUNNING'
                                              ? 'border-cyan-600/60 bg-cyan-950/40 text-cyan-200'
                                              : d.status === 'ERROR' || d.status === 'FAILED'
                                              ? 'border-rose-800/40 bg-rose-950/20 text-rose-300'
                                              : 'border-slate-800/60 bg-slate-900/40 text-slate-400'
                                          }`}
                                        >
                                          <div className="truncate">
                                            <span className="font-semibold">{cleanPageName(d.pageName)}</span>
                                            {d.viaName && <span className="text-[9px] text-slate-500 ml-1">({d.viaName})</span>}
                                          </div>
                                          <span className="shrink-0 font-medium">
                                            {d.status === 'SUCCESS'
                                              ? '✅ Thành công'
                                              : d.status === 'ALREADY_LIKED'
                                              ? '👍 Đã like'
                                              : d.status === 'RUNNING'
                                              ? '⚡ Đang like...'
                                              : d.status === 'ERROR' || d.status === 'FAILED'
                                              ? '❌ Lỗi'
                                              : '⏳ Chờ'}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Detailed Live Accounts Execution Feed */}
                    <div className="app-surface p-4 sm:p-5 space-y-4">
                      {/* Filter & Search Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[
                            { key: 'ALL', label: 'Tất cả', count: autoBuffProgress.details.length },
                            { key: 'RUNNING', label: 'Đang chạy', count: autoBuffProgress.details.filter((d) => d.status === 'RUNNING').length },
                            { key: 'SUCCESS', label: 'Thành công', count: autoBuffProgress.details.filter((d) => d.status === 'SUCCESS').length },
                            { key: 'ALREADY_LIKED', label: 'Đã like trước', count: autoBuffProgress.details.filter((d) => d.status === 'ALREADY_LIKED').length },
                            { key: 'FAILED', label: 'Lỗi', count: autoBuffProgress.details.filter((d) => d.status === 'ERROR' || d.status === 'NO_BUTTON' || d.status === 'FAILED').length },
                            { key: 'WAITING', label: 'Chờ lượt', count: autoBuffProgress.details.filter((d) => d.status === 'WAITING').length },
                          ].map((f) => (
                            <button
                              key={f.key}
                              type="button"
                              onClick={() => setRunningFilter(f.key as any)}
                              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                runningFilter === f.key
                                  ? 'bg-blue-600 text-white shadow-sm'
                                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                              }`}
                            >
                              {f.label} ({f.count})
                            </button>
                          ))}
                        </div>

                        <div className="w-full sm:w-56">
                          <Input
                            placeholder="Tìm kiếm tài khoản..."
                            prefix={<SearchOutlined className="text-slate-500" />}
                            size="small"
                            value={runningSearch}
                            onChange={(e) => setRunningSearch(e.target.value)}
                            allowClear
                            className="rounded-lg"
                          />
                        </div>
                      </div>

                      {/* Live Execution Console (Terminal) */}
                      <div className="rounded-xl border border-slate-800 bg-slate-950/90 overflow-hidden shadow-sm">
                        <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800/90 bg-slate-900/60">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block"></span>
                              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block"></span>
                              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block"></span>
                            </div>
                            <span className="font-mono text-xs font-semibold text-slate-200 ml-1.5 flex items-center gap-1.5">
                              <CodeOutlined className="text-blue-400" /> Nhật Ký Thực Thi Trực Tiếp
                              {autoBuffProgress.status === 'RUNNING' && (
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-1" />
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-mono text-slate-400">
                              {liveLogs.length} sự kiện
                            </span>
                            <Button
                              type="text"
                              size="small"
                              onClick={() => setShowLiveTerminal((prev) => !prev)}
                              className="text-[11px] text-slate-400 hover:text-slate-200 h-6 px-2"
                            >
                              {showLiveTerminal ? 'Thu gọn ▲' : 'Mở rộng ▼'}
                            </Button>
                          </div>
                        </div>

                        {showLiveTerminal && (
                          <div className="p-3 font-mono text-[11px] max-h-40 overflow-y-auto space-y-1 bg-black/60 select-text">
                            {liveLogs.length === 0 ? (
                              <div className="text-slate-500 italic py-2">
                                {autoBuffProgress.status === 'RUNNING'
                                  ? '🚀 Đang khởi động trình duyệt Playwright và kết nối tài khoản...'
                                  : 'Sẵn sàng ghi nhận nhật ký khi tiến trình bắt đầu chạy.'}
                              </div>
                            ) : (
                              liveLogs.map((log, idx) => {
                                const isSuccess = log.includes('✅') || log.includes('🎯');
                                const isError = log.includes('❌') || log.includes('⚠️');
                                const isCooldown = log.includes('🛡️');
                                const isStart = log.includes('🚀') || log.includes('⚡');
                                return (
                                  <div
                                    key={idx}
                                    className={`leading-relaxed tracking-tight ${
                                      isSuccess
                                        ? 'text-emerald-400'
                                        : isError
                                        ? 'text-rose-400 font-semibold'
                                        : isCooldown
                                        ? 'text-amber-300'
                                        : isStart
                                        ? 'text-blue-300'
                                        : 'text-slate-300'
                                    }`}
                                  >
                                    {log}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>

                      {/* Live Items Grid */}
                      {(() => {
                        const filtered = autoBuffProgress.details.filter((d) => {
                          if (runningFilter === 'RUNNING' && d.status !== 'RUNNING') return false;
                          if (runningFilter === 'SUCCESS' && d.status !== 'SUCCESS') return false;
                          if (runningFilter === 'ALREADY_LIKED' && d.status !== 'ALREADY_LIKED') return false;
                          if (runningFilter === 'FAILED' && (d.status !== 'ERROR' && d.status !== 'NO_BUTTON' && d.status !== 'FAILED')) return false;
                          if (runningFilter === 'WAITING' && d.status !== 'WAITING') return false;
                          if (runningSearch.trim()) {
                            const q = runningSearch.trim().toLowerCase();
                            return (
                              (d.pageName || '').toLowerCase().includes(q) ||
                              Boolean(d.viaName && d.viaName.toLowerCase().includes(q))
                            );
                          }
                          return true;
                        });

                        if (filtered.length === 0) {
                          return (
                            <div className="py-8 text-center text-xs text-slate-500">
                              Không có tài khoản nào phù hợp bộ lọc.
                            </div>
                          );
                        }

                        return (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[500px] overflow-y-auto pr-1">
                            {filtered.map((detail, index) => {
                              const rxKey = runningTargetInfo?.reaction || selectedReaction;
                              const reactionObj =
                                REACTIONS.find((r) => r.key === rxKey) ||
                                REACTIONS[0];
                              const isRunning = detail.status === 'RUNNING';
                              const isSuccess = detail.status === 'SUCCESS';
                              const isAlreadyLiked = detail.status === 'ALREADY_LIKED';
                              const isWaiting = detail.status === 'WAITING';
                              const cleanDetailName = cleanPageName(detail.pageName);
                              const detailAvatar =
                                avatarCacheMap[detail.pageId]?.avatarUrl ||
                                (detail.pageId ? `https://graph.facebook.com/${detail.pageId}/picture?type=square` : '');

                              return (
                                <div
                                  key={detail.pageId + index}
                                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-all ${
                                    isRunning
                                      ? 'border-blue-500 bg-blue-950/40 shadow-sm shadow-blue-500/20'
                                      : isSuccess
                                      ? 'border-emerald-800/40 bg-emerald-950/20'
                                      : isAlreadyLiked
                                      ? 'border-blue-800/40 bg-blue-950/20'
                                      : isWaiting || detail.status === 'SKIPPED'
                                      ? 'border-slate-800/80 bg-slate-950/30 opacity-70'
                                      : 'border-rose-800/40 bg-rose-950/20'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <div className="relative w-8 h-8 shrink-0 rounded-lg overflow-hidden bg-slate-800 border border-slate-700/60 shadow-sm flex items-center justify-center">
                                      {detailAvatar ? (
                                        <img
                                          src={detailAvatar}
                                          alt={cleanDetailName}
                                          className="w-full h-full object-cover"
                                          onError={(e) => {
                                            (e.target as HTMLElement).style.display = 'none';
                                            const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                                            if (fallback) fallback.classList.remove('hidden');
                                          }}
                                        />
                                      ) : null}
                                      <div
                                        className={`w-full h-full text-on-accent font-semibold text-xs items-center justify-center ${getAvatarGradient(
                                          cleanDetailName
                                        )} ${detailAvatar ? 'hidden' : 'flex'}`}
                                      >
                                        {getInitials(cleanDetailName)}
                                      </div>
                                    </div>

                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-bold text-xs text-slate-100 truncate" title={cleanDetailName}>
                                          {cleanDetailName}
                                        </span>
                                        {engagementMode !== 'COMMENT_ONLY' && (
                                          <span className="text-xs shrink-0">{reactionObj.emoji}</span>
                                        )}
                                      </div>
                                      {detail.viaName && (
                                        <div className="text-[10px] text-slate-400 truncate">
                                          Via: {detail.viaName}
                                        </div>
                                      )}
                                      {detail.commentText && (
                                        <div className="text-[10px] text-blue-300 italic truncate max-w-[280px]">
                                          "{detail.commentText}"
                                        </div>
                                      )}
                                      {detail.error && (
                                        <div className="text-[10px] text-rose-300 truncate max-w-[280px]">
                                          {detail.error}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="shrink-0">
                                    {isWaiting && (
                                      <span className="text-[10px] text-slate-400 font-medium px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                                        Chờ lượt
                                      </span>
                                    )}
                                    {isRunning && (
                                      <Tag color="processing" icon={<LoadingOutlined spin />} className="font-bold text-[10px] m-0">
                                        Đang thả like...
                                      </Tag>
                                    )}
                                    {isSuccess && (
                                      <Tag color="success" icon={<CheckCircleFilled />} className="text-[10px] m-0 font-semibold">
                                        {detail.message || 'Thành công'}
                                      </Tag>
                                    )}
                                    {isAlreadyLiked && (
                                      <Tag color="blue" icon={<CheckOutlined />} className="text-[10px] m-0">
                                        Đã like trước
                                      </Tag>
                                    )}
                                    {(detail.status === 'ERROR' || detail.status === 'FAILED') && (
                                      <Tag color="error" className="text-[10px] m-0 font-medium">
                                        {detail.error || detail.message || 'Lỗi'}
                                      </Tag>
                                    )}
                                    {detail.status === 'NO_BUTTON' && (
                                      <Tag color="error" className="text-[10px] m-0">
                                        Không thấy nút Like
                                      </Tag>
                                    )}
                                    {detail.status === 'SKIPPED' && (
                                      <Tag className="text-[10px] m-0">{detail.message || 'Bỏ qua'}</Tag>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'buff-queue',
            label: (
              <span className="flex items-center gap-1.5">
                <ThunderboltOutlined className="text-amber-400" />
                <span>Hàng đợi tự động</span>
                {queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-md text-[10px] bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/40">
                    {queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length}
                  </span>
                )}
              </span>
            ),
            children: (
              <Suspense fallback={<TableSkeleton rows={5} columns={4} />}>
                <BuffQueueTab
                  workerBaseUrl={WORKER_BASE_URL}
                  queueItems={queueItems}
                  fbAccounts={fbAccounts}
                  scannedPages={scannedPages}
                  onRefresh={fetchBuffQueue}
                  onRunNow={handleRunNowQueueTask}
                  onRetry={handleRetryQueueTask}
                  onRemove={handleRemoveQueueTask}
                  onClearCompleted={handleClearCompletedQueue}
                  onClearAll={handleClearAllQueue}
                  onEmergencyStop={handleEmergencyStop}
                  onResume={handleResumeSystem}
                  isEmergencyStopped={Boolean(bmOverview?.system?.isEmergencyStopped)}
                  totalAvailablePages={scannedPages.length || 50}
                  maxParallelTasks={systemSettings?.maxParallelTasks || 2}
                  onCreateNew={() => {
                    setRunMode('QUEUE');
                    setActiveTabKey('buff-like');
                  }}
                  onViewHistory={(url) => {
                    if (url) setLogSearchQuery(url);
                    setActiveTabKey('buff-history');
                  }}
                />
              </Suspense>
            ),
          },
          {
            key: 'buff-history',
            label: `Lịch sử (${buffLogs.length})`,
            children: (
              <div className="space-y-4">
                {/* Metric Summary Cards */}
                <Row gutter={[12, 12]}>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 app-surface text-center">
                      <div className="text-[11px] font-bold text-slate-400 uppercase">Tổng lượt chạy</div>
                      <div className="text-2xl font-semibold text-slate-100 mt-1">{buffLogs.length}</div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-center">
                      <div className="text-[11px] font-bold text-emerald-400 uppercase">Like thành công</div>
                      <div className="text-2xl font-semibold text-emerald-300 mt-1">
                        {buffLogs.reduce((acc, l) => acc + getLogCounts(l).success, 0)}
                      </div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-500/30 text-center">
                      <div className="text-[11px] font-bold text-blue-400 uppercase">Đã like trước đó</div>
                      <div className="text-2xl font-semibold text-blue-300 mt-1">
                        {buffLogs.reduce((acc, l) => acc + getLogCounts(l).alreadyLiked, 0)}
                      </div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/30 text-center">
                      <div className="text-[11px] font-bold text-rose-400 uppercase">Lỗi / Thất Bại</div>
                      <div className="text-2xl font-semibold text-rose-300 mt-1">
                        {buffLogs.reduce((acc, l) => acc + getLogCounts(l).failed, 0)}
                      </div>
                    </div>
                  </Col>
                </Row>

                {/* Filter and Actions Bar */}
                <Card className="app-surface p-0">
                  <div className="p-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        prefix={<SearchOutlined className="text-slate-400" />}
                        placeholder="Tìm theo link bài viết, Via hoặc tên Page..."
                        value={logSearchQuery}
                        onChange={(e) => setLogSearchQuery(e.target.value)}
                        className="flex-1 min-w-[240px]"
                        allowClear
                      />
                      {buffLogs.length > 0 && (
                        <>
                          <Button
                            icon={<ReloadOutlined spin={buffLogsLoading} />}
                            onClick={() => {
                              reloadBuffLogs(false);
                              message.success('Đã cập nhật dữ liệu lịch sử mới nhất');
                            }}
                          >
                            Làm mới
                          </Button>
                          <Button onClick={handleExportLogsToCsv} disabled={filteredBuffLogs.length === 0}>
                            {hasActiveLogFilter ? `Xuất CSV (${filteredBuffLogs.length})` : 'Xuất CSV'}
                          </Button>
                          <Button
                            danger
                          onClick={() => {
                            modal.confirm({
                              title: 'Xoá toàn bộ lịch sử buff?',
                              content: 'Hành động này sẽ xoá toàn bộ logs đã lưu. Bạn có chắc chắn không?',
                              okText: 'Xoá tất cả',
                              cancelText: 'Huỷ',
                              okButtonProps: { danger: true },
                              onOk: async () => {
                                try {
                                  await api.delete('/buff-logs');
                                  setBuffLogs([]);
                                  message.success('Đã xoá toàn bộ lịch sử buff!');
                                } catch (err: any) {
                                  message.error(err.response?.data?.error || err.message);
                                }
                              },
                            });
                          }}
                          type="text"
                        >
                          Xoá lịch sử
                        </Button>
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={logFilterTime}
                        onChange={setLogFilterTime}
                        className="w-36"
                        options={[
                          { value: 'ALL', label: 'Mọi thời gian' },
                          { value: 'TODAY', label: 'Hôm nay' },
                          { value: '7D', label: '7 ngày qua' },
                          { value: '30D', label: '30 ngày qua' },
                        ]}
                      />
                      <Select
                        value={logFilterType}
                        onChange={setLogFilterType}
                        className="w-36"
                        options={[
                          { value: 'ALL', label: 'Mọi hình thức' },
                          { value: 'QUEUE', label: '⚡ Hàng đợi' },
                          { value: 'SINGLE', label: 'Đơn lẻ' },
                          { value: 'BATCH', label: 'Hàng loạt' },
                        ]}
                      />
                      <Select
                        value={logFilterVia}
                        onChange={setLogFilterVia}
                        className="w-48"
                        showSearch
                        optionFilterProp="label"
                        options={[
                          { value: 'ALL', label: 'Tất cả Via' },
                          ...logViaOptions.map((v) => ({ value: v, label: v })),
                        ]}
                      />
                      <Select
                        value={logFilterResult}
                        onChange={setLogFilterResult}
                        className="w-40"
                        options={[
                          { value: 'ALL', label: 'Mọi kết quả' },
                          { value: 'CLEAN', label: 'Thành công hết' },
                          { value: 'UNVERIFIED', label: 'Có chưa xác minh' },
                          { value: 'FAILED', label: 'Có lỗi' },
                        ]}
                      />
                      <Select
                        value={logFilterReaction}
                        onChange={(v) => setLogFilterReaction(v)}
                        className="w-36"
                        options={[
                          { value: 'ALL', label: 'Mọi cảm xúc' },
                          ...REACTIONS.map((r) => ({
                            value: r.key,
                            label: `${r.emoji} ${r.shortLabel}`,
                          })),
                        ]}
                      />

                      <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
                        {hasActiveLogFilter && (
                          <Button type="link" size="small" onClick={resetLogFilters} className="px-0 text-xs">
                            Xoá bộ lọc
                          </Button>
                        )}
                        <span className="tabular-nums">
                          {filteredBuffLogs.length} / {buffLogs.length} lượt
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* List / Table of Logs */}
                {buffLogsLoading && buffLogs.length === 0 ? (
                  <TableSkeleton rows={6} columns={5} />
                ) : buffLogs.length === 0 ? (
                  <Card className="app-surface text-center py-16 border-slate-800">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-3xl shadow-inner text-cyan-400">
                      <HistoryOutlined />
                    </div>
                    <div className="text-base font-bold text-slate-100">Chưa có lịch sử tương tác nào</div>
                    <div className="text-xs text-slate-400 max-w-md mx-auto mt-2 leading-relaxed">
                      Mỗi khi bạn thực hiện chiến dịch tương tác trực tiếp hoặc chạy nền, nhật ký và báo cáo kết quả sẽ hiển thị tại đây để bạn dễ dàng theo dõi và đối soát.
                    </div>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => setActiveTabKey('buff-like')}
                      className="mt-4 rounded-xl font-bold bg-cyan-600 hover:bg-cyan-500 border-none"
                    >
                      Bắt đầu chiến dịch đầu tiên
                    </Button>
                  </Card>
                ) : (
                  <Card className="app-surface p-0 overflow-hidden">
                    <Table<BuffLogEntry>
                      dataSource={filteredBuffLogs}
                      rowKey="id"
                      pagination={{ pageSize: 10, showTotal: (t) => `Tổng cộng ${t} lượt buff` }}
                      scroll={{ x: 1000 }}
                      className="ant-table-dark-custom"
                      columns={[
                        {
                          title: 'Thời gian',
                          dataIndex: 'createdAt',
                          key: 'createdAt',
                          width: 160,
                          sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                          defaultSortOrder: 'descend',
                          render: (val: string, log) => (
                            <div className="leading-tight">
                              <div className="text-sm text-slate-100 tabular-nums font-medium">
                                {new Date(val).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <div className="text-xs text-slate-500 mt-1 tabular-nums whitespace-nowrap flex items-center gap-1.5">
                                <span>{new Date(val).toLocaleDateString('vi-VN')}</span>
                                {log.type === 'QUEUE' ? (
                                  <Tag color="cyan" className="m-0 border-0 text-[10px] px-1.5 py-0 leading-tight">⚡ Hàng đợi</Tag>
                                ) : log.type === 'BATCH' ? (
                                  <Tag color="purple" className="m-0 border-0 text-[10px] px-1.5 py-0 leading-tight">Hàng loạt</Tag>
                                ) : (
                                  <Tag color="blue" className="m-0 border-0 text-[10px] px-1.5 py-0 leading-tight">Đơn lẻ</Tag>
                                )}
                              </div>
                            </div>
                          ),
                        },
                        {
                          title: 'Bài viết',
                          key: 'targetUrl',
                          render: (_, log) => (
                            <div className="min-w-0 leading-tight">
                              <a
                                href={log.targetUrl}
                                target="_blank"
                                rel="noreferrer"
                                title={log.targetUrl}
                                className="text-sm text-slate-100 hover:text-blue-400 truncate block max-w-sm"
                              >
                                {log.targetUrl.replace(/^https?:\/\/(www\.)?/, '')}
                              </a>
                              {log.accountName && (
                                <div className="text-xs text-slate-500 mt-1 truncate max-w-sm">
                                  Via: <span className="text-slate-300">{log.accountName}</span>
                                </div>
                              )}
                            </div>
                          ),
                        },
                        {
                          title: 'Cảm xúc',
                          dataIndex: 'reactionType',
                          key: 'reactionType',
                          width: 120,
                          render: (reactionType: string) => {
                            const reactionObj = REACTIONS.find((r) => r.key === reactionType) || REACTIONS[0];
                            return (
                              <span className="inline-flex items-center gap-1.5 text-sm text-slate-200">
                                <span>{reactionObj.emoji}</span>
                                {reactionObj.shortLabel}
                              </span>
                            );
                          },
                        },
                        {
                          title: 'Kết quả',
                          key: 'counts',
                          width: 200,
                          render: (_, log) => {
                            const counts = getLogCounts(log);
                            const extras = [
                              counts.comments > 0 && { text: `${counts.comments} bình luận`, cls: 'text-slate-400' },
                              counts.alreadyLiked > 0 && { text: `${counts.alreadyLiked} đã like trước`, cls: 'text-slate-400' },
                              counts.unverified > 0 && { text: `${counts.unverified} chưa xác minh`, cls: 'text-amber-400' },
                              counts.failed > 0 && { text: `${counts.failed} lỗi`, cls: 'text-rose-400' },
                            ].filter(Boolean) as { text: string; cls: string }[];
                            return (
                              <div className="leading-tight">
                                <div className="text-sm text-slate-200">
                                  <span className="font-semibold text-emerald-400 tabular-nums">{counts.success}</span> thành công
                                </div>
                                {extras.length > 0 && (
                                  <div className="text-xs mt-1">
                                    {extras.map((e, i) => (
                                      <span key={e.text} className={e.cls}>
                                        {i > 0 && <span className="text-slate-600"> · </span>}
                                        {e.text}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          },
                        },
                        {
                          title: 'Fanpage',
                          key: 'details',
                          width: 150,
                          render: (_, log) => {
                            const counts = getLogCounts(log);
                            const pct = (n: number) => counts.total > 0 ? `${(n / counts.total) * 100}%` : '0%';
                            return (
                              <div className="leading-tight">
                                <div className="text-sm text-slate-200 tabular-nums">{counts.total} Page</div>
                                <div className="flex h-1 rounded-full overflow-hidden bg-slate-800 w-full max-w-[112px] mt-2">
                                  <div className="bg-emerald-500" style={{ width: pct(counts.success) }} />
                                  <div className="bg-slate-500" style={{ width: pct(counts.alreadyLiked) }} />
                                  <div className="bg-amber-500" style={{ width: pct(counts.unverified) }} />
                                  <div className="bg-rose-500" style={{ width: pct(counts.failed) }} />
                                </div>
                              </div>
                            );
                          },
                        },
                        {
                          title: '',
                          key: 'actions',
                          width: 175,
                          align: 'right',
                          render: (_, log) => (
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="small"
                                type="primary"
                                ghost
                                icon={<RedoOutlined />}
                                onClick={() => {
                                  setTargetPostUrl(log.targetUrl);
                                  setSelectedReaction(log.reactionType);
                                  setActiveTabKey('buff-like');
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                  message.info('Đã nạp lại link vào form. Các Page đã like sẽ được tự động bỏ qua.');
                                }}
                                className="text-xs font-semibold h-7 px-2"
                              >
                                Buff tiếp
                              </Button>
                              <Button
                                size="small"
                                type="text"
                                onClick={() => handleViewLogDetail(log)}
                                loading={loadingLogDetailId === log.id}
                                className="text-xs text-slate-300 h-7 px-1.5"
                              >
                                Chi tiết
                              </Button>
                              <Dropdown
                                trigger={['click']}
                                menu={{
                                  items: [
                                    {
                                      key: 'open',
                                      label: 'Mở trên Facebook',
                                      icon: <ExportOutlined />,
                                      onClick: () => window.open(log.targetUrl, '_blank'),
                                    },
                                    {
                                      key: 'copy',
                                      label: 'Sao chép link',
                                      icon: <CopyOutlined />,
                                      onClick: () => {
                                        navigator.clipboard.writeText(log.targetUrl);
                                        message.success('Đã sao chép link bài viết!');
                                      },
                                    },
                                  ],
                                }}
                              >
                                <Button size="small" type="text" icon={<MoreOutlined />} className="text-slate-400 h-7 px-1" />
                              </Dropdown>
                            </div>
                          ),
                        },
                      ]}
                    />
                  </Card>
                )}
              </div>
            ),
          },
          {
            key: 'buff-hunter',
            label: `Săn bài tự động (${monitors.length})`,
            children: (
              <Suspense fallback={<TableSkeleton rows={4} columns={3} />}>
                <PostHunterTab
                  workerBaseUrl={WORKER_BASE_URL}
                  monitors={monitors as any}
                  queueItems={queueItems}
                  autoBuffOwnPosts={Boolean(bmOverview?.system?.autoBuffOwnPosts)}
                  maxPagesPerPost={Number(bmOverview?.system?.maxPagesPerPost) || 60}
                  onRefresh={fetchBuffMonitors}
                  onAdd={(url) => handleOpenAddMonitorModal(undefined, url)}
                  onEdit={(m) => handleOpenAddMonitorModal(m as any)}
                  onToggle={handleToggleMonitor}
                  onDelete={handleDeleteMonitor}
                  onScanNow={handleScanNowMonitor}
                  onQueueUrl={(url) => {
                    setTargetPostUrl(url);
                    setActiveTabKey('buff-like');
                  }}
                  onOpenQueue={() => setActiveTabKey('buff-queue')}
                  onOpenSettings={() => {
                    setActiveTabKey('system-settings');
                  }}
                />
              </Suspense>
            ),
          },
          {
            key: 'via-management',
            label: 'Dàn Via & Fanpage',
            children: (
              <Suspense fallback={<PageSkeleton title="Đang tải Dàn Via & Fanpage..." />}>
                <ViaManagementPage
                  accounts={accounts as any[]}
                  loading={loadingAccounts}
                  onRefresh={() => {
                    refetchAccounts();
                    fetchBmOverview();
                  }}
                  dbStatus={props.dbStatus}
                  onCheckDb={props.onCheckDb}
                  onNavigateToBuff={() => setActiveTabKey('buff-like')}
                />
              </Suspense>
            ),
          },
          {
            key: 'system-settings',
            label: 'Cấu Hình & Telegram',
            children: (
              <Suspense fallback={<PageSkeleton title="Đang tải Cấu hình hệ thống..." />}>
                <SystemSettingsPage
                  systemSettings={systemSettings}
                  setSystemSettings={setSystemSettings}
                  savingSettings={savingSettings}
                  onSaveSettings={handleSaveSettings}
                  testingTelegram={testingTelegram}
                  onTestTelegram={handleTestTelegram}
                  bmOverview={bmOverview}
                  onEmergencyStop={handleEmergencyStop}
                  onResumeSystem={handleResumeSystem}
                />
              </Suspense>
            ),
          },
          {
            key: 'license-management',
            label: 'Cho Thuê & Bản Quyền',
            children: (
              <Suspense fallback={<PageSkeleton title="Đang tải Quản lý Bản quyền..." />}>
                <LicenseManagementPage />
              </Suspense>
            ),
          },
        ]}
      />


      {/* Modal Xem Chi Tiết Log Lịch Sử Tương Tác */}
      <Modal
        open={!!selectedLogDetail}
        onCancel={() => setSelectedLogDetail(null)}
        footer={[
          <Button key="close" onClick={() => setSelectedLogDetail(null)} className="rounded-xl">
            Đóng
          </Button>,
          selectedLogDetail && (
            <Button
              key="buff-again"
              type="primary"
              className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl"
              onClick={() => {
                setTargetPostUrl(selectedLogDetail.targetUrl);
                setSelectedReaction(selectedLogDetail.reactionType);
                setSelectedLogDetail(null);
                setActiveTabKey('buff-like');
                message.info('Đã nạp lại bài viết này vào form để tiếp tục.');
              }}
            >
              Nạp bài này để Buff tiếp
            </Button>
          ),
        ]}
        width={760}
        centered
        destroyOnHidden
        title={
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <HistoryOutlined className="text-blue-400 text-lg" />
            <div>
              <div className="font-bold text-base text-slate-100">
                Chi tiết lịch sử
              </div>
              <div className="text-[11px] text-slate-400 font-normal">
                Thời gian:{' '}
                <span className="font-mono text-slate-300">
                  {selectedLogDetail ? new Date(selectedLogDetail.createdAt).toLocaleString('vi-VN') : ''}
                </span>{' '}
                • Chế độ:{' '}
                <span className="font-semibold text-blue-400">
                  {selectedLogDetail?.type === 'QUEUE'
                    ? '⚡ Hàng đợi tự động (Queue)'
                    : selectedLogDetail?.type === 'BATCH'
                    ? 'Hàng loạt (Batch)'
                    : 'Đơn lẻ (Single)'}
                </span>
              </div>
            </div>
          </div>
        }
      >
        {selectedLogDetail && (
          <div className="py-2 space-y-4 text-xs">
            {/* Target Post Info */}
            <div className="p-3.5 bg-slate-950/50 border border-slate-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200">Link bài viết mục tiêu:</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(selectedLogDetail.targetUrl);
                      message.success('Đã sao chép link!');
                    }}
                    className="text-xs"
                  >
                    Sao chép
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<ExportOutlined />}
                    onClick={() => window.open(selectedLogDetail.targetUrl, '_blank')}
                    className="text-xs"
                  >
                    Mở Facebook
                  </Button>
                </div>
              </div>
              <div className="font-mono text-blue-400 break-all bg-slate-900 p-2 rounded-lg border border-slate-800">
                {selectedLogDetail.targetUrl}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-slate-500">Cảm xúc:</span>
                {(() => {
                  const rObj = REACTIONS.find((r) => r.key === selectedLogDetail.reactionType) || REACTIONS[0];
                  return (
                    <Tag className="font-bold">
                      {rObj.emoji} {rObj.label}
                    </Tag>
                  );
                })()}
                {selectedLogDetail.accountName && (
                  <>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-500">Tài khoản mẹ:</span>
                    <Tag color="cyan">{selectedLogDetail.accountName}</Tag>
                  </>
                )}
              </div>
            </div>

            {/* Quick Metrics */}
            {(() => {
              const counts = getLogCounts(selectedLogDetail);
              return (
            <div className="grid grid-cols-4 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
                <div className="text-[10px] text-slate-500 font-bold uppercase">Tổng Page</div>
                <div className="text-lg font-semibold text-slate-100">{counts.total}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-center">
                <div className="text-[10px] text-emerald-400 font-bold uppercase">Thành công</div>
                <div className="text-lg font-semibold text-emerald-400">{counts.success}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-800/60 text-center">
                <div className="text-[10px] text-blue-400 font-bold uppercase">Đã Like Trước</div>
                <div className="text-lg font-semibold text-blue-400">{counts.alreadyLiked}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-center">
                <div className="text-[10px] text-rose-400 font-bold uppercase">Thất bại / Lỗi</div>
                <div className="text-lg font-semibold text-rose-400">{counts.failed}</div>
                {counts.unverified + counts.skipped > 0 && (
                  <div className="text-[10px] text-slate-400">
                    {counts.unverified > 0 && `${counts.unverified} chưa xác minh`}
                    {counts.unverified > 0 && counts.skipped > 0 && ' • '}
                    {counts.skipped > 0 && `${counts.skipped} bỏ qua / dừng`}
                  </div>
                )}
              </div>
            </div>
              );
            })()}

            {/* Detailed Table of Pages */}
            <div className="space-y-2">
              <div className="font-bold text-slate-200 flex items-center justify-between">
                <span>Chi tiết từng Fanpage ({selectedLogDetail.details.length} Page):</span>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1.5 border border-slate-800 rounded-xl p-2 bg-slate-950/50">
                {selectedLogDetail.details.map((detail, idx) => {
                  let statusTag: ReactNode;
                  if (detail.status === 'SUCCESS') {
                    statusTag = <Tag color="success" icon={<CheckCircleFilled />}>Thành công</Tag>;
                  } else if (detail.status === 'ALREADY_LIKED') {
                    statusTag = <Tag color="blue" icon={<CheckOutlined />}>Đã like trước đó</Tag>;
                  } else if (detail.status === 'NO_BUTTON') {
                    statusTag = <Tag color="warning">Không thấy nút Like</Tag>;
                  } else if (detail.status === 'ERROR') {
                    statusTag = <Tag color="error" icon={<CloseCircleFilled />}>Lỗi</Tag>;
                  } else if (detail.status === 'UNVERIFIED') {
                    statusTag = <Tag color="gold">Chưa xác minh</Tag>;
                  } else if (detail.status === 'SKIPPED') {
                    statusTag = <Tag color="default">Bỏ qua / Đã dừng</Tag>;
                  } else {
                    statusTag = <Tag color="default">Chưa chạy</Tag>;
                  }

                  return (
                    <div
                      key={detail.pageId + idx}
                      className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-slate-400 font-mono text-[10px]">#{idx + 1}</span>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-100 truncate">{detail.pageName}</div>
                          {detail.commentText && (
                            <div className="text-[11px] text-blue-400 italic truncate max-w-[320px] font-medium">
                              "{detail.commentText}"
                            </div>
                          )}
                          <div className="font-mono text-[10px] text-slate-400">ID: {detail.pageId}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {detail.message && (
                          <span className="text-[11px] text-slate-400 hidden sm:inline truncate max-w-[200px]" title={detail.message}>
                            {detail.message}
                          </span>
                        )}
                        {statusTag}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Khai Báo & Quản Lý i_user (Fanpage) cho Từng Via */}
      <Modal
        open={managePagesModalOpen}
        onCancel={() => setManagePagesModalOpen(false)}
        footer={null}
        width={780}
        centered
        destroyOnHidden={false}
        className="manage-iuser-modal"
        title={
          <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-800">
            <IdcardOutlined className="text-blue-400 text-xl" />
            <div>
              <div className="font-bold text-base text-slate-100">
                Danh sách Page cho từng nick
              </div>
              <div className="text-[11px] text-slate-400 font-normal">
                Danh sách Fanpage được lưu cố định cho từng Via, bảo đảm đủ số lượng Page khi thả Like (không lo rớt page).
              </div>
            </div>
          </div>
        }
      >
        <div className="py-2 space-y-4 text-xs">
          {/* Thanh chọn tài khoản Via cần cấu hình */}
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
            <div className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
              <span>Chọn tài khoản Via bạn muốn cấu hình i_user:</span>
              <span className="text-[11px] text-blue-400 font-medium">
                (Bấm chọn từng Via để xem và quản lý)
              </span>
            </div>
            <Segmented
              className="bg-slate-900 border border-slate-800 text-xs w-full"
              block
              value={targetViaForModal}
              onChange={(val) => setTargetViaForModal(val as number | 'CUSTOM')}
              options={[
                ...fbAccounts.map((a: any) => {
                  const k = getViaKey(a);
                  const count = getStoredPagesForVia(k).length;
                  return {
                    value: a.id,
                    label: (
                      <div className="flex items-center justify-center gap-1.5 py-1">
                        <span className="font-bold text-slate-200">{a.pageName || a.platformAccountId}</span>
                        <Tag color={count > 0 ? 'blue' : 'default'} className="!m-0 text-[10px] font-mono">
                          {count} Page
                        </Tag>
                      </div>
                    ),
                  };
                }),
                {
                  value: 'CUSTOM',
                  label: (
                    <div className="flex items-center justify-center gap-1.5 py-1">
                      <span className="text-slate-300">Cookie thủ công</span>
                      <Tag color={getStoredPagesForVia('custom_manual').length > 0 ? 'cyan' : 'default'} className="!m-0 text-[10px] font-mono">
                        {getStoredPagesForVia('custom_manual').length} Page
                      </Tag>
                    </div>
                  ),
                },
              ]}
            />
          </div>

          {/* Banner thông tin Via đang chọn */}
          <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircleFilled className="text-emerald-400 text-base" />
              <div>
                <div className="text-xs font-bold text-slate-200">
                  Đang cấu hình cho: <span className="text-blue-400">{modalViaAccount?.pageName || (targetViaForModal === 'CUSTOM' ? 'Cookie thủ công' : 'Via Facebook')}</span>
                  {modalViaAccount && (
                    <span className="font-mono text-[10px] text-slate-400 ml-2">
                      (c_user: {extractCUser(modalViaAccount.cookieString || modalViaAccount.accessToken) || 'N/A'})
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Via này hiện có <b className="font-bold text-emerald-400">{currentModalPages.length} Fanpage</b> được lưu cố định.
                </div>
              </div>
            </div>
          </div>

          {/* Card Thêm Page */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 uppercase tracking-wide text-xs">
                Nhập thêm i_user (Fanpage) vào Via này:
              </span>
              <Segmented
                size="small"
                value={addMode}
                onChange={(val) => setAddMode(val as 'BULK' | 'SINGLE')}
                options={[
                  { label: 'Dán hàng loạt', value: 'BULK' },
                  { label: 'Nhập từng Page', value: 'SINGLE' },
                ]}
                className="bg-slate-900 border border-slate-800 text-xs"
              />
            </div>

            {addMode === 'BULK' ? (
              <div className="space-y-2">
                <label className="block text-slate-400">
                  Dán danh sách ID i_user hoặc link Page (mỗi dòng 1 Page, định dạng <code className="text-blue-400 font-mono">ID | Tên Page</code>):
                </label>
                <Input.TextArea
                  rows={4}
                  value={bulkPagesText}
                  onChange={(e) => setBulkPagesText(e.target.value)}
                  placeholder={`61589245661782 | Làm Phước Hai\n467447130112806 | Làm Gì Mà Gấp\n61568697241127 | Đại Sảnh Pickleball\n61584834510803 | Làm Sen\n61594279329518 | Nexa 24h\n100091144747972 | Phú Order Hàng Nhật\n61551923480422 | Đại Sảnh Liên Minh Huyền Thoại`}
                  className="font-mono text-xs rounded-xl bg-slate-900 border-slate-800 text-slate-100 placeholder:text-slate-500"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    Nhận diện được: <b className="text-emerald-400 font-bold">{parsedBulkPages.length}</b> Fanpage hợp lệ
                  </span>
                  <Button
                    type="primary"
                    size="middle"
                    disabled={parsedBulkPages.length === 0}
                    onClick={() => {
                      const pagesToAdd: FanpageItem[] = parsedBulkPages.map((p) => ({
                        id: p.platformAccountId,
                        name: p.pageName,
                        url: `https://www.facebook.com/profile.php?id=${p.platformAccountId}`,
                      }));
                      handleSavePagesForTargetVia(pagesToAdd);
                      setBulkPagesText('');
                    }}
                    className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl border-none"
                  >
                    Lưu {parsedBulkPages.length} Page vào Via này
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Row gutter={10}>
                  <Col span={10}>
                    <label className="block text-slate-400 mb-1">Tên Fanpage (Tùy chọn):</label>
                    <Input
                      placeholder="VD: Làm Sen"
                      value={newPageName}
                      onChange={(e) => setNewPageName(e.target.value)}
                      className="rounded-xl text-xs bg-slate-900 border-slate-800 text-slate-100"
                    />
                  </Col>
                  <Col span={14}>
                    <label className="block text-slate-400 mb-1">ID Fanpage / i_user (hoặc link):</label>
                    <Input
                      placeholder="VD: 61584834510803 hoặc link Facebook"
                      value={newPageIdOrUrl}
                      onChange={(e) => setNewPageIdOrUrl(e.target.value)}
                      className="font-mono rounded-xl text-xs bg-slate-900 border-slate-800 text-slate-100"
                    />
                  </Col>
                </Row>
                <div className="flex justify-end">
                  <Button
                    type="primary"
                    disabled={!extractPageId(newPageIdOrUrl)}
                    onClick={() => {
                      const id = extractPageId(newPageIdOrUrl);
                      if (id) {
                        const newPage: FanpageItem = {
                          id,
                          name: newPageName.trim() || `Fanpage (${id.slice(-4)})`,
                          url: `https://www.facebook.com/profile.php?id=${id}`,
                        };
                        handleSavePagesForTargetVia([newPage]);
                        setNewPageName('');
                        setNewPageIdOrUrl('');
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl border-none"
                  >
                    Thêm Fanpage này
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Danh sách các Page hiện có của Via */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-200">
                Danh sách Fanpage đang lưu ({currentModalPages.length} Page):
              </span>
              <div className="flex items-center gap-2">
                {currentModalPages.length > 0 && (
                  <Button
                    type="link"
                    danger
                    size="small"
                    onClick={handleClearPagesForTargetVia}
                    className="text-[11px] !p-0 !h-auto"
                  >
                    Xóa tất cả để dán lại
                  </Button>
                )}
                <span className="text-[11px] text-slate-400">
                  (Đã lưu vĩnh viễn trong máy)
                </span>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 border border-slate-800 rounded-xl p-2 bg-slate-950/60">
              {currentModalPages.length === 0 ? (
                <div className="text-center py-6 text-slate-400">
                  Chưa có Fanpage nào được lưu cho Via này. Hãy dán danh sách ở trên để lưu!
                </div>
              ) : (
                currentModalPages.map((page, idx) => (
                  <div
                    key={page.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900/80 hover:bg-slate-850 transition-colors border border-slate-800/80"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 grid place-items-center text-[10px] font-bold">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-slate-200 truncate max-w-[280px]" title={page.name}>
                        {page.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-mono text-blue-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        i_user: {page.id}
                      </span>
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeletePageForTargetVia(page.id)}
                        className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/40"
                        title="Xóa Fanpage này khỏi Via"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* MODAL: AI SEEDING STUDIO & SPINTAX ENGINE */}
      <Modal
        title={
          <div className="flex items-center gap-2.5 text-white font-semibold text-base sm:text-lg">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-on-accent">
              <RobotOutlined className="text-base" />
            </div>
            <div>
              <div>AI SEEDING STUDIO & BỘ TRỘN SPINTAX</div>
              <div className="text-[11px] font-normal text-slate-400">
                Sinh bình luận tự nhiên theo ngành hàng, chống trùng lặp và né thuật toán quét bot của Meta.
              </div>
            </div>
          </div>
        }
        open={aiStudioModalOpen}
        onCancel={() => setAiStudioModalOpen(false)}
        footer={null}
        width={780}
        centered
        className="dark-modal"
        styles={{
          body: {
            backgroundColor: 'var(--modal-bg)',
            color: 'var(--text-strong)',
          },
          header: {
            backgroundColor: 'var(--modal-bg)',
            borderBottom: '1px solid var(--border)',
          },
        }}
      >
        <div className="space-y-4 pt-3 text-xs sm:text-sm">
          {/* 1. Chọn Ngành Nghề / Niche */}
          <div className="space-y-2">
            <label className="font-bold text-slate-300 block">Chủ đề bài viết:</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(SEEDING_NICHE_PRESETS).map(([key, item]) => {
                const isSelected = selectedNiche === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedNiche(key);
                      setPreviewSamples(item.templates.map(resolveSpintax));
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2 ${
                      isSelected
                        ? 'bg-blue-600/30 border-blue-500 text-white'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-bold text-xs truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 1.1 Nhập ngữ cảnh bài viết & Phong cách AI */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
            <div>
              <label className="font-bold text-slate-300 block mb-1">
                Nội dung / Tóm tắt bài viết (AI đọc ngữ cảnh):
              </label>
              <Input.TextArea
                rows={2}
                placeholder="Dán tiêu đề, giá bán, hoặc thông tin bài viết (VD: Áo polo nam cotton 199k freeship toàn quốc)..."
                value={aiPostPrompt}
                onChange={(e) => setAiPostPrompt(e.target.value)}
                className="bg-slate-950/70 border-slate-700 text-slate-100 text-xs rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-400 block mb-1 text-xs">
                  Phong cách bình luận (Tone):
                </label>
                <Select
                  size="small"
                  value={aiTone}
                  onChange={setAiTone}
                  className="w-full text-xs"
                  options={[
                    { value: 'customer_inquiry', label: '🛍️ Khách hỏi mua / Tư vấn (Size, ship, giá)' },
                    { value: 'enthusiastic', label: '⭐ Khen ngợi / Đánh giá 5 sao (Đẹp, ưng ý)' },
                    { value: 'expert', label: '💬 Hào hứng / Thảo luận (Đồng tình, chia sẻ)' },
                    { value: 'natural', label: '🍀 Tự nhiên tổng hợp (Đa góc nhìn)' },
                  ]}
                />
              </div>
              <div>
                <label className="font-semibold text-slate-400 block mb-1 text-xs">
                  Số lượng bình luận cần tạo:
                </label>
                <Select
                  size="small"
                  value={aiCount}
                  onChange={setAiCount}
                  className="w-full text-xs"
                  options={[
                    { value: 10, label: '10 bình luận' },
                    { value: 15, label: '15 bình luận' },
                    { value: 20, label: '20 bình luận' },
                    { value: 30, label: '30 bình luận' },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* 2. Mẫu Cấu Trúc Spintax Gốc */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300">
                Cấu trúc Spintax gốc của ngành "{SEEDING_NICHE_PRESETS[selectedNiche]?.label}":
              </span>
              <span className="text-[11px] text-slate-500 font-mono">Cú pháp: {'{A|B|C} {D|E}'}</span>
            </div>
            <div className="space-y-1 font-mono text-[11px] text-blue-300 max-h-36 overflow-y-auto pr-1">
              {SEEDING_NICHE_PRESETS[selectedNiche]?.templates.map((tmpl, idx) => (
                <div key={idx} className="p-1.5 rounded bg-slate-900/80 border border-slate-800/80">
                  {tmpl}
                </div>
              ))}
            </div>
          </div>

          {/* 3. Live Spintax Tester */}
          <div className="space-y-2 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-bold text-blue-300 flex items-center gap-1.5 text-xs">
                <ThunderboltFilled className="text-amber-400" />
                Kết quả thực tế khi Bot đi bình luận (Đã xoay Spintax ngẫu nhiên):
              </span>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  setPreviewSamples(tmpls.map(resolveSpintax));
                  message.info('Đã xoay biến thể Spintax mới!');
                }}
                className="text-[11px] bg-slate-900 border-slate-700 text-slate-300 hover:text-white"
              >
                Xoay Thử Lại
              </Button>
            </div>

            <div className="space-y-1.5">
              {previewSamples.map((sample, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800/60 text-slate-200 text-xs"
                >
                  <span className="text-[10px] font-bold text-blue-400 shrink-0 select-none">#{idx + 1}</span>
                  <span className="flex-1">{sample}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Hành động Nạp Vào Chiến Dịch */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <SafetyCertificateOutlined className="text-emerald-400" />
              <span>Bảo vệ tài khoản: 100% các Via sẽ bình luận nội dung khác nhau.</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                icon={<RobotOutlined spin={isAiGeneratingComments} />}
                loading={isAiGeneratingComments}
                onClick={async () => {
                  await handleGenerateAiComments();
                  setAiStudioModalOpen(false);
                }}
                className="bg-blue-600 hover:bg-blue-500 text-on-accent font-bold rounded-xl text-xs h-9 border-none"
              >
                Tạo bằng AI theo link bài
              </Button>

              <Button
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  // Sinh 10 biến thể Spintax ngẫu nhiên
                  const generated: string[] = [];
                  for (let i = 0; i < 12; i++) {
                    const t = tmpls[i % tmpls.length];
                    generated.push(resolveSpintax(t));
                  }
                  const existingLines = commentListText.split('\n').filter((s) => s.trim());
                  setCommentListText([...existingLines, ...generated].join('\n'));
                  setAiStudioModalOpen(false);
                  message.success(`Đã nối thêm ${generated.length} bình luận vào danh sách!`);
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 font-semibold rounded-xl text-xs h-9"
              >
                Thêm vào cuối
              </Button>

              <Button
                type="primary"
                icon={<ThunderboltFilled />}
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  // Dùng trực tiếp các câu Spintax nguyên bản để bot tự xoay ở mỗi lượt cmt
                  setCommentListText(tmpls.join('\n'));
                  setAiStudioModalOpen(false);
                  message.success(`Đã nạp toàn bộ kịch bản Spintax chuẩn của "${SEEDING_NICHE_PRESETS[selectedNiche]?.label}"!`);
                }}
                className="bg-blue-600 hover:bg-blue-500 border-none font-bold rounded-xl text-xs h-9"
              >
                Thay toàn bộ
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* MODAL: THÊM / CẬP NHẬT MỤC TIÊU THEO DÕI POST HUNTER */}
      <Modal
        open={isMonitorModalOpen}
        onCancel={() => setIsMonitorModalOpen(false)}
        title={editingMonitorId ? 'Sửa mục tiêu theo dõi' : 'Thêm mục tiêu theo dõi'}
        footer={[
          <Button key="cancel" onClick={() => setIsMonitorModalOpen(false)}>
            Huỷ
          </Button>,
          <Button key="submit" type="primary" loading={loadingMonitors} onClick={handleSaveMonitor}>
            {editingMonitorId ? 'Lưu thay đổi' : 'Bắt đầu theo dõi'}
          </Button>,
        ]}
        width={640}
        className="dark-modal"
      >
        <div className="space-y-5 py-1 text-slate-200">
          <section className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Mục tiêu</div>
            <div>
              <label className="text-xs text-slate-300 mb-1 block">
                Link Fanpage hoặc Group <span className="text-rose-400">*</span>
              </label>
              <Input
                autoFocus
                placeholder="https://www.facebook.com/groups/... hoặc link Fanpage"
                value={monTargetUrl}
                onChange={(e) => {
                  const url = e.target.value;
                  setMonTargetUrl(url);
                  if (/facebook\.com\/groups\//i.test(url)) setMonTargetType('GROUP');
                  else if (/facebook\.com\//i.test(url) && monTargetType === 'GROUP') setMonTargetType('PAGE');
                }}
              />
            </div>
            <Row gutter={12}>
              <Col span={15}>
                <label className="text-xs text-slate-300 mb-1 block">Tên hiển thị</label>
                <Input
                  placeholder="VD: Group nguồn hàng, Page chính"
                  value={monTargetName}
                  onChange={(e) => setMonTargetName(e.target.value)}
                />
              </Col>
              <Col span={9}>
                <label className="text-xs text-slate-300 mb-1 block">Loại</label>
                <Select
                  value={monTargetType}
                  onChange={(val) => setMonTargetType(val)}
                  className="w-full"
                  options={[
                    { value: 'PAGE', label: 'Fanpage' },
                    { value: 'GROUP', label: 'Group' },
                    { value: 'PROFILE', label: 'Trang cá nhân' },
                  ]}
                />
              </Col>
            </Row>
            {monTargetType === 'GROUP' && (
              <div className="text-[11px] text-slate-400">
                Với Group riêng tư, ít nhất một via phải là thành viên thì mới đọc được bài.
              </div>
            )}
          </section>

          <section className="space-y-3 pt-4 border-t border-slate-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Cách buff</div>
            <div>
              <label className="text-xs text-slate-300 mb-1 block">Số lượt mỗi bài</label>
              <div className="flex items-center gap-3">
                <Segmented
                  value={monTargetLikes === 'ALL' ? 'ALL' : 'FIXED'}
                  onChange={(val) => setMonTargetLikes(val === 'ALL' ? 'ALL' : 30)}
                  options={[
                    { value: 'ALL', label: 'Xoay vòng page' },
                    { value: 'FIXED', label: 'Số cố định' },
                  ]}
                />
                {monTargetLikes !== 'ALL' && (
                  <InputNumber
                    min={5}
                    max={500}
                    value={monTargetLikes}
                    onChange={(v) => setMonTargetLikes(v || 30)}
                    addonAfter="lượt"
                    className="w-32"
                  />
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {monTargetLikes === 'ALL'
                  ? `Mỗi bài dùng tối đa ${systemSettings.maxPagesPerPost || 150} page (đổi trong Cài đặt), ưu tiên page ít dùng nhất hôm nay để mọi page được chia đều.`
                  : 'Lấy đúng số page này, ưu tiên page ít dùng nhất hôm nay.'}
              </div>
            </div>
            <Row gutter={12}>
              <Col span={8}>
                <label className="text-xs text-slate-300 mb-1 block">Cảm xúc</label>
                <Select
                  value={monReaction}
                  onChange={(val) => setMonReaction(val)}
                  className="w-full"
                  options={[
                    { value: 'RANDOM_POSITIVE', label: 'Like / Love / Care' },
                    { value: 'LIKE', label: 'Like' },
                    { value: 'LOVE', label: 'Love' },
                    { value: 'CARE', label: 'Care' },
                  ]}
                />
              </Col>
              <Col span={8}>
                <label className="text-xs text-slate-300 mb-1 block">Chờ sau khi phát hiện</label>
                <Select
                  value={monDelayMinutes}
                  onChange={(val) => setMonDelayMinutes(val)}
                  className="w-full"
                  options={[
                    { value: 0, label: 'Buff ngay' },
                    { value: 3, label: '3 phút' },
                    { value: 5, label: '5 phút' },
                    { value: 10, label: '10 phút' },
                  ]}
                />
              </Col>
              <Col span={8}>
                <label className="text-xs text-slate-300 mb-1 block">Chu kỳ quét</label>
                <Select
                  value={monInterval}
                  onChange={(val) => setMonInterval(val)}
                  className="w-full"
                  options={[
                    { value: 5, label: '5 phút' },
                    { value: 10, label: '10 phút' },
                    { value: 15, label: '15 phút' },
                    { value: 30, label: '30 phút' },
                    { value: 60, label: '60 phút' },
                  ]}
                />
              </Col>
            </Row>
            <div>
              <label className="text-xs text-slate-300 mb-1 block">Via thực hiện</label>
              <Select
                value={monViaMode}
                onChange={(val) => setMonViaMode(val)}
                className="w-full"
                options={[
                  { value: 'ALL_VIAS', label: 'Tất cả via đang sống' },
                  { value: 'CUSTOM', label: 'Chỉ via đầu tiên' },
                ]}
              />
            </div>
          </section>

          <section className="space-y-3 pt-4 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Bình luận</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Mỗi page để lại một bình luận ngẫu nhiên, hỗ trợ Spintax.</div>
              </div>
              <Switch checked={monEnableComment} onChange={setMonEnableComment} />
            </div>

            {monEnableComment && (
              <div className="space-y-2">
                <Input.TextArea
                  rows={4}
                  value={monCommentText}
                  onChange={(e) => setMonCommentText(e.target.value)}
                  placeholder="Mỗi dòng một mẫu, VD: {Đẹp quá|Xịn quá} {shop|bạn} ơi"
                  className="font-mono text-xs"
                />
                <div className="flex items-center justify-end gap-3">
                  <Button
                    size="small"
                    type="link"
                    className="!p-0"
                    onClick={() => {
                      const sampleTmpls = SEEDING_NICHE_PRESETS['SALES']?.templates || [];
                      setMonCommentText(sampleTmpls.join('\n'));
                    }}
                  >
                    Dùng mẫu bán hàng
                  </Button>
                  <Button size="small" onClick={handleTestSpintaxInForm}>
                    Xem thử
                  </Button>
                </div>

                {spintaxSampleOutputs.length > 0 && (
                  <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/70">
                    {spintaxSampleOutputs.map((s, idx) => (
                      <div key={idx} className="px-3 py-1.5 text-xs text-slate-300">
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </Modal>

      {/* MODAL: BÁO CÁO SỨC KHỎE DÀN VIA TRONG BM */}
      <Modal
        open={isHealthModalOpen}
        onCancel={() => setIsHealthModalOpen(false)}
        title={
          <div className="flex items-center gap-2 text-base font-bold text-slate-100 pb-2 border-b border-slate-800">
            <SafetyCertificateOutlined className="text-emerald-400 text-lg" />
            <span>Báo Cáo Sức Khỏe Dàn Via Facebook (Live/Die Status)</span>
          </div>
        }
        footer={[
          <Button key="close" type="primary" onClick={() => setIsHealthModalOpen(false)} className="rounded-xl">
            Đóng
          </Button>,
        ]}
        width={720}
        className="dark-modal"
      >
        <div className="space-y-4 py-2 text-slate-200">
          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
            <span>Tổng số Via kiểm tra: <strong className="text-slate-100">{viaHealthResults.length}</strong></span>
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              Hoạt Động: {viaHealthResults.filter((r) => r.isLive).length}
            </span>
            <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              Sự Cố / Hết Hạn: {viaHealthResults.filter((r) => !r.isLive).length}
            </span>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {viaHealthResults.map((v, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                  v.isLive
                    ? 'bg-slate-900/80 border-emerald-800/40'
                    : 'bg-rose-950/20 border-rose-800/40'
                }`}
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-100">{v.viaName || `Via ${v.uid}`}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-medium ${
                      v.isLive
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${v.isLive ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                      {v.isLive ? 'LIVE' : v.status === 'CHECKPOINT' ? 'CHECKPOINT' : 'EXPIRED'}
                    </span>
                    {v.proxyUrl && (
                      <Tag color="purple" className="text-[10px] font-mono">
                        Proxy: {v.proxyUrl.split('@').pop() || 'Private'}
                      </Tag>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">UID: {v.uid || 'N/A'} {v.name && `· Tên Facebook: ${v.name}`}</div>
                  {v.error && <div className="text-[11px] text-rose-400">{v.error}</div>}
                </div>
                <div className="shrink-0 text-right text-[11px] text-slate-500 font-mono">
                  {new Date(v.checkedAt).toLocaleTimeString('vi-VN')}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>


    </div>
  );
}
