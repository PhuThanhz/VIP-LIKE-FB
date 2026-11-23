import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from 'react';
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
  Tooltip,
} from 'antd';
import {
  AimOutlined,
  PlusCircleOutlined,
  ThunderboltFilled,
  ReloadOutlined,
  PlayCircleOutlined,
  CheckCircleFilled,
  ExportOutlined,
  RobotOutlined,
  UserOutlined,
  SearchOutlined,
  StopOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
  CommentOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  ShareAltOutlined,
  ExclamationCircleOutlined,
  UpOutlined,
  DownOutlined,
  InteractionOutlined,
  AppstoreOutlined,
  BulbOutlined,
  ControlOutlined,
  LikeOutlined,
  EditOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import api, { WORKER_BASE_URL } from '../config/axios';
import PasteLinkInput from '../components/common/PasteLinkInput';
import { triggerCookieExpiredAlert, useCookieAlert } from '../components/common/CookieAlertManager';
import { TableSkeleton, PageSkeleton } from '../components/common/SaaSLoadingSkeleton';
import { parseFacebookCookie } from '../utils/cookieHelper';
import { getInitialSeedVias, seedLocalStorageIfEmpty, getStoredCookieForVia } from '../config/seedHelper';

// Tách nhỏ bundle (Code-splitting) với React.lazy cho các phân hệ quản trị lớn
const PostHunterTab = lazy(() => import('../components/buff/PostHunterTab'));
const BuffQueueTab = lazy(() => import('../components/buff/BuffQueueTab'));
const ViaManagementPage = lazy(() => import('./ViaManagementPage'));
const SystemSettingsPage = lazy(() => import('./SystemSettingsPage'));
const LicenseManagementPage = lazy(() => import('./LicenseManagementPage'));

import type {
  FanpageItem,
  AutoBuffResultDetail,
  AutoBuffProgress,
  ViaGroup,
  BuffMonitor,
  BatchOrder,
  BuffLogEntry,
  SpeedModeKey,
} from '../features/buff/types';
import {
  LEGACY_BUFF_LOGS_STORAGE_KEY,
  ENGAGEMENT_STORAGE_KEY,
  REACTIONS,
  SPEED_PRESETS,
  VIA_PAGES_STORAGE_KEY,
} from '../features/buff/constants';
import {
  formatDuration,
  runBuffStream,
  groupPagesByVia,
  summarizeBuffDetails,
  playVictoryChime,
  readLegacyBuffLogs,
  mergeBuffLogs,
  isFacebookPostUrl,
  normalizeFbPostUrlClient,
  extractCUser,
  isPersonalCookieAccount,
  formatDelaySeconds,
  getSpeedLabel,
  cleanPageName,
  getViaKey,
  getStoredPagesForVia,
  saveStoredPagesForVia,
} from '../features/buff/utils';
import PageCardItem from '../features/buff/components/PageCardItem';
import MonitorFormModal from '../features/buff/components/MonitorFormModal';
import ViaHealthModal from '../features/buff/components/ViaHealthModal';
import LogDetailModal from '../features/buff/components/LogDetailModal';
import ManagePagesModal from '../features/buff/components/ManagePagesModal';
import HistoryTab from '../features/buff/components/HistoryTab';
import RunningTab from '../features/buff/components/RunningTab';
import ResumeBuffModal from '../features/buff/components/ResumeBuffModal';
import AiSeedingModal from '../features/buff/components/AiSeedingModal';
import { useBuffQueue, useBuffMonitors, useBmOverview, useSystemSettings } from '../features/buff/hooks/usePolledData';


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
  const [actorMode, setActorMode] = useState<'VIAS' | 'FANPAGES'>('FANPAGES');
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const handleTogglePageId = useCallback((pageId: string) => {
    setSelectedPageIds((prev) =>
      prev.includes(pageId) ? prev.filter((id) => id !== pageId) : [...prev, pageId]
    );
  }, []);
  const [pageSearchQuery, setPageSearchQuery] = useState('');
  const [viaFilter, setViaFilter] = useState<string>('ALL');
  const [likeFilter, setLikeFilter] = useState<'ALL' | 'UNLIKED' | 'LIKED'>('ALL');
  const [speedMode, setSpeedMode] = useState<SpeedModeKey>('FAST');
  const [delayMs, setDelayMs] = useState<number>(1800);
  // "Tùy chỉnh" chỉ tồn tại ở giao diện: speedMode gửi backend giữ nguyên, người dùng tự chọn giãn cách
  const [customSpeed, setCustomSpeed] = useState<boolean>(false);
  const [enableHumanBehavior, setEnableHumanBehavior] = useState<boolean>(true);
  const [fastSwitch, setFastSwitch] = useState<boolean>(true);
  const [antiCheckpointGuard, setAntiCheckpointGuard] = useState<boolean>(true);
  const [isAiGeneratingComments, setIsAiGeneratingComments] = useState<boolean>(false);
  const [concurrency, setConcurrency] = useState<number>(1);
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
    engagementMode?: string;
  } | null>(null);
  const initialFinishedRestoreDoneRef = useRef(false);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);

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
  const [commentListText, setCommentListText] = useState<string>('');
  const [inlineCommentEditorOpen, setInlineCommentEditorOpen] = useState<boolean>(false);
  const parsedCommentLines = useMemo(
    () => commentListText.split('\n').map((s) => s.trim()).filter(Boolean),
    [commentListText]
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

  // Danh sách ID các Fanpage đã từng like link bài viết này trong hệ thống backend (bao gồm link /share/ cùng bài)
  const [interactedPageIds, setInteractedPageIds] = useState<Set<string>>(new Set());
  const [interactedCanonicalUrl, setInteractedCanonicalUrl] = useState<string>('');
  const [interactedPagesLoading, setInteractedPagesLoading] = useState<boolean>(false);

  const fetchInteractedPageIdsForUrl = useCallback(async (rawUrl: string): Promise<Set<string>> => {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed || !isFacebookPostUrl(trimmed)) {
      return new Set();
    }
    try {
      const res = await api.get('/buff-post-interacted-pages', { params: { url: trimmed } });
      if (res.data?.success && Array.isArray(res.data.interactedPageIds)) {
        const nextSet = new Set<string>(res.data.interactedPageIds.map((id: any) => String(id)));
        return nextSet;
      }
    } catch {}
    return new Set();
  }, []);

  useEffect(() => {
    const trimmed = targetPostUrl.trim();
    if (!trimmed || !isFacebookPostUrl(trimmed)) {
      setInteractedPageIds(new Set());
      setInteractedCanonicalUrl('');
      setInteractedPagesLoading(false);
      return;
    }
    let cancelled = false;
    setInteractedPagesLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/buff-post-interacted-pages', { params: { url: trimmed } });
        if (!cancelled && res.data?.success && Array.isArray(res.data.interactedPageIds)) {
          setInteractedPageIds(new Set(res.data.interactedPageIds.map((id: any) => String(id))));
          setInteractedCanonicalUrl(String(res.data.canonicalUrl || res.data.normalizedUrl || ''));
        }
      } catch {
      } finally {
        if (!cancelled) setInteractedPagesLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [targetPostUrl]);

  // Auto-Buff Queue State (Hunter-Ready & Background Pipeline)
  const { queueItems, fetchBuffQueue } = useBuffQueue();
  const [queueUrlInput, setQueueUrlInput] = useState<string>('');
  const [queueTargetLikes, setQueueTargetLikes] = useState<number>(30);
  const [queueDelayMinutes, setQueueDelayMinutes] = useState<number>(3);
  const [queueReaction, setQueueReaction] = useState<string>('RANDOM_POSITIVE');
  const [queueLoading, setQueueLoading] = useState<boolean>(false);

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

  const handleStopQueueTask = (id: string) => {
    modal.confirm({
      title: 'Dừng riêng bài này?',
      content: 'Worker sẽ dừng chạy tiếp bài này sau lượt Page hiện tại (các bài khác trong hàng đợi vẫn chạy bình thường).',
      okText: 'Dừng bài này',
      cancelText: 'Huỷ',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await axios.post(`${WORKER_BASE_URL}/api/buff-queue/stop/${id}`);
          if (res.data?.success) {
            message.success(res.data.message || 'Đã gửi lệnh dừng bài.');
            fetchBuffQueue();
          }
        } catch (err: any) {
          message.error(err.response?.data?.error || err.message);
        }
      },
    });
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
  const { monitors, postHunterPaused, setPostHunterPaused, fetchBuffMonitors } = useBuffMonitors();
  const [isMonitorModalOpen, setIsMonitorModalOpen] = useState<boolean>(false);
  const [monitorModalTarget, setMonitorModalTarget] = useState<{ editing?: BuffMonitor; prefillUrl?: string }>({});

  // Via Health & Enterprise BM Overview State
  const [checkingViaHealth, setCheckingViaHealth] = useState<boolean>(false);
  const [viaHealthResults, setViaHealthResults] = useState<any[]>([]);
  const [isHealthModalOpen, setIsHealthModalOpen] = useState<boolean>(false);
  const { bmOverview, fetchBmOverview } = useBmOverview();

  // Enterprise Ops Settings & Telegram Bot State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const { systemSettings, setSystemSettings, fetchSettings } = useSystemSettings();
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [testingTelegram, setTestingTelegram] = useState<boolean>(false);

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
    setMonitorModalTarget({ editing: existing, prefillUrl });
    setIsMonitorModalOpen(true);
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

  const handleTogglePostHunterPaused = async (paused: boolean) => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-hunter/pause`, { paused });
      if (res.data?.success) {
        setPostHunterPaused(Boolean(res.data.postHunterPaused));
        if (paused) {
          const cancelled = Number(res.data.cancelledTasks || 0);
          message.success(
            cancelled > 0
              ? `Đã tạm dừng Săn bài tự động và hủy ${cancelled} tác vụ Post Hunter!`
              : 'Đã tạm dừng tính năng Săn bài tự động!'
          );
        } else {
          message.success('Đã bật lại tính năng Săn bài tự động!');
        }
        fetchBuffMonitors();
        fetchBuffQueue();
        fetchBmOverview();
      } else {
        message.error(res.data?.error || 'Không cập nhật được trạng thái Săn bài tự động');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    }
  };

  const handleToggleMonitor = async (id: string) => {
    try {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-monitors/${id}/toggle`);
      if (res.data?.success) {
        message.success(res.data.monitor?.status === 'ACTIVE' ? 'Đã bật theo dõi định kỳ!' : 'Đã tạm dừng theo dõi!');
        fetchBuffMonitors();
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
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
      message.error({ content: err.response?.data?.error || err.message, key: 'scanMon' });
    }
  };


  // AI Seeding Studio & Spintax State
  const [aiStudioModalOpen, setAiStudioModalOpen] = useState(false);
  const [selectedNiche, setSelectedNiche] = useState<string>('GENERAL');

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
      setDelayMs(SPEED_PRESETS.find((p) => p.key === speedMode)?.delayMs ?? 2200);
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

  const [selectedLogDetail, setSelectedLogDetail] = useState<BuffLogEntry | null>(null);

  // Tính toán các Fanpage đã từng like link bài viết này trong lịch sử (chuẩn hoá URL để khớp cả link có / cuối hoặc tracking params)
  const alreadyLikedPagesForUrl = useMemo(() => {
    if (!targetPostUrl.trim()) return [];
    const normalizedTarget = normalizeFbPostUrlClient(targetPostUrl);
    const canonicalTarget = interactedCanonicalUrl ? normalizeFbPostUrlClient(interactedCanonicalUrl) : '';
    const matchingLogs = buffLogs.filter((log) => {
      const logNorm = normalizeFbPostUrlClient(log.targetUrl || '');
      return logNorm && (logNorm === normalizedTarget || (canonicalTarget && logNorm === canonicalTarget));
    });
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
  }, [targetPostUrl, interactedCanonicalUrl, buffLogs]);

  // Batch Buff State (Chạy like hàng loạt nhiều bài viết)
  const [batchLinksText, setBatchLinksText] = useState<string>(() => {
    return [
      'https://www.facebook.com/vietnameconomynews/posts/pfbid0CKLsordAmys5a5ewKRjKZgutBg9rJkoX5pnw4yzRMqtCq4PEVEV8HFfN2fQHQkg5l',
      'https://www.facebook.com/share/p/1EBw7LFuKm/',
      'https://www.facebook.com/share/p/1VuQkYgpni/',
      'https://www.facebook.com/share/r/18PbJ7Zxs4/',
      'https://www.facebook.com/share/p/19ekJcYmsb/',
    ].join('\n');
  });
  const [batchLikesPerOrder, setBatchLikesPerOrder] = useState<number>(100);
  const [batchLinkConcurrency, setBatchLinkConcurrency] = useState<number>(2); // 1: Tuần tự, 2: Song song 2 link cùng lúc
  const batchWaitSeconds = 2;
  const [batchOrders, setBatchOrders] = useState<BatchOrder[]>([]);
  const [pageDisplayLimit, setPageDisplayLimit] = useState<number>(60);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [isBatchPaused, setIsBatchPaused] = useState<boolean>(false);
  const batchAbortRef = useRef<boolean>(false);
  const batchPauseRef = useRef<boolean>(false);
  const buffAbortRef = useRef<AbortController | null>(null);
  const batchStreamAbortControllersRef = useRef<Set<AbortController>>(new Set());


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

  // Fetch accounts from backend with staleTime 0 so newly added Vias appear instantly
  const { data: accountsData = [], isLoading: loadingAccounts, refetch: refetchAccounts } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      try {
        const res = await api.get('/connections');
        if (Array.isArray(res.data) && res.data.length > 0) return res.data;
      } catch (e) {}
      return getInitialSeedVias();
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const accounts = accountsData && accountsData.length > 0 ? accountsData : getInitialSeedVias();

  // Deduplicate mother account by c_user
  const fbAccounts = useMemo(() => {
    const list = accounts && accounts.length > 0 ? accounts : getInitialSeedVias();
    const byCUser = new Map<string, any>();
    for (const account of list as any[]) {
      if (!isPersonalCookieAccount(account) || account.platform === 'FACEBOOK_GROUP') continue;
      const cUser = extractCUser(account.cookieString || account.accessToken) || String(account.platformAccountId || account.id);
      if (!cUser) continue;
      const savedCookie = getStoredCookieForVia(cUser);
      const effectiveAccount = {
        ...account,
        cookieString: account.cookieString || account.accessToken || savedCookie || '',
        accessToken: account.cookieString || account.accessToken || savedCookie || '',
      };
      const existing = byCUser.get(cUser);
      const accountIsProfile =
        effectiveAccount.platform === 'FACEBOOK_PROFILE' || effectiveAccount.accountType === 'PERSONAL_PROFILE_COOKIE';
      const existingIsProfile =
        existing?.platform === 'FACEBOOK_PROFILE' || existing?.accountType === 'PERSONAL_PROFILE_COOKIE';
      if (
        !existing ||
        (accountIsProfile && !existingIsProfile) ||
        (accountIsProfile === existingIsProfile && existing.tokenStatus !== 'OK' && effectiveAccount.tokenStatus === 'OK') ||
        (accountIsProfile === existingIsProfile && existing.tokenStatus === effectiveAccount.tokenStatus && effectiveAccount.id > existing.id)
      ) {
        byCUser.set(cUser, effectiveAccount);
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
    seedLocalStorageIfEmpty();
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

  // Set lookup tối ưu O(1) thay cho .includes() / .some() O(N*M)
  const selectedPageIdsSet = useMemo(() => new Set(selectedPageIds), [selectedPageIds]);
  const alreadyLikedPageIdsSet = useMemo(
    () => new Set(alreadyLikedPagesForUrl.map((al) => al.pageId)),
    [alreadyLikedPagesForUrl]
  );
  const combinedAlreadyLikedIds = useMemo(() => {
    const merged = new Set<string>(interactedPageIds);
    for (const id of alreadyLikedPageIdsSet) merged.add(id);
    return merged;
  }, [interactedPageIds, alreadyLikedPageIdsSet]);

  const unlikedScannedPages = useMemo(
    () => scannedPages.filter((p) => !combinedAlreadyLikedIds.has(p.id)),
    [scannedPages, combinedAlreadyLikedIds]
  );

  // Filter pages by search query, viaFilter, and likeFilter
  const filteredPages = useMemo(() => {
    let list = scannedPages;
    if (viaFilter !== 'ALL') {
      list = list.filter((p) => p.viaName === viaFilter || String(p.viaAccountId) === viaFilter);
    }
    if (likeFilter === 'UNLIKED') {
      list = list.filter((p) => !combinedAlreadyLikedIds.has(p.id));
    } else if (likeFilter === 'LIKED') {
      list = list.filter((p) => combinedAlreadyLikedIds.has(p.id));
    }
    if (!pageSearchQuery.trim()) return list;
    const q = pageSearchQuery.toLowerCase().trim();
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.includes(q) ||
        (p.viaName && p.viaName.toLowerCase().includes(q))
    );
  }, [scannedPages, pageSearchQuery, viaFilter, likeFilter, combinedAlreadyLikedIds]);

  // Đếm số lượng Page thuộc Via hết hạn Cookie đang được người dùng chọn (O(N) thay vì O(N^2))
  const expiredPagesSelectedCount = useMemo(() => {
    return scannedPages.filter((p) => selectedPageIdsSet.has(p.id) && p.viaStatus === 'EXPIRED').length;
  }, [scannedPages, selectedPageIdsSet]);

  // Chọn N Page theo thuật toán phân bổ đều Round-Robin giữa các Via mẹ
  const pickBalancedPagesFromPool = useCallback((pool: FanpageItem[], count: number): FanpageItem[] => {
    if (pool.length === 0 || count <= 0) return [];
    const targetCount = Math.min(count, pool.length);
    const pagesByVia: Record<string, FanpageItem[]> = {};
    for (const p of pool) {
      const viaKey = p.viaCookie || p.viaName || String(p.viaAccountId || 'default');
      if (!pagesByVia[viaKey]) pagesByVia[viaKey] = [];
      pagesByVia[viaKey].push(p);
    }
    Object.keys(pagesByVia).forEach((k) => {
      pagesByVia[k] = pagesByVia[k].sort(() => 0.5 - Math.random());
    });
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
    return selectedList;
  }, []);

  // Tự động loại bỏ & đổi sang Page chưa like ngay khi phát hiện bài viết đã có lịch sử tương tác
  useEffect(() => {
    if (!autoSkipAlreadyLiked || combinedAlreadyLikedIds.size === 0 || selectedPageIds.length === 0) return;
    const overlapCount = selectedPageIds.filter((id) => combinedAlreadyLikedIds.has(id)).length;
    if (overlapCount === 0) return;

    const keptIds = selectedPageIds.filter((id) => !combinedAlreadyLikedIds.has(id));
    const keptSet = new Set(keptIds);
    const availableUnliked = scannedPages.filter(
      (p) =>
        !combinedAlreadyLikedIds.has(p.id) &&
        !keptSet.has(p.id) &&
        (!autoFailoverLiveVia || p.viaStatus !== 'EXPIRED')
    );
    const fallbackUnliked =
      availableUnliked.length >= overlapCount
        ? availableUnliked
        : scannedPages.filter((p) => !combinedAlreadyLikedIds.has(p.id) && !keptSet.has(p.id));

    const replacements = pickBalancedPagesFromPool(fallbackUnliked, overlapCount);
    const nextIds = [...keptIds, ...replacements.map((p) => p.id)];
    setSelectedPageIds(nextIds);

    if (nextIds.length === 0) {
      message.warning(`Tất cả ${overlapCount} Fanpage đang chọn đều đã like bài viết này trước đó!`);
    } else if (replacements.length > 0) {
      message.info(
        `🛡️ Đã tự động bỏ ${overlapCount} Page đã like trước và đổi sang ${replacements.length} Page chưa like!`
      );
    } else {
      message.info(`🛡️ Đã tự động bỏ chọn ${overlapCount} Page đã like bài viết này trước đó.`);
    }
  }, [autoSkipAlreadyLiked, combinedAlreadyLikedIds, selectedPageIds, scannedPages, autoFailoverLiveVia, pickBalancedPagesFromPool]);

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
        !combinedAlreadyLikedIds.has(p.id)
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

  // Chọn tất cả Fanpage chưa like (hoặc toàn bộ nếu tắt chống trùng)
  const handleSelectAllUnliked = () => {
    const currentScanned = viaFilter !== 'ALL'
      ? scannedPages.filter((p) => p.viaName === viaFilter || String(p.viaAccountId) === viaFilter)
      : scannedPages;
    if (currentScanned.length === 0) return;
    const currentUnliked = currentScanned.filter((p) => !combinedAlreadyLikedIds.has(p.id));
    const basePool = autoSkipAlreadyLiked ? currentUnliked : currentScanned;
    const livePool = basePool.filter((p) => p.viaStatus !== 'EXPIRED');
    const finalPool = autoFailoverLiveVia && livePool.length > 0 ? livePool : basePool;

    if (finalPool.length === 0) {
      setSelectedPageIds([]);
      message.warning(`Tất cả Fanpage${viaFilter !== 'ALL' ? ` của Via [${viaFilter}]` : ''} hiện có đều đã like bài viết này rồi!`);
      return;
    }

    setSelectedPageIds(finalPool.map((p) => p.id));
    const skippedCount = currentScanned.length - finalPool.length;
    if (skippedCount > 0) {
      message.success(
        `Đã chọn toàn bộ ${finalPool.length} Fanpage${viaFilter !== 'ALL' ? ` của Via [${viaFilter}]` : ''} chưa like (bỏ qua ${skippedCount} Page đã like/lỗi)!`
      );
    } else {
      message.success(`Đã chọn toàn bộ ${finalPool.length} Fanpage${viaFilter !== 'ALL' ? ` của Via [${viaFilter}]` : ''}!`);
    }
  };

  // Chọn nhanh N Fanpage phân bổ cân bằng giữa các Via mẹ (CHỈ chọn những cái chưa like khi bật chống trùng)
  const handleSelectRandomPages = (count: number) => {
    const currentScanned = viaFilter !== 'ALL'
      ? scannedPages.filter((p) => p.viaName === viaFilter || String(p.viaAccountId) === viaFilter)
      : scannedPages;
    if (currentScanned.length === 0) return;
    const currentUnliked = currentScanned.filter((p) => !combinedAlreadyLikedIds.has(p.id));
    const freshPages = autoSkipAlreadyLiked ? currentUnliked : currentScanned;
    if (freshPages.length === 0) {
      setSelectedPageIds([]);
      message.warning(
        `Tất cả ${currentScanned.length} Fanpage${viaFilter !== 'ALL' ? ` của Via [${viaFilter}]` : ''} đều đã like bài viết này trước đó!`
      );
      return;
    }
    // TỰ ĐỘNG THAY THẾ BẰNG VIA LIVE: Ưu tiên chọn 100% từ các Via đang LIVE, loại bỏ Via hết cookie
    const liveFreshPages = freshPages.filter((p) => p.viaStatus !== 'EXPIRED');
    const pool = autoFailoverLiveVia && liveFreshPages.length > 0 ? liveFreshPages : freshPages;
    const selectedList = viaFilter !== 'ALL'
      ? pool.slice(0, count)
      : pickBalancedPagesFromPool(pool, count);

    const selected = selectedList.map((p) => p.id);
    setSelectedPageIds(selected);
    const viaCount = new Set(selectedList.map((p) => p.viaName || 'Via')).size;
    const skippedAlreadyCount = currentScanned.length - currentUnliked.length;

    if (selected.length < count) {
      message.warning(
        `Chỉ còn ${selected.length} Fanpage chưa like${viaFilter !== 'ALL' ? ` của Via [${viaFilter}]` : ''} (đã bỏ qua ${skippedAlreadyCount} Page đã like trước)!`
      );
    } else if (viaFilter !== 'ALL') {
      message.success(`Đã chọn ${selected.length} Fanpage từ Via [${viaFilter}]!`);
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

      // Tự động giới hạn số Page bằng số câu bình luận nếu ở chế độ Chỉ bình luận (tránh lặp cmt ngoài ý muốn khi đang chọn tất cả hàng trăm Page)
      const parsedCommentLines = commentListText.split('\n').map((s) => s.trim()).filter(Boolean);
      if (engagementMode === 'COMMENT_ONLY' && parsedCommentLines.length > 0 && pagesToBuff.length > parsedCommentLines.length) {
        pagesToBuff = pagesToBuff.slice(0, parsedCommentLines.length);
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
        const currentDone = currentCounts.success + currentCounts.alreadyLiked;
        if (currentDone >= targetKpi) {
          console.log(`[LiveBuff] 🎯 Đã đạt đủ KPI ${currentDone}/${targetKpi} like. Hoàn tất sớm!`);
          break;
        }
        const remainingNeeded = Math.max(1, targetKpi - currentDone);
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

        const pageViaNameMap = new Map(group.pages.map((p) => [p.id, p.viaName]));
        const resolveEventViaName = (pageId?: string, evViaName?: string) =>
          evViaName || pageViaNameMap.get(String(pageId || '')) || group.viaName;

        const selectedPagesPayload = group.pages.map((p, pIdx) => ({
          id: p.id,
          name: p.name,
          viaName: p.viaName || group.viaName,
          isProfile: p.isProfile ?? (actorMode === 'VIAS'),
          comment: commentLines.length > 0 ? commentLines[(finishedPagesCount + pIdx) % commentLines.length] : '',
        }));
        const payload = {
          sessionId: `${liveSessionId}_g${gIdx}`,
          totalSelectedCount: targetKpi,
          kpiTarget: remainingNeeded,
          autoReplenish: false,
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
          cooldownEvery: antiCheckpointGuard ? (speedMode === 'TURBO' ? 45 : speedMode === 'FAST' ? 35 : 25) : 9999,
          cooldownDurationMs: speedMode === 'TURBO' ? 5000 : speedMode === 'FAST' ? 8000 : 12000,
          comments: commentLines,
          concurrency,
          dripFeedMode,
          dripDurationMinutes,
        };

        const applyFinalDetails = (details: AutoBuffResultDetail[]) => {
          for (const d of details) {
            patchDetail(d.pageId, { ...d, viaName: resolveEventViaName(d.pageId, d.viaName) });
          }
        };

        try {
          const result = await runBuffStream(
            payload,
            (ev) => {
              if (ev.type === 'PAGE_START') {
                const eventViaName = resolveEventViaName(ev.pageId, ev.viaName);
                if (ev.pageId) pageViaNameMap.set(ev.pageId, eventViaName);
                patchDetail(ev.pageId || '', {
                  pageName: ev.pageName,
                  viaName: eventViaName,
                  status: 'RUNNING',
                  message: `[${eventViaName}] Đang mở bài và tương tác...`,
                });
                publish(`[${eventViaName}] ${ev.pageName}`);
                addLiveLog(`⚡ [${eventViaName}] Bắt đầu tương tác bằng: "${ev.pageName || ev.pageId}"`);
              } else if (ev.type === 'PAGE_FINISH') {
                finishedPagesCount++;
                const eventViaName = resolveEventViaName(ev.pageId, ev.viaName);
                patchDetail(ev.pageId || '', {
                  pageName: ev.pageName,
                  viaName: eventViaName,
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

                if ((ev.status === 'SUCCESS' || ev.status === 'ALREADY_LIKED') && ev.pageId) {
                  setInteractedPageIds((prev) => {
                    if (prev.has(ev.pageId!)) return prev;
                    const next = new Set(prev);
                    next.add(ev.pageId!);
                    return next;
                  });
                }

                // HARD CAP CHỐNG VƯỢT SCOPE: Ngay khi đạt đủ KPI Like mới thành công, lập tức ngắt stream và gửi lệnh dừng backend
                const freshCounts = summarizeBuffDetails(liveDetails);
                if (freshCounts.success >= targetKpi) {
                  addLiveLog(`🎯 [Đạt Chuẩn KPI] Đã hoàn thành chính xác ${freshCounts.success}/${targetKpi} Like! Tự động dừng chiến dịch ngay lập tức để không vượt mục tiêu.`);
                  controller.abort();
                  axios.post(`${WORKER_BASE_URL}/api/buff-live/stop`, { sessionId: `${liveSessionId}_g${gIdx}` }).catch(() => {});
                  return;
                }
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

      const hasConnInterrupted = details.some(
        (d) => d.status === 'SKIPPED' && String(d.message || '').includes('kết nối stream gián đoạn')
      );

      setAutoBuffProgress((prev) => {
        const goalTotal = prev.total || details.length;
        const achievedCount = counts.success + counts.alreadyLiked;
        const realPercent = goalTotal > 0 ? Math.min(100, Math.round((achievedCount / goalTotal) * 100)) : 100;
        return {
          ...prev,
          total: goalTotal,
          success: counts.success,
          alreadyLiked: counts.alreadyLiked,
          failed: counts.failed,
          percent: hasConnInterrupted ? realPercent : 100,
          currentRunningPageName: undefined,
          status: stopped ? 'STOPPED' : hasConnInterrupted ? 'ERROR' : 'DONE',
          isStopped: stopped,
          details,
        };
      });

      if (stopped) {
        message.info(`Đã dừng. ${counts.success} thành công, các Page còn lại được bỏ qua. Đã lưu vào lịch sử.`);
      } else if (hasConnInterrupted) {
        message.warning(`Kết nối stream bị gián đoạn khi đạt ${counts.success} like. Phần còn thiếu đã được chuyển sang Hàng đợi / có thể bấm Chạy tiếp.`);
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
  // State for Resume / Chạy tiếp Modal
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [resumeTargetUrl, setResumeTargetUrl] = useState('');
  const [resumeDoneLikes, setResumeDoneLikes] = useState(0);
  const [resumeTargetLikes, setResumeTargetLikes] = useState(100);
  const [resumeMissingLikes, setResumeMissingLikes] = useState(66);
  const [resumeReaction, setResumeReaction] = useState('LIKE');

  const handleOpenResumeModal = (customLogParam?: any) => {
    // Ngăn chặn trường hợp onClick={handleResumeRemaining} truyền React SyntheticEvent vào làm sai lệch dữ liệu
    const isEvent = customLogParam && (
      customLogParam.nativeEvent ||
      customLogParam._reactName ||
      typeof customLogParam.preventDefault === 'function' ||
      typeof customLogParam.stopPropagation === 'function'
    );
    const customLog = isEvent ? null : customLogParam;

    const targetUrl = customLog?.targetUrl || runningTargetInfo?.url || targetPostUrl;
    if (!targetUrl) {
      message.warning('Không tìm thấy link bài viết để chạy tiếp!');
      return;
    }

    // 1. Số like đã hoàn thành (ưu tiên log truyền vào, sau đó là autoBuffProgress hiện tại)
    const doneCount = customLog && typeof customLog.successCount === 'number'
      ? customLog.successCount
      : (autoBuffProgress.success || 0);

    // 2. Tìm mục tiêu gốc (Target Likes) - TUYỆT ĐỐI KHÔNG dùng totalPages (tổng kho fanpage) làm KPI mục tiêu!
    let originalTarget = 100;
    if (customLog?.targetLikes && typeof customLog.targetLikes === 'number' && customLog.targetLikes > 0) {
      originalTarget = customLog.targetLikes;
    } else if (autoBuffProgress.total && typeof autoBuffProgress.total === 'number' && autoBuffProgress.total > 0) {
      originalTarget = autoBuffProgress.total;
    } else if (runningTargetInfo?.count && runningTargetInfo.count > 0 && runningTargetInfo.count <= 500) {
      originalTarget = runningTargetInfo.count;
    } else {
      const matchedQueue = (queueItems as any[]).find(
        (q) => q.targetUrl === targetUrl && typeof q.targetLikes === 'number' && q.targetLikes > 0
      );
      if (matchedQueue) {
        originalTarget = matchedQueue.targetLikes;
      } else if (selectedPageIds.length > 0 && selectedPageIds.length <= 200) {
        originalTarget = selectedPageIds.length;
      } else {
        originalTarget = 100;
      }
    }

    const missing = Math.max(1, originalTarget - doneCount);
    setResumeTargetUrl(targetUrl);
    setResumeDoneLikes(doneCount);
    setResumeTargetLikes(originalTarget);
    setResumeMissingLikes(missing);
    setResumeReaction(customLog?.reactionType || runningTargetInfo?.reaction || selectedReaction || 'LIKE');
    setResumeModalOpen(true);
  };

  const handleResumeRemaining = (customLog?: any) => {
    handleOpenResumeModal(customLog);
  };

  const handleConfirmResume = async () => {
    if (!resumeTargetUrl) return;
    const likesToBuff = Math.max(1, Number(resumeMissingLikes) || 1);
    try {
      setIsResumingRemaining(true);
      message.loading({ content: `Đang đưa ${likesToBuff} like vào Hàng đợi...`, key: 'resume-rem' });
      await api.post('/buff-queue/add', {
        targetUrl: resumeTargetUrl,
        targetLikes: likesToBuff,
        reactionType: resumeReaction,
        delayMinutes: 0,
        source: 'MANUAL',
      });
      message.success({ content: `Đã đưa ${likesToBuff} like vào Hàng đợi! Tiến trình đang bắt đầu chạy.`, key: 'resume-rem' });
      setResumeModalOpen(false);
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
      fetchBuffQueue();
      queryClient.invalidateQueries();
    } catch (err: any) {
      message.error({ content: `Lỗi kích hoạt: ${err.message}`, key: 'resume-rem' });
    } finally {
      setIsResumingRemaining(false);
    }
  };

  const handleStartNewCampaign = async () => {
    try {
      await api.post('/buff-live/clear', {}).catch(() => {});
    } catch (_) {}
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
    setRunTiming({ start: null, end: null });
    initialFinishedRestoreDoneRef.current = true;
    setActiveTabKey('buff-like');
    message.success('Đã làm sạch bảng tiến trình. Bạn có thể thiết lập chiến dịch mới!');
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

    // Lấy danh sách Page đã like cho từng link (hỗ trợ cả /share/) để chỉ gửi các Page CHƯA LIKE
    const perOrderInteractedMap = new Map<string, Set<string>>();
    if (autoSkipAlreadyLiked) {
      await Promise.all(
        Array.from(new Set(parsedBatchLinks)).map(async (url) => {
          const ids = await fetchInteractedPageIdsForUrl(url);
          perOrderInteractedMap.set(url, ids);
        })
      );
    }

    const orderFreshPagesList = parsedBatchLinks.map((url) => {
      const skipIds = perOrderInteractedMap.get(url);
      if (!skipIds || skipIds.size === 0) return availablePages;
      const fresh = availablePages.filter((p) => !skipIds.has(p.id));
      return fresh.length > 0 ? fresh : [];
    });

    const initialOrders: BatchOrder[] = parsedBatchLinks.map((url, idx) => {
      const orderPool = orderFreshPagesList[idx];
      const orderTarget = Math.min(targetLikes, orderPool.length);
      return {
        id: idx + 1,
        url,
        orderNumber: idx + 1,
        status: orderPool.length === 0 ? 'COMPLETED' : 'PENDING',
        successLikes: 0,
        totalLikesTarget: orderTarget,
        percent: orderPool.length === 0 ? 100 : 0,
        details: orderPool.slice(0, orderTarget).map((p) => ({
          pageId: p.id,
          pageName: p.name,
          status: 'WAITING',
          message: 'Chờ đến lượt bài viết...',
        })),
      };
    });

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

    // Thuật toán xoay vòng nhóm Via cho từng order dựa trên danh sách Page chưa like của chính order đó
    const getViaGroupsForOrder = (orderIdx: number) => {
      const orderViaGroups = groupPagesByVia(orderFreshPagesList[orderIdx] || [], activeCookie, batchAccountName);
      if (orderViaGroups.length <= 1) return orderViaGroups;
      const offset = orderIdx % orderViaGroups.length;
      return [...orderViaGroups.slice(offset), ...orderViaGroups.slice(0, offset)];
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
        const currentSuccess = orderDetails.filter((d) => d.status === 'SUCCESS').length;
        if (currentSuccess >= targetLikes) {
          console.log(`[BatchBuff] 🎯 Order ${i + 1} đã đạt đủ KPI ${currentSuccess}/${targetLikes} like. Hoàn tất sớm!`);
          break;
        }
        const group = assignedViaGroups[gIdx];
        if (gIdx > 0) await new Promise((r) => setTimeout(r, 2000));

        const orderPageViaNameMap = new Map(group.pages.map((p) => [p.id, p.viaName]));
        const resolveOrderViaName = (pageId?: string, evViaName?: string) =>
          evViaName || orderPageViaNameMap.get(String(pageId || '')) || group.viaName;

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
                viaName: p.viaName || group.viaName,
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
                const eventViaName = resolveOrderViaName(ev.pageId, ev.viaName);
                if (ev.pageId) orderPageViaNameMap.set(ev.pageId, eventViaName);
                patchOrderDetail(ev.pageId || '', {
                  pageName: ev.pageName,
                  viaName: eventViaName,
                  status: 'RUNNING',
                  message: `[${eventViaName}] Đang mở bài và tương tác...`,
                });
                publishOrder({ currentRunningPageName: ev.pageName });
              } else if (ev.type === 'PAGE_FINISH') {
                const eventViaName = resolveOrderViaName(ev.pageId, ev.viaName);
                patchOrderDetail(ev.pageId || '', {
                  pageName: ev.pageName,
                  viaName: eventViaName,
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
          for (const d of result.details || []) {
            patchOrderDetail(d.pageId, { ...d, viaName: resolveOrderViaName(d.pageId, d.viaName) });
          }
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
    message.success(`Đã áp dụng: 1 link · Chỉ like 👍 · Chọn tất cả ${scannedPages.length} Page của mọi Via`);
  };

  const handleQuickPresetAiSeeding = async () => {
    setBuffMode('SINGLE');
    setEngagementMode('LIKE_AND_COMMENT');
    setSelectedReaction('RANDOM_POSITIVE');
    setActorMode('FANPAGES');
    setSelectedAccountId('ALL_VIAS');
    setSelectedPageIds(scannedPages.map((p) => p.id));
    const applied = `Đã áp dụng: 1 link · Like + bình luận · Trộn cảm xúc tự nhiên · ${scannedPages.length} Page`;
    if (targetPostUrl.trim()) {
      message.success(`${applied}. AI đang viết bình luận theo nội dung bài...`);
      handleGenerateAiComments();
    } else {
      message.info(`${applied}. Dán link bài viết để AI đọc nội dung và viết bình luận.`);
    }
  };

  const handleQuickPresetVias = () => {
    setBuffMode('SINGLE');
    setActorMode('VIAS');
    setSelectedAccountId('ALL_VIAS');
    message.success(`Đã áp dụng: 1 link · Dùng ${fbAccounts.length} nick cá nhân thay cho Page (giữ nguyên hình thức và cảm xúc)`);
  };

  // Kiểm tra xem hiện tại có bất kỳ tác vụ buff nào đang chạy không (0 bài thì làm mờ nút)
  const isAnyBuffRunning = Boolean(
    autoBuffMutation.isPending ||
    autoBuffProgress?.status === 'RUNNING' ||
    isBatchRunning ||
    queueItems.some((it) => it.status === 'RUNNING') ||
    (bmOverview?.stats?.runningCount || 0) > 0
  );

  const isBuffTab = ['buff-like', 'buff-running', 'buff-queue', 'buff-history', 'buff-hunter'].includes(activeTabKey);

  const emergencyStopButton = (
    <Tooltip title="Ngắt ngay mọi tiến trình đang chạy để bảo vệ tài khoản">
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
  );

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto px-2 sm:px-4 md:px-6 pb-28 md:pb-12">
      {/* Ngoài các tab Like & Bình luận (không có thanh tab), vẫn giữ nút dừng khẩn cấp khi đang chạy */}
      {!isBuffTab && isAnyBuffRunning && !bmOverview?.system?.isEmergencyStopped && (
        <div className="flex justify-end">{emergencyStopButton}</div>
      )}

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

      {/* Thanh điều hướng phân hệ VIPLIKE RADIANT (Linear/Apple-Tier Segmented Dock) */}
      {isBuffTab && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/60">
          <div
            role="tablist"
            aria-label="Điều hướng tính năng tương tác"
            className="inline-flex p-1.5 rounded-2xl bg-slate-900/85 border border-slate-800/90 backdrop-blur-xl shadow-lg shadow-black/25 gap-1.5 overflow-x-auto max-w-full scrollbar-none"
          >
            {[
              {
                key: 'buff-like',
                label: 'Tạo mới',
                icon: PlusCircleOutlined,
                iconColor: 'text-cyan-400',
                count: 0,
              },
              {
                key: 'buff-running',
                label: 'Tiến trình chạy',
                icon: ThunderboltFilled,
                iconColor: 'text-amber-400',
                count: (autoBuffProgress.status === 'RUNNING' || isBatchRunning || queueItems.some((i) => i.status === 'RUNNING')) ? 1 : 0,
                isPulse: (autoBuffProgress.status === 'RUNNING' || isBatchRunning || queueItems.some((i) => i.status === 'RUNNING')),
              },
              {
                key: 'buff-queue',
                label: 'Hàng đợi',
                icon: ClockCircleOutlined,
                iconColor: 'text-sky-400',
                count: queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length,
              },
              {
                key: 'buff-history',
                label: 'Lịch sử',
                icon: HistoryOutlined,
                iconColor: 'text-indigo-400',
                count: 0,
              },
              {
                key: 'buff-hunter',
                label: 'Săn bài tự động',
                icon: AimOutlined,
                iconColor: 'text-rose-400',
                count: monitors.length,
              },
            ].map((t) => {
              const active = activeTabKey === t.key;
              const IconComp = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTabKey(t.key)}
                  className={`group relative px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 cursor-pointer select-none flex items-center gap-2 outline-none focus:outline-none shrink-0 ${
                    active
                      ? 'bg-gradient-to-b from-slate-800/95 to-slate-800/70 text-white font-semibold shadow-[0_2px_12px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] border border-cyan-500/35'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                  }`}
                >
                  {/* Icon vector chuyên nghiệp */}
                  <span
                    className={`flex items-center justify-center text-sm transition-transform duration-200 group-hover:scale-110 ${
                      active ? t.iconColor : 'text-slate-400 group-hover:text-slate-300'
                    }`}
                  >
                    <IconComp />
                  </span>

                  {/* Nhãn tính năng */}
                  <span>{t.label}</span>

                  {/* Đèn báo live radar cho Tiến trình chạy */}
                  {t.isPulse && (
                    <span className="relative flex h-2 w-2 ml-0.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"></span>
                    </span>
                  )}

                  {/* Badge số lượng hiện đại */}
                  {t.count > 0 && !t.isPulse && (
                    <span
                      className={`ml-0.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold tabular-nums leading-none transition-colors ${
                        active
                          ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                          : 'bg-slate-800/90 text-slate-400 border border-slate-700/50'
                      }`}
                    >
                      {t.count > 999 ? '999+' : t.count}
                    </span>
                  )}

                  {/* Đường viền neon ánh sáng dưới chân tab đang active */}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-px h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent rounded-full shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Bên phải: số Via/Page (bấm để kiểm tra Via) + dừng khẩn cấp khi đang chạy */}
          <div className="flex items-center gap-2 pr-1 shrink-0">
            <Tooltip title="Bấm để kiểm tra tình trạng cookie của các Via">
              <Button size="small" loading={checkingViaHealth} onClick={handleRunViaHealthCheck} className="text-xs">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${bmOverview?.deadVias > 0 ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                <span className="text-slate-300">{bmOverview?.liveVias ?? fbAccounts.length} Via</span>
                {bmOverview?.deadVias > 0 && <span className="text-rose-400">· {bmOverview.deadVias} lỗi</span>}
                <span className="text-slate-500">·</span>
                <span className="text-slate-300">{scannedPages.length} Page</span>
              </Button>
            </Tooltip>
            {isAnyBuffRunning && !bmOverview?.system?.isEmergencyStopped && emergencyStopButton}
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
                                      : 'Bài viết'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Mẫu nhanh: gom 3 preset vào 1 nút để bớt một hàng nút trên form */}
                            <Dropdown
                              trigger={['click']}
                              menu={{
                                items: [
                                  {
                                    key: 'all-pages',
                                    icon: <ThunderboltFilled className="text-blue-400" />,
                                    label: `Like bằng toàn bộ Page (${scannedPages.length})`,
                                    onClick: handleQuickPresetLike24,
                                  },
                                  {
                                    key: 'ai-seeding',
                                    icon: <RobotOutlined className="text-purple-400" />,
                                    label: 'Like + bình luận AI',
                                    onClick: handleQuickPresetAiSeeding,
                                  },
                                  {
                                    key: 'vias',
                                    icon: <UserOutlined className="text-emerald-400" />,
                                    label: `Dùng nick cá nhân (${fbAccounts.length})`,
                                    onClick: handleQuickPresetVias,
                                  },
                                ],
                              }}
                            >
                              <Button icon={<ThunderboltFilled className="text-amber-400" />}>
                                Mẫu nhanh <DownOutlined className="text-[10px]" />
                              </Button>
                            </Dropdown>
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
                        </div>

                        {/* Input link hoặc danh sách link */}
                        {buffMode === 'SINGLE' ? (
                          <div>
                            <PasteLinkInput
                              value={targetPostUrl}
                              onChange={(val) => setTargetPostUrl(val)}
                              placeholder="Dán link bài viết Facebook (Group, Fanpage, Profile, Reels)"
                            />

                            {/* Đang kiểm tra lịch sử chống trùng */}
                            {interactedPagesLoading && (
                              <div className="mt-2.5 text-[11px] text-cyan-400 flex items-center gap-1.5">
                                <LoadingOutlined spin /> Đang kiểm tra các Page đã từng like bài viết này (kể cả link /share/)...
                              </div>
                            )}

                            {/* Cảnh báo nếu đã từng like bài viết này */}
                            {combinedAlreadyLikedIds.size > 0 && (
                              <div className="mt-3 p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
                                <span className="text-amber-300 font-semibold flex items-center gap-2">
                                  <InfoCircleOutlined className="text-amber-400 text-sm" />
                                  <span>
                                    Đã lưu <b>{combinedAlreadyLikedIds.size} Page/Via</b> từng like bài viết này trước đó (còn <b>{unlikedScannedPages.length}</b> chưa like)
                                  </span>
                                </span>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => {
                                    setSelectedPageIds((prev) => prev.filter((id) => !combinedAlreadyLikedIds.has(id)));
                                    message.success(`Đã tự động bỏ chọn các tài khoản đã like bài viết này!`);
                                  }}
                                  className="text-xs p-0 h-auto text-amber-400 font-bold hover:underline shrink-0"
                                >
                                  Bỏ chọn {combinedAlreadyLikedIds.size} tài khoản đã like
                                </Button>
                              </div>
                            )}

                            {/* Thanh Chọn Nhanh Số Lượng Like Ngay Dưới Ô Nhập Link (Không cần cuộn chuột) */}
                            {scannedPages.length > 0 && (
                              <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-300">Số like</span>
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
                                          {num}
                                        </button>
                                      );
                                    })}
                                  <button
                                    type="button"
                                    onClick={handleSelectAllUnliked}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                                      selectedPageIds.length > 0 &&
                                      selectedPageIds.length === (autoSkipAlreadyLiked ? unlikedScannedPages.length : scannedPages.length)
                                        ? 'bg-cyan-600 text-white border-cyan-500 shadow-md'
                                        : 'bg-cyan-950/60 text-cyan-300 border-cyan-800/80 hover:border-cyan-400'
                                    }`}
                                  >
                                    {autoSkipAlreadyLiked && combinedAlreadyLikedIds.size > 0
                                      ? `Chưa like (${unlikedScannedPages.length})`
                                      : `Tất cả (${scannedPages.length})`}
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
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-amber-950/90 border border-amber-700/70 text-amber-300 font-semibold flex items-center gap-1" title="Có dòng không nhận diện được định dạng Facebook hợp lệ">
                                    <ExclamationCircleOutlined className="text-amber-400" /> {invalidBatchLinesCount} dòng lỗi/bỏ qua
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
                                    ? 'Chạy song song 2 link cùng lúc (Tự động xoay vòng phân tách dàn Via mẹ tránh nghẽn)'
                                    : 'Chạy tuần tự từng link (Xong link 1 mới bắt đầu link 2, an toàn tối đa)'}
                                </span>
                              </div>
                              <Segmented
                                size="small"
                                value={batchLinkConcurrency}
                                onChange={(val) => setBatchLinkConcurrency(Number(val))}
                                options={[
                                  { label: 'Tuần tự (1 link)', value: 1 },
                                  { label: 'Song song (2 link)', value: 2 },
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
                              <LikeOutlined className="text-base" />
                              <span className="text-xs font-bold">Chỉ thả like/tim</span>
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
                              <CommentOutlined className="text-base" />
                              <span className="text-xs font-bold">Like + bình luận</span>
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
                              <EditOutlined className="text-base" />
                              <span className="text-xs font-bold">Chỉ bình luận</span>
                            </button>
                          </div>
                        </div>

                        {/* Tùy chọn Buff Share (Chia sẻ lên tường Fanpage) */}
                        <div className="px-3 py-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between gap-3">
                          <Tooltip title="Fanpage tự bấm Chia sẻ bài lên dòng thời gian của mình để tăng reach">
                            <span className="text-xs font-medium text-slate-200 flex items-center gap-2 cursor-help">
                              <ShareAltOutlined className="text-slate-400" /> Chia sẻ lên tường Fanpage
                            </span>
                          </Tooltip>
                          <Switch size="small" checked={enableShare} onChange={setEnableShare} />
                        </div>

                        {/* 2. Reaction Picker: 7 Cảm xúc Facebook + 2 Thẻ Trộn Tự Nhiên */}
                        {engagementMode !== 'COMMENT_ONLY' && (
                          <div className="space-y-2.5">
                            <label className="text-xs font-semibold text-slate-300 block">Cảm xúc</label>

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
                                  <Tooltip key={r.key} title={r.desc}>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedReaction(r.key)}
                                    className={`px-3 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer border text-left w-full ${
                                      isSelected
                                        ? 'bg-blue-950/40 border-blue-500 text-white shadow-md shadow-blue-500/20'
                                        : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                    }`}
                                  >
                                    {r.key === 'RANDOM_POSITIVE' ? (
                                      <InteractionOutlined className={isSelected ? 'text-blue-300' : 'text-slate-400'} />
                                    ) : (
                                      <AppstoreOutlined className={isSelected ? 'text-blue-300' : 'text-slate-400'} />
                                    )}
                                    <span className="text-xs font-semibold text-slate-200 truncate">{r.shortLabel}</span>
                                  </button>
                                  </Tooltip>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 2.5. Thanh Seeding Studio Tinh Gọn (Nếu bật Bình luận) */}
                        {engagementMode !== 'LIKE_ONLY' && (
                          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700/80 transition-all space-y-2.5">
                            {/* Dòng tiêu đề + trạng thái + các nút thao tác */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800/60">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="w-6 h-6 rounded-lg bg-blue-950/90 border border-blue-700/60 flex items-center justify-center text-blue-400 text-xs shrink-0">
                                  <CommentOutlined />
                                </div>
                                <span className="text-xs font-bold text-slate-200">
                                  Nội dung bình luận Seeding
                                </span>
                                {parsedCommentLines.length > 0 ? (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 font-bold">
                                    {parsedCommentLines.length} câu đã nạp
                                  </span>
                                ) : (
                                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-950/60 border border-amber-800/60 text-amber-300 font-medium">
                                    Chưa có câu nào
                                  </span>
                                )}
                              </div>

                              {/* Nhóm nút hành động */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Button
                                  size="small"
                                  type="primary"
                                  icon={<RobotOutlined spin={isAiGeneratingComments} />}
                                  loading={isAiGeneratingComments}
                                  onClick={handleGenerateAiComments}
                                  className="bg-blue-600 hover:bg-blue-500 text-on-accent font-semibold text-xs h-7 px-2.5 rounded-lg border-none cursor-pointer"
                                  title="Tự động viết bình luận bằng AI theo link bài viết"
                                >
                                  Tạo bằng AI
                                </Button>
                                <Button
                                  size="small"
                                  icon={<AppstoreOutlined />}
                                  onClick={() => setAiStudioModalOpen(true)}
                                  className="text-xs h-7 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200 cursor-pointer font-medium"
                                  title="Mở Studio chọn kịch bản theo ngành hàng hoặc trộn Spintax"
                                >
                                  Soạn &amp; Mẫu Seeding
                                </Button>
                                {parsedCommentLines.length > 0 && (
                                  <>
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        const shuffled = [...parsedCommentLines].sort(() => Math.random() - 0.5);
                                        setCommentListText(shuffled.join('\n'));
                                        message.info('Đã đảo ngẫu nhiên thứ tự bình luận!');
                                      }}
                                      className="text-xs h-7 px-2 rounded-lg bg-slate-900 border-slate-700 text-slate-300 cursor-pointer"
                                      title="Đảo ngẫu nhiên thứ tự câu"
                                    >
                                      Đảo
                                    </Button>
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        setCommentListText('');
                                        message.info('Đã xóa trắng danh sách bình luận');
                                      }}
                                      className="text-xs h-7 px-2 rounded-lg bg-slate-900 border-slate-700 text-rose-400 hover:text-rose-300 cursor-pointer"
                                      title="Xóa trắng"
                                    >
                                      Xóa
                                    </Button>
                                  </>
                                )}
                                <Button
                                  size="small"
                                  type="text"
                                  onClick={() => setInlineCommentEditorOpen(!inlineCommentEditorOpen)}
                                  className="text-xs h-7 px-2 text-cyan-400 hover:text-cyan-300 cursor-pointer font-medium"
                                >
                                  {inlineCommentEditorOpen ? 'Thu gọn' : 'Nhập nhanh'}
                                </Button>
                              </div>
                            </div>

                            {/* Preview ngắn khi đã có câu và chưa mở nhập nhanh */}
                            {parsedCommentLines.length > 0 && !inlineCommentEditorOpen && (
                              <div
                                onClick={() => setAiStudioModalOpen(true)}
                                className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 transition-all cursor-pointer group"
                                title="Bấm để mở Studio xem toàn bộ và chỉnh sửa"
                              >
                                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                                  <span>Xem trước ({parsedCommentLines.length} câu):</span>
                                  <span className="text-cyan-400 group-hover:underline text-[11px]">Mở studio chỉnh sửa &rarr;</span>
                                </div>
                                <div className="space-y-1">
                                  {parsedCommentLines.slice(0, 2).map((line, idx) => (
                                    <div key={idx} className="text-xs text-slate-200 truncate flex items-center gap-1.5 font-mono">
                                      <span className="text-slate-500 font-bold select-none text-[10px]">#{idx + 1}</span>
                                      <span className="truncate">{line}</span>
                                    </div>
                                  ))}
                                  {parsedCommentLines.length > 2 && (
                                    <div className="text-[11px] text-slate-500 italic">
                                      ... và còn {parsedCommentLines.length - 2} câu bình luận khác
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Khi chưa có câu nào: Gợi ý kịch bản 1-click */}
                            {parsedCommentLines.length === 0 && !inlineCommentEditorOpen && (
                              <div className="flex items-center gap-2 flex-wrap py-0.5">
                                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                                  <BulbOutlined className="text-amber-400" /> Kịch bản mẫu 1-click:
                                </span>
                                {seedingPresets.map((pr) => (
                                  <button
                                    key={pr.id}
                                    type="button"
                                    onClick={() => {
                                      setCommentListText(pr.comments.join('\n'));
                                      message.success(`Đã nạp kịch bản: ${pr.name} (${pr.comments.length} câu)`);
                                    }}
                                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer"
                                  >
                                    {pr.badge ? `[${pr.badge}] ` : ''}{pr.name}
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Ô nhập nhanh mở rộng (nếu người dùng bấm "Nhập nhanh") */}
                            {inlineCommentEditorOpen && (
                              <div className="space-y-2 pt-1">
                                <Input.TextArea
                                  rows={3}
                                  value={commentListText}
                                  onChange={(e) => setCommentListText(e.target.value)}
                                  placeholder="Mỗi dòng một câu bình luận (ví dụ: Bài viết rất hay và ý nghĩa ạ!)..."
                                  className="font-sans text-xs bg-slate-900/90 text-slate-100 border-slate-700 rounded-xl placeholder:text-slate-500 focus:border-cyan-400"
                                />
                                <div className="flex items-center justify-between text-[11px] text-slate-400">
                                  <span>Mỗi nick Facebook sẽ lấy 1 câu bình luận theo thứ tự hoặc ngẫu nhiên.</span>
                                  <button
                                    type="button"
                                    onClick={() => setInlineCommentEditorOpen(false)}
                                    className="text-cyan-400 hover:underline cursor-pointer bg-transparent border-none p-0"
                                  >
                                    Thu gọn lại
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 3. Khối Cài Đặt Nâng Cao & Tốc Độ (Thu Gọn / Collapsible) */}
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                          <div
                            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                            className="p-3 flex items-center justify-between cursor-pointer hover:bg-slate-900/40 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <ControlOutlined className="text-cyan-400 text-sm" />
                              <span className="text-xs font-bold text-slate-200">
                                Cài đặt nâng cao &amp; tốc độ (tùy chọn)
                              </span>
                              <span className="text-[10px] text-cyan-300 font-mono bg-cyan-950/80 border border-cyan-800/60 px-2 py-0.5 rounded-full">
                                {getSpeedLabel(speedMode, customSpeed, delayMs, engagementMode !== 'LIKE_ONLY')} • {concurrency} luồng • {dripFeedMode ? `rải đều ${dripDurationMinutes} phút` : 'chạy ngay'}
                              </span>
                            </div>
                            <span className="text-xs text-cyan-400 font-semibold flex items-center gap-1">
                              {showAdvancedSettings ? <><UpOutlined className="text-[10px]" /> Thu gọn</> : <><DownOutlined className="text-[10px]" /> Mở rộng</>}
                            </span>
                          </div>


                          {showAdvancedSettings && (
                            <div className="p-3 pt-0 border-t border-slate-800/80 space-y-2.5 mt-1">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                                {/* TỐC ĐỘ BUFF (SPEED MODE PRESET) */}
                                <div className="flex flex-col items-stretch p-3 rounded-xl bg-slate-950/80 border border-cyan-800/60 text-xs shadow-sm sm:col-span-2 gap-2">
                                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                    <span className="text-cyan-300 font-bold flex items-center gap-1">
                                      <ThunderboltFilled className="text-cyan-400" /> Tốc độ
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                      {engagementMode !== 'LIKE_ONLY'
                                        ? `Có bình luận nên nghỉ tối thiểu 12s giữa 2 lượt (đang: ${formatDelaySeconds(delayMs)})`
                                        : `Nghỉ ${formatDelaySeconds(delayMs)} giữa 2 lượt like`}
                                    </span>
                                  </div>
                                  <Segmented
                                    block
                                    size="small"
                                    value={customSpeed ? 'CUSTOM' : speedMode}
                                    onChange={(val) => {
                                      if (val === 'CUSTOM') {
                                        // Giữ giãn cách hiện tại, backend chạy theo nhịp chuẩn
                                        setCustomSpeed(true);
                                        setSpeedMode('NORMAL');
                                        return;
                                      }
                                      const preset = SPEED_PRESETS.find((p) => p.key === val);
                                      if (!preset) return;
                                      setCustomSpeed(false);
                                      setSpeedMode(preset.key);
                                      setDelayMs(engagementMode !== 'LIKE_ONLY' ? Math.max(delayMs, 12000) : preset.delayMs);
                                      setEnableHumanBehavior(preset.human);
                                      setFastSwitch(true);
                                    }}
                                    options={[
                                      ...SPEED_PRESETS.map((p) => ({
                                        label: p.name,
                                        value: p.key,
                                        title: `${p.name}: nghỉ ${formatDelaySeconds(p.delayMs)} giữa 2 lượt like`,
                                      })),
                                      { label: 'Tùy chỉnh', value: 'CUSTOM', title: 'Tự chọn thời gian nghỉ giữa 2 lượt' },
                                    ]}
                                    className="bg-slate-900 border border-slate-700 text-slate-200"
                                  />
                                </div>

                                {speedMode === 'SMART' && (
                                  <div className="sm:col-span-2 flex items-center gap-2 p-2 rounded-lg bg-cyan-950/40 border border-cyan-800/40 text-[11px] text-cyan-300">
                                    <SafetyCertificateOutlined className="text-cyan-400 text-sm shrink-0" />
                                    <span>
                                      <b>Tốc độ tự động đang bật:</b> Tự động giãn nhịp ({selectedPageIds.length <= 30 ? '~2.2s' : selectedPageIds.length <= 80 ? '~2.6s' : '~3.0s'}), thời gian đọc bài ~1.2s và nghỉ hạ nhiệt sau mỗi 25 page để vừa nhanh vừa hạn chế bị Facebook gắn cờ spam.
                                    </span>
                                  </div>
                                )}
                                {selectedPageIds.length > 80 && (speedMode === 'TURBO' || speedMode === 'FAST') && (
                                  <div className="sm:col-span-2 flex items-center gap-2 p-2 rounded-lg bg-amber-950/40 border border-amber-700/50 text-[11px] text-amber-300">
                                    <ThunderboltFilled className="text-amber-400 text-sm shrink-0" />
                                    <span>
                                      <b>Lưu ý an toàn:</b> Bạn đang chọn {selectedPageIds.length} Page với tốc độ {speedMode === 'TURBO' ? 'Siêu tốc' : 'Rất nhanh'}. Khuyên dùng <b>Chuẩn</b> hoặc <b>Tự động</b> khi chạy số lượng rất lớn để tránh bị Facebook hạn chế thao tác.
                                    </span>
                                  </div>
                                )}

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-emerald-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-slate-200 font-bold block">Mô phỏng người dùng</span>
                                    <span className="text-[10px] text-slate-400">Lướt đọc bài tự nhiên (0.5s - 1.5s)</span>
                                  </div>
                                  <Checkbox
                                    checked={enableHumanBehavior}
                                    onChange={(e) => setEnableHumanBehavior(e.target.checked)}
                                    className="text-emerald-400 font-bold"
                                  >
                                    Bật
                                  </Checkbox>
                                </div>

                                {/* Giãn cách chỉ hiện khi chọn "Tùy chỉnh" hoặc có bình luận (các mức tốc độ đã kèm sẵn giãn cách) */}
                                {(customSpeed || engagementMode !== 'LIKE_ONLY') && (
                                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs shadow-sm">
                                    <div>
                                      <span className="text-slate-200 font-bold block">Giãn cách</span>
                                      <span className="text-[10px] text-slate-400">Nghỉ giữa 2 lượt</span>
                                    </div>
                                    <Select
                                      size="small"
                                      value={delayMs}
                                      onChange={(val) => setDelayMs(val)}
                                      className="w-36"
                                      options={
                                        engagementMode !== 'LIKE_ONLY'
                                          ? [
                                              { value: 12000, label: '12s (khuyên dùng)' },
                                              { value: 16000, label: '16s (an toàn cao)' },
                                              { value: 25000, label: '25s (rất an toàn)' },
                                            ]
                                          : [1200, 1800, 2200, 2500, 3500, 4500, 5000, 8000].map((v) => ({
                                              value: v,
                                              label: formatDelaySeconds(v),
                                            }))
                                      }
                                    />
                                  </div>
                                )}

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

                                <div className="flex flex-col items-stretch gap-2 p-3 rounded-xl bg-slate-950/80 border border-cyan-900/60 text-xs shadow-sm sm:col-span-2">
                                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                    <span className="text-cyan-300 font-bold flex items-center gap-1">
                                      <ThunderboltFilled className="text-cyan-400" /> Luồng chạy song song
                                    </span>
                                    <span className="text-[11px] text-slate-400">Nhiều luồng chạy nhanh hơn x2 - x3</span>
                                  </div>
                                  <Segmented
                                    block
                                    size="small"
                                    value={concurrency}
                                    onChange={(val) => setConcurrency(Number(val))}
                                    options={[
                                      { label: '1 luồng', value: 1 },
                                      { label: '2 luồng (khuyên dùng)', value: 2 },
                                      { label: '3 luồng', value: 3 },
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
                                  ? `Gộp ${fbAccounts.length} nick Via (${selectedPageIds.length}/${scannedPages.length})`
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
                                Nhập cookie nick Facebook mẹ:
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
                                    const val = e.target.value.trim();
                                    const parsed = parseFacebookCookie(val);
                                    if (parsed.isJson) {
                                      setCustomCookie(parsed.cookieString);
                                      message.success(`Đã nhận diện JSON Cookie: UID ${parsed.c_user || 'N/A'}`);
                                      return;
                                    }
                                    const currentXs = customCookie.match(/(?:^|;\s*)xs=([^;]+)/)?.[1] || '';
                                    setCustomCookie(
                                      val && currentXs
                                        ? `c_user=${val}; xs=${currentXs}`
                                        : val
                                        ? `c_user=${val}`
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
                                    const val = e.target.value.trim();
                                    const parsed = parseFacebookCookie(val);
                                    if (parsed.isJson) {
                                      setCustomCookie(parsed.cookieString);
                                      message.success(`Đã nhận diện JSON Cookie: xs ${parsed.xs ? parsed.xs.slice(0, 15) + '...' : ''}`);
                                      return;
                                    }
                                    const currentCUser = customCookie.match(/(?:^|;\s*)c_user=([^;]+)/)?.[1] || '';
                                    setCustomCookie(
                                      currentCUser && val
                                        ? `c_user=${currentCUser}; xs=${val}`
                                        : val
                                        ? `xs=${val}`
                                        : ''
                                    );
                                  }}
                                  className="font-mono text-xs rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                                />
                              </Col>
                            </Row>

                            <Input.TextArea
                              rows={2}
                              placeholder="Dán toàn bộ chuỗi cookie hoặc quăng 1 đống JSON Cookie-Editor vào đây..."
                              value={customCookie}
                              onChange={(e) => {
                                const val = e.target.value;
                                const parsed = parseFacebookCookie(val);
                                if (parsed.isJson) {
                                  setCustomCookie(parsed.cookieString);
                                  message.success(`Đã tự động nhận diện JSON Cookie (${parsed.cookieCount} cookies)!`);
                                } else {
                                  setCustomCookie(val);
                                }
                              }}
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
                                {actorMode === 'VIAS' ? 'Chọn nick Via tương tác:' : 'Chọn Fanpage tương tác:'}{' '}
                                <span className="text-blue-400 font-mono font-bold">
                                  ({selectedPageIds.length}/{scannedPages.length})
                                </span>
                              </span>
                              <Checkbox
                                checked={
                                  selectedPageIds.length > 0 &&
                                  selectedPageIds.length === (autoSkipAlreadyLiked ? unlikedScannedPages.length : scannedPages.length)
                                }
                                indeterminate={
                                  selectedPageIds.length > 0 &&
                                  selectedPageIds.length < (autoSkipAlreadyLiked ? unlikedScannedPages.length : scannedPages.length)
                                }
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    handleSelectAllUnliked();
                                  } else {
                                    setSelectedPageIds([]);
                                  }
                                }}
                              >
                                <span className="text-xs text-slate-300 font-semibold">
                                  {autoSkipAlreadyLiked && combinedAlreadyLikedIds.size > 0
                                    ? `Chọn tất cả chưa like (${unlikedScannedPages.length})`
                                    : 'Chọn tất cả'}
                                </span>
                              </Checkbox>
                            </div>

                            {/* Thanh công cụ Chọn Nhanh Số Lượng Page (20, 50, 100, 200, 300, 400, 500, All) */}
                            {scannedPages.length > 5 && (
                              <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
                                <span className="text-[11px] text-slate-400 font-semibold">Chọn nhanh:</span>
                                {[20, 50, 100, 200, 300, 400, 500]
                                  .filter((n) => n <= (viaFilter !== 'ALL' ? (viaGroupCounts[viaFilter] || scannedPages.length) : scannedPages.length))
                                  .map((num) => (
                                    <Button
                                      key={num}
                                      size="small"
                                      onClick={() => handleSelectRandomPages(num)}
                                      className="bg-slate-900 border-slate-700/80 hover:border-cyan-500 text-slate-200 text-[11px] font-semibold rounded-lg px-2 h-6"
                                    >
                                      {num} Page
                                    </Button>
                                  ))}
                                {commentListText.split('\n').filter((s) => s.trim()).length > 0 && (
                                  <Button
                                    size="small"
                                    icon={<CommentOutlined className="text-xs" />}
                                    onClick={() => handleSelectRandomPages(commentListText.split('\n').filter((s) => s.trim()).length)}
                                    className="bg-blue-950/90 border-blue-600/90 hover:border-blue-400 text-blue-200 text-[11px] font-bold rounded-lg px-2 h-6"
                                  >
                                    {commentListText.split('\n').filter((s) => s.trim()).length} Page (Theo cmt)
                                  </Button>
                                )}
                                <Button
                                  size="small"
                                  onClick={handleSelectAllUnliked}
                                  className="bg-cyan-950/80 border-cyan-800 text-cyan-300 text-[11px] font-semibold rounded-lg px-2 h-6"
                                >
                                  {autoSkipAlreadyLiked && combinedAlreadyLikedIds.size > 0
                                    ? `Chưa like (${viaFilter !== 'ALL' ? filteredPages.filter(p => !combinedAlreadyLikedIds.has(p.id)).length : unlikedScannedPages.length})`
                                    : `Tất cả (${viaFilter !== 'ALL' ? filteredPages.length : scannedPages.length})`}
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

                            {/* Bộ lọc trạng thái Chưa like / Đã like */}
                            {combinedAlreadyLikedIds.size > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
                                <span className="text-[11px] font-semibold text-slate-400">Trạng thái bài này:</span>
                                <button
                                  type="button"
                                  onClick={() => setLikeFilter('ALL')}
                                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer border ${
                                    likeFilter === 'ALL'
                                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  Tất cả ({scannedPages.length})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLikeFilter('UNLIKED')}
                                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer border ${
                                    likeFilter === 'UNLIKED'
                                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                      : 'bg-slate-900 text-emerald-300 border-slate-800 hover:border-emerald-700'
                                  }`}
                                >
                                  Chưa like ({unlikedScannedPages.length})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLikeFilter('LIKED')}
                                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer border ${
                                    likeFilter === 'LIKED'
                                      ? 'bg-amber-600 text-white border-amber-500 shadow-sm'
                                      : 'bg-slate-900 text-amber-300 border-slate-800 hover:border-amber-700'
                                  }`}
                                >
                                  Đã like ({scannedPages.length - unlikedScannedPages.length})
                                </button>
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
                            {combinedAlreadyLikedIds.size > 0 && (
                              <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs flex items-center justify-between gap-2">
                                <span className="text-amber-300 font-medium flex items-center gap-1.5 text-[11px]">
                                  <InfoCircleOutlined className="text-amber-400" />
                                  <span>
                                    Đã lưu <b>{combinedAlreadyLikedIds.size} Page</b> từng like bài này (còn <b>{unlikedScannedPages.length} Page</b> chưa like). Nút "Chọn nhanh" sẽ tự động chọn các Page chưa like!
                                  </span>
                                </span>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setSelectedPageIds((prev) => prev.filter((id) => !combinedAlreadyLikedIds.has(id)));
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
                                const isAlreadyLiked = combinedAlreadyLikedIds.has(page.id);
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
                            { k: 'Tốc độ', v: `${getSpeedLabel(speedMode, customSpeed, delayMs, engagementMode !== 'LIKE_ONLY')} · ${concurrency} luồng` },
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
                              { label: 'Chạy ngay', value: 'NOW' },
                              { label: 'Đưa vào hàng đợi', value: 'QUEUE' },
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
                                    { value: 0, label: 'Ngay khi tới lượt' },
                                    { value: 5, label: 'Sau 5 phút' },
                                    { value: 15, label: 'Sau 15 phút' },
                                    { value: 30, label: 'Sau 30 phút' },
                                    { value: 60, label: 'Sau 1 giờ' },
                                    { value: 'AT', label: 'Vào giờ cụ thể' },
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
                                icon={<ClockCircleOutlined />}
                                loading={isEnqueueing}
                                disabled={selectedPageIds.length === 0 || !targetPostUrl.trim()}
                                onClick={handleEnqueueFromForm}
                                className="w-full h-11 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 border-none shadow-lg shadow-amber-600/25"
                              >
                                Đưa bài mới này vào Hàng đợi (Chờ chạy tiếp theo)
                              </Button>
                            </div>
                          ) : runMode === 'QUEUE' ? (
                            <div className="space-y-2">
                              <Button
                                type="primary"
                                size="large"
                                icon={<ClockCircleOutlined />}
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
                                  ? `Thêm ${parsedBatchLinks.length} bài vào hàng đợi`
                                  : 'Xác nhận thêm vào hàng đợi'}
                              </Button>
                            </div>
                          ) : buffMode === 'SINGLE' ? (
                            <div className="space-y-2">
                              <Button
                                type="primary"
                                size="large"
                                icon={<RocketOutlined />}
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
                                  : 'Bắt đầu chạy ngay'}
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {!isBatchRunning ? (
                                <Button
                                  type="primary"
                                  size="large"
                                  icon={<RocketOutlined />}
                                  disabled={parsedBatchLinks.length === 0 || selectedPageIds.length === 0}
                                  onClick={handleStartBatchBuff}
                                  className="w-full h-11 rounded-xl text-sm font-bold shadow-md shadow-blue-600/20"
                                >
                                  {parsedBatchLinks.length === 0
                                    ? 'Dán danh sách link ở bước 1'
                                    : `Bắt đầu chạy ${parsedBatchLinks.length} bài viết`}
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
                      ) : null}
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
              <RunningTab
                autoBuffProgress={autoBuffProgress}
                runTiming={runTiming}
                runningTargetInfo={runningTargetInfo}
                liveLogs={liveLogs}
                avatarCacheMap={avatarCacheMap}
                buffLogs={buffLogs}
                queueItems={queueItems}
                batchOrders={batchOrders}
                setBatchOrders={setBatchOrders}
                batchLinkConcurrency={batchLinkConcurrency}
                isBatchRunning={isBatchRunning}
                isResumingRemaining={isResumingRemaining}
                buffMode={buffMode}
                setBuffMode={setBuffMode}
                delayMs={delayMs}
                engagementMode={engagementMode}
                selectedAccountId={selectedAccountId}
                setSelectedAccountId={setSelectedAccountId}
                selectedReaction={selectedReaction}
                targetPostUrl={targetPostUrl}
                setActiveTabKey={setActiveTabKey}
                setActorMode={setActorMode}
                setBatchLikesPerOrder={setBatchLikesPerOrder}
                setBatchLinksText={setBatchLinksText}
                handleOpenManagePages={handleOpenManagePages}
                handleRefillBatchIncomplete={handleRefillBatchIncomplete}
                handleRefillSingleOrder={handleRefillSingleOrder}
                handleResumeRemaining={handleResumeRemaining}
                handleStartNewCampaign={handleStartNewCampaign}
                handleStopAutoBuff={handleStopAutoBuff}
                handleStopQueueTask={handleStopQueueTask}
              />
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
                  onStop={handleStopQueueTask}
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
                    if (url) {
                      const cleanUrl = url.trim().replace(/\/+$/, '');
                      setLogSearchQuery(cleanUrl);
                    }
                    reloadBuffLogs(false);
                    setActiveTabKey('buff-history');
                  }}
                />
              </Suspense>
            ),
          },
          {
            key: 'buff-history',
            label: (
              <span className="flex items-center gap-1.5">
                <CheckCircleFilled className="text-emerald-400" />
                <span>Lịch sử tương tác ({buffLogs.length})</span>
              </span>
            ),
            children: (
              <HistoryTab
                buffLogs={buffLogs}
                setBuffLogs={setBuffLogs}
                buffLogsLoading={buffLogsLoading}
                reloadBuffLogs={reloadBuffLogs}
                handleViewLogDetail={handleViewLogDetail}
                loadingLogDetailId={loadingLogDetailId}
                logSearchQuery={logSearchQuery}
                setLogSearchQuery={setLogSearchQuery}
                onGoCreate={() => setActiveTabKey('buff-like')}
                onBuffAgain={(log) => {
                  setTargetPostUrl(log.targetUrl);
                  setSelectedReaction(log.reactionType);
                  setActiveTabKey('buff-like');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  message.info('Đã nạp lại link vào form. Các Page đã like sẽ được tự động bỏ qua.');
                }}
              />
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
                  postHunterPaused={postHunterPaused}
                  onTogglePostHunterPaused={handleTogglePostHunterPaused}
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
      <LogDetailModal
        log={selectedLogDetail}
        onClose={() => setSelectedLogDetail(null)}
        onReuse={(log) => {
          setTargetPostUrl(log.targetUrl);
          setSelectedReaction(log.reactionType);
          setSelectedLogDetail(null);
          setActiveTabKey('buff-like');
          message.info('Đã nạp lại bài viết này vào form để tiếp tục.');
        }}
      />

      {/* Modal Khai Báo & Quản Lý i_user (Fanpage) cho Từng Via */}
      <ManagePagesModal
        managePagesModalOpen={managePagesModalOpen}
        onClose={() => setManagePagesModalOpen(false)}
        fbAccounts={fbAccounts}
        targetViaForModal={targetViaForModal}
        setTargetViaForModal={setTargetViaForModal}
        modalViaAccount={modalViaAccount}
        currentModalPages={currentModalPages}
        handleSavePagesForTargetVia={handleSavePagesForTargetVia}
        handleDeletePageForTargetVia={handleDeletePageForTargetVia}
        handleClearPagesForTargetVia={handleClearPagesForTargetVia}
      />

      {/* MODAL: AI SEEDING STUDIO & SPINTAX ENGINE */}
      <AiSeedingModal
        aiStudioModalOpen={aiStudioModalOpen}
        onClose={() => setAiStudioModalOpen(false)}
        selectedNiche={selectedNiche}
        setSelectedNiche={setSelectedNiche}
        commentListText={commentListText}
        setCommentListText={setCommentListText}
        parsedCommentLines={parsedCommentLines}
        aiPostPrompt={aiPostPrompt}
        setAiPostPrompt={setAiPostPrompt}
        aiTone={aiTone}
        setAiTone={setAiTone}
        aiCount={aiCount}
        setAiCount={setAiCount}
        isAiGeneratingComments={isAiGeneratingComments}
        handleGenerateAiComments={handleGenerateAiComments}
      />

      {/* MODAL: THÊM / CẬP NHẬT MỤC TIÊU THEO DÕI POST HUNTER */}
      <MonitorFormModal
        open={isMonitorModalOpen}
        editing={monitorModalTarget.editing}
        prefillUrl={monitorModalTarget.prefillUrl}
        maxPagesPerPost={systemSettings?.maxPagesPerPost || 150}
        workerBaseUrl={WORKER_BASE_URL}
        onClose={() => setIsMonitorModalOpen(false)}
        onSaved={fetchBuffMonitors}
      />

      {/* MODAL: BÁO CÁO SỨC KHỎE DÀN VIA TRONG BM */}
      <ViaHealthModal
        open={isHealthModalOpen}
        results={viaHealthResults}
        onClose={() => setIsHealthModalOpen(false)}
      />

      {/* MODAL: XÁC NHẬN CHẠY TIẾP / BÙ LIKE */}
      <ResumeBuffModal
        resumeModalOpen={resumeModalOpen}
        onClose={() => setResumeModalOpen(false)}
        resumeTargetUrl={resumeTargetUrl}
        resumeDoneLikes={resumeDoneLikes}
        resumeTargetLikes={resumeTargetLikes}
        resumeMissingLikes={resumeMissingLikes}
        setResumeMissingLikes={setResumeMissingLikes}
        resumeReaction={resumeReaction}
        setResumeReaction={setResumeReaction}
        isResumingRemaining={isResumingRemaining}
        handleConfirmResume={handleConfirmResume}
      />


    </div>
  );
}
