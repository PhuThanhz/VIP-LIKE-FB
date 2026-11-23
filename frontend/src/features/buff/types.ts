export interface FanpageItem {
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

export interface AutoBuffResultDetail {
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

export interface AutoBuffProgress {
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

export interface BuffStreamProgressEvent {
  type: 'PAGE_START' | 'PAGE_FINISH' | 'COOLDOWN_START' | 'COOLDOWN_END' | 'KPI_REACHED' | 'COOKIE_EXPIRED';
  index?: number;
  total?: number;
  pageId?: string;
  pageName?: string;
  viaName?: string;
  viaUid?: string;
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

export interface BuffRunResult {
  total: number;
  success: number;
  failed: number;
  unverified?: number;
  stopped?: boolean;
  details: AutoBuffResultDetail[];
}

export interface ViaGroup {
  viaName: string;
  cookieString: string;
  pages: FanpageItem[];
}

export interface BuffMonitor {
  id: string;
  targetName: string;
  targetUrl: string;
  targetType: 'PAGE' | 'GROUP' | 'PROFILE';
  checkIntervalMinutes: number;
  expiresAt?: string | null;
  dailyPostsCount?: number;
  dailyStatsDate?: string | null;
  buffConfig: {
    targetLikes: number | 'ALL';
    variancePercent?: number;
    maxPostsPerDay?: number;
    enableDripFeed?: boolean;
    dripDurationMinutes?: number;
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
  targetLikes?: number;
  successCount: number;
  alreadyLikedCount: number;
  failedCount: number;
  engagementMode?: 'LIKE_ONLY' | 'COMMENT_ONLY' | 'LIKE_AND_COMMENT';
  commentCount?: number;
  accountName?: string;
  details: AutoBuffResultDetail[];
}

export interface ReactionOption {
  key: string;
  label: string;
  shortLabel: string;
  emoji: string;
  color: string;
  isRandom: boolean;
  desc?: string;
}

export type SpeedModeKey = 'SMART' | 'TURBO' | 'FAST' | 'NORMAL' | 'SAFE';

export interface SpeedPreset {
  key: SpeedModeKey;
  name: string;
  delayMs: number;
  human: boolean;
}

export interface PageCardItemProps {
  page: FanpageItem;
  isChecked: boolean;
  isAlreadyLiked: boolean;
  cleanName: string;
  avatarUrl: string;
  actorMode: 'VIAS' | 'FANPAGES';
  selectedAccountId: string | number;
  onToggle: (pageId: string) => void;
}
